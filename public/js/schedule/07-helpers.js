/* schedule/07-helpers.js — part of schedule module (bundled into schedule.js) */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '\u2026' : str;
}

/** Suppress the synthetic click that fires after a drag/resize mouseup. */
function suppressNextClick() {
  var active = true;
  function handler(ev) {
    if (!active) return;
    active = false;
    ev.stopPropagation();
    ev.preventDefault();
    document.removeEventListener('click', handler, true);
  }
  document.addEventListener('click', handler, true);
  setTimeout(function () {
    if (active) {
      active = false;
      document.removeEventListener('click', handler, true);
    }
  }, 400);
}

/**
 * Auto-scroll the active schedule container when the pointer is near an edge.
 * Works for week view (.schedule-grid) and month view (.month-scroll).
 */
function edgeAutoScroll(clientX, clientY) {
  var grid = document.getElementById('schedule-grid');
  if (!grid) return false;
  var scrollEl = grid.querySelector('.month-scroll') || grid;
  var rect = scrollEl.getBoundingClientRect();
  var edge = 48;
  var speed = 14;
  var scrolled = false;

  if (clientX < rect.left + edge) {
    scrollEl.scrollLeft -= speed;
    scrolled = true;
  } else if (clientX > rect.right - edge) {
    scrollEl.scrollLeft += speed;
    scrolled = true;
  }

  if (clientY < rect.top + edge) {
    scrollEl.scrollTop -= speed;
    scrolled = true;
  } else if (clientY > rect.bottom - edge) {
    scrollEl.scrollTop += speed;
    scrolled = true;
  }

  return scrolled;
}

/** True when a Bootstrap (or fallback) modal is open. */
function isModalOpen() {
  var el = document.getElementById('modal-overlay');
  if (!el) return false;
  return el.classList.contains('show') || el.classList.contains('showing') ||
    (el.style.display === 'flex');
}

/* ---- Split interaction (shared) ----
 * Scissors sit on the day seam and overflow into the NEXT cell. Table cells paint
 * later columns on top, so the next day's booking steals the real event target.
 * Always hit-test scissors by geometry, not e.target.
 */
window._scheduleIgnoreEditUntil = 0;

function markIgnoreBookingEdit(ms) {
  window._scheduleIgnoreEditUntil = Date.now() + (ms || 800);
  suppressNextClick();
}

function isIgnoringBookingEdit() {
  return Date.now() < (window._scheduleIgnoreEditUntil || 0);
}

/**
 * Find the visible split handle under (clientX, clientY).
 * Prefer the single hover-active handle (O(1) common case).
 */
function hitTestSplitHandle(clientX, clientY) {
  var nodes = document.querySelectorAll(
    '.booking-block.hover-active .split-handle, .m-booking.hover-active .split-handle'
  );
  var pad = 8;
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var h = nodes[i];
    var r = h.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) continue;
    if (
      clientX >= r.left - pad && clientX <= r.right + pad &&
      clientY >= r.top - pad && clientY <= r.bottom + pad
    ) {
      var cx = (r.left + r.right) / 2;
      var cy = (r.top + r.bottom) / 2;
      var d = (clientX - cx) * (clientX - cx) + (clientY - cy) * (clientY - cy);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
  }
  return best;
}

function lookupBookingById(bookingId) {
  if (_bookingById && _bookingById[bookingId]) return _bookingById[bookingId];
  return _allBookings.find(function (b) { return b.id === bookingId; });
}

/**
 * One-time event delegation on #schedule-grid for:
 *  - split scissors (geometry)
 *  - edit booking click
 *  - empty cell create
 *  - leave edit
 *  - resize L/R
 *  - move (drag threshold)
 * Multi-tenant: O(1) bind cost per render instead of O(cells+bookings).
 */
