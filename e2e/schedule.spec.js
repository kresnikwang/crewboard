const { test, expect } = require('@playwright/test');
const {
  loadState,
  loginAsAdmin,
  selectProjectInModal,
  ensureResourceSelected,
  goToPage,
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

  test('管理页新建项目后，排程弹窗立即可选', async ({ page }) => {
    // Warm the modal's project cache first so this covers the stale-cache path.
    await page.locator('#btn-add-booking').click();
    await expect(page.locator('#modal-body')).toBeVisible();
    await page.locator('#modal-footer .btn-outline').click();
    await expect(page.locator('#modal-body')).toBeHidden();

    const projectName = '缓存刷新项目-' + Date.now();
    await goToPage(page, 'projects');
    await expect(page.locator('#btn-add-new-pc')).toBeVisible();
    await page.locator('#tab-projects').click();
    await page.locator('#btn-add-new-pc').click();
    await page.locator('#proj-name').fill(projectName);

    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith('/api/projects') &&
        response.request().method() === 'POST' &&
        response.ok()
      ),
      page.locator('#btn-save-project').click(),
    ]);
    await expect(page.locator('#modal-body')).toBeHidden();

    await goToPage(page, 'schedule');
    await page.locator('#btn-add-booking').click();
    await expect(page.locator('#modal-body')).toBeVisible();
    await selectProjectInModal(page, projectName);
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
  test('另一用户的排班推送只刷新受影响行，移动和删除保留其他排班', async ({ page }) => {
    const state = loadState();
    const adminHeaders = { Authorization: 'Bearer ' + state.token };
    const email = 'sse-actor-' + Date.now() + '@crewboard.test';
    const bulk = await page.request.post('/api/auth/enterprises/bulk-create', {
      headers: adminHeaders, data: { members: [{ name: 'SSE编辑者', email }], initial_password: 'Test1234!' },
    });
    expect(bulk.ok()).toBeTruthy();
    const actorId = (await bulk.json()).created[0].user_id;
    const role = await page.request.put(`/api/auth/enterprises/members/${actorId}/role`, {
      headers: adminHeaders, data: { role: 'manager' },
    });
    expect(role.ok()).toBeTruthy();
    const login = await page.request.post('/api/auth/login', { data: { account: email, password: 'Test1234!' } });
    const actorHeaders = { Authorization: 'Bearer ' + (await login.json()).token };
    const resource = await page.request.post('/api/resources', { headers: adminHeaders, data: { name: 'SSE目标行' } });
    const targetId = (await resource.json()).id;
    const project = await page.request.post('/api/projects', { headers: adminHeaders, data: { name: 'SSE测试项目' } });
    const projectId = (await project.json()).id;
    const date = await page.evaluate(async () => {
      window.apiCache.invalidateAll();
      await window.loadSchedule();
      const d = window.state.scheduleWeekStart;
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    });
    await page.evaluate((ids) => {
      const cell = document.querySelector('.booking-cell[data-resource="' + ids.target + '"]');
      window.__untouchedRow = cell.closest('tr');
    }, { target: state.resourceId });
    const requests = [];
    page.on('request', req => { if (req.url().includes('/api/schedule-data')) requests.push(req.url()); });
    const create = await page.request.post('/api/bookings', {
      headers: actorHeaders, data: { resource_id: targetId, project_id: projectId, date, hours: 2, force: true },
    });
    expect(create.ok()).toBeTruthy();
    const bookingId = (await create.json()).id;
    const block = page.locator(`.booking-block[data-booking-id="${bookingId}"]`);
    await expect(block).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(url => new URL(url).searchParams.has('resource_ids'))).toBeTruthy();
    expect(await page.evaluate(() => window.__untouchedRow.isConnected)).toBeTruthy();
    // Move between rows: both the old and new row must be patched.
    const moved = await page.request.put(`/api/bookings/${bookingId}`, {
      headers: actorHeaders, data: { resource_id: state.resourceId, project_id: projectId, date, hours: 2, force: true },
    });
    expect(moved.ok()).toBeTruthy();
    await expect(page.locator(`.booking-cell[data-resource="${state.resourceId}"] .booking-block[data-booking-id="${bookingId}"]`)).toBeVisible();
    await expect(page.locator(`.booking-cell[data-resource="${targetId}"] .booking-block[data-booking-id="${bookingId}"]`)).toHaveCount(0);
    expect(requests.some(url => {
      const ids = new URL(url).searchParams.get('resource_ids').split(',').map(Number);
      return ids.includes(targetId) && ids.includes(state.resourceId);
    })).toBeTruthy();
    const removed = await page.request.delete(`/api/bookings/${bookingId}`, { headers: actorHeaders });
    expect(removed.ok()).toBeTruthy();
    await expect(block).toHaveCount(0);
    // Leave uses the same filtered path, including month view.
    await page.locator('.view-btn[data-view="month"]').click();
    await expect(page.locator('.m-day-cell').first()).toBeVisible();
    const leave = await page.request.post('/api/leave', {
      headers: actorHeaders, data: { resource_id: targetId, date, type: 'vacation' },
    });
    expect(leave.ok()).toBeTruthy();
    const leaveId = (await leave.json()).id;
    await expect(page.locator(`[data-leave-id="${leaveId}"]`)).toBeVisible();
    await page.request.delete(`/api/leave/${leaveId}`, { headers: actorHeaders });
    await expect(page.locator(`[data-leave-id="${leaveId}"]`)).toHaveCount(0);
    // A missing resource forces an uncached full read, so a merged snapshot
    // cannot keep a resource that became inactive during another user's edit.
    const deactivate = await page.request.delete(`/api/resources/${targetId}`, { headers: adminHeaders });
    expect(deactivate.ok()).toBeTruthy();
    await page.evaluate(id => window.scheduleLoadSchedule({ resourceIds: [id], immediate: true }), targetId);
    await expect(page.locator(`.m-day-cell[data-resource="${targetId}"]`)).toHaveCount(0);
  });

  test('局部刷新合并突发事件，保留请求期间的新更新，切换周后丢弃旧响应', async ({ page }) => {
    const ids = await page.evaluate(() => window.state.resources.slice(0, 2).map(r => r.id));
    expect(ids.length).toBe(2);
    const requests = [];
    page.on('request', req => { if (req.url().includes('/api/schedule-data')) requests.push(req.url()); });
    // Hold the first filtered response, then queue another change while it runs.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    let first = true;
    await page.route('**/api/schedule-data?**', async route => {
      if (new URL(route.request().url()).searchParams.has('resource_ids') && first) {
        first = false;
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.evaluate(ids => {
      window.apiCache.invalidatePrefix('/api/schedule-data');
      window.scheduleLoadSchedule({ resourceIds: [ids[0]], delay: 30 });
      window.scheduleLoadSchedule({ resourceIds: [ids[1]], delay: 30 });
    }, ids);
    await firstStarted;
    const firstIds = new URL(requests[0]).searchParams.get('resource_ids').split(',').map(Number);
    expect(firstIds.sort()).toEqual(ids.slice().sort());
    await page.evaluate(id => window.scheduleLoadSchedule({ resourceIds: [id], delay: 10 }), ids[0]);
    release();
    await expect.poll(() => requests.filter(url => new URL(url).searchParams.has('resource_ids')).length).toBe(2);
    await page.unroute('**/api/schedule-data?**');

    // Freeze an old-week response and navigate while the request is pending.
    let releaseOld;
    const oldHeld = new Promise(resolve => { releaseOld = resolve; });
    let oldStarted;
    const oldReady = new Promise(resolve => { oldStarted = resolve; });
    let oldRequest = true;
    await page.route('**/api/schedule-data?**', async route => {
      if (new URL(route.request().url()).searchParams.has('resource_ids') && oldRequest) {
        oldRequest = false;
        const response = await route.fetch();
        oldStarted();
        await oldHeld;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.evaluate(id => window.scheduleLoadSchedule({ resourceIds: [id], immediate: true }), ids[0]);
    await oldReady;
    const oldDate = await page.locator('.booking-cell').first().getAttribute('data-date');
    await page.locator('#schedule-next').click();
    await expect.poll(() => page.locator('.booking-cell').first().getAttribute('data-date')).not.toBe(oldDate);
    const oldResponse = page.waitForResponse(response => response.url().includes('resource_ids=') &&
      new URL(response.url()).searchParams.get('start') === oldDate);
    releaseOld();
    await (await oldResponse).finished();
    // The queued fallback refreshes the current week after discarding the old response.
    expect(requests.filter(url => !new URL(url).searchParams.has('resource_ids')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator(`.booking-cell[data-date="${oldDate}"]`)).toHaveCount(0);
    await page.unroute('**/api/schedule-data?**');
    // An obsolete fetch must not overwrite a newer manually merged snapshot.
    let releaseCache;
    const cacheHeld = new Promise(resolve => { releaseCache = resolve; });
    let cacheStarted;
    const cacheReady = new Promise(resolve => { cacheStarted = resolve; });
    await page.route('**/api/health?cache-race=1', async route => {
      cacheStarted();
      await cacheHeld;
      await route.fulfill({ json: { marker: 'obsolete' } });
    });
    await page.evaluate(() => {
      window.__cachePending = window.cachedApi('/api/health?cache-race=1');
    });
    await cacheReady;
    await page.evaluate(() => {
      window.apiCache.invalidate('/api/health?cache-race=1');
      window.apiCache.set('/api/health?cache-race=1', { marker: 'current' });
    });
    releaseCache();
    expect(await page.evaluate(async () => {
      await window.__cachePending;
      return (await window.cachedApi('/api/health?cache-race=1')).marker;
    })).toBe('current');
  });

});
