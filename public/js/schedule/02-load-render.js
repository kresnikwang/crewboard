/* schedule/02-load-render.js — part of schedule module (bundled into schedule.js) */
window.loadSchedule = async function loadSchedule() {
  if (loadSchedule._isLoading) return;
  loadSchedule._isLoading = true;

  if (!state.scheduleWeekStart) {
    state.scheduleWeekStart = getMonday(new Date());
  }

  var isMonth = state.scheduleView === 'month';
  var days;
  if (isMonth) {
    days = [];
    for (var w = 0; w < MONTH_WEEKS; w++) {
      for (var d = 0; d < 7; d++) {
        days.push(addDays(state.scheduleWeekStart, w * 7 + d));
      }
    }
  } else {
    days = weekDates(state.scheduleWeekStart);
  }

  var startStr = fmt(days[0]);
  var endStr   = fmt(days[days.length - 1]);

  /* Update range label */
  var rangeEl = document.getElementById('schedule-range');
  if (rangeEl) {
    var s = days[0], e = days[days.length - 1];
    var sMonth = s.getMonth() + 1, eMonth = e.getMonth() + 1;
    var sYear = s.getFullYear(), eYear = e.getFullYear();
    var currentYear = new Date().getFullYear();
    var rangeText;
    var showYear = (sYear !== currentYear || eYear !== currentYear);
    if (showYear) {
      rangeText = sYear + t('common.year') + sMonth + t('common.month') + s.getDate() + t('common.day') + ' - ' + eYear + t('common.year') + eMonth + t('common.month') + e.getDate() + t('common.day');
    } else if (sMonth !== eMonth) {
      rangeText = sMonth + t('common.month') + s.getDate() + t('common.day') + ' - ' + eMonth + t('common.month') + e.getDate() + t('common.day');
    } else {
      rangeText = sMonth + t('common.month') + s.getDate() + t('common.day') + ' - ' + e.getDate() + t('common.day');
    }
    rangeEl.textContent = rangeText;
  }

  /* Update today button label */
  var todayBtn = document.getElementById('schedule-today');
  if (todayBtn) todayBtn.textContent = isMonth ? t('schedule.this_month') : t('schedule.this_week');

  /* Single aggregated request with SWR caching.
     Returns cached data instantly on view/page switches;
     revalidates in background and re-renders if data changed. */
  var _scheduleUrl = '/api/schedule-data?start=' + startStr + '&end=' + endStr;
  var schedData;
  try {
    schedData = await cachedApi(_scheduleUrl, {
      maxAge: 30000,
      onRevalidate: function (freshData) {
        // Background refresh complete — only re-render if data actually changed
        var oldSig = _allBookings.reduce(function (s, b) { return s + b.id + ':' + b.hours + ':' + (b.is_tentative ? 1 : 0) + ','; }, '') + '|' + _allLeave.length;
        var newSig = freshData.bookings.reduce(function (s, b) { return s + b.id + ':' + b.hours + ':' + (b.is_tentative ? 1 : 0) + ','; }, '') + '|' + freshData.leave.length;
        if (oldSig !== newSig) {
          window.loadSchedule();
        }
      }
    });
  } catch (err) {
    console.error('[loadSchedule] API error:', err);
    if (window.showToast) window.showToast(t('schedule.load_failed') + ': ' + (err.message || t('schedule.unknown_error')), 'error');
    loadSchedule._isLoading = false;
    return;
  }

  var resources = schedData.resources;
  var bookings  = schedData.bookings;
  var leave     = schedData.leave;
  var holidays  = schedData.holidays;

  state.resources = resources;
  _allBookings = bookings;
  _allLeave    = leave;

  var teams = {};
  resources.forEach(function (r) {
    var tm = r.team || t('manage.ungrouped');
    if (!teams[tm]) teams[tm] = [];
    teams[tm].push(r);
  });

  var bMap = {};
  bookings.forEach(function (b) {
    var key = b.resource_id + '_' + b.date;
    if (!bMap[key]) bMap[key] = [];
    bMap[key].push(b);
  });

  var lMap = {};
  leave.forEach(function (l) {
    var key = l.resource_id + '_' + l.date;
    lMap[key] = l;
  });

  var hMap = holidays || {};
  var html;

  if (isMonth) {
    html = buildMonthView(days, teams, bMap, lMap, hMap, resources);
  } else {
    html = buildHeaderHTML(days, hMap);
    html += buildBodyHTML(days, teams, bMap, lMap);
    html += '</tbody></table>';
  }

  var grid = document.getElementById('schedule-grid');
  /* Preserve scroll position across re-renders (mutations, SSE, SWR). */
  var prevScrollTop = grid ? grid.scrollTop : 0;
  var prevScrollLeft = grid ? grid.scrollLeft : 0;
  var monthScrollEl = grid && grid.querySelector('.month-scroll');
  var prevMonthTop = monthScrollEl ? monthScrollEl.scrollTop : 0;
  var prevMonthLeft = monthScrollEl ? monthScrollEl.scrollLeft : 0;

  grid.innerHTML = html;
  /* Month view: let .month-scroll be the sole scroll container
     so that sticky headers work correctly. Week view: .schedule-grid
     itself scrolls. */
  grid.style.overflow = isMonth ? 'hidden' : '';

  requestAnimationFrame(function () {
    if (!grid) return;
    if (isMonth) {
      var ms = grid.querySelector('.month-scroll');
      if (ms) {
        ms.scrollTop = prevMonthTop;
        ms.scrollLeft = prevMonthLeft;
      }
    } else {
      grid.scrollTop = prevScrollTop;
      grid.scrollLeft = prevScrollLeft;
    }
  });

  var addBtn = document.getElementById('btn-add-booking');
  if (addBtn) {
    var perms = window.state.permissions || {};
    addBtn.style.display = perms.book_others ? '' : 'none';
  }

  /* attach click on empty areas of booking cells */
  document.querySelectorAll('.booking-cell, .m-day-cell').forEach(function (cell) {
    cell.addEventListener('click', function (e) {
      if (e.target.closest('.booking-block')) return;
      if (e.target.closest('.leave-block')) return;
      if (e.target.closest('.m-booking')) return;
      if (e.target.closest('.m-leave')) return;
      var rid  = parseInt(cell.dataset.resource, 10);
      var date = cell.dataset.date;
      if (!rid || !date) return;
      if (!canBookForResource(rid)) return;
      showBookingModal(null, rid, date);
    });
  });

  /* Mouse drag selection for multiple days */
  var scheduleGrid = document.getElementById('schedule-grid');
  if (scheduleGrid) {
    initDragSelection(scheduleGrid);
  }

  /* attach click on booking blocks in month view */
  document.querySelectorAll('.m-booking[data-booking-id]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      var bookingId = parseInt(el.dataset.bookingId, 10);
      window.editBooking(bookingId);
    });
  });

  /* attach click on leave blocks for editing */
  document.querySelectorAll('.leave-block[data-leave-id], .m-leave[data-leave-id]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      var leaveId = parseInt(el.dataset.leaveId, 10);
      var leaveEntry = _allLeave.find(function (l) { return l.id === leaveId; });
      if (leaveEntry) {
        showEditLeaveModal(leaveEntry);
      }
    });
  });

  /* attach RIGHT resize handlers to booking blocks */
  document.querySelectorAll('.booking-block .resize-handle, .m-booking .resize-handle').forEach(function (handle) {
    handle.addEventListener('mousedown', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var block = e.target.closest('.booking-block, .m-booking');
      if (!block) return;

      var bookingId = parseInt(block.dataset.bookingId, 10);
      var booking = _allBookings.find(function (b) { return b.id === bookingId; });
      if (!booking) return;

      if (!canBookForResource(booking.resource_id)) {
        toast(t('schedule.no_edit_permission'), 'error');
        return;
      }

      initResizeBooking(block, booking, e);
    });
  });

  /* attach LEFT resize handlers to booking blocks */
  document.querySelectorAll('.booking-block .resize-handle-left, .m-booking .resize-handle-left').forEach(function (handle) {
    handle.addEventListener('mousedown', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var block = e.target.closest('.booking-block, .m-booking');
      if (!block) return;

      var bookingId = parseInt(block.dataset.bookingId, 10);
      var booking = _allBookings.find(function (b) { return b.id === bookingId; });
      if (!booking) return;

      if (!canBookForResource(booking.resource_id)) {
        toast(t('schedule.no_edit_permission'), 'error');
        return;
      }

      initResizeBookingLeft(block, booking, e);
    });
  });

  /* attach split handlers */
  document.querySelectorAll('.split-handle').forEach(function (handle) {
    handle.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var bookingId = parseInt(handle.dataset.bookingId, 10);
      if (bookingId) {
        window.splitBooking(bookingId);
      }
    });
  });

  /* attach move (drag) handlers to booking block bodies */
  document.querySelectorAll('.booking-block, .m-booking').forEach(function (block) {
    block.addEventListener('mousedown', function (e) {
      // Ignore if clicking on the resize handle (left or right) or split handle
      if (e.target.closest('.resize-handle') || e.target.closest('.resize-handle-left') || e.target.closest('.split-handle')) return;
      // Only primary mouse button
      if (e.button !== 0) return;

      var bookingId = parseInt(block.dataset.bookingId, 10);
      var booking = _allBookings.find(function (b) { return b.id === bookingId; });
      if (!booking) return;

      if (!canBookForResource(booking.resource_id)) return;

      // Prevent browser text-selection during drag without blocking the click event
      e.preventDefault();

      // We start a potential move — but only commit if mouse moves > 5px
      var startX = e.clientX;
      var startY = e.clientY;
      var moveStarted = false;

      function onMoveStart(ev) {
        var dx = Math.abs(ev.clientX - startX);
        var dy = Math.abs(ev.clientY - startY);
        if (dx > 5 || dy > 5) {
          // Threshold crossed — start real move
          document.removeEventListener('mousemove', onMoveStart);
          document.removeEventListener('mouseup',   onMoveCancel);
          moveStarted = true;
          e.preventDefault();
          e.stopPropagation();
          initMoveBooking(block, booking, ev);
        }
      }

      function onMoveCancel() {
        document.removeEventListener('mousemove', onMoveStart);
        document.removeEventListener('mouseup',   onMoveCancel);
      }

      document.addEventListener('mousemove', onMoveStart);
      document.addEventListener('mouseup',   onMoveCancel);
    });
  });

  loadSchedule._isLoading = false;
};

