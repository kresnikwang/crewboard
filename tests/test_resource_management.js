/**
 * CrewBoard — Co-management and Work Scopes Resource Management Integration Test
 */

'use strict';

const http = require('http');

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;

// Helper function for HTTP requests
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: '127.0.0.1',
      port: PORT,
      path,
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

let passed = 0;
let failed = 0;
const results = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`  ✅ PASS  ${name}`);
  } else {
    failed++;
    results.push({ name, status: 'FAIL', detail });
    console.log(`  ❌ FAIL  ${name}${detail ? '  →  ' + detail : ''}`);
  }
}

// Global tokens & IDs for testing
let adminToken, manager1Token, manager2Token;
let adminId, manager1Id, manager2Id;
let enterpriseId;
let projectId;
let resourceId;
let scope1Id, scope2Id;

const TS = Date.now();
const ADMIN_EMAIL = `rm-admin-${TS}@crewboard.test`;
const MGR1_EMAIL = `rm-mgr1-${TS}@crewboard.test`;
const MGR2_EMAIL = `rm-mgr2-${TS}@crewboard.test`;

async function setup() {
  console.log('\n🔧 Setup test environment...');

  // 1. Register admin
  const regAdmin = await request('POST', '/api/auth/register', {
    name: '测试管理员',
    email: ADMIN_EMAIL,
    password: 'Test1234!',
  });
  adminToken = regAdmin.body.token;

  // Create enterprise
  const entRes = await request('POST', '/api/auth/enterprises', { name: 'RM测试企业' }, adminToken);
  enterpriseId = entRes.body.id;

  const meAdmin = await request('GET', '/api/auth/me', null, adminToken);
  adminId = meAdmin.body.id;
  const inviteCode = meAdmin.body.enterprise.code;

  // 2. Register manager 1
  const regMgr1 = await request('POST', '/api/auth/register', {
    name: '测试经理1',
    email: MGR1_EMAIL,
    password: 'Test1234!',
  });
  manager1Token = regMgr1.body.token;
  await request('POST', '/api/auth/enterprises/join', { code: inviteCode, message: '' }, manager1Token);

  // Approve manager 1
  const reqList = await request('GET', '/api/auth/enterprises/requests', null, adminToken);
  const pending1 = reqList.body.find(r => r.status === 'pending');
  if (pending1) {
    await request('PUT', '/api/auth/enterprises/requests/' + pending1.id, { status: 'approved' }, adminToken);
  }

  // Update role of manager 1 to 'manager'
  const membersRes = await request('GET', '/api/auth/enterprises/members', null, adminToken);
  const user1 = membersRes.body.find(m => m.email === MGR1_EMAIL);
  if (user1) {
    manager1Id = user1.id;
    await request('PUT', '/api/auth/enterprises/members/' + user1.id + '/role', { role: 'manager' }, adminToken);
  }

  // Login manager 1 again to get correct token
  const loginMgr1 = await request('POST', '/api/auth/login', { account: MGR1_EMAIL, password: 'Test1234!' });
  manager1Token = loginMgr1.body.token;

  // 3. Register manager 2
  const regMgr2 = await request('POST', '/api/auth/register', {
    name: '测试经理2',
    email: MGR2_EMAIL,
    password: 'Test1234!',
  });
  manager2Token = regMgr2.body.token;
  await request('POST', '/api/auth/enterprises/join', { code: inviteCode, message: '' }, manager2Token);

  // Approve manager 2
  const reqList2 = await request('GET', '/api/auth/enterprises/requests', null, adminToken);
  const pending2 = reqList2.body.find(r => r.status === 'pending');
  if (pending2) {
    await request('PUT', '/api/auth/enterprises/requests/' + pending2.id, { status: 'approved' }, adminToken);
  }

  // Update role of manager 2 to 'manager'
  const membersRes2 = await request('GET', '/api/auth/enterprises/members', null, adminToken);
  const user2 = membersRes2.body.find(m => m.email === MGR2_EMAIL);
  if (user2) {
    manager2Id = user2.id;
    await request('PUT', '/api/auth/enterprises/members/' + user2.id + '/role', { role: 'manager' }, adminToken);
  }

  // Login manager 2 again to get correct token
  const loginMgr2 = await request('POST', '/api/auth/login', { account: MGR2_EMAIL, password: 'Test1234!' });
  manager2Token = loginMgr2.body.token;

  // 4. Create a test resource for booking
  const resourceRes = await request('POST', '/api/resources', {
    name: '开发小助手',
    role: '工程师',
    team: '研发组',
    hours_per_day: 8,
  }, adminToken);
  resourceId = resourceRes.body.id;

  console.log('  ✔ Setup complete.\n');
}