function ensureSchedulePointerDelegation(scheduleGrid) {
  if (!scheduleGrid || scheduleGrid._pointerDelegationBound) return;
  scheduleGrid._pointerDelegationBound = true;

  var lastSplitTs = 0;
  var lastSplitId = null;

  function trySplitAtEvent(e) {
    if (e.button != null && e.button !== 0) return false;
    var handle = hitTestSplitHandle(e.clientX, e.clientY);
    if (!handle) return false;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    markIgnoreBookingEdit(1200);

    var id = parseInt(handle.dataset.bookingId, 10);
    if (!id) return true;

    var now = Date.now();
    if (id === lastSplitId && now - lastSplitTs < 500) return true;
    lastSplitTs = now;
    lastSplitId = id;
    window.splitBooking(id);
    return true;
  }

  // --- Capture: split wins first ---
  scheduleGrid.addEventListener('pointerdown', function (e) {
    trySplitAtEvent(e);
  }, true);

  scheduleGrid.addEventListener('mousedown', function (e) {
    if (trySplitAtEvent(e)) return;

    if (e.button !== 0) return;
    var t = e.target;
    if (!t || !t.closest) return;

    // Resize handles
    var rightH = t.closest('.resize-handle');
    var leftH = t.closest('.resize-handle-left');
    if (rightH || leftH) {
      e.stopPropagation();
      e.preventDefault();
      var block = t.closest('.booking-block, .m-booking');
      if (!block) return;
      var bookingId = parseInt(block.dataset.bookingId, 10);
      var booking = lookupBookingById(bookingId);
      if (!booking) return;
      if (!canBookForResource(booking.resource_id)) {
        toast(t('schedule.no_edit_permission'), 'error');
        return;
      }
      if (rightH) initResizeBooking(block, booking, e);
      else initResizeBookingLeft(block, booking, e);
      return;
    }

    // Move drag on booking body
    var moveBlock = t.closest('.booking-block, .m-booking');
    if (!moveBlock) return;
    if (moveBlock.classList.contains('leave-block') || moveBlock.classList.contains('m-leave')) return;
    if (t.closest('.split-handle')) return;
    if (isIgnoringBookingEdit()) return;

    var mid = parseInt(moveBlock.dataset.bookingId, 10);
    var mb = lookupBookingById(mid);
    if (!mb) return;
    if (!canBookForResource(mb.resource_id)) return;

    e.preventDefault();
    var startX = e.clientX;
    var startY = e.clientY;

    function onMoveStart(ev) {
      var dx = Math.abs(ev.clientX - startX);
      var dy = Math.abs(ev.clientY - startY);
      if (dx > 5 || dy > 5) {
        document.removeEventListener('mousemove', onMoveStart);
        document.removeEventListener('mouseup', onMoveCancel);
        initMoveBooking(moveBlock, mb, ev);
      }
    }
    function onMoveCancel() {
      document.removeEventListener('mousemove', onMoveStart);
      document.removeEventListener('mouseup', onMoveCancel);
    }
    document.addEventListener('mousemove', onMoveStart);
    document.addEventListener('mouseup', onMoveCancel);
  }, true);

  // --- Click: edit / leave / empty cell ---
  scheduleGrid.addEventListener('click', function (e) {
    if (isIgnoringBookingEdit()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      return;
    }
    if (hitTestSplitHandle(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      markIgnoreBookingEdit(800);
      trySplitAtEvent(e);
      return;
    }

    var t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('.resize-handle, .resize-handle-left')) return;

    // Leave edit
    var leaveEl = t.closest('.leave-block[data-leave-id], .m-leave[data-leave-id]');
    if (leaveEl) {
      e.stopPropagation();
      var leaveId = parseInt(leaveEl.dataset.leaveId, 10);
      var leaveEntry = _allLeave.find(function (l) { return l.id === leaveId; });
      if (leaveEntry) showEditLeaveModal(leaveEntry);
      return;
    }

    // Booking edit
    var block = t.closest('.booking-block, .m-booking');
    if (block && !block.classList.contains('leave-block') && !block.classList.contains('m-leave')) {
      e.stopPropagation();
      var bookingId = parseInt(block.dataset.bookingId, 10);
      if (bookingId) window.editBooking(bookingId);
      return;
    }

    // Empty cell → create
    var cell = t.closest('.booking-cell, .m-day-cell');
    if (!cell || !scheduleGrid.contains(cell)) return;
    if (t.closest('.booking-block, .leave-block, .m-booking, .m-leave')) return;
    var rid = parseInt(cell.dataset.resource, 10);
    var date = cell.dataset.date;
    if (!rid || !date) return;
    if (!canBookForResource(rid)) return;
    showBookingModal(null, rid, date);
  }, true);
}
