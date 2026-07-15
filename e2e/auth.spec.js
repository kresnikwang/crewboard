const { test, expect } = require('@playwright/test');
const { loadState, loginAsAdmin } = require('./helpers');

test.describe('Auth UI', () => {
  test('登录页渲染关键元素', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#auth-page')).toBeVisible();
    await expect(page.locator('#login-account')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#btn-login')).toBeVisible();
    await expect(page.locator('#main-app')).toBeHidden();
  });

  test('错误密码显示失败（仍停留登录页）', async ({ page }) => {
    const state = loadState();
    await page.goto('/');
    await page.locator('#login-account').fill(state.admin.email);
    await page.locator('#login-password').fill('WrongPassword!!!');
    await page.locator('#btn-login').click();
    // stay on auth page
    await expect(page.locator('#auth-page')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#main-app')).toBeHidden();
  });

  test('管理员可成功登录进入主应用', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('#page-schedule')).toBeVisible();
    await expect(page.locator('.nav-item[data-page="schedule"]')).toHaveClass(/active/);
  });

  test('退出登录回到登录页', async ({ page }) => {
    await loginAsAdmin(page);
    // open user menu then logout
    await page.locator('#user-info').click();
    await page.locator('#btn-logout').click();
    await expect(page.locator('#auth-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#main-app')).toBeHidden();
  });
});
