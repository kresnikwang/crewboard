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
      '<div class="page-header"><h2>企业管理</h2></div>' +
      '<div class="enterprise-setup">' +
        '<div class="section-card">' +
          '<h3>创建企业</h3>' +
          '<div class="form-group">' +
            '<label>企业名称</label>' +
            '<input type="text" id="ent-create-name" class="text-input" placeholder="输入企业名称">' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-create-ent">创建企业</button>' +
        '</div>' +
        '<div class="section-card">' +
          '<h3>加入企业</h3>' +
          '<div class="form-group">' +
            '<label>企业邀请码</label>' +
            '<input type="text" id="ent-join-code" class="text-input" placeholder="输入企业邀请码">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>附言（可选）</label>' +
            '<input type="text" id="ent-join-msg" class="text-input" placeholder="简单介绍自己">' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-join-ent">加入企业</button>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-create-ent').addEventListener('click', async function () {
      var name = document.getElementById('ent-create-name').value.trim();
      if (!name) { toast('请输入企业名称', 'error'); return; }
      try {
        await api('/api/auth/enterprises', { method: 'POST', body: { name: name } });
        toast('企业创建成功');
        var me = await api('/api/auth/me');
        state.user = me.user;
        state.enterprise = me.enterprise;
        loadEnterprise();
      } catch (err) {
        toast(err.message || '创建失败', 'error');
      }
    });

    document.getElementById('btn-join-ent').addEventListener('click', async function () {
      var code = document.getElementById('ent-join-code').value.trim();
      if (!code) { toast('请输入企业邀请码', 'error'); return; }
      var message = document.getElementById('ent-join-msg').value.trim();
      try {
        await api('/api/auth/enterprises/join', { method: 'POST', body: { code: code, message: message } });
        toast('申请已提交，请等待管理员审批');
      } catch (err) {
        toast(err.message || '申请失败', 'error');
      }
    });

    return;
  }

  // Has enterprise — show info, requests (if admin/owner), invite
  var ent = state.enterprise || {};
  var html =
    '<div class="page-header"><h2>企业管理</h2></div>' +
    '<div class="section-card">' +
      '<h3>企业信息</h3>' +
      '<div class="info-row"><span class="info-label">企业名称</span><span class="info-value">' + escHtml(ent.name) + '</span></div>' +
      '<div class="info-row"><span class="info-label">邀请码（分享给同事加入）</span><span class="info-value" style="font-family:monospace;font-weight:600">' + escHtml(ent.code) + '</span></div>' +
    '</div>';

  if (isOwnerOrAdmin()) {
    html += '<div class="section-card" id="ent-requests-section"><h3>加入申请</h3><div id="ent-requests">加载中...</div></div>';
  }

  // 成员列表已移至「人员管理」页面统一管理

  if (isOwnerOrAdmin()) {
    html += '<div class="section-card">' +
      '<h3>邀请成员</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:12px">输入邮箱邀请新成员加入企业，对方注册时将自动加入。</p>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>姓名（可选）</label>' +
          '<input type="text" id="invite-name" class="text-input" placeholder="成员姓名">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>邮箱</label>' +
          '<input type="email" id="invite-email" class="text-input" placeholder="成员邮箱地址">' +
        '</div>' +
        '<div class="form-group" style="display:flex;align-items:flex-end">' +
          '<button class="btn btn-primary" id="btn-invite-member">发送邀请</button>' +
        '</div>' +
      '</div>' +
      '<div id="ent-invitations">加载中...</div>' +
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
        if (!email) { toast('请输入邮箱地址', 'error'); return; }
        try {
          var result = await api('/api/auth/enterprises/invite', {
            method: 'POST',
            body: { email: email, name: name }
          });
          toast('邀请已发送');
          document.getElementById('invite-email').value = '';
          document.getElementById('invite-name').value = '';
          loadInvitations();
        } catch (err) {
          toast(err.message || '邀请失败', 'error');
        }
      });
    }
  }

  // Webhook & Theme settings (owner/admin only)
  if (isOwnerOrAdmin()) {
    var currentTheme = ent.theme_color || '';

    var settingsHtml =
      '<div class="section-card">' +
        '<h3>Webhook 通知配置</h3>' +
        '<div class="form-group">' +
          '<label>钉钉 Webhook URL</label>' +
          '<input type="text" id="set-webhook-dingtalk" class="text-input" value="' + escHtml(ent.webhook_dingtalk || '') + '" placeholder="https://oapi.dingtalk.com/robot/send?access_token=...">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>企业微信 Webhook URL</label>' +
          '<input type="text" id="set-webhook-wecom" class="text-input" value="' + escHtml(ent.webhook_wecom || '') + '" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>飞书 Webhook URL</label>' +
          '<input type="text" id="set-webhook-feishu" class="text-input" value="' + escHtml(ent.webhook_feishu || '') + '" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/...">' +
        '</div>' +
      '</div>' +
      '<div class="section-card">' +
        '<h3>企业主题色</h3>' +
        '<div class="theme-palette" id="theme-palette">';

    THEME_OPTIONS.forEach(function (t) {
      var active = t.id === currentTheme ? ' active' : '';
      settingsHtml += '<div class="theme-option" data-theme-id="' + t.id + '">' +
        '<div class="theme-swatch' + active + '" style="background:' + t.color + '">' +
          '<span class="check-icon">\u2713</span>' +
        '</div>' +
        '<div class="theme-label">' + t.label + '</div>' +
      '</div>';
    });

    settingsHtml += '</div>' +
      '<button class="btn btn-primary" id="btn-save-settings" style="margin-top:16px">保存</button>' +
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

    // Save settings button
    document.getElementById('btn-save-settings').addEventListener('click', async function () {
      var payload = {
        name: (state.enterprise && state.enterprise.name) || '',
        webhook_dingtalk: document.getElementById('set-webhook-dingtalk').value.trim(),
        webhook_wecom: document.getElementById('set-webhook-wecom').value.trim(),
        webhook_feishu: document.getElementById('set-webhook-feishu').value.trim(),
        theme_color: selectedTheme,
      };
      try {
        await api('/api/auth/enterprises/settings', { method: 'PUT', body: payload });
        state.enterprise = Object.assign(state.enterprise || {}, payload);
        applyTheme(selectedTheme);
        toast('设置已保存');
      } catch (err) {
        toast(err.message || '保存失败', 'error');
      }
    });
  }
};


