/**
 * CrewBoard — tenant isolation + permission matrix + rate-limit smoke tests
 *
 * Boots an isolated server on a free port with a temp SQLite DB.
 * Run: node tests/test_security.js  |  npm test
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TS = Date.now();
const TMP_DIR = path.join(__dirname, '.tmp');
const DB_PATH = path.join(TMP_DIR, `test-security-${TS}.db`);
const PORT = 3100 + (TS % 500);

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
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function registerAndCreateEnterprise(name, email) {
  const reg = await request('POST', '/api/auth/register', {
    name, email, password: 'Test1234!',
  });
  if (!reg.body.token) throw new Error('register failed: ' + JSON.stringify(reg.body));
  const ent = await request('POST', '/api/auth/enterprises', { name: name + '企业' }, reg.body.token);
  const me = await request('GET', '/api/auth/me', null, reg.body.token);
  return {
    token: reg.body.token,
    enterpriseId: ent.body.id,
    code: me.body.enterprise?.code,
    user: me.body.user,
  };
}

async function joinAs(email, name, code, role, adminToken) {
  const reg = await request('POST', '/api/auth/register', {
    name, email, password: 'Test1234!',
  });
  await request('POST', '/api/auth/enterprises/join', { code, message: '' }, reg.body.token);
  const reqs = await request('GET', '/api/auth/enterprises/requests', null, adminToken);
  const pending = (reqs.body || []).find(r => r.status === 'pending' && r.user_email === email);
  if (pending) {
    await request('PUT', `/api/auth/enterprises/requests/${pending.id}`, { status: 'approved' }, adminToken);
  }
  if (role && role !== 'basic') {
    const members = await request('GET', '/api/auth/enterprises/members', null, adminToken);
    const m = (members.body || []).find(x => x.email === email);
    if (m) {
      await request('PUT', `/api/auth/enterprises/members/${m.id}/role`, { role }, adminToken);
    }
  }
  const login = await request('POST', '/api/auth/login', { account: email, password: 'Test1234!' });
  const me = await request('GET', '/api/auth/me', null, login.body.token);
  return { token: login.body.token, user: me.body.user };
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.DB_PATH = DB_PATH;
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';

  // Boot server after env is set
  const { server, db } = require('../server');

  // wait until listening
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });

  console.log(`\n🔒 Security tests on :${PORT}  db=${DB_PATH}\n`);

  try {
    // ── Setup two tenants ─────────────────────────────────────────────
    console.log('📋 Setup: two enterprises');
    const a = await registerAndCreateEnterprise('租户A管理员', `a-admin-${TS}@crewboard.test`);
    const b = await registerAndCreateEnterprise('租户B管理员', `b-admin-${TS}@crewboard.test`);

    const aManager = await joinAs(`a-mgr-${TS}@crewboard.test`, 'A经理', a.code, 'manager', a.token);
    const aBasic = await joinAs(`a-basic-${TS}@crewboard.test`, 'A基础', a.code, 'basic', a.token);

    // resources & projects in each tenant
    const aRes = await request('POST', '/api/resources', {
      name: 'A员工', role: 'Dev', team: 'A', hours_per_day: 8,
    }, a.token);
    const bRes = await request('POST', '/api/resources', {
      name: 'B员工', role: 'Dev', team: 'B', hours_per_day: 8,
    }, b.token);
    assert('租户A创建资源', aRes.status === 200 && aRes.body.id, JSON.stringify(aRes.body));
    assert('租户B创建资源', bRes.status === 200 && bRes.body.id, JSON.stringify(bRes.body));

    const aProj = await request('POST', '/api/projects', { name: 'A项目' }, a.token);
    const bProj = await request('POST', '/api/projects', { name: 'B项目' }, b.token);
    assert('租户A创建项目', aProj.status === 200 && aProj.body.id, JSON.stringify(aProj.body));
    assert('租户B创建项目', bProj.status === 200 && bProj.body.id, JSON.stringify(bProj.body));

    const aClient = await request('POST', '/api/clients', { name: 'A客户' }, a.token);
    const bClient = await request('POST', '/api/clients', { name: 'B客户' }, b.token);

    // ── Tenant isolation ──────────────────────────────────────────────
    console.log('\n📋 Tenant isolation');

    const crossResPut = await request('PUT', `/api/resources/${bRes.body.id}`, {
      name: 'hacked', email: '', role: '', team: '', color: '#000', hours_per_day: 8,
    }, a.token);
    assert('A 不能改 B 的 resource', crossResPut.status === 404, `status=${crossResPut.status}`);

    const crossClientPut = await request('PUT', `/api/clients/${bClient.body.id}`, {
      name: 'hacked', color: '#000',
    }, a.token);
    assert('A 不能改 B 的 client', crossClientPut.status === 404, `status=${crossClientPut.status}`);

    const crossProjPut = await request('PUT', `/api/projects/${bProj.body.id}`, {
      name: 'hacked', color: '#000',
    }, a.token);
    assert('A 不能改 B 的 project', crossProjPut.status === 404, `status=${crossProjPut.status}`);

    // booking in B, list as A
    const bBook = await request('POST', '/api/bookings', {
      resource_id: bRes.body.id,
      project_id: bProj.body.id,
      date: '2030-01-06',
      hours: 8,
    }, b.token);
    assert('B 创建 booking', bBook.status === 200, JSON.stringify(bBook.body));

    const aListBookings = await request('GET', '/api/bookings?start=2030-01-01&end=2030-01-31', null, a.token);
    const aIds = (aListBookings.body || []).map(x => x.id);
    assert('A 列表看不到 B 的 booking', !aIds.includes(bBook.body.id), JSON.stringify(aIds));

    const aPutBBooking = await request('PUT', `/api/bookings/${bBook.body.id}`, {
      resource_id: bRes.body.id, project_id: bProj.body.id, date: '2030-01-07', hours: 4,
    }, a.token);
    assert('A 不能改 B 的 booking', aPutBBooking.status === 404, `status=${aPutBBooking.status}`);

    // timesheet isolation
    const bTs = await request('POST', '/api/timesheets', {
      resource_id: bRes.body.id,
      project_id: bProj.body.id,
      date: '2030-01-06',
      hours: 3,
    }, b.token);
    assert('B 创建 timesheet', bTs.status === 200, JSON.stringify(bTs.body));

    const aListTs = await request('GET', '/api/timesheets?start=2030-01-01&end=2030-01-31', null, a.token);
    const aTsIds = (aListTs.body || []).map(x => x.id);
    assert('A 列表看不到 B 的 timesheet', !aTsIds.includes(bTs.body.id), JSON.stringify(aTsIds));

    const aCrossTs = await request('POST', '/api/timesheets', {
      resource_id: bRes.body.id,
      project_id: bProj.body.id,
      date: '2030-01-08',
      hours: 1,
    }, a.token);
    assert('A 不能给 B 资源写 timesheet', aCrossTs.status === 400 || aCrossTs.status === 403, `status=${aCrossTs.status}`);

    // leave isolation
    const bLeave = await request('POST', '/api/leave', {
      resource_id: bRes.body.id, date: '2030-01-10', type: 'vacation',
    }, b.token);
    assert('B 创建 leave', bLeave.status === 200, JSON.stringify(bLeave.body));
    const aDelLeave = await request('DELETE', `/api/leave/${bLeave.body.id}`, null, a.token);
    assert('A 不能删 B 的 leave', aDelLeave.status === 404, `status=${aDelLeave.status}`);

    // secrets not leaked to non-admin
    // Set secret as B admin via raw SQL then check me
    db.prepare('UPDATE enterprises SET wecom_secret = ?, webhook_dingtalk = ? WHERE id = ?')
      .run('SUPER_SECRET_VALUE', 'https://hook.example/ding', b.enterpriseId);
    const bMe = await request('GET', '/api/auth/me', null, b.token);
    assert('admin me 不返回 wecom_secret 明文', bMe.body.enterprise?.wecom_secret === '', JSON.stringify(bMe.body.enterprise));
    assert('admin me 标记 wecom_secret_set', bMe.body.enterprise?.wecom_secret_set === true, JSON.stringify(bMe.body.enterprise));
    assert('admin me 仍可看 webhook（设置页需要）', !!bMe.body.enterprise?.webhook_dingtalk, 'missing webhook');

    // ── Permission matrix ─────────────────────────────────────────────
    console.log('\n📋 Permission matrix (admin / manager / basic)');

    const permsAdmin = await request('GET', '/api/permissions', null, a.token);
    const permsMgr = await request('GET', '/api/permissions', null, aManager.token);
    const permsBasic = await request('GET', '/api/permissions', null, aBasic.token);
    assert('admin can_admin', permsAdmin.body.can_admin === true);
    assert('manager can_book', permsMgr.body.can_book === true && permsMgr.body.can_admin === false);
    assert('basic 只读', permsBasic.body.can_book === false && permsBasic.body.can_manage === false);

    const basicBook = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id,
      project_id: aProj.body.id,
      date: '2030-02-03',
      hours: 8,
    }, aBasic.token);
    assert('basic 不能创建 booking', basicBook.status === 403, `status=${basicBook.status}`);

    const basicRes = await request('POST', '/api/resources', { name: 'x' }, aBasic.token);
    assert('basic 不能创建 resource', basicRes.status === 403, `status=${basicRes.status}`);

    const basicClient = await request('POST', '/api/clients', { name: 'x' }, aBasic.token);
    assert('basic 不能创建 client', basicClient.status === 403, `status=${basicClient.status}`);

    const basicReport = await request('GET', '/api/reports/utilization?start=2030-01-01&end=2030-01-31', null, aBasic.token);
    assert('basic 不能看报表', basicReport.status === 403, `status=${basicReport.status}`);

    const mgrBook = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id,
      project_id: aProj.body.id,
      date: '2030-02-04',
      hours: 4,
    }, aManager.token);
    assert('manager 可以创建 booking', mgrBook.status === 200, JSON.stringify(mgrBook.body));

    const mgrRes = await request('POST', '/api/resources', { name: 'mgr-x' }, aManager.token);
    assert('manager 不能创建 resource', mgrRes.status === 403, `status=${mgrRes.status}`);

    // basic timesheet only for own resource_id
    if (aBasic.user?.resource_id) {
      const ownTs = await request('POST', '/api/timesheets', {
        resource_id: aBasic.user.resource_id,
        project_id: aProj.body.id,
        date: '2030-02-05',
        hours: 2,
      }, aBasic.token);
      assert('basic 可为自己写 timesheet', ownTs.status === 200, JSON.stringify(ownTs.body));

      const otherTs = await request('POST', '/api/timesheets', {
        resource_id: aRes.body.id,
        project_id: aProj.body.id,
        date: '2030-02-05',
        hours: 2,
      }, aBasic.token);
      assert('basic 不能为他人写 timesheet', otherTs.status === 403, `status=${otherTs.status}`);
    } else {
      assert('basic 用户有 resource_id', false, 'missing resource_id after join');
    }

    // ── Rate limit smoke (forgot-password) ────────────────────────────
    console.log('\n📋 Rate limit (forgot-password)');
    let hit429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await request('POST', '/api/auth/forgot-password', { email: `nobody-${i}@example.com` });
      if (r.status === 429) { hit429 = true; break; }
    }
    assert('forgot-password 触发 429', hit429, 'did not rate-limit within 12 requests');


    // ── Conflict detection ────────────────────────────────────────────
    console.log('\n📋 Conflict detection');
    // Create leave then try booking same day
    const leaveDay = '2030-03-10';
    const leaveRes = await request('POST', '/api/leave', {
      resource_id: aRes.body.id, date: leaveDay, type: 'vacation',
    }, a.token);
    assert('创建休假日用于冲突测试', leaveRes.status === 200, JSON.stringify(leaveRes.body));

    const conflictBook = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id,
      project_id: aProj.body.id,
      date: leaveDay,
      hours: 8,
    }, a.token);
    assert('休假冲突返回 409', conflictBook.status === 409 && conflictBook.body.code === 'booking_conflict',
      `status=${conflictBook.status} body=${JSON.stringify(conflictBook.body)}`);

    // Overload: book 6h then another 6h without force
    const day = '2030-03-11';
    const b1 = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id, project_id: aProj.body.id, date: day, hours: 6,
    }, a.token);
    assert('第一笔 6h 排程成功', b1.status === 200, JSON.stringify(b1.body));
    // need another project for same day second booking
    const aProj2 = await request('POST', '/api/projects', { name: 'A项目2' }, a.token);
    const b2 = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id, project_id: aProj2.body.id, date: day, hours: 6,
    }, a.token);
    assert('超产能返回 409', b2.status === 409 && b2.body.reason === 'overload',
      `status=${b2.status} body=${JSON.stringify(b2.body)}`);
    const b2force = await request('POST', '/api/bookings', {
      resource_id: aRes.body.id, project_id: aProj2.body.id, date: day, hours: 6, force: true,
    }, a.token);
    assert('force 可覆盖超产能', b2force.status === 200, JSON.stringify(b2force.body));

    // ── Audit logs ────────────────────────────────────────────────────
    console.log('\n📋 Audit logs');
    const audit = await request('GET', '/api/audit-logs?limit=20', null, a.token);
    assert('admin 可查审计日志', audit.status === 200 && Array.isArray(audit.body.rows), JSON.stringify(audit.body));
    const actions = (audit.body.rows || []).map(r => r.action);
    assert('审计含 booking.create', actions.includes('booking.create'), actions.join(','));
    const basicAudit = await request('GET', '/api/audit-logs', null, aBasic.token);
    assert('basic 不能查审计', basicAudit.status === 403, `status=${basicAudit.status}`);


    // ── Health ────────────────────────────────────────────────────────
    const health = await request('GET', '/api/health');
    assert('health ok', health.status === 200 && health.body.ok === true);

    // ── Indexes exist ─────────────────────────────────────────────────
    const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
    assert('idx_bookings_resource_date', idxs.includes('idx_bookings_resource_date'));
    assert('idx_timesheets_resource_date', idxs.includes('idx_timesheets_resource_date'));
    assert('idx_sessions_expires', idxs.includes('idx_sessions_expires'));

  } catch (err) {
    console.error('\nTest runner error:', err);
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
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
