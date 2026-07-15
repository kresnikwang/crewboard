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
  window.loadSchedule();
}

/* ---- cached bookings & leave used by edit lookup ---- */
var _allBookings = [];
var _allLeave    = [];
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
