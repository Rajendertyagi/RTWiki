# ADR-001: Browser-First Local Application

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Superseded by** | — |

## Context

RTWiki is intended for a non-technical family user on a Windows home PC. The application must be easy to distribute, easy to run, and easy to update. The user should not need to install any runtime, configure environment variables, or interact with a command line. The application should feel like a modern web app — clean, fast, and visually polished.

Future access from phones and tablets on the home LAN is desirable but not required for the MVP. The architecture must make LAN access possible without a redesign, but it must not require it.

## Decision

RTWiki is built as a **browser-first local application**. The backend server runs locally on the user's PC and serves a React-based web UI. The user opens the application by double-clicking a Windows executable, which starts the local server and opens the default browser automatically. The user interacts with RTWiki entirely through the browser.

The executable is a thin launcher that:
1. Starts the Bun-based Hono server on localhost.
2. Opens the user's default browser to `http://127.0.0.1:<port>`.
3. Remains running in the background while the browser session is active.

The frontend is a standard Vite-built React application. All assets are bundled locally. No CDN is used at runtime.

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| Electron desktop app | Heavier footprint, more complex build pipeline, requires Chromium bundle |
| Tauri desktop app | Smaller than Electron but requires Rust toolchain for builds; adds complexity |
| Electrobun | Adds an extra abstraction layer on top of Bun; no clear advantage over the direct approach |
| Pure static site with local SQLite via WASM | Limited interactivity; no real-time autosave or search; complex offline sync |
| Progressive Web App (PWA) installed from a local server | Adds install complexity; offline capability is more limited than a native launcher |

## Consequences

**Positive:**
- Zero runtime installation required on the user's PC.
- The UI is built with standard web technologies that are well-understood and maintainable.
- LAN access is architecturally trivial — only the server bind address needs to change.
- Updates are a matter of replacing the executable and restarting.
- The development experience is fast (Vite hot reload) and the build pipeline is simple.

**Negative:**
- The user must have a default browser configured and functional.
- The browser window is an additional surface the user must manage (minimize, close, etc.).
- Some browser-specific behaviours (back button, tab closing) must be handled carefully to avoid confusion.

**Neutral:**
- The localhost-only default means the application is isolated from the network by default, which is a security benefit.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| User closes the browser but the server keeps running, consuming resources | Medium | The executable monitors the browser process and shuts down the server when the browser closes |
| Another application binds to the chosen port, preventing startup | Low | The server attempts to bind to the configured port and falls back to an alternate port with a clear error message |
| Browser security restrictions block local file access | Low | All file I/O goes through the backend API; the browser never accesses the filesystem directly |

## Revisit Conditions

This decision should be revisited if:
- The user base demands a native desktop experience (system tray icon, native menus, file associations).
- Performance profiling shows that a native wrapper provides a materially better experience.
- Browser-based limitations prevent a required feature from being implemented.
