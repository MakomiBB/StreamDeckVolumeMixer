# Volume Mixer Stream Deck Plus Plugin

Stream Deck Plus plugin for controlling Windows per-application volume with encoder dials.

## Features

- Control a selected application's Windows audio session.
- Control the currently active application's audio session.
- Shows app icon, app name, percentage, and a volume bar on the Stream Deck Plus touch strip.
- Press dial to toggle mute.
- Touch to reset to 100%.
- Long touch to set volume to 0%.
- Handles multi-session apps such as Discord, Chrome, Steam, and similar apps.
- Fallback logic for games and launchers/overlays, including Steam/Epic/EA/Battle.net/Riot/Ubisoft/Xbox Game Bar style cases.

## Build

From `com.makomi.volumemixer.sdPlugin`:

```powershell
npm install
npm run build:all
```

`build:all` builds the native Windows audio helper with the .NET Framework C# compiler and bundles the TypeScript plugin with Rollup.

## Install For Local Testing

Copy `com.makomi.volumemixer.sdPlugin` into:

```text
%APPDATA%\Elgato\StreamDeck\Plugins\
```

Then restart Stream Deck.
