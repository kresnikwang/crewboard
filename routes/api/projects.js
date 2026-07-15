/**
 * projects.js routes
 */
const express = require('express');
const { logAudit } = require('../../utils/audit');

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
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const userRole = req.user?.role;
  if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: '仅经理及以上可添加项目' });
  const result = db.prepare('INSERT INTO projects (name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details, enterprise_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, client_id || null, color || '#8B5CF6', code || '', start_date || null, end_date || null, budget_hours || 0, hourly_rate || 0, billable != null ? (billable ? 1 : 0) : 1, details || '', entId, req.user.id);
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
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  if (!canEditProject(req.user, req.params.id)) {
    return res.status(403).json({ error: '您没有权限编辑该项目' });
  }
  const { name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details } = req.body;
  if (client_id) {
    const client = authz.getClientInEnterprise(client_id, entId);
    if (!client) return res.status(400).json({ error: '客户不存在或无权访问' });
  }
  db.prepare('UPDATE projects SET name=?, client_id=?, color=?, code=?, start_date=?, end_date=?, budget_hours=?, hourly_rate=?, billable=?, details=? WHERE id=? AND enterprise_id=?')
    .run(name, client_id, color, code || '', start_date, end_date, budget_hours, hourly_rate, billable != null ? (billable ? 1 : 0) : 1, details || '', req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'update' }, req.user?.id);
});

router.patch('/projects/:id/archive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可归档项目' });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'archive' }, req.user?.id);
});

router.patch('/projects/:id/unarchive', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可取消归档项目' });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  db.prepare('UPDATE projects SET is_archived = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'unarchive' }, req.user?.id);
});

router.delete('/projects/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可删除项目' });
  const proj = authz.getProjectInEnterprise(req.params.id, entId);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  db.prepare('UPDATE projects SET is_active = 0 WHERE id = ? AND enterprise_id = ?').run(req.params.id, entId);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'delete' }, req.user?.id);
});

// === PROJECT SCOPES ===
// GET /api/projects/:id/scopes - Get all scopes for a project
router.get('/projects/:id/scopes', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: '请先登录并创建或加入企业' });
  const scopes = db.prepare('SELECT * FROM project_scopes WHERE project_id = ? AND enterprise_id = ? ORDER BY name')
    .all(req.params.id, entId);
  res.json(scopes);
});

// POST /api/projects/:id/scopes - Create a scope for a project
router.post('/projects/:id/scopes', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: '请先登录并创建或加入企业' });
  if (!canEditProject(req.user, req.params.id)) {
    return res.status(403).json({ error: '您没有权限修改该项目的工作范围' });
  }
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: '范围名称不能为空' });

  const trimmedName = name.trim();
  const existing = db.prepare('SELECT id FROM project_scopes WHERE project_id = ? AND name = ? AND enterprise_id = ?').get(req.params.id, trimmedName, entId);
  if (existing) return res.status(400).json({ error: '该工作范围已存在' });

  const result = db.prepare('INSERT INTO project_scopes (project_id, name, description, enterprise_id) VALUES (?, ?, ?, ?)')
    .run(req.params.id, trimmedName, description || '', entId);
  res.json({ id: result.lastInsertRowid });
  sseBroadcast(entId, 'project-change', { action: 'update-scopes', project_id: +req.params.id }, req.user.id);
});

// PUT /api/project-scopes/:id - Edit a project scope
router.put('/project-scopes/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: '请先登录并创建或加入企业' });
  const scope = db.prepare('SELECT * FROM project_scopes WHERE id = ? AND enterprise_id = ?').get(req.params.id, entId);
  if (!scope) return res.status(404).json({ error: '工作范围不存在' });
  if (!canEditProject(req.user, scope.project_id)) {
    return res.status(403).json({ error: '您没有权限修改该项目的工作范围' });
  }

  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: '范围名称不能为空' });

  const trimmedName = name.trim();
  const existing = db.prepare('SELECT id FROM project_scopes WHERE project_id = ? AND name = ? AND enterprise_id = ? AND id != ?').get(scope.project_id, trimmedName, entId, req.params.id);
  if (existing) return res.status(400).json({ error: '该工作范围已存在' });

  db.prepare('UPDATE project_scopes SET name = ?, description = ? WHERE id = ?')
    .run(trimmedName, description || '', req.params.id);
  res.json({ ok: true });
  sseBroadcast(entId, 'project-change', { action: 'update-scopes', project_id: scope.project_id }, req.user.id);
});

// DELETE /api/project-scopes/:id - Delete a project scope
router.delete('/project-scopes/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(401).json({ error: '请先登录并创建或加入企业' });
  const scope = db.prepare('SELECT * FROM project_scopes WHERE id = ? AND enterprise_id = ?').get(req.params.id, entId);
  if (!scope) return res.status(404).json({ error: '工作范围不存在' });
  if (!canEditProject(req.user, scope.project_id)) {
    return res.status(403).json({ error: '您没有权限修改该项目的工作范围' });
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
