//! RTWiki desktop shell (ADR-011).
//!
//! A thin Tauri 2 + WebView2 host for the existing web UI. The shell owns only
//! native concerns — window, tray icon, autostart registration, portable
//! window geometry, and the Bun server sidecar lifecycle. All application
//! logic stays in the Hono backend; the webview loads the same loopback URL
//! a browser would.
//!
//! Process model:
//! ```text
//! RTWiki.exe (this shell)
//!   ├─ reads the SQLite settings table for the listening port (Settings-managed)
//!   ├─ spawns RTWikiServer.exe --no-open --port <port>   (sidecar.rs)
//!   ├─ polls GET /health until 200, then shows the window
//!   ├─ watch thread respawns the sidecar on restart request or crash
//!   └─ on Quit: graceful shutdown (token) then child-kill fallback
//! ```
//! Closing the window follows the SQLite `desktop.closeBehavior` setting (ask / minimize / quit).
//! `RTWiki.exe --browser` keeps browser mode: no window, tray stays resident.
//!
//! Handshake flags in data/ (mirrored by the server, ADR-011):
//! - `restart-requested`  — respawn the sidecar with the freshly saved port.
//! - `shutdown-requested` — the server exited deliberately after an authorized
//!   shutdown, so the watch thread must NOT respawn it. Both flags are cleared
//!   at boot; a flag left behind by a crash is never state to resume.
//!
//! Custom window chrome: on Windows the native title bar is removed
//! (`decorations(false)`); the frontend renders its own title bar + tab strip
//! via `<WindowChrome>` in `src/web/components/window-chrome.tsx`. Close
//! behaviour is read fresh from Rust on every click via the
//! `get_close_behavior` invoke command so Settings changes apply without restart.
//!
//! The Rust-side `on_close_request` handler acts as a safety net: it fires
//! whenever `win.close()` is called (including from the JS chrome), so the
//! behaviour is always honoured even if the JS component fails to load.

mod geom;
mod sidecar;

/// Event emitted to the frontend when a window close needs confirmation.
/// Mirrored by the in-app close dialog in close-dialog.tsx.
const CLOSE_REQUEST_EVENT: &str = "rtwiki:close-request";

/// How long a close prompt may go unanswered before it is treated as lost and
/// the safe default (hide to tray) is applied. Prevents a dead close button.
const CLOSE_PROMPT_GRACE: Duration = Duration::from_secs(10);

/// Outcome of trying to claim the single outstanding close prompt.
enum ClosePromptClaim {
  Granted,
  /// A dialog is already up; this press is a duplicate.
  Duplicate,
  /// No state or a poisoned lock; fall back to the safe default.
  Unavailable,
}

use sidecar::CloseBehavior;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::process::Child;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

// Bounds for the shell's own log file (S3): a portable app must not slowly fill
// the drive. Mirrors SHELL_LOG_MAX_BYTES / SHELL_LOG_MAX_ROTATED_FILES in shared
// constants (Rust cannot import TypeScript, so these are mirrored deliberately).
const SHELL_LOG_MAX_BYTES: u64 = 512 * 1024;
const SHELL_LOG_MAX_ROTATED_FILES: usize = 3;
const SHELL_LOG_FILENAME: &str = "rtwiki-shell.log";

/// A tiny file logger built on the existing `log` crate facade — no new
/// dependency. Writes one line per event to logs/rtwiki-shell.log with bounded
/// rotation so a long-running portable app cannot fill the drive.
struct ShellLogger {
  dir: Mutex<Option<PathBuf>>,
  current_size: Mutex<u64>,
}

/// Static logger instance: `log::set_logger` needs a `'static` reference, and
/// this avoids enabling the `alloc` feature of the `log` crate (no new deps).
static SHELL_LOGGER: ShellLogger = ShellLogger {
  dir: Mutex::new(None),
  current_size: Mutex::new(0),
};

fn shell_log_timestamp() -> String {
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  // Compact UTC-ish stamp; precision to the second is enough for a step trail.
  format!("{}", secs)
}

fn rotate_shell_logs(dir: &Path) {
  let base = dir.join(SHELL_LOG_FILENAME);
  for i in (1..SHELL_LOG_MAX_ROTATED_FILES).rev() {
    let from = base.with_extension(format!("log.{}", i));
    let to = base.with_extension(format!("log.{}", i + 1));
    if from.exists() {
      let _ = std::fs::rename(&from, &to);
    }
  }
  let first = base.with_extension("log.1");
  if base.exists() {
    let _ = std::fs::rename(&base, &first);
  }
}

impl log::Log for ShellLogger {
  fn enabled(&self, metadata: &log::Metadata) -> bool {
    metadata.level() <= log::Level::Info
  }

