import { chromium } from '@playwright/test'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.goto('http://127.0.0.1:8080/')
  await page.waitForTimeout(1000)

  // Check expander alignment and visibility
  const expanders = await page.evaluate(() => {
    const expanderEls = document.querySelectorAll('.wb-expander')
    return Array.from(expanderEls).map((el, i) => ({
      index: i,
      className: el.className,
      offsetLeft: (el as HTMLElement).offsetLeft,
      offsetTop: (el as HTMLElement).offsetTop,
      parentOffsetLeft: (el.parentElement as HTMLElement)?.offsetLeft,
      title: el.getAttribute('aria-label'),
      isVisible:
        getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none',
      computedColor: getComputedStyle(el).color,
      computedFontSize: getComputedStyle(el).fontSize,
      computedWidth: getComputedStyle(el).width,
      computedHeight: getComputedStyle(el).height
    }))
  })

  console.log('Expanders:')
  expanders.forEach((e) => {
    console.log(
      `[${e.index}] vis=${e.isVisible} color=${e.computedColor} size=${e.computedFontSize} pos=left:${e.offsetLeft}px top:${e.offsetTop}px parentLeft:${e.parentOffsetLeft}px label=${e.title}`
    )
  })

  // Check row text alignment
  const rows = await page.evaluate(() => {
    const rowEls = document.querySelectorAll('.wb-row')
    return Array.from(rowEls).map((el, i) => {
      const titleEl = el.querySelector('.wb-title') as HTMLElement | null
      const nodeEl = el.querySelector('.wb-node') as HTMLElement | null
      const key = el.getAttribute('data-page-id') || el.getAttribute('data-subfile-id') || 'root'
      return {
        index: i,
        key: key.substring(0, 8),
        title: titleEl?.textContent?.trim() || '',
        titleWidth: titleEl?.offsetWidth,
        titleLeft: titleEl?.offsetLeft,
        nodeLeft: nodeEl?.offsetLeft,
        nodeWidth: nodeEl?.offsetWidth,
        rowHeight: el.offsetHeight,
        rowBg: getComputedStyle(el).backgroundColor,
        rowPaddingLeft: getComputedStyle(el).paddingLeft,
        titleAlign: titleEl ? getComputedStyle(titleEl).textAlign : 'n/a',
        titleDisplay: titleEl ? getComputedStyle(titleEl).display : 'n/a',
        titleOverflow: titleEl ? getComputedStyle(titleEl).overflow : 'n/a',
        nodeDisplay: nodeEl ? getComputedStyle(nodeEl).display : 'n/a',
        nodeOverflow: nodeEl ? getComputedStyle(nodeEl).overflow : 'n/a'
      }
    })
  })

  console.log('\nRows text alignment:')
  rows.forEach((r) => {
    console.log(
      `[${r.index}] "${r.title}" nodeL=${r.nodeLeft} titleL=${r.titleLeft} rowH=${r.rowHeight}pad=${r.rowPaddingLeft} titleW=${r.titleWidth} align=${r.titleAlign} ovr=${r.titleOverflow}`
    )
  })

  // Check selection/focus classes on rows
  const rowStates = await page.evaluate(() => {
    const rowEls = document.querySelectorAll('.wb-row[data-page-id]')
    return Array.from(rowEls).map((el, i) => {
      const cls = el.className
      const key = el.getAttribute('data-page-id')
      const ariaSel = el.getAttribute('aria-selected')
      const title = el.querySelector('.wb-title')?.textContent?.trim() || ''
      // Check which highlight classes exist
      const hasFocus = cls.includes('wb-focus')
      const hasSelected = cls.includes('wb-selected')
      const hasActive = cls.includes('wb-active')
      const bgStyle = getComputedStyle(el).backgroundColor
      return {
        index: i,
        key: key?.substring(0, 8),
        title,
        hasFocus,
        hasSelected,
        hasActive,
        ariaSelected: ariaSel,
        bgColor: bgStyle
      }
    })
  })

  console.log('\nRow highlight states:')
  rowStates.forEach((r) => {
    const marks = [
      `focus=${r.hasFocus}`,
      `selected=${r.hasSelected}`,
      `active=${r.hasActive}`,
      `aria=${r.ariaSelected}`,
      `bg=${r.bgColor}`
    ].join(' ')
    console.log(`[${r.index}] ${r.title}: ${marks}`)
  })

  // Full tree HTML
  const treeHTML = await page.evaluate(() => {
    const list = document.querySelector('.wb-node-list')
    return list?.innerHTML?.substring(0, 4000) || 'not found'
  })
  console.log('\nNode list HTML:')
  console.log(treeHTML)

  await browser.close()
}

main().catch(console.error)
