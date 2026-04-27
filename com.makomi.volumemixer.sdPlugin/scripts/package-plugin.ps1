$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found: $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$pluginFolderName = Split-Path -Leaf $root
$version = [string]$manifest.Version

if ([string]::IsNullOrWhiteSpace($pluginFolderName)) {
    throw "Could not determine plugin folder name"
}

$distDir = Join-Path $root "dist"
$stagingRoot = Join-Path $distDir "_staging"
$stagingPluginDir = Join-Path $stagingRoot $pluginFolderName
$archiveBase = "{0}-{1}" -f $pluginFolderName, $version
$zipPath = Join-Path $distDir ($archiveBase + ".zip")
$installerPath = Join-Path $distDir ($archiveBase + ".streamDeckPlugin")

New-Item -ItemType Directory -Force $distDir | Out-Null

foreach ($path in @($stagingRoot, $zipPath, $installerPath)) {
    if (Test-Path $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

New-Item -ItemType Directory -Force $stagingPluginDir | Out-Null

$includePaths = @(
    "manifest.json",
    "bin",
    "imgs",
    "layouts",
    "native",
    "ui"
)

foreach ($relativePath in $includePaths) {
    $sourcePath = Join-Path $root $relativePath
    if (-not (Test-Path $sourcePath)) {
        throw "Missing required path for packaging: $relativePath"
    }

    Copy-Item -LiteralPath $sourcePath -Destination $stagingPluginDir -Recurse -Force
}

Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
Move-Item -LiteralPath $zipPath -Destination $installerPath

Write-Output $installerPath
