/**
 * Date formatting helpers shared across the workspace.
 *
 * `formatDate` is the absolute, locale-stable label (used on cards and in the
 * status-bar detail popover). `formatRelativeTime` is the compact "x minutes
 * ago" form shown inline in the status bar so the modified time stays readable
 * at a glance without widening the bar.
 */

/** Absolute, locale-stable date (e.g. "9/8/2026"). Never throws. */
export function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return value
  }
}

/** Compact relative time (e.g. "just now", "5 min ago", "3 d ago"). */
export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return formatDate(value)
  const diffMs = Date.now() - then
  const sec = Math.round(diffMs / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day} d ago`
  const mon = Math.round(day / 30)
  if (mon < 12) return `${mon} mo ago`
  return `${Math.round(mon / 12)} y ago`
}