/* --------------------------------------------------
   Table header builder
   -------------------------------------------------- */
function buildHeaderHTML(days, hMap) {
  var html = '<table class="schedule-table"><thead><tr><th>' + t('schedule.resource') + '</th>';
  days.forEach(function (d) {
    var cls = [];
    if (isToday(d))   cls.push('today');
    if (isWeekend(d))  cls.push('weekend');
    var dateStr = fmt(d);
    var holiday = hMap[dateStr];
    var holidayHTML = '';
    if (holiday) {
      if (holiday.type === 'workday') {
        holidayHTML = '<br><span class="holiday-marker workday">' + t('schedule.leave_makeup') + '</span>';
      } else {
        holidayHTML = '<br><span class="holiday-marker holiday">' + holiday.name + '</span>';
      }
    }
    html += '<th class="' + cls.join(' ') + '">' +
      shortDay(d) + '<br>' + fmtDate(d) + holidayHTML + '</th>';
  });
  html += '</tr></thead><tbody>';
  return html;
}

/* --------------------------------------------------
   Table body builder
   -------------------------------------------------- */
function buildBodyHTML(days, teams, bMap, lMap) {
  var html = '';
  var colCount = days.length + 1;

  Object.keys(teams).forEach(function (teamName) {
    var members = teams[teamName];
    html += '<tr class="team-divider"><td>' +
      '<span class="team-label">' + teamName + '</span></td>';
    for (var di = 0; di < days.length; di++) html += '<td></td>';
    html += '</tr>';
    members.forEach(function (r) {
      html += buildResourceRow(r, days, bMap, lMap);
    });
  });

  return html;
}

