/**
 * timesheets.js routes
 */
const express = require('express');
const { logAudit } = require('../../utils/audit');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === TIMESHEETS ===
router.get('/timesheets', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);
  const { start, end, resource_id, status } = req.query;
  let sql = `
    SELECT t.*, r.name as resource_name, p.name as project_name, COALESCE(c.color, p.color) as project_color, ps.name as scope_name
    FROM timesheets t
    JOIN resources r ON t.resource_id = r.id
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN project_scopes ps ON t.project_scope_id = ps.id
    WHERE r.enterprise_id = ?
  `;
  const params = [entId];
  // basic: only own resource
  if (!isManagerOrAdmin(req.user)) {
    if (!req.user.resource_id) return res.json([]);
    sql += ' AND t.resource_id = ?';
    params.push(req.user.resource_id);
  } else if (resource_id) {
    sql += ' AND t.resource_id = ?';
    params.push(resource_id);
  }
  if (start) { sql += ' AND t.date >= ?'; params.push(start); }
  if (end) { sql += ' AND t.date <= ?'; params.push(end); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  sql += ' ORDER BY t.date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/timesheets', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const { resource_id, project_id, project_scope_id, date, hours, notes, status } = req.body;
  if (!authz.canAccessResourceAsSelfOrElevated(req.user, resource_id)) {
    return res.status(403).json({ error: '只能为自己填报工时' });
  }
  if (!authz.getResourceInEnterprise(resource_id, entId)) {
    return res.status(400).json({ error: '资源不存在或无权访问' });
  }
  if (!authz.getProjectInEnterprise(project_id, entId)) {
    return res.status(400).json({ error: '项目不存在或无权访问' });
  }
  const result = db.prepare('INSERT INTO timesheets (resource_id, project_id, project_scope_id, date, hours, notes, status) VALUES (?,?,?,?,?,?,?)')
    .run(resource_id, project_id, project_scope_id || null, date, hours, notes || '', status || 'draft');
  res.json({ id: result.lastInsertRowid });
});

router.put('/timesheets/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const existing = authz.getTimesheetInEnterprise(req.params.id, entId);
  if (!existing) return res.status(404).json({ error: '工时记录不存在' });
  if (!authz.canAccessResourceAsSelfOrElevated(req.user, existing.resource_id)) {
    return res.status(403).json({ error: '只能编辑自己的工时' });
  }
  const { hours, notes, status, project_scope_id } = req.body;
  db.prepare('UPDATE timesheets SET hours=?, notes=?, status=?, project_scope_id=? WHERE id=?')
    .run(hours, notes, status, project_scope_id || null, req.params.id);
  res.json({ ok: true });
});