async function runTests() {
  // ── TC-01: Create Project & Project Scopes ──────────────────────────────
  console.log('📋 TC-01  创建项目与工作内容(Scopes)');
  {
    const resProj = await request('POST', '/api/projects', { name: '核心系统重构' }, adminToken);
    assert('创建项目成功', resProj.status === 200, `状态码: ${resProj.status}`);
    projectId = resProj.body.id;

    // Create Scope 1: UI Design
    const resScope1 = await request('POST', `/api/projects/${projectId}/scopes`, {
      name: 'UI设计',
      description: '原型与视觉设计',
    }, adminToken);
    assert('创建工作内容1(UI设计)成功', resScope1.status === 200, `状态码: ${resScope1.status}`);
    scope1Id = resScope1.body.id;

    // Create Scope 2: Front-end Dev
    const resScope2 = await request('POST', `/api/projects/${projectId}/scopes`, {
      name: '前端开发',
      description: 'React/Vue界面实现',
    }, adminToken);
    assert('创建工作内容2(前端开发)成功', resScope2.status === 200, `状态码: ${resScope2.status}`);
    scope2Id = resScope2.body.id;

    // Get scopes list
    const resList = await request('GET', `/api/projects/${projectId}/scopes`, null, adminToken);
    assert('获取工作内容列表成功', resList.status === 200, `状态码: ${resList.status}`);
    assert('列表中包含2个工作内容', Array.isArray(resList.body) && resList.body.length === 2, JSON.stringify(resList.body));
  }

  // ── TC-02: Manage Bookings with Scope ─────────────────────────────────────
  console.log('\n📋 TC-02  使用工作内容(Scope)进行排程预订');
  {
    const dateStr = new Date().toISOString().split('T')[0];
    const resBook = await request('POST', '/api/bookings', {
      resource_id: resourceId,
      project_id: projectId,
      project_scope_id: scope1Id,
      date: dateStr,
      hours: 4,
      notes: '设计系统UI原型',
    }, adminToken);
    assert('创建排程成功', resBook.status === 200, `状态码: ${resBook.status}`);

    const resGet = await request('GET', `/api/bookings?start=${dateStr}&end=${dateStr}`, null, adminToken);
    assert('获取排程列表成功', resGet.status === 200, `状态码: ${resGet.status}`);
    const booking = resGet.body.find(b => b.project_id === projectId);
    assert('排程条目存在', !!booking, '未找到对应的排程条目');
    assert('排程包含正确的 project_scope_id', booking && booking.project_scope_id === scope1Id, `期望: ${scope1Id}, 实际: ${booking?.project_scope_id}`);
    assert('排程包含 joined scope_name', booking && booking.scope_name === 'UI设计', `期望: "UI设计", 实际: ${booking?.scope_name}`);
    assert('排程包含 joined created_by_name', booking && booking.created_by_name === '测试管理员', `期望: "测试管理员", 实际: ${booking?.created_by_name}`);
  }

  // ── TC-03: Timesheet with Scope ───────────────────────────────────────────
  console.log('\n📋 TC-03  工时表(Timesheet)记录与同步');
  {
    const dateStr = new Date().toISOString().split('T')[0];
    const resTS = await request('POST', '/api/timesheets', {
      resource_id: resourceId,
      project_id: projectId,
      project_scope_id: scope2Id,
      date: dateStr,
      hours: 6,
      notes: '前端开发联调',
    }, adminToken);
    assert('创建工时成功', resTS.status === 200, `状态码: ${resTS.status}`);

    const resGet = await request('GET', `/api/timesheets?start=${dateStr}&end=${dateStr}`, null, adminToken);
    assert('获取工时列表成功', resGet.status === 200, `状态码: ${resGet.status}`);
    const tsEntry = resGet.body.find(t => t.project_id === projectId && t.project_scope_id === scope2Id);
    assert('工时条目存在且包含正确的 scope_id', !!tsEntry, '未找到匹配的工时条目');
    assert('工时包含 joined scope_name', tsEntry && tsEntry.scope_name === '前端开发', `期望: "前端开发", 实际: ${tsEntry?.scope_name}`);
  }

  // ── TC-04: Co-management & Permissions ───────────────────────────────────
  console.log('\n📋 TC-04  项目多经理共同管理(Co-management)权限验证');
  {
    // manager 1 attempts to update project details (not created by them, not co-manager yet)
    const resPut1 = await request('PUT', `/api/projects/${projectId}`, {
      name: '核心系统重构(修改版)',
      budget_hours: 100,
    }, manager1Token);
    assert('未授权经理修改项目被拒绝', resPut1.status === 403, `状态码: ${resPut1.status}`);

    // admin assigns manager 1 as co-manager of projectId
    const resAssign = await request('PUT', `/api/auth/enterprises/members/${manager1Id}/managed-projects`, {
      project_ids: [projectId],
    }, adminToken);
    assert('分配项目管理员权限成功', resAssign.status === 200, `状态码: ${resAssign.status}`);

    // manager 1 attempts to update again (now should succeed!)
    const resPut2 = await request('PUT', `/api/projects/${projectId}`, {
      name: '核心系统重构(多经理共同管理修改版)',
      budget_hours: 120,
    }, manager1Token);
    assert('授权联合经理修改项目成功', resPut2.status === 200, `状态码: ${resPut2.status}`);

    // manager 2 (still not authorized) attempts to update
    const resPut3 = await request('PUT', `/api/projects/${projectId}`, {
      name: '核心系统重构(被越权修改)',
      budget_hours: 150,
    }, manager2Token);
    assert('其他未授权经理修改项目被拒绝', resPut3.status === 403, `状态码: ${resPut3.status}`);
  }

  // ── TC-05: Project Scope Reports & Drilldown ─────────────────────────────
  console.log('\n📋 TC-05  项目报表细分(Project Scope Breakdown)统计');
  {
    const dateStr = new Date().toISOString().split('T')[0];
    const resDrill = await request('GET', `/api/reports/project-scope-drill?project_id=${projectId}&start=${dateStr}&end=${dateStr}`, null, adminToken);
    assert('获取项目Scope报表成功', resDrill.status === 200, `状态码: ${resDrill.status}`);
    
    // Check that we got aggregates for UI Design (scope1Id) and Front-end Dev (scope2Id)
    const uiRow = resDrill.body.find(r => r.scope_id === scope1Id);
    const feRow = resDrill.body.find(r => r.scope_id === scope2Id);
    
    assert('UI设计报表行存在', !!uiRow, '未找到UI设计统计行');
    assert('UI设计已排工时为 4', uiRow && uiRow.booked_hours === 4, `期望: 4, 实际: ${uiRow?.booked_hours}`);
    assert('UI设计实际工时为 0', uiRow && uiRow.actual_hours === 0, `期望: 0, 实际: ${uiRow?.actual_hours}`);

    assert('前端开发报表行存在', !!feRow, '未找到前端开发统计行');
    assert('前端开发已排工时为 0', feRow && feRow.booked_hours === 0, `期望: 0, 实际: ${feRow?.booked_hours}`);
    assert('前端开发实际工时为 6', feRow && feRow.actual_hours === 6, `期望: 6, 实际: ${feRow?.actual_hours}`);
  }

  // ── TC-06: Excel Export Project & Scope ──────────────────────────────────
  console.log('\n📋 TC-06  项目报表及工作内容(Scope)明细 Excel 导出');
  {
    const dateStr = new Date().toISOString().split('T')[0];
    const resExport = await request('GET', `/api/export/projects?start=${dateStr}&end=${dateStr}`, null, adminToken);
    assert('导出 Excel 成功', resExport.status === 200, `状态码: ${resExport.status}`);
    assert('返回正确的 content-type', resExport.headers['content-type'].includes('spreadsheetml'), `Content-Type: ${resExport.headers['content-type']}`);
  }
}

(async () => {
  console.log('=======================================================');
  console.log('  CrewBoard — Co-management & Work Scopes Test');
  console.log(`  Target Server: http://127.0.0.1:${PORT}`);
  console.log('=======================================================');

  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('\n💥 Test run exception:', err.message);
    process.exitCode = 1;
  }

  console.log('\n=======================================================');
  console.log(`  Summary: ${passed + failed} tests  ✅ ${passed} passed  ❌ ${failed} failed`);
  console.log('=======================================================\n');

  if (failed > 0) process.exitCode = 1;
})();