/* --------------------------------------------------
   Detect continuous booking spans for a resource.
   Returns a map: bookingId -> { cls: 'span-s'|'span-m'|'span-e', showText: bool, spanLen: number, sortIdx: number }
   A span is consecutive days with same (project_id, hours, is_tentative).
   Bookings are sorted by spanLen (desc) so longer spans appear on top.
   -------------------------------------------------- */
function detectSpans(resourceId, days, bMap) {
  var info = {};
  var dateFmts = days.map(fmt);

  // Build raw booking lists per day
  var rawDayLists = dateFmts.map(function (dateStr) {
    var key = resourceId + '_' + dateStr;
    return (bMap[key] || []).slice();
  });

  // Helper: find booking for a specific date from _allBookings (not just current view)
  var matchFnBuilder = function (b) {
    return function (other) {
      return other.project_id === b.project_id &&
             parseFloat(other.hours) === parseFloat(b.hours) &&
             !!other.is_tentative === !!b.is_tentative;
    };
  };

  // Helper: check if there's a booking on a specific date (from _allBookings, not just current view)
  var hasBookingOnDate = function (dateStr, matchFn) {
    // Use _allBookings directly to find bookings outside current view
    return _allBookings.some(function (b) {
      return b.resource_id === resourceId && b.date === dateStr && matchFn(b);
    });
  };

  // First pass: identify all spans and calculate their lengths (using full dataset)
  var spanLengths = {}; // bookingId -> span length (in days)
  var spanStartDate = {}; // bookingId -> start date of span
  var spanEndDate = {}; // bookingId -> end date of span
  var processed = {}; // track which booking ids have been processed

  for (var di = 0; di < dateFmts.length; di++) {
    rawDayLists[di].forEach(function (b) {
      if (processed[b.id]) return;

      var matchFn = matchFnBuilder(b);

      // Find the full span for this booking (extend beyond current view if needed)
      var spanIds = [b.id];
      var startDate = b.date;
      var endDate = b.date;

      // Look backward for more bookings in this span (outside current view)
      var prevDate = new Date(b.date);
      prevDate.setDate(prevDate.getDate() - 1);
      while (true) {
        var prevDateStr = fmt(prevDate);
        var prevBooking = _allBookings.find(function (ob) {
          return ob.resource_id === resourceId &&
                 ob.date === prevDateStr &&
                 matchFn(ob);
        });
        if (!prevBooking) break;
        // Check if prevBooking has split_after (can't extend past split)
        if (prevBooking.split_after === 1 || prevBooking.split_after === true) break;
        spanIds.unshift(prevBooking.id);
        startDate = prevDateStr;
        prevDate.setDate(prevDate.getDate() - 1);
      }

      // Look forward for more bookings in this span
      var nextDate = new Date(b.date);
      nextDate.setDate(nextDate.getDate() + 1);
      while (true) {
        var nextDateStr = fmt(nextDate);
        var nextBooking = _allBookings.find(function (ob) {
          return ob.resource_id === resourceId &&
                 ob.date === nextDateStr &&
                 matchFn(ob);
        });
        if (!nextBooking) break;
        // Check for split point (this booking has split_after)
        var currBooking = _allBookings.find(function (ob) {
          return ob.id === spanIds[spanIds.length - 1];
        });
        if (currBooking && (currBooking.split_after === 1 || currBooking.split_after === true)) break;
        spanIds.push(nextBooking.id);
        endDate = nextDateStr;
        nextDate.setDate(nextDate.getDate() + 1);
      }

      // Record span info for all bookings in this span
      spanIds.forEach(function (id) {
        spanLengths[id] = spanIds.length;
        spanStartDate[id] = startDate;
        spanEndDate[id] = endDate;
      });
      processed[b.id] = true;
    });
  }

  // Second pass: detect group bookings (same project + same dates, multiple resources)
  var isGroupBooking = {}; // bookingId -> boolean
  for (var di = 0; di < dateFmts.length; di++) {
    rawDayLists[di].forEach(function (b) {
      if (isGroupBooking[b.id] !== undefined) return; // already computed

      var start = spanStartDate[b.id] || b.date;
      var end = spanEndDate[b.id] || b.date;

      // Check if any other resource has the same project in the same date range
      var isGroup = _allBookings.some(function (other) {
        if (other.id === b.id) return false;
        if (other.project_id !== b.project_id) return false;
        if (other.resource_id === resourceId) return false; // must be different resource
        // Check if dates overlap
        var otherStart = spanStartDate[other.id] || other.date;
        var otherEnd = spanEndDate[other.id] || other.date;
        return start <= otherEnd && otherStart <= end;
      });
      isGroupBooking[b.id] = isGroup;
    });
  }

  // Third pass: sort each day by group booking first, then by spanLen (desc)
  var dayLists = rawDayLists.map(function (list, di) {
    return list.slice().sort(function (a, b) {
      var groupA = isGroupBooking[a.id] ? 1 : 0;
      var groupB = isGroupBooking[b.id] ? 1 : 0;
      var lenA = spanLengths[a.id] || 1;
      var lenB = spanLengths[b.id] || 1;
      // Group booking first, then longer spans on top
      return groupB - groupA || lenB - lenA || a.project_id - b.project_id || a.hours - b.hours || a.id - b.id;
    });
  });

  // Fourth pass: assign span classes based on full span info (not just current view)
  for (var di = 0; di < dateFmts.length; di++) {
    dayLists[di].forEach(function (b, sortIdx) {
      var matchFn = matchFnBuilder(b);
      var bDate = b.date;
      var startDate = spanStartDate[b.id] || bDate;
      var endDate = spanEndDate[b.id] || bDate;

      // Check if there's a previous day in the span (outside view if needed)
      var prevDate = new Date(bDate);
      prevDate.setDate(prevDate.getDate() - 1);
      var prevDateStr = fmt(prevDate);
      var hasPrev = prevDateStr >= startDate && prevDateStr < bDate &&
                    hasBookingOnDate(prevDateStr, matchFn);

      // Check if there's a next day in the span (outside view if needed)
      var nextDate = new Date(bDate);
      nextDate.setDate(nextDate.getDate() + 1);
      var nextDateStr = fmt(nextDate);
      var hasNext = nextDateStr > bDate && nextDateStr <= endDate &&
                    hasBookingOnDate(nextDateStr, matchFn);

      // Check if this booking is after a split point
      var isAfterSplit = false;
      if (hasPrev) {
        var prevBooking = _allBookings.find(function (ob) {
          return ob.resource_id === resourceId &&
                 ob.date === prevDateStr &&
                 matchFn(ob);
        });
        isAfterSplit = prevBooking && (prevBooking.split_after === 1 || prevBooking.split_after === true);
      }

      // Force span-e if this booking has split_after flag
      var isSplitPoint = b.split_after === 1 || b.split_after === true;

      // split_after only affects the RIGHT side (no visual connection to next day)
      // It does NOT affect the LEFT side (can still be span-m or span-e if hasPrev)
      // isAfterSplit affects the LEFT side (treat as new span start)
      var effectiveHasNext = hasNext && !isSplitPoint;
      var effectiveHasPrev = hasPrev && !isAfterSplit;

      var cls = null;
      if (effectiveHasPrev && effectiveHasNext) {
        cls = 'span-m';
      } else if (effectiveHasPrev && !effectiveHasNext) {
        cls = 'span-e';
      } else if (!effectiveHasPrev && effectiveHasNext) {
        cls = 'span-s';
      }
      // else: solo booking (cls = null), has both left and right resize handles

      info[b.id] = {
        cls: cls,
        showText: true, // every day cell shows project name
        spanLen: spanLengths[b.id] || 1,
        sortIdx: sortIdx  // Store the sort index for consistent ordering
      };
    });
  }
  return info;
}

