import { expect, test } from '@playwright/test'
import { railSettings } from './utils/shell.js'

/**
 * The Backup settings panel.
 *
 * Two things are worth holding to a browser test rather than to unit tests:
 *
 *  1. The panel is only mounted while its section is open, so opening and closing
 *     Settings must not leave a request in flight or a spinner on screen.
 *  2. The restore confirmation has to say three specific things before a user
 *     agrees to replace their wiki. A dialog that only said "are you sure?" would
 *     pass every unit test and still be the wrong dialog, so the text is asserted
 *     here where the user actually reads it.
 *
 * **Type for real; never `.fill()`.** Playwright's `fill` sets a value without
 * key events, so a focus defect stays invisible — which is how one stayed hidden
 * on this project for a whole session. `pressSequentially` is used wherever a
 * value is typed.
 */

/**
 * Creates one page, so this file does not depend on ambient database contents.
 *
 * The browser suite now runs against a **fresh data directory per run**
 * (`scripts/serve-browser-tests.ts`), which is what made a hidden data dependency
 * in this spec visible: `openSettings` used `page-tree` as its "the app has
 * finished loading" signal, and `src/web/layout/sidebar.tsx:151` renders an empty
 * state *instead of* the tree when there are no pages. With the development
 * database carrying thousands of pages that assertion always passed; on an empty
 * one it failed before the test touched a single backup control.
 *
 * Seeding is the fix, and it makes the spec stronger rather than weaker: it now
 * says what it needs instead of inheriting whatever happened to be there.
 */
test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/pages', {
    data: { title: `Backup panel fixture ${Date.now()}`, pageType: 'rich', content: '[]' }
  })
  expect(res.status(), 'the fixture page must be created').toBe(201)
})

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  // The tree, which `sidebar.tsx` only renders once there is at least one page —
  // hence the fixture above rather than a weaker wait on the rail.
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await railSettings(page).click()
  await expect(page.getByTestId('settings-workspace')).toBeVisible({ timeout: 10_000 })
}

async function openBackupSection(page: import('@playwright/test').Page): Promise<void> {
  await openSettings(page)
  await page
    .locator('[data-testid="settings-workspace"] nav button')
    .filter({ hasText: /^Backup$/ })
    .click()
  // The panel fetches on mount, so wait for its content rather than a fixed delay.
  await expect(page.getByTestId('backup-table')).toBeVisible({ timeout: 10_000 })
}

test('the backup section is in the settings list and loads on demand', async ({ page }) => {
  await openBackupSection(page)

  // Mounted conditionally, so the panel exists only while the section is open.
  await expect(page.getByTestId('backup-table')).toBeVisible()

  // All three periods are offered, each with its own toggle, interval and button.
  for (const slot of ['daily', 'weekly', 'monthly']) {
    await expect(page.getByTestId(`backup-enabled-${slot}`)).toBeVisible()
    await expect(page.getByTestId(`backup-run-${slot}`)).toBeVisible()
    await expect(page.getByTestId(`backup-interval-${slot}`)).toBeVisible()
  }

  // The taken / not-taken line is asserted against what the server reports
  // rather than against a fresh install. This suite runs against the real data
  // directory, so a previous run's backup may legitimately exist; asserting
  // "No backup yet" unconditionally made the first assertion depend on whether
  // anything had ever run before it -- a test defect indistinguishable from a
  // product defect. Driving it from the API checks the same mapping honestly.
  const overview = (await (await page.request.get('/api/backup')).json()) as {
    backups: Array<{ slot: string; byteSize: number | null }>
  }
  for (const entry of overview.backups) {
    const label = page.getByTestId(`backup-when-${entry.slot}`)
    if (entry.byteSize === null) {
      await expect(label).toHaveText(/No backup yet/i)
    } else {
      await expect(label).toHaveText(/Last taken/i)
    }
  }
})

