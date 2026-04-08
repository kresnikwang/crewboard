const express = require('express');
const ExcelJS = require('exceljs');
const { holidays, getHoliday, isWorkingDay } = require('../db/holidays');
const { notifyAll } = require('./webhook');
const router = express.Router();

module.exports = function(db) {

  // === CURRENT USER PERMISSIONS (effective) ===
  router.get('/permissions', (req, res) => {
    const u = req.user;
    if (!u) return res.json({ book_others: false, manage_resources: false, view_reports: false });
    const isAdmin = u.role === 'owner' || u.role === 'admin';
    res.json({
      book_others: isAdmin || !!u.perm_book_others,
      manage_resources: isAdmin || !!u.perm_manage_resources,
      view_reports: isAdmin || !!u.perm_view_reports,
      role: u.role,
      resource_id: u.resource_id,
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
    const resources = db.prepare('SELECT * FROM resources WHERE is_active = 1 AND enterprise_id = ? ORDER BY team, name').all(entId);
    res.json(resources);
  });

  router.post('/resources', (req, res) => {
    const { name, email, role, team, color, hours_per_day } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
    const stmt = db.prepare('INSERT INTO resources (name, email, role, team, color, hours_per_day, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, email || null, role || '', team || '', color || '#4F46E5', hours_per_day || 8, entId);
    res.json({ id: result.lastInsertRowid });
  });

  router.put('/resources/:id', (req, res) => {
    const { name, email, role, team, color, hours_per_day } = req.body;
    db.prepare('UPDATE resources SET name=?, email=?, role=?, team=?, color=?, hours_per_day=? WHERE id=?')
      .run(name, email, role, team, color, hours_per_day, req.params.id);
    res.json({ ok: true });
  });

  router.delete('/resources/:id', (req, res) => {
    db.prepare('UPDATE resources SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
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
    const result = db.prepare('INSERT INTO clients (name, color, details, enterprise_id) VALUES (?, ?, ?, ?)').run(name, color || '#6366F1', details || '', entId);
    res.json({ id: result.lastInsertRowid });
  });

  router.put('/clients/:id', (req, res) => {
    const { name, color, details } = req.body;
    db.prepare('UPDATE clients SET name=?, color=?, details=? WHERE id=?')
      .run(name, color || '#6366F1', details || '', req.params.id);
    res.json({ ok: true });
  });

  router.patch('/clients/:id/archive', (req, res) => {
    db.prepare('UPDATE clients SET is_archived = 1 WHERE id = ?').run(req.params.id);
    // Also archive all projects under this client
    db.prepare('UPDATE projects SET is_archived = 1 WHERE client_id = ? AND is_active = 1').run(req.params.id);
    res.json({ ok: true });
  });

  router.patch('/clients/:id/unarchive', (req, res) => {
    db.prepare('UPDATE clients SET is_archived = 0 WHERE id = ?').run(req.params.id);
    // Also unarchive all projects under this client
    db.prepare('UPDATE projects SET is_archived = 0 WHERE client_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.delete('/clients/:id', (req, res) => {
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
    const result = db.prepare('INSERT INTO projects (name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details, enterprise_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, client_id || null, color || '#8B5CF6', code || '', start_date || null, end_date || null, budget_hours || 0, hourly_rate || 0, billable != null ? (billable ? 1 : 0) : 1, details || '', entId);
    res.json({ id: result.lastInsertRowid });
  });

  router.put('/projects/:id', (req, res) => {
    const { name, client_id, color, code, start_date, end_date, budget_hours, hourly_rate, billable, details } = req.body;
    db.prepare('UPDATE projects SET name=?, client_id=?, color=?, code=?, start_date=?, end_date=?, budget_hours=?, hourly_rate=?, billable=?, details=? WHERE id=?')
      .run(name, client_id, color, code || '', start_date, end_date, budget_hours, hourly_rate, billable != null ? (billable ? 1 : 0) : 1, details || '', req.params.id);
    res.json({ ok: true });
  });

  router.patch('/projects/:id/archive', (req, res) => {
    db.prepare('UPDATE projects SET is_archived = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.patch('/projects/:id/unarchive', (req, res) => {
    db.prepare('UPDATE projects SET is_archived = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.delete('/projects/:id', (req, res) => {
    db.prepare('UPDATE projects SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // === BOOKINGS ===

  // Permission helper: can this user book for the given resource?
  function canBookResource(user, resourceId) {
    if (!user) return false;
    // Owner & admin can always book
    if (user.role === 'owner' || user.role === 'admin') return true;
    // Member can always book their own resource
    if (user.resource_id && user.resource_id === resourceId) return true;
    // Otherwise need perm_book_others
    return !!user.perm_book_others;
  }

  router.get('/bookings', (req, res) => {
    const { start, end, resource_id } = req.query;
    let sql = `
      SELECT b.*, r.name as resource_name, r.color as resource_color, r.team,
             p.name as project_name, COALESCE(c.color, p.color) as project_color, c.name as client_name
      FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
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
    const { resource_id, project_id, date, end_date, hours, is_tentative, notes } = req.body;

    if (!canBookResource(req.user, resource_id)) {
      return res.status(403).json({ error: '您没有为他人排程的权限' });
    }

    const startDate = date;
    const endDate = end_date || date;
    const bookHours = hours || 8;
    const tentative = is_tentative ? 1 : 0;
    const bookNotes = notes || '';

    const insert = db.prepare('INSERT INTO bookings (resource_id, project_id, date, hours, is_tentative, notes) VALUES (?,?,?,?,?,?)');
    const batchInsert = db.transaction(() => {
      const d = new Date(startDate);
      const end = new Date(endDate);
      const ids = [];
      while (d <= end) {
        const dateStr = d.toISOString().split('T')[0];
        const result = insert.run(resource_id, project_id, dateStr, bookHours, tentative, bookNotes);
        ids.push(result.lastInsertRowid);
        d.setDate(d.getDate() + 1);
      }
      return ids;
    });

    const ids = batchInsert();

    // Webhook notification
    const r = db.prepare('SELECT name FROM resources WHERE id=?').get(resource_id);
    const p = db.prepare('SELECT name FROM projects WHERE id=?').get(project_id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && r && p) {
      const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
      notifyAll(db, enterpriseId, `新排程: ${r.name} 在 ${rangeStr} 被安排到「${p.name}」${bookHours}h/天`);
    }
    res.json({ ids, id: ids[0] });
  });

  router.put('/bookings/:id', (req, res) => {
    const { resource_id, project_id, date, hours, is_tentative, notes } = req.body;

    if (!canBookResource(req.user, resource_id)) {
      return res.status(403).json({ error: '您没有为他人排程的权限' });
    }

    db.prepare('UPDATE bookings SET resource_id=?, project_id=?, date=?, hours=?, is_tentative=?, notes=? WHERE id=?')
      .run(resource_id, project_id, date, hours, is_tentative ? 1 : 0, notes || '', req.params.id);

    const r = db.prepare('SELECT name FROM resources WHERE id=?').get(resource_id);
    const p = db.prepare('SELECT name FROM projects WHERE id=?').get(project_id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && r && p) {
      notifyAll(db, enterpriseId, `排程变更: ${r.name} 在 ${date}「${p.name}」已更新为${hours}小时`);
    }
    res.json({ ok: true });
  });

  router.delete('/bookings/:id', (req, res) => {
    const booking = db.prepare('SELECT b.*, r.name as rname, p.name as pname FROM bookings b JOIN resources r ON b.resource_id=r.id JOIN projects p ON b.project_id=p.id WHERE b.id=?').get(req.params.id);
    if (!booking) return res.status(404).json({ error: '预订不存在' });

    if (!canBookResource(req.user, booking.resource_id)) {
      return res.status(403).json({ error: '您没有为他人排程的权限' });
    }

    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    const enterpriseId = req.user?.enterprise_id;
    if (enterpriseId && booking) {
      notifyAll(db, enterpriseId, `排程取消: ${booking.rname} 在 ${booking.date}「${booking.pname}」的安排已取消`);
    }
    res.json({ ok: true });
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
    const upsert = db.prepare(`
      INSERT INTO timesheets (resource_id, project_id, date, hours, notes, status)
      VALUES (?, ?, ?, ?, ?, 'draft')
      ON CONFLICT(id) DO UPDATE SET hours=excluded.hours, notes=excluded.notes
    `);
    const insertOrUpdate = db.transaction((items) => {
      for (const e of items) {
        // Check if entry exists
        const existing = db.prepare('SELECT id FROM timesheets WHERE resource_id=? AND project_id=? AND date=?')
          .get(e.resource_id, e.project_id, e.date);
        if (existing) {
          db.prepare('UPDATE timesheets SET hours=?, notes=? WHERE id=?').run(e.hours, e.notes || '', existing.id);
        } else if (e.hours > 0) {
          db.prepare('INSERT INTO timesheets (resource_id, project_id, date, hours, notes, status) VALUES (?,?,?,?,?,?)')
            .run(e.resource_id, e.project_id, e.date, e.hours, e.notes || '', 'draft');
        }
      }
    });
    insertOrUpdate(entries);
    res.json({ ok: true });
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
      capacity_hours: workingDays * r.hours_per_day,
      utilization: workingDays > 0 ? Math.round((r.booked_hours / (workingDays * r.hours_per_day)) * 100) : 0,
      actual_utilization: workingDays > 0 ? Math.round((r.actual_hours / (workingDays * r.hours_per_day)) * 100) : 0,
    }));
    res.json({ data: result, working_days: workingDays });
  });

  router.get('/reports/projects', (req, res) => {
    const { start, end } = req.query;
    const sql = `
      SELECT p.id, p.name, p.color, p.budget_hours, p.hourly_rate, c.name as client_name,
        COALESCE(SUM(b.hours), 0) as booked_hours,
        (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id AND t.date >= ? AND t.date <= ?) as actual_hours
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN bookings b ON p.id = b.project_id AND b.date >= ? AND b.date <= ?
      WHERE p.is_active = 1 AND p.enterprise_id = ?
      GROUP BY p.id
      ORDER BY p.name
    `;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.json([]);
    res.json(db.prepare(sql).all(start, end, start, end, entId));
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
        // Skip weekends for normal leave types, but allow holidays on any day
        if (leaveType === 'holiday' || (day !== 0 && day !== 6)) {
          insert.run(resource_id, dateStr, leaveType, leaveNotes);
          count++;
        }
        d.setDate(d.getDate() + 1);
      }
      return count;
    });

    const count = batchInsert();
    res.json({ ok: true, count });
  });

  router.delete('/leave/:id', (req, res) => {
    db.prepare('DELETE FROM leave_entries WHERE id = ?').run(req.params.id);
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

  return router;
};
