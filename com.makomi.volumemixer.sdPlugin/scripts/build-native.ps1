$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) {
    throw "C# compiler not found: $csc"
}

$outDir = Join-Path $root "native\bin"
New-Item -ItemType Directory -Force $outDir | Out-Null

& $csc `
    /nologo `
    /target:exe `
    /platform:x64 `
    "/out:$outDir\VolumeControllerHelper2.exe" `
    "$root\native\VolumeController.cs" `
    /r:System.dll `
    /r:System.Drawing.dll
