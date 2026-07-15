const { test, expect } = require('@playwright/test');
const { loadState, loginAsAdmin, goToPage } = require('./helpers');

test.describe('Timesheets UI', () => {
  test('从排程复制按钮可见且可点击', async ({ page }) => {
    const state = loadState();
    await loginAsAdmin(page);
    await goToPage(page, 'timesheets');

    await expect(page.locator('#ts-copy-from-schedule')).toBeVisible();
    await page.waitForTimeout(500);

    // select seeded resource if available
    const select = page.locator('#ts-resource-select');
    const opts = await select.locator('option').allTextContents();
    if (opts.length > 1) {
      // pick non-empty option
      const values = await select.locator('option').evaluateAll((nodes) =>
        nodes.map((n) => n.value).filter(Boolean)
      );
      if (values.includes(String(state.resourceId))) {
        await select.selectOption(String(state.resourceId));
      } else if (values[0]) {
        await select.selectOption(values[0]);
      }
      await page.waitForTimeout(400);
    }

    await page.locator('#ts-copy-from-schedule').click();
    await page.waitForTimeout(800);
    // page should still be on timesheets without crash
    await expect(page.locator('#page-timesheets')).toBeVisible();
    await expect(page.locator('#timesheet-container')).toBeVisible();
  });
});
