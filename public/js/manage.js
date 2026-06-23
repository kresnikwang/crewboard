/* ============================================================
   manage.js — Resources (人员管理) & Projects/Clients
   Dependencies from core.js: state, api, showModal, closeModal, toast
   ============================================================ */

// --------------- HTML Helpers ---------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ===================== Resources (人员管理) =====================

window.loadResources = async function loadResources() {
  try {
    state.resources = await api('/api/resources'); // 已包含 JOIN 后的账号字段
  } catch (err) {
    toast(t('manage.load_failed') + ': ' + err.message, 'error');
    return;
  }

  var container = document.getElementById('resource-list');
  if (!container) return;

  var teams = {};
  state.resources.forEach(function (r) {
    var team = r.team || t('manage.ungrouped');
    if (!teams[team]) teams[team] = [];
    teams[team].push(r);
  });

  var perms = window.state.permissions || {};
  var canManage = !!perms.manage_resources;  // admin
  var currentUserId = state.user && state.user.id;

  var roleLabels = { admin: t('manage.admin'), manager: t('manage.manager'), basic: t('manage.basic_user'), owner: t('manage.admin'), member: t('manage.basic_user') };
  var roleBadgeClass = { admin: 'role-admin', manager: 'role-manager', basic: 'role-basic', owner: 'role-admin', member: 'role-basic' };

  // 列数：人员 / 职位 / 邮箱 / 手机 / 工时/天 / 系统权限 / 账号状态 [/ 操作]
  var colCount = canManage ? 8 : 7;
  var html = '<table class="res-table table table-hover table-sm align-middle"><thead><tr>' +
    '<th style="width:28%">' + t('schedule.resource') + '</th>' +
    '<th>' + t('manage.position') + '</th>' +
    '<th>' + t('common.email') + '</th>' +
    '<th style="width:100px">' + t('common.phone') + '</th>' +
    '<th style="width:72px">' + t('manage.hours_day') + '</th>' +
    '<th style="width:90px">' + t('manage.permissions') + '</th>' +
    '<th style="width:80px">' + t('manage.account_status') + '</th>' +
    (canManage ? '<th style="width:60px"></th>' : '') +
  '</tr></thead><tbody>';

  var teamNames = Object.keys(teams).sort();
  teamNames.forEach(function (team) {
    html += '<tr class="res-team-divider"><td colspan="' + colCount + '">' + escapeHtml(team) + ' (' + teams[team].length + ')</td></tr>';
    teams[team].forEach(function (r) {
      var color = r.color || '#3B7DDD';
      var initial = r.name ? r.name.charAt(0) : '?';

      // 账号信息直接来自 JOIN 字段
      var hasAccount = !!r.user_id;
      var effectiveRole = r.user_role || null;
      if (effectiveRole === 'owner') effectiveRole = 'admin';

      // 权限列：admin 看所有人的下拉（自己除外）；其他人只看自己的角色徽章
      var permCell = '';
      if (hasAccount && effectiveRole) {
        if (canManage && r.user_id !== currentUserId) {
          permCell = '<select class="text-input form-select form-select-sm res-role-select" data-user-id="' + r.user_id + '" style="width:90px">' +
            '<option value="basic"'  + (effectiveRole === 'basic'   ? ' selected' : '') + '>' + t('manage.basic_user') + '</option>' +
            '<option value="manager"'+ (effectiveRole === 'manager' ? ' selected' : '') + '>' + t('manage.manager') + '</option>' +
            '<option value="admin"'  + (effectiveRole === 'admin'   ? ' selected' : '') + '>' + t('manage.admin') + '</option>' +
          '</select>';
        } else {
          permCell = '<span class="role-badge ' + (roleBadgeClass[effectiveRole] || 'role-basic') + '">' + (roleLabels[effectiveRole] || effectiveRole) + '</span>';
        }
      }

      // 账号状态列
      var accountCell = hasAccount
        ? '<span class="account-linked" title="' + t('manage.linked') + '">&#10003; ' + t('manage.linked') + '</span>'
        : '<span class="account-unlinked" title="' + t('manage.unregistered') + '">— ' + t('manage.unregistered') + '</span>';

      html += '<tr data-id="' + r.id + '">' +
        '<td><div class="res-name-cell">' +
          '<div class="res-avatar" style="background:' + color + '">' + escapeHtml(initial) + '</div>' +
          '<div><div class="res-name">' + escapeHtml(r.name) + '</div>' +
          '<div class="res-meta">' + escapeHtml(r.team || '') + '</div></div>' +
        '</div></td>' +
        '<td>' + escapeHtml(r.role || '-') + '</td>' +
        '<td style="font-size:12px">' + escapeHtml(r.email || '-') + '</td>' +
        '<td style="font-size:12px">' + escapeHtml(r.user_phone || '-') + '</td>' +
        '<td>' + (r.hours_per_day != null ? r.hours_per_day : 8) + 'h</td>' +
        '<td>' + permCell + '</td>' +
        '<td>' + accountCell + '</td>' +
        (canManage ? '<td><div class="res-actions">' +
          '<button class="btn-icon btn-res-edit" data-id="' + r.id + '" title="' + t('common.edit') + '">&#9998;</button>' +
          '<button class="btn-icon btn-res-del" data-id="' + r.id + '" title="' + t('common.delete') + '">&#10005;</button>' +
        '</div></td>' : '') +
      '</tr>';
    });
  });

  html += '</tbody></table>';
  if (state.resources.length === 0) {
    html = '<div class="empty-hint">' + t('manage.no_resources') + '</div>';
  }
  container.innerHTML = html;

  /* 权限下拉事件 */
  container.querySelectorAll('.res-role-select').forEach(function (sel) {
    sel.addEventListener('change', async function (e) {
      e.stopPropagation();
      var userId = sel.dataset.userId;
      var newRole = sel.value;
      try {
        await api('/api/auth/enterprises/members/' + userId + '/role', { method: 'PUT', body: { role: newRole } });
        toast(t('manage.permission_updated'));
      } catch (err) {
        toast(err.message || t('common.save_failed'), 'error');
        loadResources();
      }
    });
  });

  /* Attach click events (only for admin/manage permission) */
  container.querySelectorAll('.btn-res-edit').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); showResourceModal(parseInt(btn.dataset.id, 10)); });
  });
  container.querySelectorAll('.btn-res-del').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); deleteResource(parseInt(btn.dataset.id, 10)); });
  });
  /* Click on row to edit — only for admin */
  if (canManage) {
    container.querySelectorAll('tr[data-id]').forEach(function (row) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', function (e) {
        if (e.target.closest('.btn-icon') || e.target.closest('.res-role-select')) return;
        showResourceModal(parseInt(row.dataset.id, 10));
      });
    });
  }

  /* Bind add-resource button now that permissions are ready */
  var btnAddRes = document.getElementById('btn-add-resource');
  if (btnAddRes) {
    if (!canManage) {
      btnAddRes.style.display = 'none';
    } else {
      btnAddRes.style.display = '';
      var newBtnRes = btnAddRes.cloneNode(true);
      btnAddRes.parentNode.replaceChild(newBtnRes, btnAddRes);
      newBtnRes.addEventListener('click', function () { showResourceModal(); });
    }
  }
};

