/**
 * reports.js routes
 */
const express = require('express');
const { isWorkingDay } = require('../../db/holidays');
const { L } = require('../../utils/server-i18n');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === REPORTS ===
router.get('/reports/utilization', (req, res) => {
  if (req.user?.role === 'basic') return res.status(403).json({ error: L(req, 'reports.forbidden') });
  const { start, end } = req.query;
  const sql = `
    SELECT r.id, r.name, r.role, r.team, r.color, r.hours_per_day,
      COALESCE(SUM(b.hours), 0) as booked_hours,
      (SELECT COUNT(DISTINCT b2.date) FROM bookings b2 WHERE b2.resource_id = r.id AND b2.date >= ? AND b2.date <= ?) as booked_days,
      (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.resource_id = r.id AND t.date >= ? AND t.date <= ?) as actual_hours
    FROM resources r
    LEFT JOIN bookings b ON r.id = b.resource_id AND b.date >= ? AND b.date <= ?
    WHERE r.is_active = 1 AND r.enterprise_id = ?
    GROUP BY r.id
    ORDER BY r.team, r.name
  `;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json({ data: [], working_days: 0 });
  const rows = db.prepare(sql).all(start, end, start, end, start, end, entId);

  // Calculate working days in range (respecting Chinese holidays)
  let workingDays = 0;
  const d = new Date(start);
  const endDate = new Date(end);
  while (d <= endDate) {
    const dateStr = d.toISOString().split('T')[0];
    if (isWorkingDay(dateStr)) workingDays++;
    d.setDate(d.getDate() + 1);
  }

  const result = rows.map(r => ({
    ...r,
    group: r.team,
    available_hours: workingDays * r.hours_per_day,
    capacity_hours: workingDays * r.hours_per_day,
    utilization: workingDays > 0 ? Math.round((r.booked_hours / (workingDays * r.hours_per_day)) * 100) : 0,
    actual_utilization: workingDays > 0 ? Math.round((r.actual_hours / (workingDays * r.hours_per_day)) * 100) : 0,
  }));
  const totalBooked = result.reduce((s, r) => s + r.booked_hours, 0);
  const totalAvail  = result.reduce((s, r) => s + r.available_hours, 0);
  const avgUtil = totalAvail > 0 ? Math.round(totalBooked / totalAvail * 100) : 0;
  res.json({
    data: result,
    working_days: workingDays,
    /* unified shape for front-end */
    rows: result,
    summary: {
      avg_utilization: avgUtil,
      total_booked: totalBooked,
      total_available: totalAvail,
      working_days: workingDays
    }
  });
});

router.get('/reports/projects', (req, res) => {
  const { start, end } = req.query;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);

  /* basic users: no reports access */
  if (req.user?.role === 'basic') return res.status(403).json({ error: L(req, 'reports.forbidden') });
  /* manager: show projects they created OR are assigned to manage */
  let projectFilter = '';
  let extraParams = [];
  if (req.user?.role === 'manager') {
    let managedIds = [];
    if (req.user.managed_project_ids) {
      try {
        managedIds = JSON.parse(req.user.managed_project_ids);
      } catch (e) {
        console.error('[reports-projects] Error parsing managed_project_ids:', e);
      }
    }
    if (Array.isArray(managedIds) && managedIds.length > 0) {
      projectFilter = ` AND (p.created_by = ? OR p.id IN (${managedIds.map(() => '?').join(',')}))`;
      extraParams = [req.user.id, ...managedIds];
    } else {
      projectFilter = ' AND p.created_by = ?';
      extraParams = [req.user.id];
    }
  }

  const sql = `
    SELECT p.id, p.name, p.color, p.budget_hours, p.hourly_rate, c.name as client_name,
      COALESCE(SUM(b.hours), 0) as booked_hours,
      (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id AND t.date >= ? AND t.date <= ?) as actual_hours
    FROM projects p
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN bookings b ON p.id = b.project_id AND b.date >= ? AND b.date <= ?
    WHERE p.is_active = 1 AND p.enterprise_id = ?${projectFilter}
    GROUP BY p.id
    ORDER BY p.name
  `;
  const projRows = db.prepare(sql).all(start, end, start, end, entId, ...extraParams);
  const projResult = projRows.map(r => ({
    ...r,
    client: r.client_name,
    scheduled_hours: r.booked_hours,
    progress: r.budget_hours > 0 ? Math.round(r.booked_hours / r.budget_hours * 100) : 0
  }));
  const totalBudget    = projResult.reduce((s, r) => s + (r.budget_hours || 0), 0);
  const totalScheduled = projResult.reduce((s, r) => s + (r.booked_hours || 0), 0);
  const totalActual    = projResult.reduce((s, r) => s + (r.actual_hours || 0), 0);
  res.json({
    rows: projResult,
    summary: {
      total_projects: projResult.length,
      budget_hours: totalBudget,
      scheduled_hours: totalScheduled,
      actual_hours: totalActual
    }
  });
});

