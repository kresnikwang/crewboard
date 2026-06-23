/* ============================================================
   enterprise.js — Enterprise, Settings, Account pages
   Dependencies from core.js: state, api, showModal, closeModal,
   toast, applyTheme
   ============================================================ */

// --------------- Helper ---------------
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isOwnerOrAdmin() {
  var role = state.user && state.user.role;
  return role === 'owner' || role === 'admin';
}

function isManager() {
  var role = state.user && state.user.role;
  return role === 'manager' || isOwnerOrAdmin();
}

// ============================================================
// ENTERPRISE PAGE
// ============================================================
window.loadEnterprise = async function loadEnterprise() {
  var container = document.getElementById('page-enterprise');
  if (!container) return;

  var user = state.user;
  if (!user) return;

  // No enterprise — show create / join forms
  if (!user.enterprise_id) {
    container.innerHTML =
      '<div class="page-header"><h2>' + t('enterprise.title') + '</h2></div>' +
      '<div class="enterprise-setup">' +
        '<div class="section-card card mb-3">' +
          '<h3>' + t('enterprise.create') + '</h3>' +
          '<div class="form-group mb-3">' +
            '<label>' + t('enterprise.name_label') + '</label>' +
            '<input type="text" id="ent-create-name" class="text-input form-control" placeholder="' + t('enterprise.name_placeholder') + '">' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-create-ent">' + t('enterprise.create') + '</button>' +
        '</div>' +
        '<div class="section-card card mb-3">' +
          '<h3>' + t('enterprise.join') + '</h3>' +
          '<div class="form-group mb-3">' +
            '<label>' + t('enterprise.invite_code_label') + '</label>' +
            '<input type="text" id="ent-join-code" class="text-input form-control" placeholder="' + t('enterprise.invite_code_placeholder') + '">' +
          '</div>' +
          '<div class="form-group mb-3">' +
            '<label>' + t('enterprise.message_label') + '</label>' +
            '<input type="text" id="ent-join-msg" class="text-input form-control" placeholder="' + t('enterprise.message_placeholder') + '">' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-join-ent">' + t('enterprise.join') + '</button>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-create-ent').addEventListener('click', async function () {
      var name = document.getElementById('ent-create-name').value.trim();
      if (!name) { toast(t('enterprise.enter_name'), 'error'); return; }
      try {
        await api('/api/auth/enterprises', { method: 'POST', body: { name: name } });
        toast(t('enterprise.created'));
        var me = await api('/api/auth/me');
        state.user = me.user;
        state.enterprise = me.enterprise;
        loadEnterprise();
      } catch (err) {
        toast(err.message || t('enterprise.create_failed'), 'error');
      }
    });

    document.getElementById('btn-join-ent').addEventListener('click', async function () {
      var code = document.getElementById('ent-join-code').value.trim();
      if (!code) { toast(t('enterprise.enter_code'), 'error'); return; }
      var message = document.getElementById('ent-join-msg').value.trim();
      try {
        await api('/api/auth/enterprises/join', { method: 'POST', body: { code: code, message: message } });
        toast(t('enterprise.join_submitted'));
      } catch (err) {
        toast(err.message || t('enterprise.join_failed'), 'error');
      }
    });

    return;
  }

  // Has enterprise — show info, requests (if admin/owner), invite
  var ent = state.enterprise || {};
  var html =
    '<div class="page-header"><h2>' + t('enterprise.title') + '</h2></div>' +
    '<div class="section-card card mb-3">' +
      '<h3>' + t('enterprise.info') + '</h3>' +
      '<div class="info-row"><span class="info-label">' + t('enterprise.name_label') + '</span><span class="info-value">' + escHtml(ent.name) + '</span></div>' +
      '<div class="info-row"><span class="info-label">' + t('enterprise.invite_code_desc') + '</span><span class="info-value" style="font-family:monospace;font-weight:600">' + escHtml(ent.code) + '</span></div>' +
    '</div>';

  if (isOwnerOrAdmin()) {
    html += '<div class="section-card card mb-3" id="ent-requests-section"><h3>' + t('enterprise.requests') + '</h3><div id="ent-requests">...</div></div>';
  }

  // 成员列表已移至「人员管理」页面统一管理

  if (isOwnerOrAdmin()) {
    html += '<div class="section-card card mb-3">' +
      '<h3>' + t('enterprise.invite_title') + '</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:12px">' + t('enterprise.invite_desc') + '</p>' +
      '<div class="form-row row g-3">' +
        '<div class="form-group mb-3">' +
          '<label>' + t('enterprise.invite_name_label') + '</label>' +
          '<input type="text" id="invite-name" class="text-input form-control" placeholder="' + t('enterprise.invite_name_placeholder') + '">' +
        '</div>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('enterprise.invite_email_label') + '</label>' +
          '<input type="email" id="invite-email" class="text-input form-control" placeholder="' + t('enterprise.invite_email_placeholder') + '">' +
        '</div>' +
        '<div class="form-group" style="display:flex;align-items:flex-end">' +
          '<button class="btn btn-primary" id="btn-invite-member">' + t('enterprise.send_invite') + '</button>' +
        '</div>' +
      '</div>' +
      '<div id="ent-invitations">...</div>' +
    '</div>';
  }

  container.innerHTML = html;

  // Load requests if admin/owner
  if (isOwnerOrAdmin()) {
    loadEnterpriseRequests();
  }

  // Load invitations and bind invite button
  if (isOwnerOrAdmin()) {
    loadInvitations();
    var inviteBtn = document.getElementById('btn-invite-member');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', async function () {
        var email = document.getElementById('invite-email').value.trim();
        var name = document.getElementById('invite-name').value.trim();
        if (!email) { toast(t('enterprise.invite_email_label'), 'error'); return; }
        try {
          var result = await api('/api/auth/enterprises/invite', {
            method: 'POST',
            body: { email: email, name: name }
          });
          toast(t('enterprise.invite_sent'));
          document.getElementById('invite-email').value = '';
          document.getElementById('invite-name').value = '';
          loadInvitations();
        } catch (err) {
          toast(err.message || t('enterprise.invite_failed'), 'error');
        }
      });
    }
  }

  // WeCom & Theme settings (owner/admin only)
  if (isOwnerOrAdmin()) {
    var currentTheme = ent.theme_color || '';
    var allResources = [];
    try {
      allResources = await api('/api/resources');
    } catch (_) {
      allResources = [];
    }
    var matchedWeComResources = allResources.filter(function (resource) {
      return !!(resource && resource.wecom_userid);
    });
    var resourceOptionsHtml = matchedWeComResources.length
      ? matchedWeComResources.map(function (resource) {
          var label = resource.name + (resource.email ? ' · ' + resource.email : '') + ' · ' + resource.wecom_userid;
          return '<option value="' + escHtml(String(resource.id)) + '">' + escHtml(label) + '</option>';
        }).join('')
      : '<option value="">' + escHtml(t('wecom.test_no_matched_employees')) + '</option>';

    var currentTimezone = ent.timezone || 'Asia/Shanghai';
    var timezoneOptions = [
      { value: 'Asia/Shanghai', label: 'Asia/Shanghai (北京 / Beijing)' },
      { value: 'Asia/Tokyo', label: 'Asia/Tokyo (东京 / Tokyo)' },
      { value: 'Europe/London', label: 'Europe/London (伦敦 / London)' },
      { value: 'America/New_York', label: 'America/New_York (纽约 / New York)' },
      { value: 'America/Los_Angeles', label: 'America/Los_Angeles (洛杉矶 / Los Angeles)' },
      { value: 'UTC', label: 'UTC (UTC)' }
    ];
    var timezoneOptionsHtml = timezoneOptions.map(function (tz) {
      var selected = tz.value === currentTimezone ? ' selected' : '';
      return '<option value="' + tz.value + '"' + selected + '>' + escHtml(tz.label) + '</option>';
    }).join('');

    var settingsHtml =
      '<div class="section-card card mb-3">' +
        '<h3>' + t('wecom.app_title') + '</h3>' +
        '<p style="color:var(--text-secondary);margin-bottom:12px">' + t('wecom.app_desc') + '</p>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.corp_id') + '</label>' +
          '<input type="text" id="set-wecom-corp-id" class="text-input form-control" value="' + escHtml(ent.wecom_corp_id || '') + '" placeholder="wwxxxxxxxxxxxxxxxx">' +
        '</div>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.agent_id') + '</label>' +
          '<input type="text" id="set-wecom-agent-id" class="text-input form-control" value="' + escHtml(ent.wecom_agent_id || '') + '" placeholder="1000003">' +
        '</div>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.app_secret') + '</label>' +
          '<input type="password" id="set-wecom-secret" class="text-input form-control" value="' + escHtml(ent.wecom_secret || '') + '" placeholder="' + t('wecom.app_secret_placeholder') + '">' +
        '</div>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.department_id') + '</label>' +
          '<input type="number" id="set-wecom-department-id" class="text-input form-control" value="' + escHtml(String(ent.wecom_department_id || 1)) + '" min="1" placeholder="1">' +
        '</div>' +
        '<button class="btn btn-outline" id="btn-sync-wecom">' + t('wecom.sync_contacts') + '</button>' +
      '</div>' +
      '<div class="section-card card mb-3">' +
        '<h3>' + t('wecom.test_title') + '</h3>' +
        '<p style="color:var(--text-secondary);margin-bottom:12px">' + t('wecom.test_desc') + '</p>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.test_employee') + '</label>' +
          '<select id="wecom-test-resource" class="text-input form-control" ' + (matchedWeComResources.length ? '' : 'disabled') + '>' +
            resourceOptionsHtml +
          '</select>' +
        '</div>' +
        '<div class="form-group mb-3">' +
          '<label>' + t('wecom.test_message_type') + '</label>' +
          '<select id="wecom-test-message-type" class="text-input">' +
            '<option value="schedule_created">' + t('wecom.test_type_schedule_created') + '</option>' +
            '<option value="schedule_updated">' + t('wecom.test_type_schedule_updated') + '</option>' +
            '<option value="schedule_deleted">' + t('wecom.test_type_schedule_deleted') + '</option>' +
            '<option value="text_card">' + t('wecom.test_type_text_card') + '</option>' +
          '</select>' +
        '</div>' +
        '<button class="btn btn-primary" id="btn-send-wecom-test" ' + (matchedWeComResources.length ? '' : 'disabled') + '>' + t('wecom.test_send') + '</button>' +
      '</div>' +
      '<div class="section-card card mb-3">' +
        '<h3>' + t('enterprise.timezone') + '</h3>' +
        '<p style="color:var(--text-secondary);margin-bottom:12px">' + t('enterprise.timezone_desc') + '</p>' +
        '<div class="form-group mb-3">' +
          '<select id="set-enterprise-timezone" class="text-input form-control">' +
            timezoneOptionsHtml +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="section-card card mb-3">' +
        '<h3>' + t('theme.title') + '</h3>' +
        '<div class="theme-palette" id="theme-palette">';

    getThemeOptions().forEach(function (themeOpt) {
      var active = themeOpt.id === currentTheme ? ' active' : '';
      settingsHtml += '<div class="theme-option" data-theme-id="' + themeOpt.id + '">' +
        '<div class="theme-swatch' + active + '" style="background:' + themeOpt.color + '">' +
          '<span class="check-icon">\u2713</span>' +
        '</div>' +
        '<div class="theme-label">' + themeOpt.label + '</div>' +
      '</div>';
    });

    settingsHtml += '</div>' +
      '<button class="btn btn-primary" id="btn-save-settings" style="margin-top:16px">' + t('common.save') + '</button>' +
    '</div>';

    container.insertAdjacentHTML('beforeend', settingsHtml);

    // Theme swatch click handling
    var selectedTheme = currentTheme;
    document.querySelectorAll('#theme-palette .theme-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        selectedTheme = opt.dataset.themeId;
        document.querySelectorAll('#theme-palette .theme-swatch').forEach(function (sw) {
          sw.classList.remove('active');
        });
        opt.querySelector('.theme-swatch').classList.add('active');
      });
    });

    function getEnterpriseSettingsPayload() {
      return {
        name: (state.enterprise && state.enterprise.name) || '',
        webhook_dingtalk: (state.enterprise && state.enterprise.webhook_dingtalk) || '',
        webhook_wecom: (state.enterprise && state.enterprise.webhook_wecom) || '',
        webhook_feishu: (state.enterprise && state.enterprise.webhook_feishu) || '',
        wecom_corp_id: document.getElementById('set-wecom-corp-id').value.trim(),
        wecom_agent_id: document.getElementById('set-wecom-agent-id').value.trim(),
        wecom_secret: document.getElementById('set-wecom-secret').value.trim(),
        wecom_department_id: document.getElementById('set-wecom-department-id').value.trim() || '1',
        theme_color: selectedTheme,
        timezone: document.getElementById('set-enterprise-timezone').value,
      };
    }

    async function saveEnterpriseSettings(showToastMessage) {
      var payload = getEnterpriseSettingsPayload();
      await api('/api/auth/enterprises/settings', { method: 'PUT', body: payload });
      state.enterprise = Object.assign(state.enterprise || {}, payload);
      applyTheme(selectedTheme);
      if (showToastMessage) toast(t('theme.settings_saved'));
      return payload;
    }

    // Save settings button
    document.getElementById('btn-save-settings').addEventListener('click', async function () {
      try {
        await saveEnterpriseSettings(true);
      } catch (err) {
        toast(err.message || t('common.save_failed'), 'error');
      }
    });

    document.getElementById('btn-sync-wecom').addEventListener('click', async function () {
      try {
        await saveEnterpriseSettings(false);
        var result = await api('/api/wecom/sync', { method: 'POST' });
        if (result.unmatched && result.unmatched.length) {
          toast(t('wecom.sync_partial') + '：' + result.matched.length + ' / ' + (result.matched.length + result.unmatched.length), 'info');
        } else {
          toast(t('wecom.sync_success') + '：' + result.matched.length, 'success');
        }
        var me = await api('/api/auth/me');
        state.user = me.user;
        state.enterprise = me.enterprise;
        loadEnterprise();
      } catch (err) {
        var msg = err.message || t('wecom.sync_failed');
        toast(msg, 'error');
      }
    });

    var sendWeComTestBtn = document.getElementById('btn-send-wecom-test');
    if (sendWeComTestBtn) {
      sendWeComTestBtn.addEventListener('click', async function () {
        var resourceId = document.getElementById('wecom-test-resource').value;
        var messageType = document.getElementById('wecom-test-message-type').value;
        if (!resourceId) {
          toast(t('wecom.test_select_employee'), 'error');
          return;
        }
        try {
          await saveEnterpriseSettings(false);
          var result = await api('/api/wecom/test-message', {
            method: 'POST',
            body: {
              resource_id: resourceId,
              message_type: messageType
            }
          });
          toast(t('wecom.test_send_success') + '：' + result.resource.name + ' · ' + result.message_label, 'success');
        } catch (err) {
          toast(err.message || t('wecom.test_send_failed'), 'error');
        }
      });
    }
  }
};


