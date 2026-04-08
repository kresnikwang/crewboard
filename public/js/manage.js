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
    state.resources = await api('/api/resources');
  } catch (err) {
    toast('加载人员失败: ' + err.message, 'error');
    return;
  }

  var container = document.getElementById('resource-list');
  if (!container) return;

  var teams = {};
  state.resources.forEach(function (r) {
    var team = r.team || '未分组';
    if (!teams[team]) teams[team] = [];
    teams[team].push(r);
  });

  var html = '<table class="res-table"><thead><tr>' +
    '<th style="width:40%">人员</th>' +
    '<th>角色</th>' +
    '<th>邮箱</th>' +
    '<th style="width:80px">工时/天</th>' +
    '<th style="width:60px"></th>' +
  '</tr></thead><tbody>';

  var teamNames = Object.keys(teams).sort();
  teamNames.forEach(function (team) {
    html += '<tr class="res-team-divider"><td colspan="5">' + escapeHtml(team) + ' (' + teams[team].length + ')</td></tr>';
    teams[team].forEach(function (r) {
      var color = r.color || '#4F46E5';
      var initial = r.name ? r.name.charAt(0) : '?';
      html += '<tr data-id="' + r.id + '">' +
        '<td><div class="res-name-cell">' +
          '<div class="res-avatar" style="background:' + color + '">' + escapeHtml(initial) + '</div>' +
          '<div><div class="res-name">' + escapeHtml(r.name) + '</div>' +
          '<div class="res-meta">' + escapeHtml(r.role || '') + '</div></div>' +
        '</div></td>' +
        '<td>' + escapeHtml(r.role || '-') + '</td>' +
        '<td>' + escapeHtml(r.email || '-') + '</td>' +
        '<td>' + (r.hours_per_day != null ? r.hours_per_day : 8) + 'h</td>' +
        '<td><div class="res-actions">' +
          '<button class="btn-icon btn-res-edit" data-id="' + r.id + '" title="编辑">&#9998;</button>' +
          '<button class="btn-icon btn-res-del" data-id="' + r.id + '" title="删除">&#10005;</button>' +
        '</div></td>' +
      '</tr>';
    });
  });

  html += '</tbody></table>';
  if (state.resources.length === 0) {
    html = '<div class="empty-hint">暂无人员，点击上方按钮添加</div>';
  }
  container.innerHTML = html;

  /* Attach click events */
  container.querySelectorAll('.btn-res-edit').forEach(function (btn) {
    btn.addEventListener('click', function () { showResourceModal(parseInt(btn.dataset.id, 10)); });
  });
  container.querySelectorAll('.btn-res-del').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteResource(parseInt(btn.dataset.id, 10)); });
  });
  /* Click on row to edit */
  container.querySelectorAll('tr[data-id]').forEach(function (row) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', function (e) {
      if (e.target.closest('.btn-icon')) return;
      showResourceModal(parseInt(row.dataset.id, 10));
    });
  });
};

