#Requires -Version 7
<#
.SYNOPSIS
  Stages and validates the portable Windows package for RTWiki.

.DESCRIPTION
  Creates a fresh staging tree containing RTWiki.exe beside web/ (index.html
  plus the complete assets directory). Uses direct file/directory copies only —
  never wildcard patterns, which can flatten the web/ folder when the
  destination does not yet exist. Validates that every essential artifact is
  present and non-empty, rejects unexpected nesting, and never creates runtime
  data/ or logs/ directories (the application owns those).

.PARAMETER SourceDir
  Build output root containing server/RTWiki.exe and web/ (Vite output).

.PARAMETER DestDir
  Staging destination, e.g. package/RTWiki.
#>
param(
  [Parameter(Mandatory = $true)] [string] $SourceDir,
  [Parameter(Mandatory = $true)] [string] $DestDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$exeSrc    = Join-Path $SourceDir 'server/RTWiki.exe'
$indexSrc  = Join-Path $SourceDir 'web/index.html'
$assetsSrc = Join-Path $SourceDir 'web/assets'

foreach ($f in @($exeSrc, $indexSrc)) {
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
Copy-Item $exeSrc    -Destination (Join-Path $DestDir 'RTWiki.exe')      -Force
Copy-Item $indexSrc  -Destination (Join-Path $webDest 'index.html')      -Force
Copy-Item $assetsSrc -Destination (Join-Path $webDest 'assets') -Recurse -Force

# Validate staged essentials.
$exeDest   = Join-Path $DestDir 'RTWiki.exe'
$indexDest = Join-Path $webDest 'index.html'
$assetsDest = Join-Path $webDest 'assets'
foreach ($f in @($exeDest, $indexDest)) {
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
if ($topLevel -ne 'RTWiki.exe,web') { throw "Unexpected package root contents: $topLevel" }

$totalBytes = ($assetFiles | Measure-Object Length -Sum).Sum + (Get-Item $exeDest).Length + (Get-Item $indexDest).Length
Write-Host "PACKAGE STAGED: $DestDir"
Write-Host "  RTWiki.exe      $((Get-Item $exeDest).Length) bytes"
Write-Host "  web/index.html  $((Get-Item $indexDest).Length) bytes"
Write-Host "  web/assets      $($assetFiles.Count) files ($([Math]::Round($totalBytes / 1MB, 1)) MB total package)"