async function loadEnterpriseRequests() {
  try {
    var requests = await api('/api/auth/enterprises/requests');
    var pending = requests.filter(function (r) { return r.status === 'pending'; });

    if (pending.length === 0) {
      document.getElementById('ent-requests').innerHTML = '<p style="color:var(--text-secondary)">暂无待处理申请</p>';
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
              (r.message ? '<span class="member-contact" style="font-style:italic">留言: ' + escHtml(r.message) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="member-actions" style="display:flex;align-items:center;gap:8px">' +
            '<span class="member-contact">' + escHtml(r.created_at) + '</span>' +
            '<button class="btn btn-sm btn-primary btn-approve-req" data-req-id="' + r.id + '">批准</button>' +
            '<button class="btn btn-sm btn-danger btn-reject-req" data-req-id="' + r.id + '">拒绝</button>' +
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
          toast('已批准');
          loadEnterpriseRequests();
          loadEnterpriseMembers();
        } catch (err) {
          toast(err.message || '操作失败', 'error');
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
          toast('已拒绝');
          loadEnterpriseRequests();
        } catch (err) {
          toast(err.message || '操作失败', 'error');
        }
      });
    });
  } catch (err) {
    document.getElementById('ent-requests').innerHTML = '<p style="color:var(--text-secondary)">加载申请失败</p>';
  }
}