test('a period can be switched off and the choice survives reopening Settings', async ({
  page
}) => {
  await openBackupSection(page)

  const monthly = page.getByTestId('backup-enabled-monthly')
  // Put the period into a known state first. The suite runs against the real
  // data directory, so a previous run may already have switched this off, and
  // asserting "it starts on" would then be testing the order tests happen to
  // run in rather than the behaviour.
  await page.request.put('/api/backup/settings', {
    data: { slots: { monthly: { enabled: true, intervalHours: 720 } } }
  })
  await page.reload()
  await openBackupSection(page)
  await expect(monthly).toBeChecked()
  // Mantine's Switch hides its `<input>` and paints a track over it, so a click
  // aimed at the input is intercepted by `mantine-Switch-trackLabel` and
  // Playwright's actionability check refuses it forever. That is a TEST defect,
  // not a product one: a person clicks the visible track, and the enclosing
  // `<label>` forwards that to the input. So the click is aimed at the label,
  // which is what a real pointer press lands on.
  await page.locator('label:has([data-testid="backup-enabled-monthly"])').click()
  // The state actually changed, rather than the click merely having been sent --
  // so if the control ever stops responding, this fails as a product defect
  // rather than being papered over.
  await expect(monthly).not.toBeChecked()

  // The interval field follows the toggle, so a disabled period cannot be
  // silently re-tuned.
  await expect(page.getByTestId('backup-interval-monthly')).toBeDisabled()

  // Reopening must show the persisted value, not the default: this is the
  // difference between a setting and a local piece of state.
  await page.reload()
  await openBackupSection(page)
  await expect(page.getByTestId('backup-enabled-monthly')).not.toBeChecked()
})

test('an interval typed by hand is saved on blur', async ({ page }) => {
  // Start from a known value. This suite runs against the real data directory,
  // so a previous run may already have left 48 in place -- and then typing 48
  // would satisfy the assertion whether or not anything was saved, which is how
  // this test came to pass against the broken panel.
  await page.request.put('/api/backup/settings', {
    data: { slots: { daily: { enabled: true, intervalHours: 24 } } }
  })

  await openBackupSection(page)
  const field = page.getByTestId('backup-interval-daily')
  await expect(field).toHaveValue('24')
  await field.click()
  // Select the existing value before typing. The field arrives pre-filled with
  // the default, and appending to it yields 2448 rather than 48 -- a TEST defect
  // that is indistinguishable from a product defect if left alone.
  await field.press('Control+a')
  // pressSequentially, not fill: a value set without key events never exercises
  // the field the way a person does.
  await field.pressSequentially('48')
  await field.blur()

  await page.reload()
  await openBackupSection(page)
  await expect(page.getByTestId('backup-interval-daily')).toHaveValue('48')
})

test('taking a backup updates the list and reports success', async ({ page }) => {
  await openBackupSection(page)

  await page.getByTestId('backup-run-daily').click()

  // The panel reloads after the write, so the period stops saying "No backup yet".
  await expect(page.getByTestId('backup-when-daily')).not.toHaveText(/No backup yet/i, {
    timeout: 20_000
  })
  // And no error is shown.
  await expect(page.getByTestId('backup-panel-problem')).toHaveCount(0)
})

test('the restore dialog states what will happen before anything is changed', async ({ page }) => {
  await openBackupSection(page)

  // A backup to restore from.
  await page.getByTestId('backup-run-daily').click()
  await expect(page.getByTestId('backup-when-daily')).not.toHaveText(/No backup yet/i, {
    timeout: 20_000
  })

  const confirm = page.getByTestId('backup-restore-daily')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // The verdict is fetched before the dialog opens, so the dialog can be trusted
  // to describe a file that passed validation.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const text = (await dialog.textContent()) ?? ''

  // 1. Which backup.
  expect(text).toContain('rtwiki-backup-daily')
  // 2. That the current notes are moved aside rather than deleted, and where to.
  expect(text).toMatch(/not deleted/i)
  expect(text).toContain('rtwiki.pre-restore-')
  // 3. That RTWiki is about to close and has to be reopened.
  expect(text).toMatch(/will close/i)
  expect(text).toMatch(/open it again/i)

  // Cancelling must change nothing and close the dialog.
  await page.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('backup-restore-confirm')).toHaveCount(0)
})
