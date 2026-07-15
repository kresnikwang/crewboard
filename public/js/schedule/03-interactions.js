/* schedule/03-interactions.js — part of schedule module (bundled into schedule.js) */
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
  // 与 detectSpans / 拖动一致：仅日历连续日，不跨空档/周末桥接
  var resizeSegment = findBookingSpanSegment(booking);
  var endDate = resizeSegment.length
    ? resizeSegment[resizeSegment.length - 1].date
    : booking.date;

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
        // 检查目标日期是否有 split_after 标记的 booking（避免跨越分割点）
        var hasSplitAfter = _allBookings.some(function (b) {
          return b.resource_id === booking.resource_id &&
                 b.date === d &&
                 (b.split_after === 1 || b.split_after === true);
        });
        if (!alreadyBooked && !hasSplitAfter) {
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
          toast(t('schedule.drag_further_to_shorten'), 'info');
          return;
        }
      } else {
        // 正常缩短：删除从 hoverDate 之后到 endDate，但要检查 split_after
        toDelete = _allBookings.filter(function (b) {
          if (b.resource_id !== booking.resource_id) return false;
          if (b.project_id  !== booking.project_id)  return false;
          if (b.date <= hoverDate || b.date > endDate) return false;
          // 不要删除有 split_after 标记的 booking（用户手动分割点）
          if (b.split_after === 1 || b.split_after === true) return false;
          return true;
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

  // 2. 找出该 booking 所属连续段的最早日期（左侧锚点）
  // 与 detectSpans / 拖动一致：仅日历连续日，不跨空档/周末桥接
  var groupSegment = findBookingSpanSegment(booking);
  if (!groupSegment || groupSegment.length === 0) groupSegment = [booking];

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
        // 检查目标日期是否有 split_after 标记
        var hasSplitAfter = _allBookings.some(function (b) {
          return b.resource_id === booking.resource_id &&
                 b.date === d &&
                 (b.split_after === 1 || b.split_after === true);
        });
        if (!alreadyBooked && !hasSplitAfter) {
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
        if (b.date >= startDate && b.date < hoverDate) {
          // 不要删除有 split_after 标记的 booking（用户手动分割点）
          if (b.split_after === 1 || b.split_after === true) return false;
          return true;
        }
        return false;
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

  // 2. Contiguous visual span only (matches detectSpans / splitBooking).
  //    Do NOT bridge gaps/weekends with diff<=3 — that wrongly joins separate
  //    same-project periods and makes both segments drag together.
  var groupSegment = findBookingSpanSegment(booking);
  if (!groupSegment || groupSegment.length === 0) groupSegment = [booking];

  // Ids currently being moved — excluded from conflict checks
  var movingIds = {};
  groupSegment.forEach(function (b) { movingIds[b.id] = true; });

  // 3. Visual state
  groupSegment.forEach(function (b) {
    var el = scheduleGrid.querySelector('[data-booking-id="' + b.id + '"]');
    if (el) el.classList.add('moving');
  });

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:grabbing;user-select:none;';
  document.body.appendChild(overlay);

  // Preview highlight: only the days of this span (not a filled range across gaps)
  var previewCells = [];
  function clearPreview() {
    previewCells.forEach(function (c) { c.classList.remove('move-preview'); });
    previewCells = [];
  }
  function applyPreview(delta) {
    clearPreview();
    var anyOutOfView = false;
    groupSegment.forEach(function (b) {
      var oldIdx = dates.indexOf(b.date);
      if (oldIdx === -1) return;
      var newIdx = oldIdx + delta;
      if (newIdx < 0 || newIdx >= dates.length) {
        anyOutOfView = true;
        return;
      }
      var c = dateMap[dates[newIdx]];
      if (c) {
        c.classList.add('move-preview');
        previewCells.push(c);
      }
    });
    return !anyOutOfView;
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

    // Every booking in the span must land on a visible date
    var outOfView = groupSegment.some(function (b) {
      var oldIdx = dates.indexOf(b.date);
      if (oldIdx === -1) return true;
      var newIdx = oldIdx + currentDelta;
      return newIdx < 0 || newIdx >= dates.length;
    });
    if (outOfView) {
      toast(t('schedule.out_of_view'), 'error');
      return;
    }

    // Check for conflicts before moving (ignore other days of the same span)
    var conflictDates = [];
    groupSegment.forEach(function (b) {
      var oldIdx = dates.indexOf(b.date);
      var newIdx = oldIdx + currentDelta;
      if (newIdx >= 0 && newIdx < dates.length) {
        var newDate = dates[newIdx];
        var hasConflict = _allBookings.some(function (other) {
          return other.resource_id === b.resource_id &&
                 other.project_id === b.project_id &&
                 other.date === newDate &&
                 !movingIds[other.id];
        });
        if (hasConflict) conflictDates.push(newDate);
      }
    });

    if (conflictDates.length > 0) {
      toast(t('schedule.move_conflict') + ': ' + conflictDates.slice(0, 3).join(', '), 'error');
      return;
    }

    // Delete original bookings, then create at new dates
    var originalBookings = groupSegment.map(function (b) {
      return {
        resource_id: b.resource_id,
        project_id: b.project_id,
        date: b.date,
        hours: b.hours,
        notes: b.notes || '',
        is_tentative: b.is_tentative ? 1 : 0
      };
    });
    // Preserve split_after flags (POST does not accept them; re-apply via PUT after create)
    var splitAfterFlags = groupSegment.map(function (b) {
      return (b.split_after === 1 || b.split_after === true) ? 1 : 0;
    });

    var deletePromises = groupSegment.map(function (b) {
      return api('/api/bookings/' + b.id, { method: 'DELETE' });
    });

    Promise.all(deletePromises)
      .then(function () {
        var createPromises = groupSegment.map(function (b, idx) {
          var oldIdx = dates.indexOf(b.date);
          var newIdx = oldIdx + currentDelta;
          if (newIdx < 0 || newIdx >= dates.length) return Promise.resolve(null);
          var newDate = dates[newIdx];
          var orig = originalBookings[idx];
          return api('/api/bookings', {
            method: 'POST',
            body: {
              resource_id:  orig.resource_id,
              project_id:   orig.project_id,
              date:         newDate,
              hours:        orig.hours,
              notes:        orig.notes,
              is_tentative: orig.is_tentative
            }
          }).then(function (created) {
            // Restore split_after if the original day had one
            if (splitAfterFlags[idx] && created) {
              var newId = Array.isArray(created.ids) ? created.ids[0] : (created.id || null);
              if (newId) {
                return api('/api/bookings/' + newId, {
                  method: 'PUT',
                  body: { split_after: 1 }
                }).then(function () { return created; }).catch(function () { return created; });
              }
            }
            return created;
          });
        });
        return Promise.all(createPromises);
      })
      .then(function () {
        toast(t('schedule.move') + ' ' + Math.abs(currentDelta) + 'd', 'success');
        reloadAfterMutation();
      })
      .catch(function (err) {
        toast(t('schedule.move_failed') + (err.message ? ': ' + err.message : ''), 'error');
        // Attempt to restore original bookings if move failed
        console.error('Move failed, attempting to restore original bookings:', originalBookings);
        var restorePromises = originalBookings.map(function (b) {
          return api('/api/bookings', {
            method: 'POST',
            body: b
          }).catch(function () { return null; }); // Ignore restore failures
        });
        Promise.all(restorePromises).finally(function () {
          reloadAfterMutation();
        });
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
  if (container._dragSelectionInitialized) return;
  container._dragSelectionInitialized = true;
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
    var startDate = selectedCells[0].dataset.date;
    var endDate   = selectedCells[selectedCells.length - 1].dataset.date;
    if (startDate > endDate) {
      var tmp = startDate; startDate = endDate; endDate = tmp;
    }

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

