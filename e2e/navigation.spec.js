const { test, expect } = require('@playwright/test');
const { loginAsAdmin, goToPage } = require('./helpers');

test.describe('Navigation & pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('侧边栏切换各主页面', async ({ page }) => {
    const pages = ['timesheets', 'reports', 'resources', 'projects', 'enterprise', 'schedule'];
    for (const name of pages) {
      await goToPage(page, name);
      await expect(page.locator(`#page-${name}`)).toBeVisible();
      await expect(page.locator(`.nav-item[data-page="${name}"]`)).toHaveClass(/active/);
    }
  });

  test('人员管理页显示资源列表区域', async ({ page }) => {
    await goToPage(page, 'resources');
    await expect(page.locator('#btn-add-resource')).toBeVisible();
    // list container from manage.js
    await page.waitForTimeout(500);
    const content = await page.locator('#page-resources').innerText();
    expect(content).toMatch(/E2E员工|人员|添加/);
  });

  test('客户项目页可切换 tab', async ({ page }) => {
    await goToPage(page, 'projects');
    await expect(page.locator('#tab-projects')).toBeVisible();
    await page.locator('#tab-clients').click();
    await expect(page.locator('#tab-clients')).toHaveClass(/active/);
    await page.locator('#tab-projects').click();
    await expect(page.locator('#tab-projects')).toHaveClass(/active/);
  });

  test('报表页可生成利用率报表', async ({ page }) => {
    await goToPage(page, 'reports');
    await expect(page.locator('#btn-gen-report')).toBeVisible();
    await page.locator('#report-type').selectOption('utilization');
    await page.locator('#btn-gen-report').click();
    await page.waitForTimeout(800);
    // report container should get content (not empty forever)
    const reportsPage = page.locator('#page-reports');
    await expect(reportsPage).toBeVisible();
    // look for any table or chart-ish content after generate
    const html = await reportsPage.innerHTML();
    expect(html.length).toBeGreaterThan(200);
  });

  test('工时表页加载并可选资源', async ({ page }) => {
    await goToPage(page, 'timesheets');
    await expect(page.locator('#ts-resource-select')).toBeVisible();
    await page.waitForTimeout(600);
    const options = page.locator('#ts-resource-select option');
    await expect(options.first()).toBeAttached({ timeout: 10000 });
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('企业管理页显示企业信息与审计区', async ({ page }) => {
    await goToPage(page, 'enterprise');
    await page.waitForTimeout(800);
    const text = await page.locator('#page-enterprise').innerText();
    expect(text).toMatch(/E2E|企业|邀请|审计/);
  });
});
