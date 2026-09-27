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

/**
 * IPv6 has three separate behaviours, and each was once described wrongly. These
 * pin all three so a future edit cannot quietly change one of them.
 */
describe('IPv6 handling', () => {
  it('matches a bracketed IPv6 loopback literal', () => {
    expect(isAllowedHost('[::1]', CONFIGURED)).toBe(true)
    expect(isAllowedHost('[::1]:8080', CONFIGURED)).toBe(true)
    expect(isAllowedHost('[0:0:0:0:0:0:0:1]', CONFIGURED)).toBe(true)
  })

  it('matches a BARE IPv6 loopback literal instead of mangling it', () => {
    /**
     * This is the case that was broken. `::1` has one colon, and the text after it
     * is `1` -- numeric -- so the port-stripping rule used to return `:`, which
     * matched nothing and produced a 403. The allowlist listed `::1` all along and
     * never once matched it, because the value was destroyed before the lookup.
     */
    expect(isAllowedHost('::1', CONFIGURED)).toBe(true)
    expect(isAllowedHost('0:0:0:0:0:0:0:1', CONFIGURED)).toBe(true)
  })

  it('does not strip a port from a bare IPv6 literal that has one', () => {
    // `::1:8080` is two or more colons, so it is read whole. It is not loopback by
    // name, and it is not bracketed either -- so it falls through to the
    // configured-host comparison and is refused. Pinned because it is the
    // ambiguous case: there is no way to tell an IPv6 address from an address and
    // a port without brackets, and this allowlist does not try.
    expect(isAllowedHost('::1:8080', CONFIGURED)).toBe(false)
  })

  it('admits ANY bracketed value, not only an IPv6 literal -- stated, not implied', () => {
    /**
     * Deliberately permissive, and previously mis-described as "a bare IPv6
     * literal, with or without its zone index", which was neither what the code did
     * nor what it needed to do.
     *
     * It is safe because a rebinding attack cannot produce this form: the attack
     * points an attacker-controlled *hostname* at 127.0.0.1, and brackets are not
     * legal in a DNS name, so no browser will put them in a `Host` header. The
     * allowlist admits a shape it does not model rather than refusing a client it
     * does not recognise.
     */
    for (const host of ['[1.2.3.4]', '[attacker.example]', '[anything]', '[::2]']) {
      expect(isAllowedHost(host, CONFIGURED), `${host} is admitted by the fallback`).toBe(true)
    }
  })

  it('still refuses an unbracketed attacker name, which is the shape a browser sends', () => {
    // The counterpart to the test above, and the one that matters: a rebinding
    // attack arrives unbracketed, so it must still be refused.
    for (const host of ['attacker.example', 'attacker.example:8080', '::2', '2001:db8::1']) {
      expect(isAllowedHost(host, CONFIGURED), `${host} must be refused`).toBe(false)
    }
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
