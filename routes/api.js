const express = require('express');
const ExcelJS = require('exceljs');
const { holidays, getHoliday, isWorkingDay } = require('../db/holidays');
const { notifyAll } = require('./webhook');
const { notifyBookingCreated, notifyBookingUpdated, notifyBookingDeleted, getDepartmentUsers, getRuntimeWeComConfig, validateWeComConfig, normalizeEmail, sendTextMessage, sendCardMessage } = require('../utils/wecom');
const router = express.Router();

// --------------- SSE Connection Pool ---------------
// Map<enterpriseId, Set<{res, userId}>>
const _sseClients = new Map();

function sseAddClient(enterpriseId, userId, res) {
  if (!_sseClients.has(enterpriseId)) _sseClients.set(enterpriseId, new Set());
  const client = { res, userId };
  _sseClients.get(enterpriseId).add(client);
  res.on('close', () => {
    const pool = _sseClients.get(enterpriseId);
    if (pool) { pool.delete(client); if (pool.size === 0) _sseClients.delete(enterpriseId); }
  });
}

/**
 * Broadcast an SSE event to all connected clients in an enterprise.
 * @param {number} enterpriseId
 * @param {string} event - event name (e.g. 'schedule-change')
 * @param {object} data  - JSON payload
 * @param {number} [excludeUserId] - skip this user (the one who made the change)
 */
function sseBroadcast(enterpriseId, event, data, excludeUserId) {
  const pool = _sseClients.get(enterpriseId);
  if (!pool || pool.size === 0) return;
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  pool.forEach(client => {
    if (excludeUserId && client.userId === excludeUserId) return;
    try { client.res.write(payload); } catch (_) { /* dead connection */ }
  });
}