  fn log(&self, record: &log::Record) {
    if !self.enabled(record.metadata()) {
      return;
    }
    let Ok(dir_guard) = self.dir.lock() else {
      return;
    };
    let Some(dir) = dir_guard.as_ref() else {
      return;
    };
    let path = dir.join(SHELL_LOG_FILENAME);
    let line = format!(
      "{} [{}] {}\n",
      shell_log_timestamp(),
      record.level(),
      record.args()
    );
    let Ok(mut size) = self.current_size.lock() else {
      return;
    };
    let on_disk = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if on_disk + line.len() as u64 > SHELL_LOG_MAX_BYTES {
      rotate_shell_logs(dir);
      *size = 0;
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
      if file.write_all(line.as_bytes()).is_ok() {
        *size += line.len() as u64;
      }
    }
  }

  fn flush(&self) {}
}

/// Installs the shell logger. Called once at the start of main, before any
/// plugin or setup work, so every step can be logged.
fn init_shell_logger(exe_dir: &Path) {
  let dir = exe_dir.join("logs");
  let _ = std::fs::create_dir_all(&dir);
  if let Ok(mut guard) = SHELL_LOGGER.dir.lock() {
    *guard = Some(dir);
  }
  if log::set_logger(&SHELL_LOGGER).is_ok() {
    log::set_max_level(log::LevelFilter::Info);
  }
}

/// Shared shell state stored in Tauri's managed state.
struct ShellState {
  exe_dir: PathBuf,
  port: Mutex<u16>,
  own_sidecar: Mutex<bool>,
  child: Mutex<Option<Child>>,
  quitting: Mutex<bool>,
  last_geometry_save: Mutex<Instant>,
  /// Set by the in-app close dialog on mount; without a listener, emitting a
  /// close request would show nothing and leave the press unanswered.
  close_prompt_ready: AtomicBool,
  /// Timestamp of an outstanding close prompt, used to ignore duplicate presses
  /// and to expire a prompt that never reached a listener.
  close_prompt_open: Mutex<Option<Instant>>,
  /// Guards the one-time reveal of the main window after the app page loads.
  window_revealed: AtomicBool,
  /// Last-known close behavior, used as fallback when the DB read fails.
  close_behavior: Mutex<CloseBehavior>,
  /// Makes graceful shutdown idempotent across window close, menu quit, restart
  /// and system shutdown (ExitRequested).
  shutdown_done: AtomicBool,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
  app.get_webview_window("main")
}

fn shell_port(app: &AppHandle) -> u16 {
  app
    .try_state::<ShellState>()
    .and_then(|s| s.port.lock().ok().map(|guard| *guard))
    .unwrap_or(sidecar::DEFAULT_PORT)
}

