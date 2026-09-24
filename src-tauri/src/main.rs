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
//!   ├─ reads data/server.json for the listening port (Settings-managed)
//!   ├─ spawns RTWikiServer.exe --no-open --port <port>   (sidecar.rs)
//!   ├─ polls GET /health until 200, then shows the window
//!   ├─ watch thread respawns the sidecar on restart request or crash
//!   └─ on Quit: graceful shutdown (token) then child-kill fallback
//! ```
//! Closing the window follows data/desktop.json (ask / minimize / quit).
//! `RTWiki.exe --browser` keeps browser mode: no window, tray stays resident.

mod geom;
mod sidecar;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Shared shell state. The sidecar child (when owned by this process) lives
/// here so the Quit path and the watch thread can manage it.
struct ShellState {
  exe_dir: PathBuf,
  port: Mutex<u16>,
  own_sidecar: Mutex<bool>,
  child: Mutex<Option<std::process::Child>>,
  quitting: Mutex<bool>,
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

fn save_geometry(app: &AppHandle) {
  if let (Some(window), Some(state)) = (main_window(app), app.try_state::<ShellState>()) {
    geom::save_current(&state.exe_dir, &window);
  }
}

fn quit_app(app: &AppHandle) {
  if let Some(state) = app.try_state::<ShellState>() {
    if let Ok(mut quitting) = state.quitting.lock() {
      *quitting = true;
    }
  }
  save_geometry(app);
  let port = shell_port(app);
  let own = app
    .try_state::<ShellState>()
    .and_then(|s| s.own_sidecar.lock().ok().map(|guard| *guard))
    .unwrap_or(false);
  if own {
    let child = app
      .try_state::<ShellState>()
      .and_then(|s| s.child.lock().ok().and_then(|mut guard| guard.take()));
    if let Some(mut child) = child {
      sidecar::shutdown_sidecar(&mut child, port);
    }
  }
  app.exit(0);
}

/// Fatal startup failure: native message dialog (Rust side, always available)
/// then exit. Runs the dialog on the main thread; never returns.
fn fatal(app: &AppHandle, message: String) -> ! {
  let handle = app.clone();
  let dialog_handle = handle.clone();
  let _ = handle.run_on_main_thread(move || {
    dialog_handle
      .dialog()
      .message(message)
      .title("RTWiki")
      .kind(MessageDialogKind::Error)
      .blocking_show();
    std::process::exit(1);
  });
  std::thread::sleep(Duration::from_secs(10));
  std::process::exit(1);
}

fn autostart_enabled(app: &AppHandle) -> bool {
  app.autolaunch().is_enabled().unwrap_or(false)
}

fn build_tray_menu(app: &AppHandle, autostart_on: bool) -> tauri::Result<Menu<tauri::Wry>> {
  let open = MenuItem::with_id(app, "open", "Open RTWiki", true, None::<&str>)?;
  let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
  let auto_label = if autostart_on {
    "✓ Start with Windows"
  } else {
    "Start with Windows"
  };
  let auto = MenuItem::with_id(app, "autostart", auto_label, true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  Menu::with_items(
    app,
    &[
      &open,
      &browser,
      &PredefinedMenuItem::separator(app)?,
      &auto,
      &PredefinedMenuItem::separator(app)?,
      &quit,
    ],
  )
}

fn toggle_autostart(app: &AppHandle) {
  let launcher = app.autolaunch();
  let currently_on = launcher.is_enabled().unwrap_or(false);
  let changed = if currently_on {
    launcher.disable().is_ok()
  } else {
    launcher.enable().is_ok()
  };
  if changed {
    if let (Some(tray), Ok(menu)) = (
      app.tray_by_id("rtwiki-tray"),
      build_tray_menu(app, !currently_on),
    ) {
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
    _ => {}
  }
}

/// Handles a window close request per data/desktop.json (read fresh so
/// Settings changes apply immediately): minimize hides to the tray, quit
/// exits, ask shows a one-shot dialog (OK minimizes, dismiss keeps open;
// quit stays on the tray menu).
fn on_close_requested(app: &AppHandle, window: &WebviewWindow) -> bool {
  let exe_dir = app
    .try_state::<ShellState>()
    .map(|s| s.exe_dir.clone())
    .unwrap_or_default();
  match sidecar::close_behavior(&exe_dir) {
    sidecar::CloseBehavior::Minimize => {
      geom::save_current(&exe_dir, window);
      let _ = window.hide();
      true
    }
    sidecar::CloseBehavior::Quit => {
      quit_app(app);
      true
    }
    sidecar::CloseBehavior::Ask => {
      let minimize = app
        .dialog()
        .message("Minimize RTWiki to the tray instead of quitting?\n\nYou can quit anytime from the tray menu.")
        .title("RTWiki")
        .blocking_show();
      if minimize {
        geom::save_current(&exe_dir, window);
        let _ = window.hide();
      }
      true
    }
  }
}

/// Stops the previous child (if any) and spawns the sidecar on the freshly
/// configured port. Returns true when the new server answers /health.
fn respawn_sidecar(app: &AppHandle) -> bool {
  let (exe_dir, old_port) = match app.try_state::<ShellState>() {
    Some(state) => (state.exe_dir.clone(), state.port.lock().ok().map(|g| *g)),
    None => return false,
  };
  let old_port = old_port.unwrap_or(sidecar::DEFAULT_PORT);

  if let Some(state) = app.try_state::<ShellState>() {
    let previous = state
      .child
      .lock()
      .ok()
      .and_then(|mut guard| guard.take());
    if let Some(mut child) = previous {
      sidecar::shutdown_sidecar(&mut child, old_port);
    }
  }

  let port = sidecar::configured_port(&exe_dir);
  match sidecar::spawn_sidecar(&exe_dir, port) {
    Ok(child) => {
      if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut guard) = state.child.lock() {
          *guard = Some(child);
        }
        if let Ok(mut guard) = state.port.lock() {
          *guard = port;
        }
        if let Ok(mut guard) = state.own_sidecar.lock() {
          *guard = true;
        }
      }
      sidecar::wait_for_healthy(port, sidecar::boot_timeout())
    }
    Err(_) => false,
  }
}

/// Watch thread: consumes restart requests (Settings → restart handshake)
/// and recovers from unexpected sidecar exits. Crash respawns are bounded
/// (3 per minute) so a permanently broken server surfaces an error dialog
/// instead of looping forever; explicit restart requests are always honored.
fn watch_sidecar(app: AppHandle) {
  let mut crash_respawns: Vec<Instant> = Vec::new();
  loop {
    std::thread::sleep(Duration::from_secs(1));
    let quitting = app
      .try_state::<ShellState>()
      .and_then(|s| s.quitting.lock().ok().map(|g| *g))
      .unwrap_or(true);
    if quitting {
      break;
    }
    let exe_dir = match app.try_state::<ShellState>() {
      Some(state) => state.exe_dir.clone(),
      None => break,
    };
    let requested = sidecar::consume_restart_request(&exe_dir);
    let crashed = if requested {
      false
    } else {
      match app.try_state::<ShellState>() {
        Some(state) => match state.child.lock() {
          Ok(mut guard) => match guard.as_mut() {
            Some(child) => match child.try_wait() {
              Ok(Some(_)) => {
                guard.take();
                true
              }
              _ => false,
            },
            None => false,
          },
          Err(_) => false,
        },
        None => false,
      }
    };
    if !requested && !crashed {
      continue;
    }
    if crashed {
      crash_respawns.retain(|t| t.elapsed() < Duration::from_secs(60));
      if crash_respawns.len() >= 3 {
        fatal(
          &app,
          "The RTWiki server keeps stopping unexpectedly.\n\nCheck logs/rtwiki.log for details, then relaunch RTWiki.".to_string(),
        );
      }
      crash_respawns.push(Instant::now());
    }
    if !respawn_sidecar(&app) {
      fatal(
        &app,
        "The RTWiki server did not restart in time.\n\nCheck logs/rtwiki.log for details, then relaunch RTWiki.".to_string(),
      );
    }
  }
}

/// Boots (or attaches to) the server, then reveals the window on the main
/// thread. Runs on a worker thread so slow boots never freeze the tray.
fn boot_and_show(app: AppHandle, browser_mode: bool) {
  let (exe_dir, port) = match app.try_state::<ShellState>() {
    Some(state) => (
      state.exe_dir.clone(),
      state.port.lock().ok().map(|g| *g).unwrap_or(sidecar::DEFAULT_PORT),
    ),
    None => return,
  };

  // Case 1: a server is already answering (browser-mode instance or another
  // desktop instance). Attach without spawning a second one.
  let mut own_sidecar = false;
  if !sidecar::health_ok(port) {
    if !exe_dir.join(sidecar::SIDECAR_FILENAME).exists() {
      fatal(
        &app,
        format!(
          "{} was not found beside the application.\n\nRe-extract the full RTWiki package.",
          sidecar::SIDECAR_FILENAME
        ),
      );
    }
    match sidecar::spawn_sidecar(&exe_dir, port) {
      Ok(child) => {
        if let Some(state) = app.try_state::<ShellState>() {
          if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
          }
        }
        if !sidecar::wait_for_healthy(port, sidecar::boot_timeout()) {
          // The child may have exited early because another instance owns
          // the port; attach if the server answers anyway.
          if sidecar::health_ok(port) {
            if let Some(state) = app.try_state::<ShellState>() {
              if let Ok(mut guard) = state.child.lock() {
                guard.take();
              }
            }
          } else {
            if let Some(state) = app.try_state::<ShellState>() {
              let child = state.child.lock().ok().and_then(|mut g| g.take());
              if let Some(mut child) = child {
                let _ = child.kill();
              }
            }
            fatal(
              &app,
              "The RTWiki server did not start in time.\n\nCheck logs/rtwiki.log for details, then try again.".to_string(),
            );
          }
        } else {
          own_sidecar = true;
        }
      }
      Err(err) => {
        // Spawn failed but a server answers: attach to the running instance.
        if sidecar::health_ok(port) {
          own_sidecar = false;
        } else {
          fatal(
            &app,
            format!("Could not start {0}: {err}\n\nRe-extract the full RTWiki package.", sidecar::SIDECAR_FILENAME),
          );
        }
      }
    }
  }

