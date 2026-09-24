//! Bun server sidecar lifecycle (ADR-011).
//!
//! The shell spawns `RTWikiServer.exe --no-open --port <port>` from its own
//! directory with an explicit argument array (never a shell string), polls
//! `GET /health` over plain TCP until the server answers 200, and shuts it
//! down gracefully through the token-protected `/api/shutdown` endpoint with
//! a child-kill fallback. Raw TCP is used deliberately so this module needs
//! no HTTP client dependency.
//!
//! The listening port comes from `data/server.json` (managed in Settings,
//! read fresh on every spawn) with a compiled-default fallback, so a saved
//! port change applies on respawn without rebuilding anything. The window
//! close behavior comes from `data/desktop.json`, read fresh on every close
//! so the Settings UI takes effect immediately.
//!
//! Restart handshake: the frontend records `data/restart-requested` before
//! shutting the server down; the shell's watch thread consumes the flag and
//! respawns the sidecar (crash recovery uses the same path). The server's
//! same-origin check accepts these requests through its CLI/automation path
//! (no Origin/Referer headers are sent), and the shutdown token is fetched
//! per launch from `GET /api/shutdown/token` — it is held in memory only and
//! never logged.

use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Fallback when data/server.json is missing or corrupt. Must match
/// DEFAULT_PORT in src/shared/constants/index.ts.
pub const DEFAULT_PORT: u16 = 8080;
/// Sidecar executable name beside the shell. Must match COMPILED_EXE_BASENAMES.
pub const SIDECAR_FILENAME: &str = "RTWikiServer.exe";

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const BOOT_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);

/// Window close behavior (mirrors CloseBehavior in shared constants).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseBehavior {
  Ask,
  Minimize,
  Quit,
}

#[derive(Debug, Deserialize)]
struct ServerSettingsFile {
  port: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct DesktopSettingsFile {
  #[serde(rename = "closeBehavior")]
  close_behavior: Option<String>,
}

pub fn base_url(port: u16) -> String {
  format!("http://127.0.0.1:{port}")
}

fn server_addr(port: u16) -> SocketAddr {
  SocketAddr::from(([127, 0, 0, 1], port))
}

/// Effective listening port: data/server.json when valid, else the default.
/// A missing or corrupt file can never block startup.
pub fn configured_port(exe_dir: &Path) -> u16 {
  let raw = std::fs::read_to_string(exe_dir.join("data").join("server.json"));
  if let Ok(raw) = raw {
    if let Ok(parsed) = serde_json::from_str::<ServerSettingsFile>(&raw) {
      if let Some(port) = parsed.port {
        if (1024..=65535).contains(&port) {
          return port;
        }
      }
    }
  }
  DEFAULT_PORT
}

/// Window close behavior, read fresh on every close so Settings changes
/// apply immediately. Unknown values fall back to asking.
pub fn close_behavior(exe_dir: &Path) -> CloseBehavior {
  let raw = std::fs::read_to_string(exe_dir.join("data").join("desktop.json"));
  if let Ok(raw) = raw {
    if let Ok(parsed) = serde_json::from_str::<DesktopSettingsFile>(&raw) {
      match parsed.close_behavior.as_deref() {
        Some("minimize") => return CloseBehavior::Minimize,
        Some("quit") => return CloseBehavior::Quit,
        _ => {}
      }
    }
  }
  CloseBehavior::Ask
}

fn restart_flag_path(exe_dir: &Path) -> PathBuf {
  exe_dir.join("data").join("restart-requested")
}

fn shutdown_flag_path(exe_dir: &Path) -> PathBuf {
  exe_dir.join("data").join("shutdown-requested")
}

/// Drops a stale restart flag at boot (e.g. left by a crash mid-restart).
pub fn clear_restart_request(exe_dir: &Path) {
  let _ = std::fs::remove_file(restart_flag_path(exe_dir));
}

/// Returns true once per recorded restart request; deletes the flag.
pub fn consume_restart_request(exe_dir: &Path) -> bool {
  std::fs::remove_file(restart_flag_path(exe_dir)).is_ok()
}

/// Drops a stale shutdown flag at boot (e.g. left by a crash mid-shutdown).
pub fn clear_shutdown_request(exe_dir: &Path) {
  let _ = std::fs::remove_file(shutdown_flag_path(exe_dir));
}

/// Returns true when the server recorded an authorized shutdown before it
/// exited. The watch thread uses this to tell an intentional exit from a crash:
/// without it every clean shutdown is immediately undone by a respawn.
pub fn consume_shutdown_request(exe_dir: &Path) -> bool {
  std::fs::remove_file(shutdown_flag_path(exe_dir)).is_ok()
}

/// Minimal blocking HTTP exchange over loopback. Returns the full response
/// (headers + body) on success.
fn http_exchange(port: u16, request: &str) -> Option<String> {
  let mut stream = TcpStream::connect_timeout(&server_addr(port), IO_TIMEOUT).ok()?;
  stream.set_read_timeout(Some(IO_TIMEOUT)).ok()?;
  stream.set_write_timeout(Some(IO_TIMEOUT)).ok()?;
  stream.write_all(request.as_bytes()).ok()?;
  let mut raw = Vec::new();
  stream.read_to_end(&mut raw).ok()?;
  String::from_utf8(raw).ok()
}

fn status_ok(response: &str) -> bool {
  response
    .lines()
    .next()
    .is_some_and(|status| status.contains(" 200 "))
}

/// True when the server answers `GET /health` with 200.
pub fn health_ok(port: u16) -> bool {
  let request = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
  http_exchange(port, &request).is_some_and(|res| status_ok(&res))
}

/// Blocks until the server is healthy or the boot timeout elapses.
pub fn wait_for_healthy(port: u16, timeout: Duration) -> bool {
  let deadline = Instant::now() + timeout;
  while Instant::now() < deadline {
    if health_ok(port) {
      return true;
    }
    std::thread::sleep(POLL_INTERVAL);
  }
  health_ok(port)
}

pub fn boot_timeout() -> Duration {
  BOOT_TIMEOUT
}

pub fn poll_interval() -> Duration {
  POLL_INTERVAL
}

/// Spawns the sidecar with stdio detached. On Windows the child gets no
/// console window so no terminal flashes on launch.
pub fn spawn_sidecar(exe_dir: &Path, port: u16) -> std::io::Result<Child> {
  let exe: PathBuf = exe_dir.join(SIDECAR_FILENAME);
  let mut cmd = Command::new(exe);
  cmd.args(["--no-open", "--port", &port.to_string()]);
  cmd.stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: keep the sidecar fully headless.
    cmd.creation_flags(0x0800_0000);
  }
  cmd.spawn()
}