fn show_main(app: &AppHandle) {
  if let Some(window) = main_window(app) {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

/// Reveals the main window exactly once, after the real app page has loaded.
/// Both the page-load handler and the safety timeout call this; the atomic
/// guard makes the first caller win and later ones no-ops.
fn reveal_main_window(app: &AppHandle) {
  let Some(state) = app.try_state::<ShellState>() else {
    return;
  };
  if state
    .window_revealed
    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
    .is_err()
  {
    return;
  }
  show_main(app);
}

fn save_geometry(app: &AppHandle) {
  if let (Some(window), Some(state)) = (main_window(app), app.try_state::<ShellState>()) {
    geom::save_current(&state.exe_dir, &window);
  }
}

/// Persist geometry on move/resize, throttled so a drag does not write the file
/// on every event. Close/quit remain the authoritative, unthrottled final write.
fn maybe_save_geometry(app: &AppHandle) {
  let Some(state) = app.try_state::<ShellState>() else {
    return;
  };
  let Ok(mut last) = state.last_geometry_save.lock() else {
    return;
  };
  let now = Instant::now();
  if now.duration_since(*last) < geom::SAVE_THROTTLE {
    return;
  }
  if let Some(window) = main_window(app) {
    geom::save_current(&state.exe_dir, &window);
  }
  *last = now;
}

/// Safely take the child process out of state (if any) and return it.
/// This recovers from poisoned locks idiomatically.
fn take_child_from_state(state: &ShellState) -> Option<Child> {
  state.child.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Safely set the quitting flag to true.
fn set_quitting(state: &ShellState) {
  *state.quitting.lock().unwrap_or_else(|e| e.into_inner()) = true;
}

/// Emit an event to the frontend and log the message.
/// Frontend should listen for `sidecar:error` to show actionable UI.
fn report_error(app: &AppHandle, message: &str) {
  log::error!("{}", message);
  // Tauri 2 uses `emit` instead of the deprecated `emit_all`
  let _ = app.emit("sidecar:error", message.to_string());
}

/// Attempt to gracefully shutdown a child process; return Result to caller.
/// Wraps sidecar::shutdown_sidecar (sync) and falls back to kill on failure.
fn try_shutdown_child(child: &mut Child, port: u16, exe_dir: &PathBuf) -> Result<(), String> {
  match sidecar::shutdown_sidecar(child, port, exe_dir) {
    true => Ok(()),
    false => {
      log::warn!("Graceful shutdown of sidecar failed; forcing process kill.");
      let _ = child.kill();
      Err("Failed to gracefully shutdown sidecar; killed child.".to_string())
    }
  }
}

/// Pure decision: stop the sidecar only when this shell owns it and the recorded
/// PID still belongs to the expected executable. Extracted so it can be tested
/// without a live Tauri AppHandle.
fn should_stop_sidecar(owner: Option<&sidecar::SidecarOwner>, shell_pid: u32) -> bool {
  match owner {
    Some(marker) => {
      marker.shell_pid == shell_pid
        && sidecar::process_identity_matches(marker.sidecar_pid, &marker.sidecar_path)
    }
    None => false,
  }
}

/// Graceful shutdown, shared by every normal close path: window close, quit
/// menu, restart and system shutdown (ExitRequested). Idempotent — the first
/// caller wins and later ones are no-ops.
///
/// Order: best-effort geometry → stop the server only when this copy owns it
/// (verified by the owner marker and process identity) → remove flag files →
/// exit. Never hangs: the sidecar shutdown is bounded in sidecar.rs.
fn graceful_shutdown(app: &AppHandle, reason: &str) {
  let Some(state) = app.try_state::<ShellState>() else {
    log::warn!("Graceful shutdown ({reason}) with no shell state");
    return;
  };
  if state
    .shutdown_done
    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
    .is_err()
  {
    return;
  }
  log::info!("Graceful shutdown started ({reason})");
  set_quitting(&state);

  // 1. Best-effort window position. Never blocks close (bounded DB timeout).
  save_geometry(app);
  log::info!("Graceful shutdown: window position saved");

  let exe_dir = state.exe_dir.clone();
  let port = *state.port.lock().unwrap_or_else(|e| e.into_inner());

  // 2. Stop the server only when no other copy is using it. The owner marker
  // records the owning shell PID and the sidecar PID/path; the PID is verified
  // against the live process image so a stale marker after a crash can never
  // kill an unrelated process that reused the number (S2).
  let owner = sidecar::read_sidecar_owner(&exe_dir);
  let should_stop = should_stop_sidecar(owner.as_ref(), std::process::id());

  if should_stop {
    let child = take_child_from_state(&state);
    if let Some(mut child) = child {
      if let Err(e) = try_shutdown_child(&mut child, port, &exe_dir) {
        report_error(app, &e);
      }
    } else {
      // We own the marker but have no child handle (e.g. shell restarted while
      // the sidecar survived). Stop the recorded PID directly, identity already
      // verified above.
      if let Some(marker) = &owner {
        log::info!("Stopping owned sidecar PID {} without a child handle", marker.sidecar_pid);
        #[cfg(windows)]
        {
          use std::os::windows::process::CommandExt;
          match std::process::Command::new("taskkill")
            .args(["/PID", &marker.sidecar_pid.to_string(), "/F"])
            .creation_flags(0x0800_0000)
            .status()
          {
            Ok(status) if status.success() => {
              log::info!("taskkill stopped sidecar PID {}", marker.sidecar_pid);
            }
            Ok(status) => {
              log::warn!("taskkill failed to stop sidecar PID {}: {status}", marker.sidecar_pid);
            }
            Err(e) => {
              log::warn!("taskkill could not be launched for sidecar PID {}: {e}", marker.sidecar_pid);
            }
          }
        }
      }
    }
    // Only the owner clears the marker. A shell that attached to another copy's
    // sidecar must leave the owner's marker intact, or the real owner will later
    // read no marker, conclude it does not own the sidecar, and orphan it (A3).
    sidecar::clear_sidecar_owner(&exe_dir);
    log::info!("Graceful shutdown: owned sidecar stopped");
  } else {
    log::info!("Graceful shutdown: sidecar not owned by this copy; leaving it running and preserving the owner marker");
  }

  // 3. Remove IPC flag files after acting on them. These are per-launch signals,
  // not ownership, so they are cleared unconditionally. The owner marker is
  // deliberately NOT here — only the owning branch above clears it.
  sidecar::clear_restart_request(&exe_dir);
  sidecar::clear_shutdown_request(&exe_dir);
  log::info!("Graceful shutdown complete ({reason})");
}

fn quit_app(app: &AppHandle) {
  graceful_shutdown(app, "quit");
  app.exit(0);
}

/// Show a blocking fatal dialog on the main thread and exit.
/// Use sparingly; prefer `report_error` so the UI can present actions.
fn fatal(app: &AppHandle, message: String) -> ! {
  let handle = app.clone();
  if handle
    .clone()
    .run_on_main_thread(move || {
      handle
        .dialog()
        .message(message)
        .title("RTWiki")
        .kind(MessageDialogKind::Error)
        .blocking_show();
      // Graceful exit only after the user has dismissed the dialog.
      handle.exit(1);
    })
    .is_err()
  {
    // The main thread is gone, so no dialog can be shown.
    std::process::exit(1);
  }
  // The main-thread closure owns shutdown. Park this worker so the process
  // stays alive until the dialog is dismissed and exit is processed. A timed
  // process::exit here would kill the dialog before it could be read.
  loop {
    std::thread::park();
  }
}

fn autostart_enabled(app: &AppHandle) -> bool {
  app.autolaunch().is_enabled().unwrap_or(false)
}

fn build_tray_menu(app: &AppHandle, autostart_on: bool) -> tauri::Result<Menu<tauri::Wry>> {
  let open = MenuItem::with_id(app, "open", "Open RTWiki", true, None::<&str>)?;
  let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
  let auto_label = if autostart_on { "✓ Start with Windows" } else { "Start with Windows" };
  let auto = MenuItem::with_id(app, "autostart", auto_label, true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  Menu::with_items(app, &[&open, &browser, &PredefinedMenuItem::separator(app)?, &auto, &PredefinedMenuItem::separator(app)?, &quit])
}

fn toggle_autostart(app: &AppHandle) {
  let launcher = app.autolaunch();
  let currently_on = launcher.is_enabled().unwrap_or(false);
  let changed = if currently_on { launcher.disable().is_ok() } else { launcher.enable().is_ok() };
  if changed {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("rtwiki-tray"), build_tray_menu(app, !currently_on)) {
      let _ = tray.set_menu(Some(menu));
    }
  }
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
  match event.id.as_ref() {
    "open" => show_main(app),
    "browser" => sidecar::open_in_browser(shell_port(app)),
    "autostart" => toggle_autostart(app),
    "quit" => quit_app(app),
    _ => {},
  }
}

/// Respawn the sidecar: shutdown previous child if present, spawn a new one,
/// update state and wait for health. Returns true on success.
fn respawn_sidecar(app: &AppHandle) -> bool {
  let (exe_dir, old_port) = match app.try_state::<ShellState>() {
    Some(state) => (state.exe_dir.clone(), state.port.lock().ok().map(|g| *g)),
    None => return false,
  };
  let old_port = old_port.unwrap_or(sidecar::DEFAULT_PORT);

  if let Some(state) = app.try_state::<ShellState>() {
    let previous = state.child.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut child) = previous {
      // best-effort shutdown; ignore return value but log if needed
      let _ = sidecar::shutdown_sidecar(&mut child, old_port, &exe_dir);
    }
  }

  let remembered_port = app
    .try_state::<ShellState>()
    .and_then(|s| s.port.lock().ok().map(|g| *g))
    .unwrap_or(sidecar::DEFAULT_PORT);
  let port = sidecar::configured_port(&exe_dir, remembered_port);
  match sidecar::spawn_sidecar(&exe_dir, port) {
    Ok(child) => {
      let sidecar_path = exe_dir.join(sidecar::SIDECAR_FILENAME);
      sidecar::write_sidecar_owner(&exe_dir, std::process::id(), &child, &sidecar_path);
      if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut guard) = state.child.lock() { *guard = Some(child); }
        if let Ok(mut guard) = state.port.lock() { *guard = port; }
        if let Ok(mut guard) = state.own_sidecar.lock() { *guard = true; }
      }
      sidecar::wait_for_healthy(port, sidecar::boot_timeout())
    }
    Err(err) => {
      report_error(app, &format!("Failed to spawn sidecar: {err}"));
      false
    }
  }
}