window.showResourceModal = function showResourceModal(id) {
  var resource = null;
  if (id) resource = state.resources.find(function (r) { return r.id === id; });
  var title = resource ? '编辑人员' : '添加人员';

  var body = '<div class="rg-form" style="padding:0 24px">' +
    /* Name */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">姓名 <span style="color:#EF4444">*</span></label>' +
        '<input class="rg-input" type="text" id="res-name" value="' + escapeAttr(resource ? resource.name : '') + '" placeholder="输入姓名">' +
      '</div>' +
    '</div>' +
    /* Color */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" fill="currentColor" opacity=".3"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">标识颜色</label>' +
        buildColorDropdownHtml(resource && resource.color ? resource.color : '#4F46E5', 'rg-color-value') +
      '</div>' +
    '</div>' +
    /* Role */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4V2h6v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">角色 / 职位</label>' +
        '<input class="rg-input" type="text" id="res-role" value="' + escapeAttr(resource ? resource.role : '') + '" placeholder="如：前端开发">' +
      '</div>' +
    '</div>' +
    /* Email */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 6l8 5 8-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">邮箱</label>' +
        '<input class="rg-input" type="email" id="res-email" value="' + escapeAttr(resource ? resource.email : '') + '" placeholder="name@company.com">' +
      '</div>' +
    '</div>' +
    /* Team */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 17c0-2.5 2-4.5 5-4.5h1M14 12.5c3 0 5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">组别</label>' +
        '<input class="rg-input" type="text" id="res-team" value="' + escapeAttr(resource ? resource.team : '') + '" placeholder="如：开发组">' +
      '</div>' +
    '</div>' +
    /* Hours per day */
    '<div class="rg-field">' +
      '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
      '<div class="rg-field-body">' +
        '<label class="rg-label">工时/天</label>' +
        '<input class="rg-input" type="number" id="res-hours" min="0" max="24" step="0.5" value="' + (resource && resource.hours_per_day != null ? resource.hours_per_day : 8) + '" style="width:100px">' +
      '</div>' +
    '</div>' +
  '</div>';

  var footer = '';
  if (id) {
    footer += '<button class="btn btn-danger bk-footer-left" id="btn-del-resource">删除人员</button>';
  }
  footer += '<button class="btn btn-outline" onclick="closeModal()">取消</button>';
  footer += '<button class="btn btn-primary" id="btn-save-resource">保存</button>';

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
  if (!name) { toast('请输入姓名', 'error'); return; }
  var colorEl = document.getElementById('rg-color-value');
  var payload = {
    name: name,
    email: document.getElementById('res-email').value.trim(),
    role: document.getElementById('res-role').value.trim(),
    team: document.getElementById('res-team').value.trim(),
    color: colorEl ? colorEl.value : '#4F46E5',
    hours_per_day: parseFloat(document.getElementById('res-hours').value) || 8,
  };
  try {
    if (id) { await api('/api/resources/' + id, { method: 'PUT', body: payload }); toast('人员已更新'); }
    else { await api('/api/resources', { method: 'POST', body: payload }); toast('人员已添加'); }
    document.getElementById('modal').classList.remove('rg-modal');
    closeModal(); loadResources();
  } catch (err) { toast('保存失败: ' + err.message, 'error'); }
};

window.deleteResource = async function deleteResource(id) {
  if (!confirm('确定要删除该人员吗？')) return;
  try {
    await api('/api/resources/' + id, { method: 'DELETE' });
    toast('人员已删除');
    document.getElementById('modal').classList.remove('rg-modal');
    closeModal();
    loadResources();
  } catch (err) { toast('删除失败: ' + err.message, 'error'); }
};

// ===================== Projects & Clients =====================

var pcActiveTab = 'projects';
var pcSearchQuery = '';

// Color palette for dropdowns
var COLOR_PALETTE = [
  /* Row 1 — 鲜明主色 */
  { value: '#EF4444', label: '红色' },
  { value: '#F97316', label: '橙色' },
  { value: '#F59E0B', label: '琥珀' },
  { value: '#84CC16', label: '黄绿' },
  { value: '#22C55E', label: '翠绿' },
  { value: '#06B6D4', label: '青色' },
  /* Row 2 — 蓝紫粉 */
  { value: '#3B82F6', label: '蓝色' },
  { value: '#6366F1', label: '蓝紫' },
  { value: '#8B5CF6', label: '紫色' },
  { value: '#EC4899', label: '粉色' },
  { value: '#78716C', label: '灰色' },
  { value: '#1E293B', label: '墨黑' },
  /* Row 3 — 深色系 */
  { value: '#991B1B', label: '深红' },
  { value: '#9A3412', label: '棕色' },
  { value: '#92400E', label: '深棕' },
  { value: '#166534', label: '深绿' },
  { value: '#115E59', label: '深青' },
  { value: '#1E40AF', label: '深蓝' },
  /* Row 4 — 浅色/柔和色系 */
  { value: '#FB7185', label: '浅红' },
  { value: '#FDBA74', label: '杏色' },
  { value: '#FDE047', label: '柠檬黄' },
  { value: '#86EFAC', label: '薄荷绿' },
  { value: '#7DD3FC', label: '天蓝' },
  { value: '#C084FC', label: '淡紫' },
];

