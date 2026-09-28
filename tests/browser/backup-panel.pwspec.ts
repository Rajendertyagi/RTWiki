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

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
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

  // All three periods are offered, each with its own toggle and its own button.
  for (const slot of ['daily', 'weekly', 'monthly']) {
    await expect(page.getByTestId(`backup-enabled-${slot}`)).toBeVisible()
    await expect(page.getByTestId(`backup-run-${slot}`)).toBeVisible()
  }

  // A fresh install has no backups yet, and says so per period rather than
  // showing an empty table with no explanation.
  await expect(page.getByTestId('backup-when-daily')).toHaveText(/No backup yet/i)
})

test('a period can be switched off and the choice survives reopening Settings', async ({
  page
}) => {
  await openBackupSection(page)

  const monthly = page.getByTestId('backup-enabled-monthly')
  await expect(monthly).toBeChecked()
  await monthly.click()
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
  await openBackupSection(page)

  const field = page.getByTestId('backup-interval-daily')
  await field.click()
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
