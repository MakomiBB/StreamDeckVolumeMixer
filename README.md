# Stream Deck Volume Mixer

Windows volume mixer plugin for `Elgato Stream Deck +`.

The plugin adds encoder-based per-application volume control with two usage modes:

- `App Volume`
  Control a specific selected application.
- `Active Window Volume`
  Follow the currently focused app and keep a stable audio target during app switching.

## Features

- Per-app Windows audio session control.
- Touch strip feedback with:
  - app icon
  - app name
  - volume percentage
  - volume bar
- Dial actions:
  - rotate = adjust volume
  - press = toggle mute
  - touch = reset to `100%`
  - long touch = set to `0%`
- Handles multi-session apps such as `Discord`, `Chrome`, and `Steam`.
- Fallback logic for launchers, overlays, and game-like surfaces.
- Improved sticky game detection validated against `Helldivers 2`.
- Ignore-list support for `Active Window Volume`.
- `Ignore current` button in the Active Window property inspector.

## Install

Download the release asset:

- `com.makomi.volumemixer.sdPlugin-<version>.streamDeckPlugin`

Then install it by double-clicking the `.streamDeckPlugin` file.

## Actions

### App Volume

Use this when you want one encoder permanently bound to a chosen application.

Property inspector:

- select target application
- adjust encoder sensitivity

### Active Window Volume

Use this when you want the encoder to follow the currently focused app.

Property inspector:

- adjust encoder sensitivity
- configure ignored processes
- use `Ignore current` to quickly exclude the current foreground app

Default ignored terminal-style processes:

- `powershell`
- `pwsh`
- `windowsterminal`
- `cmd`
- `conhost`

## Build

From `com.makomi.volumemixer.sdPlugin`:

```powershell
npm install
npm run build
```

Build native helper and plugin bundle:

```powershell
npm run build:all
```

## Package

Create the installable plugin package:

```powershell
npm run package:plugin
```

The packaging script writes the installer to the project root:

- `com.makomi.volumemixer.sdPlugin-<version>.streamDeckPlugin`

## Local Development

For direct folder-based testing, copy:

- `com.makomi.volumemixer.sdPlugin`

to:

```text
%APPDATA%\Elgato\StreamDeck\Plugins\
```

Then restart `Elgato Stream Deck`.

## Debug Logging

During detection debugging, the plugin writes a log to:

```text
%TEMP%\focused-app-volume-debug.log
```

The `Active Window Volume` property inspector also shows the current log path.

Useful resolution reasons in the log:

- `foreground-match`
- `launcher-game-fallback`
- `cached-game`
- `cached-audio`
- `no-match`

## Tech Notes

- Platform: `Windows`
- Device target: `Stream Deck +`
- Stream Deck minimum version: `6.4`
- Node runtime in manifest: `20`
- Native helper: `native/bin/VolumeControllerHelper2.exe`
