const { test, expect } = require('@playwright/test');
const { loadState, loginAsAdmin } = require('./helpers');

/**
 * Verify browser session token works for protected APIs
 * (same origin + Authorization from localStorage).
 */
test.describe('Browser session API', () => {
  test('登录后 localStorage 有 token，/api/permissions 可访问', async ({ page }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem('rg_token'));
    expect(token).toBeTruthy();

    const result = await page.evaluate(async () => {
      const t = localStorage.getItem('rg_token');
      const res = await fetch('/api/permissions', {
        headers: { Authorization: 'Bearer ' + t },
      });
      return { status: res.status, body: await res.json() };
    });
    expect(result.status).toBe(200);
    expect(result.body.can_admin).toBe(true);
    expect(result.body.book_others).toBe(true);
  });

  test('登录后 schedule-data 可返回资源', async ({ page }) => {
    const state = loadState();
    await loginAsAdmin(page);
    const result = await page.evaluate(async () => {
      const t = localStorage.getItem('rg_token');
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 7);
      const fmt = (d) =>
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0');
      const res = await fetch(
        `/api/schedule-data?start=${fmt(start)}&end=${fmt(end)}`,
        { headers: { Authorization: 'Bearer ' + t } }
      );
      return { status: res.status, body: await res.json() };
    });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.resources)).toBe(true);
    expect(result.body.resources.some((r) => r.id === state.resourceId)).toBe(true);
  });
});
