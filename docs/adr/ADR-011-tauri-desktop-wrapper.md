# ADR-011: Tauri Desktop Wrapper (Native App with Browser Mode)

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-24 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | [ADR-001](ADR-001-browser-first-local-application.md) (native-wrapper rejection only; browser-first remains as a secondary mode) |

## Context

ADR-001 chose a browser-first local application and explicitly rejected a native
desktop wrapper for the MVP, listing a revisit condition: the decision should be
revisited if the user base demands a native desktop experience (system tray icon,
native menus, file associations). ROADMAP Phase 6 reserved a native-wrapper
evaluation for after the MVP.

The project owner has now explicitly authorized that work. The concrete needs are:

- A normal Windows application window instead of a browser tab.
- Launch-at-login (autostart), a system tray icon, and close-to-tray so the
  Study Scheduler can surface reminders while the app is minimized (ADR-009
  notes that notifications only fire while the SPA is open).
- Native OS notifications and a single-instance experience.
- Browser mode must remain available — the owner wants to choose native or
  browser per launch, with the native app as the default.

The existing backend is a self-contained Bun-compiled executable that serves the
SPA and API on loopback (`127.0.0.1:8080`), already supports `--no-open`, exposes
`/health`, performs single-instance detection, and shuts down cleanly through a
token-protected endpoint. This makes a thin native shell viable without touching
the backend architecture (ADR-002).

## Decision

RTWiki ships an **optional Tauri 2 desktop shell** that hosts the existing web UI
in a Microsoft Edge WebView2 window and runs the existing Bun server as a child
process (sidecar). The browser-first artifact remains available; the desktop
artifact is the default distribution.

### Process model

```text
RTWiki.exe (Tauri shell, Rust + WebView2)
  ├─ spawns RTWikiServer.exe --no-open --port 8080   (Bun sidecar)
  ├─ polls GET http://127.0.0.1:8080/health until 200
  ├─ loads http://127.0.0.1:8080/ in the main window
  └─ on quit: graceful shutdown (token) then child kill fallback
```

- The **shell** is the user-facing executable (`RTWiki.exe`). It owns the window,
  tray icon, autostart registration, window geometry, and sidecar lifecycle.
- The **sidecar** is the existing Bun-compiled server, shipped as
  `RTWikiServer.exe` beside the shell. It continues to own the database,
  attachments, backups, logs, HTTP server, and all business logic.
- The webview loads the **same loopback URL** the browser would. No frontend
  rewrite and no second data path.

### Portable layout (extends ADR-005)

```text
RTWiki/
├── RTWiki.exe            (Tauri shell — what the user runs)
├── RTWikiServer.exe      (Bun server sidecar)
├── web/
│   ├── index.html
│   └── assets/
├── data/
│   ├── rtwiki.sqlite
│   ├── attachments/
│   ├── backups/
│   └── window-state.json (desktop window geometry; UI-only state)
└── logs/
    └── rtwiki.log
```

Both executables live in the same directory, so the sidecar's executable-relative
path derivation (ADR-005) still resolves `data/` and `logs/` beside them. The
server's compiled-mode detection is extended to recognize `RTWikiServer.exe` in
addition to `RTWiki.exe`. Window geometry is stored under `data/` rather than
`%APPDATA%` so the workspace stays fully portable and no system directory is
written (AC-058).

### Features in this slice

| Feature | Implementation |
|---------|----------------|
| Native window | Tauri `WebviewWindow` loading the loopback URL |
| Launch at login | `tauri-plugin-autostart`, opt-in from Settings and the tray menu |
| System tray | Core `tray-icon` feature; menu: Open RTWiki / Open in Browser / Start with Windows / Quit |
| Single instance | `tauri-plugin-single-instance` (registered first); focuses the existing window |
| Close to tray | Window close hides to tray; Quit only from the tray menu |
| Window geometry | Custom portable persistence to `data/window-state.json` |
| Native notifications | `tauri-plugin-notification` when the IPC bridge is available, otherwise the Web Notification API |
| Native file dialogs | WebView2 renders `<input type="file">` with the OS picker; no change to the import path |
| Startup errors | `tauri-plugin-dialog` message dialog (Rust side) |
| Browser mode | Tray "Open in Browser" and `RTWiki.exe --browser` open the default browser |
| Managed port | Settings persists `data/server.json`; shell and server both honor it |
| Close behavior | Settings persists `data/desktop.json` (ask / minimize / quit); shell reads it on every close |
| Restart handshake | Frontend records `data/restart-requested`, shuts down, shell respawns the sidecar |
| Shutdown handshake | Server records `data/shutdown-requested` on an authorized shutdown, so the shell does not respawn the sidecar it was told to stop |

