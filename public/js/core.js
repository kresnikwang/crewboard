/* ============================================================
   core.js — Resource Guru core module
   Global state, auth, navigation, helpers, UI utilities
   ============================================================ */

// --------------- Bootstrap 5 可用性检测（阶段1）---------------
// 检测 Bootstrap 是否已成功加载，为后续阶段的组件使用提供安全入口
window.bs = (function() {
  function isAvailable() {
    return typeof window.bootstrap !== 'undefined';
  }

  function version() {
    return isAvailable() ? window.bootstrap.Tooltip.VERSION : null;
  }

  if (isAvailable()) {
    console.log('[Bootstrap] 已成功加载，版本：' + version());
  } else {
    console.warn('[Bootstrap] 未检测到 Bootstrap，请检查 CDN 引入是否正常');
  }

  return {
    isAvailable,
    version,
    // 安全获取 Bootstrap 组件实例（后续阶段使用）
    Modal: function(el, opts) {
      if (!isAvailable()) return null;
      return new window.bootstrap.Modal(el, opts);
    },
    Toast: function(el, opts) {
      if (!isAvailable()) return null;
      return new window.bootstrap.Toast(el, opts);
    },
    Tooltip: function(el, opts) {
      if (!isAvailable()) return null;
      return new window.bootstrap.Tooltip(el, opts);
    },
  };
})();

// --------------- Global State ---------------
window.state = {
  currentPage: 'schedule',
  user: null,
  enterprise: null,
  permissions: { book_others: false, manage_resources: false, view_reports: false },
  scheduleWeekStart: null,
  tsWeekStart: null,
  tsResourceId: null,
  resources: [],
  projects: [],
  clients: [],
};

// --------------- Auth Token ---------------
function getToken() {
  return localStorage.getItem('rg_token');
}

function setToken(token) {
  localStorage.setItem('rg_token', token);
}

function clearToken() {
  localStorage.removeItem('rg_token');
}

// --------------- API Helper ---------------
window.api = async function api(path, opts = {}) {
  const token = getToken();
  const headers = Object.assign({}, opts.headers || {});
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
};

// --------------- SWR-style API Cache ---------------
// Stale-While-Revalidate: return cached data instantly, then refresh in background.
// Usage: const data = await cachedApi('/api/foo?bar=1', { maxAge: 30000 });
// Call  apiCache.invalidate('/api/foo') or apiCache.invalidateAll() to bust cache.
(function () {
  var _cache = {};   // key → { data, timestamp }
  var _inflight = {}; // key → Promise (dedup concurrent requests)
  var DEFAULT_MAX_AGE = 60000; // 1 minute

  /**
   * cachedApi(url, options)
   *   options.maxAge  — ms before data is considered stale (default 60s)
   *   options.swr     — if true (default), return stale data immediately and
   *                     revalidate in background; if false, always await fresh data
   *   options.onRevalidate — callback(freshData) when background refresh completes
   */
  window.cachedApi = async function cachedApi(url, options) {
    options = options || {};
    var maxAge = options.maxAge != null ? options.maxAge : DEFAULT_MAX_AGE;
    var swr = options.swr !== false;
    var entry = _cache[url];
    var now = Date.now();

    // Fresh cache hit — return immediately
    if (entry && (now - entry.timestamp) < maxAge) {
      return entry.data;
    }

    // Stale cache hit — return stale, revalidate in background
    if (swr && entry) {
      _revalidate(url, options.onRevalidate);
      return entry.data;
    }

    // No cache — must fetch
    return _fetchAndCache(url, options.onRevalidate);
  };

  function _fetchAndCache(url, onRevalidate) {
    // Dedup: if already fetching this URL, return same promise
    if (_inflight[url]) return _inflight[url];

    _inflight[url] = api(url).then(function (data) {
      _cache[url] = { data: data, timestamp: Date.now() };
      delete _inflight[url];
      return data;
    }).catch(function (err) {
      delete _inflight[url];
      throw err;
    });
    return _inflight[url];
  }

  function _revalidate(url, onRevalidate) {
    if (_inflight[url]) return; // already revalidating
    _inflight[url] = api(url).then(function (data) {
      _cache[url] = { data: data, timestamp: Date.now() };
      delete _inflight[url];
      if (typeof onRevalidate === 'function') onRevalidate(data);
    }).catch(function () {
      delete _inflight[url];
    });
  }

  window.apiCache = {
    /** Invalidate a specific URL (exact match) */
    invalidate: function (url) { delete _cache[url]; },
    /** Invalidate all URLs matching a prefix */
    invalidatePrefix: function (prefix) {
      Object.keys(_cache).forEach(function (k) {
        if (k.indexOf(prefix) === 0) delete _cache[k];
      });
    },
    /** Invalidate everything */
    invalidateAll: function () { _cache = {}; },
    /** Manually set cache for a URL (useful after mutation) */
    set: function (url, data) {
      _cache[url] = { data: data, timestamp: Date.now() };
    },
    /** Check if URL is cached and fresh */
    has: function (url, maxAge) {
      var entry = _cache[url];
      if (!entry) return false;
      return (Date.now() - entry.timestamp) < (maxAge || DEFAULT_MAX_AGE);
    }
  };
})();

