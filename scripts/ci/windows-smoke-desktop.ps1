#Requires -Version 7
<#
.SYNOPSIS
  Starts the packaged RTWiki DESKTOP application and verifies it end to end.

.DESCRIPTION
  Copies the staged desktop package (RTWiki.exe shell, RTWikiServer.exe
  sidecar, web/) to an isolated run directory, launches only the captured
  shell executable from a different working directory, and verifies the full
  lifecycle: the shell spawns the sidecar, the sidecar owns port 8080 as a
  child of the shell, runtime directories and the startup log are created, a
  second shell instance attaches instead of starting a second server, and the
  token-protected shutdown stops the server cleanly while the shell survives.
  Cleans up only the exact PIDs it created. Diagnostics are written to the
  diagnostics directory on failure and any shutdown token found in them is
  redacted.

.PARAMETER PackageDir
  Staged desktop package directory (RTWiki.exe + RTWikiServer.exe beside web/).

.PARAMETER ShellExe
  Built shell binary (src-tauri/target/release/rtwiki.exe) for identity check.

.PARAMETER ServerExe
  Built server binary (build/server/RTWiki.exe) for sidecar identity check.

.PARAMETER RunDir
  Working area; receives the extracted application tree and process cwd.

.PARAMETER DiagDir
  Diagnostics output directory (identity hashes, stdout/stderr captures).