### Dual mode

The native app is the default. Browser mode is preserved:

- Tray menu **Open in Browser** opens the default browser at the running server.
- `RTWiki.exe --browser` starts the server and opens the browser without showing
  the native window (the tray icon still hosts Quit).
- The browser-first artifact (a single `RTWiki.exe` server plus `web/`) continues
  to be built and published unchanged.

### Managed port and restart handshake

The loopback port is Settings-managed, not hardcoded:

- `data/server.json` (`{ port }`) is the source of truth. Priority at boot:
  CLI `--port` beats the file, which beats the compiled default (8080).
  Only unprivileged ports (1024–65535) are accepted; anything else falls back
  to the default and the Settings API rejects it with 400.
- The shell reads the file at boot, spawns the sidecar with that port, and
  bakes it into the window URL — no navigation fix-up is ever needed.
- Changing the port takes effect on restart. The frontend flow is: save the
  port (`PUT /api/settings/server`), record a restart request
  (`POST /api/settings/server/restart`, creating `data/restart-requested`),
  shut the server down through the token-protected endpoint, then poll the
  new port's `/health` and reload the window onto the new URL.
- The shell's watch thread consumes the flag and respawns the sidecar with
  the freshly saved port. The same path recovers from unexpected sidecar
  exits (bounded: 3 crash respawns per minute, then an error dialog instead
  of a loop). A stale flag is cleared at boot.
- In browser mode there is no respawner: saving the port works, but the user
  relaunches manually. The Restart button is therefore desktop-only.

### Shutdown handshake

The watch thread treats every sidecar exit as a crash and respawns. That is
correct for crashes, but it would silently undo an authorized shutdown: the
sidecar would stop and immediately reappear, so the shutdown would look like it
never took effect. The server therefore records the intent before it exits:

- `POST /api/shutdown` writes `data/shutdown-requested` **after** the shutdown
  token check passes, then starts the graceful stop. A rejected request writes
  nothing, so an unauthorized caller can never suppress crash recovery.
- The shell's watch thread consumes the flag when it observes the exit and
  leaves the sidecar down. The tray stays resident, exactly as after a crash.
- Both handshake flags are cleared at boot. A flag left behind by a crash is
  never state to resume.
- Browser mode has no watcher, so the flag is simply unused there.

### Close behavior

`data/desktop.json` (`{ closeBehavior: "ask" | "minimize" | "quit" }`) is
managed in Settings and read by the shell on every close, so changes apply
immediately with no restart:

- `minimize` hides to the tray (geometry saved); `quit` exits the app.
- `ask` (default) shows a one-shot native dialog: OK minimizes, dismissing
  keeps the window open. Quit stays on the tray menu in every mode.
- The setting is meaningless in a browser, so the control is disabled there.

### Frontend bridge and graceful degradation
The frontend reaches native features through one guarded module
(`src/web/services/native-bridge.ts`). It detects the Tauri IPC bridge at runtime.
When the bridge is absent — browser mode, or a desktop build where the injected
IPC script did not initialise — every call degrades to the existing browser
behaviour:

- notifications fall back to the Web Notification API;
- the autostart control reports "unavailable" rather than failing silently;
- file import continues through the existing hidden file input (the OS picker in
  WebView2).

No native feature is required for the application to function. This keeps the
desktop shell additive and prevents a broken IPC bridge from blocking core use.

### Security posture

- The webview is restricted to the loopback origin; navigation to any other URL
  is refused by a Rust-side navigation handler.