// --------------- SSE (Server-Sent Events) Client ---------------
// Connects to /api/sse for real-time push updates.
// On receiving an event, invalidates relevant cache and re-renders active page.
(function () {
  var _es = null;
  var _retryTimer = null;
  var _retryDelay = 1000;
  var MAX_RETRY = 30000;

  function connect() {
    var token = getToken();
    if (!token) return;
    if (_es) { _es.close(); _es = null; }

    _es = new EventSource('/api/sse?token=' + encodeURIComponent(token));

    _es.onopen = function () {
      _retryDelay = 1000; // reset on successful connect
    };

    _es.addEventListener('schedule-change', function (e) {
      // Invalidate schedule-related caches
      apiCache.invalidatePrefix('/api/schedule-data');
      apiCache.invalidatePrefix('/api/bookings');
      apiCache.invalidatePrefix('/api/resources');

      // Re-render if user is on schedule or timesheets page
      var page = window.state.currentPage;
      if (page === 'schedule' && typeof window.loadSchedule === 'function') {
        window.loadSchedule();
      } else if (page === 'timesheets' && typeof window.loadTimesheets === 'function') {
        window.loadTimesheets();
      } else if (page === 'reports' && typeof window.loadReports === 'function') {
        window.loadReports();
      }
    });

    _es.addEventListener('resource-change', function () {
      apiCache.invalidatePrefix('/api/resources');
      apiCache.invalidatePrefix('/api/schedule-data');
      if (window.state.currentPage === 'resources' && typeof window.loadResources === 'function') {
        window.loadResources();
      }
    });

    _es.addEventListener('project-change', function () {
      apiCache.invalidatePrefix('/api/projects');
      apiCache.invalidatePrefix('/api/schedule-data');
      if (window.state.currentPage === 'projects' && typeof window.loadProjects === 'function') {
        window.loadProjects();
      }
    });

    _es.onerror = function () {
      _es.close();
      _es = null;
      // Exponential backoff reconnect
      if (_retryTimer) clearTimeout(_retryTimer);
      _retryTimer = setTimeout(function () {
        _retryDelay = Math.min(_retryDelay * 2, MAX_RETRY);
        connect();
      }, _retryDelay);
    };
  }

  function disconnect() {
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (_es) { _es.close(); _es = null; }
  }

  window.sseConnect = connect;
  window.sseDisconnect = disconnect;
})();

// --------------- Date Helpers ---------------
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function addDays(date, n) {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

function weekDates(monday) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addDays(monday, i));
  }
  return dates;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortDay(date) {
  return DAY_NAMES[date.getDay()];
}

function fmtDate(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return m + '/' + d;
}