async function loadEnterpriseRequests() {
  try {
    var requests = await api('/api/auth/enterprises/requests');
    var pending = requests.filter(function (r) { return r.status === 'pending'; });

    if (pending.length === 0) {
      document.getElementById('ent-requests').innerHTML = '<p style="color:var(--text-secondary)">' + t('enterprise.no_requests') + '</p>';
      return;
    }

    var html = '<div class="member-list">';
    pending.forEach(function (r) {
      var initial = (r.user_name || '?').charAt(0);
      html += '<div class="member-card">' +
        '<div class="member-card-header">' +
          '<div class="member-info" style="display:flex;align-items:center;gap:10px">' +
            '<span class="req-avatar">' + escHtml(initial) + '</span>' +
            '<div>' +
              '<span class="member-name">' + escHtml(r.user_name) + '</span>' +
              '<span class="member-contact">' +
                (r.user_phone ? escHtml(r.user_phone) : '') +
                (r.user_phone && r.user_email ? ' · ' : '') +
                (r.user_email ? escHtml(r.user_email) : '') +
              '</span>' +
              (r.message ? '<span class="member-contact" style="font-style:italic">' + t('enterprise.request_message') + ' ' + escHtml(r.message) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="member-actions" style="display:flex;align-items:center;gap:8px">' +
            '<span class="member-contact">' + escHtml(r.created_at) + '</span>' +
            '<button class="btn btn-sm btn-primary btn-approve-req" data-req-id="' + r.id + '">' + t('enterprise.approve') + '</button>' +
            '<button class="btn btn-sm btn-danger btn-reject-req" data-req-id="' + r.id + '">' + t('enterprise.reject') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    document.getElementById('ent-requests').innerHTML = html;

    document.querySelectorAll('.btn-approve-req').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          await api('/api/auth/enterprises/requests/' + btn.dataset.reqId, {
            method: 'PUT',
            body: { status: 'approved' },
          });
          toast(t('enterprise.approved'));
          loadEnterpriseRequests();
          loadEnterpriseMembers();
        } catch (err) {
          toast(err.message || t('enterprise.operation_failed'), 'error');
        }
      });
    });

    document.querySelectorAll('.btn-reject-req').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          await api('/api/auth/enterprises/requests/' + btn.dataset.reqId, {
            method: 'PUT',
            body: { status: 'rejected' },
          });
          toast(t('enterprise.rejected'));
          loadEnterpriseRequests();
        } catch (err) {
          toast(err.message || t('enterprise.operation_failed'), 'error');
        }
      });
    });
  } catch (err) {
    document.getElementById('ent-requests').innerHTML = '<p style="color:var(--text-secondary)">' + t('enterprise.requests_load_failed') + '</p>';
  }
}

