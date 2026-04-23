/* ============================================================
   schedule.js — Schedule / Calendar page module
   ResourceGuru-style booking & time-off modal
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;
  var cachedApi = window.cachedApi;

  /** Invalidate schedule caches and reload. Call after any booking/leave mutation. */
  function reloadAfterMutation() {
    if (window.apiCache) {
      window.apiCache.invalidatePrefix('/api/schedule-data');
      window.apiCache.invalidatePrefix('/api/bookings');
    }
    window.loadSchedule();
  }

  /* ---- cached bookings & leave used by edit lookup ---- */
  var _allBookings = [];
  var _allLeave    = [];
  /* expose to window so saveBooking (outside IIFE) can access */
  Object.defineProperty(window, '_allLeave', {
    get: function () { return _allLeave; },
    configurable: true
  });

  /* ---- view mode: 'week' or 'month' ---- */
  if (!state.scheduleView) state.scheduleView = 'week';
  var MONTH_WEEKS = 4; /* show 4 weeks in month view */

  /* --------------------------------------------------
     1. loadSchedule — main render function
     -------------------------------------------------- */
  window.loadSchedule = async function loadSchedule() {
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
      var rangeText;
      if (sYear !== eYear) {
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
    var schedData = await cachedApi(_scheduleUrl, {
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

    document.getElementById('schedule-grid').innerHTML = html;

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
          showText: true,
          spanLen: spanLengths[b.id] || 1,
          sortIdx: sortIdx  // Store the sort index for consistent ordering
        };
      });
    }
    return info;
  }

  /* --------------------------------------------------
     Get span group for a booking: returns array of bookings
     that form a continuous span with same (project_id, hours, is_tentative)
     Respects visual split markers (span-e ends a group)
     -------------------------------------------------- */
  function getSpanGroup(bookingId, bMap, days) {
    var target = _allBookings.find(function (b) { return b.id === bookingId; });
    if (!target) return null;

    var resourceId = target.resource_id;
    var dateFmts = days.map(fmt);

    // Find all bookings for this resource in current view
    // Filter bookings for this resource and target's project
    // Same project + same hours + same tentative status forms a group
    var targetProjectId = target.project_id;
    var targetHours = target.hours;
    var targetTentative = target.is_tentative;

    var resourceBookings = _allBookings.filter(function (b) {
      return b.resource_id === resourceId &&
             dateFmts.indexOf(b.date) >= 0 &&
             b.project_id === targetProjectId &&
             parseFloat(b.hours) === parseFloat(targetHours) &&
             !!b.is_tentative === !!targetTentative;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });

    // Group consecutive bookings, respecting split_after markers
    var groups = [];
    var currentGroup = [];

    for (var i = 0; i < resourceBookings.length; i++) {
      var b = resourceBookings[i];
      if (currentGroup.length === 0) {
        currentGroup.push(b);
      } else {
        var last = currentGroup[currentGroup.length - 1];
        var lastDate = new Date(last.date);
        var curDate = new Date(b.date);
        var dayDiff = Math.round((curDate - lastDate) / 86400000);

        // Check if last booking has split_after flag (persisted split marker)
        var isSplitAfter = last.split_after === 1 || last.split_after === true;

        if (dayDiff === 1 && !isSplitAfter) {
          currentGroup.push(b);
        } else {
          groups.push(currentGroup);
          currentGroup = [b];
        }
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    // Find which group contains the target booking
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (group.some(function (b) { return b.id === bookingId; })) {
        return group.length > 1 ? group : null; // Only return if it's a multi-day span
      }
    }
    return null;
  }

  /* --------------------------------------------------
     Single resource row
     -------------------------------------------------- */
  function buildResourceRow(r, days, bMap, lMap) {
    var initial = r.name.charAt(0);
    var html = '<tr>' +
      '<td><div class="resource-cell">' +
        '<div class="resource-avatar" style="background:' + (r.color || '#4F46E5') + '">' + initial + '</div>' +
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

        html += '<div class="booking-block' + tentCls + spanCls + '"' +
          ' style="background:' + bgColor + ';' + borderStyle + '"' +
          ' data-booking-id="' + b.id + '"' +
          ' data-resource-id="' + b.resource_id + '"' +
          ' data-date="' + b.date + '"' +
          ' onclick="window.editBooking(' + b.id + ')"' +
          ' title="' + escAttr(b.project_name) + ' - ' + b.hours + 'h' +
            (b.notes ? '\n' + escAttr(b.notes) : '') + '">';

        if (hasBorderLeft) {
          html += '<div class="resize-handle-left"></div>';
        }
        if (showText) {
          html += '<span class="booking-hours">' + b.hours + 'h</span> ' +
            '<span class="booking-project" title="' + escAttr(b.project_name + (b.client_name ? ' (' + b.client_name + ')' : '')) + '">' + esc(truncate(b.project_name, 25)) + '</span>';
        }
        // Show resize handle for end of span or solo booking (cls is null)
        if (!si || si.cls === 'span-e' || !si.cls) {
          html += '<div class="resize-handle"></div>';
        }
        // Show split handle for span-start and span-middle (split point between days)
        if (si && (si.cls === 'span-s' || si.cls === 'span-m')) {
          html += '<div class="split-handle" data-booking-id="' + b.id + '" title="Split Booking"></div>';
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
  function initResizeBooking(blockElement, booking, startEvent) {
    var isResizing = true;
    var startX = startEvent.clientX; // 记录起始 X 坐标，用于判断向左缩短的意图

    // ── 1. 收集当前视图中该资源所有日期格 ──────────────────────────
    var scheduleGrid = document.getElementById('schedule-grid');
    var selector = '.booking-cell[data-resource="' + booking.resource_id +
      '"], .m-day-cell[data-resource="' + booking.resource_id + '"]';
    var allCells = Array.prototype.slice.call(scheduleGrid.querySelectorAll(selector));

    // 按日期排序，建立 date→cell 映射
    var dateMap = {};
    allCells.forEach(function (c) { dateMap[c.dataset.date] = c; });
    var dates = Object.keys(dateMap).sort();

    var originalIndex = dates.indexOf(booking.date);
    if (originalIndex === -1) return; // 安全检查

    // ── 2. 找出当前预定块所属的「连续同项目 booking」范围 ──────────
    // 用于向左缩短时知道哪些 booking 可以删除
    // 这里只需要知道原始日期即可，缩短时删除从 newEnd+1 到 originalDate 的 bookings
    // 同时获取该段的结束日期（处理跨周边界的情况）
    var sameProjectBookings = _allBookings.filter(function (b) {
      return b.resource_id === booking.resource_id &&
             b.project_id  === booking.project_id;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });

    // 找包含当前 booking 的连续段（需要检查 split_after 标记）
    var endDate = booking.date;
    for (var i = 0; i < sameProjectBookings.length; i++) {
      if (sameProjectBookings[i].date === booking.date) {
        // 从这个 booking 往后找连续的
        endDate = booking.date;
        for (var j = i; j < sameProjectBookings.length; j++) {
          if (j === i) {
            endDate = sameProjectBookings[j].date;
            // 如果当前 booking 有 split_after，停止延伸
            if (sameProjectBookings[j].split_after === 1 || sameProjectBookings[j].split_after === true) {
              break;
            }
          } else {
            var prevBooking = sameProjectBookings[j-1];
            var prevDate = new Date(prevBooking.date);
            var currDate = new Date(sameProjectBookings[j].date);
            var diffDays = (currDate - prevDate) / 86400000;
            // 允许跨过周末（diffDays <= 3），但要检查前一个 booking 是否有 split_after
            if (diffDays <= 3 && !(prevBooking.split_after === 1 || prevBooking.split_after === true)) {
              endDate = sameProjectBookings[j].date;
            } else {
              break;
            }
          }
        }
        break;
      }
    }

    // ── 3. 视觉状态 ────────────────────────────────────────────────
    blockElement.classList.add('resizing');

    // 在 overlay 创建之前捕获 booking block 的 offset（相对于 td），overlay 之后 getBoundingClientRect 不可靠
    var _barTop    = blockElement.offsetTop;
    var _barHeight = blockElement.offsetHeight;

    // 全屏透明遮罩，锁定 cursor 并阻止其他事件
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;user-select:none;';
    document.body.appendChild(overlay);

    // 高亮预览：在目标 cell 内插入与 booking 同高的 bar，而非高亮整个 cell
    var previewCells = [];
    var lastClientX = startX; // 跟踪鼠标 X 坐标

    function clearPreview() {
      previewCells.forEach(function (c) {
        var bar = c.querySelector('.resize-preview-bar');
        if (bar) bar.parentNode.removeChild(bar);
      });
      previewCells = [];
    }

    function addBar(cell, isShrink) {
      var bar = document.createElement('div');
      bar.className = 'resize-preview-bar ' + (isShrink ? 'shrink' : 'extend');
      bar.style.top    = _barTop    + 'px';
      bar.style.height = _barHeight + 'px';
      cell.appendChild(bar);
      previewCells.push(cell);
    }

    function applyPreview(hoverIndex, isShrinkIntent) {
      clearPreview();
      var isShrink = hoverIndex < originalIndex || (hoverIndex === originalIndex && isShrinkIntent);
      if (hoverIndex === originalIndex && !isShrinkIntent) return; // 没有变化，不高亮

      if (isShrink && hoverIndex === originalIndex) {
        // 向左缩短但还在同一格子（视图边界），高亮当前格子表示将被删除
        var c = dateMap[dates[originalIndex]];
        if (c) addBar(c, true);
      } else {
        // 延长：高亮 originalIndex+1 到 hoverIndex（新增的天）
        // 缩短：高亮 hoverIndex+1 到 originalIndex（将被删除的天）
        var lo = isShrink ? hoverIndex + 1 : originalIndex + 1;
        var hi = isShrink ? originalIndex  : hoverIndex;
        for (var i = lo; i <= hi; i++) {
          var c = dateMap[dates[i]];
          if (c) addBar(c, isShrink);
        }
      }
    }

    var currentHoverIndex = originalIndex;
    var isShrinkIntent = false; // 跟踪用户是否有向左缩短的意图

    // ── 4. mousemove：用 elementFromPoint 追踪悬停格（rAF 节流）───
    var _rafRight = null;
    function handleMouseMove(e) {
      if (!isResizing) return;
      e.preventDefault();
      lastClientX = e.clientX;
      // 检测向左缩短意图：鼠标向左移动超过 30px
      isShrinkIntent = e.clientX < startX - 30;

      if (_rafRight) return;
      _rafRight = requestAnimationFrame(function () {
        _rafRight = null;

        // 暂时隐藏遮罩以穿透取到下方元素
        overlay.style.pointerEvents = 'none';
        var el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = '';

        if (!el) return;
        var cell = el.closest('.booking-cell, .m-day-cell');
        if (!cell) return;

        // 必须是同一资源
        if (parseInt(cell.dataset.resource, 10) !== booking.resource_id) return;

        var hoverDate = cell.dataset.date;
        var hoverIndex = dates.indexOf(hoverDate);
        if (hoverIndex === -1) return;

        // 更新预览（即使 hoverIndex 没变，但 isShrinkIntent 可能变了）
        if (hoverIndex !== currentHoverIndex || isShrinkIntent) {
          currentHoverIndex = hoverIndex;
          applyPreview(hoverIndex, isShrinkIntent);
        }
      });
    }

    // ── 5. mouseup：执行实际操作 ───────────────────────────────────
    function handleMouseUp(e) {
      if (!isResizing) return;
      cleanup();

      // 检查是否有实际移动：要么 index 变化，要么鼠标向左移动了足够距离
      var movedLeft = e.clientX < startX - 30; // 向左移动超过 30px
      var hasMoved = currentHoverIndex !== originalIndex || movedLeft;

      if (!hasMoved) return; // 没有移动，不操作

      if (currentHoverIndex > originalIndex) {
        // ── 向右：延长 ──
        // 在 originalIndex+1 ~ currentHoverIndex 的每一天创建相同项目的 booking
        var promises = [];
        for (var i = originalIndex + 1; i <= currentHoverIndex; i++) {
          var d = dates[i];
          // 跳过已有同项目 booking 的日期（避免重复）
          var existingKey = booking.resource_id + '_' + d;
          var alreadyBooked = _allBookings.some(function (b) {
            return b.resource_id === booking.resource_id &&
                   b.project_id === booking.project_id &&
                   b.date === d;
          });
          if (!alreadyBooked) {
            promises.push(api('/api/bookings', {
              method: 'POST',
              body: {
                resource_id: booking.resource_id,
                project_id:  booking.project_id,
                date:        d,
                hours:       booking.hours,
                notes:       booking.notes || '',
                is_tentative: booking.is_tentative ? 1 : 0
              }
            }));
          }
        }
        if (promises.length === 0) {
          toast(t('schedule.duplicate_booking'), 'info');
          return;
        }
        Promise.all(promises)
          .then(function () {
            toast(t('schedule.booking_extended'), 'success');
            reloadAfterMutation();
          })
          .catch(function (err) {
            toast(t('schedule.extend_failed') + (err.message ? ': ' + err.message : ''), 'error');
          });

      } else {
        // ── 向左：缩短 ──
        // 删除 hoverDate+1 ~ endDate 范围内同资源同项目的 bookings
        var hoverDate = dates[currentHoverIndex];
        var toDelete;

        if (currentHoverIndex === originalIndex && movedLeft) {
          // 向左缩短但还在同一格子（视图边界）
          // 只有 solo booking（endDate === booking.date）才删除当前 booking
          // 连续 booking 需要把鼠标拖到前一个格子才能缩短
          if (endDate === booking.date) {
            // Solo booking：删除当前 booking
            toDelete = _allBookings.filter(function (b) {
              if (b.resource_id !== booking.resource_id) return false;
              if (b.project_id  !== booking.project_id)  return false;
              return b.date === booking.date;
            });
          } else {
            // 连续 booking：鼠标还在同一格子，不执行操作
            toast(t('schedule.drag_further_to_shorten') || '请继续向左拖动以缩短', 'info');
            return;
          }
        } else {
          // 正常缩短：删除从 hoverDate 之后到 endDate
          toDelete = _allBookings.filter(function (b) {
            if (b.resource_id !== booking.resource_id) return false;
            if (b.project_id  !== booking.project_id)  return false;
            return b.date > hoverDate && b.date <= endDate;
          });
        }

        if (toDelete.length === 0) {
          toast(t('schedule.booking_shortened'), 'info');
          return;
        }
        Promise.all(toDelete.map(function (b) {
          return api('/api/bookings/' + b.id, { method: 'DELETE' });
        }))
          .then(function () {
          toast(t('schedule.booking_shortened'), 'success');
            reloadAfterMutation();
          })
          .catch(function (err) {
            toast(t('schedule.shorten_failed') + (err.message ? ': ' + err.message : ''), 'error');
          });
      }
    }

    // ── 6. 清理函数 ────────────────────────────────────────────────
    function cleanup() {
      isResizing = false;
      if (_rafRight) { cancelAnimationFrame(_rafRight); _rafRight = null; }
      clearPreview();
      blockElement.classList.remove('resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup',   handleMouseUp);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', handleKeyDown);
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup',   handleMouseUp);
    document.addEventListener('keydown',   handleKeyDown);
  }

  /* --------------------------------------------------
     Resize booking from LEFT side
     左拖：向左延长（在更早的日期创建 booking）
     右拖：向右缩短（删除最早的几天）
     -------------------------------------------------- */
  function initResizeBookingLeft(blockElement, booking, startEvent) {
    var isResizing = true;

    // 1. 收集当前资源所有日期格
    var scheduleGrid = document.getElementById('schedule-grid');
    var selector = '.booking-cell[data-resource="' + booking.resource_id +
      '"], .m-day-cell[data-resource="' + booking.resource_id + '"]';
    var allCells = Array.prototype.slice.call(scheduleGrid.querySelectorAll(selector));
    var dateMap = {};
    allCells.forEach(function (c) { dateMap[c.dataset.date] = c; });
    var dates = Object.keys(dateMap).sort();

    // 2. 找出该 booking 所属连续同项目段的最早日期（左侧锚点）
    var sameGroup = _allBookings
      .filter(function (b) {
        return b.resource_id === booking.resource_id &&
               b.project_id  === booking.project_id;
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    // 找包含当前 booking 的连续段（需要检查 split_after 标记）
    var groupSegment = [];
    var currentSeg = [];
    for (var gi = 0; gi < sameGroup.length; gi++) {
      var cur = sameGroup[gi];
      if (currentSeg.length === 0) {
        currentSeg.push(cur);
      } else {
        var prev = currentSeg[currentSeg.length - 1];
        var prevD = new Date(prev.date);
        var curD  = new Date(cur.date);
        var diff  = Math.round((curD - prevD) / 86400000);
        // 允许跨过周末，但要检查前一个 booking 是否有 split_after
        if (diff <= 3 && !(prev.split_after === 1 || prev.split_after === true)) {
          currentSeg.push(cur);
        } else {
          if (currentSeg.some(function (s) { return s.id === booking.id; })) {
            groupSegment = currentSeg.slice();
          }
          currentSeg = [cur];
        }
      }
    }
    if (currentSeg.some(function (s) { return s.id === booking.id; })) {
      groupSegment = currentSeg.slice();
    }
    if (groupSegment.length === 0) groupSegment = [booking];

    // 段的最早日期为左侧锚点
    var startDate = groupSegment[0].date;
    var originalIndex = dates.indexOf(startDate);

    // 如果 startDate 在视图外（跨周边界），找到视图内第一个可见的日期作为锚点
    if (originalIndex === -1) {
      // 找出 groupSegment 中在当前视图内的第一个日期
      var firstVisibleDate = null;
      for (var gi = 0; gi < groupSegment.length; gi++) {
        var idx = dates.indexOf(groupSegment[gi].date);
        if (idx !== -1) {
          firstVisibleDate = groupSegment[gi].date;
          originalIndex = idx;
          break;
        }
      }
      if (originalIndex === -1) return; // 整个 span 都不在视图中
    }

    // 3. 视觉状态
    blockElement.classList.add('resizing');

    // overlay 之前捕获 offset（overlay 覆盖后 getBoundingClientRect 不可靠）
    var _barTopL    = blockElement.offsetTop;
    var _barHeightL = blockElement.offsetHeight;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;user-select:none;';
    document.body.appendChild(overlay);

    var previewCells = [];
    function clearPreview() {
      previewCells.forEach(function (c) {
        var bar = c.querySelector('.resize-preview-bar');
        if (bar) bar.parentNode.removeChild(bar);
      });
      previewCells = [];
    }
    function addBarLeft(cell, isShrink) {
      var bar = document.createElement('div');
      bar.className = 'resize-preview-bar ' + (isShrink ? 'shrink' : 'extend');
      bar.style.top    = _barTopL    + 'px';
      bar.style.height = _barHeightL + 'px';
      cell.appendChild(bar);
      previewCells.push(cell);
    }
    // 左侧预览：左拖（延长）高亮新增的天；右拖（缩短）高亮将被删除的天
    function applyPreview(hoverIndex) {
      clearPreview();
      if (hoverIndex === originalIndex) return;
      var isShrink = hoverIndex > originalIndex; // 右拖 = 缩短
      var lo = isShrink ? originalIndex : hoverIndex;
      var hi = isShrink ? hoverIndex - 1 : originalIndex - 1;
      for (var i = lo; i <= hi; i++) {
        var c = dateMap[dates[i]];
        if (c) addBarLeft(c, isShrink);
      }
    }

    var currentHoverIndex = originalIndex;

    // 4. mousemove（rAF 节流）
    var _rafLeft = null;
    function handleMouseMove(e) {
      if (!isResizing) return;
      e.preventDefault();
      if (_rafLeft) return;
      _rafLeft = requestAnimationFrame(function () {
        _rafLeft = null;
        overlay.style.pointerEvents = 'none';
        var el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = '';
        if (!el) return;
        var cell = el.closest('.booking-cell, .m-day-cell');
        if (!cell) return;
        if (parseInt(cell.dataset.resource, 10) !== booking.resource_id) return;
        var hoverDate = cell.dataset.date;
        var hoverIndex = dates.indexOf(hoverDate);
        if (hoverIndex === -1) return;
        if (hoverIndex !== currentHoverIndex) {
          currentHoverIndex = hoverIndex;
          applyPreview(hoverIndex);
        }
      });
    }

    // 5. mouseup
    function handleMouseUp(e) {
      if (!isResizing) return;
      cleanup();
      if (currentHoverIndex === originalIndex) return;

      if (currentHoverIndex < originalIndex) {
        // 左拖：延长（在 currentHoverIndex ~ originalIndex-1 创建 booking）
        var promises = [];
        for (var i = currentHoverIndex; i < originalIndex; i++) {
          var d = dates[i];
          var alreadyBooked = _allBookings.some(function (b) {
            return b.resource_id === booking.resource_id &&
                   b.project_id  === booking.project_id &&
                   b.date === d;
          });
          if (!alreadyBooked) {
            promises.push(api('/api/bookings', {
              method: 'POST',
              body: {
                resource_id:  booking.resource_id,
                project_id:   booking.project_id,
                date:         d,
                hours:        booking.hours,
                notes:        booking.notes || '',
                is_tentative: booking.is_tentative ? 1 : 0
              }
            }));
          }
        }
        if (promises.length === 0) {
          toast(t('schedule.duplicate_booking'), 'info');
          return;
        }
        Promise.all(promises)
          .then(function () {
            toast(t('schedule.booking_extended'), 'success');
            reloadAfterMutation();
          })
          .catch(function (err) {
            toast(t('schedule.extend_failed') + (err.message ? ': ' + err.message : ''), 'error');
          });

      } else {
        // 右拖：缩短（删除 startDate ~ hoverDate 之前的 booking）
        // 使用日期字符串比较，避免依赖视图内的索引（处理跨周边界的情况）
        var hoverDate = dates[currentHoverIndex];
        var toDelete = _allBookings.filter(function (b) {
          if (b.resource_id !== booking.resource_id) return false;
          if (b.project_id  !== booking.project_id)  return false;
          // 删除从 startDate（包含）到 hoverDate（不包含）之间的所有 booking
          return b.date >= startDate && b.date < hoverDate;
        });
        if (toDelete.length === 0) {
          toast(t('schedule.booking_shortened'), 'info');
          return;
        }
        Promise.all(toDelete.map(function (b) {
          return api('/api/bookings/' + b.id, { method: 'DELETE' });
        }))
          .then(function () {
          toast(t('schedule.booking_shortened'), 'success');
            reloadAfterMutation();
          })
          .catch(function (err) {
            toast(t('schedule.shorten_failed') + (err.message ? ': ' + err.message : ''), 'error');
          });
      }
    }

    // 6. 清理
    function cleanup() {
      isResizing = false;
      if (_rafLeft) { cancelAnimationFrame(_rafLeft); _rafLeft = null; }
      clearPreview();
      blockElement.classList.remove('resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup',   handleMouseUp);
      document.removeEventListener('keydown',   handleKeyDown);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') cleanup();
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup',   handleMouseUp);
    document.addEventListener('keydown',   handleKeyDown);
  }

  /* --------------------------------------------------
     Move booking (drag entire task left/right)
     -------------------------------------------------- */
  function initMoveBooking(blockElement, booking, startEvent) {
    var isMoving = true;

    // 1. Collect all date cells for this resource
    var scheduleGrid = document.getElementById('schedule-grid');
    var selector = '.booking-cell[data-resource="' + booking.resource_id +
      '"], .m-day-cell[data-resource="' + booking.resource_id + '"]';
    var allCells = Array.prototype.slice.call(scheduleGrid.querySelectorAll(selector));
    var dateMap = {};
    allCells.forEach(function (c) { dateMap[c.dataset.date] = c; });
    var dates = Object.keys(dateMap).sort();

    var anchorIndex = dates.indexOf(booking.date);
    if (anchorIndex === -1) return;

    // 2. Find the contiguous same-project booking segment
    var sameGroup = _allBookings
      .filter(function (b) {
        return b.resource_id === booking.resource_id &&
               b.project_id  === booking.project_id;
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    // Walk through sorted bookings, build contiguous segment containing this booking
    var groupSegment = [];
    var currentSeg = [];
    for (var gi = 0; gi < sameGroup.length; gi++) {
      var cur = sameGroup[gi];
      if (currentSeg.length === 0) {
        currentSeg.push(cur);
      } else {
        var prev = currentSeg[currentSeg.length - 1];
        var prevD = new Date(prev.date);
        var curD  = new Date(cur.date);
        var diff  = Math.round((curD - prevD) / 86400000);
        if (diff <= 3 && !(prev.split_after === 1 || prev.split_after === true)) {
          currentSeg.push(cur);
        } else {
          if (currentSeg.some(function (b) { return b.id === booking.id; })) {
            groupSegment = currentSeg;
            break;
          }
          currentSeg = [cur];
        }
      }
    }
    if (groupSegment.length === 0) {
      if (currentSeg.some(function (b) { return b.id === booking.id; })) {
        groupSegment = currentSeg;
      } else {
        groupSegment = [booking];
      }
    }

    // Compute segment index range in dates array
    var segDates = groupSegment.map(function (b) { return b.date; }).sort();
    var segStartIndex = dates.indexOf(segDates[0]);
    var segEndIndex   = dates.indexOf(segDates[segDates.length - 1]);
    if (segStartIndex === -1) segStartIndex = anchorIndex;
    if (segEndIndex   === -1) segEndIndex   = anchorIndex;

    // 3. Visual state
    groupSegment.forEach(function (b) {
      var el = scheduleGrid.querySelector('[data-booking-id="' + b.id + '"]');
      if (el) el.classList.add('moving');
    });

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:grabbing;user-select:none;';
    document.body.appendChild(overlay);

    // Preview highlight
    var previewCells = [];
    function clearPreview() {
      previewCells.forEach(function (c) { c.classList.remove('move-preview'); });
      previewCells = [];
    }
    function applyPreview(delta) {
      clearPreview();
      var newStart = segStartIndex + delta;
      var newEnd   = segEndIndex   + delta;
      if (newStart < 0 || newEnd >= dates.length) return;
      for (var i = newStart; i <= newEnd; i++) {
        var c = dateMap[dates[i]];
        if (c) {
          c.classList.add('move-preview');
          previewCells.push(c);
        }
      }
    }

    var currentDelta = 0;

    // 4. mousemove: track hover cell via elementFromPoint（rAF 节流）
    var _rafMove = null;
    function handleMouseMove(e) {
      if (!isMoving) return;
      e.preventDefault();
      if (_rafMove) return;
      _rafMove = requestAnimationFrame(function () {
        _rafMove = null;

        overlay.style.pointerEvents = 'none';
        var el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = '';

        if (!el) return;
        var cell = el.closest('.booking-cell, .m-day-cell');
        if (!cell) return;
        if (parseInt(cell.dataset.resource, 10) !== booking.resource_id) return;

        var hoverDate  = cell.dataset.date;
        var hoverIndex = dates.indexOf(hoverDate);
        if (hoverIndex === -1) return;

        var delta = hoverIndex - anchorIndex;
        if (delta !== currentDelta) {
          currentDelta = delta;
          applyPreview(delta);
        }
      });
    }

    // 5. mouseup: execute move
    function handleMouseUp() {
      if (!isMoving) return;
      cleanup();

      if (currentDelta === 0) return;

      var newStart = segStartIndex + currentDelta;
      var newEnd   = segEndIndex   + currentDelta;
      if (newStart < 0 || newEnd >= dates.length) {
        toast(t('schedule.out_of_view'), 'error');
        return;
      }

      // Delete original bookings, then create at new dates
      var deletePromises = groupSegment.map(function (b) {
        return api('/api/bookings/' + b.id, { method: 'DELETE' });
      });

      Promise.all(deletePromises)
        .then(function () {
          var createPromises = groupSegment.map(function (b) {
            var oldIdx = dates.indexOf(b.date);
            var newIdx = oldIdx + currentDelta;
            if (newIdx < 0 || newIdx >= dates.length) return Promise.resolve();
            var newDate = dates[newIdx];
            return api('/api/bookings', {
              method: 'POST',
              body: {
                resource_id:  b.resource_id,
                project_id:   b.project_id,
                date:         newDate,
                hours:        b.hours,
                notes:        b.notes || '',
                is_tentative: b.is_tentative ? 1 : 0
              }
            });
          });
          return Promise.all(createPromises);
        })
        .then(function () {
          var dir = currentDelta > 0 ? '→' : '←';
          toast(t('schedule.move') + ' ' + Math.abs(currentDelta) + 'd', 'success');
          reloadAfterMutation();
        })
        .catch(function (err) {
          toast(t('schedule.move_failed') + (err.message ? ': ' + err.message : ''), 'error');
          reloadAfterMutation();
        });
    }

    // 6. Cleanup
    function cleanup() {
      isMoving = false;
      if (_rafMove) { cancelAnimationFrame(_rafMove); _rafMove = null; }
      clearPreview();
      scheduleGrid.querySelectorAll('.moving').forEach(function (el) {
        el.classList.remove('moving');
      });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup',   handleMouseUp);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', handleKeyDown);
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup',   handleMouseUp);
    document.addEventListener('keydown',   handleKeyDown);
  }

  /* --------------------------------------------------
     Drag selection for multiple days (ResourceGuru style)
     -------------------------------------------------- */
  function initDragSelection(container) {
    var isDragging = false;
    var didDrag = false;   // true if mouse moved >= 1 cell during drag
    var startCell = null;
    var endCell = null;
    var selectedCells = [];

    container.addEventListener('mousedown', function (e) {
      var cell = e.target.closest('.booking-cell, .m-day-cell');
      if (!cell) return;

      // Don't start drag if clicking on existing booking or leave
      if (e.target.closest('.booking-block, .leave-block, .m-booking, .m-leave')) return;

      // Check permissions
      var rid = parseInt(cell.dataset.resource, 10);
      if (!rid || !canBookForResource(rid)) return;

      e.preventDefault();
      isDragging = true;
      didDrag = false;
      startCell = cell;
      endCell = cell;
      selectedCells = [cell];

      // Highlight starting cell
      cell.classList.add('drag-selecting', 'drag-start');

      // Add global listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });

    // ---- helper: get ordered date→cell map for a resource in the current view ----
    function getCellsForResource(rid) {
      // Determine which cell type we're in (week vs month view)
      var cellSelector = startCell.classList.contains('m-day-cell')
        ? '.m-day-cell[data-resource="' + rid + '"]'
        : '.booking-cell[data-resource="' + rid + '"]';
      var allCells = container.querySelectorAll(cellSelector);
      var dateMap = {};
      allCells.forEach(function (c) {
        if (c.dataset.date) dateMap[c.dataset.date] = c;
      });
      return dateMap;
    }

    var _rafDrag = null;
    function handleMouseMove(e) {
      if (!isDragging) return;
      if (_rafDrag) return;
      _rafDrag = requestAnimationFrame(function () {
        _rafDrag = null;

        var cell = document.elementFromPoint(e.clientX, e.clientY);
        if (!cell) return;
        cell = cell.closest('.booking-cell, .m-day-cell');
        if (!cell || cell === endCell) return;

        // Must be same resource
        var startRid = parseInt(startCell.dataset.resource, 10);
        var endRid   = parseInt(cell.dataset.resource, 10);
        if (startRid !== endRid) return;

        didDrag = true;

        // Clear previous selection highlights
        selectedCells.forEach(function (c) {
          c.classList.remove('drag-selecting', 'drag-start', 'drag-end');
        });

        var startDate = startCell.dataset.date;
        var endDate   = cell.dataset.date;

        // Build date→cell map using the correct selector for this view
        var dateMap = getCellsForResource(startRid);
        var dates = Object.keys(dateMap).sort();
        var startIndex = dates.indexOf(startDate);
        var endIndex   = dates.indexOf(endDate);

        if (startIndex === -1 || endIndex === -1) {
          // Fallback: just highlight start and current cell
          startCell.classList.add('drag-selecting', 'drag-start');
          cell.classList.add('drag-selecting', 'drag-end');
          selectedCells = [startCell, cell];
          endCell = cell;
          return;
        }

        if (startIndex > endIndex) {
          var tmp = startIndex; startIndex = endIndex; endIndex = tmp;
        }

        selectedCells = [];
        for (var i = startIndex; i <= endIndex; i++) {
          var c = dateMap[dates[i]];
          if (c) {
            c.classList.add('drag-selecting');
            selectedCells.push(c);
            if (i === startIndex) c.classList.add('drag-start');
            if (i === endIndex)   c.classList.add('drag-end');
          }
        }
        endCell = cell;
      });
    }

    // Expose a way to clear highlights from outside (e.g. when modal is closed)
    function clearDragHighlight() {
      selectedCells.forEach(function (c) {
        c.classList.remove('drag-selecting', 'drag-start', 'drag-end');
      });
      selectedCells = [];
    }
    window._clearDragHighlight = clearDragHighlight;

    function handleMouseUp(e) {
      if (!isDragging) return;
      if (_rafDrag) { cancelAnimationFrame(_rafDrag); _rafDrag = null; }

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // If mouse never moved to another cell, treat as a plain click — let the
      // existing per-cell click handler open the single-day booking modal.
      if (!didDrag || selectedCells.length < 2) {
        clearDragHighlight();
        isDragging = false;
        didDrag = false;
        return;
      }

      var rid       = parseInt(startCell.dataset.resource, 10);
      var startDate = startCell.dataset.date;
      var endDate   = endCell.dataset.date;

      // Keep highlight visible until modal is closed (cleared by closeModal)
      isDragging = false;
      didDrag = false;
      startCell = null;
      endCell = null;

      // Suppress the upcoming click event that fires after mouseup on the same cell
      var suppressNext = true;
      document.addEventListener('click', function suppressClick(ev) {
        if (suppressNext) {
          ev.stopPropagation();
          suppressNext = false;
          document.removeEventListener('click', suppressClick, true);
        }
      }, true);

      // Show booking modal for the date range
      showBookingModal(null, rid, startDate, endDate);
    }
  }

  /* --------------------------------------------------
     MONTH VIEW — ResourceGuru-style multi-week grid
     -------------------------------------------------- */
  var DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function buildMonthView(days, teams, bMap, lMap, hMap, resources) {
    var totalDays = days.length;
    var colCount = totalDays + 1; /* +1 for resource name column */

    /* Determine week boundaries and month labels */
    var weeks = [];
    for (var i = 0; i < totalDays; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    /* Build month header row — spans for each month */
    var monthSpans = buildMonthSpans(days);

    var html = '<div class="month-scroll"><table class="month-table">';

    /* --- Month label row --- */
    html += '<thead><tr class="m-month-row">';
    html += '<th class="m-res-hd"></th>';
    monthSpans.forEach(function (ms) {
      html += '<th colspan="' + ms.span + '"><span class="m-month-label">' +
        MONTH_NAMES[ms.month] + ' ' + ms.year + '</span></th>';
    });
    html += '</tr>';

    /* --- Day header row --- */
    html += '<tr class="m-day-row">';
    html += '<th class="m-res-hd">' + t('schedule.resource') + '</th>';
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
      var dayNum = '<span class="m-day-num">' + d.getDate() + '</span>';
      html += '<th class="' + cls.join(' ') + '" style="position:relative">' +
        weekLabel +
        '<span class="m-day-name">' + DAY_SHORT[d.getDay()] + '</span>' +
        dayNum + holidayDot + '</th>';
    });
    html += '</tr></thead><tbody>';

    /* --- Resource rows --- */
    Object.keys(teams).forEach(function (teamName) {
      var members = teams[teamName];
      /* Team divider — sticky first cell + empty day cells */
      html += '<tr class="m-team-row"><td class="m-res-cell m-team-label">' +
        '<span class="team-label">' + teamName + '</span></td>';
      for (var di = 0; di < totalDays; di++) html += '<td></td>';
      html += '</tr>';
      members.forEach(function (r) {
        html += buildMonthResourceRow(r, days, bMap, lMap);
      });
    });

    html += '</tbody></table></div>';
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
    var html = '<tr>';
    html += '<td class="m-res-cell"><div class="m-res-inner">' +
      '<div class="m-res-avatar" style="background:' + (r.color || '#4F46E5') + '">' + initial + '</div>' +
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

        html += '<div class="m-booking' + spanCls + '" data-booking-id="' + b.id + '"' +
          ' data-resource-id="' + b.resource_id + '"' +
          ' data-date="' + b.date + '"' +
          ' style="background:' + bgColor + ';' + borderStyle + '"' +
          ' title="' + escAttr(b.hours + 'h ' + b.project_name + (b.client_name ? ' | ' + b.client_name : '')) + '">';

        if (hasBorderLeft) {
          html += '<div class="resize-handle-left"></div>';
        }
        if (showText) {
          html += '<span class="m-booking-hours">' + b.hours + 'h</span> ' +
            '<span class="booking-project" title="' + escAttr(b.project_name + (b.client_name ? ' (' + b.client_name + ')' : '')) + '">' + esc(truncate(b.project_name, 25)) + '</span>';
        }
        // Show resize handle for end of span or solo booking (cls is null)
        if (!si || si.cls === 'span-e' || !si.cls) {
          html += '<div class="resize-handle"></div>';
        }
        // Show split handle for span-start and span-middle (split point between days)
        if (si && (si.cls === 'span-s' || si.cls === 'span-m')) {
          html += '<div class="split-handle" data-booking-id="' + b.id + '" title="Split Booking"></div>';
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

    var step = function () { return state.scheduleView === 'month' ? -(MONTH_WEEKS * 7) : -7; };

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        state.scheduleWeekStart = addDays(state.scheduleWeekStart, state.scheduleView === 'month' ? -(MONTH_WEEKS * 7) : -7);
        window.loadSchedule();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        state.scheduleWeekStart = addDays(state.scheduleWeekStart, state.scheduleView === 'month' ? (MONTH_WEEKS * 7) : 7);
        window.loadSchedule();
      });
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        state.scheduleWeekStart = getMonday(new Date());
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
  });

  /* --------------------------------------------------
     3. showBookingModal — ResourceGuru-style with tabs
     -------------------------------------------------- */
  async function showBookingModal(bookingId, resourceId, date, endDate) {
    var fetched = await Promise.all([
      api('/api/resources'),
      api('/api/projects')
    ]);
    var resources = fetched[0];
    var projects  = fetched[1];

    var booking = null;
    if (bookingId) {
      booking = _allBookings.find(function (b) { return b.id === bookingId; });
    }

    var dateVal = (booking && booking.date) || date || fmt(new Date());
    var endDateVal = (booking && booking.date) || endDate || date || fmt(new Date());
    var hoursVal = booking ? booking.hours : 8;
    var tentChecked = (booking && booking.is_tentative) ? true : false;
    var notesVal = (booking && booking.notes) ? booking.notes : '';

    /* resource select options */
    var preSelectedIds = [];
    if (booking && booking.resource_id) preSelectedIds = [booking.resource_id];
    else if (!booking && resourceId) preSelectedIds = [resourceId];

    /* project select options grouped by client */
    var projOpts = '<option value="">' + t('schedule.select_project') + '</option>';
    projOpts += projects.map(function (p) {
      var sel = (booking && booking.project_id == p.id) ? ' selected' : '';
      var clientLabel = p.client_name ? ' (' + esc(p.client_name) + ')' : '';
      return '<option value="' + p.id + '"' + sel + '>' + esc(p.name) + clientLabel + '</option>';
    }).join('');

    var body = buildModalTabs(bookingId) +
      /* ---- BOOKING TAB ---- */
      '<div class="bk-tab-content active" id="bk-tab-booking">' +
        buildResourceField(resources, null, preSelectedIds) +
        buildTimeFields(dateVal, endDateVal, hoursVal, bookingId) +
        '<div class="bk-separator"></div>' +
        buildProjectField(projOpts) +
        buildTentativeField(tentChecked) +
        '<div class="bk-separator"></div>' +
        buildNotesField(notesVal) +
        (booking ? buildCreatedByField(booking.created_by_name, booking.created_at) : '') +
      '</div>' +
      /* ---- TIME OFF TAB ---- */
      '<div class="bk-tab-content" id="bk-tab-timeoff">' +
        buildResourceField(resources, 'to', preSelectedIds) +
        buildTimeOffDateFields(dateVal, endDateVal) +
        '<div class="bk-separator"></div>' +
        buildLeaveTypeField() +
        buildNotesField('', 'to') +
      '</div>';

    /* footer buttons */
    var footer = '';
    if (bookingId) {
      footer += '<button class="btn btn-danger bk-footer-left" onclick="window.deleteBooking(' + bookingId + ')">' + t('schedule.delete_booking') + '</button>';
    }
    footer += '<button class="btn btn-outline" onclick="closeModal()">' + t('common.cancel') + '</button>';
    if (bookingId) {
      footer += '<button class="btn btn-primary" onclick="window.saveBooking(' + bookingId + ')">' + t('schedule.save_changes') + '</button>';
    } else {
      footer += '<button class="btn btn-primary" id="bk-submit-btn" onclick="window.submitBookingOrLeave()">' + t('schedule.add_booking') + '</button>';
    }

    var title = bookingId ? t('schedule.edit_booking') : t('common.create');
    showModal(title, body, footer);

    /* Make modal wider */
    document.getElementById('modal').classList.add('bk-modal');

    /* Init multi-select pickers */
    initMultiSelect(null);
    initMultiSelect('to');

    /* Init tab switching */
    initModalTabs(bookingId);

    /* Init time mode toggle */
    initTimeToggle();

    /* Update total on input change */
    updateBookingTotal();
  }

  /* --------------------------------------------------
     Batch edit modal for continuous span bookings
     -------------------------------------------------- */
  async function showBatchEditModal(bookingIds) {
    var groupBookings = _allBookings.filter(function (b) {
      return bookingIds.indexOf(b.id) >= 0;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (groupBookings.length === 0) return;

    var first = groupBookings[0];
    var last = groupBookings[groupBookings.length - 1];
    var resource = (state.resources || []).find(function (r) { return r.id === first.resource_id; });
    var resName = resource ? resource.name : '';

    var body =
      '<div class="bk-batch-info">' +
        '<div class="bk-batch-row"><svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
          '<div class="bk-batch-label">' + t('schedule.resource') + '</div><div class="bk-batch-value">' + esc(resName) + '</div></div>' +
        '<div class="bk-batch-row"><svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
          '<div class="bk-batch-label">' + t('schedule.date_range') + '</div><div class="bk-batch-value">' + first.date + ' ~ ' + last.date + '</div>' +
          '<span class="bk-batch-days">(' + groupBookings.length + ' ' + t('schedule.days') + ')</span></div>' +
        '<div class="bk-batch-row"><svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M4 4h12M4 8h12M4 12h8M4 16h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
          '<div class="bk-batch-label">' + t('schedule.project') + '</div><div class="bk-batch-value">' + esc(first.project_name || '') + '</div></div>' +
      '</div>' +
      '<div class="bk-separator"></div>' +
      '<div class="bk-field"><svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<div class="bk-field-body"><div class="bk-field-label">' + t('schedule.hours_per_day') + '</div>' +
          '<div class="bk-time-inputs">' +
            '<input type="number" id="batch-hours" class="text-input form-control" value="' + first.hours + '" min="0.5" max="24" step="0.5" style="width:100px;text-align:center">' +
          '</div></div></div>' +
      '<div class="bk-field" style="margin-top:12px">' +
        '<label class="bk-toggle"><input type="checkbox" id="batch-tentative"' + (first.is_tentative ? ' checked' : '') + '><span class="bk-toggle-track"></span><span class="bk-toggle-label">' + t('schedule.tentative') + '</span></label>' +
      '</div>' +
      '<div class="bk-separator"></div>' +
      '<div class="bk-field"><svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M4 4h12M4 8h12M4 12h8M4 16h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<div class="bk-field-body"><div class="bk-field-label">' + t('common.notes') + '</div>' +
          '<textarea id="batch-notes" class="text-input form-control" rows="2" style="resize:vertical" placeholder="' + t('schedule.optional_notes') + '">' + esc(first.notes || '') + '</textarea>' +
        '</div></div>' +
      '<div class="bk-batch-preview" id="batch-preview">' +
        '<div class="bk-batch-preview-title">' + t('schedule.preview_changes') + '</div>' +
        '<div class="bk-batch-preview-list">' + groupBookings.map(function (b) {
          return '<div class="bk-batch-preview-item"><span class="bk-batch-date">' + b.date + '</span><span class="bk-batch-arrow">→</span><span class="bk-batch-new" id="preview-' + b.id + '">' + first.hours + 'h</span></div>';
        }).join('') + '</div></div>';

    var footer =
      '<button class="btn btn-danger bk-footer-left" onclick="window.deleteBatchBooking([' + bookingIds.join(',') + '])">' + t('schedule.delete_all') + '</button>' +
      '<button class="btn btn-outline" onclick="closeModal()">' + t('common.cancel') + '</button>' +
      '<button class="btn btn-primary" onclick="window.saveBatchBooking([' + bookingIds.join(',') + '])">' + t('schedule.save_all') + '</button>';

    showModal(t('schedule.batch_edit') + ' (' + groupBookings.length + ' ' + t('schedule.days') + ')', body, footer);
    document.getElementById('modal').classList.add('bk-modal');

    // Live preview: update hours in preview when input changes
    var hoursInput = document.getElementById('batch-hours');
    function updatePreview() {
      var total = parseFloat(hoursInput.value) || 0;
      groupBookings.forEach(function (b) {
        var el = document.getElementById('preview-' + b.id);
        if (el) el.textContent = total + 'h';
      });
    }
    hoursInput.addEventListener('input', updatePreview);
  }

  /* ---- Batch save ---- */
  window.saveBatchBooking = async function (bookingIds) {
    var totalH = parseFloat(document.getElementById('batch-hours').value) || 0;
    var tentative = document.getElementById('batch-tentative').checked;
    var notes = document.getElementById('batch-notes').value;

    if (totalH <= 0) { toast(t('schedule.invalid_hours'), 'error'); return; }

    try {
      var promises = bookingIds.map(function (id) {
        var b = _allBookings.find(function (x) { return x.id === id; });
        if (!b) return Promise.resolve();
        return api('/api/bookings/' + id, {
          method: 'PUT',
          body: {
            resource_id: b.resource_id,
            project_id: b.project_id,
            date: b.date,
            hours: totalH,
            is_tentative: tentative,
            notes: notes
          }
        });
      });
      await Promise.all(promises.filter(Boolean));
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.batch_updated'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.update_failed'), 'error');
    }
  };

  /* ---- Batch delete ---- */
  window.deleteBatchBooking = async function (bookingIds) {
    if (!confirm(t('schedule.confirm_delete_batch'))) return;
    try {
      await Promise.all(bookingIds.map(function (id) {
        return api('/api/bookings/' + id, { method: 'DELETE' });
      }));
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.batch_deleted'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.delete_failed'), 'error');
    }
  };

  /* ---- Modal tabs HTML ---- */
  function buildModalTabs(bookingId) {
    if (bookingId) return ''; /* no tabs when editing */
    return '<div class="bk-tabs">' +
      '<button class="bk-tab active" data-tab="booking">' +
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        t('schedule.add_booking') + '</button>' +
      '<button class="bk-tab" data-tab="timeoff">' +
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        t('schedule.leave_label') + '</button>' +
    '</div>';
  }

  /* ---- Resource multi-select picker field ---- */
  function buildResourceField(resources, prefix, selectedIds) {
    var id = prefix ? prefix + '-resource' : 'bk-resource';
    var selIds = selectedIds || [];
    /* Build chips for pre-selected */
    var chipsHtml = '';
    selIds.forEach(function (sid) {
      var r = resources.find(function (x) { return x.id === sid; });
      if (r) {
        chipsHtml += '<span class="ms-chip" data-id="' + r.id + '">' +
          '<span class="ms-chip-avatar" style="background:' + (r.color || '#4F46E5') + '">' + esc(r.name.charAt(0)) + '</span>' +
          esc(r.name) +
          '<span class="ms-chip-remove" data-id="' + r.id + '">&times;</span>' +
        '</span>';
      }
    });

    /* Build dropdown options grouped by team */
    var teams = {};
    resources.forEach(function (r) {
      var tm = r.team || t('manage.ungrouped');
      if (!teams[tm]) teams[tm] = [];
      teams[tm].push(r);
    });
    var optionsHtml = '';
    Object.keys(teams).forEach(function (tm) {
      optionsHtml += '<div class="ms-team-label">' + esc(tm) + '</div>';
      teams[tm].forEach(function (r) {
        var sel = selIds.indexOf(r.id) >= 0 ? ' selected' : '';
        optionsHtml += '<div class="ms-option' + sel + '" data-id="' + r.id + '">' +
          '<span class="ms-option-check"></span>' +
          '<span class="ms-option-avatar" style="background:' + (r.color || '#4F46E5') + '">' + esc(r.name.charAt(0)) + '</span>' +
          '<span class="ms-option-info"><span class="ms-option-name">' + esc(r.name) + '</span>' +
          (r.role ? '<span class="ms-option-role">' + esc(r.role) + '</span>' : '') +
          '</span></div>';
      });
    });

    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-field-label">' + t('schedule.staff_multiselect') + '</div>' +
        '<div class="ms-picker" id="' + id + '-picker">' +
          '<div class="ms-selected" id="' + id + '-selected">' +
            chipsHtml +
            '<input class="ms-search" id="' + id + '-search" placeholder="' + t('schedule.search_resource') + '" autocomplete="off">' +
          '</div>' +
          '<div class="ms-dropdown" id="' + id + '-dropdown">' + optionsHtml + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* Init multi-select picker interactivity */
  function initMultiSelect(prefix) {
    var id = prefix ? prefix + '-resource' : 'bk-resource';
    var picker = document.getElementById(id + '-picker');
    if (!picker) return;

    var selectedArea = document.getElementById(id + '-selected');
    var dropdown = document.getElementById(id + '-dropdown');
    var searchInput = document.getElementById(id + '-search');

    /* Toggle dropdown on click */
    selectedArea.addEventListener('click', function (e) {
      if (e.target.classList.contains('ms-chip-remove')) {
        /* Remove chip */
        var rid = parseInt(e.target.dataset.id, 10);
        var chip = e.target.parentElement;
        chip.remove();
        var opt = dropdown.querySelector('.ms-option[data-id="' + rid + '"]');
        if (opt) opt.classList.remove('selected');
        return;
      }
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) searchInput.focus();
    });

    /* Option click */
    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.ms-option');
      if (!opt) return;
      var rid = parseInt(opt.dataset.id, 10);

      if (opt.classList.contains('selected')) {
        /* Deselect */
        opt.classList.remove('selected');
        var chip = selectedArea.querySelector('.ms-chip[data-id="' + rid + '"]');
        if (chip) chip.remove();
      } else {
        /* Select */
        opt.classList.add('selected');
        var name = opt.querySelector('.ms-option-name').textContent;
        var avatarEl = opt.querySelector('.ms-option-avatar');
        var bg = avatarEl.style.background;
        var chipHtml = '<span class="ms-chip" data-id="' + rid + '">' +
          '<span class="ms-chip-avatar" style="background:' + bg + '">' + name.charAt(0) + '</span>' +
          name +
          '<span class="ms-chip-remove" data-id="' + rid + '">&times;</span>' +
        '</span>';
        searchInput.insertAdjacentHTML('beforebegin', chipHtml);
      }
    });

    /* Search filter */
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.toLowerCase();
      dropdown.querySelectorAll('.ms-option').forEach(function (opt) {
        var name = opt.querySelector('.ms-option-name').textContent.toLowerCase();
        opt.style.display = name.indexOf(q) >= 0 ? '' : 'none';
      });
      dropdown.querySelectorAll('.ms-team-label').forEach(function (lbl) {
        /* Hide team label if all its options are hidden */
        var next = lbl.nextElementSibling;
        var anyVisible = false;
        while (next && !next.classList.contains('ms-team-label')) {
          if (next.style.display !== 'none') anyVisible = true;
          next = next.nextElementSibling;
        }
        lbl.style.display = anyVisible ? '' : 'none';
      });
      if (!dropdown.classList.contains('open')) dropdown.classList.add('open');
    });

    /* Close on outside click */
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) dropdown.classList.remove('open');
    });
  }

  /* Get selected resource IDs from multi-select */
  function getSelectedResourceIds(prefix) {
    var id = prefix ? prefix + '-resource' : 'bk-resource';
    var selectedArea = document.getElementById(id + '-selected');
    if (!selectedArea) return [];
    var chips = selectedArea.querySelectorAll('.ms-chip');
    var ids = [];
    chips.forEach(function (c) { ids.push(parseInt(c.dataset.id, 10)); });
    return ids;
  }

  /* ---- Time fields for booking ---- */
  function buildTimeFields(dateVal, endDateVal, hoursVal, isEdit) {
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-hours-row">' +
          '<div class="bk-hours-group">' +
            '<label>' + t('schedule.hours_per_day') + '</label>' +
            '<input type="number" id="bk-hours" class="text-input form-control form-control-sm" value="' + hoursVal + '" min="0.5" max="24" step="0.5" onchange="window._updateBkTotal()" oninput="window._updateBkTotal()">' +
          '</div>' +
        '</div>' +
        '<div class="bk-date-row">' +
          '<label>' + t('common.from') + '</label>' +
          '<input type="date" id="bk-date-start" class="text-input form-control form-control-sm" value="' + dateVal + '" onchange="window._updateBkTotal()">' +
          '<label>' + t('common.to') + '</label>' +
          '<input type="date" id="bk-date-end" class="text-input form-control form-control-sm" value="' + (isEdit ? dateVal : endDateVal) + '" onchange="window._updateBkTotal()">' +
        '</div>' +
        '<div class="bk-total" id="bk-total"></div>' +
      '</div>' +
    '</div>';
  }

  /* ---- Date fields for time-off ---- */
  function buildTimeOffDateFields(dateVal, endDateVal) {
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-date-row">' +
          '<label>' + t('common.from') + '</label>' +
          '<input type="date" id="to-date-start" class="text-input form-control form-control-sm" value="' + dateVal + '" onchange="window._updateToTotal()">' +
          '<label>' + t('common.to') + '</label>' +
          '<input type="date" id="to-date-end" class="text-input form-control form-control-sm" value="' + endDateVal + '" onchange="window._updateToTotal()">' +
        '</div>' +
        '<div class="bk-total" id="to-total"></div>' +
      '</div>' +
    '</div>';
  }

  /* ---- Project/Client field ---- */
  function buildProjectField(projOpts) {
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.5"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-field-label">' + t('schedule.project_client') + '</div>' +
        '<select id="bk-project" class="text-input form-select form-select-sm">' + projOpts + '</select>' +
      '</div>' +
    '</div>';
  }

  /* ---- Tentative toggle ---- */
  function buildTentativeField(checked) {
    return '<div class="bk-field">' +
      '<div class="bk-field-icon"></div>' +
      '<div class="bk-field-body" style="display:flex;justify-content:space-between;align-items:center">' +
        '<label class="bk-toggle">' +
          '<input type="checkbox" id="bk-tentative"' + (checked ? ' checked' : '') + '>' +
          '<span class="bk-toggle-track"></span>' +
          '<span class="bk-toggle-label">' + t('schedule.tentative') + '</span>' +
        '</label>' +
      '</div>' +
    '</div>';
  }

  /* ---- Leave type field ---- */
  function buildLeaveTypeField() {
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16" stroke="currentColor" stroke-width="1.5"/><path d="M7 11l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-field-label">' + t('schedule.leave_type') + '</div>' +
        '<div class="bk-leave-types">' +
          '<button class="bk-leave-type active" data-type="vacation">' + t('schedule.leave_vacation') + '</button>' +
          '<button class="bk-leave-type sick" data-type="sick">' + t('schedule.leave_sick') + '</button>' +
          '<button class="bk-leave-type personal" data-type="personal">' + t('schedule.leave_personal') + '</button>' +
          '<button class="bk-leave-type holiday" data-type="holiday">' + t('schedule.leave_holiday') + '</button>' +
          '<button class="bk-leave-type other" data-type="other">' + t('schedule.leave_other') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---- Notes/Details field ---- */
  function buildNotesField(val, prefix) {
    var id = prefix ? prefix + '-notes' : 'bk-notes';
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M4 4h12M4 8h12M4 12h8M4 16h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-field-label">' + t('common.notes') + '</div>' +
        '<textarea id="' + id + '" class="text-input form-control" rows="2" placeholder="' + t('schedule.optional_notes') + '" style="resize:vertical">' + esc(val) + '</textarea>' +
      '</div>' +
    '</div>';
  }

  /* ---- Created by field (read-only, shown in edit mode) ---- */
  function buildCreatedByField(creatorName, createdAt) {
    if (!creatorName && !createdAt) return '';
    var info = '';
    if (creatorName) info += esc(creatorName);
    if (createdAt) {
      var d = createdAt.replace('T', ' ').substring(0, 16);
      info += (info ? ', ' : '') + d;
    }
    return '<div class="bk-separator"></div>' +
      '<div class="bk-field">' +
        '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 17.5c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<div class="bk-field-body">' +
          '<div class="bk-field-label">' + t('schedule.booker') + '</div>' +
          '<div style="font-size:13px;color:var(--text-secondary)">' + info + '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---- Init tab switching ---- */
  function initModalTabs(bookingId) {
    if (bookingId) return;
    document.querySelectorAll('.bk-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.bk-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.bk-tab-content').forEach(function (c) { c.classList.remove('active'); });
        tab.classList.add('active');
        var target = tab.dataset.tab;
        var panel = document.getElementById('bk-tab-' + target);
        if (panel) panel.classList.add('active');

        /* Update submit button text */
        var submitBtn = document.getElementById('bk-submit-btn');
        if (submitBtn) {
          submitBtn.textContent = target === 'timeoff' ? t('schedule.add_leave') : t('schedule.add_booking');
        }
      });
    });

    /* Init leave type buttons */
    document.querySelectorAll('.bk-leave-type').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.bk-leave-type').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    /* Update time-off total */
    updateTimeOffTotal();
  }

  function initTimeToggle() {
    /* no specific toggle needed for now */
  }

  /* ---- Calculate booking total ---- */
  function updateBookingTotal() {
    window._updateBkTotal();
  }

  window._updateBkTotal = function () {
    var hours = parseFloat((document.getElementById('bk-hours') || {}).value) || 0;
    var startEl = document.getElementById('bk-date-start');
    var endEl = document.getElementById('bk-date-end');
    if (!startEl || !endEl) return;

    var totalHPerDay = hours;
    var totalDays = countAllDays(startEl.value, endEl.value);
    var totalH = totalHPerDay * totalDays;

    var el = document.getElementById('bk-total');
    if (el) {
      el.textContent = totalH.toFixed(1) + 'h (' + totalDays + 'd, ' + totalHPerDay.toFixed(1) + 'h/d)';
    }
  };

  function updateTimeOffTotal() {
    window._updateToTotal();
  }

  window._updateToTotal = function () {
    var startEl = document.getElementById('to-date-start');
    var endEl = document.getElementById('to-date-end');
    if (!startEl || !endEl) return;

    var totalDays = countAllDays(startEl.value, endEl.value);
    var el = document.getElementById('to-total');
    if (el) {
      el.textContent = totalDays + 'd';
    }
  };

  function countAllDays(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    var d = new Date(startStr);
    var end = new Date(endStr);
    var count = 0;
    while (d <= end) {
      count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  /* --------------------------------------------------
     Permission check helper
     -------------------------------------------------- */
  function canBookForResource(resourceId) {
    var perms = window.state.permissions || {};
    if (perms.book_others) return true;
    var myResourceId = window.state.user && window.state.user.resource_id;
    return myResourceId && myResourceId === resourceId;
  }

  /* --------------------------------------------------
     4. Submit handler — routes to booking or leave
     -------------------------------------------------- */
  window.submitBookingOrLeave = async function () {
    var activeTab = document.querySelector('.bk-tab.active');
    var isTimeOff = activeTab && activeTab.dataset.tab === 'timeoff';

    if (isTimeOff) {
      await saveTimeOff();
    } else {
      await window.saveBooking(null);
    }
  };

  /* --------------------------------------------------
     5. saveBooking
     -------------------------------------------------- */
  window.saveBooking = async function (id) {
    var totalH = parseFloat(document.getElementById('bk-hours').value) || 0;

    var projectId = parseInt(document.getElementById('bk-project').value, 10);
    if (!projectId) {
      toast(t('schedule.select_project'), 'error');
      return;
    }

    var resourceIds;
    if (id) {
      /* editing single booking — use its resource_id */
      resourceIds = [parseInt(document.getElementById('bk-resource-selected')
        ? getSelectedResourceIds()[0]
        : 0, 10)];
      resourceIds = getSelectedResourceIds();
      if (resourceIds.length === 0) { toast(t('schedule.search_resource'), 'error'); return; }
    } else {
      resourceIds = getSelectedResourceIds();
      if (resourceIds.length === 0) { toast(t('schedule.search_resource'), 'error'); return; }
    }

    try {
      if (id) {
        /* editing existing booking — check if date range changed */
        var startDateVal = document.getElementById('bk-date-start').value;
        var endDateVal   = document.getElementById('bk-date-end').value || startDateVal;
        var origBooking  = _allBookings.find(function (b) { return b.id === id; });
        var origDate     = origBooking ? origBooking.date : startDateVal;

        // origBooking is always a single-day record (no end_date column in DB).
        // dateChanged if the user moved start OR expanded to a multi-day range.
        var dateChanged = startDateVal !== origDate || endDateVal !== origDate;

        if (!dateChanged) {
          /* simple update — just update this booking */
          var data = {
            resource_id: resourceIds[0],
            project_id: projectId,
            date: startDateVal,
            hours: Math.round(totalH * 10) / 10,
            is_tentative: document.getElementById('bk-tentative').checked,
            notes: document.getElementById('bk-notes').value
          };
          await api('/api/bookings/' + id, { method: 'PUT', body: data });
        } else {
          /* date range changed — delete old and create new range */
          await api('/api/bookings/' + id, { method: 'DELETE' });

          /* --- Leave conflict check (same as new booking) --- */
          var lMap = {};
          if (window._allLeave) {
            window._allLeave.forEach(function (l) {
              var k = l.resource_id + '_' + l.date;
              lMap[k] = true;
            });
          }

          var rangeDates = [];
          var dCursor = new Date(startDateVal);
          var dEnd    = new Date(endDateVal);
          while (dCursor <= dEnd) {
            rangeDates.push(dCursor.toISOString().split('T')[0]);
            dCursor.setDate(dCursor.getDate() + 1);
          }

          var validDates = rangeDates.filter(function (d) {
            return !lMap[resourceIds[0] + '_' + d];
          });

          if (validDates.length === 0) {
            toast(t('schedule.all_dates_have_leave'), 'error');
            reloadAfterMutation();
            return;
          }

          /* Group into contiguous segments */
          var segments = [];
          var seg = [validDates[0]];
          for (var vi = 1; vi < validDates.length; vi++) {
            var prev = new Date(validDates[vi - 1]);
            var curr = new Date(validDates[vi]);
            var diff = (curr - prev) / 86400000;
            if (diff === 1) {
              seg.push(validDates[vi]);
            } else {
              segments.push(seg);
              seg = [validDates[vi]];
            }
          }
          segments.push(seg);

          var createPromises = segments.map(function (s) {
            return api('/api/bookings', {
              method: 'POST',
              body: {
                resource_id: resourceIds[0],
                project_id: projectId,
                date: s[0],
                end_date: s[s.length - 1],
                hours: Math.round(totalH * 10) / 10,
                is_tentative: document.getElementById('bk-tentative').checked,
                notes: document.getElementById('bk-notes').value
              }
            });
          });
          await Promise.all(createPromises);
        }
      } else {
        /* --- Leave conflict check --- */
        var startDateVal = document.getElementById('bk-date-start').value;
        var endDateVal   = document.getElementById('bk-date-end').value || startDateVal;
        var lMap = {};
        if (window._allLeave) {
          window._allLeave.forEach(function (l) {
            var k = l.resource_id + '_' + l.date;
            lMap[k] = true;
          });
        }

        /* Collect all dates in the booking range */
        var rangeDates = [];
        var dCursor = new Date(startDateVal);
        var dEnd    = new Date(endDateVal);
        while (dCursor <= dEnd) {
          rangeDates.push(dCursor.toISOString().split('T')[0]);
          dCursor.setDate(dCursor.getDate() + 1);
        }

        /* For each resource, find which dates have leave */
        var conflictInfo = [];
        resourceIds.forEach(function (rid) {
          rangeDates.forEach(function (dateStr) {
            if (lMap[rid + '_' + dateStr]) {
              conflictInfo.push({ rid: rid, date: dateStr });
            }
          });
        });

        if (conflictInfo.length > 0) {
          /* Build a readable summary */
          var conflictDates = {};
          conflictInfo.forEach(function (c) {
            conflictDates[c.date] = true;
          });
          var dateList = Object.keys(conflictDates).sort().slice(0, 5).join(', ');
          if (Object.keys(conflictDates).length > 5) dateList += ' ...';

          /* Ask user: skip leave days or cancel */
          var skipConfirmed = window.confirm(
            t('schedule.dates_have_leave') + dateList + '\n\n' +
            t('schedule.skip_holidays_confirm')
          );
          if (!skipConfirmed) return;

          /* Filter out leave dates from each resource's booking range */
          /* We'll create per-resource, per-contiguous-segment bookings */
          var createPromises = [];
          resourceIds.forEach(function (rid) {
            /* Find non-leave dates for this resource */
            var validDates = rangeDates.filter(function (d) {
              return !lMap[rid + '_' + d];
            });
            if (!validDates.length) return;

            /* Group into contiguous segments */
            var segments = [];
            var seg = [validDates[0]];
            for (var vi = 1; vi < validDates.length; vi++) {
              var prev = new Date(validDates[vi - 1]);
              var curr = new Date(validDates[vi]);
              var diff = (curr - prev) / 86400000;
              if (diff === 1) {
                seg.push(validDates[vi]);
              } else {
                segments.push(seg);
                seg = [validDates[vi]];
              }
            }
            segments.push(seg);

            segments.forEach(function (s) {
              createPromises.push(api('/api/bookings', {
                method: 'POST',
                body: {
                  resource_id: rid,
                  project_id: projectId,
                  date: s[0],
                  end_date: s[s.length - 1],
                  hours: Math.round(totalH * 10) / 10,
                  is_tentative: document.getElementById('bk-tentative').checked,
                  notes: document.getElementById('bk-notes').value
                }
              }));
            });
          });
          await Promise.all(createPromises);

        } else {
          /* No conflicts — normal batch create */
          var promises = resourceIds.map(function (rid) {
            return api('/api/bookings', {
              method: 'POST',
              body: {
                resource_id: rid,
                project_id: projectId,
                date: startDateVal,
                end_date: endDateVal,
                hours: Math.round(totalH * 10) / 10,
                is_tentative: document.getElementById('bk-tentative').checked,
                notes: document.getElementById('bk-notes').value
              }
            });
          });
          await Promise.all(promises);
        }
      }
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(id ? t('schedule.booking_updated') : t('schedule.booking_created'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('schedule.update_failed'), 'error');
    }
  };

  /* --------------------------------------------------
     6. saveTimeOff
     -------------------------------------------------- */
  async function saveTimeOff() {
    var resourceIds = getSelectedResourceIds('to');
    var startDate = document.getElementById('to-date-start').value;
    var endDate = document.getElementById('to-date-end').value;
    var notes = document.getElementById('to-notes').value;

    /* Get selected leave type */
    var activeType = document.querySelector('.bk-leave-type.active');
    var leaveType = activeType ? activeType.dataset.type : 'vacation';

    if (resourceIds.length === 0 || !startDate) {
      toast(t('schedule.search_resource'), 'error');
      return;
    }

    try {
      var promises = resourceIds.map(function (rid) {
        return api('/api/leave/batch', {
          method: 'POST',
          body: {
            resource_id: rid,
            start_date: startDate,
            end_date: endDate || startDate,
            type: leaveType,
            notes: notes
          }
        });
      });
      await Promise.all(promises);
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.leave_added'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('schedule.add_leave_failed'), 'error');
    }
  }

  /* --------------------------------------------------
     7. editBooking & deleteBooking
     -------------------------------------------------- */
  window.editBooking = function (id) {
    var booking = _allBookings.find(function (b) { return b.id === id; });
    if (booking && !canBookForResource(booking.resource_id)) {
      toast(t('schedule.no_edit_permission'), 'error');
      return;
    }
    // Check if this booking belongs to a continuous span group
    var isMonth = state.scheduleView === 'month';
    var days = isMonth
      ? (function () { var d = []; for (var w = 0; w < 4; w++) for (var dd = 0; dd < 7; dd++) d.push(addDays(state.scheduleWeekStart, w * 7 + dd)); return d; })()
      : weekDates(state.scheduleWeekStart);
    var bMap = {};
    _allBookings.forEach(function (b) {
      var key = b.resource_id + '_' + b.date;
      if (!bMap[key]) bMap[key] = [];
      bMap[key].push(b);
    });
    var group = getSpanGroup(id, bMap, days);
    if (group) {
      // Multi-day span: edit all days together (user can split first if they want single-day edit)
      var ids = group.map(function (b) { return b.id; });
      showBatchEditModal(ids);
    } else {
      showBookingModal(id);
    }
  };

  /* Split a multi-day booking at the clicked point (called by split-handle click) */
  window.splitBooking = function (id) {
    var booking = _allBookings.find(function (b) { return b.id === id; });
    if (!booking) return;
    if (!canBookForResource(booking.resource_id)) {
      toast(t('schedule.no_edit_permission'), 'error');
      return;
    }
    
    // Check if this booking belongs to a continuous span group
    var isMonth = state.scheduleView === 'month';
    var days = isMonth
      ? (function () { var d = []; for (var w = 0; w < 4; w++) for (var dd = 0; dd < 7; dd++) d.push(addDays(state.scheduleWeekStart, w * 7 + dd)); return d; })()
      : weekDates(state.scheduleWeekStart);
    var bMap = {};
    _allBookings.forEach(function (b) {
      var key = b.resource_id + '_' + b.date;
      if (!bMap[key]) bMap[key] = [];
      bMap[key].push(b);
    });
    var group = getSpanGroup(id, bMap, days);
    
    if (!group || group.length < 2) {
      toast(t('schedule.cannot_split'), 'info');
      return;
    }
    
    var clicked = group.find(function (b) { return b.id === id; });
    var idx = group.indexOf(clicked);
    
    // Split into left (including clicked day) and right parts
    var rightIds = group.slice(idx + 1).map(function (b) { return b.id; });
    
    if (rightIds.length === 0) {
      toast(t('schedule.cannot_split'), 'info');
      return;
    }
    
    // Mark the split point: clicked block becomes span-e (end of left group)
    // Right part starts fresh with span-s, but we need to recalculate the entire structure
    var leftIds = group.slice(0, idx + 1).map(function (b) { return b.id; });
    var rightIds = group.slice(idx + 1).map(function (b) { return b.id; });
    
    // Persist the split: update clicked booking's split_after flag in database
    var clickedId = clicked.id;
    api('/api/bookings/' + clickedId, {
      method: 'PUT',
      body: { split_after: 1 }
    }).then(function () {
      // Update local cache
      var bk = _allBookings.find(function (b) { return b.id === clickedId; });
      if (bk) bk.split_after = 1;
      
      // Re-render schedule to ensure UI consistency
      loadSchedule();
      
      toast(t('schedule.split_ready'), 'success');
    }).catch(function (err) {
      console.error('Split failed:', err);
      toast(t('schedule.split_failed') + (err.message ? ': ' + err.message : ''), 'error');
    });
  }
  
  /* Update split handles after re-split based on new span structures */
  function updateSplitHandlesAfterReSplit(leftIds, rightIds) {
    // Helper to update handles for a group
    function updateGroupHandles(ids) {
      ids.forEach(function (id, i) {
        var block = document.querySelector('.booking-block[data-booking-id="' + id + '"], .m-booking[data-booking-id="' + id + '"]');
        if (!block) return;
        
        // Remove existing split handle
        var existing = block.querySelector('.split-handle');
        if (existing) existing.remove();
        
        // Add split handle if not the last block of the group
        if (ids.length > 1 && i < ids.length - 1) {
          var splitHandle = document.createElement('div');
          splitHandle.className = 'split-handle';
          splitHandle.dataset.bookingId = id;
          splitHandle.title = 'Split Booking';
          splitHandle.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            window.splitBooking(id);
          });
          block.appendChild(splitHandle);
        }
      });
    }
    updateGroupHandles(leftIds);
    updateGroupHandles(rightIds);
  }

  window.deleteBooking = async function (id) {
    if (!confirm(t('schedule.confirm_delete_booking'))) return;
    try {
      await api('/api/bookings/' + id, { method: 'DELETE' });
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.booking_deleted'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.delete_failed'), 'error');
    }
  };

  /* --------------------------------------------------
     8. Edit leave modal
     -------------------------------------------------- */
  function showEditLeaveModal(leaveEntry) {
    if (!canBookForResource(leaveEntry.resource_id)) {
      toast(t('schedule.no_leave_permission'), 'error');
      return;
    }

    var leaveTypes = [
      { key: 'vacation', label: t('schedule.leave_vacation'), cls: '' },
      { key: 'sick', label: t('schedule.leave_sick'), cls: 'sick' },
      { key: 'personal', label: t('schedule.leave_personal'), cls: 'personal' },
      { key: 'holiday', label: t('schedule.leave_holiday'), cls: 'holiday' },
      { key: 'other', label: t('schedule.leave_other'), cls: 'other' }
    ];

    var typeBtns = leaveTypes.map(function (t) {
      var activeCls = (leaveEntry.type === t.key) ? ' active' : '';
      return '<button class="bk-leave-type ' + t.cls + activeCls + '" data-type="' + t.key + '">' + t.label + '</button>';
    }).join('');

    var body =
      '<div class="bk-field">' +
        '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M10 2a8 8 0 100 16 8 8 0 000-16z" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="14" r="0.5" fill="currentColor"/></svg>' +
        '<div class="bk-field-body">' +
          '<div class="bk-field-label">' + t('schedule.resource') + '</div>' +
          '<div style="font-size:14px;font-weight:500">' + esc(leaveEntry.resource_name || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bk-field">' +
        '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<div class="bk-field-body">' +
          '<div class="bk-field-label">' + t('common.date') + '</div>' +
          '<input type="date" id="edit-leave-date" class="text-input form-control form-control-sm" value="' + leaveEntry.date + '">' +
        '</div>' +
      '</div>' +
      '<div class="bk-separator"></div>' +
      '<div class="bk-field">' +
        '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16" stroke="currentColor" stroke-width="1.5"/><path d="M7 11l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<div class="bk-field-body">' +
          '<div class="bk-field-label">' + t('schedule.leave_type') + '</div>' +
          '<div class="bk-leave-types" id="edit-leave-types">' + typeBtns + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bk-separator"></div>' +
      '<div class="bk-field">' +
        '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M4 4h12M4 8h12M4 12h8M4 16h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '<div class="bk-field-body">' +
          '<div class="bk-field-label">' + t('common.notes') + '</div>' +
          '<textarea id="edit-leave-notes" class="text-input form-control" rows="2" placeholder="' + t('schedule.optional_notes') + '" style="resize:vertical">' + esc(leaveEntry.notes || '') + '</textarea>' +
        '</div>' +
      '</div>';

    var footer =
      '<button class="btn btn-danger bk-footer-left" onclick="window._deleteLeave(' + leaveEntry.id + ')">' + t('schedule.delete_leave') + '</button>' +
      '<button class="btn btn-outline" onclick="closeModal()">' + t('common.cancel') + '</button>' +
      '<button class="btn btn-primary" onclick="window._saveLeave(' + leaveEntry.id + ')">' + t('schedule.save_changes') + '</button>';

    showModal(t('schedule.edit_leave'), body, footer);
    document.getElementById('modal').classList.add('bk-modal');

    /* Init leave type toggle within the edit modal */
    document.querySelectorAll('#edit-leave-types .bk-leave-type').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#edit-leave-types .bk-leave-type').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  window._saveLeave = async function (id) {
    var activeType = document.querySelector('#edit-leave-types .bk-leave-type.active');
    var leaveType = activeType ? activeType.dataset.type : 'vacation';
    var notes = document.getElementById('edit-leave-notes').value;
    var date = document.getElementById('edit-leave-date').value;

    if (!date) {
      toast(t('common.date'), 'error');
      return;
    }

    try {
      await api('/api/leave/' + id, {
        method: 'PUT',
        body: { type: leaveType, notes: notes, date: date }
      });
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.leave_updated'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('schedule.update_failed'), 'error');
    }
  };

  window._deleteLeave = async function (id) {
    if (!confirm(t('schedule.confirm_delete_leave'))) return;
    try {
      await api('/api/leave/' + id, { method: 'DELETE' });
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.leave_deleted'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.delete_failed'), 'error');
    }
  };

  /* --------------------------------------------------
     HTML-escape helpers
     -------------------------------------------------- */
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

})();