function isToday(date) {
  const now = new Date();
  return fmt(date) === fmt(now);
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

window.getMonday = getMonday;
window.fmt = fmt;
window.addDays = addDays;
window.weekDates = weekDates;
window.shortDay = shortDay;
window.fmtDate = fmtDate;
window.isToday = isToday;
window.isWeekend = isWeekend;

// --------------- Toast Notification (Bootstrap 5 实现) ---------------
// 保留 window.toast(msg, type) 接口不变，内部改用 Bootstrap Toast API
// type: 'success' | 'error' | 'info'
(function () {
  var container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      // 使用 Bootstrap 的 .toast-container 定位类，叠加自定义定位类
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.style.zIndex = '9999';
      document.body.appendChild(container);
    }
    return container;
  }

  // 类型到图标和背景色映射
  var TYPE_MAP = {
    success: { icon: '✓', bg: '#059669', label: 'Success' },
    error:   { icon: '✕', bg: '#DC2626', label: 'Error' },
    info:    { icon: 'ℹ', bg: '#3B7DDD', label: 'Info' }
  };

  window.toast = function toast(msg, type) {
    type = type || 'success';
    var meta = TYPE_MAP[type] || TYPE_MAP.success;

    // 创建 Bootstrap Toast 结构
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML =
      '<div class="toast-body d-flex align-items-center gap-2">' +
        '<span class="toast-icon" aria-hidden="true">' + meta.icon + '</span>' +
        '<span class="toast-msg">' + msg + '</span>' +
      '</div>';

    var c = getContainer();
    c.appendChild(el);

    if (window.bs && window.bs.isAvailable()) {
      // 使用 Bootstrap Toast API
      var bsToast = new window.bootstrap.Toast(el, {
        autohide: true,
        delay: 2500
      });
      el.addEventListener('hidden.bs.toast', function () {
        el.remove();
      });
      bsToast.show();
    } else {
      // 降级处理：手动动画
      requestAnimationFrame(function () {
        el.classList.add('show');
      });
      setTimeout(function () {
        el.classList.remove('show');
        setTimeout(function () { el.remove(); }, 300);
      }, 2500);
    }
  };
})();

// --------------- Modal (Bootstrap 5 实现) ---------------
// 全局单例：在页面生命周期内复用同一个 Bootstrap Modal 实例
var _bsModalInstance = null;

function _getModalInstance() {
  var el = document.getElementById('modal-overlay');
  if (!el) return null;
  if (window.bs && window.bs.isAvailable()) {
    // 获取已有实例或创建新实例
    _bsModalInstance = window.bootstrap.Modal.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true
    });
    return _bsModalInstance;
  }
  return null;
}

window.showModal = function showModal(title, bodyHtml, footerHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml || '';
  document.getElementById('modal-footer').innerHTML = footerHtml || '';

  var instance = _getModalInstance();
  if (instance) {
    instance.show();
  } else {
    // 降级处理：若 Bootstrap 未加载，回退到旧实现
    var overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.classList.add('show');
    }
  }
};

window.closeModal = function closeModal() {
  var instance = _getModalInstance();
  if (instance) {
    instance.hide();
  } else {
    var overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('show');
    }
  }

  // 延迟清除内容（等待 Bootstrap 关闭动画完成）
  setTimeout(function() {
    var body = document.getElementById('modal-body');
    var footer = document.getElementById('modal-footer');
    if (body) body.innerHTML = '';
    if (footer) footer.innerHTML = '';
  }, 300);

  // Clear any drag-selection highlights left on the schedule grid
  if (typeof window._clearDragHighlight === 'function') {
    window._clearDragHighlight();
  }
};

// 监听 Bootstrap Modal 的 hidden 事件，确保内容清空在动画结束后执行
document.addEventListener('DOMContentLoaded', function() {
  var el = document.getElementById('modal-overlay');
  if (el) {
    el.addEventListener('hidden.bs.modal', function() {
      var body = document.getElementById('modal-body');
      var footer = document.getElementById('modal-footer');
      if (body) body.innerHTML = '';
      if (footer) footer.innerHTML = '';
      if (typeof window._clearDragHighlight === 'function') {
        window._clearDragHighlight();
      }
      // 安全废除：确保没有残留的 backdrop 元素阔塞点击
      // Bootstrap 正常情况下会自动清除，这里仅作保险
      document.querySelectorAll('.modal-backdrop').forEach(function(el) {
        el.remove();
      });
      // 确保 body 上的 modal-open 类被移除
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    });
  }
});

