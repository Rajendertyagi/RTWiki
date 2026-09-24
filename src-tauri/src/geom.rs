//! Portable window-geometry persistence (ADR-011, ADR-005).
//!
//! The desktop window position and size are stored as UI-only state in
//! `<exe-dir>/data/window-state.json` so the workspace stays fully portable:
//! no geometry is ever written outside the application folder. The file holds
//! only integers and a boolean — never user content — and is excluded from
//! backups.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

const STATE_FILENAME: &str = "window-state.json";

/// Serializable window geometry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
  pub maximized: bool,
}

pub fn state_path(exe_dir: &Path) -> PathBuf {
  exe_dir.join("data").join(STATE_FILENAME)
}

/// Loads the last saved geometry, if any. Corrupt or missing files are
/// treated as "no saved state" so a bad file can never block startup.
pub fn load(exe_dir: &Path) -> Option<WindowState> {
  let raw = std::fs::read_to_string(state_path(exe_dir)).ok()?;
  let state: WindowState = serde_json::from_str(&raw).ok()?;
  if state.width < 100 || state.height < 100 {
    return None;
  }
  Some(state)
}

/// Persists geometry atomically (write-then-rename) so a crash mid-write
/// cannot leave a half-written file behind.
pub fn save(exe_dir: &Path, state: &WindowState) {
  let path = state_path(exe_dir);
  if let Some(parent) = path.parent() {
    if std::fs::create_dir_all(parent).is_err() {
      return;
    }
  }
  let Ok(raw) = serde_json::to_string(state) else {
    return;
  };
  let tmp = path.with_extension("json.tmp");
  if std::fs::write(&tmp, raw).is_err() {
    return;
  }
  let _ = std::fs::rename(&tmp, &path);
}

/// Captures the current geometry. Returns None while minimized so a
/// minimized frame is never persisted as the restore size.
pub fn capture(window: &WebviewWindow) -> Option<WindowState> {
  if window.is_minimized().unwrap_or(false) {
    return None;
  }
  let maximized = window.is_maximized().unwrap_or(false);
  let size = window.inner_size().ok()?;
  let position = window.outer_position().ok()?;
  Some(WindowState {
    x: position.x,
    y: position.y,
    width: size.width.max(100),
    height: size.height.max(100),
    maximized,
  })
}

/// Applies saved geometry before the window is first shown.
pub fn apply(window: &WebviewWindow, state: &WindowState) {
  let _ = window.set_size(Size::Physical(PhysicalSize {
    width: state.width,
    height: state.height,
  }));
  if state.maximized {
    let _ = window.maximize();
  } else {
    let _ = window.set_position(Position::Physical(PhysicalPosition {
      x: state.x,
      y: state.y,
    }));
  }
}

/// Captures and persists the current geometry, if the window state allows it.
pub fn save_current(exe_dir: &Path, window: &WebviewWindow) {
  if let Some(state) = capture(window) {
    save(exe_dir, &state);
  }
}
