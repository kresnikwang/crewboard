/**
 * export.js routes
 */
const express = require('express');
const ExcelJS = require('exceljs');
const { isWorkingDay } = require('../../db/holidays');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

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

  const entId = req.user?.enterprise_id;
  if (!entId) return res.status(400).json({ error: '缺少企业信息' });

  /* manager: show projects they created OR are assigned to manage */
  let projectFilter = '';
  let extraParams = [];
  if (req.user?.role === 'manager') {
    let managedIds = [];
    if (req.user.managed_project_ids) {
      try {
        managedIds = JSON.parse(req.user.managed_project_ids);
      } catch (e) {
        console.error('[export-projects] Error parsing managed_project_ids:', e);
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
    SELECT p.id, p.name, p.budget_hours, p.hourly_rate, c.name as client_name,
      COALESCE(SUM(b.hours), 0) as booked_hours,
      (SELECT COALESCE(SUM(t.hours),0) FROM timesheets t WHERE t.project_id = p.id AND t.date >= ? AND t.date <= ?) as actual_hours
    FROM projects p
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN bookings b ON p.id = b.project_id AND b.date >= ? AND b.date <= ?
    WHERE p.is_active = 1 AND p.enterprise_id = ?${projectFilter}
    GROUP BY p.id ORDER BY p.name
  `;
  const rows = db.prepare(sql).all(start, end, start, end, entId, ...extraParams);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CrewBoard';
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

  // Add Work Scopes sheet
  const ws2 = wb.addWorksheet('工作内容(Scope)明细');
  ws2.columns = [
    { header: '项目', key: 'project_name', width: 20 },
    { header: '工作内容(Scope)', key: 'scope_name', width: 25 },
    { header: '已排工时(h)', key: 'booked', width: 14 },
    { header: '实际工时(h)', key: 'actual', width: 14 },
  ];

  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };

  const scopeSql = `
    SELECT 
      p.name as project_name,
      COALESCE(ps.name, '未指定/其他') as scope_name,
      COALESCE(b.booked_hours, 0) as booked_hours,
      COALESCE(t.actual_hours, 0) as actual_hours
    FROM projects p
    LEFT JOIN (
      SELECT id, project_id, name FROM project_scopes
      UNION ALL
      SELECT NULL as id, id as project_id, '未指定/其他' as name FROM projects
    ) ps ON p.id = ps.project_id
    LEFT JOIN (
      SELECT project_id, project_scope_id, SUM(hours) as booked_hours
      FROM bookings
      WHERE date >= ? AND date <= ?
      GROUP BY project_id, project_scope_id
    ) b ON p.id = b.project_id AND (ps.id = b.project_scope_id OR (ps.id IS NULL AND b.project_scope_id IS NULL))
    LEFT JOIN (
      SELECT project_id, project_scope_id, SUM(hours) as actual_hours
      FROM timesheets
      WHERE date >= ? AND date <= ?
      GROUP BY project_id, project_scope_id
    ) t ON p.id = t.project_id AND (ps.id = t.project_scope_id OR (ps.id IS NULL AND t.project_scope_id IS NULL))
    WHERE p.is_active = 1 AND p.enterprise_id = ?${projectFilter}
    GROUP BY p.id, ps.id
    HAVING booked_hours > 0 OR actual_hours > 0
    ORDER BY p.name, scope_name
  `;
  const scopeRows = db.prepare(scopeSql).all(start, end, start, end, entId, ...extraParams);

  scopeRows.forEach(sr => {
    ws2.addRow({
      project_name: sr.project_name,
      scope_name: sr.scope_name,
      booked: sr.booked_hours,
      actual: sr.actual_hours
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=projects_${start}_${end}.xlsx`);
  await wb.xlsx.write(res);
});

};
