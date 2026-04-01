/* ============================================================
   reports.js — Resource Guru reports module
   Utilization & project reports with Excel export
   Dependencies: state, api, fmt, toast (from core.js)
   ============================================================ */

(function () {
  'use strict';

  // --------------- Helpers ---------------

  function el(id) {
    return document.getElementById(id);
  }

  function getMonthStart() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function getMonthEnd() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0);
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

  // --------------- Summary Cards ---------------

  function renderSummaryCards(container, cards) {
    var html = '<div class="report-summary">';
    cards.forEach(function (c) {
      html += '<div class="summary-card">';
      html += '<div class="summary-label">' + esc(c.label) + '</div>';
      html += '<div class="summary-value"' +
        (c.color ? ' style="color:' + c.color + '"' : '') +
        '>' + esc(c.value) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // --------------- Utilization Report ---------------

  function renderUtilizationReport(start, end) {
    var container = el('report-container');
    container.innerHTML = '<p>加载中…</p>';

    api('/api/reports/utilization?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (data) {
        var summary = data.summary || {};
        var rows = data.rows || [];

        var avgUtil = summary.avg_utilization || 0;

        // Summary cards
        var cardsHtml = '';
        var cards = [
          { label: '平均利用率', value: pctText(avgUtil), color: utilColor(avgUtil) },
          { label: '总预订工时', value: String(summary.total_booked || 0) },
          { label: '总可用工时', value: String(summary.total_available || 0) },
          { label: '工作日', value: String(summary.working_days || 0) }
        ];

        cardsHtml = '<div class="report-summary">';
        cards.forEach(function (c) {
          cardsHtml += '<div class="summary-card">' +
            '<div class="summary-label">' + esc(c.label) + '</div>' +
            '<div class="summary-value"' +
            (c.color ? ' style="color:' + c.color + '"' : '') +
            '>' + esc(c.value) + '</div></div>';
        });
        cardsHtml += '</div>';

        // Table
        var tableHtml = '<table class="report-table"><thead><tr>' +
          '<th>人员</th><th>角色</th><th>组别</th>' +
          '<th>预订工时</th><th>实际工时</th><th>可用工时</th>' +
          '<th>利用率</th><th>进度</th>' +
          '</tr></thead><tbody>';

        rows.forEach(function (r) {
          var util = r.utilization || 0;
          var color = utilColor(util);
          tableHtml += '<tr>' +
            '<td>' + esc(r.name) + '</td>' +
            '<td>' + esc(r.role) + '</td>' +
            '<td>' + esc(r.group) + '</td>' +
            '<td>' + (r.booked_hours || 0) + '</td>' +
            '<td>' + (r.actual_hours || 0) + '</td>' +
            '<td>' + (r.available_hours || 0) + '</td>' +
            '<td style="color:' + color + ';font-weight:600">' + pctText(util) + '</td>' +
            '<td><div class="util-bar">' +
            '<div class="util-bar-fill" style="width:' + Math.min(util, 100) + '%;background:' + color + '"></div>' +
            '</div></td>' +
            '</tr>';
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = cardsHtml + tableHtml;
      })
      .catch(function (err) {
        container.innerHTML = '<p class="error">加载失败：' + esc(err.message) + '</p>';
      });
  }

  // --------------- Project Report ---------------

  function renderProjectReport(start, end) {
    var container = el('report-container');
    container.innerHTML = '<p>加载中…</p>';

    api('/api/reports/projects?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (data) {
        var summary = data.summary || {};
        var rows = data.rows || [];

        var cardsHtml = '<div class="report-summary">';
        var cards = [
          { label: '项目总数', value: String(summary.total_projects || 0) },
          { label: '预算工时', value: String(summary.budget_hours || 0) },
          { label: '已排工时', value: String(summary.scheduled_hours || 0) },
          { label: '实际工时', value: String(summary.actual_hours || 0) }
        ];
        cards.forEach(function (c) {
          cardsHtml += '<div class="summary-card">' +
            '<div class="summary-label">' + esc(c.label) + '</div>' +
            '<div class="summary-value">' + esc(c.value) + '</div></div>';
        });
        cardsHtml += '</div>';

        // Table
        var tableHtml = '<table class="report-table"><thead><tr>' +
          '<th>项目</th><th>客户</th><th>预算工时</th>' +
          '<th>已排工时</th><th>实际工时</th><th>费率(¥/h)</th>' +
          '<th>预算进度</th><th>进度</th>' +
          '</tr></thead><tbody>';

        rows.forEach(function (r) {
          var budget = r.budget_hours || 0;
          var scheduled = r.scheduled_hours || 0;
          var progress = budget > 0 ? (scheduled / budget * 100) : 0;
          var progressColor = utilColor(progress);

          var colorDot = r.color
            ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(r.color) + ';margin-right:6px;vertical-align:middle"></span>'
            : '';

          tableHtml += '<tr>' +
            '<td>' + colorDot + esc(r.name) + '</td>' +
            '<td>' + esc(r.client) + '</td>' +
            '<td>' + budget + '</td>' +
            '<td>' + scheduled + '</td>' +
            '<td>' + (r.actual_hours || 0) + '</td>' +
            '<td>¥' + (r.hourly_rate || 0) + '/h</td>' +
            '<td style="color:' + progressColor + ';font-weight:600">' + pctText(progress) + '</td>' +
            '<td><div class="util-bar">' +
            '<div class="util-bar-fill" style="width:' + Math.min(progress, 100) + '%;background:' + progressColor + '"></div>' +
            '</div></td>' +
            '</tr>';
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = cardsHtml + tableHtml;
      })
      .catch(function (err) {
        container.innerHTML = '<p class="error">加载失败：' + esc(err.message) + '</p>';
      });
  }

  // --------------- Generate Report ---------------

  function generateReport() {
    var type = el('report-type').value;
    var start = el('report-start').value;
    var end = el('report-end').value;

    if (type === 'utilization') {
      renderUtilizationReport(start, end);
    } else {
      renderProjectReport(start, end);
    }
  }

  // --------------- Export Excel ---------------

  function exportExcel() {
    var type = el('report-type').value;
    var start = el('report-start').value;
    var end = el('report-end').value;
    var endpoint = type === 'utilization' ? '/api/export/utilization' : '/api/export/projects';
    window.open(endpoint + '?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end));
    toast('正在导出...', 'success');
  }

  // --------------- Public Loader ---------------

  window.loadReports = function loadReports() {
    var startInput = el('report-start');
    var endInput = el('report-end');

    if (!startInput.value) {
      startInput.value = fmt(getMonthStart());
    }
    if (!endInput.value) {
      endInput.value = fmt(getMonthEnd());
    }

    generateReport();
  };

  // --------------- Event Listeners ---------------

  document.addEventListener('DOMContentLoaded', function () {
    var btnGen = el('btn-gen-report');
    if (btnGen) {
      btnGen.addEventListener('click', generateReport);
    }

    var reportType = el('report-type');
    if (reportType) {
      reportType.addEventListener('change', generateReport);
    }

    var btnExport = el('btn-export-excel');
    if (btnExport) {
      btnExport.addEventListener('click', exportExcel);
    }
  });
})();
