/* schedule/01-setup.js — part of schedule module (bundled into schedule.js) */
'use strict';

var state = window.state;
var api   = window.api;
var cachedApi = window.cachedApi;

/**
 * Invalidate schedule caches and refresh UI after mutation.
 * @param {number|number[]|null} resourceIds - when set, patch only those resource rows
 *   (much faster than full grid rebuild). Falls back to full reload on failure.
 */
function reloadAfterMutation(resourceIds) {
  if (window.apiCache) {
    window.apiCache.invalidatePrefix('/api/schedule-data');
    window.apiCache.invalidatePrefix('/api/bookings');
  }
  scheduleLoadSchedule({ immediate: true, resourceIds: resourceIds });
}

/* ---- cached bookings & leave used by edit lookup ---- */
var _allBookings = [];
var _allLeave    = [];

/* ---- O(1) indexes for multi-tenant scale (rebuild after each load) ----
 *  _bookingById[id] = booking
 *  _bookingByResDate[resourceId][date] = booking[]
 *  _bookingsByProject[projectId] = booking[]  (for group-booking checks)
 */
var _bookingById = Object.create(null);
var _bookingByResDate = Object.create(null);
var _bookingsByProject = Object.create(null);

function rebuildBookingIndex(bookings) {
  _bookingById = Object.create(null);
  _bookingByResDate = Object.create(null);
  _bookingsByProject = Object.create(null);
  if (!bookings || !bookings.length) return;
  for (var i = 0; i < bookings.length; i++) {
    var b = bookings[i];
    _bookingById[b.id] = b;

    var rid = b.resource_id;
    if (!_bookingByResDate[rid]) _bookingByResDate[rid] = Object.create(null);
    var dmap = _bookingByResDate[rid];
    if (!dmap[b.date]) dmap[b.date] = [];
    dmap[b.date].push(b);

    var pid = b.project_id;
    if (!_bookingsByProject[pid]) _bookingsByProject[pid] = [];
    _bookingsByProject[pid].push(b);
  }
}

/** Find first booking on resource+date matching matchFn (uses index). */
function findBookingOnDate(resourceId, dateStr, matchFn) {
  var dmap = _bookingByResDate[resourceId];
  if (!dmap) return null;
  var list = dmap[dateStr];
  if (!list || !list.length) return null;
  for (var i = 0; i < list.length; i++) {
    if (matchFn(list[i])) return list[i];
  }
  return null;
}

/** Lightweight signature for SWR revalidate (avoids huge string concat). */
function scheduleDataSignature(bookings, leave) {
  var bl = bookings ? bookings.length : 0;
  var ll = leave ? leave.length : 0;
  var h = (bl * 1000003 + ll) | 0;
  var i;
  if (bookings) {
    for (i = 0; i < bookings.length; i++) {
      var b = bookings[i];
      h = (Math.imul(h, 33) + (b.id | 0) + ((b.hours * 10) | 0) * 7 +
        (b.is_tentative ? 3 : 0) + (b.split_after ? 5 : 0) +
        ((b.project_id | 0) * 11) + ((b.resource_id | 0) * 13)) | 0;
    }
  }
  if (leave) {
    for (i = 0; i < leave.length; i++) {
      h = (Math.imul(h, 33) + (leave[i].id | 0) + ((leave[i].resource_id | 0) * 17)) | 0;
    }
  }
  return String(h) + ':' + bl + ':' + ll;
}

/**
 * Debounced schedule reload — coalesces SSE storms when many tenants/users edit.
 * opts.immediate: skip debounce (local mutations).
 * opts.delay: ms (default 280 for SSE).
 */
var _loadScheduleTimer = null;
var _scheduleRefreshRunning = false;
var _pendingFullSchedule = false;
var _pendingScheduleRows = Object.create(null);
var _renderedScheduleKey = null;
var _scheduleRenderGeneration = 0;

function scheduleViewKey() {
  if (!state.scheduleWeekStart) return null;
  var start = state.scheduleWeekStart;
  var count = state.scheduleView === 'month' ? MONTH_WEEKS * 7 : 7;
  var user = state.user || {};
  return [user.id, user.enterprise_id, state.scheduleView, fmt(start), fmt(addDays(start, count - 1))].join(':');
}

function scheduleLoadSchedule(opts) {
  opts = opts || {};
  var ids = opts.resourceIds == null ? [] : (Array.isArray(opts.resourceIds) ? opts.resourceIds : [opts.resourceIds]);
  ids = ids.map(Number).filter(function (id) { return Number.isSafeInteger(id) && id > 0; });
  if (ids.length) ids.forEach(function (id) { _pendingScheduleRows[id] = true; });
  else _pendingFullSchedule = true;
  if (_loadScheduleTimer) clearTimeout(_loadScheduleTimer);
  _loadScheduleTimer = setTimeout(runScheduledRefresh, opts.immediate ? 0 : (opts.delay != null ? opts.delay : 280));
}

async function runScheduledRefresh() {
  _loadScheduleTimer = null;
  if (state.currentPage !== 'schedule') {
    _pendingFullSchedule = false;
    _pendingScheduleRows = Object.create(null);
    return;
  }
  // Retain queued IDs while a refresh is running, including events received
  // after its request started. Never let two partial responses overwrite each other.
  if (_scheduleRefreshRunning || window.loadSchedule._isLoading) {
    _loadScheduleTimer = setTimeout(runScheduledRefresh, 60);
    return;
  }
  var ids = Object.keys(_pendingScheduleRows).map(Number);
  var full = _pendingFullSchedule || !ids.length;
  _pendingFullSchedule = false;
  _pendingScheduleRows = Object.create(null);
  _scheduleRefreshRunning = true;
  try {
    if (full) {
      // A preceding partial request may have warmed a snapshot after a global
      // resource/project event invalidated it. Fetch the complete view afresh.
      if (window.apiCache) window.apiCache.invalidatePrefix('/api/schedule-data');
      await window.loadSchedule();
    } else await window.refreshScheduleRows(ids);
  } catch (err) {
    console.warn('[schedule] row refresh failed; reload current view', err);
    if (state.currentPage === 'schedule') _pendingFullSchedule = true;
  } finally {
    _scheduleRefreshRunning = false;
    if ((_pendingFullSchedule || Object.keys(_pendingScheduleRows).length) && !_loadScheduleTimer) {
      _loadScheduleTimer = setTimeout(runScheduledRefresh, 0);
    }
  }
}
window.scheduleLoadSchedule = scheduleLoadSchedule;

/* expose to window so saveBooking (outside IIFE) can access */
Object.defineProperty(window, '_allLeave', {
  get: function () { return _allLeave; },
  configurable: true
});

/* ---- view mode: 'week' or 'month' ---- */
if (!state.scheduleView) state.scheduleView = 'week';
var MONTH_WEEKS = 6; /* show 6 weeks in month view for continuous scroll */

/* --------------------------------------------------
   1. loadSchedule — main render function
   -------------------------------------------------- */
