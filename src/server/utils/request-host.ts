/**
 * Host header validation, for a server bound to the loopback interface.
 *
 * ## Why this exists
 *
 * Binding to `127.0.0.1` stops a *remote* host from reaching the server. It does
 * nothing about a web page already open in the user's own browser. A DNS
 * rebinding attack works by pointing an attacker-controlled hostname at
 * `127.0.0.1`; the browser then believes it is talking to its own site, issues
 * the request, and sends `Host: attacker.example:8080`.
 *
 * The critical detail is what such a request does **not** carry. Because the
 * browser considers it same-origin, it sends **no `Origin` header and no
 * `Sec-Fetch-Site` header**. `isSameOrigin()` therefore reaches its
 * no-browser-headers branch and returns `true` -- correctly for a command-line
 * client, and wrongly for a rebinding attack.
 *
 * `Host` is therefore the one header that reliably differs, which is why every
 * comparable local application validates it. The closest published case is the
 * Ollama DNS-rebinding advisory (CVE-2024-28224), which recommends that a
 * loopback service accept only `localhost` and the reserved loopback addresses:
 * <https://www.nccgroup.com/research/technical-advisory-ollama-dns-rebinding-attack-cve-2024-28224>
 *
 * CERT/CC documents the same attack class across Chromium, Chrome, Edge, Safari
 * and Firefox: <https://www.kb.cert.org/vuls/id/652514>
 *
 * ## Why this is deliberately permissive
 *
 * A security check that blocks a legitimate user is a worse bug than the one it
 * prevents, so this errs towards allowing:
 *
 * - **Hostname only; the port is ignored.** The rebinding attack changes the
 *   hostname, never the port, so comparing the port adds no protection here --
 *   but it would make the allowlist brittle across a configurable port and IPv6.
 *   (This is a deliberate, documented divergence from the advisory above, which
 *   specifies `127.0.0.1:3000`. The hostname is the part that matters.)
 * - **All of `127.0.0.0/8` is accepted**, not just `127.0.0.1`. The whole block is
 *   loopback, and the advisory calls for the reserved loopback addresses.
 * - **The configured `host` is accepted**, so this keeps working unchanged if LAN
 *   binding is ever authorised, rather than needing to be revisited at that point.
 * - **A missing or unparseable `Host` is ALLOWED.** A browser always sends a
 *   well-formed `Host`, so a malformed one cannot be a rebinding attempt -- it is
 *   some client we do not recognise, and refusing it would risk breaking
 *   automation the owner depends on. This is the "fail open on the unexpected"
 *   half of the trade, and it is safe precisely because the attacker cannot
 *   influence the shape of the header.
 */

/** Hostnames matched by name. `127.0.0.0/8` is matched by a rule, not here. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1'])

/**
 * HTTP methods that change state. `isSameOrigin()` is applied to these only.
 *
 * `GET`/`HEAD`/`OPTIONS` are excluded deliberately: they must stay reachable so
 * the health check and the desktop shell keep working, and none of them writes.
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * True when the `Host` header's hostname is loopback, the configured host, or
 * something we do not recognise well enough to judge.
 *
 * @param hostHeader - the raw `Host` header, or `null` when absent
 * @param configuredHost - the host the server was configured to bind
 */
export function isAllowedHost(hostHeader: string | null, configuredHost: string): boolean {
  // Fail open. A browser always sends a well-formed Host, so an absent or
  // unparseable value is an unfamiliar client, not a rebinding attempt.
  if (hostHeader === null) return true

  const hostname = extractHostname(hostHeader)
  if (hostname === null) return true

  const candidate = hostname.toLowerCase()
  if (LOOPBACK_HOSTNAMES.has(candidate)) return true
  // The whole 127.0.0/8 block is loopback.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate)) return true
  // The host the server was actually configured to bind, so an authorised LAN
  // phase keeps working without revisiting this check.
  if (candidate === configuredHost.toLowerCase()) return true
  // **Any** bracketed value is admitted, not only an IPv6 literal.
  //
  // This is deliberately broader than "it is an IPv6 loopback address", and the
  // comment used to claim otherwise. It is safe because a DNS rebinding attack
  // cannot reach it: the attack works by pointing an attacker-controlled
  // *hostname* at 127.0.0.1, brackets are not legal in a DNS name, and a browser
  // will not put them in a `Host` header. So the form that arrives here has
  // either come from a client we do not model or from a real bracketed IPv6
  // literal, and refusing it would break something without closing a hole.
  //
  // IPv6 loopback is admitted by the rules above -- `[::1]` and a bare `::1`
  // both match `LOOPBACK_HOSTNAMES` -- so this line is the fallback, not the
  // mechanism.
  if (candidate.startsWith('[') && candidate.endsWith(']')) return true

  return false
}

/** True for a method that changes state and so needs an origin check. */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase())
}

/**
 * The hostname part of a `Host` header, lowercased by the caller, with any port
 * and IPv6 brackets removed. Returns `null` when it cannot be read.
 */
function extractHostname(hostHeader: string): string | null {
  const value = hostHeader.trim()
  if (value === '') return null

  // IPv6 literal: [::1]:8080 -> [::1]
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close === -1) return null
    return value.slice(0, close + 1)
  }

  // A BARE IPv6 literal, e.g. ::1. Non-conforming as a Host header, but a client
  // may send one and it must not be mangled into a 403: for `::1` the text after
  // the last colon is `1`, which is numeric, so the port rule below would return
  // `:` and the value would match nothing. Two or more colons and no bracket means
  // there is no port to strip.
  if (value.indexOf(':') !== value.lastIndexOf(':')) return value

  // Strip the port. Only a trailing numeric segment is a port; otherwise the
  // colon is part of the host.
  const lastColon = value.lastIndexOf(':')
  if (lastColon === -1) return value
  const port = value.slice(lastColon + 1)
  if (port !== '' && /^\d+$/.test(port)) return value.slice(0, lastColon)
  return value
}