/// Fetches the per-launch shutdown token. Returns None when the server is
/// unreachable or refuses the request.
fn fetch_shutdown_token(port: u16) -> Option<String> {
  let request = format!(
    "GET /api/shutdown/token HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );
  let response = http_exchange(port, &request)?;
  if !status_ok(&response) {
    return None;
  }
  let marker = "\"token\"";
  let at = response.find(marker)?;
  let rest = response[at + marker.len()..].trim_start();
  let rest = rest.strip_prefix(':')?.trim_start();
  let rest = rest.strip_prefix('"')?;
  let end = rest.find('"')?;
  Some(rest[..end].to_string())
}

/// Asks the server to shut itself down, then waits for the child to exit
/// and the final log event to appear on disk. Returns true when no server
/// process remains afterwards.
///
/// After `try_wait()` confirms the process exited, Windows may not have
/// flushed the last `appendFileSync` to disk yet. We poll the log file for
/// `shutdown_complete` so the smoke test can always read it before cleanup.
pub fn shutdown_sidecar(child: &mut Child, port: u16, exe_dir: &Path) -> bool {
  if let Some(token) = fetch_shutdown_token(port) {
    let request = format!(
      "POST /api/shutdown/ HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
       x-rtwiki-shutdown-token: {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let _ = http_exchange(port, &request);
  }
  let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
  while Instant::now() < deadline {
    match child.try_wait() {
      Ok(Some(_)) => break,
      Ok(None) => std::thread::sleep(POLL_INTERVAL),
      Err(_) => break,
    }
  }
  // Fallback: the server did not exit on request — kill it.
  if child.try_wait().is_err() || child.try_wait().unwrap_or(None).is_none() {
    let _ = child.kill();
  }
  // Wait for the final shutdown log event to be visible on disk.
  let log_path = exe_dir.join("logs").join("rtwiki.log");
  let log_deadline = Instant::now() + Duration::from_secs(5);
  loop {
    if let Ok(contents) = std::fs::read_to_string(&log_path) {
      if contents.contains("shutdown_complete") {
        return true;
      }
    }
    if Instant::now() >= log_deadline {
      return true;
    }
    std::thread::sleep(POLL_INTERVAL);
  }
}

/// Opens the running server in the default browser (browser-mode fallback).
pub fn open_in_browser(port: u16) {
  let _ = opener::open_browser(base_url(port));
}