function buildColorDropdownHtml(selectedColor, inputId) {
  var html = '<div class="rg-color-picker" id="' + inputId + '-picker">';
  html += '<button type="button" class="rg-color-btn" id="' + inputId + '-btn">';
  html += '<span class="rg-color-dot" style="background:' + (selectedColor || '#8B5CF6') + '"></span>';
  html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  html += '</button>';
  html += '<input type="hidden" id="' + inputId + '" value="' + (selectedColor || '#8B5CF6') + '">';
  html += '<div class="rg-color-dropdown" id="' + inputId + '-dropdown">';
  COLOR_PALETTE.forEach(function (c) {
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
    toast('加载失败: ' + err.message, 'error');
    return;
  }
  renderPCPage();
};

function renderPCPage() {
  // Update tab counts
  var tabProjects = document.getElementById('tab-projects');
  var tabClients = document.getElementById('tab-clients');
  var tabArchived = document.getElementById('tab-archived');
  if (tabProjects) tabProjects.textContent = '项目 (' + state.projects.length + ')';
  if (tabClients) tabClients.textContent = '客户 (' + state.clients.length + ')';
  var archivedTotal = (state.archivedProjects ? state.archivedProjects.length : 0) + (state.archivedClients ? state.archivedClients.length : 0);
  if (tabArchived) tabArchived.textContent = '存档' + (archivedTotal ? ' (' + archivedTotal + ')' : '');

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
  var query = pcSearchQuery.toLowerCase();
  var filtered = state.projects.filter(function (p) {
    if (!query) return true;
    return (p.name && p.name.toLowerCase().indexOf(query) >= 0) ||
           (p.client_name && p.client_name.toLowerCase().indexOf(query) >= 0) ||
           (p.code && p.code.toLowerCase().indexOf(query) >= 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">' + (query ? '没有匹配的项目' : '暂无项目，点击"新建"添加') + '</div>';
    return;
  }

  var table = document.createElement('table');
  table.className = 'pc-table';
  table.innerHTML =
    '<thead><tr>' +
      '<th class="col-name">项目名称</th>' +
      '<th class="col-client">客户</th>' +
      '<th class="col-code">项目编号</th>' +
      '<th class="col-dates">周期</th>' +
      '<th class="col-billable">计费</th>' +
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
      '<td class="col-name">' +
        '<span class="pc-color-bar" style="background:' + (p.color || '#8B5CF6') + '"></span>' +
        '<span class="pc-name-text">' + escapeHtml(p.name) + '</span>' +
      '</td>' +
      '<td class="col-client">' + escapeHtml(p.client_name || '') + '</td>' +
      '<td class="col-code">' + escapeHtml(p.code || '') + '</td>' +
      '<td class="col-dates">' + escapeHtml(dateRange) + '</td>' +
      '<td class="col-billable">' + (p.billable ? 'Yes' : 'No') + '</td>' +
      '<td class="col-actions">' +
        '<button class="btn-icon btn-edit" title="编辑">&#9998;</button>' +
        '<button class="btn-icon btn-archive" title="存档">&#128451;</button>' +
      '</td>';
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
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderClientsTable(container) {
  var query = pcSearchQuery.toLowerCase();
  var filtered = state.clients.filter(function (c) {
    if (!query) return true;
    return (c.name && c.name.toLowerCase().indexOf(query) >= 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-hint">' + (query ? '没有匹配的客户' : '暂无客户，点击"新建"添加') + '</div>';
    return;
  }

  var table = document.createElement('table');
  table.className = 'pc-table';
  table.innerHTML =
    '<thead><tr>' +
      '<th class="col-name">客户名称</th>' +
      '<th class="col-projects">关联项目</th>' +
      '<th class="col-details">备注</th>' +
      '<th class="col-actions"></th>' +
    '</tr></thead>';

  var tbody = document.createElement('tbody');
  filtered.forEach(function (c) {
    var projectCount = state.projects.filter(function (p) { return p.client_id === c.id; }).length;
    var tr = document.createElement('tr');
    tr.className = 'pc-row';
    tr.innerHTML =
      '<td class="col-name">' +
        '<span class="pc-color-bar" style="background:' + (c.color || '#6366F1') + '"></span>' +
        '<span class="pc-name-text">' + escapeHtml(c.name) + '</span>' +
      '</td>' +
      '<td class="col-projects">' + projectCount + ' 个项目</td>' +
      '<td class="col-details">' + escapeHtml(c.details || '') + '</td>' +
      '<td class="col-actions">' +
        '<button class="btn-icon btn-edit" title="编辑">&#9998;</button>' +
        '<button class="btn-icon btn-archive" title="存档">&#128451;</button>' +
      '</td>';
    tr.querySelector('.btn-edit').addEventListener('click', function (e) {
      e.stopPropagation();
      showClientModal(c.id);
    });
    tr.querySelector('.btn-archive').addEventListener('click', function (e) {
      e.stopPropagation();
      archiveClient(c.id);
    });
    tr.addEventListener('click', function () { showClientModal(c.id); });
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
  var title = isEdit ? '编辑客户' : '新建客户';

  var colorVal = client && client.color ? client.color : '#6366F1';

  var body =
    '<div class="rg-form">' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4V2h6v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="client-name" class="rg-input rg-input-lg" placeholder="客户名称" value="' + escapeAttr(client ? client.name : '') + '"></div>' +
      '</div>' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 17c0-3 3-5 7-5s7 2 7 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/></svg></div>' +
        '<div class="rg-field-body"><div class="rg-field-label">Color</div>' + buildColorDropdownHtml(colorVal, 'client-color') + '</div>' +
      '</div>' +
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><textarea id="client-details" class="rg-textarea" placeholder="备注" rows="3">' + escapeHtml(client ? client.details || '' : '') + '</textarea></div>' +
      '</div>' +
    '</div>';

  var footer = '';
  if (isEdit) {
    footer = '<div class="bk-footer-left">' +
      '<button class="btn btn-warning btn-sm" id="btn-archive-client-modal">存档客户</button>' +
      '<button class="btn btn-danger btn-sm" id="btn-delete-client-modal" style="margin-left:8px">删除客户</button>' +
    '</div>';
  }
  footer += '<button class="btn btn-outline" id="btn-cancel-client">取消</button>';
  footer += '<button class="btn btn-primary" id="btn-save-client">' + (isEdit ? '保存修改' : '创建客户') + '</button>';

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
  if (!name) { toast('请输入客户名称', 'error'); return; }
  var payload = {
    name: name,
    color: document.getElementById('client-color').value,
    details: document.getElementById('client-details').value.trim(),
  };
  try {
    if (id) { await api('/api/clients/' + id, { method: 'PUT', body: payload }); toast('客户已更新'); }
    else { await api('/api/clients', { method: 'POST', body: payload }); toast('客户创建成功'); }
    closeModal(); loadProjects();
  } catch (err) { toast('保存失败: ' + err.message, 'error'); }
};

window.deleteClient = async function deleteClient(id) {
  var projectCount = state.projects.filter(function (p) { return p.client_id === id; }).length;
  var msg = '确定要删除该客户吗？';
  if (projectCount > 0) msg += '\n该客户下有 ' + projectCount + ' 个关联项目。';
  if (!confirm(msg)) return;
  try { await api('/api/clients/' + id, { method: 'DELETE' }); toast('客户已删除'); loadProjects(); }
  catch (err) { toast('删除失败: ' + err.message, 'error'); }
};

// --------------- Project Modal (ResourceGuru style) ---------------
window.showProjectModal = async function showProjectModal(id) {
  if (!state.clients || !state.clients.length) {
    try { state.clients = await api('/api/clients'); } catch (_) { state.clients = []; }
  }

  var project = null;
  if (id) project = state.projects.find(function (p) { return p.id === id; });
  var isEdit = !!project;
  var title = isEdit ? '编辑项目' : '新建项目';

  var billableChecked = project ? !!project.billable : true;

  var clientOptions = '<option value="">选择客户</option>';
  state.clients.forEach(function (c) {
    var sel = project && project.client_id === c.id ? ' selected' : '';
    clientOptions += '<option value="' + c.id + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
  });

  var body =
    '<div class="rg-form">' +
      /* Name */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.5"/></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="proj-name" class="rg-input rg-input-lg" placeholder="项目名称" value="' + escapeAttr(project ? project.name : '') + '"></div>' +
      '</div>' +
      /* Project Code */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><text x="4" y="15" font-size="14" font-weight="bold" fill="currentColor" opacity=".7">#</text></svg></div>' +
        '<div class="rg-field-body"><input type="text" id="proj-code" class="rg-input" placeholder="项目编号" value="' + escapeAttr(project ? project.code || '' : '') + '"></div>' +
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
          '<label class="bk-toggle"><input type="checkbox" id="proj-billable"' + (billableChecked ? ' checked' : '') + '><span class="bk-toggle-track"></span><span class="bk-toggle-label">计费项目 (Billable)</span></label>' +
        '</div>' +
      '</div>' +
      /* Details */
      '<div class="rg-field">' +
        '<div class="rg-field-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
        '<div class="rg-field-body"><textarea id="proj-details" class="rg-textarea" placeholder="项目备注" rows="3">' + escapeHtml(project ? project.details || '' : '') + '</textarea></div>' +
      '</div>' +
    '</div>';

  var footer = '';
  if (isEdit) {
    footer = '<div class="bk-footer-left">' +
      '<button class="btn btn-warning btn-sm" id="btn-archive-proj-modal">存档项目</button>' +
      '<button class="btn btn-danger btn-sm" id="btn-delete-proj-modal" style="margin-left:8px">删除项目</button>' +
    '</div>';
  }
  footer += '<button class="btn btn-outline" id="btn-cancel-project">取消</button>';
  footer += '<button class="btn btn-primary" id="btn-save-project">' + (isEdit ? '保存修改' : '创建项目') + '</button>';

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
  }
};

window.saveProject = async function saveProject(id) {
  var name = document.getElementById('proj-name').value.trim();
  if (!name) { toast('请输入项目名称', 'error'); return; }

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
    if (id) { await api('/api/projects/' + id, { method: 'PUT', body: payload }); toast('项目已更新'); }
    else { await api('/api/projects', { method: 'POST', body: payload }); toast('项目创建成功'); }
    closeModal(); loadProjects();
  } catch (err) { toast('保存失败: ' + err.message, 'error'); }
};

window.deleteProject = async function deleteProject(id) {
  if (!confirm('确定要永久删除该项目吗？删除后将无法恢复。')) return;
  try { await api('/api/projects/' + id, { method: 'DELETE' }); toast('项目已删除'); loadProjects(); }
  catch (err) { toast('删除失败: ' + err.message, 'error'); }
};

// --------------- Archive / Unarchive ---------------
window.archiveProject = async function archiveProject(id) {
  var p = state.projects.find(function (p) { return p.id === id; });
  if (!confirm('确定要存档项目"' + (p ? p.name : '') + '"吗？\n存档后将不在项目列表中显示，可在"存档"页面恢复。')) return;
  try { await api('/api/projects/' + id + '/archive', { method: 'PATCH' }); toast('项目已存档'); loadProjects(); }
  catch (err) { toast('存档失败: ' + err.message, 'error'); }
};

window.unarchiveProject = async function unarchiveProject(id) {
  try { await api('/api/projects/' + id + '/unarchive', { method: 'PATCH' }); toast('项目已恢复'); loadProjects(); }
  catch (err) { toast('恢复失败: ' + err.message, 'error'); }
};

window.archiveClient = async function archiveClient(id) {
  var c = state.clients.find(function (c) { return c.id === id; });
  var projectCount = state.projects.filter(function (p) { return p.client_id === id; }).length;
  var msg = '确定要存档客户"' + (c ? c.name : '') + '"吗？';
  if (projectCount > 0) msg += '\n该客户下的 ' + projectCount + ' 个关联项目也将一并存档。';
  msg += '\n可在"存档"页面恢复。';
  if (!confirm(msg)) return;
  try { await api('/api/clients/' + id + '/archive', { method: 'PATCH' }); toast('客户已存档'); loadProjects(); }
  catch (err) { toast('存档失败: ' + err.message, 'error'); }
};

window.unarchiveClient = async function unarchiveClient(id) {
  try { await api('/api/clients/' + id + '/unarchive', { method: 'PATCH' }); toast('客户已恢复'); loadProjects(); }
  catch (err) { toast('恢复失败: ' + err.message, 'error'); }
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
    container.innerHTML = '<div class="empty-hint">' + (query ? '没有匹配的存档项' : '暂无存档项目或客户') + '</div>';
    return;
  }

  var html = '';

  // Archived clients section
  if (archivedClients.length) {
    html += '<div class="archive-section">' +
      '<h3 class="archive-section-title">存档客户 (' + archivedClients.length + ')</h3>' +
      '<table class="pc-table"><thead><tr>' +
        '<th class="col-name">客户名称</th>' +
        '<th class="col-details">备注</th>' +
        '<th class="col-actions"></th>' +
      '</tr></thead><tbody>';
    archivedClients.forEach(function (c) {
      html += '<tr class="pc-row pc-row-archived">' +
        '<td class="col-name">' +
          '<span class="pc-color-bar" style="background:' + (c.color || '#6366F1') + ';opacity:.5"></span>' +
          '<span class="pc-name-text">' + escapeHtml(c.name) + '</span>' +
          '<span class="archive-badge">已存档</span>' +
        '</td>' +
        '<td class="col-details">' + escapeHtml(c.details || '') + '</td>' +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-outline btn-restore" data-type="client" data-id="' + c.id + '">恢复</button>' +
          '<button class="btn-icon btn-delete" data-type="client" data-id="' + c.id + '" title="永久删除">&#10005;</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Archived projects section
  if (archivedProjects.length) {
    html += '<div class="archive-section">' +
      '<h3 class="archive-section-title">存档项目 (' + archivedProjects.length + ')</h3>' +
      '<table class="pc-table"><thead><tr>' +
        '<th class="col-name">项目名称</th>' +
        '<th class="col-client">客户</th>' +
        '<th class="col-code">项目编号</th>' +
        '<th class="col-dates">周期</th>' +
        '<th class="col-actions"></th>' +
      '</tr></thead><tbody>';
    archivedProjects.forEach(function (p) {
      var dateRange = '';
      if (p.start_date || p.end_date) {
        dateRange = (p.start_date || '—') + ' ~ ' + (p.end_date || '—');
      }
      html += '<tr class="pc-row pc-row-archived">' +
        '<td class="col-name">' +
          '<span class="pc-color-bar" style="background:' + (p.color || '#8B5CF6') + ';opacity:.5"></span>' +
          '<span class="pc-name-text">' + escapeHtml(p.name) + '</span>' +
          '<span class="archive-badge">已存档</span>' +
        '</td>' +
        '<td class="col-client">' + escapeHtml(p.client_name || '') + '</td>' +
        '<td class="col-code">' + escapeHtml(p.code || '') + '</td>' +
        '<td class="col-dates">' + escapeHtml(dateRange) + '</td>' +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-outline btn-restore" data-type="project" data-id="' + p.id + '">恢复</button>' +
          '<button class="btn-icon btn-delete" data-type="project" data-id="' + p.id + '" title="永久删除">&#10005;</button>' +
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
  // Resource add button
  var btnAddResource = document.getElementById('btn-add-resource');
  if (btnAddResource) {
    btnAddResource.addEventListener('click', function () { showResourceModal(); });
  }

  // Projects & Clients tabs
  document.querySelectorAll('.pc-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      pcActiveTab = tab.dataset.tab;
      document.querySelectorAll('.pc-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      pcSearchQuery = '';
      var searchInput = document.getElementById('pc-search');
      if (searchInput) searchInput.value = '';
      renderPCPage();
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

  // New button — creates project or client depending on active tab
  var btnNew = document.getElementById('btn-add-new-pc');
  if (btnNew) {
    btnNew.addEventListener('click', function () {
      if (pcActiveTab === 'clients') {
        showClientModal();
      } else {
        showProjectModal();
      }
    });
  }

  // Close modal — remove rg-modal class
  var origCloseModal = window.closeModal;
  window.closeModal = function () {
    var modal = document.getElementById('modal');
    if (modal) modal.classList.remove('rg-modal');
    origCloseModal();
  };
});