fn watch_sidecar(app: AppHandle) {
  let mut crash_respawns: Vec<Instant> = Vec::new();
  loop {
    std::thread::sleep(Duration::from_secs(1));
    let quitting = app.try_state::<ShellState>().and_then(|s| s.quitting.lock().ok().map(|g| *g)).unwrap_or(true);
    if quitting { break; }
    let exe_dir = match app.try_state::<ShellState>() { Some(state) => state.exe_dir.clone(), None => break };
    let requested = sidecar::consume_restart_request(&exe_dir);
    let crashed = if requested { false } else {
      match app.try_state::<ShellState>() {
        Some(state) => match state.child.lock() {
          Ok(mut guard) => match guard.as_mut() {
            Some(child) => match child.try_wait() { Ok(Some(_)) => { guard.take(); true }, _ => false },
            None => false,
          },
          Err(_) => false,
        },
        None => false,
      }
    };

    // An authorized shutdown already stopped the sidecar deliberately. The
    // tray stays resident, so keep watching (a later restart request or launch
    // can still bring it back) but never respawn into a shutdown the user or
    // the shell already asked for.
    if crashed && sidecar::consume_shutdown_request(&exe_dir) {
      log::info!("Sidecar exited after an authorized shutdown; leaving it stopped.");
      continue;
    }

    if !requested && !crashed { continue; }
    if crashed {
      crash_respawns.retain(|t| t.elapsed() < Duration::from_secs(60));
      if crash_respawns.len() >= 3 {
        fatal(&app, "The RTWiki server keeps stopping unexpectedly.\n\nCheck logs/rtwiki.log for details, then relaunch RTWiki.".to_string());
      }
      crash_respawns.push(Instant::now());
    }
    if !respawn_sidecar(&app) {
      fatal(&app, "The RTWiki server did not restart in time.\n\nCheck logs/rtwiki.log for details, then relaunch RTWiki.".to_string());
    }
  }
}