// --------------- Auth View Switching ---------------
function showAuthView(view) {
  document.getElementById('view-login').classList.toggle('active', view === 'login');
  document.getElementById('view-register').classList.toggle('active', view === 'register');
  var firstLogin = document.getElementById('view-first-login');
  if (firstLogin) firstLogin.classList.toggle('active', view === 'first-login');
  var forgotPw = document.getElementById('view-forgot-password');
  if (forgotPw) forgotPw.classList.toggle('active', view === 'forgot-password');
  var resetPw = document.getElementById('view-reset-password');
  if (resetPw) resetPw.classList.toggle('active', view === 'reset-password');
  // Clear errors on switch
  var errLogin = document.getElementById('auth-error-login');
  var errReg = document.getElementById('auth-error-register');
  var errFirst = document.getElementById('auth-error-first-login');
  var errForgot = document.getElementById('auth-error-forgot');
  var errReset = document.getElementById('auth-error-reset');
  var successForgot = document.getElementById('auth-success-forgot');
  if (errLogin) errLogin.textContent = '';
  if (errReg) errReg.textContent = '';
  if (errFirst) errFirst.textContent = '';
  if (errForgot) errForgot.textContent = '';
  if (errReset) errReset.textContent = '';
  if (successForgot) { successForgot.textContent = ''; successForgot.style.display = 'none'; }
}

function initAuthSwitchLinks() {
  var toReg = document.getElementById('link-to-register');
  var toLogin = document.getElementById('link-to-login');
  if (toReg) {
    toReg.addEventListener('click', function (e) {
      e.preventDefault();
      showAuthView('register');
    });
  }
  if (toLogin) {
    toLogin.addEventListener('click', function (e) {
      e.preventDefault();
      showAuthView('login');
    });
  }
  // Forgot password links
  var forgotLink = document.getElementById('link-forgot-password');
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      showAuthView('forgot-password');
    });
  }
  var forgotToLogin = document.getElementById('link-forgot-to-login');
  if (forgotToLogin) {
    forgotToLogin.addEventListener('click', function (e) {
      e.preventDefault();
      showAuthView('login');
    });
  }
  var resetToLogin = document.getElementById('link-reset-to-login');
  if (resetToLogin) {
    resetToLogin.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.hash = '';
      showAuthView('login');
    });
  }
}

// --------------- Login / Register Handlers ---------------
function showAuthError(msg, view) {
  var idMap = {
    login: 'auth-error-login',
    register: 'auth-error-register',
    'first-login': 'auth-error-first-login',
    forgot: 'auth-error-forgot',
    reset: 'auth-error-reset'
  };
  var id = idMap[view] || 'auth-error-login';
  var el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function initLoginHandler() {
  document.getElementById('btn-login').addEventListener('click', async () => {
    showAuthError('', 'login');
    const account = document.getElementById('login-account').value.trim();
    const password = document.getElementById('login-password').value;
    if (!account || !password) {
      showAuthError(t('auth.err_empty_login'), 'login');
      return;
    }
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { account, password },
      });
      setToken(data.token);
      window.state.user = data.user;
      window.state.enterprise = data.enterprise;
      if (data.user && data.user.must_change_password) {
        showFirstLoginView(data.user);
      } else {
        enterApp();
      }
    } catch (err) {
      showAuthError(err.message || t('auth.err_login_failed'), 'login');
    }
  });
}

function initRegisterHandler() {
  document.getElementById('btn-register').addEventListener('click', async () => {
    showAuthError('', 'register');
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!name || !password) {
      showAuthError(t('auth.err_empty_register'), 'register');
      return;
    }
    if (!phone && !email) {
      showAuthError(t('auth.err_need_contact'), 'register');
      return;
    }
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { phone, email, password, name },
      });
      setToken(data.token);
      window.state.user = data.user;
      window.state.enterprise = data.enterprise;
      enterApp();
    } catch (err) {
      showAuthError(err.message || t('auth.err_register_failed'), 'register');
    }
  });
}

function initLogoutHandler() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // ignore errors on logout
    }
    if (typeof window.sseDisconnect === 'function') window.sseDisconnect();
    apiCache.invalidateAll();
    clearToken();
    window.state.user = null;
    window.state.enterprise = null;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('auth-page').style.display = 'flex';
  });
}

