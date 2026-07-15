/**
 * E2E server bootstrap — used by Playwright webServer.
 * Fresh SQLite DB, listen on E2E_PORT, seed admin data, stay alive.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.E2E_PORT || 3399);
const TMP_DIR = path.join(__dirname, '.tmp');
const DB_PATH = path.join(TMP_DIR, 'e2e.db');
const STATE_PATH = path.join(TMP_DIR, 'e2e-state.json');

const ADMIN = {
  name: 'E2E管理员',
  email: 'e2e-admin@crewboard.test',
  password: 'Test1234!',
};

fs.mkdirSync(TMP_DIR, { recursive: true });
for (const ext of ['', '-shm', '-wal']) {
  const p = DB_PATH + ext;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

process.env.PORT = String(PORT);
process.env.DB_PATH = DB_PATH;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Block /api/health until seed completes (Playwright webServer polls health)
global.__E2E_BLOCK_HEALTH__ = true;

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(raw);
          } catch (_) {
            json = raw;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function seed() {
  const reg = await request('POST', '/api/auth/register', {
    name: ADMIN.name,
    email: ADMIN.email,
    password: ADMIN.password,
  });
  if (reg.status !== 200 || !reg.body.token) {
    throw new Error('register failed: ' + JSON.stringify(reg.body));
  }
  let token = reg.body.token;

  const ent = await request('POST', '/api/auth/enterprises', { name: 'E2E测试企业' }, token);
  if (ent.status !== 200) throw new Error('enterprise failed: ' + JSON.stringify(ent.body));

  // refresh session after enterprise join
  const login = await request('POST', '/api/auth/login', {
    account: ADMIN.email,
    password: ADMIN.password,
  });
  token = login.body.token;
  const me = await request('GET', '/api/auth/me', null, token);

  const r = await request(
    'POST',
    '/api/resources',
    {
      name: 'E2E员工',
      role: '工程师',
      team: '研发',
      hours_per_day: 8,
      email: 'e2e-staff@crewboard.test',
    },
    token
  );
  const c = await request('POST', '/api/clients', { name: 'E2E客户', color: '#4F46E5' }, token);
  const p = await request(
    'POST',
    '/api/projects',
    { name: 'E2E项目', client_id: c.body.id, color: '#8B5CF6', budget_hours: 40 },
    token
  );

  const state = {
    baseURL: `http://127.0.0.1:${PORT}`,
    port: PORT,
    dbPath: DB_PATH,
    admin: ADMIN,
    token,
    enterpriseId: me.body.user.enterprise_id,
    resourceId: r.body.id,
    projectId: p.body.id,
    projectName: 'E2E项目',
    clientId: c.body.id,
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log('[e2e-server] seeded', state.admin.email, 'resource', state.resourceId, 'project', state.projectId);
}

const { server } = require('../server');

function whenListening() {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

whenListening()
  .then(() => seed())
  .then(() => {
    global.__E2E_BLOCK_HEALTH__ = false;
    console.log('[e2e-server] ready on http://127.0.0.1:' + PORT);
  })
  .catch((err) => {
    console.error('[e2e-server] failed:', err);
    process.exit(1);
  });
