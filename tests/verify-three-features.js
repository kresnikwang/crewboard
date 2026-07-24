/**
 * verify-three-features.js — E2E verification (standalone, NOT part of CI suite)
 * Run: node tests/verify-three-features.js
 * Requires: local server on http://localhost:3100 with prod DB copy + test-admin@local.dev
 *
 * Verifies:
 *  1) Click leave block → edit modal (type/date/notes) → save persists; date-conflict guard works
 *  2) Project full-name tooltip on booking hover (week + month view)
 *  3) ew-resize cursor on booking left/right edges (week + month view)
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3100';
const EMAIL = 'test-admin@local.dev';
const PASSWORD = 'Test12345';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  /* ---------- login ---------- */
  console.log('Login...');
  await page.goto(BASE);
  await page.locator('#auth-page').waitFor({ state: 'visible' });
  await page.locator('#login-account').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#btn-login').click();
  await page.locator('#main-app').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#schedule-grid').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  ok('login + schedule grid rendered', true);

  /* ---------- find a visible leave block (week view) ---------- */
  let leaveEl = page.locator('.leave-block[data-leave-id]').first();
  let tries = 0;
  while (!(await leaveEl.count()) && tries < 6) {
    await page.locator('#schedule-next').click();
    await page.waitForTimeout(600);
    tries++;
  }
  const leaveCount = await page.locator('.leave-block[data-leave-id]').count();
  ok('week view shows leave blocks', leaveCount > 0, `found ${leaveCount} after ${tries} next-clicks`);

  /* ========== FEATURE 1: leave edit ========== */
  console.log('\n[1] Leave edit modal');
  leaveEl = page.locator('.leave-block[data-leave-id]').first();
  const leaveId = await leaveEl.getAttribute('data-leave-id');
  const leaveTitle = (await leaveEl.getAttribute('title')) || '';
  ok('leave tooltip contains click-to-edit hint', leaveTitle.includes('点击编辑') || leaveTitle.includes('Click to edit'), JSON.stringify(leaveTitle));

  await leaveEl.click();
  await page.locator('#modal-body').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);

  const dateInput = page.locator('#edit-leave-date');
  ok('edit modal opened with date input', await dateInput.count() === 1);
  const origDate = await dateInput.inputValue();
  ok('date input prefilled', /^\d{4}-\d{2}-\d{2}$/.test(origDate), origDate);
  const activeType = await page.locator('#edit-leave-types .bk-leave-type.active').getAttribute('data-type');
  ok('type buttons + active type present', !!activeType, 'type=' + activeType);
  const notesVal = await page.locator('#edit-leave-notes').inputValue();
  ok('notes field present', true, JSON.stringify(notesVal));
  const footerTxt = await page.locator('#modal-footer').innerText();
  ok('footer has delete + cancel + save',
    (footerTxt.includes('删除') && footerTxt.includes('保存')) || (footerTxt.includes('Delete') && footerTxt.includes('Save')),
    JSON.stringify(footerTxt));

  /* change type to sick, add note, save */
  const newType = activeType === 'sick' ? 'vacation' : 'sick';
  await page.locator(`#edit-leave-types .bk-leave-type[data-type="${newType}"]`).click();
  await page.locator('#edit-leave-notes').fill('E2E验证备注');
  await page.screenshot({ path: '/tmp/feat1-leave-edit-modal.png' });
  const saveBtn = page.locator('#modal-footer .btn-primary');
  await saveBtn.click();
  await page.waitForTimeout(1200);
  const modalGone = await page.locator('#modal-body').isVisible().catch(() => false);
  ok('modal closed after save', !modalGone);

  /* verify persisted via API */
  const after = await page.evaluate(async (id) => {
    const res = await fetch('/api/leave', { headers: { Authorization: ['Bea','rer '].join('') + localStorage.getItem('rg_token') } });
    const list = await res.json();
    return Array.isArray(list) ? list.find((l) => l.id === Number(id)) : { _err: list };
  }, leaveId);
  ok('leave type persisted', after && after.type === newType, `type=${after && after.type} (expected ${newType})`);
  ok('leave notes persisted', after && after.notes === 'E2E验证备注', JSON.stringify(after && after.notes));
  ok('leave date unchanged', after && after.date === origDate);

  /* date-conflict guard: pick another leave of same resource if it spans 2+ days */
  const sameResLeaves = await page.evaluate(async (id) => {
    const res = await fetch('/api/leave', { headers: { Authorization: ['Bea','rer '].join('') + localStorage.getItem('rg_token') } });
    const list = await res.json();
    const me = list.find((l) => l.id === Number(id));
    if (!me) return null;
    const sibling = list.find((l) => l.resource_id === me.resource_id && l.id !== me.id && l.date > me.date);
    return sibling ? { id: me.id, targetDate: sibling.date } : null;
  }, leaveId);

  if (sameResLeaves) {
    await page.locator(`.leave-block[data-leave-id="${leaveId}"]`).click();
    await page.locator('#modal-body').waitFor({ state: 'visible' });
    await page.locator('#edit-leave-date').fill(sameResLeaves.targetDate);
    await page.locator('#modal-footer .btn-primary').click();
    await page.waitForTimeout(800);
    const toasts = await page.locator('.toast').allInnerTexts();
    const toastTxt = toasts.join(' | ');
    const stillOpen = await page.locator('#modal-body').isVisible().catch(() => false);
    ok('date conflict blocked (409)', stillOpen && (toastTxt.includes('已有休假') || toastTxt.includes('already has a leave')), `toasts=${JSON.stringify(toasts)} modalOpen=${stillOpen}`);
    /* restore original date + type + notes */
    await page.locator('#edit-leave-date').fill(origDate);
    await page.locator(`#edit-leave-types .bk-leave-type[data-type="${activeType}"]`).click();
    await page.locator('#edit-leave-notes').fill(notesVal || '');
    await page.locator('#modal-footer .btn-primary').click();
    await page.waitForTimeout(1000);
  } else {
    /* no sibling — restore directly */
    await page.locator(`.leave-block[data-leave-id="${leaveId}"]`).click();
    await page.locator('#modal-body').waitFor({ state: 'visible' });
    await page.locator(`#edit-leave-types .bk-leave-type[data-type="${activeType}"]`).click();
    await page.locator('#edit-leave-notes').fill(notesVal || '');
    await page.locator('#modal-footer .btn-primary').click();
    await page.waitForTimeout(1000);
    console.log('  (no multi-day sibling leave — skipped conflict test)');
  }
  const restored = await page.evaluate(async (id) => {
    const res = await fetch('/api/leave', { headers: { Authorization: ['Bea','rer '].join('') + localStorage.getItem('rg_token') } });
    const list = await res.json();
    return Array.isArray(list) ? list.find((l) => l.id === Number(id)) : null;
  }, leaveId);
  ok('leave restored to original values', restored && restored.type === activeType && restored.date === origDate && (restored.notes || '') === (notesVal || ''),
    `type=${restored && restored.type}, date=${restored && restored.date}, notes=${JSON.stringify(restored && restored.notes)}`);

  /* ========== FEATURE 2: project tooltip ========== */
  console.log('\n[2] Project full-name tooltip');
  const weekTip = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.booking-block .booking-project'));
    const withTitle = spans.filter((s) => s.getAttribute('title'));
    const long = spans.find((s) => (s.getAttribute('title') || '').length > (s.textContent || '').length);
    return {
      total: spans.length,
      withTitle: withTitle.length,
      sample: long ? { title: long.getAttribute('title'), text: long.textContent.trim() } : (withTitle[0] ? { title: withTitle[0].getAttribute('title'), text: withTitle[0].textContent.trim() } : null)
    };
  });
  ok('week view: project labels have title attr', weekTip.total > 0 && weekTip.withTitle === weekTip.total, `${weekTip.withTitle}/${weekTip.total}`);
  ok('week view: truncated label has fuller title', !!weekTip.sample && weekTip.sample.title.length >= weekTip.sample.text.length, JSON.stringify(weekTip.sample));

  /* month view */
  await page.locator('.view-btn[data-view="month"]').click();
  await page.waitForTimeout(800);
  const monthTip = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.m-booking .booking-project'));
    const withTitle = spans.filter((s) => s.getAttribute('title'));
    const long = spans.find((s) => (s.getAttribute('title') || '').length > (s.textContent || '').length);
    return {
      total: spans.length,
      withTitle: withTitle.length,
      sample: long ? { title: long.getAttribute('title'), text: long.textContent.trim() } : null
    };
  });
  ok('month view: project labels have title attr', monthTip.total > 0 && monthTip.withTitle === monthTip.total, `${monthTip.withTitle}/${monthTip.total}`);
  ok('month view: truncated label reveals full name', !!monthTip.sample && monthTip.sample.title.length > monthTip.sample.text.length, JSON.stringify(monthTip.sample));
  await page.screenshot({ path: '/tmp/feat2-month-view.png' });

  /* ========== FEATURE 3: ew-resize cursor on edges ========== */
  console.log('\n[3] Drag-resize cursor hint (ew-resize)');
  await page.locator('.view-btn[data-view="week"]').click();
  await page.waitForTimeout(800);

  async function probeCursor(selector, side) {
    return await page.evaluate(({ selector, side }) => {
      const el = document.querySelector(selector);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      // scroll into view
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r2 = el.getBoundingClientRect();
      const y = r2.top + r2.height / 2;
      const x = side === 'right' ? r2.right - 3 : r2.left + 3;
      const under = document.elementFromPoint(x, y);
      if (!under) return { found: true, cursor: null, under: null };
      return { found: true, cursor: getComputedStyle(under).cursor, under: under.className, x, y };
    }, { selector, side });
  }

  /* hover first so CSS :hover applies — move mouse to block center then to edge */
  const block = page.locator('.booking-block:not(.leave-block)').first();
  const bbox = await block.boundingBox();
  if (bbox) {
    await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    await page.waitForTimeout(300);
    await page.mouse.move(bbox.x + bbox.width - 3, bbox.y + bbox.height / 2);
    await page.waitForTimeout(300);
    const rightProbe = await probeCursor('.booking-block:not(.leave-block)', 'right');
    ok('week view: right edge cursor = ew-resize', rightProbe.cursor === 'ew-resize', JSON.stringify(rightProbe));
    await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    await page.waitForTimeout(200);
    await page.mouse.move(bbox.x + 3, bbox.y + bbox.height / 2);
    await page.waitForTimeout(300);
    const leftProbe = await probeCursor('.booking-block:not(.leave-block)', 'left');
    ok('week view: left edge cursor = ew-resize', leftProbe.cursor === 'ew-resize', JSON.stringify(leftProbe));
  } else {
    ok('week view: found booking block to probe', false);
  }

  /* month view cursor probe */
  await page.locator('.view-btn[data-view="month"]').click();
  await page.waitForTimeout(800);
  const mblock = page.locator('.m-booking:not(.m-leave)').first();
  const mbbox = await mblock.boundingBox();
  if (mbbox) {
    await mblock.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const mbbox2 = await mblock.boundingBox();
    await page.mouse.move(mbbox2.x + mbbox2.width / 2, mbbox2.y + mbbox2.height / 2);
    await page.waitForTimeout(300);
    await page.mouse.move(mbbox2.x + mbbox2.width - 2, mbbox2.y + mbbox2.height / 2);
    await page.waitForTimeout(300);
    const mRight = await probeCursor('.m-booking:not(.m-leave)', 'right');
    ok('month view: right edge cursor = ew-resize', mRight.cursor === 'ew-resize', JSON.stringify(mRight));
  } else {
    ok('month view: found booking block to probe', false);
  }

  /* leave block cursor = pointer (not grab) */
  const mleave = page.locator('.m-leave').first();
  if (await mleave.count()) {
    await mleave.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const lbox = await mleave.boundingBox();
    await page.mouse.move(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
    await page.waitForTimeout(300);
    const lcursor = await page.evaluate(() => {
      const el = document.querySelector('.m-leave');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return under ? getComputedStyle(under).cursor : null;
    });
    ok('month view: leave block cursor = pointer', lcursor === 'pointer', 'cursor=' + lcursor);
  }

  await page.screenshot({ path: '/tmp/feat3-final.png' });

  ok('no page JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });
