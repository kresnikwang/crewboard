/* schedule/04-month.js — part of schedule module (bundled into schedule.js) */
function buildMonthView(days, teams, bMap, lMap, hMap, resources) {
  var totalDays = days.length;

  /* --- Column widths (must use inline style on <col> AND explicit
     table width; otherwise long booking content can stretch a body
     cell wider than the corresponding header cell, breaking alignment
     even with table-layout: fixed). --- */
  var RES_COL_W = 220;
  var DAY_COL_W = 60;
  var totalTableW = RES_COL_W + totalDays * DAY_COL_W;

  /* --- Build column group (ensures both tables share exact widths) --- */
  var colgroupHTML = '<colgroup>';
  colgroupHTML += '<col class="m-res-col" style="width:' + RES_COL_W + 'px">';
  for (var ci = 0; ci < totalDays; ci++) colgroupHTML += '<col class="m-day-col" style="width:' + DAY_COL_W + 'px">';
  colgroupHTML += '</colgroup>';

  /* --- Build header row HTML (shared by header table) --- */
  var headerRowHTML = '<tr class="m-day-row">';
  headerRowHTML += '<th class="m-res-hd">' + t('schedule.resource') + '</th>';
  var prevMonth = -1;
  days.forEach(function (d, idx) {
    var cls = [];
    if (isToday(d)) cls.push('m-today');
    if (isWeekend(d)) cls.push('m-weekend');
    var dateStr = fmt(d);
    var holiday = hMap[dateStr];
    if (holiday && holiday.type === 'holiday') cls.push('m-holiday');
    if (holiday && holiday.type === 'workday') cls.push('m-makeup');
    var weekLabel = '';
    if (idx % 7 === 0) {
      var weekNum = getWeekNumber(d);
      weekLabel = '<span class="m-week-label">W' + weekNum + '</span>';
    }
    var holidayDot = '';
    if (holiday) {
      if (holiday.type === 'holiday') {
        holidayDot = '<span class="m-holiday-dot" title="' + holiday.name + '"></span>';
      } else {
        holidayDot = '<span class="m-makeup-dot" title="' + holiday.name + '"></span>';
      }
    }
    /* Show month label inline when month changes */
    var monthLabel = '';
    var m = d.getMonth();
    if (m !== prevMonth) {
      monthLabel = '<span class="m-month-inline">' + MONTH_NAMES[m] + '</span>';
      prevMonth = m;
    }
    var dayNum = '<span class="m-day-num">' + d.getDate() + '</span>';
    headerRowHTML += '<th class="' + cls.join(' ') + '" style="position:relative">' +
      weekLabel +
      '<span class="m-day-name">' + DAY_SHORT[d.getDay()] + '</span>' +
      monthLabel + dayNum + holidayDot + '</th>';
  });
  headerRowHTML += '</tr>';

  /* --- Build body rows --- */
  var bodyHTML = '';
  Object.keys(teams).forEach(function (teamName) {
    var members = teams[teamName];
    /* Team divider */
    bodyHTML += '<tr class="m-team-row"><td class="m-res-cell m-team-label">' +
      '<span class="team-label">' + teamName + '</span></td>';
    for (var di = 0; di < totalDays; di++) bodyHTML += '<td></td>';
    bodyHTML += '</tr>';
    members.forEach(function (r) {
      bodyHTML += buildMonthResourceRow(r, days, bMap, lMap);
    });
  });

  /* --- Two-table layout: sticky header + scrollable body --- */
  var tblStyle = ' style="width:' + totalTableW + 'px;table-layout:fixed"';
  var html = '<div class="month-scroll">';
  /* Sticky header table */
  html += '<div class="month-header-sticky">';
  html += '<table class="month-table month-table-header"' + tblStyle + '>';
  html += colgroupHTML;
  html += '<thead>' + headerRowHTML + '</thead>';
  html += '</table></div>';
  /* Body table */
  html += '<table class="month-table month-table-body"' + tblStyle + '>';
  html += colgroupHTML;
  html += '<tbody>' + bodyHTML + '</tbody>';
  html += '</table></div>';
  return html;
}

function buildMonthSpans(days) {
  var spans = [];
  var curMonth = -1, curYear = -1, curSpan = 0;
  days.forEach(function (d) {
    var m = d.getMonth(), y = d.getFullYear();
    if (m === curMonth && y === curYear) {
      curSpan++;
    } else {
      if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan });
      curMonth = m; curYear = y; curSpan = 1;
    }
  });
  if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan });
  return spans;
}

