import { chromium } from '@playwright/test'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto('http://127.0.0.1:8080/')
  await page.waitForTimeout(800)

  // Check Root header styling
  const rootInfo = await page.evaluate(() => {
    const rootItem = document.querySelector('.rtwiki-tree-root-item')
    if (!rootItem) return 'no root element found'
    const cs = getComputedStyle(rootItem)
    const rect = rootItem.getBoundingClientRect()
    return {
      tag: rootItem.tagName,
      classes: rootItem.className,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bgColor: cs.backgroundColor,
      display: cs.display,
      fontWeight: cs.fontWeight,
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight
    }
  })
  console.log('Root header:', rootInfo)

  // Check expander computed colors - what's the expander color actually resolving to?
  const expanderColors = await page.evaluate(() => {
    const expanders = document.querySelectorAll('i.wb-expander')
    return Array.from(expanders).map((el, i) => {
      const cs = getComputedStyle(el)
      const parent = el.parentElement?.parentElement?.parentElement
      const grandparent = parent?.parentElement
      return {
        index: i,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage?.substring(0, 60),
        maskSize: cs.maskSize,
        maskPosition: cs.maskPosition,
        maskRepeat: cs.maskRepeat,
        // Check what color the SVG mask inherits from parent
        parentColor: parent ? getComputedStyle(parent).color : 'none',
        grandparentColor: grandparent ? getComputedStyle(grandparent).color : 'none'
      }
    })
  })
  console.log('\nExpander resolved styles:')
  expanderColors.forEach((e) => {
    console.log(
      `[${e.index}] color=${e.color} bgImg=${e.backgroundImage} maskSize=${e.maskSize} parentColor=${e.parentColor}`
    )
  })

  // Check all highlight/background states on tree
  const highlightEls = await page.evaluate(() => {
    const els = document.querySelectorAll(
      '[class*="selected"], [class*="active"], .wb-selected, .wb-focus, .wb-hover, [style*="background"]'
    )
    return Array.from(els)
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((el) => {
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName,
          classes: el.className.split(' ').slice(0, 5).join(' '),
          bgColor: cs.backgroundColor,
          boxShadow: cs.boxShadow?.substring(0, 60),
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height)
        }
      })
  })
  console.log('\nHighlight/background elements:')
  highlightEls.forEach((h) => {
    console.log(`  ${h.tag} ${h.classes}`)
    console.log(`    bg=${h.bgColor} shadow=${h.boxShadow}`)
    console.log(`    size=${h.width}x${h.height}`)
  })

  await browser.close()
}

main().catch(console.error)