/* --------------------------------------------------
   Find the contiguous booking span containing `booking`.
   Mirrors detectSpans / splitBooking:
   - same resource + project + hours + is_tentative
   - only consecutive calendar days (dayDiff === 1), NOT weekend bridging
   - respects split_after markers
   Always returns at least [booking] when booking is valid.
   -------------------------------------------------- */
function findBookingSpanSegment(booking) {
  if (!booking) return [];

  var resourceId = booking.resource_id;
  var targetProject = booking.project_id;
  var targetHours = parseFloat(booking.hours);
  var targetTentative = !!booking.is_tentative;
  var matchFn = function (b) {
    return b.resource_id === resourceId &&
           b.project_id === targetProject &&
           parseFloat(b.hours) === targetHours &&
           !!b.is_tentative === targetTentative;
  };

  // Walk backward to span start
  var spanStart = new Date(booking.date);
  while (true) {
    var prevD = new Date(spanStart);
    prevD.setDate(prevD.getDate() - 1);
    var prevStr = fmt(prevD);
    var prevBk = _allBookings.find(function (b) { return b.date === prevStr && matchFn(b); });
    if (!prevBk) break;
    // Cannot extend past a split point on the previous day
    if (prevBk.split_after === 1 || prevBk.split_after === true) break;
    spanStart = prevD;
  }

  // Walk forward from span start, collecting bookings
  var segment = [];
  var cur = new Date(spanStart);
  while (true) {
    var curStr = fmt(cur);
    var curBk = _allBookings.find(function (b) { return b.date === curStr && matchFn(b); });
    if (!curBk) break;
    segment.push(curBk);
    if (curBk.split_after === 1 || curBk.split_after === true) break;
    cur.setDate(cur.getDate() + 1);
  }

  // Safety: ensure the original booking is included
  if (segment.length === 0) return [booking];
  if (!segment.some(function (b) { return b.id === booking.id; })) return [booking];
  return segment;
}

