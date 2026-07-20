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
