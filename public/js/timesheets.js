/* ============================================================
   timesheets.js — Timesheets page module
   Depends on core.js globals: state, api, fmt, addDays, weekDates,
   shortDay, fmtDate, getMonday, toast
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;
  var cachedApi = window.cachedApi;

  /* ---- module-level cache for current week's bookings ---- */
  var _currentBookings = [];

  /* --------------------------------------------------
     1. loadTimesheets — main render function
     -------------------------------------------------- */
  window.loadTimesheets = async function loadTimesheets() {
    if (!state.tsWeekStart) {
      state.tsWeekStart = getMonday(new Date());
    }

    /* ---- resolve current user's resource_id ---- */
    var myResourceId = null;
    if (window.state.user && window.state.user.resource_id) {
      myResourceId = window.state.user.resource_id;
    }

    /* ---- resource selector (managers/admins can view others) ---- */
    var perms = window.state.permissions || {};
    var canViewOthers = perms.book_others || perms.manage_resources;

    var resources = state.resources && state.resources.length
      ? state.resources
      : await cachedApi('/api/resources');
    state.resources = resources;

    /* Basic users: always view own resource only */
    if (!canViewOthers && myResourceId) {
      state.tsResourceId = myResourceId;
    } else if (!state.tsResourceId && resources.length) {
      /* Managers default to their own resource if available */
      var ownRes = myResourceId && resources.find(function (r) { return r.id === myResourceId; });
      state.tsResourceId = ownRes ? ownRes.id : resources[0].id;
    }

    var selectEl = document.getElementById('ts-resource-select');
    if (selectEl) {
      if (!canViewOthers) {
        /* Hide selector for basic users — they can only see themselves */
        selectEl.parentElement && (selectEl.parentElement.style.display = 'none');
      } else {
        selectEl.parentElement && (selectEl.parentElement.style.display = '');
        selectEl.innerHTML = resources.map(function (r) {
          var sel = r.id === state.tsResourceId ? ' selected' : '';
          return '<option value="' + r.id + '"' + sel + '>' + esc(r.name) + '</option>';
        }).join('');
        selectEl.onchange = function () {
          state.tsResourceId = parseInt(selectEl.value, 10);
          window.loadTimesheets();
        };
      }
    }

    /* ---- Mon-Sun dates (7 days including weekend for overtime) ---- */
    var days = weekDates(state.tsWeekStart).slice(0, 7);
    var startStr = fmt(days[0]);
    var endStr   = fmt(days[6]);

    /* ---- update range label ---- */
    var rangeEl = document.getElementById('ts-range');
    if (rangeEl) {
      var s = days[0];
      var e = days[6];
      rangeEl.textContent =
        (s.getMonth() + 1) + t('common.month') + s.getDate() + t('common.day') + ' - ' +
        (e.getMonth() + 1) + t('common.month') + e.getDate() + t('common.day');
    }

    /* ---- parallel data fetch ---- */
    var rid = state.tsResourceId;
    var results = await Promise.all([
      api('/api/projects'),
      api('/api/timesheets?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid),
      api('/api/bookings?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid)
    ]);

    var projects   = results[0];
    var timesheets = results[1];
    var bookings   = results[2];

    /* ---- cache bookings ---- */
    _currentBookings = bookings;

    /* ---- auto-sync: if there are bookings with no matching timesheet entries,
            call the sync API to pre-fill them (only for own resource) ---- */
    var isOwnResource = (rid === myResourceId) || !myResourceId;
    if (isOwnResource && bookings.length > 0) {
      var tsKeys = new Set();
      timesheets.forEach(function (ts) {
        tsKeys.add(ts.project_id + '_' + ts.date);
      });
      var hasUnsynced = bookings.some(function (b) {
        return !tsKeys.has(b.project_id + '_' + b.date);
      });

      if (hasUnsynced) {
        try {
          var syncResult = await api('/api/timesheets/sync-from-bookings', {
            method: 'POST',
            body: { resource_id: rid, start: startStr, end: endStr }
          });
          if (syncResult.synced > 0) {
            /* Reload timesheets with the newly synced data */
            timesheets = await api('/api/timesheets?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid);
            toast(t('timesheets.synced_from_schedule') + ' ' + syncResult.synced + ' ' + t('timesheets.records'), 'info');
          }
        } catch (syncErr) {
          /* Non-fatal: sync failed, continue with existing data */
          console.warn('Auto-sync failed:', syncErr);
        }
      }
    }

    /* ---- find relevant projects ---- */
    var relevantIds = {};
    timesheets.forEach(function (ts) { relevantIds[ts.project_id] = true; });
    bookings.forEach(function (b) { relevantIds[b.project_id] = true; });

    var relevantProjects = projects.filter(function (p) {
      return relevantIds[p.id];
    });

    var gridEl = document.getElementById('timesheet-container');
    if (!gridEl) return;

    if (!relevantProjects.length) {
      gridEl.innerHTML = '<div class="empty-message">' + t('timesheets.no_records') + '</div>';
      return;
    }

    /* ---- build maps ---- */
    var tsMap = {};
    var tsSourceMap = {};
    timesheets.forEach(function (ts) {
      var key = ts.project_id + '_' + ts.date;
      tsMap[key] = ts.hours;
      tsSourceMap[key] = ts.source || 'manual';
    });

    var scheduleMap = {};
    bookings.forEach(function (b) {
      var key = b.project_id + '_' + b.date;
      scheduleMap[key] = (scheduleMap[key] || 0) + b.hours;
    });

    /* ---- render table ---- */
    gridEl.innerHTML = buildTable(days, relevantProjects, tsMap, tsSourceMap, scheduleMap);

    /* ---- all users can edit and save their own timesheets ---- */
    var isReadOnly = !isOwnResource && !canViewOthers;

    /* ---- attach save handler ---- */
    var saveBtn = document.getElementById('ts-save');
    if (saveBtn) {
      if (isReadOnly) {
        saveBtn.disabled = true;
        saveBtn.title = t('timesheets.no_permission');
      } else {
        saveBtn.disabled = false;
        saveBtn.onclick = function () {
          handleSave(days);
        };
      }
    }

    /* ---- attach input handlers ---- */
    gridEl.querySelectorAll('.ts-input').forEach(function (input) {
      if (isReadOnly) {
        input.disabled = true;
        input.style.cursor = 'default';
      } else {
        input.addEventListener('input', function () {
          updateTotals(days, relevantProjects);
        });
      }
    });
  };

  /* --------------------------------------------------
     Table builder
     -------------------------------------------------- */
  function buildTable(days, projects, tsMap, tsSourceMap, scheduleMap) {
    var html = '<table class="ts-table"><thead><tr><th>' + t('timesheets.project') + '</th>';

    days.forEach(function (d, idx) {
      var isWeekend = d.getDay() === 0 || d.getDay() === 6;
      var weekendCls = isWeekend ? ' ts-weekend' : '';
      html += '<th class="' + weekendCls.trim() + '">' + shortDay(d) + '<br>' + fmtDate(d) + '</th>';
    });
    html += '<th>' + t('timesheets.total') + '</th></tr></thead><tbody>';

    /* ---- daily totals accumulators ---- */
    var dayTotals = [];
    var i;
    for (i = 0; i < days.length; i++) dayTotals.push(0);
    var weekTotal = 0;

    /* ---- project rows ---- */
    projects.forEach(function (p) {
      var rowTotal = 0;
      var color = p.client_color || p.color || '#6366F1';
      var codeLabel = p.code ? '<span class="ts-proj-code">' + esc(p.code) + '</span>' : '';

      html += '<tr data-project-id="' + p.id + '">' +
        '<td class="ts-project-cell" style="border-left:3px solid ' + color + '">' +
        '<span class="ts-color-dot" style="background:' + color + '"></span>' +
        codeLabel + esc(p.name) + '</td>';

      days.forEach(function (d, idx) {
        var dateStr = fmt(d);
        var key = p.id + '_' + dateStr;
        var val = tsMap[key];
        var source = tsSourceMap[key] || 'manual';
        var placeholder = scheduleMap[key] || '';
        var displayVal = (val !== undefined && val !== null) ? val : '';
        var isWeekend = d.getDay() === 0 || d.getDay() === 6;
        var weekendCls = isWeekend ? ' ts-weekend' : '';

        /* Variance highlight: if actual differs from scheduled by >20% */
        var varClass = '';
        if (displayVal !== '' && placeholder !== '') {
          var actual = parseFloat(displayVal);
          var sched  = parseFloat(placeholder);
          if (sched > 0 && Math.abs(actual - sched) / sched > 0.2) {
            varClass = ' ts-input-variance';
          }
        }

        /* Synced-from-booking highlight: light tint to indicate auto-filled */
        var syncedClass = (source === 'booking' && displayVal !== '') ? ' ts-input-synced' : '';

        html += '<td class="' + weekendCls.trim() + '"><input type="number" class="ts-input' + varClass + syncedClass + '"' +
          ' data-project="' + p.id + '"' +
          ' data-date="' + dateStr + '"' +
          ' data-source="' + source + '"' +
          ' value="' + displayVal + '"' +
          ' placeholder="' + placeholder + '"' +
          ' min="0" max="24" step="0.5"></td>';

        var hours = (displayVal !== '') ? parseFloat(displayVal) : 0;
        rowTotal += hours;
        dayTotals[idx] += hours;
      });

      weekTotal += rowTotal;
      html += '<td class="ts-row-total" id="ts-row-total-' + p.id + '">' + rowTotal + '</td></tr>';
    });

    /* ---- totals row ---- */
    html += '<tr class="ts-totals-row"><td>' + t('timesheets.total') + '</td>';
    dayTotals.forEach(function (t, idx) {
      var isWeekend = days[idx].getDay() === 0 || days[idx].getDay() === 6;
      var weekendCls = isWeekend ? ' ts-weekend' : '';
      html += '<td class="' + weekendCls.trim() + '" id="ts-day-total-' + idx + '">' + t + '</td>';
    });
    html += '<td id="ts-week-total">' + weekTotal + '</td></tr>';

    html += '</tbody></table>';
    html += '<div class="ts-footer">' +
      '<span class="ts-sync-hint">' + t('timesheets.sync_hint') + '</span>' +
      '<button class="btn btn-primary" id="ts-save">' + t('timesheets.save_hours') + '</button>' +
      '</div>';
    return html;
  }

  /* --------------------------------------------------
     Live totals updater (called on input change)
     -------------------------------------------------- */
  function updateTotals(days, projects) {
    var dayTotals = days.map(function () { return 0; });
    var weekTotal = 0;

    projects.forEach(function (p) {
      var rowTotal = 0;
      days.forEach(function (d, idx) {
        var input = document.querySelector(
          '.ts-input[data-project="' + p.id + '"][data-date="' + fmt(d) + '"]'
        );
        if (!input) return;
        var val = parseFloat(input.value) || 0;
        rowTotal += val;
        dayTotals[idx] += val;
      });
      weekTotal += rowTotal;
      var rowTotalEl = document.getElementById('ts-row-total-' + p.id);
      if (rowTotalEl) rowTotalEl.textContent = rowTotal || 0;
    });

    dayTotals.forEach(function (t, idx) {
      var el = document.getElementById('ts-day-total-' + idx);
      if (el) el.textContent = t || 0;
    });
    var weekEl = document.getElementById('ts-week-total');
    if (weekEl) weekEl.textContent = weekTotal || 0;
  }

  /* --------------------------------------------------
     Save handler — all users can save their own timesheets
     -------------------------------------------------- */
  async function handleSave(days) {
    var inputs = document.querySelectorAll('.ts-input');
    var entries = [];

    inputs.forEach(function (input) {
      var val = input.value.trim();
      if (val === '') return;
      entries.push({
        project_id:  parseInt(input.dataset.project, 10),
        date:        input.dataset.date,
        hours:       parseFloat(val),
        resource_id: state.tsResourceId
      });
    });

    try {
      await api('/api/timesheets/batch', {
        method: 'POST',
        body: { entries: entries }
      });
      toast(t('timesheets.hours_saved'), 'success');
      window.loadTimesheets();
    } catch (err) {
      toast(err.message || t('common.save_failed'), 'error');
    }
  }

  /* --------------------------------------------------
     2. Navigation buttons
     -------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    var prevBtn  = document.getElementById('ts-prev');
    var nextBtn  = document.getElementById('ts-next');
    var todayBtn = document.getElementById('ts-today');
    var copyBtn  = document.getElementById('ts-copy-from-schedule');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        state.tsWeekStart = addDays(state.tsWeekStart, -7);
        window.loadTimesheets();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        state.tsWeekStart = addDays(state.tsWeekStart, 7);
        window.loadTimesheets();
      });
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        state.tsWeekStart = getMonday(new Date());
        window.loadTimesheets();
      });
    }
    /* Keep manual copy button for managers who want to force-copy */
    if (copyBtn) {
      var permsForCopy = window.state.permissions || {};
      if (!permsForCopy.book_others) {
        copyBtn.style.display = 'none';
      } else {
        copyBtn.addEventListener('click', copyFromSchedule);
      }
    }
  });

  /* --------------------------------------------------
     Manual copy from Schedule (managers only, force-overwrite)
     -------------------------------------------------- */
  function copyFromSchedule() {
    var inputs = document.querySelectorAll('.ts-input');
    if (!inputs.length) {
      toast(t('timesheets.load_first'), 'error');
      return;
    }

    var bookingMap = {};
    _currentBookings.forEach(function (b) {
      var key = b.project_id + '_' + b.date;
      bookingMap[key] = (bookingMap[key] || 0) + b.hours;
    });

    var filled = 0;
    var skipped = 0;

    inputs.forEach(function (input) {
      var key = input.dataset.project + '_' + input.dataset.date;
      var bookingHours = bookingMap[key];
      if (bookingHours == null) return;

      if (input.value !== '' && parseFloat(input.value) === bookingHours) {
        return;
      }

      if (input.value !== '' && input.dataset.source !== 'booking') {
        skipped++;
        return;
      }

      input.value = bookingHours;
      input.classList.add('ts-input-copied');
      setTimeout(function () { input.classList.remove('ts-input-copied'); }, 1500);
      filled++;
    });

    var days = weekDates(state.tsWeekStart).slice(0, 7);
    var allInputs = document.querySelectorAll('.ts-input');
    var projectIds = {};
    allInputs.forEach(function (inp) { projectIds[inp.dataset.project] = true; });
    var projectList = Object.keys(projectIds).map(function (id) { return { id: parseInt(id, 10) }; });
    updateTotals(days, projectList);

    if (filled > 0) {
      toast(t('timesheets.copied') + ' ' + filled + ' ' + t('timesheets.records') + (skipped > 0 ? ', ' + skipped + ' ' + t('timesheets.skipped') : ''), 'success');
    } else if (skipped > 0) {
      toast(t('timesheets.all_filled'), 'info');
    } else {
      toast(t('timesheets.no_hours_to_copy'), 'info');
    }
  }

  /* --------------------------------------------------
     HTML-escape helper
     -------------------------------------------------- */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();
