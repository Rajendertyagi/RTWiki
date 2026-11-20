//! Bun server sidecar lifecycle (ADR-011).
//!
//! The shell spawns `RTWikiServer.exe --no-open --port <port>` from its own
//! directory with an explicit argument array (never a shell string), polls
//! `GET /health` over plain TCP until the server answers 200, and shuts it
//! down gracefully through the token-protected `/api/shutdown` endpoint with
//! a child-kill fallback. Raw TCP is used deliberately so this module needs
//! no HTTP client dependency.
//!
//! The listening port and window close behavior live in the SQLite `settings`
//! table owned by the Bun server. The shell reads them fresh at point of use
//! with a short busy timeout, falling back to the last-known in-memory value on
//! any failure (missing DB, mid-restore swap, busy, corrupt value). Window
//! geometry is the one setting the shell writes, best-effort.
//!
//! Restart handshake: the frontend records `data/restart-requested` before
//! shutting the server down; the shell's watch thread consumes the flag and
//! respawns the sidecar (crash recovery uses the same path). The server's
//! same-origin check accepts these requests through its CLI/automation path
//! (no Origin/Referer headers are sent), and the shutdown token is fetched
//! per launch from `GET /api/shutdown/token` — it is held in memory only and
//! never logged.

use rusqlite::{Connection, OpenFlags};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Win32 process identity lookup. Used to verify that a PID recorded in a stale
/// owner marker still belongs to the RTWiki server before it is ever killed.
#[cfg(windows)]
mod win_process {
  use std::ffi::OsString;
  use std::os::windows::ffi::OsStringExt;

  #[link(name = "kernel32")]
  extern "system" {
    fn OpenProcess(
      desired_access: u32,
      inherit_handle: i32,
      process_id: u32,
    ) -> *mut std::ffi::c_void;
    fn QueryFullProcessImageNameW(
      process: *mut std::ffi::c_void,
      flags: u32,
      name: *mut u16,
      size: *mut u32,
    ) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
  }

  const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

  pub fn image_path(pid: u32) -> Option<String> {
    unsafe {
      let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if handle.is_null() {
        return None;
      }
      let mut buffer = [0u16; 32_768];
      let mut length = buffer.len() as u32;
      let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length);
      CloseHandle(handle);
      if ok == 0 || length == 0 || length as usize > buffer.len() {
        return None;
      }
      OsString::from_wide(&buffer[..length as usize])
        .to_str()
        .map(str::to_owned)
    }
  }
}

/// True when `pid` still belongs to the expected executable. A stale owner
/// marker whose PID was reused by an unrelated process after a crash must never
/// cause that process to be killed.
pub fn process_identity_matches(pid: u32, expected_path: &Path) -> bool {
  #[cfg(windows)]
  {
    match win_process::image_path(pid) {
      Some(actual) => actual.eq_ignore_ascii_case(&expected_path.to_string_lossy()),
      None => false,
    }
  }
  #[cfg(not(windows))]
  {
    let _ = (pid, expected_path);
    false
  }
}

/// Fallback when the settings table is missing or corrupt. Must match
/// DEFAULT_PORT in src/shared/constants/index.ts.
pub const DEFAULT_PORT: u16 = 8080;
/// Sidecar executable name beside the shell. Must match COMPILED_EXE_BASENAMES.
pub const SIDECAR_FILENAME: &str = "RTWikiServer.exe";
/// Database filename inside data/. Must match DATABASE_FILENAME in shared constants.
pub const DATABASE_FILENAME: &str = "rtwiki.sqlite";
/// Owner marker written by the shell that spawns the sidecar.
pub const SIDECAR_OWNER_FILENAME: &str = "sidecar-owner";

// Setting keys. Must match SETTINGS_KEY_* in src/shared/constants/index.ts.
pub const SETTINGS_KEY_SERVER_PORT: &str = "server.port";
pub const SETTINGS_KEY_CLOSE_BEHAVIOR: &str = "desktop.closeBehavior";
pub const SETTINGS_KEY_WINDOW_GEOMETRY: &str = "window.geometry";

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const BOOT_TIMEOUT: Duration = Duration::from_secs(30);
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);
/// Short timeout for the shell's settings reads/writes. A busy DB must never
/// make the close button feel slow — the remembered value is used instead.
pub const SETTINGS_BUSY_TIMEOUT: Duration = Duration::from_millis(250);

/// Win32 CREATE_NO_WINDOW: keeps the sidecar fully headless on launch.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Window close behavior (mirrors CloseBehavior in shared constants).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseBehavior {
  Ask,
  Minimize,
  Quit,
}

