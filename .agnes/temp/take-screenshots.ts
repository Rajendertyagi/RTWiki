import { chromium } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const outDir = 'D:/Temp/RTWiki-ui-audit/2026-09-08/'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://127.0.0.1:8080/')
  await page.waitForTimeout(800)

  // Screenshot 1: Full app shell desktop
  await page.screenshot({ path: path.join(outDir, '01-full-desktop.png'), fullPage: false })

  // Sidebar close-up (normal state)
  await page.screenshot({
    path: path.join(outDir, '02-sidebar-normal.png'),
    clip: { x: 0, y: 56, width: 360, height: 650 }
  })

  // Dashboard cards area
  await page.screenshot({
    path: path.join(outDir, '03-dashboard-cards.png'),
    clip: { x: 360, y: 80, width: 880, height: 500 }
  })

  // Click on Diagram to test selection
  const diagramRow = await page.$('[data-page-id="5d1525f5-5f31-4d4d-be8b-e0bc8b1090f9"]')
  if (diagramRow) {
    await diagramRow.click()
    await page.waitForTimeout(300)
    await page.screenshot({
      path: path.join(outDir, '04-sidebar-selected.png'),
      clip: { x: 0, y: 56, width: 360, height: 650 }
    })
  }

  // Hover over HTML Page row
  const htmlRow = await page.$('[data-page-id="3562f19b-831a-447c-8396-1a89ce44d5d5"]')
  if (htmlRow) {
    await htmlRow.hover()
    await page.waitForTimeout(200)
    await page.screenshot({
      path: path.join(outDir, '05-sidebar-hover.png'),
      clip: { x: 0, y: 56, width: 360, height: 650 }
    })
  }

  // Full app with selected state
  await page.screenshot({ path: path.join(outDir, '06-app-selected.png'), fullPage: false })

  await browser.close()
  console.log('Screenshots captured to:', outDir)
}

main().catch(console.error)
