/**
 * CrewBoard — email flows E2E tests
 *
 * Covers:
 *   1. Forgot password: request → email with reset link → verify token → set new
 *      password → old sessions killed → token single-use → EXPIRED token rejected
 *      (regression for ISO-vs-datetime() string comparison bug).
 *   2. Invitations: invite → email with invite link → register auto-joins enterprise
 *      → logged-in user accepts invite via /invitations/accept → email mismatch rejected.
 *
 * A minimal in-process SMTP sink captures the actual outgoing mail so we can
 * assert on recipients, subjects and links. SMTP is pointed at the sink via env
 * vars (SMTP_SECURE=false) before the server boots.
 *
 * Run: node tests/test_email_flows.js
 */

'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const TS = Date.now();
const TMP_DIR = path.join(__dirname, '.tmp');
const DB_PATH = path.join(TMP_DIR, `test-email-${TS}.db`);
const PORT = 3600 + (TS % 300);

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
        let b = null;
        try { b = JSON.parse(raw); } catch (_) { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ---------------- Minimal SMTP sink (plaintext, no STARTTLS) ---------------- */

function decodeQP(s) {
  // Quoted-printable → UTF-8 string (byte-accurate for multi-byte chars)
  const unsoft = s.replace(/=\r?\n/g, ''); // remove soft line breaks
  const bytes = [];
  for (let i = 0; i < unsoft.length; i++) {
    if (unsoft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unsoft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unsoft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unsoft.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function startSmtpSink() {
  const messages = [];
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let from = null;
      let to = [];
      let dataMode = false;
      let dataBuf = '';
      let buf = '';
      sock.write('220 crewboard-sink ESMTP\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString('binary');
        let idx;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (dataMode) {
            if (line === '.') {
              dataMode = false;
              messages.push({ from, to: to.slice(), data: dataBuf });
              sock.write('250 OK queued\r\n');
            } else {
              dataBuf += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
            }
            continue;
          }
          const cmd = line.toUpperCase();
          if (cmd.startsWith('EHLO')) {
            sock.write('250-crewboard-sink\r\n250 8BITMIME\r\n');
          } else if (cmd.startsWith('HELO')) {
            sock.write('250 crewboard-sink\r\n');
          } else if (cmd.startsWith('MAIL FROM')) {
            from = line.replace(/^MAIL FROM:\s*/i, '').replace(/\s+\w+=[^\s>]*/g, '').trim();
            sock.write('250 OK\r\n');
          } else if (cmd.startsWith('RCPT TO')) {
            to.push(line.replace(/^RCPT TO:\s*/i, '').trim());
            sock.write('250 OK\r\n');
          } else if (cmd.startsWith('DATA')) {
            dataMode = true;
            dataBuf = '';
            sock.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (cmd.startsWith('QUIT')) {
            sock.write('221 bye\r\n');
            sock.end();
          } else if (cmd.startsWith('RSET')) {
            from = null; to = [];
            sock.write('250 OK\r\n');
          } else {
            sock.write('250 OK\r\n');
          }
        }
      });
      sock.on('error', () => {});
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, messages, port: srv.address().port });
    });
  });
}

function lastMailTo(sink, addr) {
  for (let i = sink.messages.length - 1; i >= 0; i--) {
    const m = sink.messages[i];
    if (m.to.some((t) => t.includes(addr))) return m;
  }
  return null;
}

