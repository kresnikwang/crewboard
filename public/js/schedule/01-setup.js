/* schedule/01-setup.js — part of schedule module (bundled into schedule.js) */
'use strict';

var state = window.state;
var api   = window.api;
var cachedApi = window.cachedApi;

/** Invalidate schedule caches and reload. Call after any booking/leave mutation.
 *  Resets the _isLoading lock so a concurrent background fetch can't block
 *  the post-mutation reload from showing the newly created booking. */
function reloadAfterMutation() {
  if (window.apiCache) {
    window.apiCache.invalidatePrefix('/api/schedule-data');
    window.apiCache.invalidatePrefix('/api/bookings');
  }
  // Force-unlock in case a background SWR revalidation is mid-flight
  if (window.loadSchedule) window.loadSchedule._isLoading = false;
  // Immediate reload after local mutations (no debounce)
  scheduleLoadSchedule({ immediate: true });
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
function scheduleLoadSchedule(opts) {
  opts = opts || {};
  var delay = opts.delay != null ? opts.delay : 280;
  if (opts.immediate) {
    if (_loadScheduleTimer) {
      clearTimeout(_loadScheduleTimer);
      _loadScheduleTimer = null;
    }
    if (typeof window.loadSchedule === 'function') window.loadSchedule();
    return;
  }
  if (_loadScheduleTimer) clearTimeout(_loadScheduleTimer);
  _loadScheduleTimer = setTimeout(function () {
    _loadScheduleTimer = null;
    if (typeof window.loadSchedule === 'function') window.loadSchedule();
  }, delay);
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