/* --------------------------------------------------
   Get span group for a booking: returns array of bookings
   that form a continuous span with same (project_id, hours, is_tentative)
   Respects visual split markers (span-e ends a group)
   Only returns multi-day groups (null for solo bookings) — used by edit modal.
   -------------------------------------------------- */
function getSpanGroup(bookingId, bMap, days) {
  var target = _allBookings.find(function (b) { return b.id === bookingId; });
  if (!target) return null;

  var group = findBookingSpanSegment(target);
  if (!group || group.length <= 1) return null;

  // Optionally restrict to bookings visible in current view (edit modal context)
  if (days && days.length) {
    var dateFmts = days.map(fmt);
    group = group.filter(function (b) { return dateFmts.indexOf(b.date) >= 0; });
    if (group.length <= 1) return null;
  }
  return group;
}

/* --------------------------------------------------
   Single resource row
   -------------------------------------------------- */
function buildResourceRow(r, days, bMap, lMap) {
  var initial = r.name.charAt(0);
  var avatarHtml = r.avatar
    ? '<img class="resource-avatar" src="' + r.avatar + '" style="object-fit:cover;">'
    : '<div class="resource-avatar" style="background:' + (r.color || '#3B7DDD') + '">' + initial + '</div>';

  var html = '<tr>' +
    '<td><div class="resource-cell">' +
      avatarHtml +
      '<div class="resource-info">' +
        '<div class="resource-name">' + r.name + '</div>' +
        '<div class="resource-role">' + (r.role || '') + '</div>' +
      '</div>' +
    '</div></td>';

  // Detect spans for continuous bar rendering
  var spanInfo = detectSpans(r.id, days, bMap);

  days.forEach(function (d) {
    var dateStr = fmt(d);
    var key = r.id + '_' + dateStr;
    var dayBookings = (bMap[key] || []).slice().sort(function (a, b) {
      // Use sortIdx from spanInfo: longer spans appear on top
      var idxA = (spanInfo[a.id] && spanInfo[a.id].sortIdx !== undefined) ? spanInfo[a.id].sortIdx : 999;
      var idxB = (spanInfo[b.id] && spanInfo[b.id].sortIdx !== undefined) ? spanInfo[b.id].sortIdx : 999;
      return idxA - idxB;
    });
    var dayLeave    = lMap[key];

    var cellCls = 'booking-cell';
    if (isWeekend(d)) cellCls += ' weekend';

    html += '<td class="' + cellCls + '" data-resource="' + r.id + '" data-date="' + dateStr + '">';

    /* leave block */
    if (dayLeave) {
      var leaveLabel = getLeaveLabel(dayLeave.type);
      var leaveCls = 'booking-block leave-block';
      if (dayLeave.type === 'sick') leaveCls += ' sick';
      else if (dayLeave.type === 'personal') leaveCls += ' personal';
      else if (dayLeave.type === 'holiday') leaveCls += ' holiday';
      html += '<div class="' + leaveCls + '" data-leave-id="' + dayLeave.id + '"' +
        ' title="' + escAttr(leaveLabel + (dayLeave.notes ? ': ' + dayLeave.notes : '')) + '">' +
        leaveLabel + '</div>';
    }

    /* booking blocks */
    var totalH = 0;
    dayBookings.forEach(function (b) {
      totalH += b.hours;
      var tentCls = b.is_tentative ? ' tentative' : '';
      var projColor = b.project_color || '#6366F1';
      var bgColor = projColor + '30';

      var si = spanInfo[b.id];
      var spanCls = si && si.cls ? ' ' + si.cls : '';
      var showText = si ? si.showText : true;
      // Only span-start (or solo) gets the left colored border
      // Solo booking (cls is null) should also have left border and resize handles
      var hasBorderLeft = !si || si.cls === 'span-s' || !si.cls;
      var borderStyle = hasBorderLeft ? 'border-left:3px solid ' + projColor + ';' : '';

      var tooltipLines = [
        t('schedule.project') + ': ' + b.project_name + (b.client_name ? ' (' + b.client_name + ')' : ''),
        b.scope_name ? t('schedule.work_scope') + ': ' + b.scope_name : null,
        t('schedule.hours_label') + ': ' + b.hours + 'h',
        b.created_by_name ? t('schedule.booker') + ': ' + b.created_by_name : null,
        b.notes ? t('common.notes') + ': ' + b.notes : null
      ].filter(Boolean).join('\n');

      html += '<div class="booking-block' + tentCls + spanCls + '"' +
        ' style="background:' + bgColor + ';' + borderStyle + '"' +
        ' data-booking-id="' + b.id + '"' +
        ' data-resource-id="' + b.resource_id + '"' +
        ' data-date="' + b.date + '"' +
        ' onclick="window.editBooking(' + b.id + ')"' +
        ' title="' + escAttr(tooltipLines) + '">';

      if (hasBorderLeft) {
        html += '<div class="resize-handle-left"></div>';
      }
      if (showText) {
        var displayProj = b.project_name + (b.scope_name ? ' - ' + b.scope_name : '');
        html += '<span class="booking-hours">' + b.hours + 'h</span> ' +
          '<span class="booking-project" title="' + escAttr(displayProj + (b.client_name ? ' (' + b.client_name + ')' : '')) + '">' + esc(truncate(displayProj, 25)) + '</span>';
      }
      // Show resize handle for end of span or solo booking (cls is null)
      if (!si || si.cls === 'span-e' || !si.cls) {
        html += '<div class="resize-handle"></div>';
      }
      // Show split handle for span-start and span-middle (split point between days)
      if (si && (si.cls === 'span-s' || si.cls === 'span-m')) {
        html += '<div class="split-handle" data-booking-id="' + b.id + '" title="' + escAttr(t('schedule.split_booking')) + '"></div>';
      }
      html += '</div>';
    });

    if (totalH > 0) {
      var overCls = totalH > (r.hours_per_day || 8) ? ' overbooked' : '';
      html += '<span class="day-total' + overCls + '">' + totalH + 'h</span>';
    }

    html += '</td>';
  });

  html += '</tr>';
  return html;
}

function getLeaveLabel(type) {
  var labels = { vacation: t('schedule.leave_label'), sick: t('schedule.leave_sick'), personal: t('schedule.leave_personal'), holiday: t('schedule.leave_holiday'), other: t('schedule.leave_other') };
  return labels[type] || t('schedule.leave_label');
}

/* --------------------------------------------------
   Resize booking duration (ResourceGuru style)
   -------------------------------------------------- */
