//! Portable window-geometry persistence (ADR-011, ADR-005).
//!
//! Geometry lives in the SQLite `settings` table (`window.geometry`) owned by
//! the Bun server — one source of truth for all settings. The shell writes it
//! best-effort: a busy or missing DB is skipped quietly and never blocks close.
//! The value holds only integers and a boolean — never user content.

use crate::sidecar;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::{PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

/// Minimum interval between geometry writes while the window is being moved or
/// resized. Close/quit still save unthrottled as the authoritative final write.
pub const SAVE_THROTTLE: Duration = Duration::from_millis(500);

/// Serializable window geometry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WindowState {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
  pub maximized: bool,
}

/// Loads the last saved geometry, if any. Any failure (missing DB, missing key,
/// corrupt value) is treated as "no saved state" so a bad value can never block
/// startup.
pub fn load(exe_dir: &Path) -> Option<WindowState> {
  let raw = sidecar::read_setting(exe_dir, sidecar::SETTINGS_KEY_WINDOW_GEOMETRY)?;
  let state: WindowState = serde_json::from_str(&raw).ok()?;
  if state.width < 100 || state.height < 100 {
    return None;
  }
  Some(state)
}

/// Persists geometry best-effort. A busy or missing DB is skipped quietly —
/// this must never block or delay closing the app.
pub fn save(exe_dir: &Path, state: &WindowState) {
  let Ok(raw) = serde_json::to_string(state) else {
    return;
  };
  let _ = sidecar::write_setting(exe_dir, sidecar::SETTINGS_KEY_WINDOW_GEOMETRY, &raw);
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

/// True when the saved rect intersects a monitor enough to be usable. A window
/// restored from a backup taken on a different monitor setup can otherwise land
/// entirely off-screen with no way to grab it.
fn is_on_screen(state: &WindowState, monitors: &[tauri::Monitor]) -> bool {
  let rects: Vec<(i32, i32, u32, u32)> = monitors
    .iter()
    .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
    .collect();
  rect_on_screen(state.x, state.y, state.width, state.height, &rects)
}

/// Pure geometry check, factored out so it is testable without a real window.
fn rect_on_screen(
  x: i32,
  y: i32,
  width: u32,
  height: u32,
  monitors: &[(i32, i32, u32, u32)],
) -> bool {
  if monitors.is_empty() {
    return true; // no monitor info available — trust the saved value
  }
  let w = width as i32;
  let h = height as i32;
  monitors.iter().any(|&(mx, my, mw, mh)| {
    let mw = mw as i32;
    let mh = mh as i32;
    // Require a meaningful overlap: at least 64px in each axis, so a window
    // whose corner barely clips a monitor is not considered on-screen.
    let overlap_x = (x + w).min(mx + mw) - x.max(mx);
    let overlap_y = (y + h).min(my + mh) - y.max(my);
    overlap_x >= 64 && overlap_y >= 64
  })
}

/// Applies saved geometry before the window is first shown. If the saved
/// position is off-screen on the current monitor layout, the position is
/// ignored and the OS places the window; the saved size is still applied.
pub fn apply(window: &WebviewWindow, state: &WindowState) {
  let _ = window.set_size(Size::Physical(PhysicalSize {
    width: state.width,
    height: state.height,
  }));
  if state.maximized {
    let _ = window.maximize();
    return;
  }
  let monitors = window.available_monitors().unwrap_or_default();
  if is_on_screen(state, &monitors) {
    let _ = window.set_position(Position::Physical(PhysicalPosition {
      x: state.x,
      y: state.y,
    }));
  }
  // Off-screen: leave placement to the OS so the window stays reachable.
}

/// Captures and persists the current geometry, if the window state allows it.
pub fn save_current(exe_dir: &Path, window: &WebviewWindow) {
  if let Some(state) = capture(window) {
    save(exe_dir, &state);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn on_screen_position_is_kept() {
    let state = WindowState { x: 100, y: 100, width: 800, height: 600, maximized: false };
    assert!(rect_on_screen(state.x, state.y, state.width, state.height, &[(0, 0, 1920, 1080)]));
  }

  #[test]
  fn off_screen_position_is_rejected() {
    let state = WindowState { x: 5000, y: 5000, width: 800, height: 600, maximized: false };
    assert!(!rect_on_screen(state.x, state.y, state.width, state.height, &[(0, 0, 1920, 1080)]));
  }

  #[test]
  fn second_monitor_position_is_kept() {
    let state = WindowState { x: 2000, y: 100, width: 800, height: 600, maximized: false };
    assert!(rect_on_screen(
      state.x, state.y, state.width, state.height,
      &[(0, 0, 1920, 1080), (1920, 0, 1920, 1080)]
    ));
  }

  #[test]
  fn barely_clipping_corner_is_rejected() {
    let state = WindowState { x: 1900, y: 1050, width: 800, height: 600, maximized: false };
    assert!(!rect_on_screen(state.x, state.y, state.width, state.height, &[(0, 0, 1920, 1080)]));
  }
}