- Tauri capabilities are least-privilege: only `core:default`, autostart
  enable/disable/query, and notification permissions are granted to the frontend.
  No filesystem, shell-execute, or arbitrary-open permissions are exposed to web
  content.
- The webview loads the **loopback origin**, which Tauri classifies as *remote*:
  "by default the API is only accessible to bundled code shipped with the Tauri
  App". The custom window chrome therefore needs its own remote capability
  (`capabilities/remote-loopback.json`) or every window command is denied and the
  chrome renders inert — a failure mode that is invisible until a real Windows
  build is launched. That capability grants only window controls
  (drag / minimize / toggle-maximize / is-maximized / hide / close) plus the
  event listener, scoped to `http://127.0.0.1:*`, and relies on the navigation
  handler to guarantee that origin is always RTWiki's own server. No filesystem,
  shell, or network permission is granted to remote content.
- The sidecar is spawned from Rust with an explicit path and an argument array —
  no shell string interpolation.
- The desktop window geometry file contains no user content, only integers and a
  boolean.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Electron | Larger footprint, bundles Chromium; Tauri reuses the system WebView2 runtime |
| Rewriting the backend in Rust | Violates ADR-002; the Bun/Hono server already implements the whole product |
| Tauri serving the SPA as its own assets | Duplicates the frontend origin, breaks the single-origin API model, and conflicts with the nonce/CSP design |
| A separate control channel between shell and server | Unnecessary: the existing `/health` and token-protected shutdown endpoints are sufficient |
| Keeping browser-only | Fails the owner's explicit native-experience requirement |

## Consequences

**Positive:**
- The user gets a normal Windows window, tray, autostart, and close-to-tray
  without any change to the backend, data model, or web UI architecture.
- The Study Scheduler can fire notifications while the window is minimized to the
  tray, partially closing the ADR-009 "app closed" gap.
- The workspace remains fully portable: moving the folder moves the data.
- Browser mode remains available for users who prefer it.

**Negative:**
- The build pipeline gains a Rust toolchain requirement for the desktop artifact.
  End users still need nothing installed (WebView2 ships with Windows 10 1803+).
- The artifact now contains two executables, and the desktop ZIP is larger than
  the browser ZIP.
- Autostart registers the current executable path; moving the folder after
  enabling autostart leaves a stale registry entry until the toggle is reset.

**Neutral:**
- Tauri is pinned as a build-time dependency of the desktop artifact only; the
  TypeScript application does not depend on it at runtime.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| The Tauri IPC bootstrap is blocked by the server's Content-Security-Policy | Medium | Resolved on a real Windows build: the bridge initialises, because Tauri's IPC falls back to `window.ipc.postMessage` when the custom protocol is unavailable, which the CSP does not block. Notifications use the native path; autostart reports its real state. If a future WebView2 change removes that fallback, revisit. |
| Windows toast branding for a portable (non-installed) app shows a generic identity | Medium | Accepted with the portable-ZIP distribution decision; native notifications still appear. Revisit if an installer is authorized. |
| A stale autostart registry entry after the folder is moved | Low | The Settings/tray toggle reads and rewrites the entry; documented as a known limitation. |
| The sidecar fails to start (missing file, port occupied by another app) | Low | The shell shows a native message dialog with the failure and exits; the server log records the cause. |
| Two RTWiki distributions (browser and desktop) launched together | Low | The server's existing single-instance probe detects the running instance; the shell attaches to it instead of starting a second server. |
| Rust compilation cannot be verified locally (no toolchain on the development PC) | High | The desktop artifact is compiled and smoke-tested in GitHub Actions on `windows-latest`. |

## Revisit Conditions

This decision should be revisited if:

- The server's CSP ever gains a directive that blocks `window.ipc.postMessage`,
  which is the transport Tauri's IPC falls back to for the loopback origin.
- A desktop-scoped CSP accommodation is required for any reason.
- An installer (MSI/NSIS) is authorized, which would change the portable layout
  and enable proper toast branding and file associations.
- The two-executable artifact size becomes a problem.
- Tauri is upgraded across a major version.