router.delete('/timesheets/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const existing = authz.getTimesheetInEnterprise(req.params.id, entId);
  if (!existing) return res.status(404).json({ error: '工时记录不存在' });
  if (!authz.canAccessResourceAsSelfOrElevated(req.user, existing.resource_id)) {
    return res.status(403).json({ error: '只能删除自己的工时' });
  }
  db.prepare('DELETE FROM timesheets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Batch upsert timesheets for a week
router.post('/timesheets/batch', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const { entries } = req.body; // [{resource_id, project_id, project_scope_id, date, hours, notes}]
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries 无效' });

  const insertOrUpdate = db.transaction((items) => {
    const selectStmt = db.prepare('SELECT id FROM timesheets WHERE resource_id=? AND project_id=? AND date=? AND (project_scope_id = ? OR (project_scope_id IS NULL AND ? IS NULL))');
    const updateStmt = db.prepare('UPDATE timesheets SET hours=?, notes=?, status=? WHERE id=?');
    const insertStmt = db.prepare('INSERT INTO timesheets (resource_id, project_id, project_scope_id, date, hours, notes, status) VALUES (?,?,?,?,?,?,?)');

    for (const e of items) {
      if (!authz.canAccessResourceAsSelfOrElevated(req.user, e.resource_id)) {
        throw new Error('FORBIDDEN_RESOURCE');
      }
      if (!authz.getResourceInEnterprise(e.resource_id, entId)) {
        throw new Error('BAD_RESOURCE');
      }
      if (!authz.getProjectInEnterprise(e.project_id, entId)) {
        throw new Error('BAD_PROJECT');
      }
      const scopeId = e.project_scope_id || null;
      const existing = selectStmt.get(e.resource_id, e.project_id, e.date, scopeId, scopeId);
      if (existing) {
        updateStmt.run(e.hours, e.notes || '', e.status || 'draft', existing.id);
      } else if (e.hours > 0) {
        insertStmt.run(e.resource_id, e.project_id, scopeId, e.date, e.hours, e.notes || '', e.status || 'draft');
      }
    }
  });
  try {
    insertOrUpdate(entries);
  } catch (e) {
    if (e.message === 'FORBIDDEN_RESOURCE') return res.status(403).json({ error: '只能为自己填报工时' });
    if (e.message === 'BAD_RESOURCE' || e.message === 'BAD_PROJECT') return res.status(400).json({ error: '资源或项目不存在' });
    throw e;
  }
  res.json({ ok: true });
});

// Sync timesheets from bookings for a given week (auto-fill empty cells only)
router.post('/timesheets/sync-from-bookings', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  const { resource_id, start, end } = req.body;
  if (!resource_id || !start || !end) {
    return res.status(400).json({ error: 'resource_id, start, end required' });
  }
  if (!authz.canAccessResourceAsSelfOrElevated(req.user, resource_id)) {
    return res.status(403).json({ error: '只能同步自己的工时' });
  }
  if (!authz.getResourceInEnterprise(resource_id, entId)) {
    return res.status(400).json({ error: '资源不存在或无权访问' });
  }

  // 1. Aggregate bookings for this resource in the week (group by project+scope+date)
  const bookings = db.prepare(`
    SELECT b.project_id, b.project_scope_id, b.date, SUM(b.hours) as hours
    FROM bookings b
    JOIN resources r ON b.resource_id = r.id
    WHERE b.resource_id = ? AND r.enterprise_id = ? AND b.date >= ? AND b.date <= ?
    GROUP BY b.project_id, b.project_scope_id, b.date
  `).all(resource_id, entId, start, end);

  if (!bookings.length) {
    return res.json({ synced: 0, skipped: 0, entries: [] });
  }

  // 2. Get existing timesheet entries for this resource/week
  const existing = db.prepare(`
    SELECT project_id, project_scope_id, date, hours, source
    FROM timesheets
    WHERE resource_id = ? AND date >= ? AND date <= ?
  `).all(resource_id, start, end);

  // Build a set of already-filled cells (project_id + scope_id + date)
  const filledKeys = new Set();
  existing.forEach(e => {
    const scopePart = e.project_scope_id ? e.project_scope_id : 'null';
    filledKeys.add(e.project_id + '_' + scopePart + '_' + e.date);
  });

  // 3. Insert only empty cells from bookings
  let synced = 0;
  let skipped = 0;
  const insertStmt = db.prepare(
    `INSERT INTO timesheets (resource_id, project_id, project_scope_id, date, hours, notes, status, source)
     VALUES (?, ?, ?, ?, ?, '', 'draft', 'booking')`
  );

  const syncTx = db.transaction(() => {
    for (const b of bookings) {
      const scopePart = b.project_scope_id ? b.project_scope_id : 'null';
      const key = b.project_id + '_' + scopePart + '_' + b.date;
      if (filledKeys.has(key)) {
        skipped++;
      } else {
        insertStmt.run(resource_id, b.project_id, b.project_scope_id || null, b.date, b.hours);
        synced++;
      }
    }
  });
  syncTx();

  // 4. Return the full updated timesheet entries for the week
  const updated = db.prepare(`
    SELECT t.*, p.name as project_name, COALESCE(c.color, p.color) as project_color, ps.name as scope_name
    FROM timesheets t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN project_scopes ps ON t.project_scope_id = ps.id
    WHERE t.resource_id = ? AND t.date >= ? AND t.date <= ?
    ORDER BY t.date
  `).all(resource_id, start, end);

  res.json({ synced, skipped, entries: updated });
});

};