// === DRILL-DOWN: resource -> projects ===
router.get('/reports/resource-drill', (req, res) => {
  const { resource_id, start, end } = req.query;
  const entId = req.user?.enterprise_id;
  if (!entId || !resource_id) return res.json([]);
  if (req.user?.role === 'basic') return res.status(403).json({ error: L(req, 'reports.forbidden') });
  if (!authz.getResourceInEnterprise(resource_id, entId)) return res.json([]);
  const sql = `
    SELECT p.id, p.name, p.color, c.name as client_name,
      COALESCE(SUM(b.hours), 0) as booked_hours,
      (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.resource_id=? AND t.project_id=p.id AND t.date>=? AND t.date<=?) as actual_hours
    FROM bookings b
    JOIN projects p ON b.project_id = p.id
    JOIN resources r ON b.resource_id = r.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE b.resource_id=? AND r.enterprise_id=? AND b.date>=? AND b.date<=?
    GROUP BY p.id ORDER BY booked_hours DESC
  `;
  res.json(db.prepare(sql).all(resource_id, start, end, resource_id, entId, start, end));
});

// === DRILL-DOWN: project -> members ===
router.get('/reports/project-drill', (req, res) => {
  const { project_id, start, end } = req.query;
  const entId = req.user?.enterprise_id;
  if (!entId || !project_id) return res.json([]);

  // Check manager permission
  if (req.user?.role === 'manager') {
    const proj = db.prepare('SELECT id, created_by FROM projects WHERE id = ? AND enterprise_id = ?').get(project_id, entId);
    if (!proj) return res.status(404).json({ error: L(req, 'common.project_not_found_simple') });
    let isAllowed = proj.created_by === req.user.id;
    if (!isAllowed && req.user.managed_project_ids) {
      try {
        const managedIds = JSON.parse(req.user.managed_project_ids);
        if (Array.isArray(managedIds) && managedIds.includes(Number(project_id))) {
          isAllowed = true;
        }
      } catch (e) {
        console.error('[project-drill-permission] Error parsing managed_project_ids:', e);
      }
    }
    if (!isAllowed) return res.status(403).json({ error: L(req, 'reports.project_forbidden') });
  }

  const sql = `
    SELECT r.id, r.name, r.role, r.team, r.color,
      COALESCE(SUM(b.hours), 0) as booked_hours,
      (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.resource_id=r.id AND t.project_id=? AND t.date>=? AND t.date<=?) as actual_hours
    FROM bookings b
    JOIN resources r ON b.resource_id = r.id
    WHERE b.project_id=? AND b.date>=? AND b.date<=? AND r.enterprise_id=?
    GROUP BY r.id ORDER BY booked_hours DESC
  `;
  res.json(db.prepare(sql).all(project_id, start, end, project_id, start, end, entId));
});

// === DRILL-DOWN: project -> scopes ===
router.get('/reports/project-scope-drill', (req, res) => {
  const { project_id, start, end } = req.query;
  const entId = req.user?.enterprise_id;
  if (!entId || !project_id) return res.json([]);

  // Check manager permission
  if (req.user?.role === 'manager') {
    const proj = db.prepare('SELECT id, created_by FROM projects WHERE id = ? AND enterprise_id = ?').get(project_id, entId);
    if (!proj) return res.status(404).json({ error: L(req, 'common.project_not_found_simple') });
    let isAllowed = proj.created_by === req.user.id;
    if (!isAllowed && req.user.managed_project_ids) {
      try {
        const managedIds = JSON.parse(req.user.managed_project_ids);
        if (Array.isArray(managedIds) && managedIds.includes(Number(project_id))) {
          isAllowed = true;
        }
      } catch (e) {
        console.error('[project-scope-drill-permission] Error parsing managed_project_ids:', e);
      }
    }
    if (!isAllowed) return res.status(403).json({ error: L(req, 'reports.project_forbidden') });
  }

  const sql = `
    SELECT 
      s.id as scope_id,
      s.name as scope_name,
      COALESCE(b.booked_hours, 0) as booked_hours,
      COALESCE(t.actual_hours, 0) as actual_hours
    FROM project_scopes s
    LEFT JOIN (
      SELECT project_scope_id, SUM(hours) as booked_hours
      FROM bookings
      WHERE project_id = ? AND date >= ? AND date <= ?
      GROUP BY project_scope_id
    ) b ON s.id = b.project_scope_id
    LEFT JOIN (
      SELECT project_scope_id, SUM(hours) as actual_hours
      FROM timesheets
      WHERE project_id = ? AND date >= ? AND date <= ?
      GROUP BY project_scope_id
    ) t ON s.id = t.project_scope_id
    WHERE s.project_id = ?

    UNION ALL

    SELECT 
      NULL as scope_id,
      ? as scope_name,
      COALESCE((SELECT SUM(hours) FROM bookings WHERE project_id = ? AND project_scope_id IS NULL AND date >= ? AND date <= ?), 0) as booked_hours,
      COALESCE((SELECT SUM(hours) FROM timesheets WHERE project_id = ? AND project_scope_id IS NULL AND date >= ? AND date <= ?), 0) as actual_hours
  `;
  const params = [
    project_id, start, end,
    project_id, start, end,
    project_id,
    L(req, 'common.unspecified_scope'),
    project_id, start, end,
    project_id, start, end
  ];
  res.json(db.prepare(sql).all(...params));
});

};
