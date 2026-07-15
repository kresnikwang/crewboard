/**
 * leave.js routes
 */
const express = require('express');
const { getHoliday } = require('../../db/holidays');
const { logAudit } = require('../../utils/audit');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === LEAVE ===
router.get('/leave', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json([]);
  const { start, end, resource_id } = req.query;
  let sql = 'SELECT l.*, r.name as resource_name FROM leave_entries l JOIN resources r ON l.resource_id = r.id WHERE r.enterprise_id = ?';
  const params = [entId];
  if (start) { sql += ' AND l.date >= ?'; params.push(start); }
  if (end) { sql += ' AND l.date <= ?'; params.push(end); }
  if (resource_id) { sql += ' AND l.resource_id = ?'; params.push(resource_id); }
  res.json(db.prepare(sql).all(...params));
});

router.post('/leave', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: '仅经理及以上可登记休假' });
  const { resource_id, date, type, notes } = req.body;
  if (!authz.getResourceInEnterprise(resource_id, entId)) {
    return res.status(400).json({ error: '资源不存在或无权访问' });
  }
  const result = db.prepare('INSERT INTO leave_entries (resource_id, date, type, notes) VALUES (?,?,?,?)')
    .run(resource_id, date, type || 'vacation', notes || '');
  res.json({ id: result.lastInsertRowid });
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'leave.create',
    entityType: 'leave',
    entityId: result.lastInsertRowid,
    details: { resource_id, date, type: type || 'vacation' },
  });
  sseBroadcast(entId, 'schedule-change', { action: 'leave-create' }, req.user?.id);
});

// Batch leave creation for date ranges
router.post('/leave/batch', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: '仅经理及以上可登记休假' });
  const { resource_id, start_date, end_date, type, notes } = req.body;
  if (!resource_id || !start_date) return res.status(400).json({ error: '缺少必要参数' });
  if (!authz.getResourceInEnterprise(resource_id, entId)) {
    return res.status(400).json({ error: '资源不存在或无权访问' });
  }

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
      const day = d.getUTCDay();
      const holiday = getHoliday(dateStr);

      // 调休上班日（workday）即使是周末也要允许创建休假
      // 普通周末（非调休上班日）跳过
      const isWorkday = holiday && holiday.type === 'workday';
      const isWeekend = day === 0 || day === 6;

      if (leaveType === 'holiday' || isWorkday || !isWeekend) {
        insert.run(resource_id, dateStr, leaveType, leaveNotes);
        count++;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  });

  const count = batchInsert();
  res.json({ ok: true, count });
  sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-batch' }, req.user?.id);
});

// Book public holidays for selected resources and date range (weekdays only)
router.post('/leave/book-holidays', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: '仅经理及以上可登记休假' });
  const { resource_ids, start_date, end_date } = req.body;
  if (!resource_ids || !Array.isArray(resource_ids) || resource_ids.length === 0 || !start_date || !end_date) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  for (const rid of resource_ids) {
    if (!authz.getResourceInEnterprise(rid, entId)) {
      return res.status(400).json({ error: '资源不存在或无权访问' });
    }
  }

  const insert = db.prepare('INSERT OR IGNORE INTO leave_entries (resource_id, date, type, notes) VALUES (?,?,?,?)');
  const batchInsert = db.transaction(() => {
    let totalCount = 0;
    const holidayDates = [];

    const d = new Date(start_date);
    const end = new Date(end_date);
    while (d <= end) {
      const dateStr = d.toISOString().split('T')[0];
      const day = d.getUTCDay();
      const holiday = getHoliday(dateStr);
      const isWeekend = day === 0 || day === 6;

      // Only book official holidays that fall on Monday to Friday
      if (holiday && holiday.type === 'holiday' && !isWeekend) {
        holidayDates.push({ dateStr, name: holiday.name });
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }

    for (const rid of resource_ids) {
      for (const h of holidayDates) {
        const info = insert.run(rid, h.dateStr, 'holiday', h.name);
        totalCount += info.changes;
      }
    }
    return { totalCount, bookedHolidays: holidayDates };
  });

  const result = batchInsert();
  res.json({ ok: true, count: result.totalCount, bookedHolidays: result.bookedHolidays });
  sseBroadcast(req.user?.enterprise_id, 'schedule-change', { action: 'leave-batch' }, req.user?.id);
});

router.put('/leave/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: '仅经理及以上可编辑休假' });
  const existing = authz.getLeaveInEnterprise(req.params.id, entId);
  if (!existing) return res.status(404).json({ error: '休假记录不存在' });

  const { type, notes, date } = req.body;
  const newType = type || existing.type;
  const newNotes = notes !== undefined ? notes : existing.notes;
  const newDate = date || existing.date;

  db.prepare('UPDATE leave_entries SET type = ?, notes = ?, date = ? WHERE id = ?')
    .run(newType, newNotes, newDate, req.params.id);
  res.json({ ok: true });
  sseBroadcast(entId, 'schedule-change', { action: 'leave-update' }, req.user?.id);
});

router.delete('/leave/:id', (req, res) => {
  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '请先创建或加入企业' });
  if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: '仅经理及以上可删除休假' });
  const existing = authz.getLeaveInEnterprise(req.params.id, entId);
  if (!existing) return res.status(404).json({ error: '休假记录不存在' });
  db.prepare('DELETE FROM leave_entries WHERE id = ?').run(req.params.id);
  logAudit(db, {
    enterpriseId: entId,
    user: req.user,
    action: 'leave.delete',
    entityType: 'leave',
    entityId: +req.params.id,
    details: { resource_id: existing.resource_id, date: existing.date, type: existing.type },
  });
  res.json({ ok: true });
  sseBroadcast(entId, 'schedule-change', { action: 'leave-delete' }, req.user?.id);
});

};
