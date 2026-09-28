/**
 * clients.js routes
 */
const express = require('express');
const { logAudit } = require('../../utils/audit');
const { L } = require('../../utils/server-i18n');
const { isNonEmptyString } = require('../../utils/validate');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === CLIENTS ===
router.get('/clients', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);
  const archived = req.query.archived === '1' ? 1 : 0;
  res.json(db.prepare('SELECT * FROM clients WHERE is_active = 1 AND is_archived = ? AND enterprise_id = ? ORDER BY name').all(archived, entId));
});

router.post('/clients', (req, res) => {
  const { name, color, details } = req.body;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  const userRole = req.user?.role;
  if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: L(req, 'clients.add_manager_only') });
  if (!isNonEmptyString(name)) return res.status(400).json({ error: L(req, 'common.name_required') });
  const result = db.prepare('INSERT INTO clients (name, color, details, enterprise_id, created_by) VALUES (?, ?, ?, ?, ?)').run(name, color || '#6366F1', details || '', entId, req.user.id);
  res.json({ id: result.lastInsertRowid });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'client.create',
    entityType: 'client',
    entityId: result.lastInsertRowid,
    details: { name },
  });
  sseBroadcast(entId, 'client-change', { action: 'create' }, req.user?.id);
});

router.put('/clients/:id', (req, res) => {
  const { name, color, details } = req.body;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: L(req, 'clients.edit_manager_only') });
  const client = authz.getClientInEnterprise(req.params.id, entId);
  if (!client) return res.status(404).json({ error: L(req, 'common.client_not_found') });
  if (req.user.role === 'manager' && client.created_by !== req.user.id) {
    return res.status(403).json({ error: L(req, 'clients.edit_own_only') });
  }
  if (!isNonEmptyString(name)) return res.status(400).json({ error: L(req, 'common.name_required') });
  db.prepare('UPDATE clients SET name=?, color=?, details=? WHERE id=? AND enterprise_id=?')
    .run(name, color || client.color, details != null ? details : client.details, req.params.id, entId);
  res.json({ ok: true });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'client.update',
    entityType: 'client',
    entityId: +req.params.id,
    details: { before: { name: client.name }, after: { name } },
  });
  sseBroadcast(entId, 'client-change', { action: 'update' }, req.user?.id);
});

router.patch('/clients/:id/archive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'clients.archive_admin_only') });
  const client = authz.getClientInEnterprise(req.params.id, entId);
  if (!client) return res.status(404).json({ error: L(req, 'common.client_not_found') });
  db.prepare('UPDATE clients SET is_archived = 1 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  db.prepare('UPDATE projects SET is_archived = 1 WHERE client_id = ? AND enterprise_id = ? AND is_active = 1').run(req.params.id, entId);
  res.json({ ok: true });
  logAudit(db, { enterpriseId: entId, user: req.user, action: 'client.archive', entityType: 'client', entityId: +req.params.id, details: { name: client.name } });
  sseBroadcast(entId, 'client-change', { action: 'archive' }, req.user?.id);
});

router.patch('/clients/:id/unarchive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'clients.unarchive_admin_only') });
  const client = authz.getClientInEnterprise(req.params.id, entId);
  if (!client) return res.status(404).json({ error: L(req, 'common.client_not_found') });
  db.prepare('UPDATE clients SET is_archived = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  db.prepare('UPDATE projects SET is_archived = 0 WHERE client_id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  logAudit(db, { enterpriseId: entId, user: req.user, action: 'client.unarchive', entityType: 'client', entityId: +req.params.id, details: { name: client.name } });
  sseBroadcast(entId, 'client-change', { action: 'unarchive' }, req.user?.id);
});

router.delete('/clients/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'clients.delete_admin_only') });
  const client = authz.getClientInEnterprise(req.params.id, entId);
  if (!client) return res.status(404).json({ error: L(req, 'common.client_not_found') });
  db.prepare('UPDATE clients SET is_active = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  logAudit(db, { enterpriseId: entId, user: req.user, action: 'client.delete', entityType: 'client', entityId: +req.params.id, details: { name: client.name } });
  sseBroadcast(entId, 'client-change', { action: 'delete' }, req.user?.id);
});

};
