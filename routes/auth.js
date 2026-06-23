const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendMail, passwordResetEmail, invitationEmail, APP_URL } = require('../utils/email');
const uuidv4 = () => crypto.randomUUID();
const router = express.Router();

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return hash === check;
}

module.exports = function(db) {

  // Register
  router.post('/register', (req, res) => {
    const { phone, email, password, name } = req.body;
    if (!password || !name || (!phone && !email)) {
      return res.status(400).json({ error: '请填写姓名、密码和手机号或邮箱' });
    }
    // Check uniqueness
    if (phone) {
      const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
      if (existing) return res.status(400).json({ error: '该手机号已注册' });
    }
    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return res.status(400).json({ error: '该邮箱已注册' });
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

    const enterprise = enterprise_id
      ? db.prepare('SELECT id, name, code, webhook_dingtalk, webhook_wecom, webhook_feishu, wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id, currency, theme_color FROM enterprises WHERE id = ?').get(enterprise_id)
      : null;

    res.json({
      token,
      user: { id: result.lastInsertRowid, name, phone, email, role: userRole, enterprise_id, resource_id: resourceId },
      enterprise
    });
  });

  // Login
  router.post('/login', (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '请输入账号和密码' });

    const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(account, account);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '密码错误' });

    const token = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, user.id, expires);

    const enterprise = user.enterprise_id
      ? db.prepare('SELECT id, name, code, webhook_dingtalk, webhook_wecom, webhook_feishu, wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id, currency, theme_color FROM enterprises WHERE id = ?').get(user.enterprise_id)
      : null;

    res.json({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role, enterprise_id: user.enterprise_id, resource_id: user.resource_id, avatar: user.avatar || '', perm_book_others: user.perm_book_others, perm_manage_resources: user.perm_manage_resources, perm_view_reports: user.perm_view_reports, must_change_password: user.must_change_password || 0 },
      enterprise,
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
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const enterprise = req.user.enterprise_id
      ? db.prepare('SELECT id, name, code, webhook_dingtalk, webhook_wecom, webhook_feishu, wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id, currency, theme_color FROM enterprises WHERE id = ?').get(req.user.enterprise_id)
      : null;
    res.json({ user: req.user, enterprise });
  });

  // Create enterprise
  router.post('/enterprises', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (req.user.enterprise_id) return res.status(400).json({ error: '您已属于一个企业' });

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '请输入企业名称' });

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
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (req.user.enterprise_id) return res.status(400).json({ error: '您已属于一个企业' });

    const { code, message } = req.body;
    const enterprise = db.prepare('SELECT * FROM enterprises WHERE code = ?').get(code);
    if (!enterprise) return res.status(404).json({ error: '企业代码不存在' });

    const existing = db.prepare('SELECT id FROM join_requests WHERE user_id = ? AND enterprise_id = ? AND status = ?')
      .get(req.user.id, enterprise.id, 'pending');
    if (existing) return res.status(400).json({ error: '您已提交过申请，请等待审核' });

    db.prepare('INSERT INTO join_requests (user_id, enterprise_id, message) VALUES (?,?,?)')
      .run(req.user.id, enterprise.id, message || '');

    res.json({ ok: true, enterprise_name: enterprise.name });
  });

  // List join requests (for owner/admin)
  router.get('/enterprises/requests', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '无权限' }); // owner kept for legacy

    const requests = db.prepare(`
      SELECT jr.*, u.name as user_name, u.phone as user_phone, u.email as user_email
      FROM join_requests jr JOIN users u ON jr.user_id = u.id
      WHERE jr.enterprise_id = ? ORDER BY jr.created_at DESC
    `).all(req.user.enterprise_id);
    res.json(requests);
  });

  // Approve/reject join request
  router.put('/enterprises/requests/:id', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '无权限' }); // owner kept for legacy

    const { status } = req.body; // 'approved' or 'rejected'
    const request = db.prepare('SELECT * FROM join_requests WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!request) return res.status(404).json({ error: '申请不存在' });

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
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    const members = db.prepare(`
      SELECT u.id, u.name, u.phone, u.email, u.role, u.resource_id,
             u.perm_book_others, u.perm_manage_resources, u.perm_view_reports,
             u.perm_project_manager, u.managed_project_ids,
             u.created_at
      FROM users u WHERE u.enterprise_id = ? AND u.status = 'active' ORDER BY u.role DESC, u.name
    `).all(req.user.enterprise_id);
    res.json(members);
  });

  // Update member role (new three-role system: basic | manager | admin)
  router.put('/enterprises/members/:id/role', (req, res) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'owner') return res.status(403).json({ error: '仅管理员可操作' });
    const { role } = req.body;
    if (!['basic', 'manager', 'admin'].includes(role)) return res.status(400).json({ error: '无效角色，可选：basic / manager / admin' });
    db.prepare('UPDATE users SET role = ? WHERE id = ? AND enterprise_id = ?')
      .run(role, req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // Update member permissions (deprecated in new role model, kept for backward compat)
  // Prefer PUT /enterprises/members/:id/role instead
  router.put('/enterprises/members/:id/permissions', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: '仅管理员可操作' });

    const target = db.prepare('SELECT * FROM users WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!target) return res.status(404).json({ error: '成员不存在' });
    if (target.role === 'admin') {
      return res.status(400).json({ error: '管理员角色默认拥有所有权限' });
    }

    // In new model, permissions map directly to roles
    // This endpoint now accepts { role } or legacy perm booleans
    const { role, perm_book_others, perm_manage_resources, perm_view_reports, perm_project_manager } = req.body;
    if (role && ['basic', 'manager', 'admin'].includes(role)) {
      db.prepare('UPDATE users SET role=? WHERE id=? AND enterprise_id=?')
        .run(role, req.params.id, req.user.enterprise_id);
      return res.json({ ok: true });
    }
    // Legacy boolean support
    db.prepare('UPDATE users SET perm_book_others=?, perm_manage_resources=?, perm_view_reports=?, perm_project_manager=? WHERE id=? AND enterprise_id=?')
      .run(
        perm_book_others ? 1 : 0,
        perm_manage_resources ? 1 : 0,
        perm_view_reports ? 1 : 0,
        perm_project_manager ? 1 : 0,
        req.params.id,
        req.user.enterprise_id
      );
    res.json({ ok: true });
  });

  // Assign managed projects to a project manager
  router.put('/enterprises/members/:id/managed-projects', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND enterprise_id = ?')
      .get(req.params.id, req.user.enterprise_id);
    if (!target) return res.status(404).json({ error: '成员不存在' });
    const { project_ids } = req.body; // array of project IDs
    const idsJson = JSON.stringify(Array.isArray(project_ids) ? project_ids.map(Number) : []);
    db.prepare('UPDATE users SET managed_project_ids = ? WHERE id = ? AND enterprise_id = ?')
      .run(idsJson, req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // Update enterprise settings (webhook, theme etc.)
  router.put('/enterprises/settings', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });

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
      theme_color
    } = req.body;
    db.prepare(`UPDATE enterprises SET name=?, webhook_dingtalk=?, webhook_wecom=?, webhook_feishu=?, wecom_corp_id=?, wecom_agent_id=?, wecom_secret=?, wecom_department_id=?, currency=?, theme_color=? WHERE id=?`)
      .run(
        name,
        webhook_dingtalk || '',
        webhook_wecom || '',
        webhook_feishu || '',
        (wecom_corp_id || '').trim(),
        String(wecom_agent_id || '').trim(),
        (wecom_secret || '').trim(),
        Math.max(1, parseInt(wecom_department_id, 10) || 1),
        currency || 'CNY',
        theme_color || '',
        req.user.enterprise_id
      );
    res.json({ ok: true });
  });

  // === ACCOUNT MANAGEMENT ===

  // Update profile (phone/email)
  router.put('/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const { phone, email, name } = req.body;

    // Check uniqueness
    if (phone && phone !== req.user.phone) {
      const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.user.id);
      if (existing) return res.status(400).json({ error: '该手机号已被其他账号使用' });
    }
    if (email && email !== req.user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
      if (existing) return res.status(400).json({ error: '该邮箱已被其他账号使用' });
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
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const { avatar_data } = req.body; // base64 data URI from client
    if (!avatar_data) return res.status(400).json({ error: '未提供头像数据' });

    // Validate it's an image data URI
    const match = avatar_data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: '无效的图片格式' });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Check size (should be under 500KB after client compression)
    if (buffer.length > 500 * 1024) {
      return res.status(400).json({ error: '头像压缩后文件大小不能超过 500KB' });
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
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ error: '请填写旧密码和新密码' });
    if (new_password.length < 6) return res.status(400).json({ error: '新密码至少6位' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(old_password, user.password_hash)) {
      return res.status(400).json({ error: '旧密码不正确' });
    }

    const newHash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
    res.json({ ok: true });
  });

  // First-login password change (no old password required, only valid when must_change_password=1)
  router.put('/first-password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const userRow = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
    if (!userRow || !userRow.must_change_password) {
      return res.status(400).json({ error: '无需修改初始密码' });
    }
    const { new_password } = req.body;
    if (!new_password) return res.status(400).json({ error: '请输入新密码' });
    if (new_password.length < 6) return res.status(400).json({ error: '密码至少6位' });

    const newHash = hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
    res.json({ ok: true });
  });

  // === BULK CREATE MEMBERS ===
  // POST /api/auth/enterprises/bulk-create
  // Body: { members: [{ email, name, title, team, phone? }], initial_password? }
  router.post('/enterprises/bulk-create', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });

    const { members, initial_password } = req.body;
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: '请提供成员列表' });
    }
    const pwd = initial_password || 'Crewboard@2026';
    if (pwd.length < 6) return res.status(400).json({ error: '初始密码至少6位' });

    const results = [];
    const errors = [];

    const transaction = db.transaction(() => {
      members.forEach((m, idx) => {
        const { email, name, title, team, phone } = m;
        if (!name) { errors.push({ idx, reason: '姓名不能为空' }); return; }
        if (!email && !phone) { errors.push({ idx, name, reason: '邮箱或手机号至少填一项' }); return; }

        // Check duplicate
        if (email) {
          const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
          if (dup) { errors.push({ idx, name, reason: `邮箱 ${email} 已存在` }); return; }
        }
        if (phone) {
          const dup = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
          if (dup) { errors.push({ idx, name, reason: `手机号 ${phone} 已存在` }); return; }
        }

        const hash = hashPassword(pwd);
        // Create user with must_change_password = 1
        const userResult = db.prepare(
          `INSERT INTO users (phone, email, password_hash, name, enterprise_id, role,
            perm_book_others, perm_manage_resources, perm_view_reports, status, must_change_password)
           VALUES (?, ?, ?, ?, ?, 'basic', 0, 0, 0, 'active', 1)`
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
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });

    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: '请输入邮箱地址' });

    // Check if already invited
    const existing = db.prepare('SELECT id FROM invitations WHERE email = ? AND enterprise_id = ? AND status = ?')
      .get(email, req.user.enterprise_id, 'pending');
    if (existing) return res.status(400).json({ error: '该邮箱已有待处理的邀请' });

    // Check if already a member
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND enterprise_id = ?')
      .get(email, req.user.enterprise_id);
    if (existingUser) return res.status(400).json({ error: '该邮箱的用户已是企业成员' });

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
      email_sent: emailResult.ok
    });
  });

  // List invitations
  router.get('/enterprises/invitations', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });

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
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });

    db.prepare('DELETE FROM invitations WHERE id = ? AND enterprise_id = ?')
      .run(req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // === FORGOT PASSWORD ===

  // Step 1: Request password reset (no auth required)
  router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '请输入邮箱地址' });

    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) {
      // Don't reveal whether email exists — return success either way
      return res.json({ ok: true, message: '如果该邮箱已注册，重置链接已发送' });
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

    res.json({ ok: true, message: '如果该邮箱已注册，重置链接已发送' });
  });

  // Step 2: Verify reset token
  router.get('/reset-password/:token', (req, res) => {
    const row = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime(?)'
    ).get(req.params.token, new Date().toISOString());

    if (!row) return res.status(400).json({ error: '链接无效或已过期，请重新申请' });

    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(row.user_id);
    res.json({ ok: true, email: user?.email || '' });
  });

  // Step 3: Set new password with token
  router.post('/reset-password', (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: '缺少参数' });
    if (new_password.length < 6) return res.status(400).json({ error: '密码至少6位' });

    const row = db.prepare(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime(?)'
    ).get(token, new Date().toISOString());

    if (!row) return res.status(400).json({ error: '链接无效或已过期，请重新申请' });

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

module.exports.authMiddleware = function(db) {
  return (req, res, next) => {
    // Support token via Authorization header (normal API calls)
    // or via ?token= query param (EventSource / SSE cannot set custom headers)
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token) {
      const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime(?)').get(token, new Date().toISOString());
      if (session) {
        req.user = db.prepare('SELECT id, name, phone, email, enterprise_id, resource_id, role, avatar, perm_book_others, perm_manage_resources, perm_view_reports, perm_project_manager, managed_project_ids, status FROM users WHERE id = ?').get(session.user_id);
      }
    }
    next();
  };
};
