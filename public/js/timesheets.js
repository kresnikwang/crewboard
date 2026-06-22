/* ============================================================
   timesheets.js — Timesheets page module (v2)
   Features: incremental save, per-cell notes, keyboard nav,
             debounced auto-save, preset hour buttons
   Depends on core.js globals: state, api, fmt, addDays, weekDates,
   shortDay, fmtDate, getMonday, toast
   ============================================================ */

(function () {
  'use strict';

  var state = window.state;
  var api   = window.api;
  var cachedApi = window.cachedApi;

  /* ---- module-level state ---- */
  var _currentBookings = [];
  var _initialValues = {};   // { 'pid_date': {hours, notes} } for incremental save
  var _autoSaveTimer = null;
  var _presetEl = null;      // preset buttons container

  /* --------------------------------------------------
     1. loadTimesheets — main render function
     -------------------------------------------------- */
  window.loadTimesheets = async function loadTimesheets() {
    if (!state.tsWeekStart) {
      state.tsWeekStart = getMonday(new Date());
    }

    /* ---- resolve current user's resource_id ---- */
    var myResourceId = null;
    if (window.state.user && window.state.user.resource_id) {
      myResourceId = window.state.user.resource_id;
    }

    /* ---- resource selector (managers/admins can view others) ---- */
    var perms = window.state.permissions || {};
    var canViewOthers = perms.book_others || perms.manage_resources;

    var resources = state.resources && state.resources.length
      ? state.resources
      : await cachedApi('/api/resources');
    state.resources = resources;

    /* Basic users: always view own resource only */
    if (!canViewOthers && myResourceId) {
      state.tsResourceId = myResourceId;
    } else if (!state.tsResourceId && resources.length) {
      /* Managers default to their own resource if available */
      var ownRes = myResourceId && resources.find(function (r) { return r.id === myResourceId; });
      state.tsResourceId = ownRes ? ownRes.id : resources[0].id;
    }

    var selectEl = document.getElementById('ts-resource-select');
    if (selectEl) {
      if (!canViewOthers) {
        /* Hide selector for basic users — they can only see themselves */
        selectEl.parentElement && (selectEl.parentElement.style.display = 'none');
      } else {
        selectEl.parentElement && (selectEl.parentElement.style.display = '');
        selectEl.innerHTML = resources.map(function (r) {
          var sel = r.id === state.tsResourceId ? ' selected' : '';
          return '<option value="' + r.id + '"' + sel + '>' + esc(r.name) + '</option>';
        }).join('');
        selectEl.onchange = function () {
          state.tsResourceId = parseInt(selectEl.value, 10);
          window.loadTimesheets();
        };
      }
    }

    /* ---- Mon-Sun dates (7 days including weekend for overtime) ---- */
    var days = weekDates(state.tsWeekStart).slice(0, 7);
    var startStr = fmt(days[0]);
    var endStr   = fmt(days[6]);

    /* ---- update range label ---- */
    var rangeEl = document.getElementById('ts-range');
    if (rangeEl) {
      var s = days[0];
      var e = days[6];
      rangeEl.textContent =
        (s.getMonth() + 1) + t('common.month') + s.getDate() + t('common.day') + ' - ' +
        (e.getMonth() + 1) + t('common.month') + e.getDate() + t('common.day');
    }

    /* ---- parallel data fetch ---- */
    var rid = state.tsResourceId;
    var results = await Promise.all([
      api('/api/projects'),
      api('/api/timesheets?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid),
      api('/api/bookings?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid)
    ]);

    var projects   = results[0];
    var timesheets = results[1];
    var bookings   = results[2];

    /* ---- cache bookings ---- */
    _currentBookings = bookings;

    /* ---- auto-sync: if there are bookings with no matching timesheet entries,
            call the sync API to pre-fill them (only for own resource) ---- */
    var isOwnResource = (rid === myResourceId) || !myResourceId;
    if (isOwnResource && bookings.length > 0) {
      var tsKeys = new Set();
      timesheets.forEach(function (ts) {
        var scopePart = ts.project_scope_id ? ts.project_scope_id : 'null';
        tsKeys.add(ts.project_id + '_' + scopePart + '_' + ts.date);
      });
      var hasUnsynced = bookings.some(function (b) {
        var scopePart = b.project_scope_id ? b.project_scope_id : 'null';
        return !tsKeys.has(b.project_id + '_' + scopePart + '_' + b.date);
      });

      if (hasUnsynced) {
        try {
          var syncResult = await api('/api/timesheets/sync-from-bookings', {
            method: 'POST',
            body: { resource_id: rid, start: startStr, end: endStr }
          });
          if (syncResult.synced > 0) {
            /* Reload timesheets with the newly synced data */
            timesheets = await api('/api/timesheets?start=' + startStr + '&end=' + endStr + '&resource_id=' + rid);
            toast(t('timesheets.synced_from_schedule') + ' ' + syncResult.synced + ' ' + t('timesheets.records'), 'info');
          }
        } catch (syncErr) {
          /* Non-fatal: sync failed, continue with existing data */
          console.warn('Auto-sync failed:', syncErr);
        }
      }
    }

    /* ---- find relevant rows (project + scope combinations) ---- */
    var relevantKeys = new Set();
    var projectMap = {};
    projects.forEach(function (p) { projectMap[p.id] = p; });

    timesheets.forEach(function (ts) {
      var scopeId = ts.project_scope_id || 0;
      relevantKeys.add(ts.project_id + '_' + scopeId);
    });
    bookings.forEach(function (b) {
      var scopeId = b.project_scope_id || 0;
      relevantKeys.add(b.project_id + '_' + scopeId);
    });

    var projectNameMap = {};
    var scopeNameMap = {};
    timesheets.forEach(function (ts) {
      if (ts.project_name) projectNameMap[ts.project_id] = ts.project_name;
      if (ts.scope_name) scopeNameMap[ts.project_id + '_' + (ts.project_scope_id || 0)] = ts.scope_name;
    });
    bookings.forEach(function (b) {
      if (b.project_name) projectNameMap[b.project_id] = b.project_name;
      if (b.scope_name) scopeNameMap[b.project_id + '_' + (b.project_scope_id || 0)] = b.scope_name;
    });

    var relevantRows = [];
    relevantKeys.forEach(function (key) {
      var parts = key.split('_');
      var pid = parseInt(parts[0], 10);
      var scopeId = parseInt(parts[1], 10);
      var p = projectMap[pid];
      
      var name = p ? p.name : (projectNameMap[pid] || '未知项目');
      var clientName = p ? p.client_name : '';
      var color = p ? (p.client_color || p.color) : '#8B5CF6';
      var code = p ? p.code : '';
      var scopeName = scopeNameMap[key] || '';

      relevantRows.push({
        project_id: pid,
        project_scope_id: scopeId || null,
        name: name,
        scope_name: scopeName,
        client_name: clientName,
        color: color,
        code: code
      });
    });

    // Sort rows by project name, then scope name
    relevantRows.sort(function (a, b) {
      var nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return (a.scope_name || '').localeCompare(b.scope_name || '');
    });

    var gridEl = document.getElementById('timesheet-container');
    if (!gridEl) return;

    if (!relevantRows.length) {
      gridEl.innerHTML = '<div class="empty-message">' + t('timesheets.no_records') + '</div>';
      return;
    }

    /* ---- build maps ---- */
    var tsMap = {};
    var tsSourceMap = {};
    var notesMap = {};
    _initialValues = {};

    timesheets.forEach(function (ts) {
      var scopePart = ts.project_scope_id ? ts.project_scope_id : '0';
      var key = ts.project_id + '_' + scopePart + '_' + ts.date;
      tsMap[key] = ts.hours;
      tsSourceMap[key] = ts.source || 'manual';
      notesMap[key] = ts.notes || '';
      _initialValues[key] = { hours: String(ts.hours || ''), notes: ts.notes || '' };
    });

    var scheduleMap = {};
    bookings.forEach(function (b) {
      var scopePart = b.project_scope_id ? b.project_scope_id : '0';
      var key = b.project_id + '_' + scopePart + '_' + b.date;
      scheduleMap[key] = (scheduleMap[key] || 0) + b.hours;
    });

    /* ---- try restore draft from localStorage ---- */
    var draftData = null;
    var draftKey = getDraftKey(rid, startStr);
    try {
      var draftRaw = localStorage.getItem(draftKey);
      if (draftRaw) draftData = JSON.parse(draftRaw);
    } catch (e) {}

    /* ---- render table ---- */
    gridEl.innerHTML = buildTable(days, relevantRows, tsMap, tsSourceMap, scheduleMap, notesMap);

    /* ---- apply draft over rendered table ---- */
    if (draftData && isOwnResource) {
      var applied = 0;
      Object.keys(draftData).forEach(function (key) {
        var parts = key.split('_');
        var pid = parts[0];
        var scopeId = parts[1];
        var dateStr = parts[2];
        var selector = '.ts-input[data-project="' + pid + '"][data-project-scope="' + (scopeId === '0' || scopeId === 'null' ? '' : scopeId) + '"][data-date="' + dateStr + '"]';
        var inp = document.querySelector(selector);
        if (inp) {
          if (draftData[key].hours !== undefined && draftData[key].hours !== '') {
            inp.value = draftData[key].hours;
            applied++;
          }
          if (draftData[key].notes !== undefined) {
            inp.dataset.notes = draftData[key].notes;
            updateNotesIndicator(inp);
          }
        }
      });
      if (applied > 0) {
        updateTotals(days, relevantRows);
        toast(t('timesheets.draft_restored'), 'info');
      }
    }

    /* ---- all users can edit and save their own timesheets ---- */
    var isReadOnly = !isOwnResource && !canViewOthers;

    /* ---- attach save handler ---- */
    var saveBtn = document.getElementById('ts-save');
    if (saveBtn) {
      if (isReadOnly) {
        saveBtn.disabled = true;
        saveBtn.title = t('timesheets.no_permission');
      } else {
        saveBtn.disabled = false;
        saveBtn.onclick = function () {
          handleSave(days, false);
        };
      }
    }

    /* ---- attach input handlers ---- */
    gridEl.querySelectorAll('.ts-input').forEach(function (input) {
      if (isReadOnly) {
        input.disabled = true;
        input.style.cursor = 'default';
      } else {
        input.addEventListener('input', function () {
          updateTotals(days, relevantRows);
          debouncedAutoSave();
        });
        input.addEventListener('focus', function () {
          showPresetButtons(input);
        });
        input.addEventListener('blur', function () {
          hidePresetButtons();
        });
        input.addEventListener('keydown', function (e) {
          handleCellKeydown(e, input, days, relevantRows);
        });
      }
    });

    /* ---- attach notes handlers ---- */
    gridEl.querySelectorAll('.ts-notes-btn').forEach(function (btn) {
      if (isReadOnly) {
        btn.disabled = true;
        btn.style.opacity = '0.3';
      } else {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var scopeId = btn.dataset.projectScope || '';
          var inp = document.querySelector('.ts-input[data-project="' + btn.dataset.project + '"][data-project-scope="' + scopeId + '"][data-date="' + btn.dataset.date + '"]');
          openNotesModal(btn.dataset.project, btn.dataset.date, inp ? (inp.dataset.notes || '') : '', function (newNotes) {
            if (inp) {
              inp.dataset.notes = newNotes;
              updateNotesIndicator(inp);
              debouncedAutoSave();
            }
          });
        });
      }
    });

    /* Keep manual copy button for managers who want to force-copy */
    var copyBtn = document.getElementById('ts-copy-from-schedule');
    if (copyBtn) {
      var permsForCopy = window.state.permissions || {};
      if (!permsForCopy.book_others) {
        copyBtn.style.display = 'none';
      } else {
        copyBtn.style.display = '';
        copyBtn.onclick = copyFromSchedule;
      }
    }
  };

  /* ---- get draft localStorage key ---- */
  function getDraftKey(resourceId, weekStart) {
    return 'ts_draft_' + resourceId + '_' + weekStart;
  }

  /* ---- clear draft ---- */
  function clearDraft() {
    var rid = state.tsResourceId;
    var weekStart = fmt(state.tsWeekStart);
    var draftKey = getDraftKey(rid, weekStart);
    localStorage.removeItem(draftKey);
  }

  /* --------------------------------------------------
     Table builder
     -------------------------------------------------- */
  function buildTable(days, rows, tsMap, tsSourceMap, scheduleMap, notesMap) {
    var html = '<table class="ts-table"><thead><tr><th>' + t('timesheets.project') + '</th>';

    days.forEach(function (d, idx) {
      var isWeekend = d.getDay() === 0 || d.getDay() === 6;
      var weekendCls = isWeekend ? ' ts-weekend' : '';
      html += '<th class="' + weekendCls.trim() + '">' + shortDay(d) + '<br>' + fmtDate(d) + '</th>';
    });
    html += '<th>' + t('timesheets.total') + '</th></tr></thead><tbody>';

    /* ---- daily totals accumulators ---- */
    var dayTotals = [];
    var i;
    for (i = 0; i < days.length; i++) dayTotals.push(0);
    var weekTotal = 0;

    /* ---- project rows ---- */
    rows.forEach(function (r) {
      var rowTotal = 0;
      var color = r.color || '#6366F1';
      var codeLabel = r.code ? '<span class="ts-proj-code">' + esc(r.code) + '</span>' : '';
      var scopeLabel = r.scope_name ? '<span class="ts-scope-label" style="font-size:11px; background:#e0e7ff; color:#4f46e5; padding:1px 4px; border-radius:3px; margin-left:6px; font-weight:500; display:inline-block; vertical-align:middle;">' + esc(r.scope_name) + '</span>' : '';

      var rowId = r.project_id + '-' + (r.project_scope_id || 0);

      html += '<tr data-project-id="' + r.project_id + '" data-project-scope-id="' + (r.project_scope_id || '') + '">' +
        '<td style="border-left:3px solid ' + color + '">' +
        '<div class="ts-project-cell" style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">' +
        '<span class="ts-color-dot" style="background:' + color + '"></span>' +
        codeLabel + esc(r.name) + scopeLabel + '</div></td>';

      days.forEach(function (d, idx) {
        var dateStr = fmt(d);
        var key = r.project_id + '_' + (r.project_scope_id || 0) + '_' + dateStr;
        var val = tsMap[key];
        var source = tsSourceMap[key] || 'manual';
        var placeholder = scheduleMap[key] || '';
        var displayVal = (val !== undefined && val !== null) ? val : '';
        var isWeekend = d.getDay() === 0 || d.getDay() === 6;
        var weekendCls = isWeekend ? ' ts-weekend' : '';
        var notes = notesMap[key] || '';

        /* Variance highlight: if actual differs from scheduled by >20% */
        var varClass = '';
        if (displayVal !== '' && placeholder !== '') {
          var actual = parseFloat(displayVal);
          var sched  = parseFloat(placeholder);
          if (sched > 0 && Math.abs(actual - sched) / sched > 0.2) {
            varClass = ' ts-input-variance';
          }
        }

        /* Synced-from-booking highlight: light tint to indicate auto-filled */
        var syncedClass = (source === 'booking' && displayVal !== '') ? ' ts-input-synced' : '';

        html += '<td class="' + weekendCls.trim() + '">' +
          '<div class="ts-cell-wrap">' +
          '<input type="number" class="ts-input' + varClass + syncedClass + '"' +
          ' data-project="' + r.project_id + '"' +
          ' data-project-scope="' + (r.project_scope_id || '') + '"' +
          ' data-date="' + dateStr + '"' +
          ' data-source="' + source + '"' +
          ' data-notes="' + esc(notes) + '"' +
          ' value="' + displayVal + '"' +
          ' placeholder="' + placeholder + '"' +
          ' min="0" max="24" step="0.5">' +
          '<button type="button" class="ts-notes-btn' + (notes ? ' ts-notes-active' : '') + '"' +
          ' data-project="' + r.project_id + '" data-project-scope="' + (r.project_scope_id || '') + '" data-date="' + dateStr + '"' +
          ' title="' + (notes ? esc(notes) : t('timesheets.add_notes')) + '">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
          '<path d="M3 3h10v10H3z" stroke="currentColor" stroke-width="1.2"/>' +
          '<path d="M5 6h6M5 8.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
          '</svg></button></div></td>';

        var hours = (displayVal !== '') ? parseFloat(displayVal) : 0;
        rowTotal += hours;
        dayTotals[idx] += hours;
      });

      weekTotal += rowTotal;
      html += '<td class="ts-row-total" id="ts-row-total-' + rowId + '">' + rowTotal + '</td></tr>';
    });

    /* ---- totals row ---- */
    html += '<tr class="ts-totals-row"><td>' + t('timesheets.total') + '</td>';
    dayTotals.forEach(function (t, idx) {
      var isWeekend = days[idx].getDay() === 0 || days[idx].getDay() === 6;
      var weekendCls = isWeekend ? ' ts-weekend' : '';
      html += '<td class="' + weekendCls.trim() + '" id="ts-day-total-' + idx + '">' + t + '</td>';
    });
    html += '<td id="ts-week-total">' + weekTotal + '</td></tr>';

    html += '</tbody></table>';
    html += '<div class="ts-footer">' +
      '<span class="ts-sync-hint">' + t('timesheets.sync_hint') + '</span>' +
      '<button class="btn btn-primary" id="ts-save">' + t('timesheets.save_hours') + '</button>' +
      '</div>';
    return html;
  }

  /* ---- update notes indicator on an input ---- */
  function updateNotesIndicator(input) {
    var notes = input.dataset.notes || '';
    var btn = input.parentElement.querySelector('.ts-notes-btn');
    if (!btn) return;
    btn.title = notes || t('timesheets.add_notes');
    if (notes) {
      btn.classList.add('ts-notes-active');
    } else {
      btn.classList.remove('ts-notes-active');
    }
  }

  /* --------------------------------------------------
     Preset hour buttons (shown on focus)
     -------------------------------------------------- */
  function showPresetButtons(input) {
    hidePresetButtons();
    var wrap = input.parentElement;
    var presets = document.createElement('div');
    presets.className = 'ts-preset-bar';
    presets.innerHTML = [2, 4, 6, 8].map(function (h) {
      return '<button type="button" class="ts-preset-btn" data-hours="' + h + '">' + h + 'h</button>';
    }).join('');
    wrap.appendChild(presets);
    _presetEl = presets;

    presets.querySelectorAll('.ts-preset-btn').forEach(function (btn) {
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault(); // prevent blur before click
        input.value = btn.dataset.hours;
        input.dispatchEvent(new Event('input'));
        hidePresetButtons();
        input.focus();
      });
    });
  }

  function hidePresetButtons() {
    if (_presetEl && _presetEl.parentElement) {
      _presetEl.parentElement.removeChild(_presetEl);
    }
    _presetEl = null;
  }

  /* --------------------------------------------------
     Keyboard navigation
     -------------------------------------------------- */
  function handleCellKeydown(e, input, days, projects) {
    var allInputs = Array.from(document.querySelectorAll('.ts-input'));
    var idx = allInputs.indexOf(input);
    if (idx < 0) return;

    var colsPerRow = days.length;
    var target = null;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        target = allInputs[idx - colsPerRow];
        break;
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        target = allInputs[idx + colsPerRow];
        break;
      case 'ArrowLeft':
        e.preventDefault();
        target = allInputs[idx - 1];
        break;
      case 'ArrowRight':
        e.preventDefault();
        target = allInputs[idx + 1];
        break;
    }
    if (target) {
      target.focus();
      /* select all text for quick overwrite */
      if (typeof target.select === 'function') target.select();
    }
  }

  /* --------------------------------------------------
     Debounced auto-save to localStorage
     -------------------------------------------------- */
  function debouncedAutoSave() {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(function () {
      saveDraft();
    }, 1500);
  }

  function saveDraft() {
    var rid = state.tsResourceId;
    var weekStart = fmt(state.tsWeekStart);
    var draftKey = getDraftKey(rid, weekStart);
    var draft = {};
    var hasData = false;

    document.querySelectorAll('.ts-input').forEach(function (input) {
      var val = input.value.trim();
      var notes = input.dataset.notes || '';
      var scopeId = input.dataset.projectScope || '';
      var scopePart = scopeId ? scopeId : '0';
      var key = input.dataset.project + '_' + scopePart + '_' + input.dataset.date;
      var init = _initialValues[key];

      var changed = false;
      if (init) {
        if (val !== String(init.hours) && (val !== '' || init.hours !== '')) changed = true;
        if (notes !== (init.notes || '')) changed = true;
      } else {
        if (val !== '' || notes !== '') changed = true;
      }

      if (changed) {
        draft[key] = {};
        if (val !== '') draft[key].hours = val;
        if (notes !== '') draft[key].notes = notes;
        hasData = true;
      }
    });

    if (hasData) {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } else {
      localStorage.removeItem(draftKey);
    }
  }

  /* --------------------------------------------------
     Save handler — incremental (only changed cells)
     -------------------------------------------------- */
  async function handleSave(days, isAutoSave) {
    var inputs = document.querySelectorAll('.ts-input');
    var entries = [];
    var changedCount = 0;

    inputs.forEach(function (input) {
      var val = input.value.trim();
      var notes = input.dataset.notes || '';
      var scopeId = input.dataset.projectScope || '';
      var scopePart = scopeId ? scopeId : '0';
      var key = input.dataset.project + '_' + scopePart + '_' + input.dataset.date;
      var init = _initialValues[key];

      /* Determine if this cell has changed */
      var hoursChanged = false;
      var notesChanged = false;

      if (init) {
        hoursChanged = val !== String(init.hours) && (val !== '' || init.hours !== '');
        notesChanged = notes !== (init.notes || '');
      } else {
        hoursChanged = val !== '';
        notesChanged = notes !== '';
      }

      if (!hoursChanged && !notesChanged) return;

      var scopeNum = input.dataset.projectScope ? parseInt(input.dataset.projectScope, 10) : null;

      if (val !== '') {
        entries.push({
          project_id:  parseInt(input.dataset.project, 10),
          project_scope_id: scopeNum,
          date:        input.dataset.date,
          hours:       parseFloat(val),
          notes:       notes,
          resource_id: state.tsResourceId,
          status:      'draft'
        });
        changedCount++;
      } else if (notesChanged && init) {
        /* Only notes changed, hours cleared: update to empty hours but keep notes */
        entries.push({
          project_id:  parseInt(input.dataset.project, 10),
          project_scope_id: scopeNum,
          date:        input.dataset.date,
          hours:       0,
          notes:       notes,
          resource_id: state.tsResourceId,
          status:      'draft'
        });
        changedCount++;
      }
    });

    if (changedCount === 0) {
      if (!isAutoSave) toast(t('timesheets.no_changes'), 'info');
      return;
    }

    try {
      await api('/api/timesheets/batch', {
        method: 'POST',
        body: { entries: entries }
      });
      if (!isAutoSave) {
        toast(t('timesheets.hours_saved'), 'success');
      }
      clearDraft();
      /* Refresh to update _initialValues */
      window.loadTimesheets();
    } catch (err) {
      toast(err.message || t('common.save_failed'), 'error');
    }
  }

  /* --------------------------------------------------
     Notes modal
     -------------------------------------------------- */
  function openNotesModal(projectId, date, currentNotes, onSave) {
    var modalTitle = document.getElementById('modal-title');
    var modalBody = document.getElementById('modal-body');
    var modalFooter = document.getElementById('modal-footer');
    if (!modalTitle || !modalBody || !modalFooter) return;

    modalTitle.textContent = t('timesheets.add_notes');
    modalBody.innerHTML = '<div class="form-group"><textarea id="ts-note-text" class="text-input form-control" rows="3" placeholder="' + t('timesheets.add_notes') + '">' + esc(currentNotes) + '</textarea></div>';
    modalFooter.innerHTML = '<button class="btn btn-outline" data-bs-dismiss="modal">' + t('common.cancel') + '</button>' +
      '<button class="btn btn-primary" id="ts-note-save">' + t('common.save') + '</button>';

    var bsModal = window.bs && window.bs.Modal && window.bs.Modal.getOrCreateInstance(document.getElementById('modal-overlay'));
    if (bsModal) bsModal.show();

    var saveBtn = document.getElementById('ts-note-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var text = document.getElementById('ts-note-text').value.trim();
        onSave(text);
        if (bsModal) bsModal.hide();
      };
    }
  }

  /* --------------------------------------------------
     Live totals updater (called on input change)
     -------------------------------------------------- */
  function updateTotals(days, rows) {
    var dayTotals = days.map(function () { return 0; });
    var weekTotal = 0;

    rows.forEach(function (r) {
      var rowTotal = 0;
      days.forEach(function (d, idx) {
        var scopeId = r.project_scope_id || '';
        var input = document.querySelector(
          '.ts-input[data-project="' + r.project_id + '"][data-project-scope="' + scopeId + '"][data-date="' + fmt(d) + '"]'
        );
        if (!input) return;
        var val = parseFloat(input.value) || 0;
        rowTotal += val;
        dayTotals[idx] += val;
      });
      weekTotal += rowTotal;
      var rowTotalEl = document.getElementById('ts-row-total-' + r.project_id + '-' + (r.project_scope_id || 0));
      if (rowTotalEl) rowTotalEl.textContent = rowTotal || 0;
    });

    dayTotals.forEach(function (t, idx) {
      var el = document.getElementById('ts-day-total-' + idx);
      if (el) el.textContent = t || 0;
    });
    var weekEl = document.getElementById('ts-week-total');
    if (weekEl) weekEl.textContent = weekTotal || 0;
  }

  /* --------------------------------------------------
     2. Navigation buttons
     -------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    var prevBtn  = document.getElementById('ts-prev');
    var nextBtn  = document.getElementById('ts-next');
    var todayBtn = document.getElementById('ts-today');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        state.tsWeekStart = addDays(state.tsWeekStart, -7);
        window.loadTimesheets();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        state.tsWeekStart = addDays(state.tsWeekStart, 7);
        window.loadTimesheets();
      });
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        state.tsWeekStart = getMonday(new Date());
        window.loadTimesheets();
      });
    }
  });

  /* --------------------------------------------------
     Manual copy from Schedule (managers only, force-overwrite)
     -------------------------------------------------- */
  function copyFromSchedule() {
    var inputs = document.querySelectorAll('.ts-input');
    if (!inputs.length) {
      toast(t('timesheets.load_first'), 'error');
      return;
    }

    var bookingMap = {};
    _currentBookings.forEach(function (b) {
      var key = b.project_id + '_' + b.date;
      bookingMap[key] = (bookingMap[key] || 0) + b.hours;
    });

    var filled = 0;
    var skipped = 0;

    inputs.forEach(function (input) {
      var key = input.dataset.project + '_' + input.dataset.date;
      var bookingHours = bookingMap[key];
      if (bookingHours == null) return;

      if (input.value !== '' && parseFloat(input.value) === bookingHours) {
        return;
      }

      if (input.value !== '' && input.dataset.source !== 'booking') {
        skipped++;
        return;
      }

      input.value = bookingHours;
      input.classList.add('ts-input-copied');
      setTimeout(function () { input.classList.remove('ts-input-copied'); }, 1500);
      filled++;
    });

    var days = weekDates(state.tsWeekStart).slice(0, 7);
    var allInputs = document.querySelectorAll('.ts-input');
    var projectIds = {};
    allInputs.forEach(function (inp) { projectIds[inp.dataset.project] = true; });
    var projectList = Object.keys(projectIds).map(function (id) { return { id: parseInt(id, 10) }; });
    updateTotals(days, projectList);

    if (filled > 0) {
      toast(t('timesheets.copied') + ' ' + filled + ' ' + t('timesheets.records') + (skipped > 0 ? ', ' + skipped + ' ' + t('timesheets.skipped') : ''), 'success');
    } else if (skipped > 0) {
      toast(t('timesheets.all_filled'), 'info');
    } else {
      toast(t('timesheets.no_hours_to_copy'), 'info');
    }
  }

  /* --------------------------------------------------
     HTML-escape helper
     -------------------------------------------------- */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();
