#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the Volume Mixer plugin for Stream Deck Plus.

.PARAMETER Install
  After building, copies the plugin folder into Stream Deck's Plugins directory
  and restarts the Stream Deck software.
#>
param([switch]$Install)

$ErrorActionPreference = "Stop"
$pluginId  = "com.makomi.volumemixer"
$pluginDir = "$PSScriptRoot\$pluginId.sdPlugin"

function Step  ($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok    ($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Warn  ($t) { Write-Host "  WARN $t" -ForegroundColor Yellow }
function Fail  ($t) { Write-Host "  ERR  $t" -ForegroundColor Red; exit 1 }

# ── Prerequisites ─────────────────────────────────────────────────────────────
Step "Checking prerequisites…"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { Fail ".NET Framework 4.8 not found at $csc" }
Ok ".NET Framework 4.8 csc.exe found"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  Node.js is not installed." -ForegroundColor Red
    Write-Host "  Install it with winget (run in any terminal):" -ForegroundColor Yellow
    Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    Write-Host "  Then restart this terminal and re-run build.ps1."
    exit 1
}
Ok "node $(& node --version)"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found (comes with Node.js)" }
Ok "npm  $(& npm  --version)"

# ── Build VolumeController.exe ────────────────────────────────────────────────
Step "[1/3] Compiling native audio helper (no SDK required)…"

$nativeBin = "$pluginDir\native\bin"
New-Item -ItemType Directory -Force -Path $nativeBin | Out-Null

& $csc `
    /target:exe `
    /platform:x64 `
    /optimize+ `
    /out:"$nativeBin\VolumeController.exe" `
    /reference:System.dll `
    "$pluginDir\native\VolumeController.cs"

if ($LASTEXITCODE -ne 0) { Fail "C# compilation failed" }
Ok "VolumeController.exe → native\bin\"

# ── Install npm packages ───────────────────────────────────────────────────────
Step "[2/3] Installing npm packages…"

Push-Location $pluginDir
try {
    npm install --prefer-offline
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
    Ok "node_modules ready"
} finally { Pop-Location }

# ── Bundle TypeScript → bin/plugin.js ────────────────────────────────────────
Step "[3/3] Bundling TypeScript plugin…"

Push-Location $pluginDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "rollup build failed" }
    Ok "bin\plugin.js ready"
} finally { Pop-Location }

# ── Optional: install into Stream Deck ───────────────────────────────────────
if ($Install) {
    Step "Installing into Stream Deck…"

    $sdPlugins = "$env:APPDATA\Elgato\StreamDeck\Plugins"
    if (-not (Test-Path $sdPlugins)) { Fail "Stream Deck plugins dir not found: $sdPlugins" }

    $dest = "$sdPlugins\$pluginId.sdPlugin"

    # Stop Stream Deck so files are not locked
    $sdProcess = Get-Process -Name "Stream Deck" -ErrorAction SilentlyContinue
    if ($sdProcess) {
        Warn "Stopping Stream Deck…"
        $sdProcess | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Copy-Item -Recurse $pluginDir $dest
    Ok "Installed → $dest"

    # Restart Stream Deck
    $sdExe = "${env:ProgramFiles}\Elgato\StreamDeck\StreamDeck.exe"
    if (Test-Path $sdExe) {
        Start-Process $sdExe
        Ok "Stream Deck restarted"
    } else {
        Warn "Could not find StreamDeck.exe – please restart Stream Deck manually"
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host ""
if (-not $Install) {
    Write-Host "To install, re-run:  .\build.ps1 -Install" -ForegroundColor White
    Write-Host "Or copy manually:    $pluginId.sdPlugin\"
    Write-Host "              →      %APPDATA%\Elgato\StreamDeck\Plugins\"
}
Write-Host ""
Write-Host "Usage on device:" -ForegroundColor White
Write-Host "  'App Volume'           – rotate=vol, press=mute, touch=100%"
Write-Host "  'Active Window Volume' – same, auto-follows the focused window"
