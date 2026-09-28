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

  test('项目表可多选并批量存档', async ({ page }) => {
    await goToPage(page, 'projects');
    await page.locator('#tab-projects').click();

    // Seed two throwaway projects through the API so the table has rows.
    const names = ['E2E批量A', 'E2E批量B'];
    const created = await page.evaluate(async (names) => {
      const out = [];
      for (const name of names) {
        const r = await api('/api/projects', { method: 'POST', body: { name, code: '' } });
        out.push({ id: r.id, name });
      }
      // Re-render in place; no reload needed (and the stored token would
      // auto-skip the login page).
      await window.loadProjects();
      return out;
    }, names);
    await expect(page.locator('.pc-row').first()).toBeVisible();

    // Admin sees the selection column.
    await expect(page.locator('.pc-select-all')).toBeVisible();
    const boxes = page.locator('.pc-select-item');
    for (const p of created) {
      await page.locator(`.pc-select-item[data-id="${p.id}"]`).check();
    }
    await expect(boxes.first()).toBeChecked();

    // Bulk bar reflects the count and offers archive.
    await expect(page.locator('#btn-bulk-archive')).toBeVisible();
    await expect(page.locator('.pc-bulk-count')).toContainText('2');

    // Confirm dialog lists both projects.
    page.once('dialog', (d) => {
      expect(d.message()).toContain('E2E批量A');
      expect(d.message()).toContain('E2E批量B');
      d.accept();
    });
    await page.locator('#btn-bulk-archive').click();

    // Both move to the archived tab.
    await expect(page.locator('#tab-archived')).toContainText('2', { timeout: 10000 });
    await page.locator('#tab-archived').click();
    const archived = page.locator('#clients-projects-container');
    await expect(archived).toContainText('E2E批量A');
    await expect(archived).toContainText('E2E批量B');

    // Selection is cleared after the operation.
    await page.locator('#tab-projects').click();
    await expect(page.locator('.pc-bulk-count')).toContainText('0');

    // Cleanup: restore then delete the seeded projects.
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        await api(`/api/projects/${id}/unarchive`, { method: 'PATCH' });
        await api(`/api/projects/${id}`, { method: 'DELETE' });
      }
    }, created.map((p) => p.id));
  });

  test('勾选项目不会误触发编辑弹窗', async ({ page }) => {
    await goToPage(page, 'projects');
    await page.locator('#tab-projects').click();
    await expect(page.locator('.pc-row').first()).toBeVisible();
    // Clicking the checkbox must not open the row's edit modal.
    await page.locator('.pc-select-item').first().click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
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
