/* ============================================================
   timesheets.js — Timesheets page module
   Depends on core.js globals: state, api, fmt, addDays, weekDates,
   shortDay, fmtDate, getMonday, toast
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;

  /* ---- module-level cache for current week's bookings (used by copy feature) ---- */
  var _currentBookings = [];

  /* --------------------------------------------------
     1. loadTimesheets — main render function
     -------------------------------------------------- */
  window.loadTimesheets = async function loadTimesheets() {
    if (!state.tsWeekStart) {
      state.tsWeekStart = getMonday(new Date());
    }

    /* ---- resource selector ---- */
    var resources = state.resources && state.resources.length
      ? state.resources
      : await api('/api/resources');
    state.resources = resources;

    if (!state.tsResourceId && resources.length) {
      state.tsResourceId = resources[0].id;
    }

    var selectEl = document.getElementById('ts-resource-select');
    if (selectEl) {
      selectEl.innerHTML = resources.map(function (r) {
        var sel = r.id === state.tsResourceId ? ' selected' : '';
        return '<option value="' + r.id + '"' + sel + '>' + esc(r.name) + '</option>';
      }).join('');
      selectEl.onchange = function () {
        state.tsResourceId = parseInt(selectEl.value, 10);
        window.loadTimesheets();
      };
    }

    /* ---- Mon-Fri dates ---- */
    var days = weekDates(state.tsWeekStart).slice(0, 5);
    var startStr = fmt(days[0]);
    var endStr   = fmt(days[4]);

    /* ---- update range label ---- */
    var rangeEl = document.getElementById('ts-range');
    if (rangeEl) {
      var s = days[0];
      var e = days[4];
      rangeEl.textContent =
        (s.getMonth() + 1) + '月' + s.getDate() + '日 - ' +
        (e.getMonth() + 1) + '月' + e.getDate() + '日';
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

    /* ---- cache bookings for copy feature ---- */
    _currentBookings = bookings;

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
      gridEl.innerHTML = '<div class="empty-message">本周暂无排班或工时记录</div>';
      return;
    }

    /* ---- build maps ---- */
    var tsMap = {};
    timesheets.forEach(function (ts) {
      tsMap[ts.project_id + '_' + ts.date] = ts.hours;
    });

    var scheduleMap = {};
    bookings.forEach(function (b) {
      var key = b.project_id + '_' + b.date;
      scheduleMap[key] = (scheduleMap[key] || 0) + b.hours;
    });

    /* ---- render table ---- */
    gridEl.innerHTML = buildTable(days, relevantProjects, tsMap, scheduleMap);

    /* ---- attach save handler ---- */
    var saveBtn = document.getElementById('ts-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        handleSave(days);
      };
    }

    /* ---- update totals on input change ---- */
    gridEl.querySelectorAll('.ts-input').forEach(function (input) {
      input.addEventListener('input', function () {
        updateTotals(days, relevantProjects);
      });
    });
  };

  /* --------------------------------------------------
     Table builder
     -------------------------------------------------- */
  function buildTable(days, projects, tsMap, scheduleMap) {
    var html = '<table class="ts-table"><thead><tr><th>项目</th>';

    days.forEach(function (d) {
      html += '<th>' + shortDay(d) + '<br>' + fmtDate(d) + '</th>';
    });
    html += '<th>合计</th></tr></thead><tbody>';

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

      html += '<tr style="border-left:3px solid ' + color + '" data-project-id="' + p.id + '">' +
        '<td class="ts-project-cell">' +
        '<span class="ts-color-dot" style="background:' + color + '"></span>' +
        codeLabel + esc(p.name) + '</td>';

      days.forEach(function (d, idx) {
        var dateStr = fmt(d);
        var key = p.id + '_' + dateStr;
        var val = tsMap[key];
        var placeholder = scheduleMap[key] || '';
        var displayVal = (val !== undefined && val !== null) ? val : '';

        /* Variance highlight: if actual differs from scheduled by >20% */
        var varClass = '';
        if (displayVal !== '' && placeholder !== '') {
          var actual = parseFloat(displayVal);
          var sched  = parseFloat(placeholder);
          if (sched > 0 && Math.abs(actual - sched) / sched > 0.2) {
            varClass = ' ts-input-variance';
          }
        }

        html += '<td><input type="number" class="ts-input' + varClass + '"' +
          ' data-project="' + p.id + '"' +
          ' data-date="' + dateStr + '"' +
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
    html += '<tr class="ts-totals-row"><td>合计</td>';
    dayTotals.forEach(function (t, idx) {
      html += '<td id="ts-day-total-' + idx + '">' + t + '</td>';
    });
    html += '<td id="ts-week-total">' + weekTotal + '</td></tr>';

    html += '</tbody></table>';
    html += '<div style="margin-top:16px;text-align:right">' +
      '<button class="btn btn-primary" id="ts-save">保存工时</button>' +
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
     Copy from Schedule — fill inputs with booking hours
     -------------------------------------------------- */
  function copyFromSchedule() {
    var inputs = document.querySelectorAll('.ts-input');
    if (!inputs.length) {
      toast('请先加载工时表', 'error');
      return;
    }

    /* Build a map from cached bookings: project_date -> total hours */
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
        /* Already matches — skip */
        return;
      }

      if (input.value !== '' && parseFloat(input.value) !== bookingHours) {
        /* Has existing value that differs — skip to avoid overwriting */
        skipped++;
        return;
      }

      /* Empty cell — fill with booking hours */
      input.value = bookingHours;
      input.classList.add('ts-input-copied');
      setTimeout(function () { input.classList.remove('ts-input-copied'); }, 1500);
      filled++;
    });

    /* Trigger totals refresh */
    var days = weekDates(state.tsWeekStart).slice(0, 5);
    var projects = (state.resources || []).map(function () { return null; }); /* dummy */
    /* Simpler: just re-read all inputs */
    var allInputs = document.querySelectorAll('.ts-input');
    var projectIds = {};
    allInputs.forEach(function (inp) { projectIds[inp.dataset.project] = true; });
    var projectList = Object.keys(projectIds).map(function (id) { return { id: parseInt(id, 10) }; });
    updateTotals(days, projectList);

    if (filled > 0) {
      toast('已从排程复制 ' + filled + ' 条工时' + (skipped > 0 ? '，跳过 ' + skipped + ' 条已有记录' : ''), 'success');
    } else if (skipped > 0) {
      toast('所有格子已有工时记录，未覆盖', 'info');
    } else {
      toast('本周排程中没有可复制的工时', 'info');
    }
  }

  /* --------------------------------------------------
     Save handler
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
      toast('工时已保存', 'success');
      window.loadTimesheets();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
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
    if (copyBtn) {
      copyBtn.addEventListener('click', copyFromSchedule);
    }
  });

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