function initSidebarUserMenu() {
  var userInfo = document.getElementById('user-info');
  var dropdown = document.getElementById('sidebar-dropdown');
  var accountBtn = document.getElementById('btn-account');
  if (!userInfo || !dropdown) return;

  userInfo.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  if (accountBtn) {
    accountBtn.addEventListener('click', function () {
      dropdown.classList.remove('open');
      window.loadPage('account');
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function () {
    dropdown.classList.remove('open');
  });
  dropdown.addEventListener('click', function (e) {
    e.stopPropagation();
  });
}

// --------------- Session Restore ---------------
async function restoreSession() {
  const token = getToken();
  if (!token) return;
  try {
    const data = await api('/api/auth/me');
    window.state.user = data.user;
    window.state.enterprise = data.enterprise;
    if (data.user && data.user.must_change_password) {
      showFirstLoginView(data.user);
    } else {
      enterApp();
    }
  } catch (_) {
    clearToken();
  }
}

// --------------- Navigation ---------------
const PAGE_LOADERS = {
  schedule:   () => window.loadSchedule   && window.loadSchedule(),
  timesheets: () => window.loadTimesheets && window.loadTimesheets(),
  reports:    () => window.loadReports    && window.loadReports(),
  resources:  () => window.loadResources  && window.loadResources(),
  projects:   () => window.loadProjects   && window.loadProjects(),
  enterprise: () => window.loadEnterprise && window.loadEnterprise(),
  account:    () => window.loadAccount    && window.loadAccount(),
};

window.loadPage = function loadPage(page) {
  window.state.currentPage = page;

  // Toggle active nav item
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Toggle visible page
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = p.id === 'page-' + page ? 'flex' : 'none';
  });

  // Call the page loader
  const loader = PAGE_LOADERS[page];
  if (loader) loader();
};

function initNavigation() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      window.loadPage(item.dataset.page);
    });
  });
}

// --------------- Theme ---------------
window.applyTheme = function applyTheme(themeColor) {
  const app = document.getElementById('main-app');
  const classes = Array.from(app.classList);
  classes.forEach(cls => {
    if (cls.startsWith('theme-')) {
      app.classList.remove(cls);
    }
  });
  if (themeColor) {
    app.classList.add('theme-' + themeColor);
  }
};

// --------------- Enter App ---------------
async function enterApp() {
  const { user, enterprise } = window.state;

  // Hide auth, show app
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';

  // Fetch effective permissions
  try {
    window.state.permissions = await api('/api/permissions');
  } catch (_) {
    window.state.permissions = { book_others: false, manage_resources: false, view_reports: false };
  }

  // Update sidebar user info
  if (user) {
    if (typeof window.updateSidebarUserInfo === 'function') {
      window.updateSidebarUserInfo();
    } else {
      const userInfo = document.getElementById('user-info');
      if (userInfo) {
        userInfo.innerHTML =
          '<div class="user-name">' + user.name + '</div>' +
          '<div class="user-role">' + (user.role || '') + '</div>';
      }
    }
  }

  // Update sidebar enterprise info
  const entEl = document.getElementById('sidebar-enterprise');
  if (entEl && enterprise) {
    entEl.innerHTML =
      '<div class="ent-name">' + enterprise.name + '</div>' +
      '<div class="ent-code">' + (enterprise.code || '') + '</div>';
  }

  // Apply theme
  if (enterprise && enterprise.theme_color) {
    applyTheme(enterprise.theme_color);
  }

  // Update nav visibility based on permissions
  updateNavVisibility();

  // If no enterprise, show enterprise setup page
  if (!user.enterprise_id) {
    window.loadPage('enterprise');
  } else {
    window.loadPage('schedule');
  }

  // Connect SSE for real-time updates
  if (typeof window.sseConnect === 'function') window.sseConnect();
}

// Hide nav items the user can't access
function updateNavVisibility() {
  var perms = window.state.permissions;
  // Resources (人员管理) — admin only
  var resNav = document.querySelector('.nav-item[data-page="resources"]');
  if (resNav) resNav.style.display = perms.manage_resources ? '' : 'none';
  // Projects (项目管理) — admin + manager
  var projNav = document.querySelector('.nav-item[data-page="projects"]');
  if (projNav) projNav.style.display = perms.manage_projects ? '' : 'none';
  // Reports — admin + manager
  var repNav = document.querySelector('.nav-item[data-page="reports"]');
  if (repNav) repNav.style.display = perms.view_reports ? '' : 'none';
  // Enterprise (企业管理) — admin only
  var entNav = document.querySelector('.nav-item[data-page="enterprise"]');
  if (entNav) entNav.style.display = perms.can_admin ? '' : 'none';
}