fn boot_and_show(app: AppHandle, browser_mode: bool) {
  let (exe_dir, port) = match app.try_state::<ShellState>() {
    Some(state) => (state.exe_dir.clone(), state.port.lock().ok().map(|g| *g).unwrap_or(sidecar::DEFAULT_PORT)),
    None => return,
  };
  let mut own_sidecar = false;
  if !sidecar::health_ok(port) {
    // No running copy: it is now safe to delete leftover flags from a crashed
    // run, so an old one cannot trigger a fake restart or shutdown.
    sidecar::clear_stale_flags(&exe_dir);
    log::info!("Bootstrap: no running copy; cleared stale flag files");
    if !exe_dir.join(sidecar::SIDECAR_FILENAME).exists() {
      fatal(&app, format!("{} was not found beside the application.\n\nRe-extract the full RTWiki package.", sidecar::SIDECAR_FILENAME));
    }
    match sidecar::spawn_sidecar(&exe_dir, port) {
      Ok(child) => {
        // Record ownership before moving the child into state. Quit uses this
        // marker (with a process-identity check) to stop only our own sidecar.
        let sidecar_path = exe_dir.join(sidecar::SIDECAR_FILENAME);
        sidecar::write_sidecar_owner(&exe_dir, std::process::id(), &child, &sidecar_path);
        if let Some(state) = app.try_state::<ShellState>() {
          if let Ok(mut guard) = state.child.lock() { *guard = Some(child); }
        }
        if !sidecar::wait_for_healthy(port, sidecar::boot_timeout()) {
          if sidecar::health_ok(port) {
            if let Some(state) = app.try_state::<ShellState>() {
              if let Ok(mut guard) = state.child.lock() { guard.take(); }
            }
          } else {
            if let Some(state) = app.try_state::<ShellState>() {
              let child = state.child.lock().ok().and_then(|mut g| g.take());
              if let Some(mut child) = child { let _ = child.kill(); }
            }
            sidecar::clear_sidecar_owner(&exe_dir);
            fatal(&app, "The RTWiki server did not start in time.\n\nCheck logs/rtwiki.log for details, then try again.".to_string());
          }
        } else { own_sidecar = true; }
      }
      Err(err) => {
        if sidecar::health_ok(port) { own_sidecar = false; }
        else { fatal(&app, format!("Could not start {0}: {err}\n\nRe-extract the full RTWiki package.", sidecar::SIDECAR_FILENAME)); }
      }
    }
  } else {
    // Attaching to a sidecar started by an earlier shell (e.g. one that crashed
    // and left the server running). Adopt ownership so quitting THIS shell stops
    // the server instead of orphaning it. The recorded sidecar PID/path is
    // re-verified before it is adopted, so a stale marker is never trusted.
    if let Some(marker) = sidecar::read_sidecar_owner(&exe_dir) {
      if sidecar::process_identity_matches(marker.sidecar_pid, &marker.sidecar_path) {
        sidecar::write_sidecar_owner_for_pid(
          &exe_dir,
          std::process::id(),
          marker.sidecar_pid,
          &marker.sidecar_path,
        );
        log::info!("Adopted existing sidecar PID {} on attach", marker.sidecar_pid);
      }
    }
  }
  if let Some(state) = app.try_state::<ShellState>() {
    if let Ok(mut guard) = state.own_sidecar.lock() { *guard = own_sidecar; }
  }
  // Both handshake flags are per-launch intent, never state to resume: a flag
  // left behind by a crash must not suppress this run's recovery.
  sidecar::clear_restart_request(&exe_dir);
  sidecar::clear_shutdown_request(&exe_dir);
  if own_sidecar { let handle = app.clone(); std::thread::spawn(move || watch_sidecar(handle)); }
  let ui_app = app.clone();
  let _ = app.run_on_main_thread(move || {
    if browser_mode { sidecar::open_in_browser(shell_port(&ui_app)); return; }
    if let Some(window) = ui_app.get_webview_window("main") {
      if let Some(state) = ui_app.try_state::<ShellState>() {
        if let Some(saved) = geom::load(&state.exe_dir) { geom::apply(&window, &saved); }
      }
      // The server is healthy now. Navigate to the real app; the window stays
      // hidden until the page-load handler confirms the app finished loading.
      let url: tauri::Url = match sidecar::base_url(shell_port(&ui_app)).parse() {
        Ok(url) => url,
        Err(err) => {
          log::error!("Invalid server URL: {err}");
          return;
        }
      };
      if let Err(err) = window.navigate(url) {
        log::error!("Failed to navigate to the app: {err}");
      }
    }
  });
  // Safety net: if the page-load event never arrives (webview issue, cached
  // page, navigation race), still reveal the window so the app is usable.
  let safety_app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(5));
    reveal_main_window(&safety_app);
  });
}

