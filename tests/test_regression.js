/**
 * CrewBoard — 回归冒烟测试（自启动临时库）
 * 覆盖今天改动后仍应保持的主业务链路，确认「原有功能可用」。
 *
 * 运行: node tests/test_regression.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const TS = Date.now();
const TMP_DIR = path.join(__dirname, '.tmp');
const DB_PATH = path.join(TMP_DIR, `test-regression-${TS}.db`);
const PORT = 3200 + (TS % 400);

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS  ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL  ${name}${detail ? '  →  ' + detail : ''}`);
  }
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch (_) { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.DB_PATH = DB_PATH;
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';

  const { server, db } = require('../server');
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });

  console.log(`\n🧪 Regression smoke on :${PORT}\n`);

  try {
    // ── Auth & enterprise ────────────────────────────────────────────
    console.log('📋 Auth / 企业');
    const reg = await request('POST', '/api/auth/register', {
      name: '回归管理员',
      email: `reg-admin-${TS}@crewboard.test`,
      password: 'Test1234!',
    });
    assert('注册成功', reg.status === 200 && reg.body.token, JSON.stringify(reg.body));
    const adminToken = reg.body.token;

    const ent = await request('POST', '/api/auth/enterprises', { name: '回归测试企业' }, adminToken);
    assert('创建企业', ent.status === 200 && ent.body.id, JSON.stringify(ent.body));

    const me = await request('GET', '/api/auth/me', null, adminToken);
    assert('/me 可用', me.status === 200 && me.body.user && me.body.enterprise, JSON.stringify(me.body));
    assert('角色为 admin', me.body.user.role === 'admin', me.body.user.role);
    assert('secret 不回传', me.body.enterprise.wecom_secret === '', JSON.stringify(me.body.enterprise));
    const code = me.body.enterprise.code;

    const login = await request('POST', '/api/auth/login', {
      account: `reg-admin-${TS}@crewboard.test`,
      password: 'Test1234!',
    });
    assert('登录成功', login.status === 200 && login.body.token, JSON.stringify(login.body));

    const perms = await request('GET', '/api/permissions', null, adminToken);
    assert('permissions 兼容字段', perms.body.can_book && perms.body.book_others && perms.body.can_admin);

    // manager + basic
    const regMgr = await request('POST', '/api/auth/register', {
      name: '回归经理', email: `reg-mgr-${TS}@crewboard.test`, password: 'Test1234!',
    });
    await request('POST', '/api/auth/enterprises/join', { code }, regMgr.body.token);
    let reqs = await request('GET', '/api/auth/enterprises/requests', null, adminToken);
    let pending = (reqs.body || []).find(r => r.status === 'pending');
    if (pending) await request('PUT', `/api/auth/enterprises/requests/${pending.id}`, { status: 'approved' }, adminToken);
    let members = await request('GET', '/api/auth/enterprises/members', null, adminToken);
    let mgrUser = (members.body || []).find(m => m.email === `reg-mgr-${TS}@crewboard.test`);
    if (mgrUser) await request('PUT', `/api/auth/enterprises/members/${mgrUser.id}/role`, { role: 'manager' }, adminToken);
    const mgrLogin = await request('POST', '/api/auth/login', {
      account: `reg-mgr-${TS}@crewboard.test`, password: 'Test1234!',
    });
    const mgrToken = mgrLogin.body.token;
    assert('经理登录', !!mgrToken);

    // ── Master data ──────────────────────────────────────────────────
    console.log('\n📋 主数据 CRUD');
    const client = await request('POST', '/api/clients', { name: '客户甲', color: '#111111' }, adminToken);
    assert('创建客户', client.status === 200 && client.body.id);

    const project = await request('POST', '/api/projects', {
      name: '项目Alpha', client_id: client.body.id, color: '#222222', budget_hours: 100,
    }, adminToken);
    assert('创建项目', project.status === 200 && project.body.id);

    const scope = await request('POST', `/api/projects/${project.body.id}/scopes`, {
      name: '前端', description: 'UI',
    }, adminToken);
    assert('创建工作范围', scope.status === 200 && scope.body.id);

    const scopes = await request('GET', `/api/projects/${project.body.id}/scopes`, null, adminToken);
    assert('列出 scopes', scopes.status === 200 && scopes.body.length >= 1);

    const resource = await request('POST', '/api/resources', {
      name: '张三', role: 'Dev', team: '研发', hours_per_day: 8, email: `zhang-${TS}@t.com`,
    }, adminToken);
    assert('创建资源', resource.status === 200 && resource.body.id);
    const rid = resource.body.id;
    const pid = project.body.id;
    const sid = scope.body.id;

    const resList = await request('GET', '/api/resources', null, adminToken);
    assert('资源列表含新建', resList.status === 200 && resList.body.some(r => r.id === rid));

    const projList = await request('GET', '/api/projects', null, adminToken);
    assert('项目列表含新建', projList.status === 200 && projList.body.some(p => p.id === pid));

    // manager can create project
    const mgrProj = await request('POST', '/api/projects', { name: '经理项目' }, mgrToken);
    assert('经理可建项目', mgrProj.status === 200 && mgrProj.body.id);

    // ── Schedule happy path (no conflict) ────────────────────────────
    console.log('\n📋 排程主路径（无冲突）');
    const day1 = '2031-06-02'; // Monday-ish future
    const day2 = '2031-06-03';
    const book = await request('POST', '/api/bookings', {
      resource_id: rid,
      project_id: pid,
      project_scope_id: sid,
      date: day1,
      end_date: day2,
      hours: 4,
      notes: '回归测试',
    }, adminToken);
    assert('创建排程（范围 2 天）', book.status === 200 && book.body.ids && book.body.ids.length === 2,
      JSON.stringify(book.body));
    const bookingId = book.body.id;

    const books = await request('GET', `/api/bookings?start=2031-06-01&end=2031-06-30`, null, adminToken);
    assert('排程列表可查', books.status === 200 && books.body.some(b => b.id === bookingId));

    const schedule = await request('GET', `/api/schedule-data?start=2031-06-01&end=2031-06-07`, null, adminToken);
    assert('schedule-data 聚合', schedule.status === 200
      && Array.isArray(schedule.body.resources)
      && Array.isArray(schedule.body.bookings)
      && schedule.body.bookings.length >= 2,
      `bookings=${schedule.body.bookings && schedule.body.bookings.length}`);

    const put = await request('PUT', `/api/bookings/${bookingId}`, {
      resource_id: rid,
      project_id: pid,
      project_scope_id: sid,
      date: day1,
      hours: 5,
      is_tentative: true,
      notes: 'updated',
    }, adminToken);
    assert('更新排程', put.status === 200 && put.body.ok, JSON.stringify(put.body));

    // split_after only (visual flag used by schedule UI)
    const split = await request('PUT', `/api/bookings/${bookingId}`, { split_after: 1 }, adminToken);
    assert('split_after 更新', split.status === 200 && split.body.ok, JSON.stringify(split.body));

    // manager can create booking
    const mgrBook = await request('POST', '/api/bookings', {
      resource_id: rid, project_id: pid, date: '2031-06-04', hours: 2,
    }, mgrToken);
    assert('经理可创建排程', mgrBook.status === 200, JSON.stringify(mgrBook.body));

    // ── Leave ────────────────────────────────────────────────────────
    console.log('\n📋 休假');
    const leave = await request('POST', '/api/leave', {
      resource_id: rid, date: '2031-06-09', type: 'vacation', notes: '年假',
    }, adminToken);
    assert('创建休假', leave.status === 200 && leave.body.id);

    const leaveList = await request('GET', '/api/leave?start=2031-06-01&end=2031-06-30', null, adminToken);
    assert('休假列表', leaveList.status === 200 && leaveList.body.some(l => l.id === leave.body.id));

    // ── Timesheets ───────────────────────────────────────────────────
    console.log('\n📋 工时');
    const ts = await request('POST', '/api/timesheets', {
      resource_id: rid, project_id: pid, project_scope_id: sid,
      date: day1, hours: 3, notes: '填报',
    }, adminToken);
    assert('创建工时', ts.status === 200 && ts.body.id);

    const tsList = await request('GET', `/api/timesheets?start=2031-06-01&end=2031-06-30`, null, adminToken);
    assert('工时列表', tsList.status === 200 && tsList.body.some(t => t.id === ts.body.id));

    const tsBatch = await request('POST', '/api/timesheets/batch', {
      entries: [
        { resource_id: rid, project_id: pid, project_scope_id: sid, date: day2, hours: 2, notes: '' },
      ],
    }, adminToken);
    assert('工时 batch', tsBatch.status === 200 && tsBatch.body.ok);

    const sync = await request('POST', '/api/timesheets/sync-from-bookings', {
      resource_id: rid, start: '2031-06-01', end: '2031-06-07',
    }, adminToken);
    assert('从排程同步工时', sync.status === 200 && typeof sync.body.synced === 'number',
      JSON.stringify(sync.body));

    // ── Reports ──────────────────────────────────────────────────────
    console.log('\n📋 报表');
    const util = await request('GET', '/api/reports/utilization?start=2031-06-01&end=2031-06-07', null, adminToken);
    assert('利用率报表', util.status === 200 && (util.body.data || util.body.rows), JSON.stringify(util.body).slice(0, 120));

    const projR = await request('GET', '/api/reports/projects?start=2031-06-01&end=2031-06-07', null, adminToken);
    assert('项目报表', projR.status === 200 && projR.body.rows, JSON.stringify(projR.body).slice(0, 120));

    // ── Holidays / health / SSE headers ──────────────────────────────
    console.log('\n📋 其它接口');
    const holidays = await request('GET', '/api/holidays?start=2026-01-01&end=2026-01-10', null, adminToken);
    assert('节假日接口', holidays.status === 200 && typeof holidays.body === 'object');

    const health = await request('GET', '/api/health');
    assert('health', health.status === 200 && health.body.ok);

    // archive / unarchive project (admin)
    const arch = await request('PATCH', `/api/projects/${pid}/archive`, {}, adminToken);
    assert('归档项目', arch.status === 200);
    const unarch = await request('PATCH', `/api/projects/${pid}/unarchive`, {}, adminToken);
    assert('取消归档', unarch.status === 200);

    // delete booking still works
    const del = await request('DELETE', `/api/bookings/${bookingId}`, null, adminToken);
    assert('删除排程', del.status === 200 && del.body.ok);

    // audit has entries after activity
    const audit = await request('GET', '/api/audit-logs?limit=10', null, adminToken);
    assert('审计有记录', audit.status === 200 && audit.body.rows.length > 0);

    // conflict path does NOT break happy path: book on free day still 200 without force
    const free = await request('POST', '/api/bookings', {
      resource_id: rid, project_id: pid, date: '2031-06-10', hours: 8,
    }, adminToken);
    assert('无冲突排程仍 200（无需 force）', free.status === 200, JSON.stringify(free.body));

  } catch (err) {
    console.error('\nRunner error:', err);
    failed++;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      for (const ext of ['', '-shm', '-wal']) {
        const p = DB_PATH + ext;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch (_) {}
  }

  console.log(`\n════════════════════════════════`);
  console.log(`  Regression: ${passed} passed, ${failed} failed`);
  console.log(`════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