  if let Some(state) = app.try_state::<ShellState>() {
    if let Ok(mut guard) = state.own_sidecar.lock() {
      *guard = own_sidecar;
    }
  }
  sidecar::clear_restart_request(&exe_dir);
  if own_sidecar {
    let handle = app.clone();
    std::thread::spawn(move || watch_sidecar(handle));
  }

  // `app` is borrowed by the `ShellState` guards above, so the main-thread
  // closure takes its own clone rather than moving the original handle.
  let ui_app = app.clone();
  let _ = app.run_on_main_thread(move || {
    if browser_mode {
      sidecar::open_in_browser(shell_port(&ui_app));
      return;
    }
    if let Some(window) = ui_app.get_webview_window("main") {
      if let Some(state) = ui_app.try_state::<ShellState>() {
        if let Some(saved) = geom::load(&state.exe_dir) {
          geom::apply(&window, &saved);
        }
      }
      let _ = window.show();
      let _ = window.set_focus();
    }
  });
}

fn main() {
  tauri::Builder::default()
    // Registered first: a second launch focuses the existing window instead
    // of starting a second server.
    .plugin(tauri_plugin_single_instance::init(
      |app: &AppHandle, args: Vec<String>, _cwd: String| {
        if args.iter().any(|a| a == "--browser") {
          // The running instance owns the configured port; read it from the
          // shared settings file rather than this process's boot state.
          let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .unwrap_or_default();
          sidecar::open_in_browser(sidecar::configured_port(&exe_dir));
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
    .setup(|app| {
      let browser_mode = std::env::args().any(|a| a == "--browser");
      let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_default();
      // The listening port is Settings-managed (data/server.json); the
      // window URL is baked from it so no navigation fix-up is ever needed.
      let port = sidecar::configured_port(&exe_dir);
      app.manage(ShellState {
        exe_dir: exe_dir.clone(),
        port: Mutex::new(port),
        own_sidecar: Mutex::new(false),
        child: Mutex::new(None),
        quitting: Mutex::new(false),
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
        // Created hidden with the configured loopback URL; revealed after
        // /health answers so the user never sees a connection error.
        let url: tauri::Url = sidecar::base_url(port)
          .parse()
          .map_err(|e| format!("Invalid server URL: {e}"))?;
        let window = tauri::WebviewWindowBuilder::new(
          app,
          "main",
          tauri::WebviewUrl::External(url),
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
        .build()?;
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
          if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window("main") {
              on_close_requested(&handle, &w);
            }
          }
        });
      }

      let handle = app.handle().clone();
      std::thread::spawn(move || boot_and_show(handle, browser_mode));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("RTWiki failed to start");
}