/// Tauri invoke command: read current close behaviour from the settings table.
/// Called by the JS `<WindowChrome>` component on every close-button press so
/// the behaviour always reflects the latest Settings selection without restart.
#[tauri::command]
fn get_close_behavior(app: AppHandle) -> String {
  let (exe_dir, remembered) = match app.try_state::<ShellState>() {
    Some(state) => (
      state.exe_dir.clone(),
      state.close_behavior.lock().ok().map(|g| *g).unwrap_or(sidecar::CloseBehavior::Ask),
    ),
    None => (PathBuf::new(), sidecar::CloseBehavior::Ask),
  };
  let behavior = sidecar::close_behavior(&exe_dir, remembered);
  if let Some(state) = app.try_state::<ShellState>() {
    if let Ok(mut guard) = state.close_behavior.lock() {
      *guard = behavior;
    }
  }
  match behavior {
    sidecar::CloseBehavior::Minimize => "minimize".to_string(),
    sidecar::CloseBehavior::Quit    => "quit".to_string(),
    sidecar::CloseBehavior::Ask     => "ask".to_string(),
  }
}

/// Called by the in-app close dialog on mount. Proves a listener exists and
/// clears any prompt flag left behind by a webview reload, so a close press is
/// never emitted into the void. Mirrors Codeg's close-prompt handshake.
#[tauri::command]
fn close_dialog_ready(app: AppHandle) {
  log::info!("close_dialog_ready invoked");
  if let Some(state) = app.try_state::<ShellState>() {
    state.close_prompt_ready.store(true, Ordering::Release);
    if let Ok(mut guard) = state.close_prompt_open.lock() {
      *guard = None;
    }
  }
}

/// Resolves an outstanding close prompt. Releases the prompt flag first so a
/// persistence failure can never wedge the close button, then carries out the
/// chosen action. `action` is "minimize", "quit" or "cancel".
#[tauri::command]
fn resolve_close_request(app: AppHandle, action: String) {
  if let Some(state) = app.try_state::<ShellState>() {
    if let Ok(mut guard) = state.close_prompt_open.lock() {
      *guard = None;
    }
  }
  match action.as_str() {
    "minimize" => {
      save_geometry(&app);
      if let Some(window) = main_window(&app) {
        let _ = window.hide();
      }
    }
    "quit" => quit_app(&app),
    _ => {}
  }
}