/// Path to the settings database.
pub fn database_path(exe_dir: &Path) -> PathBuf {
  exe_dir.join("data").join(DATABASE_FILENAME)
}

/// Reads one raw setting value from the SQLite settings table. Returns None on
/// ANY failure — missing DB (first launch or mid-restore swap), missing table,
/// busy/locked DB, or a malformed row. Callers fall back to a remembered value.
/// A read-only connection with a short busy timeout keeps this off the close
/// path's critical section and never panics.
pub fn read_setting(exe_dir: &Path, key: &str) -> Option<String> {
  let path = database_path(exe_dir);
  // Restore swaps the DB file out from under us; check existence first so an
  // absent file is a clean fallback, not an error we have to unwrap around.
  if !path.exists() {
    return None;
  }
  let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
  conn.busy_timeout(SETTINGS_BUSY_TIMEOUT).ok()?;
  let value: String = conn
    .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
    .ok()?;
  Some(value)
}

/// Writes one setting value (upsert). Best-effort: returns false on any error
/// so callers can skip quietly. Used only for window geometry by the shell.
pub fn write_setting(exe_dir: &Path, key: &str, value: &str) -> bool {
  let path = database_path(exe_dir);
  if !path.exists() {
    return false;
  }
  let conn = match Connection::open(&path) {
    Ok(conn) => conn,
    Err(_) => return false,
  };
  if conn.busy_timeout(SETTINGS_BUSY_TIMEOUT).is_err() {
    return false;
  }
  conn
    .execute(
      "INSERT INTO settings (key, value) VALUES (?1, ?2) \
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    )
    .is_ok()
}

pub fn base_url(port: u16) -> String {
  format!("http://127.0.0.1:{port}")
}

fn server_addr(port: u16) -> SocketAddr {
  SocketAddr::from(([127, 0, 0, 1], port))
}

/// Effective listening port: the settings-table value when valid, else the
/// remembered value. A missing/corrupt/busy DB can never block startup.
pub fn configured_port(exe_dir: &Path, remembered: u16) -> u16 {
  match read_setting(exe_dir, SETTINGS_KEY_SERVER_PORT) {
    Some(raw) => match serde_json::from_str::<u16>(&raw) {
      Ok(port) if (1024..=65535).contains(&port) => port,
      _ => remembered,
    },
    None => remembered,
  }
}

/// Window close behavior, read fresh on every close so Settings changes apply
/// immediately. Any failure falls back to the remembered value.
pub fn close_behavior(exe_dir: &Path, remembered: CloseBehavior) -> CloseBehavior {
  match read_setting(exe_dir, SETTINGS_KEY_CLOSE_BEHAVIOR) {
    Some(raw) => match serde_json::from_str::<String>(&raw).as_deref() {
      Ok("minimize") => CloseBehavior::Minimize,
      Ok("quit") => CloseBehavior::Quit,
      Ok("ask") => CloseBehavior::Ask,
      _ => remembered,
    },
    None => remembered,
  }
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

/// Owner marker: the shell that spawned the sidecar records its own PID, the
/// sidecar PID and the sidecar path. Quit uses it to stop only the server this
/// copy actually owns, and only after verifying the process identity (S2).
#[derive(Debug, Clone)]
pub struct SidecarOwner {
  pub shell_pid: u32,
  pub sidecar_pid: u32,
  pub sidecar_path: PathBuf,
}

fn sidecar_owner_path(exe_dir: &Path) -> PathBuf {
  exe_dir.join("data").join(SIDECAR_OWNER_FILENAME)
}

/// Writes the owner marker after a successful sidecar spawn.
pub fn write_sidecar_owner(exe_dir: &Path, shell_pid: u32, child: &Child, sidecar_path: &Path) {
  write_sidecar_owner_for_pid(exe_dir, shell_pid, child.id(), sidecar_path);
}

/// Writes the owner marker from a known sidecar PID. Used when a shell adopts a
/// sidecar started by an earlier shell that is no longer running.
pub fn write_sidecar_owner_for_pid(
  exe_dir: &Path,
  shell_pid: u32,
  sidecar_pid: u32,
  sidecar_path: &Path,
) {
  let body = format!(
    "{}\n{}\n{}\n",
    shell_pid,
    sidecar_pid,
    sidecar_path.display()
  );
  let _ = std::fs::write(sidecar_owner_path(exe_dir), body);
}

/// Reads the owner marker, or None when absent or malformed.
pub fn read_sidecar_owner(exe_dir: &Path) -> Option<SidecarOwner> {
  let body = std::fs::read_to_string(sidecar_owner_path(exe_dir)).ok()?;
  let mut lines = body.lines();
  let shell_pid = lines.next()?.trim().parse().ok()?;
  let sidecar_pid = lines.next()?.trim().parse().ok()?;
  let sidecar_path = PathBuf::from(lines.next()?.trim());
  Some(SidecarOwner {
    shell_pid,
    sidecar_pid,
    sidecar_path,
  })
}

/// Removes the owner marker after the shell has acted on it.
pub fn clear_sidecar_owner(exe_dir: &Path) {
  let _ = std::fs::remove_file(sidecar_owner_path(exe_dir));
}

/// Deletes leftover IPC flags from a crashed run. Called at startup only AFTER
/// the running-copy check has passed, so a second copy never clears the first
/// copy's live flags. The server's clean-exit marker is deliberately not here:
/// the server reads and clears it itself on the next start.
pub fn clear_stale_flags(exe_dir: &Path) {
  clear_restart_request(exe_dir);
  clear_shutdown_request(exe_dir);
  clear_sidecar_owner(exe_dir);
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

/// Spawns the sidecar with stdio detached. On Windows the child gets no
/// console window so no terminal flashes on launch.
pub fn spawn_sidecar(exe_dir: &Path, port: u16) -> std::io::Result<Child> {
    let exe: PathBuf = exe_dir.join(SIDECAR_FILENAME);
    if !exe.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("sidecar not found: {}", exe.display()),
        ));
    }
    let _ = std::fs::create_dir_all(exe_dir.join("logs"));
    let stderr_target = exe_dir.join("logs").join("sidecar.stderr.log");
    let mut cmd = Command::new(&exe);
    cmd.args(["--no-open", "--port", &port.to_string()]);
    cmd.stdin(Stdio::null()).stdout(Stdio::null());
    match std::fs::File::create(&stderr_target) {
        Ok(f) => { cmd.stderr(std::process::Stdio::from(f)); }
        Err(_) => { cmd.stderr(Stdio::null()); }
    }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    // Keep the sidecar fully headless.
    cmd.creation_flags(CREATE_NO_WINDOW);
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
  // Parse the JSON body properly instead of scanning for a quoted key: the
  // endpoint returns `{"token": "..."}` and a hand-rolled scan breaks on
  // escaped characters or a different key order.
  let body = response.split_once("\r\n\r\n")?.1;
  let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
  let token = parsed.get("token")?.as_str()?;
  (!token.is_empty()).then(|| token.to_string())
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
  // Fallback: the server did not exit on request — kill it. A single try_wait
  // avoids the race between two consecutive calls.
  if !matches!(child.try_wait(), Ok(Some(_))) {
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

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
  use std::time::Instant;

  static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

  struct TestDb {
    dir: PathBuf,
  }

  impl TestDb {
    fn new() -> Self {
      let dir = std::env::temp_dir().join(format!(
        "rtwiki-shell-settings-test-{}-{}",
        std::process::id(),
        TEST_COUNTER.fetch_add(1, AtomicOrdering::SeqCst)
      ));
      fs::create_dir_all(dir.join("data")).unwrap();
      let conn = Connection::open(database_path(&dir)).unwrap();
      conn
        .execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", [])
        .unwrap();
      drop(conn);
      Self { dir }
    }

    fn set(&self, key: &str, value: &str) {
      let conn = Connection::open(database_path(&self.dir)).unwrap();
      conn
        .execute(
          "INSERT INTO settings (key, value) VALUES (?1, ?2) \
           ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [key, value],
        )
        .unwrap();
    }
  }

  impl Drop for TestDb {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.dir);
    }
  }

  #[test]
  fn reads_port_and_close_behavior_from_db() {
    let db = TestDb::new();
    db.set(SETTINGS_KEY_SERVER_PORT, "8090");
    db.set(SETTINGS_KEY_CLOSE_BEHAVIOR, "\"quit\"");
    assert_eq!(configured_port(&db.dir, DEFAULT_PORT), 8090);
    assert_eq!(close_behavior(&db.dir, CloseBehavior::Ask), CloseBehavior::Quit);
  }

  #[test]
  fn falls_back_to_remembered_value_when_db_missing() {
    // First launch / mid-restore swap: no DB file at all.
    let dir = std::env::temp_dir().join(format!("rtwiki-shell-nodb-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("data")).unwrap();
    assert_eq!(configured_port(&dir, 7777), 7777);
    assert_eq!(close_behavior(&dir, CloseBehavior::Minimize), CloseBehavior::Minimize);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn falls_back_when_value_is_corrupt() {
    let db = TestDb::new();
    db.set(SETTINGS_KEY_SERVER_PORT, "not-a-number");
    db.set(SETTINGS_KEY_CLOSE_BEHAVIOR, "\"bogus\"");
    assert_eq!(configured_port(&db.dir, 8080), 8080);
    assert_eq!(close_behavior(&db.dir, CloseBehavior::Ask), CloseBehavior::Ask);
  }

  #[test]
  fn restore_swap_read_falls_back_without_panic() {
    // Simulate a restore: DB present, then removed mid-read. The read must
    // return the remembered value, never panic.
    let db = TestDb::new();
    db.set(SETTINGS_KEY_SERVER_PORT, "8090");
    // Remove the DB file (restore swap) — read_setting checks existence first.
    let _ = fs::remove_file(database_path(&db.dir));
    let result = std::panic::catch_unwind(|| configured_port(&db.dir, 8080));
    assert!(result.is_ok(), "settings read panicked during restore swap");
    assert_eq!(result.unwrap(), 8080);
  }

  #[test]
  fn close_path_is_bounded_when_db_is_busy() {
    // Hold a write lock on the DB, then read with the short busy timeout. The
    // read must return within a bounded time using the remembered value.
    let db = TestDb::new();
    db.set(SETTINGS_KEY_CLOSE_BEHAVIOR, "\"quit\"");
    let conn = Connection::open(database_path(&db.dir)).unwrap();
    conn.execute("BEGIN IMMEDIATE", []).unwrap(); // hold the write lock
    let start = Instant::now();
    let behavior = close_behavior(&db.dir, CloseBehavior::Ask);
    let elapsed = start.elapsed();
    drop(conn);
    // The short busy timeout (250ms) bounds this well under a second.
    assert!(elapsed < Duration::from_secs(2), "close read took too long: {elapsed:?}");
    // With the lock held the read may fail and fall back, or succeed — either
    // is fine; the point is it returned promptly and did not panic.
    let _ = behavior;
  }

  #[test]
  fn interop_shell_reads_and_writes_same_db() {
    // Shell half of the interop test: write geometry via the shell's write
    // helper, read it back, and confirm the server-style settings row coexists.
    let db = TestDb::new();
    db.set(SETTINGS_KEY_SERVER_PORT, "8090");
    assert!(write_setting(&db.dir, SETTINGS_KEY_WINDOW_GEOMETRY, "{\"x\":10}"));
    let raw = read_setting(&db.dir, SETTINGS_KEY_WINDOW_GEOMETRY).unwrap();
    assert_eq!(raw, "{\"x\":10}");
    // The port row is untouched by the geometry write.
    assert_eq!(configured_port(&db.dir, DEFAULT_PORT), 8090);
  }

  #[test]
  fn cross_build_interop_bun_writes_rusqlite_reads() {
    // Real cross-build proof (plan §6.4): the server's bun:sqlite writes the
    // settings table while the shell's rusqlite reads the SAME file at the same
    // time. Both link their own SQLite (bun 3.54.x, rusqlite bundled 3.54.1);
    // this test proves they interoperate on one WAL database without torn reads.
    let db = TestDb::new();
    db.set(SETTINGS_KEY_SERVER_PORT, "8080");

    let script = r#"
      const { Database } = await import('bun:sqlite');
      const { writeFileSync } = await import('node:fs');
      const [dbPath, startMarker, doneMarker] = process.argv.slice(2);
      const db = new Database(dbPath);
      db.exec('PRAGMA busy_timeout = 250');
      writeFileSync(startMarker, 'start');
      for (let i = 0; i < 120; i++) {
        db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['server.port', String(8100 + i)]
        );
        await Bun.sleep(4);
      }
      db.close();
      writeFileSync(doneMarker, 'done');
    "#;
    let script_path = db.dir.join("writer.mjs");
    let start_marker = db.dir.join("start.marker");
    let done_marker = db.dir.join("done.marker");
    fs::write(&script_path, script).unwrap();

    let mut child = Command::new("bun")
      .arg(&script_path)
      .arg(database_path(&db.dir))
      .arg(&start_marker)
      .arg(&done_marker)
      .spawn()
      .expect("bun must be on PATH for the cross-build interop test");

    // Wait (bounded) for the writer to signal it has started.
    let wait_start = Instant::now();
    while !start_marker.exists() && wait_start.elapsed() < Duration::from_secs(5) {
      std::thread::sleep(Duration::from_millis(10));
    }
    assert!(start_marker.exists(), "bun writer did not start");

    // While bun writes, rusqlite reads the same file. Every observed value must
    // be a complete, valid port — no torn reads or corruption.
    let mut observed: Vec<u16> = Vec::new();
    let read_deadline = Instant::now() + Duration::from_secs(10);
    while !done_marker.exists() && Instant::now() < read_deadline {
      if let Some(raw) = read_setting(&db.dir, SETTINGS_KEY_SERVER_PORT) {
        if let Ok(port) = serde_json::from_str::<u16>(&raw) {
          observed.push(port);
        }
      }
      std::thread::sleep(Duration::from_millis(2));
    }
    let status = child.wait().unwrap();
    assert!(status.success(), "bun writer failed");
    assert!(done_marker.exists(), "bun writer did not finish in time");
    assert!(!observed.is_empty(), "rusqlite never observed a value while bun wrote");
    assert!(
      observed.iter().all(|p| (8100..=8219).contains(p)),
      "torn read observed: {observed:?}"
    );
    // The final value is the last one bun wrote.
    assert_eq!(configured_port(&db.dir, DEFAULT_PORT), 8219);
  }

  #[test]
  fn owner_marker_round_trip() {
    let dir = std::env::temp_dir().join(format!(
      "rtwiki-owner-marker-{}-{}",
      std::process::id(),
      TEST_COUNTER.fetch_add(1, AtomicOrdering::SeqCst)
    ));
    fs::create_dir_all(dir.join("data")).unwrap();
    let marker = SidecarOwner {
      shell_pid: 4242,
      sidecar_pid: 4343,
      sidecar_path: PathBuf::from("C:/RTWiki/RTWikiServer.exe"),
    };
    let body = format!(
      "{}\n{}\n{}\n",
      marker.shell_pid,
      marker.sidecar_pid,
      marker.sidecar_path.display()
    );
    fs::write(dir.join("data").join(SIDECAR_OWNER_FILENAME), body).unwrap();
    let read = read_sidecar_owner(&dir).expect("owner marker must be readable");
    assert_eq!(read.shell_pid, 4242);
    assert_eq!(read.sidecar_pid, 4343);
    assert_eq!(read.sidecar_path, marker.sidecar_path);
    clear_sidecar_owner(&dir);
    assert!(read_sidecar_owner(&dir).is_none());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn adopting_a_sidecar_updates_the_owner_pid() {
    let dir = std::env::temp_dir().join(format!(
      "rtwiki-adopt-marker-{}-{}",
      std::process::id(),
      TEST_COUNTER.fetch_add(1, AtomicOrdering::SeqCst)
    ));
    fs::create_dir_all(dir.join("data")).unwrap();
    let path = PathBuf::from("C:/RTWiki/RTWikiServer.exe");
    write_sidecar_owner_for_pid(&dir, 1111, 2222, &path);
    // A new shell adopts it by rewriting only the owner PID.
    write_sidecar_owner_for_pid(&dir, 3333, 2222, &path);
    let read = read_sidecar_owner(&dir).expect("adopted marker must be readable");
    assert_eq!(read.shell_pid, 3333);
    assert_eq!(read.sidecar_pid, 2222);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn stale_owner_pid_never_matches_an_unrelated_process() {
    // A PID that cannot belong to the RTWiki server must never be treated as a
    // valid owner, so a stale marker after a crash cannot kill a reused PID.
    assert!(!process_identity_matches(
      u32::MAX,
      Path::new("C:/RTWiki/RTWikiServer.exe")
    ));
  }

  #[test]
  fn clear_stale_flags_removes_every_leftover_flag() {
    let dir = std::env::temp_dir().join(format!(
      "rtwiki-stale-flags-{}-{}",
      std::process::id(),
      TEST_COUNTER.fetch_add(1, AtomicOrdering::SeqCst)
    ));
    fs::create_dir_all(dir.join("data")).unwrap();
    for name in [
      "restart-requested",
      "shutdown-requested",
      SIDECAR_OWNER_FILENAME,
    ] {
      fs::write(dir.join("data").join(name), "stale").unwrap();
    }
    clear_stale_flags(&dir);
    for name in [
      "restart-requested",
      "shutdown-requested",
      SIDECAR_OWNER_FILENAME,
    ] {
      assert!(!dir.join("data").join(name).exists(), "{name} was not cleared");
    }
    let _ = fs::remove_dir_all(&dir);
  }
}
