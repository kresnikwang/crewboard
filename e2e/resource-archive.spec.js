const { test, expect } = require('@playwright/test');
const { loginAsAdmin, goToPage, loadState } = require('./helpers');

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

async function createPerson(page, name) {
  return page.evaluate(async name => {
    const result = await api('/api/resources', { method: 'POST', body: { name, team: 'Freelance' } });
    await window.loadResources();
    return result.id;
  }, name);
}

test('编辑窗口存档、列表重新启用，排班与工时选择同步更新', async ({ page }) => {
  await goToPage(page, 'resources');
  const id = await createPerson(page, 'E2E可恢复人员');
  const row = page.locator(`#resource-list tr[data-id="${id}"]`);
  try {
    await row.locator('.btn-res-edit').click();
    await expect(page.locator('#btn-archive-resource')).toHaveText('存档人员');
    await expect(page.locator('#modal .resource-archive-hint')).toContainText('登录权限不变');
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('E2E可恢复人员');
      await dialog.accept();
    });
    await page.locator('#btn-archive-resource').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(row).toHaveCount(0);
    await goToPage(page, 'timesheets');
    await expect(page.locator(`#ts-resource-select option[value="${id}"]`)).toHaveCount(0);
    await goToPage(page, 'schedule');
    await expect.poll(() => page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(false);
    await goToPage(page, 'resources');
    await page.locator('#resource-tab-archived').click();
    await expect(row).toContainText('已存档');
    expect(await page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(false);
    await row.locator('.btn-res-edit').click();
    await expect(page.locator('#btn-archive-resource')).toHaveText('重新启用');
    await page.locator('#modal-footer').getByRole('button', { name: '取消', exact: true }).click();
    await row.getByRole('button', { name: '重新启用', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.locator('#resource-tab-active').click();
    await expect(row).toContainText('E2E可恢复人员');
    await goToPage(page, 'timesheets');
    await expect(page.locator(`#ts-resource-select option[value="${id}"]`)).toHaveCount(1);
    await goToPage(page, 'schedule');
    await expect.poll(() => page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(true);
  } finally {
    await page.evaluate(id => api(`/api/resources/${id}`, { method: 'DELETE' }), id);
  }
});

test('取消及请求失败保留人员状态，失败后可重试', async ({ page }) => {
  await goToPage(page, 'resources');
  const id = await createPerson(page, 'E2E存档失败重试');
  try {
    await page.locator(`#resource-list tr[data-id="${id}"] .btn-res-edit`).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#btn-archive-resource').click();
    await expect(page.locator('#modal-overlay')).toBeVisible();
    const stillActive = await page.evaluate(async id => (await api('/api/resources')).some(r => r.id === id), id);
    expect(stillActive).toBe(true);
    await page.route(`**/api/resources/${id}/archive`, route => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试失败，请重试' })
    }));
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-archive-resource').click();
    await expect(page.locator('.toast-msg').filter({ hasText: '测试失败，请重试' })).toBeVisible();
    await expect(page.locator('#btn-archive-resource')).toBeEnabled();
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await page.unroute(`**/api/resources/${id}/archive`);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-archive-resource').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator(`#resource-list tr[data-id="${id}"]`)).toHaveCount(0);
  } finally {
    await page.evaluate(id => api(`/api/resources/${id}`, { method: 'DELETE' }), id);
  }
});

test('手机存档列表与编辑操作可见，筛选支持键盘', async ({ page }) => {
  await goToPage(page, 'resources');
  const id = await createPerson(page, 'E2E手机存档人员');
  try {
    await page.evaluate(async id => {
      await api(`/api/resources/${id}/archive`, { method: 'PATCH' });
      await window.loadResources();
    }, id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#resource-tab-archived').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#resource-tab-archived')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#resource-tab-archived')).toBeFocused();
    expect(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.locator(`#resource-list tr[data-id="${id}"] .res-name`).click();
    await expect(page.locator('#btn-archive-resource')).toBeInViewport();
    await expect(page.locator('#btn-del-resource')).toBeInViewport();
    await expect.poll(() => page.locator('#modal-overlay').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    await page.screenshot({ path: 'e2e/.tmp/resource-archive-mobile.png', animations: 'disabled' });
    await page.locator('#btn-archive-resource').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator(`#resource-list tr[data-id="${id}"]`)).toHaveCount(0);
  } finally {
    await page.evaluate(id => api(`/api/resources/${id}`, { method: 'DELETE' }), id);
  }
});


test('另一管理员存档或恢复时，工时选择及排班自动同步', async ({ page }) => {
  const state = loadState();
  const headers = { Authorization: 'Bearer ' + state.token };
  const email = `archive-actor-${Date.now()}@crewboard.test`;
  const bulk = await page.request.post('/api/auth/enterprises/bulk-create', {
    headers, data: { members: [{ name: '存档管理员', email }], initial_password: 'Test1234!' }
  });
  expect(bulk.ok()).toBeTruthy();
  const actor = (await bulk.json()).created[0];
  const role = await page.request.put(`/api/auth/enterprises/members/${actor.user_id}/role`, {
    headers, data: { role: 'admin' }
  });
  expect(role.ok()).toBeTruthy();
  const login = await page.request.post('/api/auth/login', { data: { account: email, password: 'Test1234!' } });
  const actorHeaders = { Authorization: 'Bearer ' + (await login.json()).token };
  await goToPage(page, 'resources');
  const id = await createPerson(page, 'E2E多人存档同步');
  try {
    await goToPage(page, 'timesheets');
    const option = page.locator(`#ts-resource-select option[value="${id}"]`);
    await expect(option).toHaveCount(1);
    expect((await page.request.patch(`/api/resources/${id}/archive`, { headers: actorHeaders })).ok()).toBeTruthy();
    await expect(option).toHaveCount(0);
    expect((await page.request.patch(`/api/resources/${id}/unarchive`, { headers: actorHeaders })).ok()).toBeTruthy();
    await expect(option).toHaveCount(1);
    await goToPage(page, 'schedule');
    await expect.poll(() => page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(true);
    expect((await page.request.patch(`/api/resources/${id}/archive`, { headers: actorHeaders })).ok()).toBeTruthy();
    await expect.poll(() => page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(false);
    expect((await page.request.patch(`/api/resources/${id}/unarchive`, { headers: actorHeaders })).ok()).toBeTruthy();
    await expect.poll(() => page.evaluate(id => window.state.resources.some(r => r.id === id), id)).toBe(true);
  } finally {
    await page.evaluate(id => api(`/api/resources/${id}`, { method: 'DELETE' }), id);
    await page.request.delete(`/api/auth/enterprises/members/${actor.user_id}`, { headers });
  }
});
