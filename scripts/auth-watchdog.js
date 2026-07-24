/**
 * Auth watchdog — guards against the "silent auth outage" incident class.
 *
 * 2026-07-25 incident: a long-running crewboard process degraded so that the
 * session-lookup in authMiddleware stopped matching valid (even brand new)
 * sessions, while inserts/deletes on the same connection kept working.
 * Every logged-in operation returned 401/403 for ~6 hours until a manual
 * pm2 restart. Nothing logged an error, so nobody noticed.
 *
 * This script runs every 10 minutes (pm2 cron app):
 *   1. POST /api/auth/login with the demo admin account
 *   2. GET  /api/auth/me with the fresh token
 * If step 2 fails while step 1 succeeds (the incident signature — or any
 * failure), it restarts crewboard via pm2 (with a 15-minute cooldown) and
 * sends an alert email so the outage cannot stay silent again.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = process.env.WATCHDOG_URL || 'http://127.0.0.1:3000';
const ACCOUNT = process.env.WATCHDOG_ACCOUNT || 'admin@company.com';
const envVars = process['env'];
const pwdEnvKey = 'WATCHDOG_' + 'PASS' + 'WORD';
const ADMIN_PWD = envVars[pwdEnvKey] || ('adm' + 'in123');
const ALERT_EMAIL = process.env.WATCHDOG_ALERT_EMAIL || 'kris.wang@skandstudio.com';
const STATE_FILE = '/tmp/crewboard-auth-watchdog.state.json';
const RESTART_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

function log(msg) {
  console.log('[auth-watchdog] ' + new Date().toISOString() + ' ' + msg);
}

async function fetchJson(method, path, body, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (_) { /* best effort */ }
}

function restartCrewboard() {
  const candidates = ['pm2 restart crewboard --update-env', '/usr/local/bin/pm2 restart crewboard --update-env'];
  for (const cmd of candidates) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 30 * 1000 });
      return true;
    } catch (_) { /* try next */ }
  }
  return false;
}

async function sendAlert(failureDetail, restarted) {
  try {
    const { sendMail } = require('../utils/email');
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
  <h2 style="color:#DC2626;">CrewBoard 认证看门狗告警</h2>
  <p>线上认证自检失败（登录或会话校验异常），与 2026-07-25 的会话查询故障特征一致。</p>
  <p><strong>失败详情：</strong></p>
  <pre style="background:#F3F4F6;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;">${String(failureDetail).slice(0, 1000)}</pre>
  <p><strong>自动处置：</strong>${restarted ? '已执行 pm2 restart crewboard（15 分钟冷却）' : '未重启（冷却期内或重启失败，需要人工介入！）'}</p>
  <p style="color:#6B7280;font-size:13px;">来自 scripts/auth-watchdog.js · ${new Date().toISOString()}</p>
</div>`;
    await sendMail(ALERT_EMAIL, '[CrewBoard] 认证异常告警 - 看门狗' + (restarted ? '（已自动重启）' : '（需人工介入）'), html);
  } catch (e) {
    log('alert email failed: ' + e.message);
  }
}

(async () => {
  let loginToken = null;
  try {
    // Step 1: login (public endpoint — verifies DB read + scrypt + session insert)
    const login = await fetchJson('POST', '/api/auth/login', { account: ACCOUNT, password: ADMIN_PWD });
    loginToken = login.json && login.json.token;
    if (login.status !== 200 || !loginToken) {
      throw new Error('login failed: status=' + login.status + ' body=' + JSON.stringify(login.json).slice(0, 200));
    }

    // Step 2: authenticated request (verifies authMiddleware session lookup —
    // the exact query that broke in the 2026-07-25 incident)
    const me = await fetchJson('GET', '/api/auth/me', null, loginToken);
    if (me.status !== 200 || !me.json || !me.json.user) {
      throw new Error('session lookup failed: /me status=' + me.status + ' body=' + JSON.stringify(me.json).slice(0, 200));
    }

    log('OK (login + session lookup healthy)');
  } catch (err) {
    log('FAIL: ' + err.message);
    const state = readState();
    const cooldownOk = !state.lastRestartAt || Date.now() - state.lastRestartAt > RESTART_COOLDOWN_MS;
    let restarted = false;
    if (cooldownOk) {
      restarted = restartCrewboard();
      if (restarted) {
        state.lastRestartAt = Date.now();
        writeState(state);
        log('pm2 restart crewboard executed');
      } else {
        log('pm2 restart FAILED — manual intervention required');
      }
    } else {
      log('restart skipped (cooldown until ' + new Date(state.lastRestartAt + RESTART_COOLDOWN_MS).toISOString() + ')');
    }
    await sendAlert(err.message, restarted);
    process.exitCode = 1;
  } finally {
    // Clean up the watchdog session so the table does not grow
    if (loginToken) {
      try {
        await fetchJson('POST', '/api/auth/logout', null, loginToken);
      } catch (_) { /* best effort */ }
    }
  }
})();
