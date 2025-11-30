import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ObisionExtensionGridPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        // Display Options Group
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display Options',
            description: 'Configure how the grid is displayed',
        });
        page.add(displayGroup);

        // Panel Position
        const panelPositionRow = new Adw.ComboRow({
            title: 'Panel Position',
            subtitle: 'Position of the window panel',
        });
        const positionModel = new Gtk.StringList();
        positionModel.append('Left');
        positionModel.append('Right');
        panelPositionRow.set_model(positionModel);
        panelPositionRow.set_selected(settings.get_string('panel-position') === 'left' ? 0 : 1);
        panelPositionRow.connect('notify::selected', () => {
            settings.set_string('panel-position', panelPositionRow.get_selected() === 0 ? 'left' : 'right');
        });
        displayGroup.add(panelPositionRow);

        // Auto-hide Inactive Windows
        const autoHideRow = new Adw.SwitchRow({
            title: 'Minimize Inactive Windows',
            subtitle: 'Automatically minimize windows not shown in the panel',
        });
        displayGroup.add(autoHideRow);
        settings.bind(
            'auto-minimize',
            autoHideRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Show App Names
        const showAppNamesRow = new Adw.SwitchRow({
            title: 'Show Application Names',
            subtitle: 'Display app names below thumbnails',
        });
        displayGroup.add(showAppNamesRow);
        settings.bind(
            'show-app-names',
            showAppNamesRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Keyboard Shortcuts Group
        const shortcutsGroup = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Configure keyboard shortcuts',
        });
        page.add(shortcutsGroup);

        // Toggle Stage Manager Shortcut
        const getShortcutText = () => {
            try {
                const shortcuts = settings.get_strv('toggle-grid');
                return (shortcuts && shortcuts.length > 0) ? shortcuts[0] : '<Super>g';
            } catch (e) {
                return '<Super>g';
            }
        };
        
        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle Stage Manager',
            subtitle: getShortcutText(),
        });
        
        const shortcutButton = new Gtk.Button({
            label: 'Set Shortcut',
            valign: Gtk.Align.CENTER,
        });
        shortcutButton.connect('clicked', () => {
            this._showShortcutDialog(window, settings, shortcutRow);
        });
        shortcutRow.add_suffix(shortcutButton);
        shortcutsGroup.add(shortcutRow);
    }

    _showShortcutDialog(window, settings, row) {
        const dialog = new Adw.MessageDialog({
            heading: 'Set Keyboard Shortcut',
            body: 'Press the key combination you want to use',
            transient_for: window,
            modal: true,
        });

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('clear', 'Clear');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (controller, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            
            if (keyval && mask) {
                try {
                    const shortcut = Gtk.accelerator_name(keyval, mask);
                    if (shortcut) {
                        settings.set_strv('toggle-grid', [shortcut]);
                        row.subtitle = shortcut;
                        dialog.close();
                        return true;
                    }
                } catch (e) {
                    log(`Error setting shortcut: ${e}`);
                }
            }
            return false;
        });
        dialog.add_controller(controller);

        dialog.connect('response', (dialog, response) => {
            if (response === 'clear') {
                try {
                    settings.set_strv('toggle-grid', ['<Super>g']);
                    row.subtitle = '<Super>g';
                } catch (e) {
                    log(`Error setting shortcut: ${e}`);
                }
            }
            dialog.close();
        });

        dialog.present();
    }
}
