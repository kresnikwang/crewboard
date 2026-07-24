/**
 * Bookings routes — CRUD + conflict detection + audit
 */
const { notifyAll } = require('../webhook');
const { notifyBookingCreated, notifyBookingUpdated, notifyBookingDeleted } = require('../../utils/wecom');
const { checkBookingConflicts, shouldBlockConflicts } = require('../../utils/conflicts');
const { logAudit } = require('../../utils/audit');
const { L, reqLang } = require('../../utils/server-i18n');

module.exports = function register(router, ctx) {
  const { db, authz, sseBroadcast } = ctx;

  function canBookResource(user) {
    return authz.canBookResource(user);
  }
  function canEditBooking(user, booking) {
    return authz.canEditBooking(user, booking);
  }

  // Preview conflicts without writing (optional helper for UI)
  router.post('/bookings/check-conflicts', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
    if (!canBookResource(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const { resource_id, date, end_date, hours, exclude_booking_id } = req.body;
    if (!resource_id || !date) return res.status(400).json({ error: L(req, 'bookings.missing_resource_or_date') });
    if (!authz.getResourceInEnterprise(resource_id, entId)) {
      return res.status(400).json({ error: L(req, 'common.resource_not_found') });
    }

    const result = checkBookingConflicts(db, {
      resourceId: resource_id,
      startDate: date,
      endDate: end_date || date,
      hours: hours != null ? hours : 8,
      excludeBookingId: exclude_booking_id || null,
      replaceDayHours: !!exclude_booking_id,
      lang: reqLang(req),
    });
    res.json(result);
  });

  router.get('/bookings', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.json([]);
    const { start, end, resource_id } = req.query;
    let sql = `
      SELECT b.*, r.name as resource_name, r.color as resource_color, r.team,
             p.name as project_name, COALESCE(c.color, p.color) as project_color, c.name as client_name,
             u.name as created_by_name, u.avatar as created_by_avatar, ps.name as scope_name
      FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      LEFT JOIN project_scopes ps ON b.project_scope_id = ps.id
      WHERE r.enterprise_id = ?
    `;
    const params = [entId];
    if (start) { sql += ' AND b.date >= ?'; params.push(start); }
    if (end) { sql += ' AND b.date <= ?'; params.push(end); }
    if (resource_id) { sql += ' AND b.resource_id = ?'; params.push(resource_id); }
    sql += ' ORDER BY r.name, b.date';
    res.json(db.prepare(sql).all(...params));
  });

  /** Add calendar days to YYYY-MM-DD (local). */
  function addDaysYmd(ymd, delta) {
    const d = new Date(ymd + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  /**
   * Shift many bookings by day_delta in one transaction (preserves ids + split_after).
   * Body: { ids: number[], day_delta: number, force?: boolean }
   */
  router.post('/bookings/shift', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
    if (!canBookResource(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const dayDelta = parseInt(req.body.day_delta, 10);
    const force = !!req.body.force;
    if (!ids.length) return res.status(400).json({ error: L(req, 'bookings.missing_ids') });
    if (!Number.isFinite(dayDelta) || dayDelta === 0) {
      return res.status(400).json({ error: L(req, 'bookings.bad_day_delta') });
    }

    const getBk = db.prepare(`
      SELECT b.* FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      WHERE b.id = ? AND r.enterprise_id = ?
    `);
    const bookings = [];
    for (const id of ids) {
      const b = getBk.get(id, entId);
      if (!b) return res.status(404).json({ error: L(req, 'bookings.not_found_id', { id }) });
      if (!canEditBooking(req.user, b)) {
        return res.status(403).json({ error: L(req, 'bookings.only_move_own') });
      }
      bookings.push(b);
    }

    const movingIds = new Set(bookings.map((b) => b.id));
    const planned = bookings.map((b) => ({
      ...b,
      new_date: addDaysYmd(b.date, dayDelta),
    }));

    // Duplicate: another booking (not in moving set) already on target day for same project/scope
    const dupCheck = db.prepare(`
      SELECT id FROM bookings
      WHERE resource_id = ? AND project_id = ? AND date = ?
        AND (
          (project_scope_id IS NULL AND ? IS NULL) OR project_scope_id = ?
        )
        AND id NOT IN (${ids.map(() => '?').join(',')})
      LIMIT 1
    `);
    const conflictDates = [];
    for (const p of planned) {
      const scopeId = p.project_scope_id != null ? p.project_scope_id : null;
      const hit = dupCheck.get(
        p.resource_id,
        p.project_id,
        p.new_date,
        scopeId,
        scopeId,
        ...ids
      );
      if (hit) conflictDates.push(p.new_date);
    }

    // Leave conflicts on new dates (hard block unless force)
    const leaveOn = db.prepare(
      'SELECT date FROM leave_entries WHERE resource_id = ? AND date = ? LIMIT 1'
    );
    const leaveConflicts = [];
    for (const p of planned) {
      if (leaveOn.get(p.resource_id, p.new_date)) {
        leaveConflicts.push({
          type: 'leave_conflict',
          date: p.new_date,
          message: L(req, 'bookings.leave_on_date', { date: p.new_date }),
        });
      }
    }

    if (leaveConflicts.length && !force) {
      return res.status(409).json({
        error: L(req, 'bookings.leave_conflict'),
        code: 'booking_conflict',
        reason: 'leave_conflict',
        conflicts: leaveConflicts,
      });
    }

    if (conflictDates.length) {
      const uniq = [...new Set(conflictDates)];
      return res.status(400).json({
        error: L(req, 'bookings.dup_project_schedule', { dates: uniq.slice(0, 5).join(', ') }),
        code: 'move_conflict',
        dates: uniq,
      });
    }

    const upd = db.prepare('UPDATE bookings SET date = ? WHERE id = ?');
    const run = db.transaction(() => {
      for (const p of planned) {
        upd.run(p.new_date, p.id);
      }
    });
    run();

    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'booking.shift',
      entityType: 'booking',
      entityId: ids[0],
      details: { ids, day_delta: dayDelta },
    });

    const resourceIds = [...new Set(bookings.map((b) => b.resource_id))];
    res.json({ ok: true, ids, day_delta: dayDelta, resource_ids: resourceIds });
    sseBroadcast(entId, 'schedule-change', { action: 'shift', ids, resource_ids: resourceIds }, req.user?.id);
  });

  /**
   * Delete many bookings in one transaction.
   * Body: { ids: number[] }
   */
  router.post('/bookings/batch-delete', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });
    if (!canBookResource(req.user)) return res.status(403).json({ error: L(req, 'common.forbidden') });

    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: L(req, 'bookings.missing_ids') });

    const getBk = db.prepare(`
      SELECT b.*, r.name as rname, p.name as pname FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      JOIN projects p ON b.project_id = p.id
      WHERE b.id = ? AND r.enterprise_id = ?
    `);
    const rows = [];
    for (const id of ids) {
      const b = getBk.get(id, entId);
      if (!b) return res.status(404).json({ error: L(req, 'bookings.not_found_id', { id }) });
      if (!canEditBooking(req.user, b)) {
        return res.status(403).json({ error: L(req, 'bookings.only_delete_own') });
      }
      rows.push(b);
    }

    const del = db.prepare('DELETE FROM bookings WHERE id = ?');
    const run = db.transaction(() => {
      for (const id of ids) del.run(id);
    });
    run();

    const resourceIds = [...new Set(rows.map((b) => b.resource_id))];
    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'booking.batch_delete',
      entityType: 'booking',
      entityId: ids[0],
      details: { ids, count: ids.length },
    });

    res.json({ ok: true, deleted: ids.length, ids, resource_ids: resourceIds });
    sseBroadcast(entId, 'schedule-change', { action: 'batch-delete', ids, resource_ids: resourceIds }, req.user?.id);
  });

  router.post('/bookings', (req, res) => {
    const {
      resource_id, project_id, project_scope_id, date, end_date, hours,
      is_tentative, notes, force,
    } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });

    if (!canBookResource(req.user)) {
      return res.status(403).json({ error: L(req, 'bookings.no_create_perm') });
    }

    const resource = db.prepare('SELECT id, name FROM resources WHERE id=? AND enterprise_id=?').get(resource_id, entId);
    if (!resource) return res.status(400).json({ error: L(req, 'common.resource_not_found') });
    const project = db.prepare('SELECT id, name FROM projects WHERE id=? AND enterprise_id=?').get(project_id, entId);
    if (!project) return res.status(400).json({ error: L(req, 'common.project_not_found') });

    const startDate = date;
    const endDate = end_date || date;
    const bookHours = hours || 8;
    const tentative = is_tentative ? 1 : 0;
    const bookNotes = notes || '';
    const createdBy = req.user?.id || null;
    const scopeId = project_scope_id || null;

    // Conflict detection
    const conflictResult = checkBookingConflicts(db, {
      resourceId: resource_id,
      startDate,
      endDate,
      hours: bookHours,
      lang: reqLang(req),
    });
    const gate = shouldBlockConflicts(conflictResult, { force: !!force });
    if (gate.block) {
      // Currently only leave conflicts block booking (overload is soft warning only)
      return res.status(409).json({
        error: L(req, 'bookings.leave_conflict_force'),
        code: 'booking_conflict',
        reason: gate.reason || 'leave_conflict',
        conflicts: conflictResult.conflicts,
        capacity: conflictResult.capacity,
      });
    }

    const insert = db.prepare(
      'INSERT INTO bookings (resource_id, project_id, project_scope_id, date, hours, is_tentative, notes, created_by) VALUES (?,?,?,?,?,?,?,?)'
    );
    const checkExisting = db.prepare(
      'SELECT id FROM bookings WHERE resource_id=? AND project_id=? AND date=? AND (project_scope_id = ? OR (project_scope_id IS NULL AND ? IS NULL))'
    );
    const batchInsert = db.transaction(() => {
      const d = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      const ids = [];
      while (d <= end) {
        const dateStr =
          d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0');
        if (!checkExisting.get(resource_id, project_id, dateStr, scopeId, scopeId)) {
          const result = insert.run(resource_id, project_id, scopeId, dateStr, bookHours, tentative, bookNotes, createdBy);
          ids.push(result.lastInsertRowid);
        }
        d.setDate(d.getDate() + 1);
      }
      return ids;
    });

    const ids = batchInsert();

    if (ids.length === 0) {
      return res.status(400).json({ error: L(req, 'bookings.duplicate_booking') });
    }

    const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
    notifyAll(db, entId, `新排程: ${resource.name} 在 ${rangeStr} 被安排到「${project.name}」${bookHours}h/天`);
    notifyBookingCreated(db, resource_id, project.name, startDate, endDate, bookHours, req.user?.name);

    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'booking.create',
      entityType: 'booking',
      entityId: ids[0],
      details: {
        ids,
        resource_id,
        project_id,
        project_scope_id: scopeId,
        start: startDate,
        end: endDate,
        hours: bookHours,
        forced: !!force,
        conflicts: conflictResult.conflicts,
      },
    });

    res.json({
      ids,
      id: ids[0],
      conflicts: conflictResult.conflicts,
      forced: !!force,
    });
    sseBroadcast(entId, 'schedule-change', { action: 'create', ids }, req.user?.id);
  });

  router.put('/bookings/:id', (req, res) => {
    const {
      resource_id, project_id, project_scope_id, date, hours,
      is_tentative, notes, split_after, force,
    } = req.body;
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });

    const existing = db.prepare(`
      SELECT b.* FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      WHERE b.id=? AND r.enterprise_id=?
    `).get(req.params.id, entId);
    if (!existing) return res.status(404).json({ error: L(req, 'bookings.not_found') });
    if (!canEditBooking(req.user, existing)) {
      return res.status(403).json({ error: L(req, 'bookings.only_edit_own') });
    }

    // Only update split_after if explicitly provided (visual)
    if (typeof split_after !== 'undefined' && resource_id == null && date == null) {
      db.prepare('UPDATE bookings SET split_after=? WHERE id=?')
        .run(split_after ? 1 : 0, req.params.id);
      res.json({ ok: true });
      sseBroadcast(entId, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
      return;
    }
    if (typeof split_after !== 'undefined' && hours == null && date == null && !resource_id) {
      db.prepare('UPDATE bookings SET split_after=? WHERE id=?')
        .run(split_after ? 1 : 0, req.params.id);
      res.json({ ok: true });
      sseBroadcast(entId, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
      return;
    }

    // Handle pure split_after updates (current clients only send split_after)
    if (typeof split_after !== 'undefined' && typeof resource_id === 'undefined') {
      db.prepare('UPDATE bookings SET split_after=? WHERE id=?')
        .run(split_after ? 1 : 0, req.params.id);
      res.json({ ok: true });
      sseBroadcast(entId, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
      return;
    }

    const nextResource = authz.getResourceInEnterprise(resource_id, entId);
    if (!nextResource) return res.status(400).json({ error: L(req, 'common.resource_not_found') });
    const nextProject = authz.getProjectInEnterprise(project_id, entId);
    if (!nextProject) return res.status(400).json({ error: L(req, 'common.project_not_found') });

    const conflictResult = checkBookingConflicts(db, {
      resourceId: resource_id,
      startDate: date,
      endDate: date,
      hours: hours != null ? hours : existing.hours,
      excludeBookingId: +req.params.id,
      replaceDayHours: false,
      lang: reqLang(req),
    });
    // On update: projected = other bookings that day + new hours
    // checkBookingConflicts already excludes this booking and adds hours — correct.

    const gate = shouldBlockConflicts(conflictResult, { force: !!force });
    if (gate.block) {
      // Only leave conflicts block; overload is returned as soft conflicts on success
      return res.status(409).json({
        error: L(req, 'bookings.leave_conflict'),
        code: 'booking_conflict',
        reason: gate.reason || 'leave_conflict',
        conflicts: conflictResult.conflicts,
        capacity: conflictResult.capacity,
      });
    }

    db.prepare(
      'UPDATE bookings SET resource_id=?, project_id=?, project_scope_id=?, date=?, hours=?, is_tentative=?, notes=? WHERE id=?'
    ).run(
      resource_id,
      project_id,
      project_scope_id || null,
      date,
      hours,
      is_tentative ? 1 : 0,
      notes || '',
      req.params.id
    );

    notifyAll(db, entId, `排程变更: ${nextResource.name} 在 ${date}「${nextProject.name}」已更新为${hours}小时`);
    notifyBookingUpdated(db, resource_id, nextProject.name, date, hours, req.user?.name);

    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'booking.update',
      entityType: 'booking',
      entityId: +req.params.id,
      details: {
        before: {
          resource_id: existing.resource_id,
          project_id: existing.project_id,
          date: existing.date,
          hours: existing.hours,
        },
        after: { resource_id, project_id, date, hours, project_scope_id: project_scope_id || null },
        forced: !!force,
        conflicts: conflictResult.conflicts,
      },
    });

    res.json({ ok: true, conflicts: conflictResult.conflicts, forced: !!force });
    sseBroadcast(entId, 'schedule-change', { action: 'update', id: +req.params.id }, req.user?.id);
  });

  router.delete('/bookings/:id', (req, res) => {
    const entId = req.user?.enterprise_id;
    if (!entId) return res.status(400).json({ error: L(req, 'common.need_enterprise') });

    const booking = db.prepare(`
      SELECT b.*, r.name as rname, p.name as pname FROM bookings b
      JOIN resources r ON b.resource_id=r.id
      JOIN projects p ON b.project_id=p.id
      WHERE b.id=? AND r.enterprise_id=?
    `).get(req.params.id, entId);
    if (!booking) return res.status(404).json({ error: L(req, 'bookings.not_found') });

    if (!canEditBooking(req.user, booking)) {
      return res.status(403).json({ error: L(req, 'bookings.only_delete_own') });
    }

    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    notifyAll(db, entId, `排程取消: ${booking.rname} 在 ${booking.date}「${booking.pname}」的安排已取消`);
    notifyBookingDeleted(db, booking.resource_id, booking.pname, booking.date, req.user?.name);

    logAudit(db, {
      enterpriseId: entId,
      user: req.user,
      action: 'booking.delete',
      entityType: 'booking',
      entityId: +req.params.id,
      details: {
        resource_id: booking.resource_id,
        project_id: booking.project_id,
        date: booking.date,
        hours: booking.hours,
        resource_name: booking.rname,
        project_name: booking.pname,
      },
    });

    res.json({ ok: true });
    sseBroadcast(entId, 'schedule-change', { action: 'delete', id: +req.params.id }, req.user?.id);
  });
};
