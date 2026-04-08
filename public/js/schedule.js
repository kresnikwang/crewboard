/* ============================================================
   schedule.js — Schedule / Calendar page module
   ResourceGuru-style booking & time-off modal
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;

  /* ---- cached bookings & leave used by edit lookup ---- */
  var _allBookings = [];
  var _allLeave    = [];

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
      rangeEl.textContent =
        s.getFullYear() + '年' + (s.getMonth() + 1) + '月' + s.getDate() + '日 - ' +
        (e.getMonth() + 1) + '月' + e.getDate() + '日';
    }

    /* Update today button label */
    var todayBtn = document.getElementById('schedule-today');
    if (todayBtn) todayBtn.textContent = isMonth ? '本月' : '本周';

    var results = await Promise.all([
      api('/api/resources'),
      api('/api/bookings?start=' + startStr + '&end=' + endStr),
      api('/api/leave?start=' + startStr + '&end=' + endStr),
      api('/api/holidays?start=' + startStr + '&end=' + endStr)
    ]);

    var resources = results[0];
    var bookings  = results[1];
    var leave     = results[2];
    var holidays  = results[3];

    state.resources = resources;
    _allBookings = bookings;
    _allLeave    = leave;

    var teams = {};
    resources.forEach(function (r) {
      var t = r.team || '未分组';
      if (!teams[t]) teams[t] = [];
      teams[t].push(r);
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

    /* attach click on leave blocks for deletion */
    document.querySelectorAll('.leave-block[data-leave-id], .m-leave[data-leave-id]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var leaveId = parseInt(el.dataset.leaveId, 10);
        var leaveEntry = _allLeave.find(function (l) { return l.id === leaveId; });
        if (leaveEntry) {
          showDeleteLeaveConfirm(leaveEntry);
        }
      });
    });

    /* attach resize handlers to booking blocks */
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
          toast('您没有编辑此预订的权限', 'error');
          return;
        }
        
        // Prevent the click event on the booking block
        block.style.pointerEvents = 'none';
        setTimeout(function () {
          block.style.pointerEvents = '';
        }, 100);
        
        initResizeBooking(block, booking, e);
      });
    });
  };

  /* --------------------------------------------------
     Table header builder
     -------------------------------------------------- */
  function buildHeaderHTML(days, hMap) {
    var html = '<table class="schedule-table"><thead><tr><th>人员</th>';
    days.forEach(function (d) {
      var cls = [];
      if (isToday(d))   cls.push('today');
      if (isWeekend(d))  cls.push('weekend');
      var dateStr = fmt(d);
      var holiday = hMap[dateStr];
      var holidayHTML = '';
      if (holiday) {
        if (holiday.type === 'workday') {
          holidayHTML = '<br><span class="holiday-marker workday">调休上班</span>';
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

    days.forEach(function (d) {
      var dateStr = fmt(d);
      var key = r.id + '_' + dateStr;
      var dayBookings = bMap[key] || [];
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
        var bgColor = (b.project_color || '#6366F1') + '22';
        var fgColor = b.project_color || '#6366F1';

        html += '<div class="booking-block' + tentCls + '"' +
          ' style="background:' + bgColor + ';color:' + fgColor + ';border-left:3px solid ' + fgColor + '"' +
          ' data-booking-id="' + b.id + '"' +
          ' data-resource-id="' + b.resource_id + '"' +
          ' data-date="' + b.date + '"' +
          ' onclick="window.editBooking(' + b.id + ')"' +
          ' title="' + escAttr(b.project_name) + ' - ' + b.hours + 'h' +
            (b.notes ? '\n' + escAttr(b.notes) : '') + '">' +
          '<span class="booking-hours">' + b.hours + 'h</span> ' +
          '<span class="booking-project">' + esc(b.project_name) + '</span>' +
          '<div class="resize-handle"></div>' +
        '</div>';
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
    var labels = { vacation: '休假', sick: '病假', personal: '事假', holiday: '法定假期', other: '请假' };
    return labels[type] || '休假';
  }

  /* --------------------------------------------------
     Resize booking duration (ResourceGuru style)
     -------------------------------------------------- */
  function initResizeBooking(blockElement, booking, startEvent) {
    var isResizing = true;

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

    // ── 3. 视觉状态 ────────────────────────────────────────────────
    blockElement.classList.add('resizing');

    // 全屏透明遮罩，锁定 cursor 并阻止其他事件
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;user-select:none;';
    document.body.appendChild(overlay);

    // 高亮预览：把 originalIndex 到 hoverIndex 之间的格子加 resize-preview 类
    var previewCells = [];
    function clearPreview() {
      previewCells.forEach(function (c) { c.classList.remove('resize-preview', 'resize-preview-shrink'); });
      previewCells = [];
    }
    function applyPreview(hoverIndex) {
      clearPreview();
      var lo = Math.min(originalIndex, hoverIndex);
      var hi = Math.max(originalIndex, hoverIndex);
      var isShrink = hoverIndex < originalIndex;
      for (var i = lo; i <= hi; i++) {
        var c = dateMap[dates[i]];
        if (c) {
          c.classList.add('resize-preview');
          if (isShrink) c.classList.add('resize-preview-shrink');
          previewCells.push(c);
        }
      }
    }

    var currentHoverIndex = originalIndex;

    // ── 4. mousemove：用 elementFromPoint 追踪悬停格 ───────────────
    function handleMouseMove(e) {
      if (!isResizing) return;
      e.preventDefault();

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

      if (hoverIndex !== currentHoverIndex) {
        currentHoverIndex = hoverIndex;
        applyPreview(hoverIndex);
      }
    }

    // ── 5. mouseup：执行实际操作 ───────────────────────────────────
    function handleMouseUp(e) {
      if (!isResizing) return;
      cleanup();

      if (currentHoverIndex === originalIndex) return; // 没有移动，不操作

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
          toast('所选范围已有相同预订', 'info');
          return;
        }
        Promise.all(promises)
          .then(function () {
            toast('预订已延长 ' + promises.length + ' 天', 'success');
            window.loadSchedule();
          })
          .catch(function (err) {
            toast('延长失败：' + (err.message || ''), 'error');
          });

      } else {
        // ── 向左：缩短 ──
        // 删除 currentHoverIndex+1 ~ originalIndex 范围内同资源同项目的 bookings
        var toDelete = _allBookings.filter(function (b) {
          if (b.resource_id !== booking.resource_id) return false;
          if (b.project_id  !== booking.project_id)  return false;
          var idx = dates.indexOf(b.date);
          return idx > currentHoverIndex && idx <= originalIndex;
        });
        if (toDelete.length === 0) {
          toast('没有可缩短的预订', 'info');
          return;
        }
        Promise.all(toDelete.map(function (b) {
          return api('/api/bookings/' + b.id, { method: 'DELETE' });
        }))
          .then(function () {
            toast('预订已缩短 ' + toDelete.length + ' 天', 'success');
            window.loadSchedule();
          })
          .catch(function (err) {
            toast('缩短失败：' + (err.message || ''), 'error');
          });
      }
    }

    // ── 6. 清理函数 ────────────────────────────────────────────────
    function cleanup() {
      isResizing = false;
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
     Drag selection for multiple days (ResourceGuru style)
     -------------------------------------------------- */
  function initDragSelection(container) {
    var isDragging = false;
    var startCell = null;
    var endCell = null;
    var selectedCells = [];

    container.addEventListener('mousedown', function (e) {
      var cell = e.target.closest('.booking-cell, .m-day-cell');
      if (!cell) return;
      
      // Don't start drag if clicking on existing booking or leave
      if (e.target.closest('.booking-block, .leave-block, .m-booking, .m-leave')) {
        return;
      }

      // Check permissions
      var rid = parseInt(cell.dataset.resource, 10);
      if (!rid || !canBookForResource(rid)) return;

      e.preventDefault();
      isDragging = true;
      startCell = cell;
      endCell = cell;
      selectedCells = [cell];

      // Highlight starting cell
      cell.classList.add('drag-selecting', 'drag-start');

      // Add global listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });

    function handleMouseMove(e) {
      if (!isDragging) return;

      var cell = document.elementFromPoint(e.clientX, e.clientY);
      if (!cell) return;

      cell = cell.closest('.booking-cell, .m-day-cell');
      if (!cell || cell === endCell) return;

      // Check if same resource
      var startRid = parseInt(startCell.dataset.resource, 10);
      var endRid = parseInt(cell.dataset.resource, 10);
      if (startRid !== endRid) return;

      // Clear previous selection
      selectedCells.forEach(function (c) {
        c.classList.remove('drag-selecting', 'drag-end');
      });

      // Determine start and end dates
      var startDate = startCell.dataset.date;
      var endDate = cell.dataset.date;
      
      // Get all cells for this resource
      var allCells = container.querySelectorAll('[data-resource="' + startRid + '"]');
      var dateMap = {};
      allCells.forEach(function (c) {
        dateMap[c.dataset.date] = c;
      });

      // Sort dates
      var dates = Object.keys(dateMap).sort();
      var startIndex = dates.indexOf(startDate);
      var endIndex = dates.indexOf(endDate);
      
      // If dates not found (month view?), try alternative approach
      if (startIndex === -1 || endIndex === -1) {
        // Simple fallback: just highlight the cell
        cell.classList.add('drag-selecting', 'drag-end');
        selectedCells = [startCell, cell];
        endCell = cell;
        return;
      }

      // Ensure startIndex <= endIndex
      if (startIndex > endIndex) {
        var temp = startIndex;
        startIndex = endIndex;
        endIndex = temp;
      }

      // Select range
      selectedCells = [];
      for (var i = startIndex; i <= endIndex; i++) {
        var date = dates[i];
        var c = dateMap[date];
        if (c) {
          c.classList.add('drag-selecting');
          selectedCells.push(c);
          if (i === startIndex) c.classList.add('drag-start');
          if (i === endIndex) c.classList.add('drag-end');
        }
      }
      endCell = cell;
    }

    function handleMouseUp(e) {
      if (!isDragging) return;

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // Clear selection after delay
      setTimeout(function () {
        selectedCells.forEach(function (c) {
          c.classList.remove('drag-selecting', 'drag-start', 'drag-end');
        });
      }, 300);

      // Only proceed if we have at least 2 cells selected
      if (selectedCells.length < 2) {
        isDragging = false;
        return;
      }

      var rid = parseInt(startCell.dataset.resource, 10);
      var startDate = startCell.dataset.date;
      var endDate = endCell.dataset.date;

      // Show booking modal for the date range
      showBookingModal(null, rid, startDate, endDate);

      isDragging = false;
      startCell = null;
      endCell = null;
      selectedCells = [];
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
    html += '<th class="m-res-hd">人员</th>';
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

    days.forEach(function (d) {
      var dateStr = fmt(d);
      var key = r.id + '_' + dateStr;
      var dayBookings = bMap[key] || [];
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
        html += '<div class="' + leaveCls + '" data-leave-id="' + dayLeave.id + '">' +
          getLeaveLabel(dayLeave.type).charAt(0) + '</div>';
      }

      /* Booking blocks */
      var totalH = 0;
      dayBookings.forEach(function (b) {
        totalH += b.hours;
        var bgColor = (b.project_color || '#6366F1') + '33';
        var fgColor = b.project_color || '#6366F1';
        html += '<div class="m-booking" data-booking-id="' + b.id + '"' +
          ' data-resource-id="' + b.resource_id + '"' +
          ' data-date="' + b.date + '"' +
          ' style="background:' + bgColor + ';color:' + fgColor + ';border-left:2px solid ' + fgColor + '"' +
          ' title="' + escAttr(b.hours + 'h ' + b.project_name + (b.client_name ? ' | ' + b.client_name : '')) + '">' +
          '<span class="m-booking-hours">' + b.hours + 'h</span> ' +
          esc(b.project_name) +
          '<div class="resize-handle"></div>' +
          '</div>';
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
        if (todayBtn) todayBtn.textContent = view === 'month' ? '本月' : '本周';
        /* Reset to current week's Monday */
        state.scheduleWeekStart = getMonday(new Date());
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
    var projOpts = '<option value="">-- 选择项目 --</option>';
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
      footer += '<button class="btn btn-danger bk-footer-left" onclick="window.deleteBooking(' + bookingId + ')">删除预订</button>';
    }
    footer += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
    if (bookingId) {
      footer += '<button class="btn btn-primary" onclick="window.saveBooking(' + bookingId + ')">保存更改</button>';
    } else {
      footer += '<button class="btn btn-primary" id="bk-submit-btn" onclick="window.submitBookingOrLeave()">添加预订</button>';
    }

    var title = bookingId ? '编辑预订' : '新建';
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

  /* ---- Modal tabs HTML ---- */
  function buildModalTabs(bookingId) {
    if (bookingId) return ''; /* no tabs when editing */
    return '<div class="bk-tabs">' +
      '<button class="bk-tab active" data-tab="booking">预订</button>' +
      '<button class="bk-tab" data-tab="timeoff">休假</button>' +
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
      var t = r.team || '未分组';
      if (!teams[t]) teams[t] = [];
      teams[t].push(r);
    });
    var optionsHtml = '';
    Object.keys(teams).forEach(function (t) {
      optionsHtml += '<div class="ms-team-label">' + esc(t) + '</div>';
      teams[t].forEach(function (r) {
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
        '<div class="bk-field-label">人员（可多选）</div>' +
        '<div class="ms-picker" id="' + id + '-picker">' +
          '<div class="ms-selected" id="' + id + '-selected">' +
            chipsHtml +
            '<input class="ms-search" id="' + id + '-search" placeholder="搜索人员..." autocomplete="off">' +
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
            '<label>小时/天</label>' +
            '<input type="number" id="bk-hours" class="text-input" value="' + hoursVal + '" min="0.5" max="24" step="0.5" onchange="window._updateBkTotal()" oninput="window._updateBkTotal()">' +
          '</div>' +
          '<div class="bk-hours-group">' +
            '<label>分钟</label>' +
            '<input type="number" id="bk-mins" class="text-input" value="0" min="0" max="59" step="15" onchange="window._updateBkTotal()" oninput="window._updateBkTotal()">' +
          '</div>' +
        '</div>' +
        '<div class="bk-date-row">' +
          '<label>从</label>' +
          '<input type="date" id="bk-date-start" class="text-input" value="' + dateVal + '" onchange="window._updateBkTotal()">' +
          '<label>至</label>' +
          '<input type="date" id="bk-date-end" class="text-input" value="' + (isEdit ? dateVal : endDateVal) + '" onchange="window._updateBkTotal()">' +
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
          '<label>从</label>' +
          '<input type="date" id="to-date-start" class="text-input" value="' + dateVal + '" onchange="window._updateToTotal()">' +
          '<label>至</label>' +
          '<input type="date" id="to-date-end" class="text-input" value="' + endDateVal + '" onchange="window._updateToTotal()">' +
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
        '<div class="bk-field-label">项目 / 客户</div>' +
        '<select id="bk-project" class="text-input">' + projOpts + '</select>' +
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
          '<span class="bk-toggle-label">暂定预订</span>' +
        '</label>' +
      '</div>' +
    '</div>';
  }

  /* ---- Leave type field ---- */
  function buildLeaveTypeField() {
    return '<div class="bk-field">' +
      '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16" stroke="currentColor" stroke-width="1.5"/><path d="M7 11l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<div class="bk-field-body">' +
        '<div class="bk-field-label">休假类型</div>' +
        '<div class="bk-leave-types">' +
          '<button class="bk-leave-type active" data-type="vacation">年假</button>' +
          '<button class="bk-leave-type sick" data-type="sick">病假</button>' +
          '<button class="bk-leave-type personal" data-type="personal">事假</button>' +
          '<button class="bk-leave-type holiday" data-type="holiday">法定假期</button>' +
          '<button class="bk-leave-type other" data-type="other">其他</button>' +
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
        '<div class="bk-field-label">备注</div>' +
        '<textarea id="' + id + '" class="text-input" rows="2" placeholder="可选备注..." style="resize:vertical">' + esc(val) + '</textarea>' +
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
          submitBtn.textContent = target === 'timeoff' ? '添加休假' : '添加预订';
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
    var mins = parseInt((document.getElementById('bk-mins') || {}).value) || 0;
    var startEl = document.getElementById('bk-date-start');
    var endEl = document.getElementById('bk-date-end');
    if (!startEl || !endEl) return;

    var totalHPerDay = hours + mins / 60;
    var totalDays = countAllDays(startEl.value, endEl.value);
    var totalH = totalHPerDay * totalDays;

    var el = document.getElementById('bk-total');
    if (el) {
      el.textContent = '合计: ' + totalH.toFixed(1) + 'h (' + totalDays + '天, ' + totalHPerDay.toFixed(1) + 'h/天)';
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
      el.textContent = '合计: ' + totalDays + '天';
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
    var hours = parseFloat(document.getElementById('bk-hours').value) || 0;
    var mins = parseInt((document.getElementById('bk-mins') || {}).value) || 0;
    var totalH = hours + mins / 60;

    var projectId = parseInt(document.getElementById('bk-project').value, 10);
    if (!projectId) {
      toast('请选择一个项目', 'error');
      return;
    }

    var resourceIds;
    if (id) {
      /* editing single booking — use its resource_id */
      resourceIds = [parseInt(document.getElementById('bk-resource-selected')
        ? getSelectedResourceIds()[0]
        : 0, 10)];
      resourceIds = getSelectedResourceIds();
      if (resourceIds.length === 0) { toast('请选择人员', 'error'); return; }
    } else {
      resourceIds = getSelectedResourceIds();
      if (resourceIds.length === 0) { toast('请选择至少一名人员', 'error'); return; }
    }

    try {
      if (id) {
        /* single day update for existing booking */
        var data = {
          resource_id: resourceIds[0],
          project_id: projectId,
          date: document.getElementById('bk-date-start').value,
          hours: Math.round(totalH * 10) / 10,
          is_tentative: document.getElementById('bk-tentative').checked,
          notes: document.getElementById('bk-notes').value
        };
        await api('/api/bookings/' + id, { method: 'PUT', body: data });
      } else {
        /* Create bookings for each selected resource */
        var promises = resourceIds.map(function (rid) {
          return api('/api/bookings', {
            method: 'POST',
            body: {
              resource_id: rid,
              project_id: projectId,
              date: document.getElementById('bk-date-start').value,
              end_date: document.getElementById('bk-date-end').value,
              hours: Math.round(totalH * 10) / 10,
              is_tentative: document.getElementById('bk-tentative').checked,
              notes: document.getElementById('bk-notes').value
            }
          });
        });
        await Promise.all(promises);
      }
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(id ? '预订已更新' : '预订已创建（' + resourceIds.length + '人）', 'success');
      window.loadSchedule();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
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
      toast('请选择人员和日期', 'error');
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
      toast('休假已添加（' + resourceIds.length + '人）', 'success');
      window.loadSchedule();
    } catch (err) {
      toast(err.message || '添加休假失败', 'error');
    }
  }

  /* --------------------------------------------------
     7. editBooking & deleteBooking
     -------------------------------------------------- */
  window.editBooking = function (id) {
    var booking = _allBookings.find(function (b) { return b.id === id; });
    if (booking && !canBookForResource(booking.resource_id)) {
      toast('您没有编辑此预订的权限', 'error');
      return;
    }
    showBookingModal(id);
  };

  window.deleteBooking = async function (id) {
    if (!confirm('确定要删除这个预订吗？')) return;
    try {
      await api('/api/bookings/' + id, { method: 'DELETE' });
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast('预订已删除', 'success');
      window.loadSchedule();
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  };

  /* --------------------------------------------------
     8. Delete leave confirm
     -------------------------------------------------- */
  function showDeleteLeaveConfirm(leaveEntry) {
    if (!canBookForResource(leaveEntry.resource_id)) {
      toast('您没有管理此人休假的权限', 'error');
      return;
    }
    var label = getLeaveLabel(leaveEntry.type);
    var body = '<p style="font-size:14px;margin-bottom:8px">' +
      '确定要删除 <strong>' + esc(leaveEntry.resource_name || '') + '</strong> 在 ' +
      leaveEntry.date + ' 的' + label + '记录吗？</p>';
    if (leaveEntry.notes) {
      body += '<p style="font-size:13px;color:var(--text-secondary)">备注: ' + esc(leaveEntry.notes) + '</p>';
    }
    var footer = '<button class="btn btn-outline" onclick="closeModal()">取消</button>' +
      '<button class="btn btn-danger" onclick="window._deleteLeave(' + leaveEntry.id + ')">删除</button>';
    showModal('删除休假', body, footer);
  }

  window._deleteLeave = async function (id) {
    try {
      await api('/api/leave/' + id, { method: 'DELETE' });
      closeModal();
      toast('休假已删除', 'success');
      window.loadSchedule();
    } catch (err) {
      toast(err.message || '删除失败', 'error');
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

})();
