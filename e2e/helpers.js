const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const STATE_PATH = path.join(__dirname, '.tmp', 'e2e-state.json');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

/** Login via UI and wait for main app */
async function loginAsAdmin(page, state = loadState()) {
  await page.goto('/');
  await page.locator('#auth-page').waitFor({ state: 'visible' });
  await page.locator('#login-account').fill(state.admin.email);
  await page.locator('#login-password').fill(state.admin.password);
  await page.locator('#btn-login').click();
  await expect(page.locator('#main-app')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#auth-page')).toBeHidden();
}

/** Navigate sidebar by data-page */
async function goToPage(page, pageName) {
  await page.locator(`.nav-item[data-page="${pageName}"]`).click();
  await expect(page.locator(`#page-${pageName}`)).toBeVisible();
}

/**
 * Select project in booking modal custom picker.
 * Opens dropdown, clicks option whose name contains projectName.
 */
async function selectProjectInModal(page, projectName) {
  const picker = page.locator('#bk-project-picker');
  await picker.locator('#bk-project-selected').click();
  const option = page.locator('#bk-project-dropdown .ms-option').filter({ hasText: projectName }).first();
  await expect(option).toBeVisible();
  await option.click();
  // hidden input should be set
  await expect(page.locator('#bk-project')).not.toHaveValue('');
}

/**
 * Ensure a resource is selected in multi-select (or select by name).
 */
async function ensureResourceSelected(page, resourceName) {
  const chips = page.locator('#bk-resource-selected .ms-chip');
  if ((await chips.count()) > 0) return;
  await page.locator('#bk-resource-selected').click();
  const option = page.locator('#bk-resource-dropdown .ms-option').filter({ hasText: resourceName }).first();
  await expect(option).toBeVisible();
  await option.click();
  // close dropdown by clicking elsewhere if still open
  await page.locator('#modal-title').click({ force: true }).catch(() => {});
}

/** Monday of current week as YYYY-MM-DD (local) */
function mondayOfThisWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return fmt(mon);
}

function fmt(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Tomorrow YYYY-MM-DD (local) — prefer a weekday for booking */
function nextWeekdayDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return fmt(d);
}

module.exports = {
  loadState,
  loginAsAdmin,
  goToPage,
  selectProjectInModal,
  ensureResourceSelected,
  mondayOfThisWeek,
  nextWeekdayDate,
  fmt,
};
