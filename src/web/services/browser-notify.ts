/**
 * Thin, CSP-safe wrapper around the Web Notifications API for the study
 * Scheduler (Slice 2). All access is guarded so it degrades gracefully in
 * environments without Notification support or where permission is denied.
 *
 * RTWiki is a local-first app bound to 127.0.0.1, so browser notifications are
 * strictly optional and opt-in. In-app toasts (@mantine/notifications) remain
 * the primary channel; this only augments them when the user enables it and the
 * browser has granted permission.
 */

export type BrowserPermission = NotificationPermission | 'unsupported'

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined'
}

export function browserNotificationPermission(): BrowserPermission {
  if (!browserNotificationsSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestBrowserNotificationPermission(): Promise<BrowserPermission> {
  if (!browserNotificationsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function showBrowserNotification(title: string, body?: string): boolean {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return false
  try {
    new Notification(title, { body })
    return true
  } catch {
    return false
  }
}
