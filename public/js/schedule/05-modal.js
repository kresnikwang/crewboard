/* schedule/05-modal.js — part of schedule module (bundled into schedule.js) */

/** Span context for the open edit modal: { ids, firstDate, lastDate, dayDate, count } or null */
var _editSpanContext = null;
window._clearEditSpanContext = function () { _editSpanContext = null; };

function getEditRangeMode() {
  var checked = document.querySelector('input[name="bk-edit-range"]:checked');
  return checked ? checked.value : 'day';
}

/**
 * Scope toggle when editing a day that belongs to a multi-day continuous span.
 * Default = this day only; user can switch to "all days" without pre-splitting.
 */
function buildEditRangeField(booking, spanGroup) {
  if (!booking || !spanGroup || spanGroup.length <= 1) return '';

  var first = spanGroup[0];
  var last = spanGroup[spanGroup.length - 1];
  var dayLabel = booking.date.length >= 10 ? booking.date.slice(5) : booking.date;
  var rangeLabel = first.date.slice(5) + ' ~ ' + last.date.slice(5);
  var n = spanGroup.length;

  return (
    '<div class="bk-edit-range" id="bk-edit-range-wrap">' +
      '<div class="bk-edit-range-label">' + t('schedule.edit_scope') +
        '<span class="bk-edit-range-badge">' + n + ' ' + t('schedule.days') + '</span>' +
      '</div>' +
      '<div class="bk-edit-range-options" role="radiogroup" aria-label="' + escAttr(t('schedule.edit_scope')) + '">' +
        '<label class="bk-edit-range-opt">' +
          '<input type="radio" name="bk-edit-range" value="day" checked>' +
          '<span class="bk-edit-range-opt-body">' +
            '<span class="bk-edit-range-opt-title">' + t('schedule.edit_this_day') + '</span>' +
            '<span class="bk-edit-range-opt-sub">' + dayLabel + '</span>' +
          '</span>' +
        '</label>' +
        '<label class="bk-edit-range-opt">' +
          '<input type="radio" name="bk-edit-range" value="all">' +
          '<span class="bk-edit-range-opt-body">' +
            '<span class="bk-edit-range-opt-title">' + t('schedule.edit_all_days') + '</span>' +
            '<span class="bk-edit-range-opt-sub">' + rangeLabel + ' · ' + n + ' ' + t('schedule.days') + '</span>' +
          '</span>' +
        '</label>' +
      '</div>' +
      '<div class="bk-edit-range-hint" id="bk-edit-range-hint">' + t('schedule.edit_scope_day_hint') + '</div>' +
    '</div>'
  );
}

function initEditRangeToggle(booking, spanGroup) {
  _editSpanContext = null;
  if (!booking || !spanGroup || spanGroup.length <= 1) return;

  _editSpanContext = {
    ids: spanGroup.map(function (b) { return b.id; }),
    firstDate: spanGroup[0].date,
    lastDate: spanGroup[spanGroup.length - 1].date,
    dayDate: booking.date,
    count: spanGroup.length
  };

  var dateStart = document.getElementById('bk-date-start');
  var dateEnd = document.getElementById('bk-date-end');
  var deleteBtn = document.querySelector('#modal-footer .bk-footer-left');
  var saveBtn = document.querySelector('#modal-footer .btn-primary');
  var titleEl = document.getElementById('modal-title');
  var hintEl = document.getElementById('bk-edit-range-hint');

  function applyMode() {
    var mode = getEditRangeMode();
    var isAll = mode === 'all';

    // All-days mode keeps each day on its own date; lock date fields to the span range display
    if (dateStart) {
      dateStart.disabled = isAll;
      dateStart.value = isAll ? _editSpanContext.firstDate : _editSpanContext.dayDate;
    }
    if (dateEnd) {
      dateEnd.disabled = isAll;
      dateEnd.value = isAll ? _editSpanContext.lastDate : _editSpanContext.dayDate;
    }

    if (hintEl) {
      hintEl.textContent = isAll
        ? t('schedule.edit_scope_all_hint')
        : t('schedule.edit_scope_day_hint');
    }
    if (titleEl) {
      titleEl.textContent = isAll
        ? (t('schedule.batch_edit') + ' (' + _editSpanContext.count + ' ' + t('schedule.days') + ')')
        : t('schedule.edit_booking');
    }
    if (deleteBtn) {
      deleteBtn.textContent = isAll ? t('schedule.delete_all') : t('schedule.delete_booking');
    }
    if (saveBtn) {
      saveBtn.textContent = isAll ? t('schedule.save_all') : t('schedule.save_changes');
    }

    // Visual state on option cards
    document.querySelectorAll('.bk-edit-range-opt').forEach(function (lab) {
      var input = lab.querySelector('input');
      if (input && input.checked) lab.classList.add('active');
      else lab.classList.remove('active');
    });

    updateBookingTotal();
  }

  document.querySelectorAll('input[name="bk-edit-range"]').forEach(function (radio) {
    radio.addEventListener('change', applyMode);
  });
  applyMode();
}

