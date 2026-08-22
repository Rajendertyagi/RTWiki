#Requires -Version 7
<#
.SYNOPSIS
  Starts the packaged RTWiki application and verifies it end to end.

.DESCRIPTION
  Copies the staged portable package to an isolated run directory (preserving
  the RTWiki.exe-beside-web/ layout), proves executable identity across
  build/staged/copied trees, launches only the captured executable from a
  different working directory, proves it owns port 8080, asserts the
  application created its own runtime directories, exercises the full endpoint
  matrix (health, root, hashed assets with exact MIME and byte sizes, missing
  asset and traversal rejection, shutdown security, second-instance behavior),
  performs an authorized shutdown, and cleans up only the exact PIDs it
  created. Diagnostics are written to the diagnostics directory on failure and
  any shutdown token found in them is redacted.

.PARAMETER PackageDir
  Staged package directory (RTWiki.exe beside web/).

.PARAMETER BuildExe
  Path to build/server/RTWiki.exe for byte-identity verification.

.PARAMETER RunDir
  Working area; receives the extracted application tree and process cwd.

.PARAMETER DiagDir
  Diagnostics output directory (identity hashes, stdout/stderr captures).
#>
param(
  [Parameter(Mandatory = $true)] [string] $PackageDir,
  [Parameter(Mandatory = $true)] [string] $BuildExe,
  [Parameter(Mandatory = $true)] [string] $RunDir,
  [Parameter(Mandatory = $true)] [string] $DiagDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Port = 8080
$Base = "http://127.0.0.1:$Port"
$out      = Join-Path $DiagDir 'smoke.out.txt'
$err      = Join-Path $DiagDir 'smoke.err.txt'
$identity = Join-Path $DiagDir 'identity.txt'

if (-not (Test-Path $BuildExe -PathType Leaf)) { throw "Build executable not found: $BuildExe" }
if (-not (Test-Path (Join-Path $PackageDir 'RTWiki.exe') -PathType Leaf)) { throw "Staged executable not found under $PackageDir" }

# Fresh run and diagnostics directories.
foreach ($d in @($RunDir, $DiagDir)) {
  if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$appDir  = Join-Path $RunDir 'app'   # extracted application tree
$workDir = Join-Path $RunDir 'work'  # process cwd — deliberately different from app dir
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

# Copy the package without flattening: copy the directory itself, no wildcard.
Copy-Item -Path $PackageDir -Destination $appDir -Recurse -Force

$exe    = Join-Path $appDir 'RTWiki.exe'
$webDir = Join-Path $appDir 'web'
if (-not (Test-Path $exe -PathType Leaf)) { throw 'Copied tree is missing RTWiki.exe' }
if (-not (Test-Path (Join-Path $webDir 'index.html') -PathType Leaf)) { throw 'Copied tree is missing web/index.html' }
$copiedAssets = Join-Path $webDir 'assets'
if (-not (Test-Path $copiedAssets -PathType Container)) { throw 'Copied tree is missing web/assets' }
if (@(Get-ChildItem $copiedAssets -File).Count -lt 1) { throw 'Copied web/assets is empty' }

# Executable identity: build, staged and copied trees must be byte-identical.
$hBuild = (Get-FileHash $BuildExe -Algorithm SHA256).Hash
$hStaged = (Get-FileHash (Join-Path $PackageDir 'RTWiki.exe') -Algorithm SHA256).Hash
$hApp = (Get-FileHash $exe -Algorithm SHA256).Hash
@("BUILD_SHA256=$hBuild", "STAGED_SHA256=$hStaged", "EXTRACTED_SHA256=$hApp") | Set-Content $identity
Write-Host "IDENTITY: build=$hBuild staged=$hStaged extracted=$hApp"
if ($hBuild -ne $hStaged -or $hStaged -ne $hApp) { throw 'EXECUTABLE IDENTITY MISMATCH' }

$p = $null
$secondP = $null
$shutdownToken = $null
try {
  # Port must be free before launch; report any owner without terminating it.
  $preOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($preOwner) {
    $ownerPid = $preOwner[0].OwningProcess
    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    Write-Host "PORT OWNER: PID=$ownerPid NAME=$($proc.Name) PATH=$($proc.Path) START=$($proc.StartTime)"
    throw "Port $Port already occupied by PID $ownerPid before launch"
  }

  # Launch only the captured executable, from a different working directory.
  $p = Start-Process -FilePath $exe -ArgumentList '--no-open' -WorkingDirectory $workDir `
        -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Write-Host "CAPTURED PID=$($p.Id) PATH=$exe"

  # Readiness poll: refresh process state each iteration; fail fast on exit.
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    $p.Refresh()
    if ($p.HasExited) { throw "Captured PID $($p.Id) exited early (code $($p.ExitCode)) before becoming ready" }
    try {
      $r = Invoke-WebRequest "$Base/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Server did not become ready within 60s (captured PID $($p.Id))" }

  # Prove the captured PID owns the port and runs the extracted executable.
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) { throw 'No listener on port after readiness' }
  $p.Refresh()
  if ($p.HasExited) { throw "Captured PID $($p.Id) exited although the port was being served" }
  if ($listener[0].OwningProcess -ne $p.Id) {
    throw "Port owner mismatch: listener PID $($listener[0].OwningProcess) != captured PID $($p.Id)"
  }
  $expectedPath = [IO.Path]::GetFullPath($exe)
  $actualPath = [IO.Path]::GetFullPath((Get-Process -Id $p.Id -ErrorAction Stop).Path)
  if ($actualPath -ine $expectedPath) { throw "Process path mismatch: $actualPath != $expectedPath" }
  Write-Host "PORT OWNERSHIP PROVEN: PID $($p.Id) owns $Port and matches extracted exe"

  # Runtime directories must be created by the application itself.
  foreach ($rel in @('data', 'data/attachments', 'data/backups', 'logs')) {
    if (-not (Test-Path (Join-Path $appDir $rel) -PathType Container)) {
      throw "Application did not create runtime directory: $rel"
    }
  }
  Write-Host 'RUNTIME DIRS OK: data/, data/attachments/, data/backups/, logs/ created by application'

  # --- Endpoint matrix -------------------------------------------------
  $health = Invoke-WebRequest "$Base/health" -UseBasicParsing
  if ($health.StatusCode -ne 200) { throw "Health returned $($health.StatusCode)" }
  if ($health.Content -notmatch '"status"\s*:\s*"ok"') { throw 'Health did not report ok' }

  $root = Invoke-WebRequest "$Base/" -UseBasicParsing
  if ($root.StatusCode -ne 200) { throw "GET / returned $($root.StatusCode)" }
  if ([string]::IsNullOrWhiteSpace($root.Content)) { throw 'GET / returned empty HTML' }

  $scriptPattern = '(?i)<script\s+[^>]*src="(/assets/[^"]+)"'
  $linkPattern = '(?i)<link\s+[^>]*href="(/assets/[^"]+)"'
  $assetUrls = @()
  foreach ($m in [regex]::Matches($root.Content, $scriptPattern)) { $assetUrls += $m.Groups[1].Value }
  foreach ($m in [regex]::Matches($root.Content, $linkPattern)) { $assetUrls += $m.Groups[1].Value }
  if ($assetUrls.Count -eq 0) { throw 'No asset references found in index.html' }

  $webFull = [IO.Path]::GetFullPath($webDir)
  $jsSeen = $false
  $cssSeen = $false
  foreach ($assetUrl in $assetUrls) {
    # Decode, strip the leading slash, resolve strictly underneath web/.
    $rel = [uri]::UnescapeDataString($assetUrl).TrimStart('/')
    $diskPath = [IO.Path]::GetFullPath((Join-Path $webDir $rel))
    if (-not $diskPath.StartsWith($webFull, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Asset path escapes web/: $rel"
    }
    if (-not (Test-Path $diskPath -PathType Leaf)) { throw "Referenced asset missing on disk: $rel" }

    $resp = Invoke-WebRequest "$Base$assetUrl" -UseBasicParsing
    if ($resp.StatusCode -ne 200) { throw "Asset $assetUrl returned $($resp.StatusCode)" }
    if ([string]::IsNullOrWhiteSpace($resp.Content)) { throw "Asset $assetUrl returned empty body" }

    $mediaType = (($resp.Headers['Content-Type'] -as [string]) -split ';')[0].Trim()
    if ($mediaType -eq 'text/html') { throw "Asset $assetUrl served as text/html (SPA fallback)" }
    if ($assetUrl.EndsWith('.js')) {
      if ($mediaType -ne 'text/javascript') { throw "Asset $assetUrl MIME '$mediaType' != text/javascript" }
      $jsSeen = $true
    } elseif ($assetUrl.EndsWith('.css')) {
      if ($mediaType -ne 'text/css') { throw "Asset $assetUrl MIME '$mediaType' != text/css" }
      $cssSeen = $true
    }

    $remoteSize = $resp.RawContentStream.Length
    $diskSize = (Get-Item $diskPath).Length
    if ($remoteSize -ne $diskSize) { throw "Asset $assetUrl size mismatch: remote=$remoteSize disk=$diskSize" }
    Write-Host "ASSET OK: $assetUrl ($mediaType, $remoteSize bytes)"
  }
  if (-not $jsSeen) { throw 'No JavaScript asset was referenced and verified' }
  if (-not $cssSeen) { throw 'No CSS asset was referenced and verified' }

  # Missing asset: numeric 404, never SPA HTML.
  $missingName = "missing-$( [guid]::NewGuid().ToString('N') ).js"
  $missing = Invoke-WebRequest "$Base/assets/$missingName" -UseBasicParsing -SkipHttpErrorCheck
  if ($missing.StatusCode -ne 404) { throw "Missing asset returned $($missing.StatusCode), expected 404" }
  if ($missing.Content -match '<!DOCTYPE|<html') { throw 'Missing asset received SPA HTML instead of 404 body' }

  # Traversal remains blocked (encoded dot-segment).
  $traversal = Invoke-WebRequest "$Base/%2e%2e/package.json" -UseBasicParsing -SkipHttpErrorCheck
  if ($traversal.StatusCode -lt 400) { throw "Traversal request not blocked (status $($traversal.StatusCode))" }
  if ($traversal.Content -match '"name"\s*:') { throw 'Traversal leaked file content' }
  Write-Host 'STATIC SECURITY OK: missing asset 404 without SPA fallback, traversal blocked'

  # Second instance must detect the first and exit cleanly.
  $secondOut = Join-Path $DiagDir 'smoke-second.out.txt'
  $secondErr = Join-Path $DiagDir 'smoke-second.err.txt'
  $secondP = Start-Process -FilePath $exe -ArgumentList '--no-open' -WorkingDirectory $workDir `
             -NoNewWindow -PassThru -RedirectStandardOutput $secondOut -RedirectStandardError $secondErr
  $exited = $false
  for ($i = 0; $i -lt 10; $i++) {
    if ($secondP.HasExited) { $exited = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $exited) { throw "Second instance did not exit within 10s (PID $($secondP.Id))" }
  if ($secondP.ExitCode -ne 0) { throw "Second instance exited with code $($secondP.ExitCode)" }
  $stillOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $stillOwner -or $stillOwner[0].OwningProcess -ne $p.Id) {
    throw 'First instance lost port ownership after second launch'
  }
  $recheck = Invoke-WebRequest "$Base/health" -UseBasicParsing
  if ($recheck.StatusCode -ne 200) { throw 'First instance unhealthy after second launch' }
  Write-Host "SINGLE-INSTANCE OK: second exited 0; first (PID $($p.Id)) still owns $Port"

  # Shutdown security — numeric status inspection throughout.
  $noToken = Invoke-WebRequest "$Base/api/shutdown" -Method POST -UseBasicParsing -SkipHttpErrorCheck
  if ($noToken.StatusCode -ne 403) { throw "POST /api/shutdown without token returned $($noToken.StatusCode), expected 403" }

  $wrongMethod = Invoke-WebRequest "$Base/api/shutdown" -Method GET -UseBasicParsing -SkipHttpErrorCheck
  if ($wrongMethod.StatusCode -ne 405) { throw "GET /api/shutdown returned $($wrongMethod.StatusCode), expected 405" }

  $tokenRes = Invoke-WebRequest "$Base/api/shutdown/token" -UseBasicParsing
  if ($tokenRes.StatusCode -ne 200) { throw "Token endpoint returned $($tokenRes.StatusCode)" }
  $shutdownToken = ($tokenRes.Content | ConvertFrom-Json).token
  if ([string]::IsNullOrWhiteSpace($shutdownToken)) { throw 'Shutdown token empty' }
  Write-Host "SHUTDOWN TOKEN OK: obtained ($($shutdownToken.Length) chars, value never printed)"

  $wrongToken = Invoke-WebRequest "$Base/api/shutdown" -Method POST -Headers @{ 'X-RTWiki-Shutdown-Token' = 'wrong-token' } `
                 -UseBasicParsing -SkipHttpErrorCheck
  if ($wrongToken.StatusCode -ne 403) { throw "Wrong token returned $($wrongToken.StatusCode), expected 403" }
  Write-Host 'SHUTDOWN SECURITY OK: no-token 403, GET 405, wrong-token 403'

  # Authorized shutdown.
  $shutdown = Invoke-WebRequest "$Base/api/shutdown" -Method POST `
               -Headers @{ 'X-RTWiki-Shutdown-Token' = $shutdownToken } -UseBasicParsing -SkipHttpErrorCheck
  if ($shutdown.StatusCode -ne 202) { throw "Authorized shutdown returned $($shutdown.StatusCode), expected 202" }
  if ((($shutdown.Content | ConvertFrom-Json).status) -ne 'shutting_down') { throw 'Shutdown body status unexpected' }

  $stopped = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-WebRequest "$Base/health" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { $stopped = $true; break }
  }
  if (-not $stopped) { throw 'Server did not stop within 10s after authorized shutdown' }
  $released = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($released) { throw "Port $Port still has a listener after shutdown" }
  Write-Host 'SHUTDOWN OK: clean stop, port released'

  Write-Host 'SMOKE TEST PASSED'
} catch {
  # Dump diagnostics: relax EAP so Write-Host streams are not cut short.
  $ErrorActionPreference = 'Continue'
  Write-Host "SMOKE FAILURE: $_"
  Write-Host '=== STDOUT ==='
  Get-Content $out -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Write-Host '=== STDERR ==='
  Get-Content $err -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Write-Host '=== IDENTITY ==='
  Get-Content $identity -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  throw
} finally {
  # Cleanup touches only the exact PIDs this script created.
  try { Copy-Item (Join-Path $appDir 'logs/rtwiki.log') (Join-Path $DiagDir 'rtwiki.log') -Force -ErrorAction SilentlyContinue } catch { }
  if ($shutdownToken) {
    foreach ($f in @($out, $err, (Join-Path $DiagDir 'rtwiki.log'))) {
      if (Test-Path $f) {
        $raw = Get-Content $f -Raw -ErrorAction SilentlyContinue
        if ($raw -and $raw.Contains($shutdownToken)) {
          ($raw -replace [regex]::Escape($shutdownToken), '[REDACTED]') | Set-Content $f -NoNewline -ErrorAction SilentlyContinue
        }
      }
    }
  }
  foreach ($proc in @($secondP, $p)) {
    if ($null -ne $proc) {
      $proc.Refresh()
      if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $proc.Refresh()
      }
      if (-not $proc.HasExited) {
        Write-Warning "Cleanup failed: PID $($proc.Id) still running"
      } else {
        Write-Host "CLEANUP OK: PID $($proc.Id) is gone"
      }
    }
  }
}