async function loadInvitations() {
  try {
    var invitations = await api('/api/auth/enterprises/invitations');
    var container = document.getElementById('ent-invitations');
    if (!container) return;

    if (invitations.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);font-size:13px">' + t('enterprise.no_invites') + '</p>';
      return;
    }

    var html = '<div class="invitation-list" style="margin-top:12px">';
    invitations.forEach(function (inv) {
      html += '<div class="invitation-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px">' +
        '<div>' +
          '<span style="font-weight:500">' + escHtml(inv.name || inv.email) + '</span>' +
          (inv.name ? '<span style="color:var(--text-secondary);margin-left:8px;font-size:13px">' + escHtml(inv.email) + '</span>' : '') +
          '<span style="color:var(--text-secondary);margin-left:8px;font-size:12px">' + t('status.pending_register') + '</span>' +
        '</div>' +
        '<button class="btn btn-sm btn-outline btn-cancel-invite" data-invite-id="' + inv.id + '" style="font-size:12px">' + t('common.cancel') + '</button>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Bind cancel buttons
    container.querySelectorAll('.btn-cancel-invite').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          await api('/api/auth/enterprises/invitations/' + btn.dataset.inviteId, { method: 'DELETE' });
          toast(t('enterprise.invite_cancelled'));
          loadInvitations();
        } catch (err) {
          toast(err.message || t('enterprise.operation_failed'), 'error');
        }
      });
    });
  } catch (err) {
    var container = document.getElementById('ent-invitations');
    if (container) container.innerHTML = '';
  }
}

