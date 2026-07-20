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
        // Background refresh — cheap signature; full reload only if data changed
        var oldSig = scheduleDataSignature(_allBookings, _allLeave);
        var newSig = scheduleDataSignature(freshData.bookings, freshData.leave);
        if (oldSig !== newSig) {
          scheduleLoadSchedule({ immediate: true });
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
  rebuildBookingIndex(bookings);

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

  /* One-time event delegation on the grid (cells / leave / resize / move / split / edit).
     Multi-tenant: avoid O(cells+bookings) addEventListener on every full re-render. */
  var scheduleGrid = document.getElementById('schedule-grid');
  if (scheduleGrid) {
    initDragSelection(scheduleGrid);
    ensureSchedulePointerDelegation(scheduleGrid);
  }

  loadSchedule._isLoading = false;
};

/**
 * Fetch fresh schedule-data and re-render only the given resource rows.
 * Event handlers stay on #schedule-grid (delegation) — no rebind needed.
 */
window.refreshScheduleRows = async function refreshScheduleRows(resourceIds) {
  if (!resourceIds || !resourceIds.length) {
    scheduleLoadSchedule({ immediate: true });
    return;
  }
  if (!state.scheduleWeekStart) {
    state.scheduleWeekStart = getMonday(new Date());
  }
  var isMonth = state.scheduleView === 'month';
  var days;
  if (isMonth) {
    days = [];
    for (var w = 0; w < MONTH_WEEKS; w++) {
      for (var d = 0; d < 7; d++) days.push(addDays(state.scheduleWeekStart, w * 7 + d));
    }
  } else {
    days = weekDates(state.scheduleWeekStart);
  }
  var startStr = fmt(days[0]);
  var endStr = fmt(days[days.length - 1]);
  var url = '/api/schedule-data?start=' + startStr + '&end=' + endStr;

  var schedData = await api(url);
  // Keep SWR cache warm with fresh data
  if (window.apiCache && window.apiCache._set) {
    /* optional */
  }

  var resources = schedData.resources;
  var bookings = schedData.bookings;
  var leave = schedData.leave;
  var holidays = schedData.holidays || {};

  state.resources = resources;
  _allBookings = bookings;
  _allLeave = leave;
  rebuildBookingIndex(bookings);

  var bMap = {};
  bookings.forEach(function (b) {
    var key = b.resource_id + '_' + b.date;
    if (!bMap[key]) bMap[key] = [];
    bMap[key].push(b);
  });
  var lMap = {};
  leave.forEach(function (l) {
    lMap[l.resource_id + '_' + l.date] = l;
  });

  var uniq = {};
  resourceIds.forEach(function (id) { uniq[id] = true; });
  var rids = Object.keys(uniq).map(Number);

  var missing = false;
  rids.forEach(function (rid) {
    var r = resources.find(function (x) { return x.id === rid; });
    if (!r) {
      missing = true;
      return;
    }
    var rowHtml = isMonth
      ? buildMonthResourceRow(r, days, bMap, lMap)
      : buildResourceRow(r, days, bMap, lMap);

    var sel = isMonth
      ? '.m-day-cell[data-resource="' + rid + '"]'
      : '.booking-cell[data-resource="' + rid + '"]';
    var cell = document.querySelector(sel);
    var tr = cell && cell.closest('tr');
    if (!tr) {
      missing = true;
      return;
    }
    tr.outerHTML = rowHtml;
  });

  if (missing) {
    // Row not in DOM (filtered out / view changed) — full reload
    scheduleLoadSchedule({ immediate: true });
  }
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
   Returns a map: bookingId -> { cls, showText, spanLen, sortIdx }
   A span is consecutive days with same (project_id, hours, is_tentative).

   Vertical order is a STABLE key (project → hours → tentative → scope → id)
   applied the same way every day, so concurrent bars never swap tracks mid-week.
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
    return !!findBookingOnDate(resourceId, dateStr, matchFn);
  };

  /** Stable vertical order key — same for every day this booking appears. */
  var stableSortKey = function (b) {
    // project first so each project keeps a fixed track relative to others
    var scope = b.project_scope_id != null ? Number(b.project_scope_id) : 0;
    return [
      Number(b.project_id) || 0,
      parseFloat(b.hours) || 0,
      b.is_tentative ? 1 : 0,
      scope,
      Number(b.id) || 0
    ];
  };
  var cmpKeys = function (ka, kb) {
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  };

  // First pass: identify all spans and calculate their lengths (using full dataset)
  var spanLengths = {};
  var spanStartDate = {};
  var spanEndDate = {};
  var processed = {};

  for (var di = 0; di < dateFmts.length; di++) {
    rawDayLists[di].forEach(function (b) {
      if (processed[b.id]) return;

      var matchFn = matchFnBuilder(b);
      var spanIds = [b.id];
      var startDate = b.date;
      var endDate = b.date;

      var prevDate = new Date(b.date);
      prevDate.setDate(prevDate.getDate() - 1);
      while (true) {
        var prevDateStr = fmt(prevDate);
        var prevBooking = findBookingOnDate(resourceId, prevDateStr, matchFn);
        if (!prevBooking) break;
        if (prevBooking.split_after === 1 || prevBooking.split_after === true) break;
        spanIds.unshift(prevBooking.id);
        startDate = prevDateStr;
        prevDate.setDate(prevDate.getDate() - 1);
      }

      var nextDate = new Date(b.date);
      nextDate.setDate(nextDate.getDate() + 1);
      while (true) {
        var nextDateStr = fmt(nextDate);
        var nextBooking = findBookingOnDate(resourceId, nextDateStr, matchFn);
        if (!nextBooking) break;
        var currBooking = _bookingById[spanIds[spanIds.length - 1]];
        if (currBooking && (currBooking.split_after === 1 || currBooking.split_after === true)) break;
        spanIds.push(nextBooking.id);
        endDate = nextDateStr;
        nextDate.setDate(nextDate.getDate() + 1);
      }

      spanIds.forEach(function (id) {
        spanLengths[id] = spanIds.length;
        spanStartDate[id] = startDate;
        spanEndDate[id] = endDate;
        processed[id] = true;
      });
    });
  }

  // Second pass: stable rank among all bookings on this resource (for sortIdx).
  // Use min id per (project, hours, tentative, scope) so all days of that track share one rank.
  var trackKeyOf = function (b) {
    return [
      Number(b.project_id) || 0,
      parseFloat(b.hours) || 0,
      b.is_tentative ? 1 : 0,
      b.project_scope_id != null ? Number(b.project_scope_id) : 0
    ].join('|');
  };
  var trackRank = {}; // trackKey -> rank
  var trackList = [];
  var seenTrack = {};
  rawDayLists.forEach(function (list) {
    list.forEach(function (b) {
      var tk = trackKeyOf(b);
      if (seenTrack[tk]) return;
      seenTrack[tk] = true;
      trackList.push({ key: tk, sample: b });
    });
  });
  trackList.sort(function (a, b) { return cmpKeys(stableSortKey(a.sample), stableSortKey(b.sample)); });
  trackList.forEach(function (t, i) { trackRank[t.key] = i; });

  // Third pass: assign span classes; sortIdx = stable track rank
  for (var di3 = 0; di3 < dateFmts.length; di3++) {
    rawDayLists[di3].forEach(function (b) {
      var matchFn = matchFnBuilder(b);
      var bDate = b.date;
      var startDate = spanStartDate[b.id] || bDate;
      var endDate = spanEndDate[b.id] || bDate;
      var rank = trackRank[trackKeyOf(b)];
      if (rank == null) rank = 999;

      var prevDate = new Date(bDate);
      prevDate.setDate(prevDate.getDate() - 1);
      var prevDateStr = fmt(prevDate);
      var hasPrev = prevDateStr >= startDate && prevDateStr < bDate &&
                    hasBookingOnDate(prevDateStr, matchFn);

      var nextDate = new Date(bDate);
      nextDate.setDate(nextDate.getDate() + 1);
      var nextDateStr = fmt(nextDate);
      var hasNext = nextDateStr > bDate && nextDateStr <= endDate &&
                    hasBookingOnDate(nextDateStr, matchFn);

      var isAfterSplit = false;
      if (hasPrev) {
        var prevBooking = findBookingOnDate(resourceId, prevDateStr, matchFn);
        isAfterSplit = prevBooking && (prevBooking.split_after === 1 || prevBooking.split_after === true);
      }

      var isSplitPoint = b.split_after === 1 || b.split_after === true;
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

      info[b.id] = {
        cls: cls,
        showText: true,
        spanLen: spanLengths[b.id] || 1,
        sortIdx: rank
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
    return b.project_id === targetProject &&
           parseFloat(b.hours) === targetHours &&
           !!b.is_tentative === targetTentative;
  };

  // Walk backward to span start (indexed by resource+date)
  var spanStart = new Date(booking.date);
  while (true) {
    var prevD = new Date(spanStart);
    prevD.setDate(prevD.getDate() - 1);
    var prevStr = fmt(prevD);
    var prevBk = findBookingOnDate(resourceId, prevStr, matchFn);
    if (!prevBk) break;
    if (prevBk.split_after === 1 || prevBk.split_after === true) break;
    spanStart = prevD;
  }

  // Walk forward from span start, collecting bookings
  var segment = [];
  var cur = new Date(spanStart);
  while (true) {
    var curStr = fmt(cur);
    var curBk = findBookingOnDate(resourceId, curStr, matchFn);
    if (!curBk) break;
    segment.push(curBk);
    if (curBk.split_after === 1 || curBk.split_after === true) break;
    cur.setDate(cur.getDate() + 1);
  }

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
  var target = _bookingById[bookingId] || _allBookings.find(function (b) { return b.id === bookingId; });
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
      // sortIdx = stable lane across the whole resource row (no mid-week crossing)
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
