<#
.SYNOPSIS
  Generates the Tauri shell icons (icon.png + multi-size icon.ico).

.DESCRIPTION
  Renders a deterministic RTWiki glyph — a rounded blue tile with a white "R" —
  using System.Drawing only, so no designer assets or network access are needed.
  Writes src-tauri/icons/icon.png (512px) and src-tauri/icons/icon.ico
  (16/24/32/48/64/128/256, PNG-compressed entries).

  Safe to re-run; output is deterministic for a given .NET/System.Drawing version.
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
    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(24, 100, 171))
    try {
      $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
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
    $fontSize = [float]($size * 0.58)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
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

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  try {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return $ms.ToArray()
  } finally { $ms.Dispose() }
}

# 512px master PNG.
$master = New-RtwikiTile 512
try {
  $master.Save((Join-Path $iconsDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $master.Dispose() }
Write-Host 'Wrote src-tauri/icons/icon.png'

# Multi-size ICO with PNG-compressed entries (supported since Windows Vista).
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($s in $sizes) {
  $bmp = New-RtwikiTile $s
  try { Get-PngBytes $bmp } finally { $bmp.Dispose() }
}

$icoPath = Join-Path $iconsDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
try {
  $w = New-Object System.IO.BinaryWriter($fs)
  try {
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $s = $sizes[$i]
      $len = $images[$i].Length
      $dim = if ($s -ge 256) { 0 } else { $s }
      $w.Write([byte]$dim)
      $w.Write([byte]$dim)
      $w.Write([byte]0); $w.Write([byte]0)
      $w.Write([uint16]1); $w.Write([uint16]32)
      $w.Write([uint32]$len); $w.Write([uint32]$offset)
      $offset += $len
    }
    foreach ($img in $images) { $w.Write($img) }
  } finally { $w.Dispose() }
} finally { $fs.Dispose() }
Write-Host 'Wrote src-tauri/icons/icon.ico'
