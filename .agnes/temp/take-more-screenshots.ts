import { chromium } from '@playwright/test'
import * as path from 'path'

const outDir = 'D:/Temp/RTWiki-ui-audit/2026-09-08/'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://127.0.0.1:8080/')
  await page.waitForTimeout(800)

  // Check Root element styling
  const rootInfo = await page.evaluate(() => {
    const rootItem = document.querySelector('.rtwiki-tree-root-item')
    if (!rootItem) return null
    const cs = getComputedStyle(rootItem)
    const rect = rootItem.getBoundingClientRect()
    return {
      classes: rootItem.className,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bgColor: cs.backgroundColor,
      paddingLeft: cs.paddingLeft,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      color: cs.color
    }
  })
  console.log('Root element:', rootInfo)

  // Expand the first collapsed item (fdsfsd HTML Page) to see subfile rows
  const htmlRow = await page.$('[data-page-id="3562f19b-831a-447c-8396-1a89ce44d5d5"]')
  if (htmlRow) {
    const expander = await htmlRow.$('i.wb-expander')
    if (expander) {
      await expander.click()
      await page.waitForTimeout(300)

      // Screenshot after expansion
      await page.screenshot({
        path: path.join(outDir, '07-sidebar-expanded.png'),
        clip: { x: 0, y: 56, width: 360, height: 650 }
      })
    }
  }

  // Check theme toggle - switch to dark if light, or light if dark
  const themeBtn = await page.$('[aria-label*="theme"]')
  if (themeBtn) {
    await themeBtn.click()
    await page.waitForTimeout(300)

    await page.screenshot({ path: path.join(outDir, '08-dark-full.png'), fullPage: false })
    await page.screenshot({
      path: path.join(outDir, '09-dark-sidebar.png'),
      clip: { x: 0, y: 56, width: 360, height: 650 }
    })

    // Switch back
    await themeBtn.click()
    await page.waitForTimeout(300)
  }

  // Take narrow viewport screenshot
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(outDir, '10-narrow-full.png'), fullPage: false })

  await browser.close()
}

main().catch(console.error)
