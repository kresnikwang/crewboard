/**
 * projects.js routes
 */
const express = require('express');
const { logAudit } = require('../../utils/audit');
const { L } = require('../../utils/server-i18n');
const { isYmd, isBefore, isNonEmptyString, parseNonNegativeNumber } = require('../../utils/validate');

/** Upper bound on ids accepted by batch endpoints (mirrors bookings.js). */
const MAX_BATCH_IDS = 500;

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === PROJECTS ===
function canEditProject(user, projectId) {
  return authz.canEditProject(user, projectId);
}

router.get('/projects', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);
  const archived = req.query.archived === '1' ? 1 : 0;
  const projects = db.prepare(`
    SELECT p.*, c.name as client_name, c.color as client_color
    FROM projects p LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.is_active = 1 AND p.is_archived = ? AND p.enterprise_id = ? ORDER BY p.name
  `).all(archived, entId);
  res.json(projects);
});

router.post('/projects', (req, res) => {
  const { name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details } = req.body;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  const userRole = req.user?.role;
  if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: L(req, 'projects.add_manager_only') });
  if (!isNonEmptyString(name)) return res.status(400).json({ error: L(req, 'common.name_required') });
  // Reject a client from another enterprise instead of linking it silently.
  if (client_id) {
    const client = authz.getClientInEnterprise(client_id, entId);
    if (!client) return res.status(400).json({ error: L(req, 'common.client_not_found_or_denied') });
  }
  if (start_date && !isYmd(start_date)) return res.status(400).json({ error: L(req, 'common.invalid_date') });
  if (end_date && !isYmd(end_date)) return res.status(400).json({ error: L(req, 'common.invalid_date') });
  if (isBefore(end_date, start_date)) return res.status(400).json({ error: L(req, 'common.end_before_start') });
  const result = db.prepare('INSERT INTO projects (name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details, enterprise_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, client_id || null, color || '#8B5CF6', code || '', start_date || null, end_date || null, parseNonNegativeNumber(budget_hours, 0), parseNonNegativeNumber(hourly_rate, 0), billable != null ? (billable ? 1 : 0) : 1, details || '', entId, req.user.id);
  res.json({ id: result.lastInsertRowid });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'project.create',
    entityType: 'project',
    entityId: result.lastInsertRowid,
    details: { name, client_id: client_id || null },
  });
  sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'create' }, req.user?.id);
});

router.put('/projects/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: L(req, 'common.project_missing') });
  if (!canEditProject(req.user, req.params.id)) {
    return res.status(403).json({ error: L(req, 'projects.edit_forbidden') });
  }
  const { name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details } = req.body;
  if (client_id) {
    const client = authz.getClientInEnterprise(client_id, entId);
    if (!client) return res.status(400).json({ error: L(req, 'common.client_not_found_or_denied') });
  }
  if (!isNonEmptyString(name)) return res.status(400).json({ error: L(req, 'common.name_required') });
  if (start_date && !isYmd(start_date)) return res.status(400).json({ error: L(req, 'common.invalid_date') });
  if (end_date && !isYmd(end_date)) return res.status(400).json({ error: L(req, 'common.invalid_date') });
  if (isBefore(end_date, start_date)) return res.status(400).json({ error: L(req, 'common.end_before_start') });
  db.prepare('UPDATE projects SET name=?, client_id=?, color=?, code=?, start_date=?, end_date=?, budget_hours=?, hourly_rate=?, billable=?, details=? WHERE id=? AND enterprise_id=?')
    .run(
      name,
      client_id || null,
      color || proj.color,
      code != null ? code : proj.code,
      start_date !== undefined ? start_date : proj.start_date,
      end_date !== undefined ? end_date : proj.end_date,
      budget_hours !== undefined ? parseNonNegativeNumber(budget_hours, proj.budget_hours) : proj.budget_hours,
      hourly_rate !== undefined ? parseNonNegativeNumber(hourly_rate, proj.hourly_rate) : proj.hourly_rate,
      billable != null ? (billable ? 1 : 0) : proj.billable,
      details != null ? details : proj.details,
      req.params.id,
      entId
    );
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'update' }, req.user?.id);
});

router.patch('/projects/:id/archive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'projects.archive_admin_only') });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: L(req, 'common.project_missing') });
  db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'project.archive',
    entityType: 'project',
    entityId: +req.params.id,
    details: { name: proj.name, code: proj.code || '' },
  });
  sseBroadcast(entId, 'project-change', { action: 'archive' }, req.user?.id);
});

/**
 * Archive many projects in one transaction.
 * Body: { ids: number[] }
 *
 * Same admin-only rule as the single-project endpoint. Every id is validated
 * against the caller's enterprise, so a mixed/cross-tenant payload reports
 * exactly which ids were rejected instead of silently archiving a subset.
 */