fn main() {
  // Install the bounded shell logger before any plugin or setup work so every
  // bootstrap (startup sequence) and graceful shutdown step is recorded.
  let boot_exe_dir = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(PathBuf::from))
    .unwrap_or_default();
  init_shell_logger(&boot_exe_dir);
  log::info!("RTWiki shell starting");

  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(
      |app: &AppHandle, args: Vec<String>, _cwd: String| {
        if args.iter().any(|a| a == "--browser") {
          let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .unwrap_or_default();
          let remembered = app
            .try_state::<ShellState>()
            .and_then(|s| s.port.lock().ok().map(|g| *g))
            .unwrap_or(sidecar::DEFAULT_PORT);
          sidecar::open_in_browser(sidecar::configured_port(&exe_dir, remembered));
        }
        show_main(app);
      },
    ))
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .on_menu_event(|app, event| on_menu(app, event))
    // Register the close-behaviour command so the frontend chrome can read
    // it fresh on every click (no restart needed).
    .invoke_handler(tauri::generate_handler![
      get_close_behavior,
      close_dialog_ready,
      resolve_close_request,
    ])
    .setup(|app| {
      let browser_mode = std::env::args().any(|a| a == "--browser");
      let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_default();
      // The listening port and close behavior are Settings-managed (SQLite
      // settings table). Seed the remembered values from the DB so a busy-DB
      // fallback uses the last known setting, not a fixed default.
      let port = sidecar::configured_port(&exe_dir, sidecar::DEFAULT_PORT);
      let remembered_behavior =
        sidecar::close_behavior(&exe_dir, sidecar::CloseBehavior::Ask);
      app.manage(ShellState {
        exe_dir: exe_dir.clone(),
        port: Mutex::new(port),
        own_sidecar: Mutex::new(false),
        child: Mutex::new(None),
        quitting: Mutex::new(false),
        // Allow the first move/resize event to save immediately.
        last_geometry_save: Mutex::new(Instant::now() - geom::SAVE_THROTTLE),
        close_prompt_ready: AtomicBool::new(false),
        close_prompt_open: Mutex::new(None),
        window_revealed: AtomicBool::new(false),
        close_behavior: Mutex::new(remembered_behavior),
        shutdown_done: AtomicBool::new(false),
      });

      // Tray first so Quit is always reachable, even during a slow boot.
      let menu = build_tray_menu(app.handle(), autostart_enabled(app.handle()))?;
      let mut tray = TrayIconBuilder::with_id("rtwiki-tray")
        .tooltip("RTWiki")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button,
            button_state,
            ..
          } = event
          {
            if button == MouseButton::Left && button_state == MouseButtonState::Up {
              show_main(tray.app_handle());
            }
          }
        });
      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }
      tray.build(app)?;

      if !browser_mode {
        // Created hidden on the bundled placeholder page. The loopback URL is
        // navigated to only after /health answers, so WebView2 never renders a
        // connection-error page during the sidecar's boot gap.
        let builder = tauri::WebviewWindowBuilder::new(
          app,
          "main",
          tauri::WebviewUrl::default(),
        )
        .title("RTWiki")
        .inner_size(1280.0, 860.0)
        .min_inner_size(800.0, 600.0)
        .visible(false)
        // The webview may only show the loopback app origin; any other
        // navigation is cancelled so web content cannot steer the window.
        .on_navigation(|url| {
          let scheme_ok = url.scheme() == "http";
          let host_ok = matches!(url.host_str(), Some("127.0.0.1") | Some("tauri.localhost"));
          scheme_ok && host_ok
        })
        // Reveal only when the real app page (not the bundled loading page)
        // finishes loading, so the user never sees a connection-error page.
        .on_page_load(|window, payload| {
          use tauri::webview::PageLoadEvent;
          if matches!(payload.event(), PageLoadEvent::Finished)
            && payload.url().host_str() == Some("127.0.0.1")
          {
            reveal_main_window(window.app_handle());
          }
        });

        // Strip the native title bar on Windows so the frontend renders its
        // own chrome (custom tab strip + window controls in window-chrome.tsx).
        #[cfg(target_os = "windows")]
        let builder = builder.decorations(false);

        let window = builder.build()?;

        // Safety-net close handler: fires whenever win.close() is called
        // (including from the JS chrome component). Reads fresh behaviour
        // so Settings changes apply immediately without restart.
        let win = window.clone();
        window.on_window_event(move |event| {
          match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
              maybe_save_geometry(win.app_handle());
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
              let app = win.app_handle();
              let (exe_dir, remembered) = match app.try_state::<ShellState>() {
                Some(state) => (
                  state.exe_dir.clone(),
                  state.close_behavior.lock().ok().map(|g| *g).unwrap_or(sidecar::CloseBehavior::Ask),
                ),
                None => (PathBuf::new(), sidecar::CloseBehavior::Ask),
              };
              let behavior = sidecar::close_behavior(&exe_dir, remembered);
              if let Some(state) = app.try_state::<ShellState>() {
                if let Ok(mut guard) = state.close_behavior.lock() {
                  *guard = behavior;
                }
              }

              match behavior {
                sidecar::CloseBehavior::Minimize => {
                  api.prevent_close();
                  geom::save_current(&exe_dir, &win);
                  let _ = win.hide();
                }
                sidecar::CloseBehavior::Quit => {
                  api.prevent_close();
                  quit_app(app);
                }
                sidecar::CloseBehavior::Ask => {
                  api.prevent_close();
                  let state = app.try_state::<ShellState>();
                  let ready = state
                    .as_ref()
                    .map(|s| s.close_prompt_ready.load(Ordering::Acquire))
                    .unwrap_or(false);
                  // Claim the prompt: a second press while a dialog is up is a
                  // duplicate; an unanswered prompt past the grace is lost.
                  let claim = if let Some(s) = state.as_ref() {
                    match s.close_prompt_open.lock() {
                      Ok(mut guard) => {
                        if guard.map(|at| at.elapsed() < CLOSE_PROMPT_GRACE).unwrap_or(false) {
                          ClosePromptClaim::Duplicate
                        } else {
                          *guard = Some(Instant::now());
                          ClosePromptClaim::Granted
                        }
                      }
                      Err(_) => ClosePromptClaim::Unavailable,
                    }
                  } else {
                    ClosePromptClaim::Unavailable
                  };
                  match claim {
                    ClosePromptClaim::Duplicate => {} // a dialog is already open
                    ClosePromptClaim::Granted if ready && app.emit(CLOSE_REQUEST_EVENT, ()).is_ok() => {
                      // The in-app dialog owns this press and will resolve it.
                    }
                    ClosePromptClaim::Granted => {
                      // The readiness handshake has not completed yet (the
                      // dialog mounts after the page loads). Retry briefly
                      // instead of silently hiding to tray, so a click during
                      // boot still shows the dialog.
                      let retry_app = app.clone();
                      let retry_win = win.clone();
                      let retry_dir = exe_dir.clone();
                      std::thread::spawn(move || {
                        let deadline = Instant::now() + Duration::from_millis(1500);
                        loop {
                          let is_ready = retry_app
                            .try_state::<ShellState>()
                            .map(|s| s.close_prompt_ready.load(Ordering::Acquire))
                            .unwrap_or(false);
                          if is_ready && retry_app.emit(CLOSE_REQUEST_EVENT, ()).is_ok() {
                            log::info!("Close dialog handshake completed on retry");
                            return;
                          }
                          if Instant::now() >= deadline {
                            break;
                          }
                          std::thread::sleep(Duration::from_millis(50));
                        }
                        // Still no listener: log the failure and apply the safe
                        // default rather than failing silently.
                        log::warn!("Close dialog handshake failed; hiding to tray");
                        geom::save_current(&retry_dir, &retry_win);
                        let _ = retry_win.hide();
                      });
                    }
                    ClosePromptClaim::Unavailable => {
                      geom::save_current(&exe_dir, &win);
                      let _ = win.hide();
                    }
                  }
                }
              }
            }
            _ => {}
          }
        });
      }

      let handle = app.handle().clone();
      std::thread::spawn(move || boot_and_show(handle, browser_mode));
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("RTWiki failed to build")
    .run(|app, event| {
      if let RunEvent::ExitRequested { .. } = event {
        // Covers system shutdown and any exit path that did not go through
        // quit_app (window close, quit menu, restart). Idempotent, so a normal
        // quit that already shut down does no work twice.
        graceful_shutdown(app, "exit-requested");
      }
    });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn no_owner_marker_means_do_not_stop_any_sidecar() {
    // With no marker there is no verified owner, so this shell must not stop
    // any sidecar. On attach a shell normally adopts the sidecar and writes a
    // marker naming itself (see boot_and_show); this case covers the residual
    // path where adoption could not happen (e.g. a stale/unverifiable marker).
    assert!(!should_stop_sidecar(None, std::process::id()));
  }

  #[test]
  fn another_copy_owner_marker_is_not_stopped() {
    let owner = sidecar::SidecarOwner {
      shell_pid: std::process::id().wrapping_add(1),
      sidecar_pid: 999_999,
      sidecar_path: PathBuf::from("C:/RTWiki/RTWikiServer.exe"),
    };
    assert!(!should_stop_sidecar(Some(&owner), std::process::id()));
  }

  #[test]
  fn stale_marker_with_reused_pid_is_not_stopped() {
    // The marker names this shell's PID, but the recorded sidecar PID no longer
    // belongs to the server program. Must not kill that unrelated process (S2).
    let owner = sidecar::SidecarOwner {
      shell_pid: std::process::id(),
      sidecar_pid: u32::MAX,
      sidecar_path: PathBuf::from("C:/RTWiki/RTWikiServer.exe"),
    };
    assert!(!should_stop_sidecar(Some(&owner), std::process::id()));
  }
}
