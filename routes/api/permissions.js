/**
 * permissions.js routes
 */
const express = require('express');
const { holidays, getHoliday } = require('../../db/holidays');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

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

};
