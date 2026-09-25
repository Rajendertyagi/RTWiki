import { chromium } from '@playwright/test'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto('http://127.0.0.1:8080/')
  await page.waitForTimeout(800)

  // Check computed styles for tree rows
  const rowStyles = await page.evaluate(() => {
    const rows = document.querySelectorAll('.wb-row')
    return Array.from(rows).map((row, i) => {
      const titleEl = row.querySelector('.wb-title')
      const expanderEl = row.querySelector('.wb-expander')
      const iconEl = row.querySelector('.rtw-page-icon')

      const titleRect = titleEl ? titleEl.getBoundingClientRect() : null
      const expanderRect = expanderEl ? expanderEl.getBoundingClientRect() : null
      const iconRect = iconEl ? iconEl.getBoundingClientRect() : null
      const rowRect = row.getBoundingClientRect()

      return {
        index: i,
        pageId: row.getAttribute('data-page-id'),
        title: titleEl?.textContent || '',
        rowHeight: rowRect.height,
        titleHeight: titleRect?.height,
        titleTopOffset: titleRect?.top ? Math.round(titleRect.top - rowRect.top) : null,
        titleBottomOffset: titleRect?.bottom ? Math.round(rowRect.bottom - titleRect.bottom) : null,
        expanderHeight: expanderRect?.height,
        iconHeight: iconRect?.height,
        expanderTopOffset: expanderRect?.top ? Math.round(expanderRect.top - rowRect.top) : null,
        isHidden: getComputedStyle(row).display === 'none',
        classes: row.className
      }
    })
  })

  console.log('Row style analysis:')
  rowStyles.forEach((r) => {
    const page = r.pageId ? r.pageId.substring(0, 8) : 'ROOT/Header'
    console.log(
      `[${r.index}] ${page}: rowH=${r.rowHeight} titleTop=${r.titleTopOffset}titleBot=${r.titleBottomOffset} expanderTop=${r.expanderTopOffset} hidden=${r.isHidden}`
    )
  })

  // Check CSS variables and global sidebar styles
  const sidebarStyles = await page.evaluate(() => {
    const sidebar =
      document.querySelector('.rtwiki-sidebar') ||
      document.querySelector('[class*="sidebar"]') ||
      document.querySelector('.Layout-sidebar')
    if (!sidebar) return 'no sidebar element found'
    const cs = getComputedStyle(sidebar)
    return {
      width: cs.width,
      background: cs.backgroundColor,
      display: cs.display,
      flexDirection: cs.flexDirection
    }
  })
  console.log('\nSidebar styles:', sidebarStyles)

  // Check Root element specifically
  const rootEl = await page.$('.rtwiki-root-item')
  if (rootEl) {
    const rootStyle = await rootEl.evaluate((el) => ({
      tag: el.tagName,
      classes: el.className,
      height: el.getBoundingClientRect().height,
      display: getComputedStyle(el).display,
      backgroundColor: getComputedStyle(el).backgroundColor
    }))
    console.log('\nRoot element:', rootStyle)
  }

  // Check highlight/background elements
  const highlights = await page.evaluate(() => {
    const els = document.querySelectorAll(
      '[class*="selected"], [class*="active"], .wb-selected, .wb-focus, .rtwiki-tree-item'
    )
    return Array.from(els).map((el) => ({
      tag: el.tagName,
      classes: el.className,
      text: el.textContent?.substring(0, 30),
      rect: el.getBoundingClientRect()
    }))
  })
  console.log('\nHighlight/selection elements:')
  highlights.forEach((h) => {
    console.log(
      `  ${h.tag}.${h.classes
        .split(' ')
        .filter((c) => c.length < 20)
        .join(
          '.'
        )} — text="${h.text}" rect=[${Math.round(h.rect.left)},${Math.round(h.rect.top)},${Math.round(h.rect.width)}x${Math.round(h.rect.height)}]`
    )
  })

  await browser.close()
}

main().catch(console.error)