window.enterApp = enterApp;

// --------------- First Login: Force Password Change ---------------
function showFirstLoginView(user) {
  // Show auth page (in case we came from session restore)
  document.getElementById('auth-page').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';

  // Populate user greeting
  var greetEl = document.getElementById('first-login-user');
  if (greetEl && user) {
    greetEl.innerHTML =
      '<div class="first-login-greeting">' +
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="vertical-align:-2px;margin-right:6px">' +
      '<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>' +
      (getLang() === 'zh' ? '您好，' : 'Hello, ') + '<strong>' + (user.name || '') + '</strong>' +
      (user.email ? '<span class="first-login-email"> &lt;' + user.email + '&gt;</span>' : '') +
      '</div>';
  }

  // Clear fields and errors
  var np = document.getElementById('first-new-password');
  var cp = document.getElementById('first-confirm-password');
  var err = document.getElementById('auth-error-first-login');
  if (np) np.value = '';
  if (cp) cp.value = '';
  if (err) err.textContent = '';

  showAuthView('first-login');
}

function initFirstLoginHandler() {
  var btn = document.getElementById('btn-first-password');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var err = document.getElementById('auth-error-first-login');
    if (err) err.textContent = '';
    var newPwd = document.getElementById('first-new-password').value;
    var confirmPwd = document.getElementById('first-confirm-password').value;
    if (!newPwd || !confirmPwd) {
      if (err) err.textContent = t('auth.err_pwd_empty');
      return;
    }
    if (newPwd.length < 6) {
      if (err) err.textContent = t('auth.err_pwd_min');
      return;
    }
    if (newPwd !== confirmPwd) {
      if (err) err.textContent = t('auth.err_pwd_mismatch');
      return;
    }
    btn.disabled = true;
    btn.textContent = t('auth.btn_setting');
    try {
      await api('/api/auth/first-password', {
        method: 'PUT',
        body: { new_password: newPwd },
      });
      // Clear must_change_password flag in local state
      if (window.state.user) window.state.user.must_change_password = 0;
      toast(t('auth.pwd_set_success'));
      enterApp();
    } catch (e) {
      if (err) err.textContent = e.message || t('auth.err_set_pwd_failed');
      btn.disabled = false;
      btn.textContent = t('auth.first_login_btn');
    }
  });
}

// --------------- Init ---------------
// --------------- Forgot Password Handler ---------------
function initForgotPasswordHandler() {
  var btn = document.getElementById('btn-forgot-password');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var errEl = document.getElementById('auth-error-forgot');
    var successEl = document.getElementById('auth-success-forgot');
    if (errEl) errEl.textContent = '';
    if (successEl) { successEl.textContent = ''; successEl.style.display = 'none'; }

    var email = document.getElementById('forgot-email').value.trim();
    if (!email) {
      if (errEl) errEl.textContent = t('auth.err_empty_email');
      return;
    }
    btn.disabled = true;
    btn.textContent = t('auth.btn_sending');
    try {
      var data = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: email }
      });
      if (successEl) {
        successEl.textContent = t('auth.reset_link_sent');
        successEl.style.display = 'block';
      }
      btn.textContent = t('auth.btn_sent');
    } catch (err) {
      if (errEl) errEl.textContent = err.message || t('auth.err_send_failed');
      btn.disabled = false;
      btn.textContent = t('auth.forgot_send_btn');
    }
  });
}

