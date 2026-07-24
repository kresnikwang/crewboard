const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendMail, passwordResetEmail, invitationEmail, APP_URL } = require('../utils/email');
const {
  isAdmin,
  publicEnterprise,
  getEnterpriseRow,
  authMiddleware,
} = require('../utils/authz');
const { createRateLimiter } = require('../utils/rateLimit');
const { L } = require('../utils/server-i18n');
const uuidv4 = () => crypto.randomUUID();
const router = express.Router();

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pwd, salt, 64).toString('hex');
  try {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(check, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    enterprise_id: user.enterprise_id,
    resource_id: user.resource_id,
    avatar: user.avatar || '',
    must_change_password: user.must_change_password || 0,
  };
}

function enterpriseForUser(db, user) {
  const row = getEnterpriseRow(db, user?.enterprise_id);
  return publicEnterprise(row, { forAdmin: isAdmin(user) });
}

module.exports = function(db) {
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: (req) => L(req, 'rate.login_throttled'),
    keyFn: (req) => 'login:' + (req.ip || req.body?.account || 'unknown'),
  });
  const forgotLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: (req) => L(req, 'rate.reset_throttled'),
    keyFn: (req) => 'forgot:' + (req.ip || req.body?.email || 'unknown'),
  });
  const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: (req) => L(req, 'rate.register_throttled'),
    keyFn: (req) => 'register:' + (req.ip || 'unknown'),
  });

  // Register
  router.post('/register', registerLimiter, (req, res) => {
    const { phone, email, password, name } = req.body;
    if (!password || !name || (!phone && !email)) {
      return res.status(400).json({ error: L(req, 'auth.register_missing_fields') });
    }
    // Check uniqueness
    if (phone) {
      const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
      if (existing) return res.status(400).json({ error: L(req, 'auth.phone_registered') });
    }
    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return res.status(400).json({ error: L(req, 'auth.email_registered') });
    }
    const hash = hashPassword(password);
    const result = db.prepare('INSERT INTO users (phone, email, password_hash, name, role, status) VALUES (?,?,?,?,?,?)')
      .run(phone || null, email || null, hash, name, 'basic', 'active');

    // Auto-login
    const token = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, result.lastInsertRowid, expires);

    // Check for pending invitations matching this email
    let enterprise_id = null;
    let userRole = 'basic';
    let resourceId = null;
    if (email) {
      const invitation = db.prepare(`
        SELECT i.*, e.name as enterprise_name
        FROM invitations i
        JOIN enterprises e ON i.enterprise_id = e.id
        WHERE i.email = ? AND i.status = 'pending'
        ORDER BY i.created_at DESC LIMIT 1
      `).get(email);

      if (invitation) {
        enterprise_id = invitation.enterprise_id;
        // Create resource entry
        const resResult = db.prepare('INSERT INTO resources (name, email, role, team, enterprise_id) VALUES (?,?,?,?,?)')
          .run(name, email, '', '', enterprise_id);
        resourceId = resResult.lastInsertRowid;
        // Update user to join enterprise
        db.prepare('UPDATE users SET enterprise_id = ?, resource_id = ?, role = ? WHERE id = ?')
          .run(enterprise_id, resourceId, 'basic', result.lastInsertRowid);
        // Mark invitation as accepted
        db.prepare('UPDATE invitations SET status = ? WHERE id = ?').run('accepted', invitation.id);
      }
    }

    const enterprise = publicEnterprise(getEnterpriseRow(db, enterprise_id), { forAdmin: false });

    res.json({
      token,
      user: { id: result.lastInsertRowid, name, phone, email, role: userRole, enterprise_id, resource_id: resourceId, must_change_password: 0 },
      enterprise
    });
  });

  // Login
  router.post('/login', authLimiter, (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: L(req, 'auth.login_missing') });

    const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(account, account);
    if (!user) return res.status(401).json({ error: L(req, 'auth.account_not_found') });
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: L(req, 'auth.wrong_password') });

    const token = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, user.id, expires);

    res.json({
      token,
      user: publicUser(user),
      enterprise: enterpriseForUser(db, user),
    });
  });

  // Logout
  router.post('/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({ ok: true });
  });

  // Get current user
  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    // Refresh must_change_password from DB
    const fresh = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
    const user = { ...req.user, must_change_password: fresh?.must_change_password || 0 };
    res.json({ user: publicUser(user), enterprise: enterpriseForUser(db, user) });
  });

  // Create enterprise
  router.post('/enterprises', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    if (req.user.enterprise_id) return res.status(400).json({ error: L(req, 'auth.already_in_enterprise'), code: 'already_in_enterprise' });

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: L(req, 'auth.enter_enterprise_name') });

    const code = name.slice(0, 2).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
    const result = db.prepare('INSERT INTO enterprises (name, code, owner_id) VALUES (?,?,?)').run(name, code, req.user.id);
    db.prepare('UPDATE users SET enterprise_id = ?, role = ? WHERE id = ?').run(result.lastInsertRowid, 'admin', req.user.id);

    // Create resource entry for the owner
    const resResult = db.prepare('INSERT INTO resources (name, email, role, team, enterprise_id) VALUES (?,?,?,?,?)')
      .run(req.user.name, req.user.email || '', '', '', result.lastInsertRowid);
    db.prepare('UPDATE users SET resource_id = ? WHERE id = ?').run(resResult.lastInsertRowid, req.user.id);

    res.json({ id: result.lastInsertRowid, name, code });
  });

  // Request to join enterprise
  router.post('/enterprises/join', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    if (req.user.enterprise_id) return res.status(400).json({ error: L(req, 'auth.already_in_enterprise'), code: 'already_in_enterprise' });

    const { code, message } = req.body;
    const enterprise = db.prepare('SELECT * FROM enterprises WHERE code = ?').get(code);
    if (!enterprise) return res.status(404).json({ error: L(req, 'auth.enterprise_code_not_found') });

    const existing = db.prepare('SELECT id FROM join_requests WHERE user_id = ? AND enterprise_id = ? AND status = ?')
      .get(req.user.id, enterprise.id, 'pending');
    if (existing) return res.status(400).json({ error: L(req, 'auth.request_already_submitted') });

    db.prepare('INSERT INTO join_requests (user_id, enterprise_id, message) VALUES (?,?,?)')
      .run(req.user.id, enterprise.id, message || '');

    res.json({ ok: true, enterprise_name: enterprise.name });
  });

  // List join requests (for owner/admin)
  router.get('/enterprises/requests', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const requests = db.prepare(`
      SELECT jr.*, u.name as user_name, u.phone as user_phone, u.email as user_email
      FROM join_requests jr JOIN users u ON jr.user_id = u.id
      WHERE jr.enterprise_id = ? ORDER BY jr.created_at DESC
    `).all(req.user.enterprise_id);
    res.json(requests);
  });

  // Approve/reject join request
  router.put('/enterprises/requests/:id', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const { status } = req.body; // 'approved' or 'rejected'
    const request = db.prepare('SELECT * FROM join_requests WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!request) return res.status(404).json({ error: L(req, 'common.request_not_found') });

    db.prepare('UPDATE join_requests SET status = ?, reviewed_by = ? WHERE id = ?')
      .run(status, req.user.id, req.params.id);

    if (status === 'approved') {
      db.prepare('UPDATE users SET enterprise_id = ?, role = ? WHERE id = ?')
        .run(req.user.enterprise_id, 'basic', request.user_id);

      // Auto-create a resource entry for the new member
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user_id);
      const resResult = db.prepare('INSERT INTO resources (name, email, role, team, enterprise_id) VALUES (?,?,?,?,?)')
        .run(user.name, user.email || '', '', '', req.user.enterprise_id);
      db.prepare('UPDATE users SET resource_id = ? WHERE id = ?').run(resResult.lastInsertRowid, user.id);
    }

    res.json({ ok: true });
  });

  // List enterprise members
  router.get('/enterprises/members', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    const members = db.prepare(`
      SELECT u.id, u.name, u.phone, u.email, u.role, u.resource_id,
             u.managed_project_ids, u.created_at
      FROM users u WHERE u.enterprise_id = ? AND u.status = 'active' ORDER BY u.role DESC, u.name
    `).all(req.user.enterprise_id);
    res.json(members);
  });

  // Update member role (new three-role system: basic | manager | admin)
  router.put('/enterprises/members/:id/role', (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.admin_only') });
    const { role } = req.body;
    if (!['basic', 'manager', 'admin'].includes(role)) return res.status(400).json({ error: L(req, 'auth.invalid_role_options') });
    db.prepare('UPDATE users SET role = ? WHERE id = ? AND enterprise_id = ?')
      .run(role, req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // Update member role via permissions endpoint (compat alias → role only)
  // Prefer PUT /enterprises/members/:id/role
  router.put('/enterprises/members/:id/permissions', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.admin_only') });

    const target = db.prepare('SELECT id, role FROM users WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!target) return res.status(404).json({ error: L(req, 'common.member_not_found') });
    if (target.role === 'admin' && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ error: L(req, 'auth.use_role_api_for_admin') });
    }

    let role = req.body.role;
    // Map legacy booleans → role (book_others / manage → manager)
    if (!role) {
      const { perm_book_others, perm_manage_resources, perm_view_reports } = req.body;
      if (perm_book_others || perm_manage_resources || perm_view_reports) role = 'manager';
      else role = 'basic';
    }
    if (!['basic', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: L(req, 'auth.invalid_role') });
    }
    db.prepare('UPDATE users SET role=? WHERE id=? AND enterprise_id=?')
      .run(role, req.params.id, req.user.enterprise_id);
    res.json({ ok: true, role });
  });

  // Assign managed projects to a project manager
  router.put('/enterprises/members/:id/managed-projects', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.admin_only') });
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!target) return res.status(404).json({ error: L(req, 'common.member_not_found') });
    const { project_ids } = req.body; // array of project IDs
    const idsJson = JSON.stringify(Array.isArray(project_ids) ? project_ids.map(Number) : []);
    db.prepare('UPDATE users SET managed_project_ids = ? WHERE id = ? AND enterprise_id = ?')
      .run(idsJson, req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // Update enterprise settings (webhook, theme etc.)
  router.put('/enterprises/settings', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const {
      name,
      webhook_dingtalk,
      webhook_wecom,
      webhook_feishu,
      wecom_corp_id,
      wecom_agent_id,
      wecom_secret,
      wecom_department_id,
      currency,
      theme_color,
      timezone
    } = req.body;
    const current = db.prepare('SELECT wecom_secret FROM enterprises WHERE id = ?').get(req.user.enterprise_id);
    const secret = (wecom_secret || '').trim() || (current?.wecom_secret || '');
    db.prepare(`UPDATE enterprises SET name=?, webhook_dingtalk=?, webhook_wecom=?, webhook_feishu=?, wecom_corp_id=?, wecom_agent_id=?, wecom_secret=?, wecom_department_id=?, currency=?, theme_color=?, timezone=? WHERE id=?`)
      .run(
        name,
        webhook_dingtalk || '',
        webhook_wecom || '',
        webhook_feishu || '',
        (wecom_corp_id || '').trim(),
        String(wecom_agent_id || '').trim(),
        secret,
        Math.max(1, parseInt(wecom_department_id, 10) || 1),
        currency || 'CNY',
        theme_color || '',
        timezone || 'Asia/Shanghai',
        req.user.enterprise_id
      );
    res.json({ ok: true });
  });

  // Upload enterprise logo
  router.put('/enterprises/logo', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const { logo_data } = req.body;
    if (!logo_data) return res.status(400).json({ error: L(req, 'auth.no_logo_data') });

    const match = logo_data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: L(req, 'common.invalid_image') });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > 1024 * 1024) {
      return res.status(400).json({ error: L(req, 'auth.logo_too_large') });
    }

    const logosDir = path.join(__dirname, '..', 'public', 'logos');
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }

    const oldLogo = db.prepare('SELECT logo_url FROM enterprises WHERE id = ?').get(req.user.enterprise_id)?.logo_url;
    if (oldLogo) {
      const oldPath = path.join(__dirname, '..', 'public', oldLogo);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    const filename = `logo_${req.user.enterprise_id}_${Date.now()}.${ext}`;
    const filePath = path.join(logosDir, filename);
    fs.writeFileSync(filePath, buffer);

    const logoUrl = `/logos/${filename}`;
    db.prepare('UPDATE enterprises SET logo_url = ? WHERE id = ?').run(logoUrl, req.user.enterprise_id);

    res.json({ ok: true, logo_url: logoUrl });
  });

  // === ACCOUNT MANAGEMENT ===

  // Update profile (phone/email)
  router.put('/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    const { phone, email, name } = req.body;

    // Check uniqueness
    if (phone && phone !== req.user.phone) {
      const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.user.id);
      if (existing) return res.status(400).json({ error: L(req, 'auth.phone_in_use') });
    }
    if (email && email !== req.user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
      if (existing) return res.status(400).json({ error: L(req, 'auth.email_in_use') });
    }

    db.prepare('UPDATE users SET phone=?, email=?, name=? WHERE id=?')
      .run(phone || null, email || null, name || req.user.name, req.user.id);

    // Also update linked resource name if exists
    if (req.user.resource_id && name) {
      db.prepare('UPDATE resources SET name=?, email=? WHERE id=?')
        .run(name, email || '', req.user.resource_id);
    }

    res.json({ ok: true });
  });

  // Upload avatar
  router.put('/avatar', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    const { avatar_data } = req.body; // base64 data URI from client
    if (!avatar_data) return res.status(400).json({ error: L(req, 'auth.no_avatar_data') });

    // Validate it's an image data URI
    const match = avatar_data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: L(req, 'common.invalid_image') });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Check size (should be under 500KB after client compression)
    if (buffer.length > 500 * 1024) {
      return res.status(400).json({ error: L(req, 'auth.avatar_too_large') });
    }

    // Ensure avatars directory exists
    const avatarDir = path.join(__dirname, '..', 'public', 'avatars');
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    // Delete old avatar file if exists
    const oldAvatar = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id)?.avatar;
    if (oldAvatar) {
      const oldPath = path.join(__dirname, '..', 'public', oldAvatar);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    // Save new avatar
    const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
    const filePath = path.join(avatarDir, filename);
    fs.writeFileSync(filePath, buffer);

    const avatarUrl = `/avatars/${filename}`;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);

    res.json({ ok: true, avatar: avatarUrl });
  });

  // Change password (requires old password)
  router.put('/password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ error: L(req, 'auth.pwd_both_required') });
    if (new_password.length < 6) return res.status(400).json({ error: L(req, 'auth.new_pwd_min') });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(old_password, user.password_hash)) {
      return res.status(400).json({ error: L(req, 'auth.old_pwd_wrong') });
    }

    const newHash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
    res.json({ ok: true });
  });

  // First-login password change (no old password required, only valid when must_change_password=1)
  router.put('/first-password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    const userRow = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
    if (!userRow || !userRow.must_change_password) {
      return res.status(400).json({ error: L(req, 'auth.no_first_pwd_change') });
    }
    const { new_password } = req.body;
    if (!new_password) return res.status(400).json({ error: L(req, 'auth.enter_new_pwd') });
    if (new_password.length < 6) return res.status(400).json({ error: L(req, 'auth.pwd_min') });

    const newHash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
    res.json({ ok: true });
  });

  // === BULK CREATE MEMBERS ===
  // POST /api/auth/enterprises/bulk-create
  // Body: { members: [{ email, name, title, team, phone? }], initial_password? }
  router.post('/enterprises/bulk-create', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.admin_only') });

    const { members, initial_password } = req.body;
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: L(req, 'auth.members_required') });
    }
    const pwd = initial_password || 'Crewboard@2026';
    if (pwd.length < 6) return res.status(400).json({ error: L(req, 'auth.initial_pwd_min') });

    const results = [];
    const errors = [];

    const transaction = db.transaction(() => {
      members.forEach((m, idx) => {
        const { email, name, title, team, phone } = m;
        if (!name) { errors.push({ idx, reason: L(req, 'auth.bulk_name_empty') }); return; }
        if (!email && !phone) { errors.push({ idx, name, reason: L(req, 'auth.bulk_need_contact') }); return; }

        // Check duplicate
        if (email) {
          const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
          if (dup) { errors.push({ idx, name, reason: L(req, 'auth.bulk_email_exists', { email }) }); return; }
        }
        if (phone) {
          const dup = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
          if (dup) { errors.push({ idx, name, reason: L(req, 'auth.bulk_phone_exists', { phone }) }); return; }
        }

        const hash = hashPassword(pwd);
        // Create user with must_change_password = 1
        const userResult = db.prepare(
          `INSERT INTO users (phone, email, password_hash, name, enterprise_id, role, status, must_change_password)
           VALUES (?, ?, ?, ?, ?, 'basic', 'active', 1)`
        ).run(phone || null, email || null, hash, name, req.user.enterprise_id);

        // Create linked resource entry
        const resResult = db.prepare(
          'INSERT INTO resources (name, email, role, team, enterprise_id) VALUES (?, ?, ?, ?, ?)'
        ).run(name, email || '', title || '', team || '', req.user.enterprise_id);

        // Link resource to user
        db.prepare('UPDATE users SET resource_id = ? WHERE id = ?')
          .run(resResult.lastInsertRowid, userResult.lastInsertRowid);

        results.push({ name, email: email || null, phone: phone || null, user_id: userResult.lastInsertRowid });
      });
    });

    transaction();
    res.json({ ok: true, created: results, errors });
  });

  // === INVITATIONS ===

  // Send invitation
  router.post('/enterprises/invite', async (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.admin_only') });

    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: L(req, 'auth.enter_email') });

    // Check if already invited
    const existing = db.prepare('SELECT id FROM invitations WHERE email = ? AND enterprise_id = ? AND status = ?')
      .get(email, req.user.enterprise_id, 'pending');
    if (existing) return res.status(400).json({ error: L(req, 'auth.invite_pending_exists') });

    // Check if already a member
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND enterprise_id = ?')
      .get(email, req.user.enterprise_id);
    if (existingUser) return res.status(400).json({ error: L(req, 'auth.invite_already_member') });

    const token = uuidv4();
    db.prepare('INSERT INTO invitations (enterprise_id, email, name, invited_by, token) VALUES (?,?,?,?,?)')
      .run(req.user.enterprise_id, email, name || '', req.user.id, token);

    const enterprise = db.prepare('SELECT name, code FROM enterprises WHERE id = ?').get(req.user.enterprise_id);

    // Send invitation email
    const inviteLink = APP_URL + '/#register?invite=' + token + '&email=' + encodeURIComponent(email);
    const html = invitationEmail(req.user.name, enterprise.name, inviteLink);
    const emailResult = await sendMail(email, '邀请加入「' + enterprise.name + '」- 神马排班 CrewBoard', html);

    res.json({
      ok: true,
      token,
      invite_code: enterprise.code,
      enterprise_name: enterprise.name,
      invite_link: inviteLink,
      email_sent: emailResult.ok
    });
  });

  // List invitations
  router.get('/enterprises/invitations', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const invitations = db.prepare(`
      SELECT i.*, u.name as invited_by_name
      FROM invitations i
      LEFT JOIN users u ON i.invited_by = u.id
      WHERE i.enterprise_id = ? AND i.status = 'pending'
      ORDER BY i.created_at DESC
    `).all(req.user.enterprise_id);
    res.json(invitations);
  });

  // Cancel invitation
  router.delete('/enterprises/invitations/:id', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: L(req, 'common.forbidden') });
    if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    db.prepare('DELETE FROM invitations WHERE id = ? AND enterprise_id = ?')
      .run(req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // Accept invitation (logged-in user without an enterprise, e.g. clicked the
  // invite link while already signed in with the invited email account)
  router.post('/invitations/accept', (req, res) => {
    if (!req.user) return res.status(401).json({ error: L(req, 'common.not_logged_in') });
    if (req.user.enterprise_id) return res.status(400).json({ error: L(req, 'auth.already_in_enterprise'), code: 'already_in_enterprise' });

    const { token } = req.body;
    if (!token) return res.status(400).json({ error: L(req, 'auth.invite_token_missing') });

    const invitation = db.prepare(`
      SELECT i.*, e.name as enterprise_name
      FROM invitations i
      JOIN enterprises e ON i.enterprise_id = e.id
      WHERE i.token = ? AND i.status = 'pending'
    `).get(token);
    if (!invitation) return res.status(400).json({ error: L(req, 'auth.invite_not_found') });

    // Invitation must be addressed to this account's email
    if (!req.user.email || req.user.email.toLowerCase() !== (invitation.email || '').toLowerCase()) {
      return res.status(400).json({ error: L(req, 'auth.invite_email_mismatch') });
    }

    const enterprise_id = invitation.enterprise_id;
    // Create resource entry
    const resResult = db.prepare('INSERT INTO resources (name, email, role, team, enterprise_id) VALUES (?,?,?,?,?)')
      .run(req.user.name, req.user.email, '', '', enterprise_id);
    const resourceId = resResult.lastInsertRowid;
    // Join enterprise
    db.prepare('UPDATE users SET enterprise_id = ?, resource_id = ?, role = ? WHERE id = ?')
      .run(enterprise_id, resourceId, 'basic', req.user.id);
    // Mark invitation as accepted
    db.prepare('UPDATE invitations SET status = ? WHERE id = ?').run('accepted', invitation.id);

    const enterprise = publicEnterprise(getEnterpriseRow(db, enterprise_id), { forAdmin: false });
    res.json({ ok: true, enterprise_name: invitation.enterprise_name, enterprise });
  });

  // === FORGOT PASSWORD ===

  // Step 1: Request password reset (no auth required)
  router.post('/forgot-password', forgotLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: L(req, 'auth.enter_email') });

    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) {
      // Don't reveal whether email exists — return success either way
      return res.json({ ok: true, message: L(req, 'auth.reset_sent_if_registered') });
    }

    // Invalidate previous tokens for this user
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

    // Generate new token (30 min expiry)
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?,?,?)')
      .run(user.id, token, expiresAt);

    // Send email
    const resetLink = APP_URL + '/#reset-password?token=' + token;
    const html = passwordResetEmail(user.name, resetLink);
    const result = await sendMail(user.email, '重置密码 - 神马排班 CrewBoard', html);

    if (!result.ok) {
      console.error('[ForgotPassword] Email send failed:', result.error);
    }

    res.json({ ok: true, message: L(req, 'auth.reset_sent_if_registered') });
  });

  // Step 2: Verify reset token
  router.get('/reset-password/:token', (req, res) => {
    // expires_at is stored as ISO-8601 UTC (toISOString) — compare against an
    // ISO string directly. Using datetime(?) yields 'YYYY-MM-DD HH:MM:SS',
    // whose string comparison against ISO ('T' > ' ') accepted expired tokens.
    const row = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?'
    ).get(req.params.token, new Date().toISOString());

    if (!row) return res.status(400).json({ error: L(req, 'auth.reset_link_invalid') });

    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(row.user_id);
    res.json({ ok: true, email: user?.email || '' });
  });

  // Step 3: Set new password with token
  router.post('/reset-password', (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: L(req, 'common.missing_params') });
    if (new_password.length < 6) return res.status(400).json({ error: L(req, 'auth.pwd_min') });

    const row = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?'
    ).get(token, new Date().toISOString());

    if (!row) return res.status(400).json({ error: L(req, 'auth.reset_link_invalid') });

    // Update password
    const newHash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, row.user_id);

    // Mark token as used
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);

    // Clear all sessions for this user (force re-login)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);

    res.json({ ok: true });
  });

  return router;
};

// Backward-compatible re-export
module.exports.authMiddleware = authMiddleware;
