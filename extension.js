import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_PANEL_WIDTH = 200;
const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 700;
const THUMBNAIL_ASPECT_RATIO = 16 / 10; // Width to height ratio
const THUMBNAIL_SPACING = 12;
const THUMBNAIL_MARGIN_LEFT = 16; // Left margin for close button
const THUMBNAIL_MARGIN_RIGHT = 20; // Right margin (more space for resize handle)
const RESIZE_HANDLE_WIDTH = 8;
const SCREENSHOT_PANEL_PADDING = 8; // Padding inside screenshot panel
const BOTTOM_PANEL_HEIGHT = 44;

// Calculate thumbnail width considering side margins and resize handle
function calculateThumbnailWidth(panelWidth, resizeHandleWidth) {
    // Content area = panelWidth - resizeHandleWidth - margins
    return panelWidth - resizeHandleWidth - THUMBNAIL_MARGIN_LEFT - THUMBNAIL_MARGIN_RIGHT;
}

// Calculate screenshot width (inside the screenshot panel)
function calculateScreenshotWidth(thumbnailWidth) {
    // Subtract the screenshot panel padding (8px each side)
    return thumbnailWidth - SCREENSHOT_PANEL_PADDING * 2;
}

// Calculate screenshot height based on width
function calculateScreenshotHeight(screenshotWidth) {
    return Math.round(screenshotWidth / THUMBNAIL_ASPECT_RATIO);
}

