/**
 * Booking conflict detection:
 *  - leave_conflict: resource has leave on that date
 *  - overload: booked hours (incl. proposed) exceed hours_per_day
 *  - duplicate: same project+scope already booked (handled elsewhere)
 */

const { msg } = require('./server-i18n');

/**
 * Check conflicts for a date range booking on a resource.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {number} opts.resourceId
 * @param {string} opts.startDate  YYYY-MM-DD
 * @param {string} opts.endDate    YYYY-MM-DD
 * @param {number} opts.hours      hours per day being added/set
 * @param {number} [opts.excludeBookingId]  ignore this booking (on update)
 * @param {boolean} [opts.replaceDayHours]  if true, replace same-day total with opts.hours instead of adding
 * @param {'zh'|'en'} [opts.lang]  language for conflict message text (default 'zh')
 * @returns {{ ok: boolean, conflicts: Array, capacity: object }}
 */
function checkBookingConflicts(db, opts) {
  const {
    resourceId,
    startDate,
    endDate,
    hours,
    excludeBookingId = null,
    replaceDayHours = false,
    lang = 'zh',
  } = opts;

  const resource = db.prepare(
    'SELECT id, name, hours_per_day FROM resources WHERE id = ?'
  ).get(resourceId);
  if (!resource) {
    return { ok: false, conflicts: [{ type: 'not_found', message: msg(lang, 'common.resource_missing') }], capacity: {} };
  }

  const capacity = Number(resource.hours_per_day) || 8;
  const bookHours = Number(hours) || 0;
  const conflicts = [];

  const leaveStmt = db.prepare(
    'SELECT id, date, type, notes FROM leave_entries WHERE resource_id = ? AND date >= ? AND date <= ?'
  );
  const hoursStmt = excludeBookingId
    ? db.prepare(
        'SELECT date, COALESCE(SUM(hours), 0) as total FROM bookings WHERE resource_id = ? AND date >= ? AND date <= ? AND id != ? GROUP BY date'
      )
    : db.prepare(
        'SELECT date, COALESCE(SUM(hours), 0) as total FROM bookings WHERE resource_id = ? AND date >= ? AND date <= ? GROUP BY date'
      );

  const leaveRows = leaveStmt.all(resourceId, startDate, endDate);
  const leaveByDate = {};
  for (const row of leaveRows) {
    leaveByDate[row.date] = row;
    conflicts.push({
      type: 'leave_conflict',
      severity: 'error',
      date: row.date,
      leave_type: row.type,
      message: msg(lang, 'conflicts.leave_on_date', { name: resource.name, date: row.date, type: row.type || 'leave' }),
    });
  }

  const hourRows = excludeBookingId
    ? hoursStmt.all(resourceId, startDate, endDate, excludeBookingId)
    : hoursStmt.all(resourceId, startDate, endDate);
  const hoursByDate = {};
  for (const row of hourRows) {
    hoursByDate[row.date] = Number(row.total) || 0;
  }

  // Walk each day in range
  const d = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (d <= end) {
    const dateStr =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');

    const existing = hoursByDate[dateStr] || 0;
    const projected = replaceDayHours ? bookHours : existing + bookHours;

    if (projected > capacity + 1e-9) {
      const over = Math.round((projected - capacity) * 10) / 10;
      const projectedR = Math.round(projected * 10) / 10;
      const existingR = Math.round(existing * 10) / 10;
      conflicts.push({
        type: 'overload',
        severity: 'warning',
        date: dateStr,
        existing_hours: existingR,
        added_hours: bookHours,
        projected_hours: projectedR,
        capacity,
        over_hours: over,
        message: msg(lang, 'conflicts.overload', { name: resource.name, date: dateStr, projected: projectedR, capacity, over }),
      });
    }

    d.setDate(d.getDate() + 1);
  }

  const hasHardError = conflicts.some(c => c.severity === 'error' || c.type === 'leave_conflict');
  return {
    ok: !hasHardError,
    conflicts,
    capacity: {
      resource_id: resource.id,
      resource_name: resource.name,
      hours_per_day: capacity,
    },
  };
}

/**
 * Summarize whether request may proceed.
 * - leave conflicts always block unless force=true
 * - overload (over daily capacity) never blocks at booking time — still reported
 *   in result.conflicts for UI warnings (clear overage hours)
 */
function shouldBlockConflicts(result, { force = false } = {}) {
  if (!result || !result.conflicts || result.conflicts.length === 0) {
    return { block: false, reason: null };
  }
  const leave = result.conflicts.filter(c => c.type === 'leave_conflict');
  if (leave.length && !force) {
    return { block: true, reason: 'leave_conflict', conflicts: result.conflicts };
  }
  // overload: soft only — allow booking without force
  return { block: false, reason: null, conflicts: result.conflicts };
}

module.exports = {
  checkBookingConflicts,
  shouldBlockConflicts,
};
