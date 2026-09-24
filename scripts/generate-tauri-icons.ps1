<#
.SYNOPSIS
  Generates the RTWiki desktop-shell source icon (src-tauri/icons/icon.png).

.DESCRIPTION
  Renders a deterministic RTWiki glyph — a rounded blue tile with a white "R" —
  using System.Drawing only, so no designer assets or network access are
  needed, then delegates every derived size to the official Tauri icon
  generator (`tauri icon`), which emits the platform-correct icon set.

  The derived .ico must come from the Tauri CLI: hand-written ICO writers
  commonly emit PNG-compressed entries with a non-zero biPlanes field, and
  Windows RC.EXE then parses the PNG bytes as a DIB and aborts the build with
  RC2176 ("old DIB"). `tauri icon` writes planes=0 correctly. The result is
  checked by scripts/validate-ico.ts.

  Safe to re-run; output is deterministic for a given .NET/System.Drawing and
  Tauri CLI version.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $scriptDir = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
  } else {
    $PSScriptRoot
  }
  $RepoRoot = Split-Path -Parent $scriptDir
}

Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $RepoRoot 'src-tauri/icons'
if (-not (Test-Path -LiteralPath $iconsDir)) {
  New-Item -ItemType Directory -Path $iconsDir | Out-Null
}

function New-RtwikiTile([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(24, 100, 171))
    try {
      $radius = [float]($size * 0.22)
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      try {
        $d = $radius * 2
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $g.FillPath($bg, $path)
      } finally { $path.Dispose() }
    } finally { $bg.Dispose() }
    $font = New-Object System.Drawing.Font('Segoe UI', [float]($size * 0.58), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    try {
      $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
      try {
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString('R', $font, $brush, $rect, $format)
      } finally { $brush.Dispose() }
    } finally { $font.Dispose() }
  } finally { $g.Dispose() }
  return $bmp
}

# 1024px master: the Tauri icon generator downscales from here, so starting
# above its 1024 target keeps every derived size crisp.
$masterPath = Join-Path $iconsDir 'icon.png'
$master = New-RtwikiTile 1024
try {
  $master.Save($masterPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $master.Dispose() }
Write-Host "Wrote $masterPath"

# Derived sizes via the official generator (authoritative ICO format).
Push-Location $RepoRoot
try {
  & bunx tauri icon $masterPath -o $iconsDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "tauri icon failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

# Windows-only: drop mobile/macOS outputs the portable artifact never uses.
foreach ($stale in @('android', 'ios', 'icon.icns', 'StoreLogo.png')) {
  $p = Join-Path $iconsDir $stale
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
Get-ChildItem $iconsDir -Filter 'Square*Logo.png' | Remove-Item -Force
Get-ChildItem $iconsDir -Filter 'StoreLogo.png' | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host 'Wrote src-tauri/icons (Tauri-generated sizes)'
