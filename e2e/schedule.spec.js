const { test, expect } = require('@playwright/test');
const {
  loadState,
  loginAsAdmin,
  selectProjectInModal,
  ensureResourceSelected,
  nextWeekdayDate,
} = require('./helpers');

test.describe('Schedule UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('#page-schedule')).toBeVisible();
    // wait schedule grid to render
    await expect(page.locator('#schedule-grid')).toBeVisible();
    await page.waitForTimeout(500); // allow schedule-data fetch
  });

  test('排程页加载网格与导航按钮', async ({ page }) => {
    await expect(page.locator('#btn-add-booking')).toBeVisible();
    await expect(page.locator('#schedule-today')).toBeVisible();
    await expect(page.locator('#schedule-prev')).toBeVisible();
    await expect(page.locator('#schedule-next')).toBeVisible();
    await expect(page.locator('#view-toggle')).toBeVisible();
    // grid should have some content after load
    const gridHtml = await page.locator('#schedule-grid').innerHTML();
    expect(gridHtml.length).toBeGreaterThan(50);
  });

  test('周/月视图切换', async ({ page }) => {
    await page.locator('.view-btn[data-view="month"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.view-btn[data-view="month"]')).toHaveClass(/active/);
    await page.locator('.view-btn[data-view="week"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.view-btn[data-view="week"]')).toHaveClass(/active/);
  });

  test('新建预订弹窗 → 选择项目与人员 → 创建成功', async ({ page }) => {
    const state = loadState();
    const date = nextWeekdayDate();

    await page.locator('#btn-add-booking').click();
    await expect(page.locator('#modal-overlay.show, #modal-overlay.showing, .modal.show')).toBeVisible({
      timeout: 8000,
    }).catch(async () => {
      // Bootstrap may use class "show" on #modal-overlay
      await expect(page.locator('#modal-body')).toBeVisible();
    });
    await expect(page.locator('#modal-body')).toBeVisible();
    await expect(page.locator('#bk-submit-btn')).toBeVisible();

    // fill dates & hours
    await page.locator('#bk-date-start').fill(date);
    await page.locator('#bk-date-end').fill(date);
    await page.locator('#bk-hours').fill('4');

    // resource
    await ensureResourceSelected(page, 'E2E员工');

    // project
    await selectProjectInModal(page, state.projectName || 'E2E项目');

    // submit
    await page.locator('#bk-submit-btn').click();

    // modal should close
    await expect(page.locator('#modal-body')).toBeHidden({ timeout: 15000 }).catch(async () => {
      // if modal still open, check for error toast/text
      const body = await page.locator('#modal-body').innerText().catch(() => '');
      throw new Error('Modal still open after submit. body snippet: ' + body.slice(0, 200));
    });

    // verify via API that booking exists
    const token = state.token;
    const res = await page.request.get(
      `/api/bookings?start=${date}&end=${date}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    const hit = list.find(
      (b) => b.resource_id === state.resourceId && b.project_id === state.projectId && b.date === date
    );
    expect(hit, `expected booking on ${date}`).toBeTruthy();
    expect(Number(hit.hours)).toBe(4);
  });

  test('本周按钮可点击且网格保持可见', async ({ page }) => {
    await page.locator('#schedule-next').click();
    await page.waitForTimeout(300);
    await page.locator('#schedule-today').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#schedule-grid')).toBeVisible();
    const range = await page.locator('#schedule-range').textContent();
    expect((range || '').length).toBeGreaterThan(0);
  });
});