module.exports = function(db) {

  // === CURRENT USER PERMISSIONS (effective) ===
  // New three-role model: basic (read-only) | manager (create+edit own) | admin (full access)
  router.get('/permissions', (req, res) => {
    const u = req.user;
    if (!u) return res.json({ role: 'basic', can_book: false, can_manage: false, can_view_reports: false, can_admin: false, resource_id: null });
    const role = u.role; // 'basic' | 'manager' | 'admin'
    const isAdmin = role === 'admin';
    const isManager = role === 'manager';
    res.json({
      role,
      can_book: isAdmin || isManager,           // can create/edit bookings
      can_manage: isAdmin,                       // can manage resources (full CRUD)
      can_manage_projects: isAdmin || isManager, // can manage projects/clients
      can_view_reports: isAdmin || isManager,    // can view reports
      can_admin: isAdmin,                        // can manage users and enterprise settings
      resource_id: u.resource_id,
      // Legacy aliases for backward compat with old vanilla frontend
      book_others: isAdmin || isManager,
      manage_resources: isAdmin,
      manage_projects: isAdmin || isManager,
      view_reports: isAdmin || isManager,
    });
  });

  // === HOLIDAYS ===
  router.get('/holidays', (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.json(holidays);
    const result = {};
    const d = new Date(start);
    const endDate = new Date(end);
    while (d <= endDate) {
      const dateStr = d.toISOString().split('T')[0];
      const h = getHoliday(dateStr);
      if (h) result[dateStr] = h;
      d.setDate(d.getDate() + 1);
    }
    res.json(result);
  });

  // === RESOURCES ===
  router.get('/resources', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.json([]);
    // LEFT JOIN users to include linked account info (matched by email)
    const resources = db.prepare(`
      SELECT r.*,
             u.id        AS user_id,
             u.phone     AS user_phone,
             u.role      AS user_role,
             u.status    AS user_status,
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
    const { name, email, role, team, color, hours_per_day } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可添加人员' });
    const stmt = db.prepare('INSERT INTO resources (name, email, role, team, color, hours_per_day, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, email || null, role || '', team || '', color || '#4F46E5', hours_per_day || 8, entId);
    res.json({ id: result.lastInsertRowid });
    sseBroadcast(req.user?.enterprise_id, 'resource-change', { action: 'create' }, req.user?.id);
  });

  router.put('/resources/:id', (req, res) => {
    const { name, email, role, team, color, hours_per_day } = req.body;
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可编辑人员' });
    db.prepare('UPDATE resources SET name=?, email=?, role=?, team=?, color=?, hours_per_day=? WHERE id=?')
      .run(name, email, role, team, color, hours_per_day, req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'resource-change', { action: 'update' }, req.user?.id);
  });

  router.delete('/resources/:id', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可删除人员' });
    db.prepare('UPDATE resources SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'resource-change', { action: 'delete' }, req.user?.id);
  });

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
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
    const userRole = req.user?.role;
    if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: '仅经理及以上可添加客户' });
    const result = db.prepare('INSERT INTO clients (name, color, details, enterprise_id, created_by) VALUES (?, ?, ?, ?, ?)').run(name, color || '#6366F1', details || '', entId, req.user.id);
    res.json({ id: result.lastInsertRowid });
  });

  router.put('/clients/:id', (req, res) => {
    const { name, color, details } = req.body;
    const userRole = req.user?.role;
    if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: '仅经理及以上可编辑客户' });
    if (userRole === 'manager') {
      const client = db.prepare('SELECT created_by FROM clients WHERE id=?').get(req.params.id);
      if (client && client.created_by !== req.user.id) return res.status(403).json({ error: '经理只能编辑自己创建的客户' });
    }
    db.prepare('UPDATE clients SET name=?, color=?, details=? WHERE id=?')
      .run(name, color || '#6366F1', details || '', req.params.id);
    res.json({ ok: true });
  });

  router.patch('/clients/:id/archive', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可归档客户' });
    db.prepare('UPDATE clients SET is_archived = 1 WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE projects SET is_archived = 1 WHERE client_id = ? AND is_active = 1').run(req.params.id);
    res.json({ ok: true });
  });

  router.patch('/clients/:id/unarchive', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可取消归档客户' });
    db.prepare('UPDATE clients SET is_archived = 0 WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE projects SET is_archived = 0 WHERE client_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.delete('/clients/:id', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可删除客户' });
    db.prepare('UPDATE clients SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // === PROJECTS ===
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
    sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'create' }, req.user?.id);
  });

  router.put('/projects/:id', (req, res) => {
    const { name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details } = req.body;
    const userRole = req.user?.role;
    if (userRole !== 'admin' && userRole !== 'manager') return res.status(403).json({ error: '仅经理及以上可编辑项目' });
    if (userRole === 'manager') {
      const proj = db.prepare('SELECT created_by FROM projects WHERE id=?').get(req.params.id);
      if (proj && proj.created_by !== req.user.id) return res.status(403).json({ error: '经理只能编辑自己创建的项目' });
    }
    db.prepare('UPDATE projects SET name=?, client_id=?, color=?, code=?, start_date=?, end_date=?, budget_hours=?, hourly_rate=?, billable=?, details=? WHERE id=?')
      .run(name, client_id, color, code || '', start_date, end_date, budget_hours, hourly_rate, billable != null ? (billable ? 1 : 0) : 1, details || '', req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'update' }, req.user?.id);
  });

  router.patch('/projects/:id/archive', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可归档项目' });
    db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'archive' }, req.user?.id);
  });

  router.patch('/projects/:id/unarchive', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可取消归档项目' });
    db.prepare('UPDATE projects SET is_archived = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'unarchive' }, req.user?.id);
  });

  router.delete('/projects/:id', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可删除项目' });
    db.prepare('UPDATE projects SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'project-change', { action: 'delete' }, req.user?.id);
  });

  // === SCHEDULE DATA AGGREGATION (performance optimization) ===
  // Returns resources + bookings + leave + holidays in a single request
  router.get('/schedule-data', (req, res) => {
    const { start, end } = req.query;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.json({ resources: [], bookings: [], leave: [], holidays: {} });
    if (!start || !end) return res.status(400).json({ error: '缺少日期参数' });

    /* Resources */
    const resources = db.prepare(
      'SELECT * FROM resources WHERE is_active = 1 AND enterprise_id = ? ORDER BY team, name'
    ).all(entId);

    /* Bookings with joined names */
    const bookings = db.prepare(`
      SELECT b.*, r.name as resource_name, r.color as resource_color, r.team,
             p.name as project_name, COALESCE(c.color, p.color) as project_color, c.name as client_name,
             u.name as created_by_name
      FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE r.enterprise_id = ? AND b.date >= ? AND b.date <= ?
      ORDER BY r.name, b.date
    `).all(entId, start, end);

    /* Leave entries */
    const leave = db.prepare(`
      SELECT l.*, r.name as resource_name
      FROM leave_entries l
      JOIN resources r ON l.resource_id = r.id
      WHERE r.enterprise_id = ? AND l.date >= ? AND l.date <= ?
    `).all(entId, start, end);

    /* Holidays */
    const holidayResult = {};
    const d = new Date(start);
    const endDate = new Date(end);
    while (d <= endDate) {
      const dateStr = d.toISOString().split('T')[0];
      const h = getHoliday(dateStr);
      if (h) holidayResult[dateStr] = h;
      d.setDate(d.getDate() + 1);
    }

    res.json({ resources, bookings, leave, holidays: holidayResult });
  });

  // === BOOKINGS ===

  // Permission helper: can this user create/edit bookings?
  // admin: full access | manager: can book for anyone | basic: read-only
  function canBookResource(user, resourceId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return true;
    // basic: can only log their own timesheets, not bookings
    return false;
  }

  // Permission helper: can this user edit/delete a specific booking?
  // admin: yes | manager: only own created bookings | basic: no
  function canEditBooking(user, booking) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') {
      // Manager can only edit bookings they created
      return booking.created_by === user.id;
    }
    return false;
  }

  router.get('/bookings', (req, res) => {
    const { start, end, resource_id } = req.query;
    let sql = `
      SELECT b.*, r.name as resource_name, r.color as resource_color, r.team,
             p.name as project_name, COALESCE(c.color, p.color) as project_color, c.name as client_name,
             u.name as created_by_name
      FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (start) { sql += ' AND b.date >= ?'; params.push(start); }
    if (end) { sql += ' AND b.date <= ?'; params.push(end); }
    if (resource_id) { sql += ' AND b.resource_id = ?'; params.push(resource_id); }
    sql += ' ORDER BY r.name, b.date';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/bookings', (req, res) => {
    console.log('[DEBUG-POST-BOOKING] Received body:', req.body, 'user:', req.user?.id);
    const { resource_id, project_id, date, end_date, hours, is_tentative, notes } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });

    if (!canBookResource(req.user, resource_id)) {
      return res.status(403).json({ error: '您没有创建排程的权限' });
    }

    // Validate resource and project belong to current enterprise
    const resource = db.prepare('SELECT id FROM resources WHERE id=? AND enterprise_id=?').get(resource_id, entId);
    if (!resource) return res.status(400).json({ error: '资源不存在或无权访问' });
    const project = db.prepare('SELECT id FROM projects WHERE id=? AND enterprise_id=?').get(project_id, entId);
    if (!project) return res.status(400).json({ error: '项目不存在或无权访问' });

    const startDate = date;
    const endDate = end_date || date;
    const bookHours = hours || 8;
    const tentative = is_tentative ? 1 : 0;
    const bookNotes = notes || '';
    const createdBy = req.user?.id || null;

    const insert = db.prepare('INSERT INTO bookings (resource_id, project_id, date, hours, is_tentative, notes, created_by) VALUES (?,?,?,?,?,?,?)');
    const checkExisting = db.prepare('SELECT id FROM bookings WHERE resource_id=? AND project_id=? AND date=?');
    const batchInsert = db.transaction(() => {
      const d = new Date(startDate);
      const end = new Date(endDate);
      const ids = [];
      while (d <= end) {
        const dateStr = d.toISOString().split('T')[0];
        if (!checkExisting.get(resource_id, project_id, dateStr)) {
          const result = insert.run(resource_id, project_id, dateStr, bookHours, tentative, bookNotes, createdBy);
          ids.push(result.lastInsertRowid);
        }
        d.setDate(d.getDate() + 1);
      }
      return ids;
    });

    const ids = batchInsert();

    if (ids.length === 0) {
      return res.status(400).json({ error: '所选日期已存在该项目的排程，无需重复创建' });
    }

    // Webhook notification
    const r = db.prepare('SELECT name FROM resources WHERE id=?').get(resource_id);
    const p = db.prepare('SELECT name FROM projects WHERE id=?').get(project_id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && r && p) {
      const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
      notifyAll(db, enterpriseId, `新排程: ${r.name} 在 ${rangeStr} 被安排到「${p.name}」${bookHours}h/天`);
      // WeCom individual notification
      notifyBookingCreated(db, resource_id, p.name, startDate, endDate, bookHours, req.user?.name);
    }
    res.json({ ids, id: ids[0] });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'create', ids }, req.user?.id);
  });

  router.put('/bookings/:id', (req, res) => {
    const { resource_id, project_id, date, hours, is_tentative, notes, split_after } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });

    const existing = db.prepare(`
      SELECT b.* FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      WHERE b.id=? AND r.enterprise_id=?
    `).get(req.params.id, entId);
    if (!existing) return res.status(404).json({ error: '预订不存在' });
    if (!canEditBooking(req.user, existing)) {
      return res.status(403).json({ error: '您只能编辑自己创建的排程' });
    }

    // Only update split_after if explicitly provided
    if (typeof split_after !== 'undefined') {
      db.prepare('UPDATE bookings SET split_after=? WHERE id=?')
        .run(split_after ? 1 : 0, req.params.id);
      // For split_after update, skip notification as it's a visual change only
      res.json({ ok: true });
      sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
      return;
    }

    db.prepare('UPDATE bookings SET resource_id=?, project_id=?, date=?, hours=?, is_tentative=?, notes=? WHERE id=?')
      .run(resource_id, project_id, date, hours, is_tentative ? 1 : 0, notes || '', req.params.id);

    const r = db.prepare('SELECT name FROM resources WHERE id=?').get(resource_id);
    const p = db.prepare('SELECT name FROM projects WHERE id=?').get(project_id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && r && p) {
      notifyAll(db, enterpriseId, `排程变更: ${r.name} 在 ${date}「${p.name}」已更新为${hours}小时`);
      notifyBookingUpdated(db, resource_id, p.name, date, hours, req.user?.name);
    }
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
  });

  router.delete('/bookings/:id', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });

    const booking = db.prepare(`
      SELECT b.*, r.name as rname, p.name as pname FROM bookings b
      JOIN resources r ON b.resource_id=r.id
      JOIN projects p ON b.project_id=p.id
      WHERE b.id=? AND r.enterprise_id=?
    `).get(req.params.id, entId);
    if (!booking) return res.status(404).json({ error: '预订不存在' });

    if (!canEditBooking(req.user, booking)) {
      return res.status(403).json({ error: '您只能删除自己创建的排程' });
    }

    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && booking) {
      notifyAll(db, enterpriseId, `排程取消: ${booking.rname} 在 ${booking.date}「${booking.pname}」的安排已取消`);
      notifyBookingDeleted(db, booking.resource_id, booking.pname, booking.date, req.user?.name);
    }
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'delete', id: +req.params.id }, req.user?.id);
  });

  // === TIMESHEETS ===
  router.get('/timesheets', (req, res) => {
    const { start, end, resource_id, status } = req.query;
    let sql = `
      SELECT t.*, r.name as resource_name, p.name as project_name, COALESCE(c.color, p.color) as project_color
      FROM timesheets t
      JOIN resources r ON t.resource_id = r.id
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (start) { sql += ' AND t.date >= ?'; params.push(start); }
    if (end) { sql += ' AND t.date <= ?'; params.push(end); }
    if (resource_id) { sql += ' AND t.resource_id = ?'; params.push(resource_id); }
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    sql += ' ORDER BY t.date DESC';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/timesheets', (req, res) => {
    const { resource_id, project_id, date, hours, notes, status } = req.body;
    const result = db.prepare('INSERT INTO timesheets (resource_id, project_id, date, hours, notes, status) VALUES (?,?,?,?,?,?)')
      .run(resource_id, project_id, date, hours, notes || '', status || 'draft');
    res.json({ id: result.lastInsertRowid });
  });

  router.put('/timesheets/:id', (req, res) => {
    const { hours, notes, status } = req.body;
    db.prepare('UPDATE timesheets SET hours=?, notes=?, status=? WHERE id=?')
      .run(hours, notes, status, req.params.id);
    res.json({ ok: true });
  });

  router.delete('/timesheets/:id', (req, res) => {
    db.prepare('DELETE FROM timesheets WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Batch upsert timesheets for a week
  router.post('/timesheets/batch', (req, res) => {
    const { entries } = req.body; // [{resource_id, project_id, date, hours, notes}]
    const insertOrUpdate = db.transaction((items) => {
      const selectStmt = db.prepare('SELECT id FROM timesheets WHERE resource_id=? AND project_id=? AND date=?');
      const updateStmt = db.prepare('UPDATE timesheets SET hours=?, notes=?, status=? WHERE id=?');
      const insertStmt = db.prepare('INSERT INTO timesheets (resource_id, project_id, date, hours, notes, status) VALUES (?,?,?,?,?,?)');

      for (const e of items) {
        // Check if entry exists
        const existing = selectStmt.get(e.resource_id, e.project_id, e.date);
        if (existing) {
          updateStmt.run(e.hours, e.notes || '', e.status || 'draft', existing.id);
        } else if (e.hours > 0) {
          insertStmt.run(e.resource_id, e.project_id, e.date, e.hours, e.notes || '', e.status || 'draft');
        }
      }
    });
    insertOrUpdate(entries);
    res.json({ ok: true });
  });

  // Sync timesheets from bookings for a given week (auto-fill empty cells only)
  // POST /api/timesheets/sync-from-bookings
  // Body: { resource_id, start, end }
  // Returns: { synced: N, skipped: N, entries: [...] }
  router.post('/timesheets/sync-from-bookings', (req, res) => {
    const { resource_id, start, end } = req.body;
    if (!resource_id || !start || !end) {
      return res.status(400).json({ error: 'resource_id, start, end required' });
    }

    // 1. Aggregate bookings for this resource in the week (group by project+date)
    const bookings = db.prepare(`
      SELECT project_id, date, SUM(hours) as hours
      FROM bookings
      WHERE resource_id = ? AND date >= ? AND date <= ?
      GROUP BY project_id, date
    `).all(resource_id, start, end);

    if (!bookings.length) {
      return res.json({ synced: 0, skipped: 0, entries: [] });
    }

    // 2. Get existing timesheet entries for this resource/week
    const existing = db.prepare(`
      SELECT project_id, date, hours, source
      FROM timesheets
      WHERE resource_id = ? AND date >= ? AND date <= ?
    `).all(resource_id, start, end);

    // Build a set of already-filled cells (project_id + date)
    const filledKeys = new Set();
    existing.forEach(e => filledKeys.add(e.project_id + '_' + e.date));

    // 3. Insert only empty cells from bookings
    let synced = 0;
    let skipped = 0;
    const insertStmt = db.prepare(
      `INSERT INTO timesheets (resource_id, project_id, date, hours, notes, status, source)
       VALUES (?, ?, ?, ?, '', 'draft', 'booking')`
    );

    const syncTx = db.transaction(() => {
      for (const b of bookings) {
        const key = b.project_id + '_' + b.date;
        if (filledKeys.has(key)) {
          skipped++;
        } else {
          insertStmt.run(resource_id, b.project_id, b.date, b.hours);
          synced++;
        }
      }
    });
    syncTx();

    // 4. Return the full updated timesheet entries for the week
    const updated = db.prepare(`
      SELECT t.*, p.name as project_name, COALESCE(c.color, p.color) as project_color
      FROM timesheets t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE t.resource_id = ? AND t.date >= ? AND t.date <= ?
      ORDER BY t.date
    `).all(resource_id, start, end);

    res.json({ synced, skipped, entries: updated });
  });

  // === REPORTS ===
  router.get('/reports/utilization', (req, res) => {
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
    if (req.user?.role === 'basic') return res.status(403).json({ error: '您没有查看报表的权限' });
    /* manager: only show projects they created */
    let projectFilter = '';
    let extraParams = [];
    if (req.user?.role === 'manager') {
      projectFilter = ' AND p.created_by = ?';
      extraParams = [req.user.id];
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
    const sql = `
      SELECT p.id, p.name, p.color, c.name as client_name,
        COALESCE(SUM(b.hours), 0) as booked_hours,
        (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.resource_id=? AND t.project_id=p.id AND t.date>=? AND t.date<=?) as actual_hours
      FROM bookings b
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE b.resource_id=? AND b.date>=? AND b.date<=?
      GROUP BY p.id ORDER BY booked_hours DESC
    `;
    res.json(db.prepare(sql).all(resource_id, start, end, resource_id, start, end));
  });

  // === DRILL-DOWN: project -> members ===
  router.get('/reports/project-drill', (req, res) => {
    const { project_id, start, end } = req.query;
    const entId = req.user?.enterprise_id;
    if (!entId || !project_id) return res.json([]);
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

  // === LEAVE ===
  router.get('/leave', (req, res) => {
    const { start, end, resource_id } = req.query;
    const entId = req.user?.enterprise_id;
    let sql = 'SELECT l.*, r.name as resource_name FROM leave_entries l JOIN resources r ON l.resource_id = r.id WHERE 1=1';
    const params = [];
    if (entId) { sql += ' AND r.enterprise_id = ?'; params.push(entId); }
    if (start) { sql += ' AND l.date >= ?'; params.push(start); }
    if (end) { sql += ' AND l.date <= ?'; params.push(end); }
    if (resource_id) { sql += ' AND l.resource_id = ?'; params.push(resource_id); }
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/leave', (req, res) => {
    const { resource_id, date, type, notes } = req.body;
    const result = db.prepare('INSERT INTO leave_entries (resource_id, date, type, notes) VALUES (?,?,?,?)')
      .run(resource_id, date, type || 'vacation', notes || '');
    res.json({ id: result.lastInsertRowid });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-create' }, req.user?.id);
  });

  // Batch leave creation for date ranges
  router.post('/leave/batch', (req, res) => {
    const { resource_id, start_date, end_date, type, notes } = req.body;
    if (!resource_id || !start_date) return res.status(400).json({ error: '缺少必要参数' });

    const endDate = end_date || start_date;
    const leaveType = type || 'vacation';
    const leaveNotes = notes || '';

    const insert = db.prepare('INSERT OR IGNORE INTO leave_entries (resource_id, date, type, notes) VALUES (?,?,?,?)');
    const batchInsert = db.transaction(() => {
      const d = new Date(start_date);
      const end = new Date(endDate);
      let count = 0;
      while (d <= end) {
        const dateStr = d.toISOString().split('T')[0];
        const day = d.getDay();
        const holiday = getHoliday(dateStr);

        // 调休上班日（workday）即使是周末也要允许创建休假
        // 普通周末（非调休上班日）跳过
        const isWorkday = holiday && holiday.type === 'workday';
        const isWeekend = day === 0 || day === 6;

        if (leaveType === 'holiday' || isWorkday || !isWeekend) {
          insert.run(resource_id, dateStr, leaveType, leaveNotes);
          count++;
        }
        d.setDate(d.getDate() + 1);
      }
      return count;
    });

    const count = batchInsert();
    res.json({ ok: true, count });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-batch' }, req.user?.id);
  });

  router.put('/leave/:id', (req, res) => {
    const { type, notes, date } = req.body;
    const existing = db.prepare('SELECT * FROM leave_entries WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '休假记录不存在' });

    const newType = type || existing.type;
    const newNotes = notes !== undefined ? notes : existing.notes;
    const newDate = date || existing.date;

    db.prepare('UPDATE leave_entries SET type = ?, notes = ?, date = ? WHERE id = ?')
      .run(newType, newNotes, newDate, req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-update' }, req.user?.id);
  });

  router.delete('/leave/:id', (req, res) => {
    db.prepare('DELETE FROM leave_entries WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
    sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-delete' }, req.user?.id);
  });

  // === WECOM SYNC ===

  // Fetch WeCom department users and auto-match by name
  router.post('/wecom/sync', async (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: '仅管理员可操作' });

    const config = getRuntimeWeComConfig(db, req.user.enterprise_id);
    const configCheck = validateWeComConfig(config);
    if (!configCheck.ok) {
      return res.status(400).json({ error: configCheck.error, code: 'config_missing' });
    }

    const wecomResult = await getDepartmentUsers(config, config.departmentId);
    if (!wecomResult.ok) {
      const status = wecomResult.errcode === 60020 ? 400 : 500;
      return res.status(status).json({
        error: wecomResult.error || '无法获取企业微信通讯录',
        code: wecomResult.errcode || 'wecom_sync_failed',
        details: wecomResult.raw || null,
        ip_hint: wecomResult.errcode === 60020 ? '请把当前服务器出口 IP 加入企业微信应用的可信 IP 白名单' : ''
      });
    }

    const wecomUsers = wecomResult.users || [];
    if (wecomUsers.length === 0) {
      return res.status(400).json({ error: '企业微信通讯录为空，或应用无权访问当前部门成员', code: 'empty_department_users' });
    }

    const resources = db.prepare('SELECT id, name, email FROM resources WHERE enterprise_id = ? AND is_active = 1').all(req.user.enterprise_id);
    const matched = [];
    const unmatched = [];

    const update = db.prepare('UPDATE resources SET wecom_userid = ? WHERE id = ?');
    const tx = db.transaction(() => {
      resources.forEach(r => {
        const resourceEmail = normalizeEmail(r.email);
        const foundByEmail = resourceEmail
          ? wecomUsers.find(wu => Array.isArray(wu.email_candidates) && wu.email_candidates.includes(resourceEmail))
          : null;
        const foundByName = wecomUsers.find(wu => wu.name === r.name);
        const found = foundByEmail || foundByName;
        if (found) {
          update.run(found.userid, r.id);
          matched.push({
            resource: r.name,
            wecom_userid: found.userid,
            matched_by: foundByEmail ? 'email' : 'name'
          });
        } else {
          unmatched.push({ resource: r.name, id: r.id, email: r.email || '' });
        }
      });
    });
    tx();

    res.json({
      ok: true,
      department_id: config.departmentId,
      matched,
      unmatched,
      wecom_users: wecomUsers.map(u => ({ userid: u.userid, name: u.name, email: u.email || '', email_candidates: u.email_candidates || [] }))
    });
  });

  router.post('/wecom/test-message', async (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: '仅管理员可操作' });

    const resourceId = parseInt(req.body.resource_id, 10);
    const messageType = String(req.body.message_type || 'schedule_created').trim();
    if (!resourceId) return res.status(400).json({ error: '请选择员工', code: 'resource_required' });

    const config = getRuntimeWeComConfig(db, req.user.enterprise_id);
    const configCheck = validateWeComConfig(config);
    if (!configCheck.ok) {
      return res.status(400).json({ error: configCheck.error, code: 'config_missing' });
    }

    const resource = db.prepare(`
      SELECT id, name, email, wecom_userid
      FROM resources
      WHERE id = ? AND enterprise_id = ? AND is_active = 1
    `).get(resourceId, req.user.enterprise_id);

    if (!resource) {
      return res.status(404).json({ error: '员工不存在', code: 'resource_not_found' });
    }
    if (!resource.wecom_userid) {
      return res.status(400).json({ error: '该员工尚未绑定企业微信 ID，请先完成通讯录同步或手动绑定', code: 'wecom_userid_missing' });
    }

    const messageFactories = {
      schedule_created: function () {
        return {
          label: '排班创建通知',
          sender: function () {
            return sendTextMessage(config, resource.wecom_userid, [
              '📋 排班通知（测试）',
              `员工：${resource.name}`,
              '项目：企业微信应用消息测试',
              '时间：2026-04-20 ~ 2026-04-22（3天）',
              '工时：8h/天',
              `操作人：${req.user.name || '系统管理员'}`
            ].join('\n'));
          }
        };
      },
      schedule_updated: function () {
        return {
          label: '排班变更通知',
          sender: function () {
            return sendTextMessage(config, resource.wecom_userid, [
              '✏️ 排班变更通知（测试）',
              `员工：${resource.name}`,
              '项目：企业微信应用消息测试',
              '日期：2026-04-21',
              '工时：6h',
              `操作人：${req.user.name || '系统管理员'}`
            ].join('\n'));
          }
        };
      },
      schedule_deleted: function () {
        return {
          label: '排班取消通知',
          sender: function () {
            return sendTextMessage(config, resource.wecom_userid, [
              '🗑️ 排班取消通知（测试）',
              `员工：${resource.name}`,
              '项目：企业微信应用消息测试',
              '日期：2026-04-22',
              `操作人：${req.user.name || '系统管理员'}`
            ].join('\n'));
          }
        };
      },
      text_card: function () {
        return {
          label: '卡片消息',
          sender: function () {
            return sendCardMessage(
              config,
              resource.wecom_userid,
              '企业微信应用消息测试',
              `员工：${resource.name}<br/>类型：卡片消息<br/>发送人：${req.user.name || '系统管理员'}<br/>这是一条用于验证应用消息链路的测试消息。`,
              'https://resource.skandstudio.com'
            );
          }
        };
      }
    };

    const factory = messageFactories[messageType];
    if (!factory) {
      return res.status(400).json({ error: '不支持的测试消息类型', code: 'message_type_invalid' });
    }

    const message = factory();
    const sendResult = await message.sender();
    if (!sendResult.ok) {
      return res.status(400).json({
        error: sendResult.error || '发送测试消息失败',
        code: sendResult.errcode || 'wecom_test_send_failed',
        details: sendResult.raw || null
      });
    }

    res.json({
      ok: true,
      resource: {
        id: resource.id,
        name: resource.name,
        email: resource.email || '',
        wecom_userid: resource.wecom_userid
      },
      message_type: messageType,
      message_label: message.label
    });
  });

  // Manually set wecom_userid for a resource
  router.put('/resources/:id/wecom', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });

    const { wecom_userid } = req.body;
    db.prepare('UPDATE resources SET wecom_userid = ? WHERE id = ? AND enterprise_id = ?')
      .run(wecom_userid || '', req.params.id, req.user.enterprise_id);
    res.json({ ok: true });
  });

  // === EXCEL EXPORT ===
  router.get('/export/utilization', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: '缺少日期参数' });

    const sql = `
      SELECT r.id, r.name, r.role, r.team, r.hours_per_day,
        COALESCE(SUM(b.hours), 0) as booked_hours,
        (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.resource_id = r.id AND t.date >= ? AND t.date <= ?) as actual_hours
      FROM resources r
      LEFT JOIN bookings b ON r.id = b.resource_id AND b.date >= ? AND b.date <= ?
      WHERE r.is_active = 1 AND r.enterprise_id = ?
      GROUP BY r.id ORDER BY r.team, r.name
    `;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '缺少企业信息' });
    const rows = db.prepare(sql).all(start, end, start, end, entId);

    let workingDays = 0;
    const d = new Date(start);
    const endDate = new Date(end);
    while (d <= endDate) {
      if (isWorkingDay(d.toISOString().split('T')[0])) workingDays++;
      d.setDate(d.getDate() + 1);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CrewBoard';
    const ws = wb.addWorksheet('利用率报表');

    ws.columns = [
      { header: '姓名', key: 'name', width: 15 },
      { header: '角色', key: 'role', width: 15 },
      { header: '组别', key: 'team', width: 12 },
      { header: '预订工时(h)', key: 'booked', width: 14 },
      { header: '实际工时(h)', key: 'actual', width: 14 },
      { header: '可用工时(h)', key: 'capacity', width: 14 },
      { header: '利用率', key: 'util', width: 12 },
    ];

    // Style header
    ws.getRow(1).font = { bold: true, size: 12 };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

    rows.forEach(r => {
      const capacity = workingDays * r.hours_per_day;
      const util = capacity > 0 ? r.booked_hours / capacity : 0;
      ws.addRow({
        name: r.name, role: r.role, team: r.team,
        booked: r.booked_hours, actual: r.actual_hours,
        capacity, util,
      });
    });

    // Format utilization as percentage
    ws.getColumn('util').numFmt = '0%';

    // Add summary row
    const totalBooked = rows.reduce((s, r) => s + r.booked_hours, 0);
    const totalActual = rows.reduce((s, r) => s + r.actual_hours, 0);
    const totalCapacity = rows.reduce((s, r) => s + workingDays * r.hours_per_day, 0);
    const summaryRow = ws.addRow({
      name: '合计', booked: totalBooked, actual: totalActual,
      capacity: totalCapacity, util: totalCapacity > 0 ? totalBooked / totalCapacity : 0,
    });
    summaryRow.font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=utilization_${start}_${end}.xlsx`);
    await wb.xlsx.write(res);
  });

  router.get('/export/projects', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: '缺少日期参数' });

    const sql = `
      SELECT p.name, p.budget_hours, p.hourly_rate, c.name as client_name,
        COALESCE(SUM(b.hours), 0) as booked_hours,
        (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id AND t.date >= ? AND t.date <= ?) as actual_hours
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN bookings b ON p.id = b.project_id AND b.date >= ? AND b.date <= ?
      WHERE p.is_active = 1 AND p.enterprise_id = ?
      GROUP BY p.id ORDER BY p.name
    `;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '缺少企业信息' });
    const rows = db.prepare(sql).all(start, end, start, end, entId);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('项目报表');

    ws.columns = [
      { header: '项目', key: 'name', width: 20 },
      { header: '客户', key: 'client', width: 18 },
      { header: '预算工时(h)', key: 'budget', width: 14 },
      { header: '已排工时(h)', key: 'booked', width: 14 },
      { header: '实际工时(h)', key: 'actual', width: 14 },
      { header: '费率(¥/h)', key: 'rate', width: 12 },
      { header: '预算金额(¥)', key: 'budget_amount', width: 16 },
      { header: '实际金额(¥)', key: 'actual_amount', width: 16 },
      { header: '预算进度', key: 'progress', width: 12 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };

    rows.forEach(r => {
      ws.addRow({
        name: r.name, client: r.client_name || '-',
        budget: r.budget_hours, booked: r.booked_hours, actual: r.actual_hours,
        rate: r.hourly_rate,
        budget_amount: r.budget_hours * r.hourly_rate,
        actual_amount: r.actual_hours * r.hourly_rate,
        progress: r.budget_hours > 0 ? r.booked_hours / r.budget_hours : 0,
      });
    });

    ws.getColumn('rate').numFmt = '¥#,##0.00';
    ws.getColumn('budget_amount').numFmt = '¥#,##0.00';
    ws.getColumn('actual_amount').numFmt = '¥#,##0.00';
    ws.getColumn('progress').numFmt = '0%';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=projects_${start}_${end}.xlsx`);
    await wb.xlsx.write(res);
  });

  // ===== SSE Endpoint =====
  router.get('/sse', (req, res) => {
    const user = req.user;
    if (!user || !user.enterprise_id) {
      return res.status(401).json({ error: '未授权' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable nginx buffering for SSE
    });
    res.write(':ok\n\n'); // initial comment to flush headers

    sseAddClient(user.enterprise_id, user.id, res);

    // Heartbeat every 30s to keep connection alive through proxies
    const hb = setInterval(() => {
      try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); }
    }, 30000);

    req.on('close', () => clearInterval(hb));
  });

  return router;
};
