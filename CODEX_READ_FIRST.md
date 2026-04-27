# CODEX: READ THIS FIRST

This file is for Codex first-pass project context. Read this before exploring the repo.

## Project

Focused App Volume Control plugin for Elgato Stream Deck Plus.

Purpose:
- Control Windows per-app volume with encoder dials.
- Support two modes:
  - fixed selected app
  - active window auto-follow

Main plugin folder:
- `com.makomi.volumemixer.sdPlugin`

## Architecture

- `manifest.json`
  - declares 2 encoder actions:
    - `com.makomi.volumemixer.appvolume`
    - `com.makomi.volumemixer.activewindow`
- `src/plugin.ts`
  - registers both actions
- `src/actions/app-volume.action.ts`
  - selected app volume control
- `src/actions/active-window-volume.action.ts`
  - active window detection and fallback heuristics
- `src/services/audio-service.ts`
  - Node wrapper around native helper over JSON lines stdin/stdout
- `native/VolumeController.cs`
  - Windows WASAPI + foreground window helper
- `layouts/volume.json`
  - Stream Deck Plus touch-strip feedback layout
- `ui/app-volume.html`
  - property inspector for selected app
- `ui/active-window.html`
  - property inspector for active window mode

## Build / Deploy

From `com.makomi.volumemixer.sdPlugin`:

```powershell
npm run build
```

Full build including native helper:

```powershell
npm run build:all
```

Local install path:

```text
%APPDATA%\Elgato\StreamDeck\Plugins\com.makomi.volumemixer.sdPlugin
```

Important:
- TS bundle output is `bin/plugin.js`
- active native helper in use is:
  - `native/bin/VolumeControllerHelper2.exe`
- old helper exes may still exist in `native/bin`, but current code uses `Helper2`

## Current State

Active development area:
- `Active Window Volume` detection logic was heavily revised
- main target app during debugging was `Helldivers 2`
- `Telegram Portable` regression was also part of the original problem set

What is implemented now:
- better process-name alias matching
- wrapper/process suffix handling:
  - `portable`
  - `launcher`
  - `overlay`
  - `helper`
  - `client`
- scored candidate session matching instead of first-match selection
- launcher / overlay game fallback
- sticky cached audio target
- dedicated sticky cached game target
- default ignored terminal processes:
  - `powershell`
  - `pwsh`
  - `windowsterminal`
  - `cmd`
  - `conhost`
- user-configurable ignore list in `ui/active-window.html`
- `Ignore current` button in property inspector
- debug logging for:
  - foreground changes
  - audio session snapshots
  - final target-resolution decisions

Important real bug already confirmed and fixed with logs:
- the plugin was not losing `helldivers2.exe` from audio sessions
- instead, it could fall back to `cached-audio = chrome`
- fix:
  - `cached-game` now has priority over generic `cached-audio` as long as the game session is still alive

Current observed good state:
- recent logs showed `cached-game` repeatedly resolving to `helldivers2.exe`
- this held even when foreground was `WindowsTerminal.exe` or `null`
- this is the currently validated direction for `Helldivers 2`

Deployment status:
- updated plugin files were synced into `%APPDATA%` install folder
- Stream Deck and helper were stopped so `VolumeControllerHelper2.exe` could be replaced cleanly
- after sync, Stream Deck is typically relaunched immediately

## Practical Notes

- If detection breaks again, inspect active-window matching first.
- The most fragile logic is in:
  - `src/actions/active-window-volume.action.ts`
- current helper files for debugging:
  - `src/services/debug-log.ts`
  - `src/services/audio-service.ts`
- If behavior differs by app, compare:
  - foreground process name
  - foreground window title
  - audio session `name`
  - audio session `displayName`
  - audio session `windowTitle`
- current debug log path:
  - `%TEMP%\focused-app-volume-debug.log`
- the property inspector for `Active Window Volume` displays the current debug log path
- when reviewing logs, focus on `reason` values:
  - `foreground-match`
  - `launcher-game-fallback`
  - `cached-game`
  - `cached-audio`
  - `no-match`

## User Preferences / Workflow

- User actively tests against real Stream Deck installation.
- After code changes, syncing to `%APPDATA%` plugin folder is often useful.
- After syncing, launch `Elgato Stream Deck` automatically.
- If sync fails on locked files, stop:
  - `StreamDeck`
  - `VolumeControllerHelper2`

## Read Order

When returning to this repo, start with:
1. `CODEX_READ_FIRST.md`
2. `com.makomi.volumemixer.sdPlugin/src/actions/active-window-volume.action.ts`
3. `com.makomi.volumemixer.sdPlugin/src/services/audio-service.ts`
4. `com.makomi.volumemixer.sdPlugin/src/services/debug-log.ts`
5. `com.makomi.volumemixer.sdPlugin/ui/active-window.html`
6. `com.makomi.volumemixer.sdPlugin/native/VolumeController.cs`