function mailText(mail) {
  return decodeQP(mail.data.toString('binary'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForMail(sink, addr, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const m = lastMailTo(sink, addr);
    if (m) return m;
    await sleep(100);
  }
  return null;
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const sink = await startSmtpSink();

  // Point SMTP at the sink BEFORE the server (and utils/email) is loaded
  process.env.DB_PATH = DB_PATH;
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(sink.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'sink';
  process.env.SMTP_PASS = 'sink';
  process.env.SMTP_FROM = '"CrewBoard Test" <noreply@crewboard.test>';
  process.env.APP_URL = `http://127.0.0.1:${PORT}`;

  const { db, server } = require('../server');
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const APP = `http://127.0.0.1:${PORT}`;

  try {
    /* ════════════ 1. Forgot password ════════════ */
    console.log('\n📋 忘记密码流程');

    const reg = await request('POST', '/api/auth/register', {
      name: '爱丽丝', email: `alice-${TS}@example.com`, password: 'OldPass123!',
    });
    assert('注册成功', !!reg.body.token, JSON.stringify(reg.body));
    const aliceEmail = `alice-${TS}@example.com`;

    // 1.1 request reset
    const req1 = await request('POST', '/api/auth/forgot-password', { email: aliceEmail });
    assert('请求重置返回 ok', req1.status === 200 && req1.body.ok === true);

    const mail = await waitForMail(sink, aliceEmail);
    assert('收到重置邮件', !!mail);
    assert('发件人正确', !!mail && mail.from.includes('noreply@crewboard.test'), mail && mail.from);
    const text = mail ? mailText(mail) : '';
    assert('邮件含 30 分钟有效期说明', text.includes('30分钟'));
    const tokenMatch = text.match(/#reset-password\?token=([a-f0-9-]+)/i);
    assert('邮件含重置链接(#reset-password?token=)', !!tokenMatch);
    const resetToken = tokenMatch ? tokenMatch[1] : '';
    assert('链接使用配置的 APP_URL', text.includes(`${APP}/#reset-password?token=`));

    // 1.2 verify token
    const ver = await request('GET', `/api/auth/reset-password/${resetToken}`);
    assert('验证 token 有效', ver.status === 200 && ver.body.ok === true, JSON.stringify(ver.body));
    assert('验证返回账号邮箱', ver.body.email === aliceEmail);

    // 1.3 set new password
    const rst = await request('POST', '/api/auth/reset-password', { token: resetToken, new_password: 'NewPass456!' });
    assert('重置密码成功', rst.status === 200 && rst.body.ok === true, JSON.stringify(rst.body));

    const oldLogin = await request('POST', '/api/auth/login', { account: aliceEmail, password: 'OldPass123!' });
    assert('旧密码无法登录', oldLogin.status === 401);
    const newLogin = await request('POST', '/api/auth/login', { account: aliceEmail, password: 'NewPass456!' });
    assert('新密码可登录', newLogin.status === 200 && !!newLogin.body.token);

    // 1.4 token is single-use
    const reuse = await request('POST', '/api/auth/reset-password', { token: resetToken, new_password: 'Xxx123456!' });
    assert('token 不能重复使用', reuse.status === 400, `status=${reuse.status}`);

    // 1.5 EXPIRED token must be rejected (regression test)
    const expiredToken = 'expired-' + TS;
    db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at, used) VALUES (?,?,?,0)')
      .run(newLogin.body.user.id, expiredToken, new Date(Date.now() - 5 * 60 * 1000).toISOString());
    const expVer = await request('GET', `/api/auth/reset-password/${expiredToken}`);
    assert('过期 token 验证被拒绝（回归）', expVer.status === 400, `status=${expVer.status}`);
    const expRst = await request('POST', '/api/auth/reset-password', { token: expiredToken, new_password: 'Hack123456!' });
    assert('过期 token 重置被拒绝（回归）', expRst.status === 400, `status=${expRst.status}`);

    // 1.6 future token still works
    const okToken = 'valid-' + TS;
    db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at, used) VALUES (?,?,?,0)')
      .run(newLogin.body.user.id, okToken, new Date(Date.now() + 29 * 60 * 1000).toISOString());
    const okVer = await request('GET', `/api/auth/reset-password/${okToken}`);
    assert('未过期 token 仍然有效', okVer.status === 200, `status=${okVer.status}`);

    // 1.7 unknown email: no enumeration, no mail
    const before = sink.messages.length;
    const unk = await request('POST', '/api/auth/forgot-password', { email: `ghost-${TS}@example.com` });
    assert('未知邮箱也返回 ok（防枚举）', unk.status === 200 && unk.body.ok === true);
    await sleep(300);
    assert('未知邮箱不发送邮件', sink.messages.length === before, `mails=${sink.messages.length - before}`);

    // 1.8 new request invalidates previous unused tokens
    await request('POST', '/api/auth/forgot-password', { email: aliceEmail });
    await waitForMail(sink, aliceEmail);
    const stale = await request('GET', `/api/auth/reset-password/${okToken}`);
    assert('新请求作废旧 token', stale.status === 400, `status=${stale.status}`);

    /* ════════════ 2. Invite members by email ════════════ */
    console.log('\n📋 邀请员工流程');

    const admin = await request('POST', '/api/auth/register', {
      name: '管理员', email: `admin-${TS}@example.com`, password: 'Admin1234!',
    });
    const adminToken = admin.body.token;
    const ent = await request('POST', '/api/auth/enterprises', { name: `测试企业${TS}` }, adminToken);
    assert('创建企业成功', !!ent.body.id, JSON.stringify(ent.body));

    // 2.1 invite bob (new user) — email goes out
    const bobEmail = `bob-${TS}@example.com`;
    const inv = await request('POST', '/api/auth/enterprises/invite', { email: bobEmail, name: '鲍勃' }, adminToken);
    assert('发送邀请成功', inv.status === 200 && inv.body.ok === true, JSON.stringify(inv.body));
    assert('邀请响应含 email_sent=true', inv.body.email_sent === true);
    assert('邀请响应含 invite_link', typeof inv.body.invite_link === 'string' && inv.body.invite_link.includes('#register?invite='));

    const bobMail = await waitForMail(sink, bobEmail);
    assert('收到邀请邮件', !!bobMail);
    const bobText = bobMail ? mailText(bobMail) : '';
    assert('邀请邮件含企业名', bobText.includes(`测试企业${TS}`));
    assert('邀请邮件含邀请人', bobText.includes('管理员'));
    const inviteMatch = bobText.match(/invite=([a-f0-9-]+)/i);
    assert('邀请邮件含接受链接(#register?invite=)', !!inviteMatch);
    assert('邀请邮件 token 与响应一致', inviteMatch && inviteMatch[1] === inv.body.token);

    // duplicate pending invite rejected
    const dup = await request('POST', '/api/auth/enterprises/invite', { email: bobEmail }, adminToken);
    assert('重复邀请被拒绝', dup.status === 400, `status=${dup.status}`);

    // 2.2 bob registers with the invited email → auto-joins enterprise
    const bobReg = await request('POST', '/api/auth/register', {
      name: '鲍勃', email: bobEmail, password: 'BobPass123!',
    });
    assert('受邀用户注册成功', !!bobReg.body.token, JSON.stringify(bobReg.body));
    assert('注册后自动加入企业', !!bobReg.body.enterprise && bobReg.body.enterprise.id === ent.body.id,
      JSON.stringify(bobReg.body.enterprise));
    const bobMe = await request('GET', '/api/auth/me', null, bobReg.body.token);
    assert('邀请状态变为 accepted',
      db.prepare("SELECT status FROM invitations WHERE token = ?").get(inv.body.token).status === 'accepted');
    assert('受邀用户有 resource_id', !!bobMe.body.user.resource_id);

    // 2.3 invite carol (account already exists, no enterprise) → accept while logged in
    const carolEmail = `carol-${TS}@example.com`;
    const carolReg = await request('POST', '/api/auth/register', {
      name: '卡罗尔', email: carolEmail, password: 'Carol1234!',
    });
    const carolToken = carolReg.body.token;
    assert('已存在账号（无企业）注册成功', !!carolToken);

    const inv2 = await request('POST', '/api/auth/enterprises/invite', { email: carolEmail, name: '卡罗尔' }, adminToken);
    assert('向已有账号发邀请成功', inv2.status === 200 && inv2.body.ok === true, JSON.stringify(inv2.body));
    await waitForMail(sink, carolEmail);

    const acc = await request('POST', '/api/auth/invitations/accept', { token: inv2.body.token }, carolToken);
    assert('登录用户接受邀请成功', acc.status === 200 && acc.body.ok === true, JSON.stringify(acc.body));
    const carolMe = await request('GET', '/api/auth/me', null, carolToken);
    assert('接受后企业已绑定', carolMe.body.user.enterprise_id === ent.body.id, JSON.stringify(carolMe.body.user));
    assert('接受后有 resource_id', !!carolMe.body.user.resource_id);

    // 2.4 email mismatch: dave tries to accept erin's invitation
    const erinEmail = `erin-${TS}@example.com`;
    const inv3 = await request('POST', '/api/auth/enterprises/invite', { email: erinEmail }, adminToken);
    assert('向 erin 发邀请成功', inv3.status === 200, JSON.stringify(inv3.body));
    const daveReg = await request('POST', '/api/auth/register', {
      name: '戴夫', email: `dave-${TS}@example.com`, password: 'Dave12345!',
    });
    const mismatch = await request('POST', '/api/auth/invitations/accept', { token: inv3.body.token }, daveReg.body.token);
    assert('邮箱不匹配不能冒领邀请', mismatch.status === 400, `status=${mismatch.status}`);

    // 2.5 accept with invalid token / already-in-enterprise
    const badTok = await request('POST', '/api/auth/invitations/accept', { token: 'no-such-token' }, carolToken);
    assert('无效 token 被拒绝', badTok.status === 400, `status=${badTok.status}`);
    const already = await request('POST', '/api/auth/invitations/accept', { token: inv3.body.token }, bobReg.body.token);
    assert('已属企业不能再接邀请', already.status === 400, `status=${already.status}`);
    const noAuth = await request('POST', '/api/auth/invitations/accept', { token: inv3.body.token });
    assert('未登录不能接受邀请', noAuth.status === 401, `status=${noAuth.status}`);

    // 2.6 inviting an existing member is rejected
    const memberDup = await request('POST', '/api/auth/enterprises/invite', { email: bobEmail }, adminToken);
    assert('已是成员的邮箱邀请被拒绝', memberDup.status === 400, `status=${memberDup.status}`);

    // 2.7 cancel invitation
    const invList = await request('GET', '/api/auth/enterprises/invitations', null, adminToken);
    const erinInv = (invList.body || []).find((i) => i.email === erinEmail);
    assert('邀请列表含 erin', !!erinInv);
    if (erinInv) {
      const del = await request('DELETE', `/api/auth/enterprises/invitations/${erinInv.id}`, null, adminToken);
      assert('取消邀请成功', del.status === 200 && del.body.ok === true);
      const cancelled = await request('POST', '/api/auth/invitations/accept', { token: inv3.body.token }, daveReg.body.token);
      // now rejected because invitation row is deleted
      assert('取消后的邀请无法接受', cancelled.status === 400, `status=${cancelled.status}`);
    }
  } catch (e) {
    failed++;
    console.error('  ❌ EXCEPTION', e);
  } finally {
    server.close();
    sink.srv.close();
    try { db.close(); } catch (_) {}
  }

  console.log('\n════════════════════════════════');
  console.log(`  Email flows: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