#>
param(
  [Parameter(Mandatory = $true)] [string] $PackageDir,
  [Parameter(Mandatory = $true)] [string] $ShellExe,
  [Parameter(Mandatory = $true)] [string] $ServerExe,
  [Parameter(Mandatory = $true)] [string] $RunDir,
  [Parameter(Mandatory = $true)] [string] $DiagDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Port = 8080
$Base = "http://127.0.0.1:$Port"
$out      = Join-Path $DiagDir 'desktop-smoke.out.txt'
$err      = Join-Path $DiagDir 'desktop-smoke.err.txt'
$identity = Join-Path $DiagDir 'desktop-identity.txt'

foreach ($req in @($ShellExe, $ServerExe)) {
  if (-not (Test-Path $req -PathType Leaf)) { throw "Build binary not found: $req" }
}
$stagedShell = Join-Path $PackageDir 'RTWiki.exe'
$stagedSidecar = Join-Path $PackageDir 'RTWikiServer.exe'
foreach ($req in @($stagedShell, $stagedSidecar)) {
  if (-not (Test-Path $req -PathType Leaf)) { throw "Staged binary not found: $req" }
}

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

$exe     = Join-Path $appDir 'RTWiki.exe'
$sidecar = Join-Path $appDir 'RTWikiServer.exe'
$webDir  = Join-Path $appDir 'web'
foreach ($req in @($exe, $sidecar)) {
  if (-not (Test-Path $req -PathType Leaf)) { throw "Copied tree is missing $(Split-Path $req -Leaf)" }
}
if (-not (Test-Path (Join-Path $webDir 'index.html') -PathType Leaf)) { throw 'Copied tree is missing web/index.html' }

# Executable identity: build, staged and copied trees must be byte-identical.
$hShellBuild = (Get-FileHash $ShellExe -Algorithm SHA256).Hash
$hShellApp = (Get-FileHash $exe -Algorithm SHA256).Hash
$hSidecarBuild = (Get-FileHash $ServerExe -Algorithm SHA256).Hash
$hSidecarApp = (Get-FileHash $sidecar -Algorithm SHA256).Hash
@("SHELL_BUILD=$hShellBuild", "SHELL_EXTRACTED=$hShellApp",
  "SIDECAR_BUILD=$hSidecarBuild", "SIDECAR_EXTRACTED=$hSidecarApp") | Set-Content $identity
if ($hShellBuild -ne $hShellApp) { throw 'SHELL IDENTITY MISMATCH' }
if ($hSidecarBuild -ne $hSidecarApp) { throw 'SIDECAR IDENTITY MISMATCH' }
Write-Host 'IDENTITY OK: shell and sidecar match their build outputs'

$p = $null
$secondP = $null
$shutdownToken = $null
try {
  # Port must be free before launch; report any owner without terminating it.
  $preOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($preOwner) {
    $ownerPid = $preOwner[0].OwningProcess
    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    Write-Host "PORT OWNER: PID=$ownerPid NAME=$($proc.Name)"
    throw "Port $Port already occupied by PID $ownerPid before launch"
  }

  # Launch only the captured shell, from a different working directory.
  $p = Start-Process -FilePath $exe -WorkingDirectory $workDir `
        -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Write-Host "CAPTURED SHELL PID=$($p.Id) PATH=$exe"

  # Readiness poll: refresh process state each iteration; fail fast on exit.
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    $p.Refresh()
    if ($p.HasExited) { throw "Captured shell PID $($p.Id) exited early (code $($p.ExitCode)) before becoming ready" }
    try {
      $r = Invoke-WebRequest "$Base/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Server did not become ready within 60s (captured shell PID $($p.Id))" }
  Write-Host 'READY OK: shell spawned the sidecar; /health reports ok'

  # Prove the port is owned by the sidecar, which is a child of the shell.
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) { throw 'No listener on port after readiness' }
  $serverPid = $listener[0].OwningProcess
  $serverProc = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction Stop
  if ($serverProc.Name -ne 'RTWikiServer.exe') { throw "Port owner is $($serverProc.Name), expected RTWikiServer.exe" }
  if ($serverProc.ParentProcessId -ne $p.Id) {
    throw "Sidecar PID $serverPid is not a child of shell PID $($p.Id) (parent $($serverProc.ParentProcessId))"
  }
  $expectedSidecar = [IO.Path]::GetFullPath($sidecar)
  $actualSidecar = [IO.Path]::GetFullPath((Get-Process -Id $serverPid -ErrorAction Stop).Path)
  if ($actualSidecar -ine $expectedSidecar) { throw "Sidecar path mismatch: $actualSidecar != $expectedSidecar" }
  Write-Host "PROCESS TREE OK: shell PID $($p.Id) owns sidecar PID $serverPid which owns $Port"

  # Runtime directories must be created by the application itself.
  foreach ($rel in @('data', 'data/attachments', 'data/backups', 'logs')) {
    if (-not (Test-Path (Join-Path $appDir $rel) -PathType Container)) {
      throw "Application did not create runtime directory: $rel"
    }
  }
  Write-Host 'RUNTIME DIRS OK: data/, data/attachments/, data/backups/, logs/ created by application'

  # Startup log: must exist, be non-empty, valid JSONL, contain startup.
  $logPath = Join-Path $appDir 'logs/rtwiki.log'
  if (-not (Test-Path $logPath -PathType Leaf)) { throw 'Application did not create logs/rtwiki.log' }
  if ((Get-Item $logPath).Length -le 0) { throw 'logs/rtwiki.log exists but is empty' }
  $startupSeen = $false
  foreach ($line in Get-Content $logPath) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $null = $line | ConvertFrom-Json } catch { throw 'logs/rtwiki.log contains an invalid JSONL line' }
    if (($line | ConvertFrom-Json).event -eq 'startup') { $startupSeen = $true }
  }
  if (-not $startupSeen) { throw 'startup event missing from logs/rtwiki.log' }
  Write-Host 'LOG OK: logs/rtwiki.log valid JSONL with startup event'

  $root = Invoke-WebRequest "$Base/" -UseBasicParsing
  if ($root.StatusCode -ne 200) { throw "GET / returned $($root.StatusCode)" }
  if ([string]::IsNullOrWhiteSpace($root.Content)) { throw 'GET / returned empty HTML' }
  Write-Host 'ROOT OK: GET / serves the SPA'

  # Second shell instance must attach (single-instance) and exit cleanly.
  $secondP = Start-Process -FilePath $exe -WorkingDirectory $workDir `
             -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $DiagDir 'desktop-second.out.txt') `
             -RedirectStandardError (Join-Path $DiagDir 'desktop-second.err.txt')
  $secondP | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue
  $secondP.Refresh()
  if (-not $secondP.HasExited) { throw "Second shell instance did not exit within 20s (PID $($secondP.Id))" }
  if ($secondP.ExitCode -ne 0) { throw "Second shell instance exited with code $($secondP.ExitCode)" }
  $stillOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $stillOwner -or $stillOwner[0].OwningProcess -ne $serverPid) {
    throw 'First sidecar lost port ownership after second shell launch'
  }
  Write-Host "SINGLE-INSTANCE OK: second shell exited 0; sidecar PID $serverPid still owns $Port"

  # Authorized shutdown through the token-protected endpoint.
  $noToken = Invoke-WebRequest "$Base/api/shutdown" -Method POST -UseBasicParsing -SkipHttpErrorCheck
  if ($noToken.StatusCode -ne 403) { throw "POST /api/shutdown without token returned $($noToken.StatusCode), expected 403" }
  $tokenRes = Invoke-WebRequest "$Base/api/shutdown/token" -UseBasicParsing
  $shutdownToken = ($tokenRes.Content | ConvertFrom-Json).token
  if ([string]::IsNullOrWhiteSpace($shutdownToken)) { throw 'Shutdown token empty' }
  $shutdown = Invoke-WebRequest "$Base/api/shutdown" -Method POST `
               -Headers @{ 'X-RTWiki-Shutdown-Token' = $shutdownToken } -UseBasicParsing -SkipHttpErrorCheck
  if ($shutdown.StatusCode -ne 202) { throw "Authorized shutdown returned $($shutdown.StatusCode), expected 202" }

  $stopped = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-WebRequest "$Base/health" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { $stopped = $true; break }
  }
  if (-not $stopped) { throw 'Sidecar did not stop within 10s after authorized shutdown' }
  Write-Host 'SHUTDOWN OK: sidecar stopped cleanly on authorized request'

  # The shell must survive its sidecar going away (tray stays resident).
  $p.Refresh()
  if ($p.HasExited) { throw "Shell exited after sidecar shutdown (code $($p.ExitCode))" }
  Write-Host "SHELL SURVIVES OK: shell PID $($p.Id) still running after sidecar shutdown"

  # Post-shutdown log assertions: completion persisted, token never leaked.
  $completeSeen = $false
  foreach ($line in (Get-Content $logPath -ErrorAction SilentlyContinue)) {
    try { $null = $line | ConvertFrom-Json } catch { throw 'logs/rtwiki.log has an invalid JSONL line after shutdown' }
    $entry = $line | ConvertFrom-Json
    if ($entry.event -eq 'shutdown_complete') { $completeSeen = $true }
    if ($shutdownToken -and $line.Contains($shutdownToken)) { throw 'Shutdown token leaked into logs/rtwiki.log' }
  }
  if (-not $completeSeen) { throw 'shutdown_complete event missing after authorized shutdown' }
  Write-Host 'LOG FINAL OK: shutdown_complete persisted; shutdown token absent'

  Write-Host 'DESKTOP SMOKE TEST PASSED'
} catch {
  $ErrorActionPreference = 'Continue'
  Write-Host "DESKTOP SMOKE FAILURE: $_"
  Write-Host '=== STDOUT ==='
  Get-Content $out -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Write-Host '=== STDERR ==='
  Get-Content $err -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Write-Host '=== IDENTITY ==='
  Get-Content $identity -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  throw
} finally {
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
  # Cleanup touches only the exact PIDs this script created, plus the sidecar
  # child the shell spawned (identified as a child of the shell PID).
  $sidecarPid = $null
  if ($null -ne $p) {
    try {
      $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.Id)" -ErrorAction SilentlyContinue |
        Where-Object Name -eq 'RTWikiServer.exe' | Select-Object -First 1
      if ($child) { $sidecarPid = $child.ProcessId }
    } catch { }
  }
  foreach ($proc in @($secondP, $p)) {
    if ($null -ne $proc) {
      $proc.Refresh()
      if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if ($sidecarPid) {
    Stop-Process -Id $sidecarPid -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  $lingering = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($lingering) { Write-Warning "Port $Port still has a listener after cleanup" }
  else { Write-Host 'CLEANUP OK: all created processes gone, port released' }
}
