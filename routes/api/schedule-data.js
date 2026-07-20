/**
 * schedule-data.js routes
 */
const express = require('express');
const { getHoliday } = require('../../db/holidays');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === SCHEDULE DATA AGGREGATION (performance optimization) ===
// Returns resources + bookings + leave + holidays in a single request
router.get('/schedule-data', (req, res) => {
  const { start, end } = req.query;
  const entId = req.user?.enterprise_id;
  if (!entId) return res.json({ resources: [], bookings: [], leave: [], holidays: {} });
  if (!start || !end) return res.status(400).json({ error: '缺少日期参数' });

  /* Resources */
  const resources = db.prepare(`
    SELECT r.id, r.name, r.email, r.role, r.team, r.color, r.hours_per_day, r.is_active, r.enterprise_id, r.created_at, r.wecom_userid,
           COALESCE(NULLIF(r.avatar, ''), u.avatar, '') AS avatar
    FROM resources r
    LEFT JOIN users u
      ON lower(r.email) = lower(u.email)
      AND u.enterprise_id = r.enterprise_id
      AND u.status = 'active'
    WHERE r.is_active = 1 AND r.enterprise_id = ?
    ORDER BY r.team, r.name
  `).all(entId);

  /* Bookings with joined names */
  const bookings = db.prepare(`
    SELECT b.*, r.name as resource_name, r.color as resource_color, r.team,
           p.name as project_name, COALESCE(c.color, p.color) as project_color, c.name as client_name,
           u.name as created_by_name, u.avatar as created_by_avatar, ps.name as scope_name
    FROM bookings b
    JOIN resources r ON b.resource_id = r.id
    JOIN projects p ON b.project_id = p.id
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN users u ON b.created_by = u.id
    LEFT JOIN project_scopes ps ON b.project_scope_id = ps.id
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

  /* Holidays — use local Y-M-D (toISOString is UTC and can shift the day) */
  const holidayResult = {};
  const d = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (d <= endDate) {
    const dateStr =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    const h = getHoliday(dateStr);
    if (h) holidayResult[dateStr] = h;
    d.setDate(d.getDate() + 1);
  }

  res.json({ resources, bookings, leave, holidays: holidayResult });
});

};