// ============================================================
// THEME OPTIONS (used in enterprise page)
// ============================================================
var THEME_OPTIONS = [];

// Refresh THEME_OPTIONS at render time when t() is available
function getThemeOptions() {
  return [
    { id: '',                label: t('theme.default'),       color: '#3B7DDD' },
    { id: 'classic-orange',  label: t('theme.classic_orange'),color: '#F09030' },
    { id: 'warm-grey',       label: t('theme.warm_gray'),     color: '#78716C' },
    { id: 'cool-grey',       label: t('theme.cool_gray'),     color: '#6B7280' },
    { id: 'sage',            label: t('theme.sage'),          color: '#6B8E6B' },
    { id: 'dusty-rose',      label: t('theme.rose'),          color: '#B07D8E' },
    { id: 'soft-teal',       label: t('theme.teal'),          color: '#5F9EA0' },
    { id: 'lavender',        label: t('theme.lavender'),      color: '#8B7FB5' },
    { id: 'ocean',           label: t('theme.ocean'),         color: '#4682B4' },
    { id: 'forest',          label: t('theme.forest'),        color: '#5C8A5C' },
    { id: 'sunset',          label: t('theme.sunset'),        color: '#E86830' },
    { id: 'midnight',        label: t('theme.midnight'),      color: '#4A4A8A' },
    { id: 'golden',          label: t('theme.golden'),        color: '#C8A030' },
    { id: 'coral',           label: t('theme.coral'),         color: '#E07060' },
  ];
}

