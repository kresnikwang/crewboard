/* ============================================================
   reports.js — Reports module (enhanced)
   Features: Chart.js charts, quick date presets, drill-down
   Dependencies: state, api, fmt, toast (from core.js)
   ============================================================ */

(function () {
  'use strict';

  /* ---- Chart.js instances (destroy before re-creating) ---- */
  var _utilChart = null;
  var _projChart = null;

  /* ---- current report data cache (for drill-down) ---- */
  var _lastStart = '';
  var _lastEnd   = '';

  // --------------- Helpers ---------------

  function el(id) { return document.getElementById(id); }

  function fmt(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function utilColor(pct) {
    if (pct > 90) return '#e74c3c';
    if (pct > 70) return '#27ae60';
    if (pct > 40) return '#f39c12';
    return '#95a5a6';
  }

  function pctText(val) {
    return (val == null ? 0 : val).toFixed(1) + '%';
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : str;
    return d.innerHTML;
  }

  function destroyCharts() {
    if (_utilChart) { try { _utilChart.destroy(); } catch (_) {} _utilChart = null; }
    if (_projChart) { try { _projChart.destroy(); } catch (_) {} _projChart = null; }
  }

  // --------------- Quick Date Presets ---------------

  function applyPreset(preset) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    var start, end;

    switch (preset) {
      case 'this_week': {
        var day = now.getDay() || 7;
        start = new Date(now); start.setDate(now.getDate() - day + 1);
        end   = new Date(start); end.setDate(start.getDate() + 6);
        break;
      }
      case 'last_week': {
        var day2 = now.getDay() || 7;
        end   = new Date(now); end.setDate(now.getDate() - day2);
        start = new Date(end); start.setDate(end.getDate() - 6);
        break;
      }
      case 'this_month':
        start = new Date(y, m, 1);
        end   = new Date(y, m + 1, 0);
        break;
      case 'last_month':
        start = new Date(y, m - 1, 1);
        end   = new Date(y, m, 0);
        break;
      case 'this_quarter': {
        var q = Math.floor(m / 3);
        start = new Date(y, q * 3, 1);
        end   = new Date(y, q * 3 + 3, 0);
        break;
      }
      case 'last_quarter': {
        var q2 = Math.floor(m / 3) - 1;
        var qy = q2 < 0 ? y - 1 : y;
        var qm = ((q2 % 4) + 4) % 4;
        start = new Date(qy, qm * 3, 1);
        end   = new Date(qy, qm * 3 + 3, 0);
        break;
      }
      case 'this_year':
        start = new Date(y, 0, 1);
        end   = new Date(y, 11, 31);
        break;
      default:
        return;
    }

    el('report-start').value = fmt(start);
    el('report-end').value   = fmt(end);
    generateReport();
  }

  // --------------- Summary Cards ---------------

  function renderSummaryCards(container, cards) {
    var html = '<div class="report-summary row g-3 mb-3">';
    cards.forEach(function (c) {
      html += '<div class="col-6 col-md-3"><div class="summary-card card h-100">' +
        '<div class="card-body p-3">' +
        '<div class="summary-label text-muted small mb-1">' + esc(c.label) + '</div>' +
        '<div class="summary-value fw-bold fs-5"' +
        (c.color ? ' style="color:' + c.color + '"' : '') +
        '>' + esc(String(c.value)) + '</div>' +
        (c.sub ? '<div class="summary-sub text-muted small">' + esc(c.sub) + '</div>' : '') +
        '</div></div></div>';
    });
    html += '</div>';
    container.insertAdjacentHTML('beforeend', html);
  }

  // --------------- Utilization Report ---------------

  function renderUtilizationReport(start, end) {
    var container = el('report-container');
    container.innerHTML = '<p class="report-loading">' + t('common.loading') + '</p>';

    api('/api/reports/utilization?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (data) {
        var summary = data.summary || {};
        var rows = data.rows || data.data || [];

        destroyCharts();
        container.innerHTML = '';

        /* ---- Summary cards ---- */
        var avgUtil = summary.avg_utilization || 0;
        renderSummaryCards(container, [
          { label: t('reports.avg_utilization'), value: pctText(avgUtil), color: utilColor(avgUtil) },
          { label: t('reports.total_booked'), value: (summary.total_booked || 0) + 'h' },
          { label: t('reports.total_available'), value: (summary.total_available || 0) + 'h' },
          { label: t('reports.working_days'), value: (summary.working_days || 0) + ' ' + t('common.days') }
        ]);

        /* ---- Chart area ---- */
        var chartWrap = document.createElement('div');
        chartWrap.className = 'report-charts row g-3 mb-3';
        chartWrap.innerHTML =
          '<div class="col-md-8"><div class="report-chart-card card h-100"><div class="card-body">' +
            '<div class="report-chart-title fw-semibold mb-2">' + t('reports.team_util_dist') + '</div>' +
            '<canvas id="chart-util-bar" height="220"></canvas>' +
          '</div></div></div>' +
          '<div class="col-md-4"><div class="report-chart-card card h-100"><div class="card-body">' +
            '<div class="report-chart-title fw-semibold mb-2">' + t('reports.hours_composition') + '</div>' +
            '<canvas id="chart-util-pie" height="220"></canvas>' +
          '</div></div></div>';
        container.appendChild(chartWrap);

        /* ---- Table ---- */
        var tableWrap = document.createElement('div');
        tableWrap.className = 'report-table-wrap';
        var tableHtml = '<table class="report-table table table-hover table-sm align-middle"><thead><tr>' +
          '<th>' + t('reports.member') + '</th><th>' + t('reports.role') + '</th><th>' + t('reports.team') + '</th>' +
          '<th>' + t('reports.booked_hours') + '</th><th>' + t('reports.actual_hours') + '</th><th>' + t('reports.available_hours') + '</th>' +
          '<th>' + t('reports.utilization_pct') + '</th><th>' + t('reports.progress') + '</th>' +
          '</tr></thead><tbody>';

        rows.forEach(function (r) {
          var util = r.utilization || 0;
          var color = utilColor(util);
          tableHtml += '<tr class="report-row-drillable" data-resource-id="' + r.id + '" title="' + t('reports.click_detail') + '">' +
            '<td class="report-name-cell"><span class="report-color-dot" style="background:' + (r.color || '#6366F1') + '"></span>' + esc(r.name) + '</td>' +
            '<td>' + esc(r.role || '') + '</td>' +
            '<td>' + esc(r.group || r.team || '') + '</td>' +
            '<td>' + (r.booked_hours || 0) + 'h</td>' +
            '<td>' + (r.actual_hours || 0) + 'h</td>' +
            '<td>' + (r.available_hours || r.capacity_hours || 0) + 'h</td>' +
            '<td style="color:' + color + ';font-weight:600">' + pctText(util) + '</td>' +
            '<td><div class="util-bar"><div class="util-bar-fill" style="width:' + Math.min(util, 100) + '%;background:' + color + '"></div></div></td>' +
            '</tr>';
        });
        tableHtml += '</tbody></table>';
        tableWrap.innerHTML = tableHtml;
        container.appendChild(tableWrap);

        /* ---- Drill-down rows ---- */
        tableWrap.querySelectorAll('.report-row-drillable').forEach(function (row) {
          row.addEventListener('click', function () {
            var rid = row.dataset.resourceId;
            toggleResourceDrill(row, rid, start, end);
          });
        });

        /* ---- Draw charts after DOM is ready ---- */
        requestAnimationFrame(function () {
          drawUtilBarChart(rows);
          drawUtilPieChart(summary);
        });
      })
      .catch(function (err) {
        el('report-container').innerHTML = '<p class="error">' + t('common.load_failed') + '：' + esc(err.message) + '</p>';
      });
  }

  /* ---- Drill-down: resource -> projects ---- */
  function toggleResourceDrill(row, resourceId, start, end) {
    var existingDrill = row.nextElementSibling;
    if (existingDrill && existingDrill.classList.contains('drill-row')) {
      existingDrill.remove();
      row.classList.remove('drill-open');
      return;
    }
    row.classList.add('drill-open');
    var drillRow = document.createElement('tr');
    drillRow.className = 'drill-row';
    drillRow.innerHTML = '<td colspan="8"><div class="drill-loading">' + t('common.loading') + '</div></td>';
    row.after(drillRow);

    api('/api/reports/resource-drill?resource_id=' + resourceId +
        '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (items) {
        if (!items.length) {
          drillRow.querySelector('td').innerHTML = '<div class="drill-empty">' + t('reports.no_project_data') + '</div>';
          return;
        }
        var html = '<div class="drill-content"><table class="drill-table table table-sm">' +
          '<thead><tr><th>' + t('common.project') + '</th><th>' + t('common.client') + '</th><th>' + t('reports.booked_hours') + '</th><th>' + t('reports.actual_hours') + '</th></tr></thead><tbody>';
        items.forEach(function (p) {
          html += '<tr>' +
            '<td><span class="report-color-dot" style="background:' + (p.color || '#8B5CF6') + '"></span>' + esc(p.name) + '</td>' +
            '<td>' + esc(p.client_name || '—') + '</td>' +
            '<td>' + (p.booked_hours || 0) + 'h</td>' +
            '<td>' + (p.actual_hours || 0) + 'h</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
        drillRow.querySelector('td').innerHTML = html;
      })
      .catch(function () {
        drillRow.querySelector('td').innerHTML = '<div class="drill-empty">' + t('common.load_failed') + '</div>';
      });
  }

  /* ---- Chart: utilization bar ---- */
  function drawUtilBarChart(rows) {
    var canvas = document.getElementById('chart-util-bar');
    if (!canvas || !window.Chart) return;
    var labels = rows.map(function (r) { return r.name; });
    var utilData = rows.map(function (r) { return r.utilization || 0; });
    var colors = utilData.map(function (v) { return utilColor(v); });
    _utilChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: t('reports.utilization_pct') + ' %',
          data: utilData,
          backgroundColor: colors,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } }
        }
      }
    });
  }

  /* ---- Chart: booked vs available pie ---- */
  function drawUtilPieChart(summary) {
    var canvas = document.getElementById('chart-util-pie');
    if (!canvas || !window.Chart) return;
    var booked = summary.total_booked || 0;
    var avail  = summary.total_available || 0;
    var free   = Math.max(0, avail - booked);
    _projChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: [t('reports.booked_hours'), t('reports.idle')],
        datasets: [{
          data: [booked, free],
          backgroundColor: ['#3B7DDD', '#e5e7eb'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + ctx.parsed + 'h';
              }
            }
          }
        }
      }
    });
  }

  // --------------- Project Report ---------------

  function renderProjectReport(start, end) {
    var container = el('report-container');
    container.innerHTML = '<p class="report-loading">' + t('common.loading') + '</p>';

    api('/api/reports/projects?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (data) {
        var summary = data.summary || {};
        var rows = data.rows || [];

        destroyCharts();
        container.innerHTML = '';

        /* ---- Summary cards ---- */
        renderSummaryCards(container, [
          { label: t('reports.total_projects'), value: summary.total_projects || 0 },
          { label: t('reports.budget_hours'), value: (summary.budget_hours || 0) + 'h' },
          { label: t('reports.scheduled_hours'), value: (summary.scheduled_hours || 0) + 'h' },
          { label: t('reports.actual_hours'), value: (summary.actual_hours || 0) + 'h' }
        ]);

        /* ---- Chart area ---- */
        var chartWrap = document.createElement('div');
        chartWrap.className = 'report-charts';
        chartWrap.innerHTML =
          '<div class="report-chart-card">' +
            '<div class="report-chart-title">' + t('reports.top10_budget') + '</div>' +
            '<canvas id="chart-proj-budget" height="220"></canvas>' +
          '</div>' +
          '<div class="report-chart-card">' +
            '<div class="report-chart-title">' + t('reports.hours_dist') + '</div>' +
            '<canvas id="chart-proj-compare" height="220"></canvas>' +
          '</div>';
        container.appendChild(chartWrap);

        /* ---- Table ---- */
        var tableWrap = document.createElement('div');
        tableWrap.className = 'report-table-wrap';
        var tableHtml = '<table class="report-table table table-hover table-sm align-middle"><thead><tr>' +
          '<th>' + t('common.project') + '</th><th>' + t('common.client') + '</th><th>' + t('reports.budget_hours') + '</th>' +
          '<th>' + t('reports.scheduled_hours') + '</th><th>' + t('reports.actual_hours') + '</th><th>' + t('reports.rate_cny') + '</th>' +
          '<th>' + t('reports.utilization_pct') + '</th><th>' + t('reports.progress') + '</th>' +
          '</tr></thead><tbody>';

        rows.forEach(function (r) {
          var budget    = r.budget_hours || 0;
          var scheduled = r.scheduled_hours || r.booked_hours || 0;
          var progress  = budget > 0 ? (scheduled / budget * 100) : 0;
          var pColor    = utilColor(progress);
          var dot = '<span class="report-color-dot" style="background:' + (r.color || '#8B5CF6') + '"></span>';

          /* Overrun warning */
          var overrunBadge = progress > 100
            ? '<span class="overrun-badge" title="' + t('reports.over_budget') + '">' + t('reports.over_budget') + '</span>'
            : '';

          tableHtml += '<tr class="report-row-drillable" data-project-id="' + r.id + '" title="' + t('reports.click_member') + '">' +
            '<td class="report-name-cell">' + dot + esc(r.name) + overrunBadge + '</td>' +
            '<td>' + esc(r.client || r.client_name || '—') + '</td>' +
            '<td>' + budget + 'h</td>' +
            '<td>' + scheduled + 'h</td>' +
            '<td>' + (r.actual_hours || 0) + 'h</td>' +
            '<td>¥' + (r.hourly_rate || 0) + '/h</td>' +
            '<td style="color:' + pColor + ';font-weight:600">' + pctText(progress) + '</td>' +
            '<td><div class="util-bar"><div class="util-bar-fill" style="width:' + Math.min(progress, 100) + '%;background:' + pColor + '"></div></div></td>' +
            '</tr>';
        });
        tableHtml += '</tbody></table>';
        tableWrap.innerHTML = tableHtml;
        container.appendChild(tableWrap);

        /* ---- Drill-down rows ---- */
        tableWrap.querySelectorAll('.report-row-drillable').forEach(function (row) {
          row.addEventListener('click', function () {
            var pid = row.dataset.projectId;
            toggleProjectDrill(row, pid, start, end);
          });
        });

        /* ---- Draw charts ---- */
        requestAnimationFrame(function () {
          drawProjectBudgetChart(rows);
          drawProjectCompareChart(rows);
        });
      })
      .catch(function (err) {
        el('report-container').innerHTML = '<p class="error">' + t('common.load_failed') + '：' + esc(err.message) + '</p>';
      });
  }

  function toggleProjectDrill(row, projectId, start, end) {
    var existingDrill = row.nextElementSibling;
    if (existingDrill && existingDrill.classList.contains('drill-row')) {
      existingDrill.remove();
      row.classList.remove('drill-open');
      return;
    }
    row.classList.add('drill-open');
    var drillRow = document.createElement('tr');
    drillRow.className = 'drill-row';
    drillRow.innerHTML = '<td colspan="8"><div class="drill-loading">' + t('common.loading') + '</div></td>';
    row.after(drillRow);

    Promise.all([
      api('/api/reports/project-drill?project_id=' + projectId + '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end)),
      api('/api/reports/project-scope-drill?project_id=' + projectId + '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
    ])
    .then(function (results) {
      var members = results[0] || [];
      var scopes = results[1] || [];

      if (!members.length && !scopes.length) {
        drillRow.querySelector('td').innerHTML = '<div class="drill-empty">' + t('reports.no_member_data') + '</div>';
        return;
      }

      var html = '<div class="drill-content row g-3">';
      
      // Column 1: Member breakdown
      html += '<div class="col-12 col-md-6">';
      html += '<h6 class="fw-semibold mb-2 fs-7 text-secondary">' + t('reports.member_hours_breakdown') + '</h6>';
      if (members.length > 0) {
        html += '<table class="drill-table table table-sm table-hover align-middle">' +
          '<thead><tr><th>' + t('reports.member') + '</th><th>' + t('reports.role') + '</th><th>' + t('reports.booked_hours') + '</th><th>' + t('reports.actual_hours') + '</th></tr></thead><tbody>';
        members.forEach(function (m) {
          html += '<tr>' +
            '<td><span class="report-color-dot" style="background:' + (m.color || '#6366F1') + '"></span>' + esc(m.name) + '</td>' +
            '<td>' + esc(m.role || '') + '</td>' +
            '<td>' + (m.booked_hours || 0) + 'h</td>' +
            '<td>' + (m.actual_hours || 0) + 'h</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
      } else {
        html += '<div class="text-muted small py-2">' + t('reports.no_member_data') + '</div>';
      }
      html += '</div>';

      // Column 2: Scope breakdown
      html += '<div class="col-12 col-md-6">';
      html += '<h6 class="fw-semibold mb-2 fs-7 text-secondary">' + t('reports.scope_hours_breakdown') + '</h6>';
      if (scopes.length > 0) {
        html += '<table class="drill-table table table-sm table-hover align-middle">' +
          '<thead><tr><th>' + t('reports.work_scope') + '</th><th>' + t('reports.booked_hours') + '</th><th>' + t('reports.actual_hours') + '</th></tr></thead><tbody>';
        scopes.forEach(function (s) {
          html += '<tr>' +
            '<td>' + esc(s.scope_name) + '</td>' +
            '<td>' + (s.booked_hours || 0) + 'h</td>' +
            '<td>' + (s.actual_hours || 0) + 'h</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
      } else {
        html += '<div class="text-muted small py-2">' + t('reports.no_scope_data') + '</div>';
      }
      html += '</div>';

      html += '</div>';
      drillRow.querySelector('td').innerHTML = html;
    })
    .catch(function (err) {
      console.error(err);
      drillRow.querySelector('td').innerHTML = '<div class="drill-empty">' + t('common.load_failed') + '</div>';
    });
  }
  function drawProjectBudgetChart(rows) {
    var canvas = document.getElementById('chart-proj-budget');
    if (!canvas || !window.Chart) return;
    var top = rows.slice(0, 10);
    var labels   = top.map(function (r) { return r.name.length > 8 ? r.name.slice(0, 8) + '…' : r.name; });
    var budgets  = top.map(function (r) { return r.budget_hours || 0; });
    var scheduled = top.map(function (r) { return r.scheduled_hours || r.booked_hours || 0; });
    _utilChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: t('reports.budget_hours'), data: budgets,   backgroundColor: '#e0e7ff', borderRadius: 4 },
          { label: t('reports.scheduled_hours'), data: scheduled, backgroundColor: '#3B7DDD', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  /* ---- Chart: scheduled vs actual compare ---- */
  function drawProjectCompareChart(rows) {
    var canvas = document.getElementById('chart-proj-compare');
    if (!canvas || !window.Chart) return;
    var top = rows.slice(0, 10);
    var labels   = top.map(function (r) { return r.name.length > 8 ? r.name.slice(0, 8) + '…' : r.name; });
    var scheduled = top.map(function (r) { return r.scheduled_hours || r.booked_hours || 0; });
    var actual    = top.map(function (r) { return r.actual_hours || 0; });
    _projChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: t('reports.scheduled_hours'), data: scheduled, backgroundColor: '#818cf8', borderRadius: 4 },
          { label: t('reports.actual_hours'), data: actual,    backgroundColor: '#34d399', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // --------------- Generate Report ---------------

  function generateReport() {
    var type  = el('report-type').value;
    var start = el('report-start').value;
    var end   = el('report-end').value;
    if (!start || !end) { toast(t('reports.select_range'), 'error'); return; }
    _lastStart = start;
    _lastEnd   = end;
    if (type === 'utilization') {
      renderUtilizationReport(start, end);
    } else {
      renderProjectReport(start, end);
    }
  }

  // --------------- Export Excel ---------------

  function exportExcel() {
    var type  = el('report-type').value;
    var start = el('report-start').value;
    var end   = el('report-end').value;
    var endpoint = type === 'utilization' ? '/api/export/utilization' : '/api/export/projects';
    window.open(endpoint + '?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end));
    toast(t('reports.exporting'), 'success');
  }

  // --------------- Public Loader ---------------

  window.loadReports = function loadReports() {
    var startInput = el('report-start');
    var endInput   = el('report-end');
    if (!startInput || !endInput) return;

    if (!startInput.value) {
      var now = new Date();
      startInput.value = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    if (!endInput.value) {
      var now2 = new Date();
      endInput.value = fmt(new Date(now2.getFullYear(), now2.getMonth() + 1, 0));
    }

    /* Ensure Chart.js is loaded */
    if (!window.Chart) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      script.onload = function () { generateReport(); };
      document.head.appendChild(script);
    } else {
      generateReport();
    }
  };

  // --------------- Event Listeners ---------------

  document.addEventListener('DOMContentLoaded', function () {
    var btnGen = el('btn-gen-report');
    if (btnGen) btnGen.addEventListener('click', generateReport);

    var reportType = el('report-type');
    if (reportType) reportType.addEventListener('change', generateReport);

    var btnExport = el('btn-export-excel');
    if (btnExport) btnExport.addEventListener('click', exportExcel);

    /* Quick preset buttons */
    var presetsContainer = el('report-presets');
    if (presetsContainer) {
      presetsContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-preset]');
        if (btn) applyPreset(btn.dataset.preset);
      });
    }
  });
})();
