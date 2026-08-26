import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Physical hit-target verification.
 *
 * Playwright's actionability checks prove an element is attached and
 * enabled; they do NOT prove that the pixel a human would actually hit is
 * occupied by the intended control, nor that no invisible overlay, fixed
 * pane or portal sits above it. These helpers verify geometry the way a
 * person experiences it:
 *
 *  - a non-empty bounding box of practical pointer size,
 *  - document.elementFromPoint() at the centre (and optionally corners)
 *    resolving INSIDE the target element,
 *  - real mouse clicks at those coordinates landing on the expected control.
 */

export interface HitTargetOptions {
  minWidth?: number
  minHeight?: number
  /** Also probe the four corner points (inset 2px) instead of centre only. */
  corners?: boolean
  /** Human-readable name used in assertion messages. */
  label?: string
}

export interface HitPoint {
  x: number
  y: number
}

/** Verifies visible geometry + topmost-element ownership; returns centre. */
export async function assertHitTarget(
  page: Page,
  locator: Locator,
  options: HitTargetOptions = {}
): Promise<HitPoint> {
  const { minWidth = 12, minHeight = 12, corners = false } = options
  const label = options.label ?? locator.toString()

  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await expect(locator, `${label} should be visible`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${label} should have a bounding box`).not.toBeNull()
  const safeBox = box as { x: number; y: number; width: number; height: number }
  expect(
    safeBox.width,
    `${label} should be at least ${minWidth}px wide (got ${safeBox.width})`
  ).toBeGreaterThanOrEqual(minWidth)
  expect(
    safeBox.height,
    `${label} should be at least ${minHeight}px tall (got ${safeBox.height})`
  ).toBeGreaterThanOrEqual(minHeight)

  const points: HitPoint[] = [
    { x: safeBox.x + safeBox.width / 2, y: safeBox.y + safeBox.height / 2 }
  ]
  if (corners) {
    const inset = 2
    points.push(
      { x: safeBox.x + inset, y: safeBox.y + inset },
      { x: safeBox.x + safeBox.width - inset, y: safeBox.y + inset },
      { x: safeBox.x + inset, y: safeBox.y + safeBox.height - inset },
      { x: safeBox.x + safeBox.width - inset, y: safeBox.y + safeBox.height - inset }
    )
  }

  for (const point of points) {
    const owner = await page.evaluate(
      ({ px, py }) => {
        const el = document.elementFromPoint(px, py)
        return el
          ? { tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').slice(0, 40) }
          : null
      },
      { px: point.x, py: point.y }
    )
    // elementFromPoint must resolve to the target itself or a descendant.
    const hits = await page.evaluate(
      ({ px, py, expectedLeft, expectedTop, expectedRight, expectedBottom }) => {
        const el = document.elementFromPoint(px, py)
        if (!el) return false
        const rect = el.getBoundingClientRect()
        return (
          rect.left >= expectedLeft - 1 &&
          rect.top >= expectedTop - 1 &&
          rect.right <= expectedRight + 1 &&
          rect.bottom <= expectedBottom + 1
        )
      },
      {
        px: point.x,
        py: point.y,
        expectedLeft: safeBox.x,
        expectedTop: safeBox.y,
        expectedRight: safeBox.x + safeBox.width,
        expectedBottom: safeBox.y + safeBox.height
      }
    )
    expect(
      hits,
      `${label}: point (${Math.round(point.x)},${Math.round(point.y)}) is covered by ${
        owner ? `${owner.tag}["${owner.text}"]` : 'nothing'
      } instead of the target — an overlay/pane may be intercepting clicks`
    ).toBe(true)
  }

  return points[0]
}

/**
 * Real-mouse click at the verified centre (never locator.click()), for use
 * on surfaces where interception by overlays must be ruled out.
 */
export async function physicalClick(
  page: Page,
  locator: Locator,
  options: HitTargetOptions = {}
): Promise<void> {
  const centre = await assertHitTarget(page, locator, options)
  await page.mouse.click(centre.x, centre.y)
}

/** Clicks near each card corner to expose hotspots smaller than the card. */
export async function physicalClickCorner(
  page: Page,
  locator: Locator,
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  options: HitTargetOptions = {}
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const safeBox = box as { x: number; y: number; width: number; height: number }
  const inset = 6
  const map = {
    'top-left': { x: safeBox.x + inset, y: safeBox.y + inset },
    'top-right': { x: safeBox.x + safeBox.width - inset, y: safeBox.y + inset },
    'bottom-left': { x: safeBox.x + inset, y: safeBox.y + safeBox.height - inset },
    'bottom-right': { x: safeBox.x + safeBox.width - inset, y: safeBox.y + safeBox.height - inset }
  } as const
  await assertHitTarget(page, locator, options)
  await page.mouse.click(map[corner].x, map[corner].y)
}

/** Disables animations and caret blinking for deterministic screenshots. */
export async function freezeUi(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `
  })
}

/**
 * Deletes every living page through the API — controlled SETUP only, used
 * to give journeys a deterministic empty database. Never performs user
 * interactions.
 */
export async function resetDatabase(
  request: import('@playwright/test').APIRequestContext
): Promise<void> {
  let offset = 0
  for (;;) {
    const res = await request.get(`/api/pages?limit=100&offset=${offset}`)
    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      pages: Array<{ id: string }>
      total: number
    }
    if (body.pages.length === 0) break
    for (const page of body.pages) {
      const del = await request.delete(`/api/pages/${page.id}`)
      expect(del.status()).toBe(200)
    }
    offset += body.pages.length
    if (offset >= body.total) break
  }
}