// loadSettings removed — functionality merged into loadEnterprise

// ============================================================
// ACCOUNT PAGE
// ============================================================
window.loadAccount = async function loadAccount() {
  var container = document.getElementById('page-account');
  if (!container) return;

  var user = state.user || {};
  var avatarSrc = user.avatar || '';
  var avatarPreview = avatarSrc
    ? '<img src="' + escHtml(avatarSrc) + '" class="avatar-preview-img" id="avatar-img">'
    : '<div class="avatar-preview-placeholder" id="avatar-img">' + escHtml((user.name || '?').charAt(0)) + '</div>';

  var html =
    '<div class="page-header"><h2>' + t('account.title') + '</h2></div>' +
    '<div class="section-card card mb-3">' +
      '<h3>' + t('account.personal_info') + '</h3>' +
      '<div class="avatar-upload-section">' +
        '<div class="avatar-preview" id="avatar-preview">' + avatarPreview + '</div>' +
        '<div class="avatar-upload-info">' +
          '<button class="btn btn-outline btn-sm" id="btn-upload-avatar">' + t('account.upload_avatar') + '</button>' +
          '<input type="file" id="avatar-file-input" accept="image/*" style="display:none">' +
          '<div class="avatar-hint">' + t('account.avatar_hint') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('common.name') + '</label>' +
        '<input type="text" id="acc-name" class="text-input form-control" value="' + escHtml(user.name || '') + '">' +
      '</div>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('common.phone') + '</label>' +
        '<input type="text" id="acc-phone" class="text-input form-control" value="' + escHtml(user.phone || '') + '" placeholder="' + t('status.not_linked') + '">' +
      '</div>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('common.email') + '</label>' +
        '<input type="email" id="acc-email" class="text-input form-control" value="' + escHtml(user.email || '') + '" placeholder="' + t('status.not_linked') + '">' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-save-profile">' + t('common.save') + '</button>' +
    '</div>' +
    '<div class="section-card card mb-3">' +
      '<h3>' + t('account.change_pwd') + '</h3>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('account.current_pwd') + '</label>' +
        '<input type="password" id="acc-old-pw" class="text-input form-control">' +
      '</div>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('account.new_pwd') + '</label>' +
        '<input type="password" id="acc-new-pw" class="text-input form-control">' +
      '</div>' +
      '<div class="form-group mb-3">' +
        '<label>' + t('account.confirm_pwd') + '</label>' +
        '<input type="password" id="acc-confirm-pw" class="text-input form-control">' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-change-pw">' + t('account.change_pwd') + '</button>' +
    '</div>' +
    '<div class="section-card card mb-3">' +
      '<h3>' + t('logout.title') + '</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">' + t('logout.desc') + '</p>' +
      '<button class="btn btn-danger" id="btn-logout-account">' + t('logout.btn') + '</button>' +
    '</div>';

  container.innerHTML = html;

  // Avatar upload
  var uploadBtn = document.getElementById('btn-upload-avatar');
  var fileInput = document.getElementById('avatar-file-input');

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast('选择的头像图片大小不能超过 3MB', 'error');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast(t('account.select_image'), 'error');
      return;
    }
    compressAndUploadAvatar(file);
  });

  // Save profile
  document.getElementById('btn-save-profile').addEventListener('click', async function () {
    var name = document.getElementById('acc-name').value.trim();
    var phone = document.getElementById('acc-phone').value.trim();
    var email = document.getElementById('acc-email').value.trim();
    if (!name) { toast(t('account.enter_name'), 'error'); return; }
    try {
      await api('/api/auth/profile', {
        method: 'PUT',
        body: { name: name, phone: phone, email: email },
      });
      toast(t('account.info_updated'));
      state.user.name = name;
      state.user.phone = phone;
      state.user.email = email;
      // Refresh sidebar user info
      updateSidebarUserInfo();
    } catch (err) {
      toast(err.message || t('common.save_failed'), 'error');
    }
  });

  // Change password
  document.getElementById('btn-change-pw').addEventListener('click', async function () {
    var oldPw = document.getElementById('acc-old-pw').value;
    var newPw = document.getElementById('acc-new-pw').value;
    var confirmPw = document.getElementById('acc-confirm-pw').value;
    if (!oldPw || !newPw || !confirmPw) { toast(t('account.pwd_all_fields'), 'error'); return; }
    if (newPw !== confirmPw) { toast(t('account.pwd_mismatch'), 'error'); return; }
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: { old_password: oldPw, new_password: newPw },
      });
      toast(t('account.pwd_changed'));
      document.getElementById('acc-old-pw').value = '';
      document.getElementById('acc-new-pw').value = '';
      document.getElementById('acc-confirm-pw').value = '';
    } catch (err) {
      toast(err.message || t('account.pwd_failed'), 'error');
    }
  });

  // Logout button on account page
  document.getElementById('btn-logout-account').addEventListener('click', async function () {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    clearToken();
    window.state.user = null;
    window.location.href = '/';
  });
};

