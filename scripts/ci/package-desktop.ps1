#Requires -Version 7
<#
.SYNOPSIS
  Stages and validates the portable Windows DESKTOP package for RTWiki.

.DESCRIPTION
  Creates a fresh staging tree containing the Tauri shell (RTWiki.exe) beside
  the Bun server sidecar (RTWikiServer.exe) and web/ (index.html plus the
  complete assets directory), per ADR-011. Uses direct file/directory copies
  only — never wildcard patterns, which can flatten the web/ folder when the
  destination does not yet exist. Validates that every essential artifact is
  present and non-empty, rejects unexpected nesting, and never creates runtime
  data/ or logs/ directories (the application owns those).

.PARAMETER ShellExe
  Tauri shell binary, e.g. src-tauri/target/release/rtwiki.exe (renamed to
  RTWiki.exe when staged).

.PARAMETER ServerExe
  Bun server binary, e.g. build/server/RTWiki.exe (staged as RTWikiServer.exe).

.PARAMETER WebDir
  Vite output directory containing index.html and assets/.

.PARAMETER DestDir
  Staging destination, e.g. package/RTWiki-Desktop.
#>
param(
  [Parameter(Mandatory = $true)] [string] $ShellExe,
  [Parameter(Mandatory = $true)] [string] $ServerExe,
  [Parameter(Mandatory = $true)] [string] $WebDir,
  [Parameter(Mandatory = $true)] [string] $DestDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$indexSrc  = Join-Path $WebDir 'index.html'
$assetsSrc = Join-Path $WebDir 'assets'

foreach ($f in @($ShellExe, $ServerExe, $indexSrc)) {
  if (-not (Test-Path $f -PathType Leaf)) { throw "Missing build artifact: $f" }
  if ((Get-Item $f).Length -eq 0) { throw "Empty build artifact: $f" }
}
if (-not (Test-Path $assetsSrc -PathType Container)) { throw "Missing build asset directory: $assetsSrc" }

# Fresh staging tree.
if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
$webDest = Join-Path $DestDir 'web'
New-Item -ItemType Directory -Force -Path $webDest | Out-Null

# Direct copies only — no wildcards (wildcard + non-existent destination can
# flatten web/, which broke frontendDistDir resolution; see CI history).
Copy-Item $ShellExe  -Destination (Join-Path $DestDir 'RTWiki.exe')       -Force
Copy-Item $ServerExe -Destination (Join-Path $DestDir 'RTWikiServer.exe') -Force
Copy-Item $indexSrc  -Destination (Join-Path $webDest 'index.html')       -Force
Copy-Item $assetsSrc -Destination (Join-Path $webDest 'assets') -Recurse -Force

# Validate staged essentials.
$shellDest   = Join-Path $DestDir 'RTWiki.exe'
$sidecarDest = Join-Path $DestDir 'RTWikiServer.exe'
$indexDest   = Join-Path $webDest 'index.html'
$assetsDest  = Join-Path $webDest 'assets'
foreach ($f in @($shellDest, $sidecarDest, $indexDest)) {
  if (-not (Test-Path $f -PathType Leaf)) { throw "Staging failed: $f missing" }
  if ((Get-Item $f).Length -eq 0) { throw "Staging failed: $f empty" }
}

$assetFiles = Get-ChildItem $assetsDest -File
$jsAssets  = @($assetFiles | Where-Object Name -like '*.js')
$cssAssets = @($assetFiles | Where-Object Name -like '*.css')
if ($jsAssets.Count -lt 1) { throw 'Staging failed: no JS asset under web/assets' }
if ($cssAssets.Count -lt 1) { throw 'Staging failed: no CSS asset under web/assets' }
foreach ($a in ($jsAssets + $cssAssets)) {
  if ($a.Length -le 0) { throw "Staging failed: empty asset $($a.Name)" }
}

# Reject unexpected nesting / stray content.
if (Test-Path (Join-Path $DestDir 'index.html')) { throw 'Unexpected nesting: index.html at package root' }
if (Test-Path (Join-Path $webDest 'web')) { throw 'Unexpected nesting: nested web/web directory' }
foreach ($rel in @('data', 'logs')) {
  if (Test-Path (Join-Path $DestDir $rel)) { throw "Staging must not contain runtime directory: $rel" }
}
$topLevel = (Get-ChildItem $DestDir | ForEach-Object Name | Sort-Object) -join ','
if ($topLevel -ne 'RTWiki.exe,RTWikiServer.exe,web') { throw "Unexpected package root contents: $topLevel" }

$shellSize = (Get-Item $shellDest).Length
$sidecarSize = (Get-Item $sidecarDest).Length
$totalBytes = ($assetFiles | Measure-Object Length -Sum).Sum + $shellSize + $sidecarSize + (Get-Item $indexDest).Length
Write-Host "DESKTOP PACKAGE STAGED: $DestDir"
Write-Host "  RTWiki.exe        $shellSize bytes"
Write-Host "  RTWikiServer.exe  $sidecarSize bytes"
Write-Host "  web/index.html    $((Get-Item $indexDest).Length) bytes"
Write-Host "  web/assets        $($assetFiles.Count) files ($([Math]::Round($totalBytes / 1MB, 1)) MB total package)"