// --------------- Reset Password Handler ---------------
function initResetPasswordHandler() {
  var btn = document.getElementById('btn-reset-password');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var errEl = document.getElementById('auth-error-reset');
    if (errEl) errEl.textContent = '';

    var newPw = document.getElementById('reset-new-password').value;
    var confirmPw = document.getElementById('reset-confirm-password').value;
    if (!newPw || newPw.length < 6) {
      if (errEl) errEl.textContent = t('auth.err_pwd_min');
      return;
    }
    if (newPw !== confirmPw) {
      if (errEl) errEl.textContent = t('auth.err_pwd_mismatch');
      return;
    }

    // Get token from URL hash
    var hash = window.location.hash;
    var match = hash.match(/token=([^&]+)/);
    var token = match ? match[1] : '';
    if (!token) {
      if (errEl) errEl.textContent = t('auth.err_invalid_link');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('auth.btn_resetting');
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: { token: token, new_password: newPw }
      });
      // Show success and redirect to login
      if (errEl) { errEl.style.color = '#10B981'; errEl.textContent = t('auth.reset_success'); }
      window.location.hash = '';
      setTimeout(function () {
        if (errEl) { errEl.style.color = ''; errEl.textContent = ''; }
        showAuthView('login');
      }, 2000);
    } catch (err) {
      if (errEl) errEl.textContent = err.message || t('auth.err_reset_failed');
      btn.disabled = false;
      btn.textContent = t('auth.reset_btn');
    }
  });
}

// --------------- Hash Route Handler ---------------
function handleHashRoute() {
  var hash = window.location.hash;
  // Handle #reset-password?token=xxx
  if (hash.indexOf('#reset-password') === 0) {
    var match = hash.match(/token=([^&]+)/);
    if (match) {
      var token = match[1];
      // Show auth page and reset view
      document.getElementById('auth-page').style.display = 'flex';
      document.getElementById('main-app').style.display = 'none';
      showAuthView('reset-password');
      // Verify token
      api('/api/auth/reset-password/' + token).then(function (data) {
        var hint = document.getElementById('reset-email-hint');
        if (hint && data.email) {
          hint.textContent = t('auth.reset_account') + data.email;
        }
      }).catch(function (err) {
        var errEl = document.getElementById('auth-error-reset');
        if (errEl) errEl.textContent = err.message || t('auth.err_link_expired');
        var btn = document.getElementById('btn-reset-password');
        if (btn) btn.disabled = true;
      });
      return true;
    }
  }
  // Handle #register?invite=xxx&email=xxx
  if (hash.indexOf('#register') === 0) {
    var emailMatch = hash.match(/email=([^&]+)/);
    document.getElementById('auth-page').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
    showAuthView('register');
    if (emailMatch) {
      var emailField = document.getElementById('reg-email');
      if (emailField) emailField.value = decodeURIComponent(emailMatch[1]);
    }
    return true;
  }
  return false;
}

// --------------- Language Toggle ---------------
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setLang(btn.dataset.lang);
    updateLangToggle();
  });
});
function updateLangToggle() {
  const lang = getLang();
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
    b.style.fontWeight = b.dataset.lang === lang ? '600' : '400';
    b.style.opacity = b.dataset.lang === lang ? '1' : '0.6';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthSwitchLinks();
  initLoginHandler();
  initRegisterHandler();
  initLogoutHandler();
  initFirstLoginHandler();
  initForgotPasswordHandler();
  initResetPasswordHandler();
  initNavigation();
  initSidebarUserMenu();

  // --------------- Mobile Sidebar (Hamburger) ---------------
  (function initMobileSidebar() {
    var sidebar    = document.getElementById('sidebar');
    var overlay    = document.getElementById('sidebar-overlay');
    var hamburger  = document.getElementById('hamburger-btn');
    var closeBtn   = document.getElementById('sidebar-close-btn');
    if (!sidebar || !overlay || !hamburger) return;

    function openSidebar() {
      sidebar.classList.add('sidebar-open');
      overlay.classList.add('sidebar-overlay-visible');
      document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
      sidebar.classList.remove('sidebar-open');
      overlay.classList.remove('sidebar-overlay-visible');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

    // Auto-close sidebar when a nav item is clicked on mobile
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });
  })();

  // Bootstrap Modal handles close button via data-bs-dismiss="modal".
  // Also add a manual click listener as a backup for robustness.
  var modalCloseBtn = document.getElementById('modal-close');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', function() {
      window.closeModal();
    });
  }

  // Check hash route first (e.g. #reset-password?token=xxx)
  if (!handleHashRoute()) {
    // Attempt session restore only if no special hash route
    restoreSession();
  }

  // Apply i18n and language toggle
  updateLangToggle();
  applyI18n();
});