async function showBookingModal(bookingId, resourceId, date, endDate) {
  // Prefer short-lived cache — multi-tenant orgs reopen the modal often
  var fetchRes = typeof cachedApi === 'function'
    ? cachedApi('/api/resources', { maxAge: 60000 })
    : api('/api/resources');
  var fetchProj = typeof cachedApi === 'function'
    ? cachedApi('/api/projects', { maxAge: 60000 })
    : api('/api/projects');
  var fetched = await Promise.all([fetchRes, fetchProj]);
  var resources = fetched[0];
  var projects  = fetched[1];
  // Keep state in sync for other screens
  if (resources && resources.length) state.resources = resources;

  var booking = null;
  if (bookingId) {
    booking = _allBookings.find(function (b) { return b.id === bookingId; });
  }

  // Contiguous multi-day span containing this booking (if any)
  var spanGroup = null;
  if (booking) {
    var seg = findBookingSpanSegment(booking);
    if (seg && seg.length > 1) spanGroup = seg;
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

  var selectedProjectId = booking ? booking.project_id : null;

  var body = buildModalTabs(bookingId) +
    /* ---- BOOKING TAB ---- */
    '<div class="bk-tab-content active" id="bk-tab-booking">' +
      buildEditRangeField(booking, spanGroup) +
      buildResourceField(resources, null, preSelectedIds) +
      buildTimeFields(dateVal, endDateVal, hoursVal, bookingId) +
      '<div class="bk-separator"></div>' +
      buildProjectField(projects, selectedProjectId) +
      buildScopeField(booking ? booking.project_scope_id : null) +
      buildTentativeField(tentChecked) +
      '<div class="bk-separator"></div>' +
      buildNotesField(notesVal) +
      (booking ? buildCreatedByField(booking.created_by_name, booking.created_at, booking.created_by_avatar) : '') +
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
  initProjectSelect(selectedProjectId);

  // Asynchronously populate booking scope field
  updateBookingScopes(selectedProjectId, booking ? booking.project_scope_id : null);

  /* Init tab switching */
  initModalTabs(bookingId);

  /* Init time mode toggle */
  initTimeToggle();

  /* Edit range (this day vs whole span) */
  initEditRangeToggle(booking, spanGroup);

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
    buildCreatedByField(first.created_by_name, first.created_at, first.created_by_avatar) +
    '<div class="bk-batch-preview" id="batch-preview">' +
      '<div class="bk-batch-preview-title">' + t('schedule.preview_changes') + '</div>' +
      '<div class="bk-batch-preview-list">' + groupBookings.map(function (b) {
        return '<div class="bk-batch-preview-item">' +
          '<span class="bk-batch-date">' + b.date.slice(5) + '</span>' +
          '<span class="bk-batch-old">' + b.hours + 'h</span>' +
          '<span class="bk-batch-arrow">→</span>' +
          '<span class="bk-batch-new" id="preview-' + b.id + '">' + first.hours + 'h</span>' +
          '</div>';
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
        '<span class="ms-chip-avatar" style="background:' + (r.color || '#3B7DDD') + '">' + esc(r.name.charAt(0)) + '</span>' +
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
    optionsHtml += '<div class="ms-team-label" style="display: flex; justify-content: space-between; align-items: center;">' +
      '<span>' + esc(tm) + '</span>' +
      '<span class="ms-team-select-all" data-team="' + esc(tm) + '" style="color: var(--primary); cursor: pointer; text-transform: none; font-size: 10px; font-weight: 600;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + t('schedule.select_team_all') + '</span>' +
    '</div>';
    teams[tm].forEach(function (r) {
      var sel = selIds.indexOf(r.id) >= 0 ? ' selected' : '';
      optionsHtml += '<div class="ms-option' + sel + '" data-id="' + r.id + '">' +
        '<span class="ms-option-check"></span>' +
        '<span class="ms-option-avatar" style="background:' + (r.color || '#3B7DDD') + '">' + esc(r.name.charAt(0)) + '</span>' +
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

  /* Option click / Select All click */
  dropdown.addEventListener('click', function (e) {
    var btn = e.target.closest('.ms-team-select-all');
    if (btn) {
      e.stopPropagation();
      var labelEl = btn.parentElement;
      var next = labelEl.nextElementSibling;
      var teamOptions = [];
      while (next && !next.classList.contains('ms-team-label')) {
        if (next.classList.contains('ms-option') && next.style.display !== 'none') {
          teamOptions.push(next);
        }
        next = next.nextElementSibling;
      }

      var selectedCount = teamOptions.filter(function (opt) {
        return opt.classList.contains('selected');
      }).length;

      var allSelected = selectedCount === teamOptions.length;

      teamOptions.forEach(function (opt) {
        var rid = parseInt(opt.dataset.id, 10);
        var isSelected = opt.classList.contains('selected');

        if (allSelected) {
          /* Deselect all */
          if (isSelected) {
            opt.classList.remove('selected');
            var chip = selectedArea.querySelector('.ms-chip[data-id="' + rid + '"]');
            if (chip) chip.remove();
          }
        } else {
          /* Select all */
          if (!isSelected) {
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
        }
      });
      return;
    }

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
      '<div style="margin-top: 10px;">' +
        '<button type="button" class="btn btn-outline" style="width:100%; display:inline-flex; align-items:center; justify-content:center; gap:6px; font-size:12px; padding:4px 8px; border-color:var(--primary-color,#3B7DDD); color:var(--primary-color,#3B7DDD);" onclick="window.bookPublicHolidays()">' +
          '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v4M13 2v4M7 12h6M10 10v4"/></svg>' +
          t('schedule.book_holidays_btn') +
        '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/* ---- Project/Client searchable single-select ---- */
function buildProjectOption(p, clientName, selectedProjectId) {
  var sel = (selectedProjectId && selectedProjectId == p.id) ? ' selected' : '';
  var codePrefix = p.code ? '[' + esc(p.code) + '] ' : '';
  var color = p.color || p.client_color || '#3B7DDD';
  var searchText = (p.name + ' ' + (p.code || '') + ' ' + (clientName || p.client_name || '')).toLowerCase();
  return '<div class="ms-option' + sel + '" data-id="' + p.id + '" data-search="' + escAttr(searchText) + '">' +
    '<span class="ms-option-check"></span>' +
    '<span class="ms-option-avatar" style="background:' + color + '">' + esc(p.name.charAt(0)) + '</span>' +
    '<span class="ms-option-info"><span class="ms-option-name">' + codePrefix + esc(p.name) + '</span>' +
    (clientName || p.client_name ? '<span class="ms-option-role">' + esc(clientName || p.client_name) + '</span>' : '') +
    '</span></div>';
}

function buildProjectField(projects, selectedProjectId) {
  var groups = {};
  var noClient = [];
  projects.forEach(function (p) {
    if (p.client_name) {
      if (!groups[p.client_name]) groups[p.client_name] = [];
      groups[p.client_name].push(p);
    } else {
      noClient.push(p);
    }
  });

  var selectedProject = selectedProjectId
    ? projects.find(function (p) { return p.id == selectedProjectId; })
    : null;
  var labelHtml;
  if (selectedProject) {
    var codePrefix = selectedProject.code ? '[' + esc(selectedProject.code) + '] ' : '';
    labelHtml = '<span class="pp-selected" id="bk-project-label">' + codePrefix + esc(selectedProject.name) + '</span>';
  } else {
    labelHtml = '<span class="ms-placeholder" id="bk-project-label">' + t('schedule.select_project') + '</span>';
  }

  var optionsHtml = '';
  Object.keys(groups).sort().forEach(function (clientName) {
    optionsHtml += '<div class="ms-team-label">' + esc(clientName) + '</div>';
    groups[clientName].forEach(function (p) {
      optionsHtml += buildProjectOption(p, clientName, selectedProjectId);
    });
  });
  if (noClient.length) {
    optionsHtml += '<div class="ms-team-label">' + t('schedule.no_client') + '</div>';
    noClient.forEach(function (p) {
      optionsHtml += buildProjectOption(p, '', selectedProjectId);
    });
  }

  return '<div class="bk-field">' +
    '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.5"/></svg>' +
    '<div class="bk-field-body">' +
      '<div class="bk-field-label">' + t('schedule.project_client') + '</div>' +
      '<div class="ms-picker" id="bk-project-picker">' +
        '<div class="ms-selected" id="bk-project-selected">' +
          labelHtml +
          '<input class="ms-search" id="bk-project-search" placeholder="' + t('schedule.search_project') + '" autocomplete="off">' +
        '</div>' +
        '<div class="ms-dropdown" id="bk-project-dropdown">' + optionsHtml + '</div>' +
        '<input type="hidden" id="bk-project" value="' + (selectedProjectId || '') + '">' +
      '</div>' +
    '</div>' +
  '</div>';
}

function buildScopeField(selectedScopeId) {
  return '<div class="bk-field" id="bk-scope-container" style="display:none;">' +
    '<svg class="bk-field-icon" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8h6M7 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
    '<div class="bk-field-body">' +
      '<div class="bk-field-label">' + t('schedule.work_scope') + '</div>' +
      '<select id="bk-scope" class="rg-select text-input form-control form-control-sm">' +
        '<option value="">' + t('schedule.no_scope_option') + '</option>' +
      '</select>' +
    '</div>' +
  '</div>';
}

async function updateBookingScopes(projectId, selectedScopeId) {
  var container = document.getElementById('bk-scope-container');
  var select = document.getElementById('bk-scope');
  if (!container || !select) return;

  if (!projectId) {
    container.style.display = 'none';
    select.innerHTML = '<option value="">' + t('schedule.no_scope_option') + '</option>';
    return;
  }

  try {
    var scopes = await api('/api/projects/' + projectId + '/scopes');
    if (scopes && scopes.length > 0) {
      var html = '<option value="">' + t('schedule.no_scope_option') + '</option>';
      scopes.forEach(function (s) {
        var sel = s.id == selectedScopeId ? ' selected' : '';
        html += '<option value="' + s.id + '"' + sel + '>' + esc(s.name) + '</option>';
      });
      select.innerHTML = html;
      container.style.display = '';
    } else {
      container.style.display = 'none';
      select.innerHTML = '<option value="">' + t('schedule.no_scope_option') + '</option>';
    }
  } catch (e) {
    console.error('Failed to load scopes for project ' + projectId, e);
    container.style.display = 'none';
  }
}

function initProjectSelect(selectedProjectId) {
  var picker = document.getElementById('bk-project-picker');
  if (!picker) return;

  var selectedArea = document.getElementById('bk-project-selected');
  var dropdown = document.getElementById('bk-project-dropdown');
  var searchInput = document.getElementById('bk-project-search');
  var hiddenInput = document.getElementById('bk-project');
  var labelEl = document.getElementById('bk-project-label');

  function filterProjectOptions(q) {
    dropdown.querySelectorAll('.ms-option').forEach(function (opt) {
      var search = opt.dataset.search || '';
      var name = opt.querySelector('.ms-option-name').textContent.toLowerCase();
      var match = !q || search.indexOf(q) >= 0 || name.indexOf(q) >= 0;
      opt.style.display = match ? '' : 'none';
    });
    dropdown.querySelectorAll('.ms-team-label').forEach(function (lbl) {
      var next = lbl.nextElementSibling;
      var anyVisible = false;
      while (next && !next.classList.contains('ms-team-label')) {
        if (next.style.display !== 'none') anyVisible = true;
        next = next.nextElementSibling;
      }
      lbl.style.display = anyVisible ? '' : 'none';
    });
  }

  selectedArea.addEventListener('click', function (e) {
    if (e.target === searchInput) return;
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) searchInput.focus();
  });

  searchInput.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.add('open');
  });

  dropdown.addEventListener('click', function (e) {
    var opt = e.target.closest('.ms-option');
    if (!opt || opt.style.display === 'none') return;
    var pid = parseInt(opt.dataset.id, 10);

    dropdown.querySelectorAll('.ms-option.selected').forEach(function (o) {
      o.classList.remove('selected');
    });
    opt.classList.add('selected');
    hiddenInput.value = pid;

    // Load scopes dynamically
    updateBookingScopes(pid, null);

    var nameEl = opt.querySelector('.ms-option-name');
    if (labelEl) {
      labelEl.className = 'pp-selected';
      labelEl.textContent = nameEl.textContent;
    }

    searchInput.value = '';
    filterProjectOptions('');
    dropdown.classList.remove('open');
  });

  searchInput.addEventListener('input', function () {
    filterProjectOptions(searchInput.value.toLowerCase());
    if (!dropdown.classList.contains('open')) dropdown.classList.add('open');
  });

  document.addEventListener('click', function (e) {
    if (!picker.contains(e.target)) dropdown.classList.remove('open');
  });

  if (selectedProjectId) hiddenInput.value = selectedProjectId;
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
function buildCreatedByField(creatorName, createdAt, avatarUrl) {
  if (!creatorName && !createdAt) return '';
  var info = '';
  if (creatorName) info += esc(creatorName);
  if (createdAt) {
    var isoString = createdAt.replace(' ', 'T');
    if (isoString.indexOf('Z') === -1 && isoString.indexOf('+') === -1) {
      isoString += 'Z';
    }
    var dateObj = new Date(isoString);
    var d = createdAt.replace('T', ' ').substring(0, 16); // Default fallback
    if (!isNaN(dateObj.getTime())) {
      var tz = (state && state.enterprise && state.enterprise.timezone) || null;
      var options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      };
      if (tz) {
        options.timeZone = tz;
      }
      try {
        var formatter = new Intl.DateTimeFormat('zh-CN', options);
        var parts = formatter.formatToParts(dateObj);
        var partMap = {};
        parts.forEach(function (p) {
          partMap[p.type] = p.value;
        });
        d = partMap.year + '-' + partMap.month + '-' + partMap.day + ' ' + partMap.hour + ':' + partMap.minute;
      } catch (err) {
        console.error('Timezone formatting error', err);
        var yyyy = dateObj.getFullYear();
        var mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        var dd = String(dateObj.getDate()).padStart(2, '0');
        var hh = String(dateObj.getHours()).padStart(2, '0');
        var min = String(dateObj.getMinutes()).padStart(2, '0');
        d = yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + min;
      }
    }
    info += (info ? ', ' : '') + d;
  }

  var avatarPart = '';
  if (avatarUrl) {
    avatarPart = '<img src="' + avatarUrl + '" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex-shrink: 0; display: block;">';
  } else {
    var initial = creatorName ? creatorName.charAt(0) : '?';
    avatarPart = '<div style="width: 24px; height: 24px; border-radius: 50%; background: #9CA3AF; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0;">' + esc(initial) + '</div>';
  }

  return '<div class="bk-separator"></div>' +
    '<div class="bk-field" style="display: flex; align-items: center; gap: 14px; margin-bottom: 18px;">' +
      '<div style="width: 20px; display: flex; justify-content: center; color: var(--text-tertiary);">' +
        '<svg class="bk-field-icon" style="margin:0;" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 17.5c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '</div>' +
      '<div class="bk-field-body" style="flex: 1; min-width: 0;">' +
        '<div class="bk-field-label" style="font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .3px;">' + t('schedule.booker') + '</div>' +
        '<div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary);">' +
          avatarPart +
          '<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + info + '</span>' +
        '</div>' +
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