async function loadInvitations() {
  try {
    var invitations = await api('/api/auth/enterprises/invitations');
    var container = document.getElementById('ent-invitations');
    if (!container) return;

    if (invitations.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);font-size:13px">暂无待处理的邀请</p>';
      return;
    }

    var html = '<div class="invitation-list" style="margin-top:12px">';
    invitations.forEach(function (inv) {
      html += '<div class="invitation-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px">' +
        '<div>' +
          '<span style="font-weight:500">' + escHtml(inv.name || inv.email) + '</span>' +
          (inv.name ? '<span style="color:var(--text-secondary);margin-left:8px;font-size:13px">' + escHtml(inv.email) + '</span>' : '') +
          '<span style="color:var(--text-secondary);margin-left:8px;font-size:12px">\u00b7 待注册</span>' +
        '</div>' +
        '<button class="btn btn-sm btn-outline btn-cancel-invite" data-invite-id="' + inv.id + '" style="font-size:12px">取消</button>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Bind cancel buttons
    container.querySelectorAll('.btn-cancel-invite').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          await api('/api/auth/enterprises/invitations/' + btn.dataset.inviteId, { method: 'DELETE' });
          toast('邀请已取消');
          loadInvitations();
        } catch (err) {
          toast(err.message || '操作失败', 'error');
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
var THEME_OPTIONS = [
  { id: '',            label: '默认',    color: '#4F46E5' },
  { id: 'warm-grey',   label: '暖灰',    color: '#78716C' },
  { id: 'cool-grey',   label: '冷灰',    color: '#6B7280' },
  { id: 'sage',        label: '鼠尾草',  color: '#6B8E6B' },
  { id: 'dusty-rose',  label: '玫瑰粉',  color: '#B07D8E' },
  { id: 'slate-blue',  label: '石板蓝',  color: '#64748B' },
  { id: 'soft-teal',   label: '青绿',    color: '#5F9EA0' },
  { id: 'warm-sand',   label: '暖沙',    color: '#B8A080' },
  { id: 'lavender',    label: '薰衣草',  color: '#8B7FB5' },
  { id: 'ocean',       label: '海洋',    color: '#4682B4' },
  { id: 'forest',      label: '森林',    color: '#5C8A5C' },
  { id: 'clay',        label: '陶土',    color: '#C08060' },
  { id: 'midnight',    label: '午夜',    color: '#4A4A8A' },
];

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
    '<div class="page-header"><h2>账号管理</h2></div>' +
    '<div class="section-card">' +
      '<h3>个人信息</h3>' +
      '<div class="avatar-upload-section">' +
        '<div class="avatar-preview" id="avatar-preview">' + avatarPreview + '</div>' +
        '<div class="avatar-upload-info">' +
          '<button class="btn btn-outline btn-sm" id="btn-upload-avatar">上传头像</button>' +
          '<input type="file" id="avatar-file-input" accept="image/*" style="display:none">' +
          '<div class="avatar-hint">支持 JPG/PNG/WebP，自动压缩至 500KB 以内</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>姓名</label>' +
        '<input type="text" id="acc-name" class="text-input" value="' + escHtml(user.name || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>手机</label>' +
        '<input type="text" id="acc-phone" class="text-input" value="' + escHtml(user.phone || '') + '" placeholder="未绑定">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>邮箱</label>' +
        '<input type="email" id="acc-email" class="text-input" value="' + escHtml(user.email || '') + '" placeholder="未绑定">' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-save-profile">保存</button>' +
    '</div>' +
    '<div class="section-card">' +
      '<h3>修改密码</h3>' +
      '<div class="form-group">' +
        '<label>当前密码</label>' +
        '<input type="password" id="acc-old-pw" class="text-input">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>新密码</label>' +
        '<input type="password" id="acc-new-pw" class="text-input">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>确认新密码</label>' +
        '<input type="password" id="acc-confirm-pw" class="text-input">' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-change-pw">修改密码</button>' +
    '</div>' +
    '<div class="section-card">' +
      '<h3>退出登录</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">退出当前账号，返回登录页面。</p>' +
      '<button class="btn btn-danger" id="btn-logout-account">退出登录</button>' +
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
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error');
      return;
    }
    compressAndUploadAvatar(file);
  });

  // Save profile
  document.getElementById('btn-save-profile').addEventListener('click', async function () {
    var name = document.getElementById('acc-name').value.trim();
    var phone = document.getElementById('acc-phone').value.trim();
    var email = document.getElementById('acc-email').value.trim();
    if (!name) { toast('请输入姓名', 'error'); return; }
    try {
      await api('/api/auth/profile', {
        method: 'PUT',
        body: { name: name, phone: phone, email: email },
      });
      toast('个人信息已更新');
      state.user.name = name;
      state.user.phone = phone;
      state.user.email = email;
      // Refresh sidebar user info
      updateSidebarUserInfo();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
    }
  });

  // Change password
  document.getElementById('btn-change-pw').addEventListener('click', async function () {
    var oldPw = document.getElementById('acc-old-pw').value;
    var newPw = document.getElementById('acc-new-pw').value;
    var confirmPw = document.getElementById('acc-confirm-pw').value;
    if (!oldPw || !newPw || !confirmPw) { toast('请填写所有密码字段', 'error'); return; }
    if (newPw !== confirmPw) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: { old_password: oldPw, new_password: newPw },
      });
      toast('密码修改成功');
      document.getElementById('acc-old-pw').value = '';
      document.getElementById('acc-new-pw').value = '';
      document.getElementById('acc-confirm-pw').value = '';
    } catch (err) {
      toast(err.message || '密码修改失败', 'error');
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
      var maxSize = 400; // max dimension px
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

      // Try JPEG at decreasing quality until under 500KB
      var quality = 0.9;
      var dataUrl;
      for (var q = quality; q >= 0.3; q -= 0.1) {
        dataUrl = canvas.toDataURL('image/jpeg', q);
        // Estimate base64 size: base64 length * 0.75 = bytes
        var sizeKB = (dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75 / 1024;
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
    toast('头像已更新');
    updateSidebarUserInfo();
  } catch (err) {
    toast(err.message || '头像上传失败', 'error');
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
