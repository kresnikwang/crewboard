/**
 * resources.js routes
 */
const express = require('express');
const { logAudit } = require('../../utils/audit');
const { L } = require('../../utils/server-i18n');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === RESOURCES ===
router.get('/resources', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);
  // LEFT JOIN users to include linked account info (matched by email)
  const resources = db.prepare(`
    SELECT r.id, r.name, r.email, r.role, r.team, r.color, r.hours_per_day, r.is_active, r.enterprise_id, r.created_at, r.wecom_userid,
           COALESCE(NULLIF(r.avatar, ''), u.avatar, '') AS avatar,
           u.id        AS user_id,
           u.phone     AS user_phone,
           u.role      AS user_role,
           u.status    AS user_status,
           u.managed_project_ids AS user_managed_project_ids,
           u.created_at AS user_joined_at
    FROM resources r
    LEFT JOIN users u
      ON lower(r.email) = lower(u.email)
      AND u.enterprise_id = r.enterprise_id
      AND u.status = 'active'
    WHERE r.is_active = 1 AND r.enterprise_id = ?
    ORDER BY r.team, r.name
  `).all(entId);
  res.json(resources);
});

router.post('/resources', (req, res) => {
  const { name, email, role, team, color, hours_per_day, avatar } = req.body;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (req.user?.role !== 'admin') return res.status(403).json({ error: L(req, 'resources.add_admin_only') });
  const avatarUrl = saveAvatarHelper(avatar, '', 'resource');
  const stmt = db.prepare('INSERT INTO resources (name, email, role, team, color, hours_per_day, enterprise_id, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const result = stmt.run(name, email || null, role || '', team || '', color || '#4F46E5', hours_per_day || 8, entId, avatarUrl);
  if (email) {
    db.prepare('UPDATE users SET avatar = ? WHERE lower(email) = lower(?) AND enterprise_id = ?')
      .run(avatarUrl, email, entId);
  }
  res.json({ id: result.lastInsertRowid });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'resource.create',
    entityType: 'resource',
    entityId: result.lastInsertRowid,
    details: { name, email, role, team },
  });
  sseBroadcast(req.user?.enterprise_id, 'resource-change', { action: 'create' }, req.user?.id);
});

router.put('/resources/:id', (req, res) => {
  const { name, email, role, team, color, hours_per_day, avatar } = req.body;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'resources.edit_admin_only') });
  const oldRes = authz.getResourceInEnterprise(req.params.id, entId);
  if (!oldRes) return res.status(404).json({ error: L(req, 'resources.not_found') });
  const avatarUrl = saveAvatarHelper(avatar, oldRes.avatar || '', `resource_${req.params.id}`);
  db.prepare('UPDATE resources SET name=?, email=?, role=?, team=?, color=?, hours_per_day=?, avatar=? WHERE id=? AND enterprise_id=?')
    .run(name, email, role, team, color, hours_per_day, avatarUrl, req.params.id, entId);
  if (email) {
    db.prepare('UPDATE users SET avatar = ? WHERE lower(email) = lower(?) AND enterprise_id = ?')
      .run(avatarUrl, email, entId);
  }
  res.json({ ok: true });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'resource.update',
    entityType: 'resource',
    entityId: +req.params.id,
    details: { name, email, role, team },
  });
  sseBroadcast(entId, 'resource-change', { action: 'update' }, req.user?.id);
});

router.delete('/resources/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'resources.delete_admin_only') });
  const existing = authz.getResourceInEnterprise(req.params.id, entId);
  if (!existing) return res.status(404).json({ error: L(req, 'resources.not_found') });
  db.prepare('UPDATE resources SET is_active = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'resource.delete',
    entityType: 'resource',
    entityId: +req.params.id,
    details: { name: existing.name },
  });
  res.json({ ok: true });
  sseBroadcast(entId, 'resource-change', { action: 'delete' }, req.user?.id);
});

};