/* Compress image on canvas and upload */
function compressAndUploadAvatar(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      var maxSize = 500; // max dimension px
      var w = img.width;
      var h = img.height;
 
      // Scale down
      if (w > h) {
        if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
      } else {
        if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
      }
 
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
 
      // Try WebP first, fall back to JPEG if not supported
      var mimeType = 'image/webp';
      var testUrl = canvas.toDataURL('image/webp');
      if (!testUrl.startsWith('data:image/webp')) {
        mimeType = 'image/jpeg';
      }

      // Try compressing at decreasing quality until under 500KB
      var quality = 0.9;
      var dataUrl;
      for (var q = quality; q >= 0.2; q -= 0.1) {
        dataUrl = canvas.toDataURL(mimeType, q);
        var base64Part = dataUrl.split(',')[1];
        var sizeKB = base64Part ? (base64Part.length * 0.75 / 1024) : 0;
        if (sizeKB <= 500) break;
      }
 
      // Update preview immediately
      var previewEl = document.getElementById('avatar-preview');
      if (previewEl) {
        previewEl.innerHTML = '<img src="' + dataUrl + '" class="avatar-preview-img" id="avatar-img">';
      }
 
      // Upload to server
      uploadAvatarData(dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function uploadAvatarData(dataUrl) {
  try {
    var result = await api('/api/auth/avatar', {
      method: 'PUT',
      body: { avatar_data: dataUrl }
    });
    state.user.avatar = result.avatar;
    toast(t('account.avatar_updated'));
    updateSidebarUserInfo();
  } catch (err) {
    toast(err.message || t('account.avatar_failed'), 'error');
  }
}

window.updateSidebarUserInfo = function updateSidebarUserInfo() {
  var user = state.user || {};
  var userInfo = document.getElementById('user-info');
  if (!userInfo) return;
  var avatarHtml = '';
  if (user.avatar) {
    avatarHtml = '<img src="' + escHtml(user.avatar) + '" class="sidebar-avatar">';
  } else {
    avatarHtml = '<span class="sidebar-avatar-text">' + escHtml((user.name || '?').charAt(0)) + '</span>';
  }
  userInfo.innerHTML =
    '<div class="sidebar-user-row">' +
      avatarHtml +
      '<div>' +
        '<div class="user-name">' + escHtml(user.name || '') + '</div>' +
        '<div class="user-role">' + escHtml(user.role || '') + '</div>' +
      '</div>' +
    '</div>';
}
