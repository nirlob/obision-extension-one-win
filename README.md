# Obision One Win

A Stage Manager-style window management extension for GNOME Shell with live thumbnail previews and side panel navigation.

## Features

- **Stage Manager Mode**: macOS-inspired window management with live thumbnails
- **Side Panel**: Displays live thumbnails of all windows with real-time updates
- **Active Window Area**: Main workspace for the focused application
- **Real-time Window Clones**: Thumbnail previews using compositor textures
- **Quick Switching**: Click any thumbnail to activate that window
- **Keyboard Shortcut**: Toggle Stage Manager with `Super+G` (configurable)
- **Resizable Panel**: Drag the resize handle to adjust panel width
- **Theme Integration**: Automatic light/dark theme detection with GNOME accent colors
- **Auto-minimize**: Optionally minimize inactive windows
- **Hot Edge**: Hover over left edge when maximized to reveal panel
- **Preferences UI**: Complete settings panel with Adwaita design

## Installation

### From DEB Package (Recommended)

Download the latest `.deb` package from [GitHub Releases](https://github.com/nirlob/obision-extension-one-win/releases) and install:

```bash
sudo dpkg -i obision-extension-one-win.deb
sudo apt-get install -f
```

Then restart GNOME Shell:
- **X11**: Press `Alt+F2`, type `r`, press Enter
- **Wayland**: Log out and log back in

Enable the extension:
```bash
gnome-extensions enable obision-extension-one-win@obision.com
```

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/nirlob/obision-extension-one-win.git
   cd obision-extension-one-win
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build and install the extension:
   ```bash
   npm run build
   npm run install-extension
   ```

4. Enable the extension:
   ```bash
   gnome-extensions enable obision-extension-one-win@obision.com
   ```

5. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

## Development

### Project Structure

```
obision-extension-one-win/
├── extension.js            # Main extension code with GObject classes
├── prefs.js                # Preferences UI with Adwaita widgets
├── stylesheet.css          # Theme-aware styles
├── metadata.json           # Extension metadata
├── schemas/                # GSettings schemas
│   └── com.obision.extension-one-win.gschema.xml
├── debian/                 # Debian packaging files
│   ├── control
│   ├── rules
│   ├── changelog
│   └── copyright
├── scripts/                # Build and release scripts
│   ├── build.sh
│   ├── reload.sh
│   └── release.sh
├── .github/workflows/      # GitHub Actions CI/CD
│   └── release.yml
└── package.json            # npm scripts and dev dependencies
```

### Building

Build the extension package:
```bash
npm run build
```

Build DEB package:
```bash
npm run deb-build
```

### Linting & Formatting

Run ESLint to check code quality:
```bash
npm run lint
```

Fix linting issues automatically:
```bash
npm run lint:fix
```

Format code with Prettier:
```bash
npm run format
```

Check formatting:
```bash
npm run format:check
```

### Quick Deploy

Build, install, and show instructions:
```bash
npm run deploy
```

Update and reload (X11 only):
```bash
npm run update
```

### Testing

After making changes, reload the extension:
```bash
npm run reload
```

Or manually:
```bash
gnome-extensions disable obision-extension-one-win@obision.com
gnome-extensions enable obision-extension-one-win@obision.com
```

View logs in real-time:
```bash
npm run logs
```

### Creating a Release

To create a new release with automatic version bumping:

```bash
npm run release
```

This will:
1. Increment the minor version (e.g., 1.0.0 → 1.1.0)
2. Update `package.json`, `metadata.json`, and `debian/changelog`
3. Create a git commit and tag
4. Push to GitHub, triggering automatic DEB package build and GitHub release

## Configuration

Open the extension preferences:
```bash
gnome-extensions prefs obision-extension-one-win@obision.com
```

Available settings:
- **Panel Width**: Width of the side panel (150-700px, resizable with drag handle)
- **Panel Position**: Display panel on left or right side
- **Auto-minimize**: Minimize windows not shown in panel
- **Show App Names**: Display application names below thumbnails
- **Toggle Shortcut**: Keyboard shortcut (default: `Super+G`)

## Usage

1. Stage Manager activates automatically on login
2. The side panel shows live thumbnails of all windows
3. The focused window is displayed in the main area
4. **Single click** a thumbnail to activate that window
5. **Double click** a thumbnail to activate and maximize
6. **Right click** a thumbnail for context menu (new window, close, etc.)
7. Press `Super+G` to toggle Stage Manager on/off
8. Drag the resize handle on the panel to adjust width

**Window Management:**
- Click close button (×) on thumbnail to close window
- Inactive windows are automatically minimized
- Active window automatically resizes to fit available space
- When maximized, hover left edge to reveal panel
- Panel auto-hides when no windows are open

**Theme Integration:**
- Automatic light/dark theme detection
- Active window border uses GNOME accent color
- Supports all GNOME accent colors (blue, teal, green, yellow, orange, red, pink, purple, slate)

## Requirements

- GNOME Shell 48 or later
- GLib 2.0
- For DEB package building: `debhelper`, `devscripts`, `gnome-shell-common`
- For development: Node.js, npm

## npm Scripts Reference

**Building:**
- `npm run build` - Compile schemas and pack extension
- `npm run compile-schemas` - Compile GSettings schemas only
- `npm run pack` - Create extension package
- `npm run deb-build` - Build Debian package

**Installation:**
- `npm run install-extension` - Install extension to system
- `npm run enable` - Enable the extension
- `npm run deploy` - Build + install + show instructions
- `npm run deb-install` - Install DEB package

**Development:**
- `npm run update` - Build + install + reload (X11 only)
- `npm run reload` - Reload extension without rebuilding
- `npm run logs` - View GNOME Shell logs in real-time
- `npm run clean` - Remove build artifacts

**Code Quality:**
- `npm run lint` - Check code with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check formatting

**Release:**
- `npm run release` - Create new release (bump version, tag, push)

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting: `npm run lint`
5. Run formatting: `npm run format`
6. Test the extension thoroughly
7. Submit a pull request

## License

GPL-3.0

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/nirlob/obision-extension-one-win/issues).
