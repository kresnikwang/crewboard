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
  // Safety: remove listener if click never arrives (e.g. mouse left window)
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
 * Find the visible split handle under (clientX, clientY), expanding the rect
 * slightly for easier aiming. Prefers the nearest handle center if several match.
 */
function hitTestSplitHandle(clientX, clientY) {
  var nodes = document.querySelectorAll(
    '.booking-block.hover-active .split-handle, .m-booking.hover-active .split-handle'
  );
  if (!nodes.length) {
    // Fallback: any currently rendered handle with a non-zero box (opacity may lag)
    nodes = document.querySelectorAll('.split-handle');
  }
  var pad = 8;
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var h = nodes[i];
    var parent = h.closest('.booking-block, .m-booking');
    // Only consider handles that belong to an active or highlighted span day
    if (parent && !parent.classList.contains('hover-active') && !parent.classList.contains('hover-highlight')) {
      continue;
    }
    // Skip fully inactive (no hover at all)
    if (parent && !parent.classList.contains('hover-active')) continue;

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

/**
 * Install one-shot capture handlers on the schedule grid for split + edit.
 * Safe to call after every render; binds only once per grid element.
 */
function ensureSchedulePointerDelegation(scheduleGrid) {
  if (!scheduleGrid || scheduleGrid._pointerDelegationBound) return;
  scheduleGrid._pointerDelegationBound = true;

  var lastSplitTs = 0;
  var lastSplitId = null;

  function trySplitAtEvent(e, opts) {
    opts = opts || {};
    if (e.button != null && e.button !== 0) return false;
    var handle = hitTestSplitHandle(e.clientX, e.clientY);
    if (!handle) return false;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    markIgnoreBookingEdit(1200);

    var id = parseInt(handle.dataset.bookingId, 10);
    if (!id) return true;

    // Deduplicate pointerdown + mousedown + click for the same press
    var now = Date.now();
    if (opts.execute !== false) {
      if (id === lastSplitId && now - lastSplitTs < 500) return true;
      lastSplitTs = now;
      lastSplitId = id;
      window.splitBooking(id);
    }
    return true;
  }

  // Prefer pointerdown; also bind mousedown for older browsers. Split runs once
  // per press thanks to lastSplitTs dedupe.
  scheduleGrid.addEventListener('pointerdown', function (e) {
    trySplitAtEvent(e);
  }, true);

  scheduleGrid.addEventListener('mousedown', function (e) {
    trySplitAtEvent(e);
  }, true);

  scheduleGrid.addEventListener('click', function (e) {
    // After a successful split, swallow the trailing click that would open edit
    if (isIgnoringBookingEdit()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      return;
    }
    // Geometry again — if user clicked on seam but event target is the next day
    // execute:false if already split on pointerdown; still block edit path
    if (hitTestSplitHandle(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      markIgnoreBookingEdit(800);
      // Only run split if pointerdown didn't (e.g. pure click without prior down on grid)
      trySplitAtEvent(e);
      return;
    }

    if (e.target.closest && e.target.closest('.resize-handle, .resize-handle-left')) return;

    var block = e.target.closest && e.target.closest('.booking-block, .m-booking');
    if (!block || !scheduleGrid.contains(block)) return;
    if (block.classList.contains('leave-block') || block.classList.contains('m-leave')) return;

    e.stopPropagation();
    var bookingId = parseInt(block.dataset.bookingId, 10);
    if (bookingId) window.editBooking(bookingId);
  }, true);
}
