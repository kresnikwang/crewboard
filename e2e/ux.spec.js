const { test, expect } = require('@playwright/test');
const { loadState, loginAsAdmin, goToPage, mondayOfThisWeek, nextWeekdayDate, fmt } = require('./helpers');

test('登录支持 Enter，空字段显示关联错误并聚焦', async ({ page }) => {
  const state = loadState();
  await page.goto('/');
  await page.locator('#login-password').press('Enter');
  await expect(page.locator('#login-account')).toBeFocused();
  await expect(page.locator('#login-account')).toHaveAttribute('aria-describedby', 'login-account-error');
  await expect(page.locator('#login-password-error')).toBeVisible();
  await page.locator('#login-account').fill(state.admin.email);
  await page.locator('#login-password').fill(state.admin.password);
  await page.locator('#login-password').press('Enter');
  await expect(page.locator('#main-app')).toBeVisible();
  await expect(page.locator('#auth-page')).toBeHidden();
});

test('可用键盘选择人员和项目并保存预订', async ({ page }) => {
  const state = loadState();
  // Other scheduling tests keep a booking for tomorrow. Use a separate date.
  const bookingDay = new Date(nextWeekdayDate() + 'T12:00:00');
  bookingDay.setDate(bookingDay.getDate() + 14);
  await loginAsAdmin(page);
  await page.locator('#btn-add-booking').click();
  await page.locator('#bk-submit-btn').click();
  await expect(page.locator('#bk-resource-search')).toBeFocused();
  await expect(page.locator('#bk-project-search')).toHaveAttribute('aria-invalid', 'true');
  const resource = page.getByRole('combobox', { name: /人员|Staff/ }).first();
  await resource.fill('E2E员工');
  await resource.press('ArrowDown');
  await resource.press('Enter');
  await expect(page.locator('#bk-resource-selected .ms-chip')).toHaveCount(1);
  await resource.press('Escape');
  await expect(page.locator('#modal-overlay')).toBeVisible();
  const project = page.locator('#bk-project-search');
  await project.fill(state.projectName);
  await project.press('ArrowDown');
  await project.press('Enter');
  await expect(page.locator('#bk-project')).toHaveValue(String(state.projectId));
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#bk-date-start').fill(fmt(bookingDay));
  await page.locator('#bk-date-end').fill(fmt(bookingDay));
  await page.locator('#bk-hours').fill('2');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/bookings') && r.request().method() === 'POST');
  await page.locator('#bk-submit-btn').press('Enter');
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const booking = await response.json();
  await expect(page.locator('#modal-overlay')).toBeHidden();
  await page.evaluate(id => api('/api/bookings/' + id, { method: 'DELETE' }), booking.id);
});

test('页面和日期可通过链接恢复，前进后退与键盘导航正常', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/#schedule\?/);
  await page.locator('.nav-item[data-page="resources"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#resources$/);
  await expect(page.locator('#page-resources')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#page-schedule')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#page-resources')).toBeVisible();
  await page.goto('/#schedule?start=2026-09-07&view=week');
  await expect(page.locator('#schedule-range')).toContainText(/9月7|Sep 7/);
  await page.locator('#schedule-next').click();
  await expect(page).toHaveURL(/start=2026-09-14/);
  await page.goBack();
  await expect(page.locator('#schedule-range')).toContainText(/9月7|Sep 7/);
});

test('图表依赖失败时仍展示报表，重试不重新请求数据', async ({ page }) => {
  let chartRequests = 0;
  let reportRequests = 0;
  await page.route('https://cdn.jsdelivr.net/**', route => { chartRequests++; return route.abort(); });
  page.on('request', request => { if (request.url().includes('/api/reports/utilization?')) reportRequests++; });
  await loginAsAdmin(page);
  await goToPage(page, 'reports');
  await expect(page.locator('.report-table')).toBeVisible();
  await expect(page.locator('.report-chart-status')).toContainText('图表暂时无法加载');
  await expect(page.locator('#btn-gen-report')).toBeEnabled();
  const dataRequests = reportRequests;
  await page.locator('.report-chart-status button').click();
  await expect.poll(() => chartRequests).toBe(2);
  await expect(page.locator('.report-table')).toBeVisible();
  expect(reportRequests).toBe(dataRequests);
});

test('手机与平板工时表不挤列，人员表滚动不撑开主内容', async ({ page }) => {
  const state = loadState();
  await loginAsAdmin(page);
  const booking = await page.evaluate(async data => api('/api/bookings', { method: 'POST', body: data }), {
    resource_id: state.resourceId, project_id: state.projectId, date: mondayOfThisWeek(), hours: 2
  });
  try {
    await goToPage(page, 'timesheets');
    await expect(page.locator('#ts-resource-select option[value="' + state.resourceId + '"]')).toHaveCount(1);
    await page.locator('#ts-resource-select').selectOption(String(state.resourceId));
    await expect(page.locator('.ts-input').first()).toBeVisible();
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => {
        const wrap = document.querySelector('.ts-table-wrap');
        const first = document.querySelector('.ts-table th:first-child');
        const day = document.querySelector('.ts-table th:nth-child(2)');
        const main = document.querySelector('.main-content');
        return { day: day.getBoundingClientRect().width, scroll: wrap.scrollWidth, client: wrap.clientWidth, mainScroll: main.scrollWidth, mainClient: main.clientWidth, sticky: getComputedStyle(first).position };
      });
      expect(dimensions.day).toBeGreaterThanOrEqual(90);
      expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
      expect(dimensions.mainScroll).toBeLessThanOrEqual(dimensions.mainClient + 1);
      expect(dimensions.sticky).toBe('sticky');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#hamburger-btn').click();
    await goToPage(page, 'resources');
    await expect(page.locator('.resource-table-wrap')).toBeVisible();
    const contained = await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    expect(contained).toBeTruthy();
    await expect(page.locator('.res-name').filter({ hasText: 'E2E员工' })).toBeVisible();
  } finally {
    await page.evaluate(id => api('/api/bookings/' + id, { method: 'DELETE' }), booking.id);
  }
});

test('关闭手机导航后恢复焦点，支持 Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  await page.locator('#hamburger-btn').press('Enter');
  await expect(page.locator('#sidebar-close-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#hamburger-btn')).toBeFocused();
  await expect(page.locator('#hamburger-btn')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#main-content').evaluate(el => el.inert)).toBe(false);
});
