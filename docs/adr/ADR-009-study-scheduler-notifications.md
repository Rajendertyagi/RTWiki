# ADR-009: Study Scheduler Notification Engine and Settings

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-08 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

Slice 1 delivered the Study Timetable data model and calendar UI, including a
per-entry / per-reminder `notifications` JSON blob (`PeriodNotificationPrefs`,
`ReminderNotificationPrefs`) carried on every schedule row. Slice 2 must turn
those preferences into actual notifications and give the user controls for them.

RTWiki is a **local-first, browser-based, localhost-bound** application with no
push server, no cloud account, and no background process beyond the local Hono
server that serves the SPA and the API. That constrains the notification design:

- There is no always-on worker to deliver notifications while the app is closed;
  delivery can only happen while the SPA is loaded in a browser tab.
- The browser `Notification` API is the only OS-level channel, is strictly
  opt-in, and is gated behind a runtime permission.
- Timetable data already lives in the local SQLite DB and is already fetched by
  the calendar; the engine should reuse that data rather than introduce a second
  source of truth.

The questions: where should notification state live (per-row vs. global), where
should user Scheduler preferences live (DB vs. browser), how should the engine
avoid double-firing the same occurrence, and how should it behave across app
restarts and quiet hours?

## Decision

### Client-side engine, no push server

A single browser-side controller (`src/web/services/schedule-notifier.ts`) owns
the notification lifecycle. It is instantiated once as a module singleton and
started by a host component (`src/web/features/calendar/schedule-notifications.tsx`)
mounted inside `MantineProvider` in `App.tsx`. The engine:

- Loads the timetable via the existing `listEntries()` / `listReminders()` API
  calls (no new endpoints).
- Expands each enabled entry/reminder into concrete **notification moments**
  from its stored offset preferences: a weekly period contributes an occurrence
  for each selected weekday in a rolling `[yesterday … +7 days]` window; a
  one-off period contributes its dated occurrence; each reminder contributes its
  `dueDatetime`. For every occurrence it applies the offsets
  (`start` → 0 min, `fiveMinBefore` → −5 min, plus `customOffsets`) to produce
  absolute `when` timestamps.
- Fires **in-app toasts via `@mantine/notifications`** whenever enabled, and
  **browser notifications** via a thin `Notification` API wrapper
  (`src/web/services/browser-notify.ts`) when both the user setting and the
  browser permission allow.
- Runs on a **30-second tick**, a **startup missed-sweep**, and a
  `visibilitychange` refresh, so items that became due while the tab was hidden
  or the app was closed (within a 2-hour window) are surfaced once.

### Per-row preferences are the source of truth for *what* to fire

The `notifications` JSON already persisted on each schedule row (Slice 1) is the
authoritative description of *which* notifications an item produces. The engine
reads it; it never mutates it. This keeps the model single-source and lets the
period/reminder form remain the only place preferences are edited.

### Scheduler *user* preferences are browser-local (localStorage)

Global Scheduler choices — in-app on/off, browser on/off, and an optional quiet
hours window — are device preferences, not timetable data. They are stored in
localStorage (`src/web/features/workspace/scheduler-preferences.ts`) following
the exact pattern of the existing `layout-preferences.ts` /
`editor-preferences.ts` stores (versioned key, safe parse, privacy-mode
degrade-to-defaults). They are **not** placed in SQLite, because they are
per-install UI state, not shared wiki content, and the architecture keeps
runtime/UI preferences out of the portable data file.

### Dedupe via a persisted fired-key ledger

Each moment gets a stable key of `sourceId:occurrenceDate:offset`. Fired keys are
kept in localStorage (pruned after 8 days). Because the key includes the
occurrence **date**, a weekly period refires next week (different date →
different key) but never twice for the same occurrence. The ledger survives
restarts so a notification is not re-shown after a reload.

### Quiet hours defer, not drop

Moments due during the configured quiet window are **not** fired and are **not**
marked fired, so they can surface shortly after the window ends, bounded by the
2-hour missed-sweep window. This avoids a burst of late toasts the instant
quiet hours lift while still respecting the user's quiet period.

### Settings surface

A new **Scheduler** tab in the existing `SettingsWorkspace` exposes the in-app
and browser toggles (the browser toggle requests permission on enable), the
quiet-hours `TimeInput`s, and a `Send test notification` button that exercises
the same emit path. `main.tsx` imports `@mantine/notifications/styles.css` so
the toast portal is styled.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Backend/worker push (WebSocket, service worker, OS scheduler) | RTWiki is localhost-only with no background process and no LAN/cloud phase in MVP; violates the browser-first, local-first posture and adds a persistent-process requirement. |
| Store Scheduler user prefs in SQLite | They are per-install UI state, not wiki content; the established layout/editor preference stores already use localStorage, and keeping them out of the portable data file matches the data-layout ADR-005 intent. |
| Fire from a server-side timer that POSTs to the client | No push channel exists in MVP; would require a long-poll/socket the architecture does not include. |
| Mark quiet-hours items as fired immediately | Would silently drop reminders the user explicitly set; deferral (bounded by the missed window) is safer and still respects quiet hours. |
| Notification click opens the linked page | Deferred: the engine currently shows title/body only. Wiring click-to-open requires the notifications onClick to reach the app router; tracked as a revisit item to avoid scope creep in Slice 2. |

## Consequences

**Positive:**
- Notifications work with zero new server infrastructure, reusing the existing
  API and data model.
- No double-firing across restarts or across weekly recurrences; dedupe is
  deterministic and inspectable.
- User controls are local, instant, and privacy-mode safe.
- In-app toasts always work; browser notifications are a strict, opt-in
  augmentation.

**Negative:**
- Delivery only happens while the SPA is open in a browser tab; a study period
  due while the app is fully closed produces no notification (acceptable for an
  MVP local app, and partially covered by the startup missed-sweep on next open).
- The 30-second tick re-fetches the timetable; cheap at wiki scale but it is
  polling, not event-driven.
- Fired-key ledger lives in browser storage, so a different browser/device does
  not share already-shown state.

**Neutral:**
- `@mantine/notifications` is now a runtime UI dependency (already pinned at
  9.5.1 alongside the other Mantine packages).

## Security Model

Unchanged. All data the engine reads comes from the existing localhost-only,
schema-validated API; no new endpoints, no executable content, no network egress.
The browser-notification wrapper is guarded so it is a no-op when `Notification`
is unsupported or permission is denied, and it never transmits page content.
No changes to CSP, sandboxing, or attachment handling
([SECURITY.md](../SECURITY.md)).

## Risks

- If the SPA is closed for longer than the 2-hour missed window, an item due in
  that gap is skipped on next open (not back-filled). Mitigated by the window
  being generous for a study app; can be widened if owner feedback requests it.
- Browser permission denial silently disables the OS channel; the in-app channel
  remains and the settings tab shows the current permission state, so the user is
  never silently uninformed.
- Polling every 30s adds light background traffic; negligible at local scale.

## Revisit Conditions

- If a LAN/background phase is ever authorized, re-evaluate server-side delivery
  and a shared fired-state store.
- If owner feedback wants notification click-to-open for the linked page, add the
  onClick wiring in the emit path.
- If missed-window skipping proves annoying, widen `MISSED_WINDOW_MS`.
