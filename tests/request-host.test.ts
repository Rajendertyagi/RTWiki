import { describe, expect, it } from 'bun:test'
import { isAllowedHost, isUnsafeMethod } from '../src/server/utils/request-host.js'

/**
 * The Host allowlist and the unsafe-method set.
 *
 * The attack this stops is DNS rebinding: an attacker points a hostname they
 * control at 127.0.0.1, the browser then believes it is on its own site, and
 * issues a request carrying `Host: attacker.example`. The browser sends no
 * `Origin` and no `Sec-Fetch-Site`, because to it the request is same-origin --
 * which is why the origin check alone cannot stop this and `Host` can.
 *
 * The design goal is deliberately asymmetric: **blocking a legitimate user is
 * worse than the bug being prevented.** So the allowlist is generous, the port
 * is ignored, and anything unrecognised as a *malicious* host is allowed
 * through. Every case below that is marked "relaxed" documents a choice to
 * favour working over strictness.
 */

const CONFIGURED = '127.0.0.1'

describe('isAllowedHost — the loopback interface is always allowed', () => {
  const allowed = [
    '127.0.0.1',
    '127.0.0.1:8080',
    'localhost',
    'localhost:8080',
    'LOCALHOST:8080',
    '[::1]',
    '[::1]:8080',
    '127.0.0.2',
    '127.1.2.3:9999',
    '  127.0.0.1:8080  '
  ]

  it.each(allowed)('allows %s', (host) => {
    expect(isAllowedHost(host, CONFIGURED)).toBe(true)
  })
})

describe('isAllowedHost — another host is refused', () => {
  // This is the rebinding case. Without this, a page the user visits could
  // delete the whole timetable (see the cross-origin guard test).
  const refused = [
    'attacker.example',
    'attacker.example:8080',
    'evil.test',
    'localhost.attacker.example',
    // A near-miss on the loopback name must NOT be allowed: this is the shape a
    // hostname allowlist has to get right.
    'localhost.evil.example:8080',
    'notlocalhost',
    '127.0.0.1.evil.example',
    '127.0.0.1evil.example'
  ]

  it.each(refused)('refuses %s', (host) => {
    expect(isAllowedHost(host, CONFIGURED)).toBe(false)
  })
})

describe('isAllowedHost — the configured host is allowed, so LAN keeps working', () => {
  it('allows the host the server was configured to bind', () => {
    expect(isAllowedHost('192.168.1.50:8080', '192.168.1.50')).toBe(true)
    expect(isAllowedHost('nas.local', 'nas.local')).toBe(true)
  })

  it('still refuses a different host when one is configured', () => {
    expect(isAllowedHost('attacker.example', '192.168.1.50')).toBe(false)
  })
})

describe('isAllowedHost — relaxed by design', () => {
  /**
   * These are the deliberate fail-open cases. A browser ALWAYS sends a
   * well-formed Host, so a missing or unreadable one cannot be a rebinding
   * attempt -- it is an unfamiliar client, and refusing it would risk breaking
   * automation the owner depends on (the compiled-exe E2E script, curl, a
   * scheduled task).
   */
  it('allows a missing Host header', () => {
    expect(isAllowedHost(null, CONFIGURED)).toBe(true)
  })

  it('allows an empty or whitespace-only Host header', () => {
    expect(isAllowedHost('', CONFIGURED)).toBe(true)
    expect(isAllowedHost('   ', CONFIGURED)).toBe(true)
  })

  it('allows an unparseable Host rather than guessing', () => {
    expect(isAllowedHost('[::1', CONFIGURED)).toBe(true)
  })

  it('ignores the port entirely, so any port is fine', () => {
    // A rebinding attack changes the hostname, never the port, so comparing the
    // port would add no protection while making the check brittle. This is a
    // documented divergence from the NCC Group advisory, which specifies
    // `127.0.0.1:3000` exactly.
    expect(isAllowedHost('127.0.0.1:1', CONFIGURED)).toBe(true)
    expect(isAllowedHost('127.0.0.1:65535', CONFIGURED)).toBe(true)
  })
})

describe('isUnsafeMethod', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('treats %s as state-changing', (method) => {
    expect(isUnsafeMethod(method)).toBe(true)
    expect(isUnsafeMethod(method.toLowerCase())).toBe(true)
  })

  // GET is left alone on purpose: the health check and the desktop shell poll it,
  // and none of these methods writes.
  it.each(['GET', 'HEAD', 'OPTIONS'])('leaves %s alone', (method) => {
    expect(isUnsafeMethod(method)).toBe(false)
  })
})