router.post('/projects/batch-archive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'projects.archive_admin_only') });

  const ids = Array.isArray(req.body.ids)
    ? Array.from(new Set(req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
    : [];
  if (!ids.length) return res.status(400).json({ error: L(req, 'projects.missing_ids') });
  if (ids.length > MAX_BATCH_IDS) {
    return res.status(400).json({ error: L(req, 'projects.too_many_ids', { max: MAX_BATCH_IDS }) });
  }

  const placeholders = ids.map(() => '?').join(',');
  const found = db.prepare(`
    SELECT id, name, code, is_archived FROM projects
    WHERE enterprise_id = ? AND id IN (${placeholders})
  `).all(entId, ...ids);
  const foundIds = new Set(found.map((p) => p.id));
  const notFound = ids.filter((id) => !foundIds.has(id));
  if (notFound.length) {
    return res.status(404).json({
      error: L(req, 'common.project_missing'),
      code: 'project_not_found',
      ids: notFound,
    });
  }

  const toArchive = found.filter((p) => !p.is_archived);
  if (!toArchive.length) {
    return res.json({ ok: true, archived: 0, ids: [], skipped: found.map((p) => p.id) });
  }

  const archiveAll = db.transaction(() => {
    const stmt = db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ? AND enterprise_id = ?');
    for (const p of toArchive) stmt.run(p.id, entId);
  });
  archiveAll();

  for (const p of toArchive) {
    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'project.archive',
      entityType: 'project',
      entityId: p.id,
      details: { name: p.name, code: p.code || '', bulk: true },
    });
  }

  res.json({
    ok: true,
    archived: toArchive.length,
    ids: toArchive.map((p) => p.id),
    skipped: found.filter((p) => p.is_archived).map((p) => p.id),
  });
  sseBroadcast(entId, 'project-change', { action: 'batch-archive', ids: toArchive.map((p) => p.id) }, req.user?.id);
});

router.patch('/projects/:id/unarchive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'projects.unarchive_admin_only') });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: L(req, 'common.project_missing') });
  db.prepare('UPDATE projects SET is_archived = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'unarchive' }, req.user?.id);
});

router.delete('/projects/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
  if (!isAdmin(req.user)) return res.status(403).json({ error: L(req, 'projects.delete_admin_only') });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: L(req, 'common.project_missing') });
  db.prepare('UPDATE projects SET is_active = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'delete' }, req.user?.id);
});

// === PROJECT SCOPES ===
// GET /api/projects/:id/scopes - Get all scopes for a project
router.get('/projects/:id/scopes', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: L(req, 'common.need_enterprise_login') });
  const scopes = db.prepare('SELECT * FROM project_scopes WHERE project_id = ? AND enterprise_id = ? ORDER BY name')
    .all(req.params.id, entId);
  res.json(scopes);
});

// POST /api/projects/:id/scopes - Create a scope for a project
router.post('/projects/:id/scopes', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: L(req, 'common.need_enterprise_login') });
  if (!canEditProject(req.user, req.params.id)) {
    return res.status(403).json({ error: L(req, 'projects.scope_edit_forbidden') });
  }
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: L(req, 'projects.scope_name_empty') });

  const trimmedName = name.trim();
  const existing = db.prepare('SELECT id FROM project_scopes WHERE project_id = ? AND name = ? AND enterprise_id = ?').get(req.params.id, trimmedName, entId);
  if (existing) return res.status(400).json({ error: L(req, 'projects.scope_exists') });

  const result = db.prepare('INSERT INTO project_scopes (project_id, name, description, enterprise_id) VALUES (?, ?, ?, ?)')
    .run(req.params.id, trimmedName, description || '', entId);
  res.json({ id: result.lastInsertRowid });
  sseBroadcast(entId, 'project-change', { action: 'update-scopes', project_id: +req.params.id }, req.user.id);
});

// PUT /api/project-scopes/:id - Edit a project scope
router.put('/project-scopes/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: L(req, 'common.need_enterprise_login') });
  const scope = db.prepare('SELECT * FROM project_scopes WHERE id = ? AND enterprise_id = ?').get(req.params.id, entId);
  if (!scope) return res.status(404).json({ error: L(req, 'common.scope_not_found') });
  if (!canEditProject(req.user, scope.project_id)) {
    return res.status(403).json({ error: L(req, 'projects.scope_edit_forbidden') });
  }

  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: L(req, 'projects.scope_name_empty') });

  const trimmedName = name.trim();
  const existing = db.prepare('SELECT id FROM project_scopes WHERE project_id = ? AND name = ? AND enterprise_id = ? AND id != ?').get(scope.project_id, trimmedName, entId, req.params.id);
  if (existing) return res.status(400).json({ error: L(req, 'projects.scope_exists') });

  db.prepare('UPDATE project_scopes SET name = ?, description = ? WHERE id = ?')
    .run(trimmedName, description || '', req.params.id);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'update-scopes', project_id: scope.project_id }, req.user.id);
});

// DELETE /api/project-scopes/:id - Delete a project scope
router.delete('/project-scopes/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: L(req, 'common.need_enterprise_login') });
  const scope = db.prepare('SELECT * FROM project_scopes WHERE id = ? AND enterprise_id = ?').get(req.params.id, entId);
  if (!scope) return res.status(404).json({ error: L(req, 'common.scope_not_found') });
  if (!canEditProject(req.user, scope.project_id)) {
    return res.status(403).json({ error: L(req, 'projects.scope_edit_forbidden') });
  }

  // Nullify referencing bookings and timesheets, then delete scope — all in one transaction
  db.transaction(() => {
    db.prepare('UPDATE bookings SET project_scope_id = NULL WHERE project_scope_id = ?').run(req.params.id);
    db.prepare('UPDATE timesheets SET project_scope_id = NULL WHERE project_scope_id = ?').run(req.params.id);
    db.prepare('DELETE FROM project_scopes WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'update-scopes', project_id: scope.project_id }, req.user.id);
});

};
