import { describe, expect, it } from 'bun:test'
import { APP_CONTENT_SECURITY_POLICY } from '../src/server/app.js'

/**
 * The app's Content-Security-Policy is load-bearing for features that are easy
 * to break silently, so the directives they depend on are pinned here.
 *
 * Nothing in the suite caught the absence of these assertions: removing
 * `'unsafe-inline'` from `styleSrc` makes Mermaid drop the `<style>` element it
 * injects into every diagram, and the result is a page full of unstyled diagrams
 * with no error anywhere. That is the failure this file exists to prevent.
 */
describe('app content security policy', () => {
  it('allows inline styles, which Mermaid needs for every diagram it renders', () => {
    // Mermaid emits a <style> block inside the SVG it produces. Without
    // 'unsafe-inline' the browser drops it and the diagram renders unstyled.
    expect(APP_CONTENT_SECURITY_POLICY.styleSrc).toContain("'unsafe-inline'")
  })

  it('still restricts styles to this origin', () => {
    // 'unsafe-inline' relaxes style injection, not style sourcing. Remote
    // stylesheets stay blocked.
    expect(APP_CONTENT_SECURITY_POLICY.styleSrc).toContain("'self'")
  })

  it('scopes scripts to this origin plus the per-request nonce', () => {
    expect(APP_CONTENT_SECURITY_POLICY.scriptSrc).toContain("'self'")
    expect(APP_CONTENT_SECURITY_POLICY.scriptSrc).not.toContain("'unsafe-inline'")
    expect(APP_CONTENT_SECURITY_POLICY.scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('blocks plugins and network origins outright', () => {
    expect(APP_CONTENT_SECURITY_POLICY.objectSrc).toEqual(["'none'"])
    expect(APP_CONTENT_SECURITY_POLICY.defaultSrc).toEqual(["'self'"])
    expect(APP_CONTENT_SECURITY_POLICY.frameAncestors).toEqual(["'none'"])
  })

  it('never widens any directive to a bare wildcard', () => {
    // A wildcard in a CSP is a blanket permission grant. None of our features
    // need one, so any appearance of it is a mistake worth failing on.
    // NONCE is a placeholder Hono substitutes per request, not a source string,
    // so only literal sources are checked.
    for (const [directive, sources] of Object.entries(APP_CONTENT_SECURITY_POLICY)) {
      for (const source of sources) {
        if (typeof source !== 'string') continue
        expect(source, `${directive} must not contain a wildcard`).not.toContain('*')
      }
    }
  })
})
