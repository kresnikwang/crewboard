/* schedule/06-actions.js — part of schedule module (bundled into schedule.js) */
window.saveBooking = async function (id) {
  var totalH = parseFloat(document.getElementById('bk-hours').value) || 0;

  var projectId = parseInt(document.getElementById('bk-project').value, 10);
  if (!projectId) {
    toast(t('schedule.select_project'), 'error');
    return;
  }

  var resourceIds = getSelectedResourceIds();
  if (resourceIds.length === 0) { toast(t('schedule.search_resource'), 'error'); return; }

  var scopeSelect = document.getElementById('bk-scope');
  var projectScopeId = scopeSelect && scopeSelect.value ? parseInt(scopeSelect.value, 10) : null;
  var hoursRounded = Math.round(totalH * 10) / 10;
  var isTentative = document.getElementById('bk-tentative').checked;
  var notesVal = document.getElementById('bk-notes').value;

  /* Multi-day span: "全部天数" applies the same fields to every day in the span
     (dates stay on each day — only project / hours / notes / tentative change). */
  var editRange = typeof getEditRangeMode === 'function' ? getEditRangeMode() : 'day';
  if (id && editRange === 'all' && _editSpanContext && _editSpanContext.ids && _editSpanContext.ids.length > 1) {
    if (hoursRounded <= 0) { toast(t('schedule.invalid_hours'), 'error'); return; }
    try {
      var spanIds = _editSpanContext.ids;
      var promises = spanIds.map(function (bid) {
        var b = _allBookings.find(function (x) { return x.id === bid; });
        if (!b) return Promise.resolve();
        return (window.apiBookingWithConflictConfirm || api)('/api/bookings/' + bid, {
          method: 'PUT',
          body: {
            resource_id: resourceIds[0],
            project_id: projectId,
            project_scope_id: projectScopeId,
            date: b.date,
            hours: hoursRounded,
            is_tentative: isTentative,
            notes: notesVal
          }
        });
      });
      await Promise.all(promises.filter(Boolean));
      _editSpanContext = null;
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.batch_updated'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.update_failed'), 'error');
    }
    return;
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
          project_scope_id: projectScopeId,
          date: startDateVal,
          hours: hoursRounded,
          is_tentative: isTentative,
          notes: notesVal
        };
        await (window.apiBookingWithConflictConfirm || api)('/api/bookings/' + id, { method: 'PUT', body: data });
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

        // Filter out leave dates AND existing booking dates
        var existingBookingMap = {};
        _allBookings.forEach(function (b) {
          if (b.resource_id === resourceIds[0] && b.project_id === projectId) {
            existingBookingMap[b.date] = true;
          }
        });

        var validDates = rangeDates.filter(function (d) {
          return !lMap[resourceIds[0] + '_' + d] && !existingBookingMap[d];
        });

        if (validDates.length === 0) {
          toast(t('schedule.all_dates_have_leave'), 'error');
          reloadAfterMutation();
          return;
        }

        // Warn if some dates were skipped due to existing bookings
        var skippedDates = rangeDates.filter(function (d) {
          return !lMap[resourceIds[0] + '_' + d] && existingBookingMap[d];
        });
        if (skippedDates.length > 0) {
          console.log('Skipped ' + skippedDates.length + ' dates with existing bookings:', skippedDates);
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
          return (window.apiBookingWithConflictConfirm || api)('/api/bookings', {
            method: 'POST',
            body: {
              resource_id: resourceIds[0],
              project_id: projectId,
              project_scope_id: projectScopeId,
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
            createPromises.push((window.apiBookingWithConflictConfirm || api)('/api/bookings', {
              method: 'POST',
              body: {
                resource_id: rid,
                project_id: projectId,
                project_scope_id: projectScopeId,
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
          return (window.apiBookingWithConflictConfirm || api)('/api/bookings', {
            method: 'POST',
            body: {
              resource_id: rid,
              project_id: projectId,
              project_scope_id: projectScopeId,
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
    _editSpanContext = null;
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
   6b. bookPublicHolidays
   -------------------------------------------------- */
window.bookPublicHolidays = async function () {
  var resourceIds = getSelectedResourceIds('to');
  var startDate = document.getElementById('to-date-start').value;
  var endDate = document.getElementById('to-date-end').value || startDate;

  if (resourceIds.length === 0) {
    toast(t('schedule.search_resource'), 'error');
    return;
  }

  if (!startDate) {
    toast(t('schedule.select_date_range'), 'error');
    return;
  }

  var confirmed = window.confirm(t('schedule.book_holidays_confirm_prompt', { start: startDate, end: endDate }));
  if (!confirmed) return;

  try {
    var res = await api('/api/leave/book-holidays', {
      method: 'POST',
      body: {
        resource_ids: resourceIds,
        start_date: startDate,
        end_date: endDate
      }
    });

    if (res.ok) {
      if (res.count > 0) {
        toast(t('schedule.book_holidays_success', { count: res.count }), 'success');
        document.getElementById('modal').classList.remove('bk-modal');
        closeModal();
        reloadAfterMutation();
      } else {
        toast(t('schedule.book_holidays_none'), 'info');
      }
    } else {
      toast(res.error || t('schedule.book_holidays_failed'), 'error');
    }
  } catch (err) {
    toast(err.message || t('schedule.book_holidays_failed'), 'error');
  }
};

/* --------------------------------------------------
   7. editBooking & deleteBooking
   -------------------------------------------------- */
window.editBooking = function (id) {
  var booking = _allBookings.find(function (b) { return b.id === id; });
  if (booking && !canBookForResource(booking.resource_id)) {
    toast(t('schedule.no_edit_permission'), 'error');
    return;
  }
  // Always open the full single-day editor for the clicked day.
  // If it belongs to a multi-day span, the modal shows a "this day / all days"
  // range toggle so the user can edit one day without pre-splitting.
  showBookingModal(id);
};

/* Split a multi-day booking at the clicked point (called by split-handle click) */
window.splitBooking = function (id) {
  var booking = _allBookings.find(function (b) { return b.id === id; });
  if (!booking) return;
  if (!canBookForResource(booking.resource_id)) {
    toast(t('schedule.no_edit_permission'), 'error');
    return;
  }

  // Build the full span from _allBookings (not restricted to current view),
  // mirroring detectSpans logic so cross-week spans work correctly.
  var resourceId = booking.resource_id;
  var targetHours = parseFloat(booking.hours);
  var targetTentative = !!booking.is_tentative;
  var targetProject = booking.project_id;
  var matchFn = function (b) {
    return b.resource_id === resourceId &&
           b.project_id === targetProject &&
           parseFloat(b.hours) === targetHours &&
           !!b.is_tentative === targetTentative;
  };

  // Walk backward to find span start
  var spanStart = new Date(booking.date);
  while (true) {
    var prevD = new Date(spanStart);
    prevD.setDate(prevD.getDate() - 1);
    var prevStr = fmt(prevD);
    var prevBk = _allBookings.find(function (b) { return b.date === prevStr && matchFn(b); });
    if (!prevBk) break;
    if (prevBk.split_after === 1 || prevBk.split_after === true) break;
    spanStart = prevD;
  }

  // Walk forward from span start to collect full span
  var spanBookings = [];
  var cur = new Date(spanStart);
  while (true) {
    var curStr = fmt(cur);
    var curBk = _allBookings.find(function (b) { return b.date === curStr && matchFn(b); });
    if (!curBk) break;
    spanBookings.push(curBk);
    if (curBk.split_after === 1 || curBk.split_after === true) break;
    cur.setDate(cur.getDate() + 1);
  }

  if (spanBookings.length < 2) {
    toast(t('schedule.cannot_split'), 'info');
    return;
  }

  var clicked = spanBookings.find(function (b) { return b.id === id; });
  var idx = spanBookings.indexOf(clicked);
  var rightIds = spanBookings.slice(idx + 1).map(function (b) { return b.id; });

  if (rightIds.length === 0) {
    toast(t('schedule.cannot_split'), 'info');
    return;
  }

  // Persist the split: set split_after on the clicked booking
  var clickedId = clicked.id;
  api('/api/bookings/' + clickedId, {
    method: 'PUT',
    body: { split_after: 1 }
  }).then(function () {
    var bk = _allBookings.find(function (b) { return b.id === clickedId; });
    if (bk) bk.split_after = 1;
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
        splitHandle.title = t('schedule.split_booking');
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
  var editRange = typeof getEditRangeMode === 'function' ? getEditRangeMode() : 'day';
  var deleteAll = editRange === 'all' && _editSpanContext && _editSpanContext.ids && _editSpanContext.ids.length > 1;

  if (deleteAll) {
    if (!confirm(t('schedule.confirm_delete_batch'))) return;
    try {
      await Promise.all(_editSpanContext.ids.map(function (bid) {
        return api('/api/bookings/' + bid, { method: 'DELETE' });
      }));
      _editSpanContext = null;
      document.getElementById('modal').classList.remove('bk-modal');
      closeModal();
      toast(t('schedule.batch_deleted'), 'success');
      reloadAfterMutation();
    } catch (err) {
      toast(err.message || t('common.delete_failed'), 'error');
    }
    return;
  }

  if (!confirm(t('schedule.confirm_delete_booking'))) return;
  try {
    await api('/api/bookings/' + id, { method: 'DELETE' });
    _editSpanContext = null;
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
