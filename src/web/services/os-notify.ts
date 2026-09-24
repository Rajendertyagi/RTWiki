/**
 * Unified OS-notification emit for the Study Scheduler (ADR-011).
 *
 * Prefers the desktop shell's native toast when running inside Tauri and
 * falls back to the Web Notifications API otherwise, so reminders surface on
 * every platform without the caller caring which host is present.
 */

import { showBrowserNotification } from './browser-notify.js'
import { sendNativeNotification } from './native-bridge.js'

/** Emits an OS-level notification. Returns true when one was shown. */
export async function showOsNotification(title: string, body?: string): Promise<boolean> {
  if (await sendNativeNotification(title, body)) return true
  return showBrowserNotification(title, body)
}