window.showResourceModal = async function showResourceModal(id) {
  var resource = null;
  if (id) resource = state.resources.find(function (r) { return r.id === id; });
  var title = resource ? t('manage.edit_resource_title') : t('manage.add_resource_title');

  var hasManagedProjectsField = false;
  var projectsHtml = '';
  if (resource && resource.user_id && resource.user_role === 'manager') {
    hasManagedProjectsField = true;
    if (!state.projects || !state.projects.length) {
      try {
        state.projects = await api('/api/projects');
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    }

    var managedIds = [];
    if (resource.user_managed_project_ids) {
      try {
        managedIds = JSON.parse(resource.user_managed_project_ids);
      } catch (e) {
        console.error('Error parsing user_managed_project_ids:', e);
      }
    }
    if (!Array.isArray(managedIds)) managedIds = [];

    if (state.projects && state.projects.length) {
      state.projects.forEach(function (proj) {
        var checked = managedIds.includes(proj.id) ? ' checked' : '';
        projectsHtml += '<div class="form-check" style="margin-bottom:6px; font-size:13px; display:flex; align-items:center; gap:8px;">' +
          '<input class="form-check-input managed-project-checkbox" type="checkbox" value="' + proj.id + '" id="m-proj-' + proj.id + '"' + checked + ' style="margin:0;">' +
          '<label class="form-check-label" for="m-proj-' + proj.id + '" style="margin:0; cursor:pointer; color:var(--text-primary);">' + escapeHtml(proj.name) + '</label>' +
        '</div>';
      });
    } else {
      projectsHtml = '<div class="text-muted text-center py-2" style="font-size: 13px;">' + t('manage.no_active_projects') + '</div>';
    }
  }

  var body = '<div class="rg-form" style="padding:0 24px">' +
    /* Name */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('common.name') + ' <span style="color:#EF4444">*</span></label>' +
        '<input class="rg-input" type="text" id="res-name" value="' + escapeAttr(resource ? resource.name : '') + '" placeholder="' + t('manage.input_name') + '">' +
      '</div>' +
    '</div>' +
    /* Color */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" fill="currentColor" opacity=".3"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('manage.color_label') + '</label>' +
        buildColorDropdownHtml(resource && resource.color ? resource.color : '#3B7DDD', 'rg-color-value') +
      '</div>' +
    '</div>' +
    /* Role */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4V2h6v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('manage.position_label') + '</label>' +
        '<input class="rg-input" type="text" id="res-role" value="' + escapeAttr(resource ? resource.role : '') + '" placeholder="' + t('manage.position_placeholder') + '">' +
      '</div>' +
    '</div>' +
    /* Email */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 6l8 5 8-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('common.email') + '</label>' +
        '<input class="rg-input" type="email" id="res-email" value="' + escapeAttr(resource ? resource.email : '') + '" placeholder="name@company.com">' +
      '</div>' +
    '</div>' +
    /* Team */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 17c0-2.5 2-4.5 5-4.5h1M14 12.5c3 0 5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('manage.team_label') + '</label>' +
        '<input class="rg-input" type="text" id="res-team" value="' + escapeAttr(resource ? resource.team : '') + '" placeholder="' + t('manage.team_placeholder') + '">' +
      '</div>' +
    '</div>' +
    /* Hours per day */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">' + t('manage.hours_day') + '</label>' +
        '<input class="rg-input" type="number" id="res-hours" min="0" max="24" step="0.5" value="' + (resource && resource.hours_per_day != null ? resource.hours_per_day : 8) + '" style="width:100px">' +
      '</div>' +
    '</div>';

  if (hasManagedProjectsField) {
    body += '<div class="rg-separator" style="border-top: 1px solid var(--border-color); margin: 15px 0;"></div>' +
      '<div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:10px;">' +
        t('manage.co_managed_projects') +
      '</div>' +
      '<div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 10px; background: var(--bg-secondary);">' +
        projectsHtml +
      '</div>';
  }

  body += '</div>';

  var footer = '';
  if (id) {
    footer += '<button class="btn btn-danger bk-footer-left" id="btn-del-resource">' + t('manage.delete_resource') + '</button>';
  }
  footer += '<button class="btn btn-outline" onclick="closeModal()">' + t('common.cancel') + '</button>';
  footer += '<button class="btn btn-primary" id="btn-save-resource">' + t('common.save') + '</button>';

  showModal(title, body, footer);
  document.getElementById('modal').classList.add('rg-modal');

  /* Init color picker */
  initColorPicker('rg-color-value');

  document.getElementById('btn-save-resource').addEventListener('click', function () { saveResource(id || null); });
  if (id) {
    document.getElementById('btn-del-resource').addEventListener('click', function () {
      deleteResource(id);
    });
  }
};

window.saveResource = async function saveResource(id) {
  var name = document.getElementById('res-name').value.trim();
  if (!name) { toast(t('manage.enter_name'), 'error'); return; }
  var colorEl = document.getElementById('rg-color-value');
  var payload = {
    name: name,
    email: document.getElementById('res-email').value.trim(),
    role: document.getElementById('res-role').value.trim(),
    team: document.getElementById('res-team').value.trim(),
    color: colorEl ? colorEl.value : '#3B7DDD',
    hours_per_day: parseFloat(document.getElementById('res-hours').value) || 8,
  };
  try {
    if (id) {
      await api('/api/resources/' + id, { method: 'PUT', body: payload });
      toast(t('manage.resource_updated'));
    } else {
      await api('/api/resources', { method: 'POST', body: payload });
      toast(t('manage.resource_added'));
    }

    // Save co-managed projects if checkboxes exist
    var resource = id ? state.resources.find(function (r) { return r.id === id; }) : null;
    if (resource && resource.user_id && resource.user_role === 'manager') {
      var checkboxes = document.querySelectorAll('.managed-project-checkbox');
      if (checkboxes.length > 0) {
        var selectedProjectIds = [];
        checkboxes.forEach(function (cb) {
          if (cb.checked) {
            selectedProjectIds.push(parseInt(cb.value, 10));
          }
        });
        await api('/api/auth/enterprises/members/' + resource.user_id + '/managed-projects', {
          method: 'PUT',
          body: { project_ids: selectedProjectIds }
        });
      }
    }

    document.getElementById('modal').classList.remove('rg-modal');
    closeModal();
    loadResources();
  } catch (err) {
    toast(t('common.save_failed') + ': ' + err.message, 'error');
  }
};

window.deleteResource = async function deleteResource(id) {
  if (!confirm(t('manage.confirm_delete_resource'))) return;
  try {
    await api('/api/resources/' + id, { method: 'DELETE' });
    toast(t('manage.resource_deleted'));
    document.getElementById('modal').classList.remove('rg-modal');
    closeModal();
    loadResources();
  } catch (err) { toast(t('common.delete_failed') + ': ' + err.message, 'error'); }
};

var pcActiveTab = 'projects';
var pcSearchQuery = '';

// Color palette for dropdowns - function to support i18n
function getColorPalette() {
  return [
    /* Row 1 */
    { value: '#EF4444', label: t('color.red') },
    { value: '#F97316', label: t('color.orange') },
    { value: '#F59E0B', label: t('color.amber') },
    { value: '#84CC16', label: t('color.yellow_green') },
    { value: '#22C55E', label: t('color.emerald') },
    { value: '#06B6D4', label: t('color.cyan') },
    /* Row 2 */
    { value: '#3B82F6', label: t('color.blue') },
    { value: '#6366F1', label: t('color.blue_purple') },
    { value: '#8B5CF6', label: t('color.purple') },
    { value: '#EC4899', label: t('color.pink') },
    { value: '#78716C', label: t('color.gray') },
    { value: '#1E293B', label: t('color.ink_black') },
    /* Row 3 */
    { value: '#991B1B', label: t('color.deep_red') },
    { value: '#9A3412', label: t('color.brown') },
    { value: '#92400E', label: t('color.dark_brown') },
    { value: '#166534', label: t('color.dark_green') },
    { value: '#115E59', label: t('color.dark_cyan') },
    { value: '#1E40AF', label: t('color.dark_blue') },
    /* Row 4 */
    { value: '#FB7185', label: t('color.light_red') },
    { value: '#FDBA74', label: t('color.apricot') },
    { value: '#FDE047', label: t('color.lemon') },
    { value: '#86EFAC', label: t('color.mint') },
    { value: '#7DD3FC', label: t('color.sky_blue') },
    { value: '#C084FC', label: t('color.light_purple') },
  ];
}

function buildColorDropdownHtml(selectedColor, inputId) {
  var html = '<div class="rg-color-picker" id="' + inputId + '-picker">';
  html += '<button type="button" class="rg-color-btn" id="' + inputId + '-btn">';
  html += '<span class="rg-color-dot" style="background:' + (selectedColor || '#8B5CF6') + '"></span>';
  html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  html += '</button>';
  html += '<input type="hidden" id="' + inputId + '" value="' + (selectedColor || '#8B5CF6') + '">';
  html += '<div class="rg-color-dropdown" id="' + inputId + '-dropdown">';
  getColorPalette().forEach(function (c) {
    var active = c.value === (selectedColor || '#8B5CF6') ? ' active' : '';
    html += '<span class="rg-color-option' + active + '" data-color="' + c.value + '" style="background:' + c.value + '" title="' + c.label + '"></span>';
  });
  html += '</div></div>';
  return html;
}

function initColorPicker(inputId) {
  var btn = document.getElementById(inputId + '-btn');
  var dropdown = document.getElementById(inputId + '-dropdown');
  var input = document.getElementById(inputId);
  if (!btn || !dropdown) return;
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  dropdown.querySelectorAll('.rg-color-option').forEach(function (opt) {
    opt.addEventListener('click', function (e) {
      e.stopPropagation();
      var color = opt.dataset.color;
      input.value = color;
      btn.querySelector('.rg-color-dot').style.background = color;
      dropdown.querySelectorAll('.rg-color-option').forEach(function (o) { o.classList.remove('active'); });
      opt.classList.add('active');
      dropdown.classList.remove('open');
    });
  });
  document.addEventListener('click', function () { dropdown.classList.remove('open'); });
}

window.loadProjects = async function loadProjects() {
  try {
    var results = await Promise.all([
      api('/api/projects'),
      api('/api/clients'),
      api('/api/projects?archived=1'),
      api('/api/clients?archived=1')
    ]);
    state.projects = results[0];
    state.clients = results[1];
    state.archivedProjects = results[2];
    state.archivedClients = results[3];
  } catch (err) {
    toast(t('manage.load_failed') + ': ' + err.message, 'error');
    return;
  }
  renderPCPage();
  bindPCNewButton();
};

function bindPCNewButton() {
  var permsBtn = window.state.permissions || {};
  var canManageBtn = !!permsBtn.manage_projects;
  var btnNew = document.getElementById('btn-add-new-pc');
  if (!btnNew) return;
  if (!canManageBtn) {
    btnNew.style.display = 'none';
    return;
  }
  btnNew.style.display = '';
  // Remove old listener by cloning the node
  var newBtn = btnNew.cloneNode(true);
  btnNew.parentNode.replaceChild(newBtn, btnNew);
  newBtn.addEventListener('click', function () {
    if (pcActiveTab === 'clients') {
      showClientModal();
    } else {
      showProjectModal();
    }
  });
}

function renderPCPage() {
  // Update tab counts
  var tabProjects = document.getElementById('tab-projects');
  var tabClients = document.getElementById('tab-clients');
  var tabArchived = document.getElementById('tab-archived');
  if (tabProjects) tabProjects.textContent = t('manage.projects_tab') + ' (' + state.projects.length + ')';
  if (tabClients) tabClients.textContent = t('manage.clients_tab') + ' (' + state.clients.length + ')';
  var archivedTotal = (state.archivedProjects ? state.archivedProjects.length : 0) + (state.archivedClients ? state.archivedClients.length : 0);
  if (tabArchived) tabArchived.textContent = t('manage.archive_tab') + (archivedTotal ? ' (' + archivedTotal + ')' : '');

  // Hide "新建" button on archived tab
  var btnNew = document.getElementById('btn-add-new-pc');
  if (btnNew) btnNew.style.display = pcActiveTab === 'archived' ? 'none' : '';

  var container = document.getElementById('clients-projects-container');
  if (!container) return;
  container.innerHTML = '';

  if (pcActiveTab === 'projects') {
    renderProjectsTable(container);
  } else if (pcActiveTab === 'clients') {
    renderClientsTable(container);
  } else if (pcActiveTab === 'archived') {
    renderArchivedPage(container);
  }
}

function renderProjectsTable(container) {
  var permsPC = window.state.permissions || {};
  var canManagePC = !!permsPC.manage_projects;
  var query = pcSearchQuery.toLowerCase();
  var filtered = state.projects.filter(function (p) {
    if (!query) return true;
    return (p.name && p.name.toLowerCase().indexOf(query) >= 0) ||
           (p.client_name && p.client_name.toLowerCase().indexOf(query) >= 0) ||
           (p.code && p.code.toLowerCase().indexOf(query) >= 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">' + (query ? t('manage.no_match_projects') : t('manage.no_projects')) + '</div>';
    return;
  }

  var table = document.createElement('table');
  table.className = 'pc-table table table-hover table-sm align-middle';
  table.innerHTML =
    '<thead><tr>' +
      '<th class="col-code">' + t('manage.project_code') + '</th>' +
      '<th class="col-name">' + t('manage.project_name') + '</th>' +
      '<th class="col-client">' + t('common.client') + '</th>' +
      '<th class="col-dates">' + t('manage.period') + '</th>' +
      '<th class="col-billable">' + t('manage.billing') + '</th>' +
      '<th class="col-actions"></th>' +
    '</tr></thead>';

  var tbody = document.createElement('tbody');
  filtered.forEach(function (p) {
    var tr = document.createElement('tr');
    tr.className = 'pc-row';
    var dateRange = '';
    if (p.start_date || p.end_date) {
      dateRange = (p.start_date || '—') + ' ~ ' + (p.end_date || '—');
    }
    tr.innerHTML =
      '<td class="col-code">' + escapeHtml(p.code || '') + '</td>' +
      '<td class="col-name">' +
        '<div class="col-name-inner">' +
          '<span class="pc-color-bar" style="background:' + (p.color || '#8B5CF6') + '"></span>' +
          '<span class="pc-name-text">' + escapeHtml(p.name) + '</span>' +
        '</div>' +
      '</td>' +
      '<td class="col-client">' + escapeHtml(p.client_name || '') + '</td>' +
      '<td class="col-dates">' + escapeHtml(dateRange) + '</td>' +
      '<td class="col-billable">' + (p.billable ? 'Yes' : 'No') + '</td>' +
      (canManagePC ? '<td class="col-actions">' +
        '<button class="btn-icon btn-edit" title="' + t('common.edit') + '">&#9998;</button>' +
        '<button class="btn-icon btn-archive" title="' + t('common.archive') + '">&#128451;</button>' +
      '</td>' : '<td></td>');
    if (canManagePC) {
      tr.querySelector('.btn-edit').addEventListener('click', function (e) {
        e.stopPropagation();
        showProjectModal(p.id);
      });
      tr.querySelector('.btn-archive').addEventListener('click', function (e) {
        e.stopPropagation();
        archiveProject(p.id);
      });
      // Click row to edit
      tr.addEventListener('click', function () { showProjectModal(p.id); });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderClientsTable(container) {
  var permsClient = window.state.permissions || {};
  var canManageClient = !!permsClient.manage_projects;
  var query = pcSearchQuery.toLowerCase();
  var filtered = state.clients.filter(function (c) {
    if (!query) return true;
    return (c.name && c.name.toLowerCase().indexOf(query) >= 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">' + (query ? t('manage.no_match_clients') : t('manage.no_clients')) + '</div>';
    return;
  }

  var table = document.createElement('table');
  table.className = 'pc-table table table-hover table-sm align-middle';
  table.innerHTML =
    '<thead><tr>' +
      '<th class="col-name">' + t('manage.client_name') + '</th>' +
      '<th class="col-projects">' + t('manage.linked_projects') + '</th>' +
      '<th class="col-details">' + t('common.notes') + '</th>' +
      '<th class="col-actions"></th>' +
    '</tr></thead>';

  var tbody = document.createElement('tbody');
  filtered.forEach(function (c) {
    var projectCount = state.projects.filter(function (p) { return p.client_id === c.id; }).length;
    var tr = document.createElement('tr');
    tr.className = 'pc-row';
    tr.innerHTML =
      '<td class="col-name">' +
        '<div class="col-name-inner">' +
          '<span class="pc-color-bar" style="background:' + (c.color || '#6366F1') + '"></span>' +
          '<span class="pc-name-text">' + escapeHtml(c.name) + '</span>' +
        '</div>' +
      '</td>' +
      '<td class="col-projects">' + projectCount + '</td>' +
      '<td class="col-details">' + escapeHtml(c.details || '') + '</td>' +
      (canManageClient ? '<td class="col-actions">' +
        '<button class="btn-icon btn-edit" title="' + t('common.edit') + '">&#9998;</button>' +
        '<button class="btn-icon btn-archive" title="' + t('common.archive') + '">&#128451;</button>' +
      '</td>' : '<td></td>');
    if (canManageClient) {
      tr.querySelector('.btn-edit').addEventListener('click', function (e) {
        e.stopPropagation();
        showClientModal(c.id);
      });
      tr.querySelector('.btn-archive').addEventListener('click', function (e) {
        e.stopPropagation();
        archiveClient(c.id);
      });
      tr.addEventListener('click', function () { showClientModal(c.id); });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// --------------- Client Modal (ResourceGuru style) ---------------
window.showClientModal = function showClientModal(id) {
  var client = null;
  if (id) client = state.clients.find(function (c) { return c.id === id; });
  var isEdit = !!client;
  var title = isEdit ? t('manage.edit_client') : t('manage.new_client');

  var colorVal = client && client.color ? client.color : '#6366F1';

  var body =
    '<div class="rg-form">' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4V2h6v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="client-name" class="rg-input rg-input-lg" placeholder="' + t('manage.client_name') + '" value="' + escapeAttr(client ? client.name : '') + '"></div>' +
      '</div>' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 17c0-3 3-5 7-5s7 2 7 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/></svg></div>' +
        '<div class="rg-field-body"><div class="rg-field-label">Color</div>' + buildColorDropdownHtml(colorVal, 'client-color') + '</div>' +
      '</div>' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><textarea id="client-details" class="rg-textarea" placeholder="' + t('common.notes') + '" rows="3">' + escapeHtml(client ? client.details || '' : '') + '</textarea></div>' +
      '</div>' +
    '</div>';

  var footer = '';
  if (isEdit) {
    footer = '<div class="bk-footer-left">' +
      '<button class="btn btn-warning btn-sm" id="btn-archive-client-modal">' + t('manage.archive_client') + '</button>' +
      '<button class="btn btn-danger btn-sm" id="btn-delete-client-modal" style="margin-left:8px">' + t('manage.delete_client') + '</button>' +
    '</div>';
  }
  footer += '<button class="btn btn-outline" id="btn-cancel-client">' + t('common.cancel') + '</button>';
  footer += '<button class="btn btn-primary" id="btn-save-client">' + (isEdit ? t('common.save') : t('manage.create_client')) + '</button>';

  showModal(title, body, footer);
  document.getElementById('modal').classList.add('rg-modal');

  initColorPicker('client-color');

  document.getElementById('btn-save-client').addEventListener('click', function () { saveClient(id || null); });
  document.getElementById('btn-cancel-client').addEventListener('click', closeModal);
  if (isEdit) {
    document.getElementById('btn-archive-client-modal').addEventListener('click', function () {
      closeModal();
      archiveClient(id);
    });
    document.getElementById('btn-delete-client-modal').addEventListener('click', function () {
      closeModal();
      deleteClient(id);
    });
  }
};

window.saveClient = async function saveClient(id) {
  var name = document.getElementById('client-name').value.trim();
  if (!name) { toast(t('manage.enter_client_name'), 'error'); return; }
  var payload = {
    name: name,
    color: document.getElementById('client-color').value,
    details: document.getElementById('client-details').value.trim(),
  };
  try {
    if (id) { await api('/api/clients/' + id, { method: 'PUT', body: payload }); toast(t('manage.client_updated')); }
    else { await api('/api/clients', { method: 'POST', body: payload }); toast(t('manage.client_created')); }
    closeModal(); loadProjects();
  } catch (err) { toast(t('common.save_failed') + ': ' + err.message, 'error'); }
};

window.deleteClient = async function deleteClient(id) {
  var projectCount = state.projects.filter(function (p) { return p.client_id === id; }).length;
  var msg = t('manage.confirm_delete_client');
  if (projectCount > 0) msg += '\n' + projectCount + ' ' + t('manage.linked_projects') + '.';
  if (!confirm(msg)) return;
  try { await api('/api/clients/' + id, { method: 'DELETE' }); toast(t('manage.client_deleted')); loadProjects(); }
  catch (err) { toast(t('common.delete_failed') + ': ' + err.message, 'error'); }
};

// --------------- Project Scopes Helper ---------------
window.loadProjectScopes = async function loadProjectScopes(projectId) {
  const container = document.getElementById('scopes-list-container');
  if (!container) return;
  container.innerHTML = '<div class="text-muted text-center py-2" style="font-size: 13px;">加载中...</div>';
  try {
    const scopes = await api('/api/projects/' + projectId + '/scopes');
    if (!scopes.length) {
      container.innerHTML = '<div class="text-muted text-center py-2" style="font-size: 13px;">暂无工作范围，请在下方添加</div>';
      return;
    }
    let html = '<table class="table table-sm align-middle" style="font-size: 13px; margin-bottom: 0; width: 100%;"><tbody>';
    scopes.forEach(function (s) {
      html += '<tr data-scope-id="' + s.id + '">' +
        '<td style="width:75%;"><input type="text" class="form-control form-control-sm scope-name-input text-input" value="' + escapeAttr(s.name) + '" style="border:none; background:transparent; font-size:13px; padding:2px 4px; margin:0; width:100%;"></td>' +
        '<td class="text-end" style="width:25%; text-align:right;">' +
          '<button class="btn btn-link btn-sm text-primary btn-save-scope-inline" style="padding:0; margin-right:8px; display:none; background:none; border:none; vertical-align:middle;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg></button>' +
          '<button class="btn btn-link btn-sm text-danger btn-delete-scope-inline" style="padding:0; background:none; border:none; vertical-align:middle;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind event listeners for inline scope editing/deleting
    container.querySelectorAll('tr[data-scope-id]').forEach(function (row) {
      const scopeId = parseInt(row.dataset.scopeId, 10);
      const input = row.querySelector('.scope-name-input');
      const saveBtn = row.querySelector('.btn-save-scope-inline');
      const deleteBtn = row.querySelector('.btn-delete-scope-inline');

      input.addEventListener('input', function () {
        saveBtn.style.display = '';
      });

      saveBtn.addEventListener('click', async function () {
        const newName = input.value.trim();
        if (!newName) { toast('名称不能为空', 'error'); return; }
        try {
          await api('/api/project-scopes/' + scopeId, {
            method: 'PUT',
            body: { name: newName }
          });
          toast('修改成功');
          saveBtn.style.display = 'none';
        } catch (err) {
          toast('保存失败: ' + err.message, 'error');
        }
      });

      deleteBtn.addEventListener('click', async function () {
        if (!confirm('确定删除此工作范围吗？相关排班和工时将失去关联。')) return;
        try {
          await api('/api/project-scopes/' + scopeId, { method: 'DELETE' });
          toast('删除成功');
          loadProjectScopes(projectId);
        } catch (err) {
          toast('删除失败: ' + err.message, 'error');
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="text-danger text-center py-2" style="font-size: 13px;">加载失败: ' + err.message + '</div>';
  }
};

// --------------- Project Modal (ResourceGuru style) ---------------
window.showProjectModal = async function showProjectModal(id) {
  if (!state.clients || !state.clients.length) {
    try { state.clients = await api('/api/clients'); } catch (_) { state.clients = []; }
  }

  var project = null;
  if (id) project = state.projects.find(function (p) { return p.id === id; });
  var isEdit = !!project;
  var title = isEdit ? t('manage.edit_project') : t('manage.new_project');

  var billableChecked = project ? !!project.billable : true;

  var clientOptions = '<option value="">' + t('manage.select_client') + '</option>';
  state.clients.forEach(function (c) {
    var sel = project && project.client_id === c.id ? ' selected' : '';
    clientOptions += '<option value="' + c.id + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
  });

  var body =
    '<div class="rg-form">' +
      /* Name */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.5"/></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="proj-name" class="rg-input rg-input-lg" placeholder="' + t('manage.project_name') + '" value="' + escapeAttr(project ? project.name : '') + '"></div>' +
      '</div>' +
      /* Project Code */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><text x="4" y="15" font-size="14" font-weight="bold" fill="currentColor" opacity=".7">#</text></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="proj-code" class="rg-input" placeholder="' + t('manage.project_code') + '" value="' + escapeAttr(project ? project.code || '' : '') + '"></div>' +
      '</div>' +
      /* Client */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4V2h6v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><select id="proj-client" class="rg-select">' + clientOptions + '</select></div>' +
      '</div>' +
      /* Dates */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 7h16M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><div class="rg-date-row">' +
          '<input type="date" id="proj-start" class="rg-input rg-input-date" value="' + escapeAttr(project ? project.start_date || '' : '') + '">' +
          '<span class="rg-date-sep">~</span>' +
          '<input type="date" id="proj-end" class="rg-input rg-input-date" value="' + escapeAttr(project ? project.end_date || '' : '') + '">' +
        '</div></div>' +
      '</div>' +
      /* Billable */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><text x="5" y="15" font-size="15" font-weight="bold" fill="currentColor" opacity=".7">¥</text></svg></div>' +
        '<div class="rg-field-body">' +
          '<label class="bk-toggle"><input type="checkbox" id="proj-billable"' + (billableChecked ? ' checked' : '') + '><span class="bk-toggle-track"></span><span class="bk-toggle-label">' + t('manage.billable') + '</span></label>' +
        '</div>' +
      '</div>' +
      /* Details */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><textarea id="proj-details" class="rg-textarea" placeholder="' + t('manage.project_notes') + '" rows="3">' + escapeHtml(project ? project.details || '' : '') + '</textarea></div>' +
      '</div>' +
    '</div>';

  if (isEdit) {
    body += '<div class="rg-separator"></div>' +
      '<div class="rg-field-title" style="margin-top:15px; font-weight:600; font-size:14px; color:var(--text-primary)">' +
        '工作范围 (Work Scopes)' +
      '</div>' +
      '<div class="scopes-manager" style="margin-top:10px;">' +
        '<div id="scopes-list-container" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; border: 1px solid var(--border-color); border-radius: 4px; padding: 5px;">' +
        '</div>' +
        '<div class="input-group input-group-sm mb-1" style="display:flex; gap:8px;">' +
          '<input type="text" id="new-scope-name" class="form-control text-input form-control-sm rg-input" placeholder="新增工作范围名称，如：前端开发" style="flex:1; margin:0; padding:6px 12px; font-size:13px;">' +
          '<button class="btn btn-outline-secondary btn-sm" type="button" id="btn-add-scope" style="border: 1px solid var(--border-color); padding:6px 12px; border-radius:4px; font-size:13px;">添加</button>' +
        '</div>' +
      '</div>';
  }

  var footer = '';
  if (isEdit) {
    footer = '<div class="bk-footer-left">' +
      '<button class="btn btn-warning btn-sm" id="btn-archive-proj-modal">' + t('manage.archive_project') + '</button>' +
      '<button class="btn btn-danger btn-sm" id="btn-delete-proj-modal" style="margin-left:8px">' + t('manage.delete_project') + '</button>' +
    '</div>';
  }
  footer += '<button class="btn btn-outline" id="btn-cancel-project">' + t('common.cancel') + '</button>';
  footer += '<button class="btn btn-primary" id="btn-save-project">' + (isEdit ? t('common.save') : t('manage.create_project')) + '</button>';

  showModal(title, body, footer);
  document.getElementById('modal').classList.add('rg-modal');

  document.getElementById('btn-save-project').addEventListener('click', function () { saveProject(id || null); });
  document.getElementById('btn-cancel-project').addEventListener('click', closeModal);
  if (isEdit) {
    document.getElementById('btn-archive-proj-modal').addEventListener('click', function () {
      closeModal();
      archiveProject(id);
    });
    document.getElementById('btn-delete-proj-modal').addEventListener('click', function () {
      closeModal();
      deleteProject(id);
    });

    // Load existing scopes
    loadProjectScopes(id);

    // Bind add scope button
    document.getElementById('btn-add-scope').addEventListener('click', async function () {
      const input = document.getElementById('new-scope-name');
      const name = input.value.trim();
      if (!name) { toast('请输入工作范围名称', 'error'); return; }
      try {
        await api('/api/projects/' + id + '/scopes', {
          method: 'POST',
          body: { name: name }
        });
        toast('添加成功');
        input.value = '';
        loadProjectScopes(id);
      } catch (err) {
        toast('添加失败: ' + err.message, 'error');
      }
    });
  }
};

window.saveProject = async function saveProject(id) {
  var name = document.getElementById('proj-name').value.trim();
  if (!name) { toast(t('manage.enter_project_name'), 'error'); return; }

  var clientId = document.getElementById('proj-client').value;
  /* Derive color from selected client */
  var projColor = '#8B5CF6';
  if (clientId && state.clients) {
    var selectedClient = state.clients.find(function (c) { return c.id === parseInt(clientId, 10); });
    if (selectedClient && selectedClient.color) projColor = selectedClient.color;
  }
  var payload = {
    name: name,
    client_id: clientId ? parseInt(clientId, 10) : null,
    color: projColor,
    code: document.getElementById('proj-code').value.trim(),
    start_date: document.getElementById('proj-start').value || null,
    end_date: document.getElementById('proj-end').value || null,
    budget_hours: 0,
    hourly_rate: 0,
    billable: document.getElementById('proj-billable').checked,
    details: document.getElementById('proj-details').value.trim(),
  };

  try {
    if (id) { await api('/api/projects/' + id, { method: 'PUT', body: payload }); toast(t('manage.project_updated')); }
    else { await api('/api/projects', { method: 'POST', body: payload }); toast(t('manage.project_created')); }
    closeModal(); loadProjects();
  } catch (err) { toast(t('common.save_failed') + ': ' + err.message, 'error'); }
};

window.deleteProject = async function deleteProject(id) {
  if (!confirm(t('manage.confirm_delete_project'))) return;
  try { await api('/api/projects/' + id, { method: 'DELETE' }); toast(t('manage.project_deleted')); loadProjects(); }
  catch (err) { toast(t('common.delete_failed') + ': ' + err.message, 'error'); }
};

// --------------- Archive / Unarchive ---------------
window.archiveProject = async function archiveProject(id) {
  var p = state.projects.find(function (p) { return p.id === id; });
  if (!confirm(t('manage.archive_project') + ' "' + (p ? p.name : '') + '"?')) return;
  try { await api('/api/projects/' + id + '/archive', { method: 'PATCH' }); toast(t('manage.project_archived')); loadProjects(); }
  catch (err) { toast(t('manage.archive_failed') + ': ' + err.message, 'error'); }
};

window.unarchiveProject = async function unarchiveProject(id) {
  try { await api('/api/projects/' + id + '/unarchive', { method: 'PATCH' }); toast(t('manage.project_restored')); loadProjects(); }
  catch (err) { toast(t('manage.restore_failed') + ': ' + err.message, 'error'); }
};

window.archiveClient = async function archiveClient(id) {
  var c = state.clients.find(function (c) { return c.id === id; });
  var projectCount = state.projects.filter(function (p) { return p.client_id === id; }).length;
  var msg = t('manage.archive_client') + ' "' + (c ? c.name : '') + '"?';
  if (projectCount > 0) msg += '\n' + projectCount + ' linked projects will also be archived.';
  msg += '\n' + t('common.restore') + '?';
  if (!confirm(msg)) return;
  try { await api('/api/clients/' + id + '/archive', { method: 'PATCH' }); toast(t('manage.client_archived')); loadProjects(); }
  catch (err) { toast(t('manage.archive_failed') + ': ' + err.message, 'error'); }
};

window.unarchiveClient = async function unarchiveClient(id) {
  try { await api('/api/clients/' + id + '/unarchive', { method: 'PATCH' }); toast(t('manage.client_restored')); loadProjects(); }
  catch (err) { toast(t('manage.restore_failed') + ': ' + err.message, 'error'); }
};

// --------------- Archived Page ---------------
function renderArchivedPage(container) {
  var query = pcSearchQuery.toLowerCase();
  var archivedProjects = (state.archivedProjects || []).filter(function (p) {
    if (!query) return true;
    return (p.name && p.name.toLowerCase().indexOf(query) >= 0) ||
           (p.client_name && p.client_name.toLowerCase().indexOf(query) >= 0) ||
           (p.code && p.code.toLowerCase().indexOf(query) >= 0);
  });
  var archivedClients = (state.archivedClients || []).filter(function (c) {
    if (!query) return true;
    return (c.name && c.name.toLowerCase().indexOf(query) >= 0);
  });

  if (!archivedProjects.length && !archivedClients.length) {
    container.innerHTML = '<div class="empty-hint">' + (query ? t('manage.no_match_archived') : t('manage.no_archived')) + '</div>';
    return;
  }

  var html = '';

  // Archived clients section
  if (archivedClients.length) {
    html += '<div class="archive-section">' +
      '<h3 class="archive-section-title">' + t('manage.archive_client') + ' (' + archivedClients.length + ')</h3>' +
      '<table class="pc-table table table-hover table-sm align-middle"><thead><tr>' +
         '<th class="col-name">' + t('manage.client_name') + '</th>'+
        '<th class="col-details">' + t('common.notes') + '</th>' +
        '<th class="col-actions"></th>' +
      '</tr></thead><tbody>';
    archivedClients.forEach(function (c) {
      html += '<tr class="pc-row pc-row-archived">' +
        '<td class="col-name">' +
          '<span class="pc-color-bar" style="background:' + (c.color || '#6366F1') + ';opacity:.5"></span>' +
          '<span class="pc-name-text">' + escapeHtml(c.name) + '</span>' +
          '<span class="archive-badge">' + t('common.archive') + '</span>' +
        '</td>' +
        '<td class="col-details">' + escapeHtml(c.details || '') + '</td>' +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-outline btn-restore" data-type="client" data-id="' + c.id + '">' + t('common.restore') + '</button>' +
          '<button class="btn-icon btn-delete" data-type="client" data-id="' + c.id + '" title="' + t('manage.permanent_delete_btn') + '">&#10005;</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Archived projects section
  if (archivedProjects.length) {
    html += '<div class="archive-section">' +
      '<h3 class="archive-section-title">' + t('manage.archive_project') + ' (' + archivedProjects.length + ')</h3>' +
      '<table class="pc-table table table-hover table-sm align-middle"><thead><tr>' +
         '<th class="col-code">' + t('manage.project_code') + '</th>' +
        '<th class="col-name">' + t('manage.project_name') + '</th>'+
        '<th class="col-client">' + t('common.client') + '</th>' +
        '<th class="col-dates">' + t('manage.period') + '</th>' +
        '<th class="col-actions"></th>' +
      '</tr></thead><tbody>';
    archivedProjects.forEach(function (p) {
      var dateRange = '';
      if (p.start_date || p.end_date) {
        dateRange = (p.start_date || '—') + ' ~ ' + (p.end_date || '—');
      }
      html += '<tr class="pc-row pc-row-archived">' +
        '<td class="col-code">' + escapeHtml(p.code || '') + '</td>' +
        '<td class="col-name">' +
          '<span class="pc-color-bar" style="background:' + (p.color || '#8B5CF6') + ';opacity:.5"></span>' +
          '<span class="pc-name-text">' + escapeHtml(p.name) + '</span>' +
          '<span class="archive-badge">' + t('common.archive') + '</span>' +
        '</td>' +
        '<td class="col-client">' + escapeHtml(p.client_name || '') + '</td>' +
        '<td class="col-dates">' + escapeHtml(dateRange) + '</td>' +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-outline btn-restore" data-type="project" data-id="' + p.id + '">' + t('common.restore') + '</button>' +
          '<button class="btn-icon btn-delete" data-type="project" data-id="' + p.id + '" title="' + t('manage.permanent_delete_btn') + '">&#10005;</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;

  // Attach restore handlers
  container.querySelectorAll('.btn-restore').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var type = btn.dataset.type;
      var id = parseInt(btn.dataset.id, 10);
      if (type === 'project') unarchiveProject(id);
      else unarchiveClient(id);
    });
  });

  // Attach delete handlers
  container.querySelectorAll('.btn-delete').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var type = btn.dataset.type;
      var id = parseInt(btn.dataset.id, 10);
      if (type === 'project') deleteProject(id);
      else deleteClient(id);
    });
  });
}

// ===================== Event Listeners =====================
document.addEventListener('DOMContentLoaded', function () {
  // Projects & Clients tabs
  document.querySelectorAll('.pc-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      pcActiveTab = tab.dataset.tab;
      document.querySelectorAll('.pc-tab').forEach(function (t) {
        t.classList.remove('active');
        // Bootstrap nav-link active state
        if (t.classList.contains('nav-link')) t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      if (tab.classList.contains('nav-link')) tab.setAttribute('aria-selected', 'true');
      pcSearchQuery = '';
      var searchInput = document.getElementById('pc-search');
      if (searchInput) searchInput.value = '';
      renderPCPage();
      bindPCNewButton();
    });
  });

  // Search input
  var searchInput = document.getElementById('pc-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      pcSearchQuery = searchInput.value.trim();
      renderPCPage();
    });
  }

  // Remove rg-modal / bk-modal size class when modal closes (Bootstrap 5 event)
  var modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('hidden.bs.modal', function () {
      var modal = document.getElementById('modal');
      if (modal) {
        modal.classList.remove('rg-modal');
        modal.classList.remove('bk-modal');
      }
    });
  }
  // Also patch closeModal for fallback (non-Bootstrap) path
  var origCloseModal = window.closeModal;
  window.closeModal = function () {
    var modal = document.getElementById('modal');
    if (modal) {
      modal.classList.remove('rg-modal');
      modal.classList.remove('bk-modal');
    }
    origCloseModal();
  };
});