// Window thumbnail in the side panel
const WindowThumbnail = GObject.registerClass(
    class WindowThumbnail extends St.Widget {
        _init(window, stageManager, panelWidth, resizeHandleWidth) {
            super._init({
                style_class: 'stage-manager-thumbnail',
                layout_manager: new Clutter.FixedLayout(),
                reactive: true,
                can_focus: false,
                track_hover: true,
            });

            this._window = window;
            this._stageManager = stageManager;
            this._panelWidth = panelWidth;
            this._resizeHandleWidth = resizeHandleWidth;

            // Calculate dimensions
            const thumbnailWidth = calculateThumbnailWidth(panelWidth, resizeHandleWidth);
            const screenshotWidth = calculateScreenshotWidth(thumbnailWidth);
            const screenshotHeight = calculateScreenshotHeight(screenshotWidth);
            const totalHeight = screenshotHeight + SCREENSHOT_PANEL_PADDING * 2 + BOTTOM_PANEL_HEIGHT;

            // Set widget size (with extra space for close button overflow)
            const CLOSE_BUTTON_SIZE = 28;
            const CLOSE_BUTTON_OFFSET = 12; // How much it overflows
            this.set_size(thumbnailWidth + CLOSE_BUTTON_OFFSET, totalHeight + CLOSE_BUTTON_OFFSET);

            // Main content container (holds screenshot panel and bottom panel)
            this._contentBox = new St.BoxLayout({
                vertical: true,
                width: thumbnailWidth,
                height: totalHeight,
            });
            this._contentBox.set_position(CLOSE_BUTTON_OFFSET, CLOSE_BUTTON_OFFSET);

            // Screenshot panel (contains the window clone)
            this._screenshotPanel = new St.Widget({
                style_class: 'stage-manager-screenshot-panel',
                layout_manager: new Clutter.FixedLayout(),
                width: thumbnailWidth,
                height: screenshotHeight + SCREENSHOT_PANEL_PADDING * 2,
            });

            // Clone container inside screenshot panel
            this._cloneContainer = new St.Widget({
                style_class: 'stage-manager-clone-container',
                layout_manager: new Clutter.FixedLayout(),
                height: screenshotHeight,
                width: screenshotWidth,
                clip_to_allocation: true,
            });
            this._cloneContainer.set_position(SCREENSHOT_PANEL_PADDING, SCREENSHOT_PANEL_PADDING);

            // Create window clone
            this._createClone();
            this._screenshotPanel.add_child(this._cloneContainer);
            this._contentBox.add_child(this._screenshotPanel);

            // Bottom panel with icon and app name
            this._bottomPanel = new St.BoxLayout({
                style_class: 'stage-manager-thumbnail-bottom-panel',
                vertical: false,
                width: thumbnailWidth,
                height: BOTTOM_PANEL_HEIGHT,
            });

            // App icon inside bottom panel
            const app = Shell.WindowTracker.get_default().get_window_app(window);
            if (app) {
                const icon = app.create_icon_texture(24);
                if (icon) {
                    icon.style_class = 'stage-manager-app-icon';
                    this._bottomPanel.add_child(icon);
                }
            }

            // App name inside bottom panel
            this._appLabel = new St.Label({
                text: app ? app.get_name() : 'Unknown',
                style_class: 'stage-manager-app-name',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this._appLabel.clutter_text.set_ellipsize(3);
            this._bottomPanel.add_child(this._appLabel);

            this._contentBox.add_child(this._bottomPanel);
            this.add_child(this._contentBox);

            // Close button - positioned to overflow top-left corner
            const closeIcon = new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 16,
                style_class: 'stage-manager-close-icon',
            });

            this._closeButton = new St.Button({
                style_class: 'stage-manager-close-button',
                child: closeIcon,
                reactive: true,
                can_focus: false,
                track_hover: true,
                width: CLOSE_BUTTON_SIZE,
                height: CLOSE_BUTTON_SIZE,
            });
            // Position so it overlaps the corner
            this._closeButton.set_position(0, 0);

            // Handle close button click
            this._closeButton.connect('button-release-event', (actor, event) => {
                if (event.get_button() === 1) {
                    try {
                        this._window.delete(global.get_current_time());
                    } catch (e) {
                        log(`Error closing window: ${e}`);
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Prevent click from propagating to the thumbnail
            this._closeButton.connect('button-press-event', () => {
                return Clutter.EVENT_STOP;
            });

            this.add_child(this._closeButton);

            // Track clicks for single/double click detection
            this._clickCount = 0;
            this._clickTimer = null;

            // Click handling with single/double click detection
            this.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    this._clickCount++;

                    if (this._clickCount === 1) {
                        // Start timer for single click
                        this._clickTimer = GLib.timeout_add(
                            GLib.PRIORITY_DEFAULT,
                            250, // Double click timeout
                            () => {
                                if (this._clickCount === 1) {
                                    // Single click
                                    this._handleSingleClick();
                                }
                                this._clickCount = 0;
                                this._clickTimer = null;
                                return GLib.SOURCE_REMOVE;
                            }
                        );
                    } else if (this._clickCount === 2) {
                        // Double click - cancel single click timer
                        if (this._clickTimer) {
                            GLib.source_remove(this._clickTimer);
                            this._clickTimer = null;
                        }
                        this._handleDoubleClick();
                        this._clickCount = 0;
                    }

                    return Clutter.EVENT_STOP;
                } else if (event.get_button() === 3) {
                    // Right click - show context menu
                    this._showContextMenu(event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _showContextMenu(event) {
            // Get the app for this window
            const app = Shell.WindowTracker.get_default().get_window_app(this._window);
            if (!app) return;

            // Close any existing menu
            if (this._menu) {
                this._menu.close(false);
                this._menu.destroy();
                this._menu = null;
            }

            this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.RIGHT);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();

            // Add menu items similar to dash
            this._menu.addAction('Nueva ventana', () => {
                app.open_new_window(-1);
            });

            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Close window option
            this._menu.addAction('Cerrar', () => {
                this._window.delete(global.get_current_time());
            });

            // Show on all workspaces / only this workspace
            if (this._window.is_on_all_workspaces()) {
                this._menu.addAction('Solo en este espacio de trabajo', () => {
                    this._window.unstick();
                });
            } else {
                this._menu.addAction('En todos los espacios de trabajo', () => {
                    this._window.stick();
                });
            }

            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Quit app
            this._menu.addAction('Salir', () => {
                app.request_quit();
            });

            // Close menu when it loses focus or on outside click
            this._menu.connect('open-state-changed', (menu, open) => {
                if (!open && this._menu) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                        if (this._menu) {
                            this._menu.destroy();
                            this._menu = null;
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            // Capture clicks outside the menu to close it
            this._menuCaptureId = global.stage.connect('captured-event', (actor, capturedEvent) => {
                if (capturedEvent.type() === Clutter.EventType.BUTTON_PRESS) {
                    // Check if click is outside the menu
                    const [stageX, stageY] = capturedEvent.get_coords();
                    const menuActor = this._menu.actor;
                    if (menuActor && menuActor.visible) {
                        const [menuX, menuY] = menuActor.get_transformed_position();
                        const menuWidth = menuActor.width;
                        const menuHeight = menuActor.height;

                        const isOutside = stageX < menuX || stageX > menuX + menuWidth ||
                            stageY < menuY || stageY > menuY + menuHeight;

                        if (isOutside && this._menu) {
                            this._menu.close(false);
                            return Clutter.EVENT_STOP;
                        }
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Position and open menu
            const [x, y] = event.get_coords();
            this._menu.actor.set_position(x, y);
            this._menu.open();
        }

        _handleSingleClick() {
            const focusWindow = global.display.focus_window;

            if (this._window === focusWindow) {
                // Click on active thumbnail - minimize with animation
                this._minimizeWithAnimation();
            } else {
                // Click on inactive thumbnail - activate window with animation
                this._activateWithAnimation();
            }
        }

        _activateWithAnimation() {
            try {
                // Get the current focused window to animate out
                const currentWindow = global.display.focus_window;
                if (currentWindow && currentWindow !== this._window) {
                    const currentActor = currentWindow.get_compositor_private();
                    if (currentActor) {
                        // Slide current window to the right (exit)
                        const monitor = Main.layoutManager.primaryMonitor;
                        currentActor.ease({
                            translation_x: monitor.width,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_IN_QUAD,
                            onComplete: () => {
                                currentActor.translation_x = 0;
                                currentWindow.minimize();
                            },
                        });
                    }
                }

                // Unminimize and activate the new window
                if (this._window.minimized) {
                    this._window.unminimize();
                }

                // Prepare entry animation - start from left
                const newActor = this._window.get_compositor_private();
                if (newActor) {
                    const monitor = Main.layoutManager.primaryMonitor;
                    newActor.translation_x = -monitor.width;

                    // Slight delay to let the window unminimize
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        newActor.ease({
                            translation_x: 0,
                            duration: 250,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                        return GLib.SOURCE_REMOVE;
                    });
                }

                this._activateWindow(this._window);
            } catch (e) {
                // Fallback - just activate
                this._activateWindow(this._window);
            }
        }

        _minimizeWithAnimation() {
            const actor = this._window.get_compositor_private();
            if (!actor) {
                this._window.minimize();
                return;
            }

            const monitor = imports.ui.main.layoutManager.primaryMonitor;
            if (!monitor) {
                this._window.minimize();
                return;
            }

            // Slide out to the left
            actor.ease({
                translation_x: -actor.width,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    actor.translation_x = 0;
                    this._window.minimize();
                },
            });
        }

        _activateWindow(window) {
            if (window.minimized) {
                window.unminimize();
            }
            window.activate(global.get_current_time());
        }

        _handleDoubleClick() {
            const focusWindow = global.display.focus_window;

            if (this._window === focusWindow) {
                // Double click on active thumbnail - maximize
                this._window.maximize(Meta.MaximizeFlags.BOTH);
            } else {
                // Double click on inactive thumbnail - activate and maximize
                this._activateWindow(this._window);
                this._window.maximize(Meta.MaximizeFlags.BOTH);
            }
        }

        _updateCloneTransform(clone, containerWidth, containerHeight) {
            // Get frame rect (visible window without shadows)
            const frameRect = this._window.get_frame_rect();
            const bufferRect = this._window.get_buffer_rect();

            // Calculate shadow/decoration offsets
            const shadowLeft = Math.abs(frameRect.x - bufferRect.x);
            const shadowTop = Math.abs(frameRect.y - bufferRect.y);

            // Use frame rect dimensions (visible window)
            const windowWidth = frameRect.width;
            const windowHeight = frameRect.height;

            // Calculate scale to fit container while maintaining aspect ratio
            const scaleX = containerWidth / windowWidth;
            const scaleY = containerHeight / windowHeight;
            const scale = Math.min(scaleX, scaleY);

            // Apply scale
            clone.set_scale(scale, scale);

            // Calculate position to center the visible window content
            const scaledWidth = windowWidth * scale;
            const scaledHeight = windowHeight * scale;

            // Position considering shadow offsets
            const x = (containerWidth - scaledWidth) / 2 - (shadowLeft * scale);
            const y = (containerHeight - scaledHeight) / 2 - (shadowTop * scale);

            clone.set_position(x, y);
        }

        _createClone() {
            try {
                const windowActor = this._window.get_compositor_private();
                if (!windowActor) return;

                const clone = new Clutter.Clone({
                    source: windowActor,
                });

                // Container dimensions (screenshot area)
                const thumbnailWidth = calculateThumbnailWidth(this._panelWidth, this._resizeHandleWidth);
                const containerWidth = calculateScreenshotWidth(thumbnailWidth);
                const containerHeight = calculateScreenshotHeight(containerWidth);

                // Apply transform (scale and position)
                this._updateCloneTransform(clone, containerWidth, containerHeight);

                this._cloneContainer.add_child(clone);
                this._clone = clone;
            } catch (e) {
                log(`Error creating window clone: ${e}`);
            }
        }

        updateSize(panelWidth, resizeHandleWidth) {
            try {
                this._panelWidth = panelWidth;
                this._resizeHandleWidth = resizeHandleWidth;

                const thumbnailWidth = calculateThumbnailWidth(panelWidth, resizeHandleWidth);
                const screenshotWidth = calculateScreenshotWidth(thumbnailWidth);
                const screenshotHeight = calculateScreenshotHeight(screenshotWidth);
                const totalHeight = screenshotHeight + SCREENSHOT_PANEL_PADDING * 2 + BOTTOM_PANEL_HEIGHT;

                const CLOSE_BUTTON_OFFSET = 12;
                this.set_size(thumbnailWidth + CLOSE_BUTTON_OFFSET, totalHeight + CLOSE_BUTTON_OFFSET);

                // Update content box
                if (this._contentBox) {
                    this._contentBox.set_size(thumbnailWidth, totalHeight);
                    this._contentBox.set_position(CLOSE_BUTTON_OFFSET, CLOSE_BUTTON_OFFSET);
                }

                // Update screenshot panel
                if (this._screenshotPanel) {
                    this._screenshotPanel.set_width(thumbnailWidth);
                    this._screenshotPanel.set_height(screenshotHeight + SCREENSHOT_PANEL_PADDING * 2);
                }

                // Update clone container
                if (this._cloneContainer) {
                    this._cloneContainer.set_width(screenshotWidth);
                    this._cloneContainer.set_height(screenshotHeight);
                }

                // Update bottom panel
                if (this._bottomPanel) {
                    this._bottomPanel.set_width(thumbnailWidth);
                }

                if (this._clone) {
                    const windowActor = this._window.get_compositor_private();
                    if (windowActor) {
                        // Reuse the transform calculation method
                        this._updateCloneTransform(this._clone, screenshotWidth, screenshotHeight);
                    }
                }
            } catch (e) {
                log(`Error updating thumbnail size: ${e}`);
            }
        }

        destroy() {
            try {
                if (this._menuCaptureId) {
                    global.stage.disconnect(this._menuCaptureId);
                    this._menuCaptureId = null;
                }
                if (this._menu) {
                    this._menu.close(false);
                    this._menu.destroy();
                    this._menu = null;
                }
                if (this._clickTimer) {
                    GLib.source_remove(this._clickTimer);
                    this._clickTimer = null;
                }
                if (this._closeButton) {
                    this._closeButton = null;
                }
                if (this._clone) {
                    this._clone = null;
                }
            } catch (e) {
                log(`Error destroying thumbnail: ${e}`);
            }
            super.destroy();
        }
    });

// Side panel with window thumbnails
const StageManagerPanel = GObject.registerClass(
    class StageManagerPanel extends St.BoxLayout {
        _init(extension) {
            const panelWidth = extension._settings.get_int('panel-width');

            super._init({
                name: 'stage-manager-panel',
                vertical: false,
                style_class: 'stage-manager-panel',
                width: panelWidth,
                y_align: Clutter.ActorAlign.START,
            });

            this._extension = extension;
            this._settings = extension._settings;
            this._thumbnails = [];
            this._panelWidth = panelWidth;
            this._resizeHandleWidth = RESIZE_HANDLE_WIDTH;

            // Detect and apply theme variant
            this._applyThemeVariant();

            // Main container for content (left side, excluding resize handle)
            this._contentContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            // Top header panel (fixed, not affected by scroll)
            this._headerPanel = new St.BoxLayout({
                style_class: 'stage-manager-header-panel',
                vertical: false,
                x_expand: true,
                height: 47,
            });

            // Hide panel button (left side)
            const closeIcon = new St.Icon({
                icon_name: 'sidebar-show-symbolic',
                icon_size: 16,
                style_class: 'stage-manager-header-icon',
            });

            this._closeButton = new St.Button({
                style_class: 'stage-manager-header-button',
                child: closeIcon,
                reactive: true,
                can_focus: false,
                track_hover: true,
            });

            // Add tooltip
            this._closeButtonTooltip = new St.Label({
                style_class: 'tooltip',
                text: 'Hide panel',
                visible: false,
            });
            Main.uiGroup.add_child(this._closeButtonTooltip);

            this._closeButton.connect('enter-event', () => {
                const [x, y] = this._closeButton.get_transformed_position();
                const [width, height] = this._closeButton.get_size();
                this._closeButtonTooltip.set_position(x + width / 2 - this._closeButtonTooltip.width / 2, y + height + 5);
                this._closeButtonTooltip.show();
            });

            this._closeButton.connect('leave-event', () => {
                this._closeButtonTooltip.hide();
            });

            this._closeButton.connect('clicked', () => {
                this._closeButtonTooltip.hide();
                if (this._extension) {
                    this._extension._hidePanelAnimated();
                }
            });

            this._headerPanel.add_child(this._closeButton);

            // Show desktop button (next to close button)
            const desktopIcon = new St.Icon({
                icon_name: 'computer-symbolic',
                icon_size: 16,
                style_class: 'stage-manager-header-icon',
            });

            this._desktopButton = new St.Button({
                style_class: 'stage-manager-header-button',
                child: desktopIcon,
                reactive: true,
                can_focus: false,
                track_hover: true,
            });

            // Add tooltip
            this._desktopButtonTooltip = new St.Label({
                style_class: 'tooltip',
                text: 'Show desktop',
                visible: false,
            });
            Main.uiGroup.add_child(this._desktopButtonTooltip);

            this._desktopButton.connect('enter-event', () => {
                const [x, y] = this._desktopButton.get_transformed_position();
                const [width, height] = this._desktopButton.get_size();
                this._desktopButtonTooltip.set_position(x + width / 2 - this._desktopButtonTooltip.width / 2, y + height + 5);
                this._desktopButtonTooltip.show();
            });

            this._desktopButton.connect('leave-event', () => {
                this._desktopButtonTooltip.hide();
            });

            this._desktopButton.connect('clicked', () => {
                this._desktopButtonTooltip.hide();
                if (this._extension) {
                    this._extension._showDesktop();
                }
            });

            this._headerPanel.add_child(this._desktopButton);

            // Spacer to push menu button to the right
            const spacer = new St.Widget({
                x_expand: true,
            });
            this._headerPanel.add_child(spacer);

            // Menu button (right side)
            const menuIcon = new St.Icon({
                icon_name: 'open-menu-symbolic',
                icon_size: 16,
                style_class: 'stage-manager-header-icon',
            });

            this._menuButton = new St.Button({
                style_class: 'stage-manager-header-button',
                child: menuIcon,
                reactive: true,
                can_focus: false,
                track_hover: true,
            });

            // Add tooltip
            this._menuButtonTooltip = new St.Label({
                style_class: 'tooltip',
                text: 'Menu',
                visible: false,
            });
            Main.uiGroup.add_child(this._menuButtonTooltip);

            this._menuButton.connect('enter-event', () => {
                const [x, y] = this._menuButton.get_transformed_position();
                const [width, height] = this._menuButton.get_size();
                this._menuButtonTooltip.set_position(x + width / 2 - this._menuButtonTooltip.width / 2, y + height + 5);
                this._menuButtonTooltip.show();
            });

            this._menuButton.connect('leave-event', () => {
                this._menuButtonTooltip.hide();
            });

            this._menuButton.connect('clicked', () => {
                this._menuButtonTooltip.hide();
                this._showHeaderMenu();
            });

            this._headerPanel.add_child(this._menuButton);

            // Add header to content container
            this._contentContainer.add_child(this._headerPanel);

            // Scroll view for thumbnails (takes remaining space)
            this._scrollView = new St.ScrollView({
                style_class: 'stage-manager-scroll',
                x_expand: true,
                y_expand: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });

            this._thumbnailBox = new St.BoxLayout({
                vertical: true,
                style_class: 'stage-manager-thumbnail-container',
                x_expand: true,
            });

            this._scrollView.add_child(this._thumbnailBox);
            this._contentContainer.add_child(this._scrollView);

            // Add content container to panel
            this.add_child(this._contentContainer);

            // Resize handle - inside the panel, aligned to the right edge
            this._resizeHandle = new St.BoxLayout({
                style_class: 'stage-manager-resize-handle',
                vertical: true,
                reactive: true,
                track_hover: true,
                width: this._resizeHandleWidth,
                x_expand: false,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
            });

            // Add grip dots to resize handle
            const gripContainer = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
                style_class: 'stage-manager-grip-container',
            });

            // Add 3 grip dots
            for (let i = 0; i < 3; i++) {
                const dot = new St.Widget({
                    style_class: 'stage-manager-grip-dot',
                    width: 4,
                    height: 4,
                });
                gripContainer.add_child(dot);
            }

            this._resizeHandle.add_child(gripContainer);
            this.add_child(this._resizeHandle);

            // Resize functionality
            this._setupResizing();
        }

        _applyThemeVariant() {
            // Get the interface settings to detect color scheme
            try {
                const settings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
                const colorScheme = settings.get_string('color-scheme');

                // Remove existing theme class
                this.remove_style_class_name('stage-manager-panel-light');

                // Apply light theme class if using light mode
                if (colorScheme === 'prefer-light') {
                    this.add_style_class_name('stage-manager-panel-light');
                }

                // Listen for theme changes
                this._themeChangedId = settings.connect('changed::color-scheme', () => {
                    const newScheme = settings.get_string('color-scheme');
                    this.remove_style_class_name('stage-manager-panel-light');
                    if (newScheme === 'prefer-light') {
                        this.add_style_class_name('stage-manager-panel-light');
                    }
                });

                this._interfaceSettings = settings;
            } catch (e) {
                log(`Error detecting theme: ${e}`);
            }
        }

        _setupResizing() {
            this._dragging = false;
            this._dragStartX = 0;
            this._dragStartWidth = 0;

            // Change cursor on hover (only if not already dragging)
            this._resizeHandle.connect('enter-event', () => {
                if (!this._dragging) {
                    try {
                        global.display.set_cursor(Meta.Cursor.CROSSHAIR);
                    } catch (e) {
                        log(`Error setting cursor: ${e}`);
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this._resizeHandle.connect('leave-event', () => {
                if (!this._dragging) {
                    try {
                        global.display.set_cursor(Meta.Cursor.DEFAULT);
                    } catch (e) {
                        log(`Error resetting cursor: ${e}`);
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this._resizeHandle.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    try {
                        // Store reference to current focus window before drag
                        this._focusWindowBeforeDrag = global.display.focus_window;

                        this._dragging = true;
                        [this._dragStartX] = event.get_coords();
                        this._dragStartWidth = this._panelWidth;

                        global.display.set_cursor(Meta.Cursor.CROSSHAIR);
                    } catch (e) {
                        log(`Error in button-press: ${e}`);
                        this._dragging = false;
                    }

                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Also handle button release on the resize handle itself
            this._resizeHandle.connect('button-release-event', (actor, event) => {
                if (event.get_button() === 1) {
                    if (this._dragging) {
                        this._endResize();
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Listen to motion on global stage when dragging
            this._stageMotionId = global.stage.connect('captured-event', (actor, event) => {
                if (!this._dragging) return Clutter.EVENT_PROPAGATE;

                if (event.type() === Clutter.EventType.MOTION) {
                    const [currentX] = event.get_coords();
                    const deltaX = currentX - this._dragStartX;
                    const newWidth = Math.min(MAX_PANEL_WIDTH,
                        Math.max(MIN_PANEL_WIDTH,
                            this._dragStartWidth + deltaX));

                    // Only update panel width during drag, don't adjust windows
                    this.setPanelWidth(newWidth);

                    return Clutter.EVENT_STOP;
                } else if (event.type() === Clutter.EventType.BUTTON_RELEASE &&
                    event.get_button() === 1) {
                    this._endResize();
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });
        }

        _endResize() {
            if (!this._dragging) return;

            this._dragging = false;

            try {
                global.display.set_cursor(Meta.Cursor.DEFAULT);
            } catch (e) {
                log(`Error resetting cursor on release: ${e}`);
            }

            try {
                // Save the new width to settings
                if (this._settings) {
                    this._settings.set_int('panel-width', this._panelWidth);
                }

                // Restore focus to the window that was active before drag and adjust it
                if (this._extension && this._extension._active && this._focusWindowBeforeDrag) {
                    const focusWindow = this._focusWindowBeforeDrag;
                    if (focusWindow && !focusWindow.skip_taskbar &&
                        focusWindow.get_window_type() === Meta.WindowType.NORMAL &&
                        focusWindow.get_maximized() === 0) {
                        // Re-activate the window to restore focus
                        this._activateWindow(focusWindow);
                        this._extension._adjustActiveWindow(focusWindow);
                    }
                }
                this._focusWindowBeforeDrag = null;
            } catch (e) {
                log(`Error in end resize: ${e}`);
            }
        }

        setPanelWidth(width) {
            this._panelWidth = width;
            this.set_width(width);

            // Update all thumbnails
            this._thumbnails.forEach(thumbnail => {
                thumbnail.updateSize(width, this._resizeHandleWidth);
            });
        }

        updateThumbnails() {
            try {
                // Clear existing thumbnails
                this._thumbnailBox.destroy_all_children();
                this._thumbnails = [];

                const workspace = global.workspace_manager.get_active_workspace();
                if (!workspace) return;

                const windows = workspace.list_windows().filter(w =>
                    w && !w.skip_taskbar && w.get_window_type() === Meta.WindowType.NORMAL
                );

                const focusWindow = global.display.focus_window;

                // Get accent color from settings
                const accentColor = this._getAccentColor();

                // Add thumbnails for all windows (including active one)
                windows.forEach(window => {
                    try {
                        const thumbnail = new WindowThumbnail(window, this._extension, this._panelWidth, this._resizeHandleWidth);
                        // Mark active window
                        if (window === focusWindow) {
                            thumbnail.add_style_class_name('stage-manager-thumbnail-active');
                            thumbnail.add_style_class_name(`accent-${accentColor}`);
                        }
                        this._thumbnailBox.add_child(thumbnail);
                        this._thumbnails.push(thumbnail);
                    } catch (e) {
                        log(`Error creating thumbnail for window: ${e}`);
                    }
                });
            } catch (e) {
                log(`Error updating thumbnails: ${e}`);
            }
        }

        _getAccentColor() {
            try {
                // Reuse the interface settings instance created in _applyThemeVariant
                if (!this._interfaceSettings) {
                    this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
                }
                const accentColor = this._interfaceSettings.get_string('accent-color');
                // Valid accent colors: blue, teal, green, yellow, orange, red, pink, purple, slate
                const validColors = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];
                if (validColors.includes(accentColor)) {
                    return accentColor;
                }
                return 'blue'; // Default fallback
            } catch (e) {
                log(`Error getting accent color: ${e}`);
                return 'blue';
            }
        }

        _showHeaderMenu() {
            // Close any existing menu
            if (this._headerMenu) {
                this._closeHeaderMenu();
                return;
            }

            this._headerMenu = new PopupMenu.PopupMenu(this._menuButton, 0.5, St.Side.BOTTOM);
            Main.uiGroup.add_child(this._headerMenu.actor);
            this._headerMenu.actor.hide();

            // Add Preferences option
            this._headerMenu.addAction('Preferences...', () => {
                if (this._extension) {
                    try {
                        // Check if preferences window is already open
                        const prefsWindow = this._extension._findPreferencesWindow();
                        if (prefsWindow) {
                            // If open, activate it and select its thumbnail
                            prefsWindow.unminimize();
                            prefsWindow.activate(global.get_current_time());
                        } else {
                            // If not open, open it
                            this._extension.openPreferences();
                        }
                    } catch (e) {
                        log(`Error opening preferences: ${e}`);
                    }
                }
                this._closeHeaderMenu();
            });

            // Close menu when it loses focus
            this._headerMenuOpenStateId = this._headerMenu.connect('open-state-changed', (menu, open) => {
                if (!open) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._closeHeaderMenu();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            // Close menu when clicking outside
            this._headerMenuCapturedEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [x, y] = event.get_coords();
                    const menuActor = this._headerMenu?.actor;
                    const buttonActor = this._menuButton;

                    if (menuActor && buttonActor) {
                        const [menuX, menuY] = menuActor.get_transformed_position();
                        const [menuWidth, menuHeight] = menuActor.get_size();
                        const [buttonX, buttonY] = buttonActor.get_transformed_position();
                        const [buttonWidth, buttonHeight] = buttonActor.get_size();

                        const isInsideMenu = x >= menuX && x <= menuX + menuWidth &&
                            y >= menuY && y <= menuY + menuHeight;
                        const isInsideButton = x >= buttonX && x <= buttonX + buttonWidth &&
                            y >= buttonY && y <= buttonY + buttonHeight;

                        if (!isInsideMenu && !isInsideButton) {
                            this._closeHeaderMenu();
                        }
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this._headerMenu.open();
        }

        _closeHeaderMenu() {
            if (this._headerMenu) {
                if (this._headerMenuOpenStateId) {
                    this._headerMenu.disconnect(this._headerMenuOpenStateId);
                    this._headerMenuOpenStateId = null;
                }
                if (this._headerMenuCapturedEventId) {
                    global.stage.disconnect(this._headerMenuCapturedEventId);
                    this._headerMenuCapturedEventId = null;
                }
                this._headerMenu.close(false);
                this._headerMenu.destroy();
                this._headerMenu = null;
            }
        }

        destroy() {
            try {
                // Close header menu if open
                this._closeHeaderMenu();

                // Remove tooltips
                if (this._closeButtonTooltip) {
                    Main.uiGroup.remove_child(this._closeButtonTooltip);
                    this._closeButtonTooltip.destroy();
                    this._closeButtonTooltip = null;
                }
                if (this._desktopButtonTooltip) {
                    Main.uiGroup.remove_child(this._desktopButtonTooltip);
                    this._desktopButtonTooltip.destroy();
                    this._desktopButtonTooltip = null;
                }
                if (this._menuButtonTooltip) {
                    Main.uiGroup.remove_child(this._menuButtonTooltip);
                    this._menuButtonTooltip.destroy();
                    this._menuButtonTooltip = null;
                }

                // Disconnect theme listener
                if (this._themeChangedId && this._interfaceSettings) {
                    this._interfaceSettings.disconnect(this._themeChangedId);
                    this._themeChangedId = null;
                    this._interfaceSettings = null;
                }

                // Disconnect stage handlers
                if (this._stageMotionId) {
                    global.stage.disconnect(this._stageMotionId);
                    this._stageMotionId = null;
                }

                this._dragging = false;
                this._extension = null;
                this._settings = null;
                this._thumbnails = [];

                if (this._resizeHandle) {
                    this._resizeHandle = null;
                }
            } catch (e) {
                log(`Error destroying panel: ${e}`);
            }
            super.destroy();
        }
    });

export default class ObisionExtensionGrid extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._active = false;
        this._originalFrames = new Map();
        this._previousFocusWindow = null;
        this._animatingWindows = new Set();
        this._windowHistory = []; // Track window focus history

        // Create stage manager panel
        this._panel = new StageManagerPanel(this);
        Main.layoutManager.addChrome(this._panel, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        this._panel.hide();

        // Position panel on the left
        this._updatePanelPosition();

        // Add keybinding to toggle stage manager
        Main.wm.addKeybinding(
            'toggle-grid',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this._toggleStageManager()
        );

        // Monitor for window changes
        this._windowCreatedId = global.display.connect('window-created', (display, window) => {
            if (this._active) {
                this._onWindowAdded(window);
            }
        });

        this._windowFocusId = global.display.connect('notify::focus-window', () => {
            if (this._active) {
                // Track window history for "go back" on close
                const focusWindow = global.display.focus_window;
                if (focusWindow && !focusWindow.skip_taskbar &&
                    focusWindow.get_window_type() === Meta.WindowType.NORMAL) {
                    // Remove if already in history, then add to end
                    this._windowHistory = this._windowHistory.filter(w => w !== focusWindow);
                    this._windowHistory.push(focusWindow);
                    // Keep only last 10 windows
                    if (this._windowHistory.length > 10) {
                        this._windowHistory.shift();
                    }
                }
                this._updateLayout();
            }
        });

        // Monitor window close to activate previous window
        // Connect to destroy signal on window actors
        this._setupWindowDestroyHandlers();

        // Also setup handlers when new windows are created
        this._windowCreatedForDestroyId = global.display.connect('window-created', (display, window) => {
            if (window && !window.skip_taskbar && window.get_window_type() === Meta.WindowType.NORMAL) {
                this._connectWindowDestroy(window);
            }
        });

        // Setup hot edge for showing panel when maximized
        this._setupHotEdge();

        // Monitor overview (Activities) to hide/show panel
        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this._active && this._panel) {
                this._panel.hide();
            }
        });

        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            if (this._active) {
                this._updateLayout();
            }
        });

        // Monitor all windows for size changes
        this._windowSizeChangedIds = [];
        global.get_window_actors().forEach(actor => {
            const metaWindow = actor.meta_window;
            if (metaWindow) {
                const id = metaWindow.connect('size-changed', () => {
                    if (this._active) {
                        this._updateLayout();
                    }
                });
                this._windowSizeChangedIds.push({ window: metaWindow, id: id });
            }
        });

        // Monitor size changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._updatePanelPosition();
            if (this._active) {
                this._updateLayout();
            }
        });

        // Activate Stage Manager automatically on startup
        this._activateStageManager();

        log('Obision One Win enabled');
    }

    disable() {
        try {
            // Disable stage manager if active
            if (this._active) {
                this._deactivateStageManager();
            }

            // Remove keybinding
            try {
                Main.wm.removeKeybinding('toggle-grid');
            } catch (e) {
                log(`Error removing keybinding: ${e}`);
            }

            // Disconnect signals
            if (this._windowCreatedId) {
                try {
                    global.display.disconnect(this._windowCreatedId);
                } catch (e) {
                    log(`Error disconnecting window-created: ${e}`);
                }
                this._windowCreatedId = null;
            }

            if (this._windowFocusId) {
                try {
                    global.display.disconnect(this._windowFocusId);
                } catch (e) {
                    log(`Error disconnecting focus-window: ${e}`);
                }
                this._windowFocusId = null;
            }

            if (this._windowCreatedForDestroyId) {
                try {
                    global.display.disconnect(this._windowCreatedForDestroyId);
                } catch (e) {
                    log(`Error disconnecting window-created-for-destroy: ${e}`);
                }
                this._windowCreatedForDestroyId = null;
            }

            // Clear window destroy handlers
            if (this._windowDestroyIds) {
                this._windowDestroyIds.forEach(({ actor, id }) => {
                    try {
                        if (actor) actor.disconnect(id);
                    } catch (e) { }
                });
                this._windowDestroyIds = [];
            }

            // Disconnect overview signals
            if (this._overviewShowingId) {
                try {
                    Main.overview.disconnect(this._overviewShowingId);
                } catch (e) { }
                this._overviewShowingId = null;
            }

            if (this._overviewHiddenId) {
                try {
                    Main.overview.disconnect(this._overviewHiddenId);
                } catch (e) { }
                this._overviewHiddenId = null;
            }

            if (this._windowSizeChangedIds) {
                this._windowSizeChangedIds.forEach(({ window, id }) => {
                    try {
                        if (window) {
                            window.disconnect(id);
                        }
                    } catch (e) {
                        log(`Error disconnecting window size-changed: ${e}`);
                    }
                });
                this._windowSizeChangedIds = [];
            }

            if (this._monitorsChangedId) {
                try {
                    Main.layoutManager.disconnect(this._monitorsChangedId);
                } catch (e) {
                    log(`Error disconnecting monitors-changed: ${e}`);
                }
                this._monitorsChangedId = null;
            }

            // Destroy panel
            if (this._panel) {
                try {
                    Main.layoutManager.removeChrome(this._panel);
                    this._panel.destroy();
                } catch (e) {
                    log(`Error destroying panel: ${e}`);
                }
                this._panel = null;
            }

            // Destroy hot edge
            this._destroyHotEdge();

            this._settings = null;
            this._originalFrames = null;

            log('Obision One Win disabled');
        } catch (e) {
            log(`Critical error in disable: ${e}`);
        }
    }

    _activateWindow(window) {
        if (window.minimized) {
            window.unminimize();
        }
        window.activate(global.get_current_time());
    }

    _findPreferencesWindow() {
        // Look for the preferences window by title or WM_CLASS
        const windows = global.get_window_actors().map(a => a.meta_window);
        return windows.find(w => {
            if (!w || w.skip_taskbar || w.get_window_type() !== Meta.WindowType.NORMAL) {
                return false;
            }
            const title = w.get_title() || '';
            const wmClass = w.get_wm_class() || '';
            // Preferences window typically has "Preferences" in title or is the extension prefs
            return title.includes('Preferences') ||
                title.includes('obision-extension-one-win') ||
                wmClass.includes('org.gnome.Shell.Extensions');
        });
    }

    _showDesktop() {
        try {
            // Get all normal windows
            const windows = global.get_window_actors()
                .map(a => a.meta_window)
                .filter(w => w && !w.skip_taskbar && w.get_window_type() === Meta.WindowType.NORMAL);

            // Minimize all windows
            windows.forEach(window => {
                try {
                    if (!window.minimized) {
                        window.minimize();
                    }
                } catch (e) {
                    log(`Error minimizing window in showDesktop: ${e}`);
                }
            });

            // Hide the panel
            this._hidePanelAnimated();
        } catch (e) {
            log(`Error in showDesktop: ${e}`);
        }
    }

    _toggleStageManager() {
        if (this._active) {
            this._deactivateStageManager();
        } else {
            this._activateStageManager();
        }
    }

    _activateStageManager() {
        this._active = true;
        this._updatePanelPosition(); // Recalculate panel position with dash height
        this._panel.show();
        this._updateLayout();
    }

    _deactivateStageManager() {
        this._active = false;
        this._panel.hide();
        this._restoreWindowFrames();
    }

    _updatePanelPosition() {
        try {
            if (!this._panel) return;

            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;

            const panelHeight = this._getDashPanelHeight();

            // Position panel below top dash/panel
            this._panel.set_position(monitor.x, monitor.y + panelHeight.top);
            // Adjust height to fit between top and bottom panels
            this._panel.set_height(monitor.height - panelHeight.top - panelHeight.bottom);
        } catch (e) {
            log(`Error updating panel position: ${e}`);
        }
    }

    _showPanelAnimated() {
        if (!this._panel || this._panel.visible) return;

        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;

            const panelHeight = this._getDashPanelHeight();
            const normalX = monitor.x;
            const hiddenX = normalX - this._panel._panelWidth;

            // Start hidden to the left
            this._panel.set_position(hiddenX, monitor.y + panelHeight.top);
            this._panel.show();

            // Slide in from left (same animation as unmaximize)
            this._panel.ease({
                x: normalX,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } catch (e) {
            log(`Error showing panel: ${e}`);
        }
    }

    _hidePanelAnimated() {
        if (!this._panel || !this._panel.visible) return;

        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;

            const hiddenX = monitor.x - this._panel._panelWidth;

            // Maximize active window when hiding panel
            const focusWindow = global.display.focus_window;
            if (focusWindow && !focusWindow.skip_taskbar &&
                focusWindow.get_window_type() === Meta.WindowType.NORMAL &&
                focusWindow.get_maximized() === 0) {
                focusWindow.maximize(Meta.MaximizeFlags.BOTH);
            }

            // Slide out to the left (same animation as maximize)
            this._panel.ease({
                x: hiddenX,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._panel) {
                        this._panel.hide();
                    }
                },
            });
        } catch (e) {
            log(`Error hiding panel: ${e}`);
        }
    }

    _updateLayout() {
        if (!this._active) return;

        try {
            const workspace = global.workspace_manager.get_active_workspace();
            if (!workspace) return;

            // Get all normal windows
            const windows = workspace.list_windows().filter(w =>
                w && !w.skip_taskbar && w.get_window_type() === Meta.WindowType.NORMAL
            );

            // If no windows, hide panel
            if (windows.length === 0) {
                this._hidePanelAnimated();
                return;
            }

            const focusWindow = global.display.focus_window;

            // Check if window is maximized (either horizontally, vertically, or both)
            if (focusWindow && focusWindow.get_maximized() !== 0) {
                this._hidePanelAnimated();
                return;
            } else {
                this._showPanelAnimated();
            }

            // Update thumbnails in panel
            if (this._panel) {
                this._panel.updateThumbnails();
            }

            // Resize and reposition active window
            if (focusWindow && !focusWindow.skip_taskbar &&
                focusWindow.get_window_type() === Meta.WindowType.NORMAL) {
                this._adjustActiveWindow(focusWindow);
            }

            // Update previous focus window reference
            if (focusWindow && !focusWindow.skip_taskbar &&
                focusWindow.get_window_type() === Meta.WindowType.NORMAL) {
                this._previousFocusWindow = focusWindow;
            }

            // Minimize or hide other windows
            // Don't minimize if header menu is open (it can steal focus temporarily)
            const isHeaderMenuOpen = this._panel?._headerMenu !== null && this._panel?._headerMenu !== undefined;

            if (!isHeaderMenuOpen) {
                windows.forEach(window => {
                    try {
                        if (window !== focusWindow) {
                            // Keep them on workspace but not visible in main area
                            window.minimize();
                        }
                    } catch (e) {
                        log(`Error minimizing window: ${e}`);
                    }
                });
            }
        } catch (e) {
            log(`Error updating layout: ${e}`);
        }
    }

    _adjustActiveWindow(window) {
        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor || !this._panel) return;

            // Panel width already includes the resize handle (it's inside the panel)
            const totalPanelWidth = this._panel._panelWidth;

            // Save original frame if not already saved
            if (!this._originalFrames.has(window)) {
                this._originalFrames.set(window, window.get_frame_rect());
            }

            // Detect dash/panel height (top or bottom)
            const panelHeight = this._getDashPanelHeight();

            // Calculate new frame for active window - flush with panel (no gap)
            const newX = monitor.x + totalPanelWidth;
            const newY = monitor.y + panelHeight.top;
            const newWidth = monitor.width - totalPanelWidth;
            const newHeight = monitor.height - panelHeight.top - panelHeight.bottom;

            // Move and resize window
            window.unmaximize(Meta.MaximizeFlags.BOTH);
            window.move_resize_frame(false, newX, newY, newWidth, newHeight);
        } catch (e) {
            log(`Error adjusting active window: ${e}`);
        }
    }

    _restoreWindowFrames() {
        try {
            // Restore all windows to their original positions
            this._originalFrames.forEach((frame, window) => {
                try {
                    // Check if window still exists by trying to get its frame
                    if (window) {
                        window.get_frame_rect(); // This will throw if window is destroyed
                        window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
                        if (window.minimized) {
                            window.unminimize();
                        }
                    }
                } catch (e) {
                    // Window is likely destroyed, ignore
                }
            });
            this._originalFrames.clear();
        } catch (e) {
            log(`Error in restoreWindowFrames: ${e}`);
        }
    }

    _onWindowAdded(window) {
        if (!window.skip_taskbar && window.get_window_type() === Meta.WindowType.NORMAL) {
            // Add size-changed listener to new window
            const id = window.connect('size-changed', () => {
                if (this._active) {
                    this._updateLayout();
                }
            });

            if (!this._windowSizeChangedIds) {
                this._windowSizeChangedIds = [];
            }
            this._windowSizeChangedIds.push({ window: window, id: id });

            // Connect destroy handler for new window
            this._connectWindowDestroy(window);

            // If no window is currently focused, activate this new window
            const focusWindow = global.display.focus_window;
            if (!focusWindow || focusWindow.skip_taskbar ||
                focusWindow.get_window_type() !== Meta.WindowType.NORMAL) {
                // Delay activation to let window initialize
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    try {
                        if (window) {
                            this._activateWindow(window);
                        }
                    } catch (e) { }
                    return GLib.SOURCE_REMOVE;
                });
            }

            // Scroll to top when new window is added
            if (this._panel && this._panel._scrollView) {
                try {
                    const vscroll = this._panel._scrollView.vscroll;
                    if (vscroll && vscroll.adjustment) {
                        vscroll.adjustment.set_value(0);
                    }
                } catch (e) {
                    log(`Error scrolling to top: ${e}`);
                }
            }

            this._updateLayout();
        }
    }

    _cleanupWindowHistory() {
        // Remove destroyed windows from history
        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return;

        const validWindows = workspace.list_windows().filter(w =>
            w && !w.skip_taskbar && w.get_window_type() === Meta.WindowType.NORMAL
        );

        // Filter history to keep only valid windows
        this._windowHistory = this._windowHistory.filter(w => validWindows.includes(w));

        // Also clean up original frames
        this._originalFrames.forEach((frame, window) => {
            if (!validWindows.includes(window)) {
                this._originalFrames.delete(window);
            }
        });
    }

    _setupWindowDestroyHandlers() {
        this._windowDestroyIds = [];

        // Connect to existing windows
        global.get_window_actors().forEach(actor => {
            const metaWindow = actor.meta_window;
            if (metaWindow && !metaWindow.skip_taskbar &&
                metaWindow.get_window_type() === Meta.WindowType.NORMAL) {
                this._connectWindowDestroy(metaWindow);
            }
        });
    }

    _connectWindowDestroy(window) {
        if (!window) return;

        const actor = window.get_compositor_private();
        if (!actor) return;

        // Check if already connected
        if (this._windowDestroyIds &&
            this._windowDestroyIds.some(item => item.window === window)) {
            return;
        }

        const id = actor.connect('destroy', () => {
            this._onWindowDestroyed(window);
        });

        if (!this._windowDestroyIds) {
            this._windowDestroyIds = [];
        }
        this._windowDestroyIds.push({ window, actor, id });
    }

    _onWindowDestroyed(closedWindow) {
        if (!this._active) return;

        // Remove closed window from history
        this._windowHistory = this._windowHistory.filter(w => w !== closedWindow);

        // Remove from original frames
        this._originalFrames.delete(closedWindow);

        // Remove from destroy handlers
        if (this._windowDestroyIds) {
            this._windowDestroyIds = this._windowDestroyIds.filter(item => item.window !== closedWindow);
        }

        // Delay to let GNOME process the window close
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (!this._active) return GLib.SOURCE_REMOVE;

            // Force update thumbnails
            if (this._panel) {
                this._panel.updateThumbnails();

                // Scroll to top
                if (this._panel._scrollView) {
                    try {
                        const vscroll = this._panel._scrollView.vscroll;
                        if (vscroll && vscroll.adjustment) {
                            vscroll.adjustment.set_value(0);
                        }
                    } catch (e) {
                        log(`Error scrolling to top: ${e}`);
                    }
                }
            }

            // Check remaining windows
            const workspace = global.workspace_manager.get_active_workspace();
            if (!workspace) return GLib.SOURCE_REMOVE;

            const windows = workspace.list_windows().filter(w =>
                w && !w.skip_taskbar && w.get_window_type() === Meta.WindowType.NORMAL
            );

            if (windows.length === 0) {
                // No more windows - hide panel
                this._hidePanelAnimated();
                return GLib.SOURCE_REMOVE;
            }

            // Activate the previous window in history
            if (this._windowHistory.length > 0) {
                const previousWindow = this._windowHistory[this._windowHistory.length - 1];
                try {
                    // Verify window still exists
                    if (windows.includes(previousWindow)) {
                        this._activateWindow(previousWindow);
                    } else {
                        // Window in history no longer exists, activate the first available
                        const firstWindow = windows[0];
                        this._activateWindow(firstWindow);
                    }
                } catch (e) {
                    log(`Error activating previous window: ${e}`);
                }
            } else if (windows.length > 0) {
                // No history but have windows - activate first
                const firstWindow = windows[0];
                try {
                    this._activateWindow(firstWindow);
                } catch (e) {
                    log(`Error activating first window: ${e}`);
                }
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _setupHotEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        // Create invisible trigger area on the left edge
        this._hotEdge = new St.Widget({
            reactive: true,
            can_focus: false,
            track_hover: true,
            width: 1,
            height: monitor.height,
        });

        Main.layoutManager.addChrome(this._hotEdge, {
            affectsStruts: false,
            trackFullscreen: false,
        });

        this._hotEdge.set_position(monitor.x, monitor.y);

        this._hotEdge.connect('enter-event', () => {
            // If Stage Manager is not active, activate it
            if (!this._active) {
                this._activateStageManager();
                return Clutter.EVENT_PROPAGATE;
            }

            const focusWindow = global.display.focus_window;
            // Only show panel if current window is maximized or if panel is hidden
            if (focusWindow && focusWindow.get_maximized() !== 0) {
                // Unmaximize and show panel
                focusWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                this._showPanelAnimated();
                this._adjustActiveWindow(focusWindow);
                this._panel.updateThumbnails();
            } else if (this._panel && !this._panel.visible) {
                // Panel is hidden but Stage Manager is active, show it
                this._showPanelAnimated();
                if (focusWindow) {
                    this._adjustActiveWindow(focusWindow);
                }
                this._panel.updateThumbnails();
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }

    _destroyHotEdge() {
        if (this._hotEdge) {
            Main.layoutManager.removeChrome(this._hotEdge);
            this._hotEdge.destroy();
            this._hotEdge = null;
        }
    }

    _getDashPanelHeight() {
        const result = { top: 0, bottom: 0 };
        const monitor = Main.layoutManager.primaryMonitor;

        // Search through all chrome actors to find panels
        // This works for Dash to Panel and other panel extensions
        Main.layoutManager._trackedActors.forEach(obj => {
            const actor = obj.actor;
            if (!actor || !actor.visible) return;

            const height = actor.height;
            const y = actor.y;
            const width = actor.width;

            // Look for wide actors that span most of the screen (likely panels)
            // Panels are typically at least 80% of screen width and have reasonable height
            const isWideEnough = width >= monitor.width * 0.8;
            const hasReasonableHeight = height > 20 && height < 200;

            if (isWideEnough && hasReasonableHeight) {
                log(`[Stage Manager] Panel-like actor found: ${actor.name}, y=${y}, height=${height}, width=${width}`);

                // Determine if panel is at top or bottom based on position
                if (y <= monitor.y + 50) {
                    result.top = Math.max(result.top, height);
                } else if (y >= monitor.y + monitor.height - height - 50) {
                    result.bottom = Math.max(result.bottom, height);
                }
            }
        });

        log(`[Stage Manager] Final panel heights - top: ${result.top}, bottom: ${result.bottom}`);
        return result;
    }
}
