/* ============================================================
   timesheets.js — Timesheets page module
   Depends on core.js globals: state, api, fmt, addDays, weekDates,
   shortDay, fmtDate, getMonday, toast
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;

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

      html += '<tr style="border-left:3px solid ' + color + '">' +
        '<td class="ts-project-cell">' +
        '<span class="ts-color-dot" style="background:' + color + '"></span>' +
        codeLabel + esc(p.name) + '</td>';

      days.forEach(function (d, idx) {
        var dateStr = fmt(d);
        var key = p.id + '_' + dateStr;
        var val = tsMap[key];
        var placeholder = scheduleMap[key] || '';
        var displayVal = (val !== undefined && val !== null) ? val : '';

        html += '<td><input type="number" class="ts-input"' +
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
      html += '<td class="ts-row-total">' + rowTotal + '</td></tr>';
    });

    /* ---- totals row ---- */
    html += '<tr class="ts-totals-row"><td>合计</td>';
    dayTotals.forEach(function (t) {
      html += '<td>' + t + '</td>';
    });
    html += '<td>' + weekTotal + '</td></tr>';

    html += '</tbody></table>';
    html += '<div style="margin-top:16px;text-align:right"><button class="btn btn-primary" id="ts-save">保存工时</button></div>';
    return html;
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