function getWeekNumber(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function buildMonthResourceRow(r, days, bMap, lMap) {
  var initial = r.name.charAt(0);
  var avatarHtml = r.avatar
    ? '<img class="m-res-avatar" src="' + r.avatar + '" style="object-fit:cover;">'
    : '<div class="m-res-avatar" style="background:' + (r.color || '#3B7DDD') + '">' + initial + '</div>';

  var html = '<tr>';
  html += '<td class="m-res-cell"><div class="m-res-inner">' +
    avatarHtml +
    '<div><div class="m-res-name">' + esc(r.name) + '</div>' +
    '<div class="m-res-role">' + esc(r.role || '') + '</div></div>' +
  '</div></td>';

  // Detect spans for continuous bar rendering
  var spanInfo = detectSpans(r.id, days, bMap);

  days.forEach(function (d) {
    var dateStr = fmt(d);
    var key = r.id + '_' + dateStr;
    var dayBookings = (bMap[key] || []).slice().sort(function (a, b) {
      // Use sortIdx from spanInfo for consistent ordering with detectSpans
      var idxA = (spanInfo[a.id] && spanInfo[a.id].sortIdx !== undefined) ? spanInfo[a.id].sortIdx : 999;
      var idxB = (spanInfo[b.id] && spanInfo[b.id].sortIdx !== undefined) ? spanInfo[b.id].sortIdx : 999;
      return idxA - idxB;
    });
    var dayLeave = lMap[key];
    var weekend = isWeekend(d);

    var cellCls = 'm-day-cell';
    if (weekend) cellCls += ' m-weekend';

    html += '<td class="' + cellCls + '" data-resource="' + r.id + '" data-date="' + dateStr + '">';

    /* Leave block */
    if (dayLeave) {
      var leaveCls = 'm-leave';
      if (dayLeave.type === 'sick') leaveCls += ' sick';
      else if (dayLeave.type === 'personal') leaveCls += ' personal';
      else if (dayLeave.type === 'holiday') leaveCls += ' holiday';
      var leaveLabel = getLeaveLabel(dayLeave.type);
      html += '<div class="' + leaveCls + '" data-leave-id="' + dayLeave.id + '"' +
        ' title="' + escAttr(leaveLabel + (dayLeave.notes ? ': ' + dayLeave.notes : '')) + '">' +
        leaveLabel + '</div>';
    }

    /* Booking blocks */
    var totalH = 0;
    dayBookings.forEach(function (b) {
      totalH += b.hours;
      var projColor = b.project_color || '#6366F1';
      var bgColor = projColor + '30';

      var si = spanInfo[b.id];
      var spanCls = si && si.cls ? ' ' + si.cls : '';
      var showText = si ? si.showText : true;
      var hasBorderLeft = !si || si.cls === 'span-s' || !si.cls;
      var borderStyle = hasBorderLeft ? 'border-left:2px solid ' + projColor + ';' : '';

      var tooltipText = [
        t('schedule.project') + ': ' + b.project_name + (b.client_name ? ' (' + b.client_name + ')' : ''),
        b.scope_name ? t('schedule.work_scope') + ': ' + b.scope_name : null,
        t('schedule.hours_label') + ': ' + b.hours + 'h',
        b.created_by_name ? t('schedule.booker') + ': ' + b.created_by_name : null,
        b.notes ? t('common.notes') + ': ' + b.notes : null
      ].filter(Boolean).join('\n');
      html += '<div class="m-booking' + spanCls + '" data-booking-id="' + b.id + '"' +
        ' data-resource-id="' + b.resource_id + '"' +
        ' data-date="' + b.date + '"' +
        ' style="background:' + bgColor + ';' + borderStyle + '"' +
        ' title="' + escAttr(tooltipText) + '">';

      if (hasBorderLeft) {
        html += '<div class="resize-handle-left"></div>';
      }
      if (showText) {
        var displayName = b.client_name || b.project_name;
        var displayProj = displayName + (b.scope_name ? ' - ' + b.scope_name : '');
        html += '<span class="m-booking-hours">' + b.hours + 'h</span> ' +
          '<span class="booking-project">' + esc(truncate(displayProj, 18)) + '</span>';
      }
      // Show resize handle for end of span or solo booking (cls is null)
      if (!si || si.cls === 'span-e' || !si.cls) {
        html += '<div class="resize-handle"></div>';
      }
      // Show split handle for span-start and span-middle (split point between days)
      if (si && (si.cls === 'span-s' || si.cls === 'span-m')) {
        html += '<div class="split-handle" data-booking-id="' + b.id + '"></div>';
      }
      html += '</div>';
    });

    /* Utilization bar */
    if (totalH > 0 && !weekend) {
      var maxH = r.hours_per_day || 8;
      var pct = Math.min(Math.round((totalH / maxH) * 100), 100);
      var barCls = pct >= 100 ? 'red' : (pct >= 75 ? 'yellow' : 'green');
      html += '<div class="m-util-bar"><div class="m-util-fill ' + barCls + '" style="width:' + pct + '%"></div></div>';
    }

    html += '</td>';
  });

  html += '</tr>';
  return html;
}

/* --------------------------------------------------
   2. Navigation buttons
   -------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
  var prevBtn  = document.getElementById('schedule-prev');
  var nextBtn  = document.getElementById('schedule-next');
  var todayBtn = document.getElementById('schedule-today');
  var addBtn   = document.getElementById('btn-add-booking');

  /* Jump to the Monday of the week containing the 1st of a given month */
  function monthFirstMonday(year, month) {
    var first = new Date(year, month, 1);
    return getMonday(first);
  }

  /* Derive the "represented" month for a week-start Monday.
     When a month's 1st falls on Tue-Sun, its first Monday lands in the
     previous calendar month (e.g. July's first Monday is June 29).
     We detect this by checking whether the Sunday of that week has moved
     into the next month; if so, and the Monday is late in the month (>20),
     the week represents the next month. */
  function getRepresentedMonth(d) {
    var sunday = addDays(d, 6);
    if ((sunday.getMonth() !== d.getMonth() || sunday.getFullYear() !== d.getFullYear()) && d.getDate() > 20) {
      return { year: sunday.getFullYear(), month: sunday.getMonth() };
    }
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (state.scheduleView === 'month') {
        var rep = getRepresentedMonth(state.scheduleWeekStart);
        var y = rep.year;
        var m = rep.month - 1;
        if (m < 0) { m = 11; y--; }
        state.scheduleWeekStart = monthFirstMonday(y, m);
      } else {
        state.scheduleWeekStart = addDays(state.scheduleWeekStart, -7);
      }
      window.loadSchedule();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      if (state.scheduleView === 'month') {
        var rep = getRepresentedMonth(state.scheduleWeekStart);
        var y = rep.year;
        var m = rep.month + 1;
        if (m > 11) { m = 0; y++; }
        state.scheduleWeekStart = monthFirstMonday(y, m);
      } else {
        state.scheduleWeekStart = addDays(state.scheduleWeekStart, 7);
      }
      window.loadSchedule();
    });
  }
  if (todayBtn) {
    todayBtn.addEventListener('click', function () {
      if (state.scheduleView === 'month') {
        var now = new Date();
        state.scheduleWeekStart = monthFirstMonday(now.getFullYear(), now.getMonth());
      } else {
        state.scheduleWeekStart = getMonday(new Date());
      }
      window.loadSchedule();
    });
  }
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      showBookingModal();
    });
  }

  /* View toggle (week / month) */
  var viewToggle = document.getElementById('view-toggle');
  if (viewToggle) {
    viewToggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.view-btn');
      if (!btn) return;
      var view = btn.getAttribute('data-view');
      if (view === state.scheduleView) return;
      state.scheduleView = view;
      viewToggle.querySelectorAll('.view-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      /* Update the "today" button label */
      if (todayBtn) todayBtn.textContent = view === 'month' ? t('schedule.this_month') : t('schedule.this_week');
      /* Reset to current week's Monday */
      state.scheduleWeekStart = getMonday(new Date());
      /* Invalidate schedule cache so the new view fetches fresh data
         for its own date range (week vs month have different end dates) */
      if (window.apiCache) window.apiCache.invalidatePrefix('/api/schedule-data');
      window.loadSchedule();
    });
  }

  // Highlight all segments of the same booking on hover
  var lastHoveredId = null;
  document.addEventListener('mouseover', function (e) {
    var grid = document.getElementById('schedule-grid');
    if (!grid) return;
    var block = e.target.closest('.booking-block, .m-booking');
    if (!block) {
      if (lastHoveredId) {
        clearBookingHoverHighlight(lastHoveredId);
        lastHoveredId = null;
      }
      return;
    }
    var bid = block.dataset.bookingId;
    if (bid && bid !== lastHoveredId) {
      if (lastHoveredId) {
        clearBookingHoverHighlight(lastHoveredId);
      }
      highlightBookingSegments(bid);
      lastHoveredId = bid;
    }
  });

  document.addEventListener('mouseout', function (e) {
    var grid = document.getElementById('schedule-grid');
    if (!grid) return;
    var block = e.target.closest('.booking-block, .m-booking');
    if (block) {
      var related = e.relatedTarget && e.relatedTarget.closest('.booking-block, .m-booking');
      if (related && related.dataset.bookingId === block.dataset.bookingId) {
        return; // still hovering same booking
      }
    }
    if (lastHoveredId) {
      clearBookingHoverHighlight(lastHoveredId);
      lastHoveredId = null;
    }
  });

  function highlightBookingSegments(bookingId) {
    document.querySelectorAll('.booking-block[data-booking-id="' + bookingId + '"], .m-booking[data-booking-id="' + bookingId + '"]').forEach(function (el) {
      el.classList.add('hover-highlight');
    });
  }

  function clearBookingHoverHighlight(bookingId) {
    document.querySelectorAll('.booking-block[data-booking-id="' + bookingId + '"], .m-booking[data-booking-id="' + bookingId + '"]').forEach(function (el) {
      el.classList.remove('hover-highlight');
    });
  }
});

/* --------------------------------------------------
   3. showBookingModal — ResourceGuru-style with tabs
   -------------------------------------------------- */
