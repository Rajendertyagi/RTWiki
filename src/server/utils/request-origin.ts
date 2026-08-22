/**
 * Validates that a request originates from this application's own origin by
 * checking fetch-metadata headers against the request URL's origin.
 *
 * Security model:
 * - When Sec-Fetch-Site is present, require exactly "same-origin".
 * - When Origin is present: reject "null", reject malformed values,
 *   require exact equality with `new URL(request.url).origin`.
 * - When Referer is present: reject malformed values, require exact origin equality.
 * - When no browser headers are present (CLI/automation path): accept; callers
 *   provide their own secondary protection where needed.
 *
 * The comparison is derived from the actual request URL, so it keeps working
 * unchanged if RTWiki is ever reached at an address other than loopback.
 */
export function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return false

  const requestOrigin = new URL(req.url).origin

  const origin = req.headers.get('origin')
  if (origin !== null) {
    if (origin === 'null') return false
    try {
      if (new URL(origin).origin !== requestOrigin) return false
    } catch {
      return false // malformed Origin
    }
    return true
  }

  const referer = req.headers.get('referer')
  if (referer !== null) {
    try {
      if (new URL(referer).origin !== requestOrigin) return false
    } catch {
      return false // malformed Referer
    }
    return true
  }

  return true // CLI/automation path
}
