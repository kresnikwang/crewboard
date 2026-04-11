/* ============================================================
   core.js — Resource Guru core module
   Global state, auth, navigation, helpers, UI utilities
   ============================================================ */

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

// --------------- Toast Notification (queued & stacked) ---------------
(function () {
  var container = null;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }
  window.toast = function toast(msg, type) {
    type = type || 'success';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type + ' toast-enter';
    el.textContent = msg;
    var c = getContainer();
    c.appendChild(el);
    // Trigger enter animation
    requestAnimationFrame(function () {
      el.classList.remove('toast-enter');
    });
    // Auto-remove after 2.5s
    setTimeout(function () {
      el.classList.add('toast-exit');
      setTimeout(function () { el.remove(); }, 300);
    }, 2500);
  };
})();

// --------------- Modal ---------------
window.showModal = function showModal(title, bodyHtml, footerHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml || '';
  document.getElementById('modal-footer').innerHTML = footerHtml || '';
  document.getElementById('modal-overlay').style.display = 'flex';
};

window.closeModal = function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
  document.getElementById('modal-footer').innerHTML = '';
  // Clear any drag-selection highlights left on the schedule grid
  if (typeof window._clearDragHighlight === 'function') {
    window._clearDragHighlight();
  }
};

// --------------- Auth View Switching ---------------
function showAuthView(view) {
  document.getElementById('view-login').classList.toggle('active', view === 'login');
  document.getElementById('view-register').classList.toggle('active', view === 'register');
  var firstLogin = document.getElementById('view-first-login');
  if (firstLogin) firstLogin.classList.toggle('active', view === 'first-login');
  // Clear errors on switch
  var errLogin = document.getElementById('auth-error-login');
  var errReg = document.getElementById('auth-error-register');
  var errFirst = document.getElementById('auth-error-first-login');
  if (errLogin) errLogin.textContent = '';
  if (errReg) errReg.textContent = '';
  if (errFirst) errFirst.textContent = '';
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
}

// --------------- Login / Register Handlers ---------------
function showAuthError(msg, view) {
  var id = view === 'register' ? 'auth-error-register' : 'auth-error-login';
  var el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function initLoginHandler() {
  document.getElementById('btn-login').addEventListener('click', async () => {
    showAuthError('', 'login');
    const account = document.getElementById('login-account').value.trim();
    const password = document.getElementById('login-password').value;
    if (!account || !password) {
      showAuthError('请输入账号和密码', 'login');
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
      showAuthError(err.message || '登录失败', 'login');
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
      showAuthError('请填写姓名和密码', 'register');
      return;
    }
    if (!phone && !email) {
      showAuthError('手机号和邮箱请至少填写一项', 'register');
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
      showAuthError(err.message || '注册失败', 'register');
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
  // Resources & Projects pages require manage_resources
  var resNav = document.querySelector('.nav-item[data-page="resources"]');
  var projNav = document.querySelector('.nav-item[data-page="projects"]');
  if (resNav) resNav.style.display = perms.manage_resources ? '' : 'none';
  if (projNav) projNav.style.display = perms.manage_resources ? '' : 'none';
  // Reports page requires view_reports
  var repNav = document.querySelector('.nav-item[data-page="reports"]');
  if (repNav) repNav.style.display = perms.view_reports ? '' : 'none';
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
      '您好，<strong>' + (user.name || '') + '</strong>' +
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
      if (err) err.textContent = '请填写新密码和确认密码';
      return;
    }
    if (newPwd.length < 6) {
      if (err) err.textContent = '密码至少6位';
      return;
    }
    if (newPwd !== confirmPwd) {
      if (err) err.textContent = '两次输入的密码不一致';
      return;
    }
    btn.disabled = true;
    btn.textContent = '设置中...';
    try {
      await api('/api/auth/first-password', {
        method: 'PUT',
        body: { new_password: newPwd },
      });
      // Clear must_change_password flag in local state
      if (window.state.user) window.state.user.must_change_password = 0;
      toast('密码设置成功，欢迎使用神马排班！');
      enterApp();
    } catch (e) {
      if (err) err.textContent = e.message || '设置失败，请重试';
      btn.disabled = false;
      btn.textContent = '确认设置密码';
    }
  });
}

// --------------- Init ---------------
document.addEventListener('DOMContentLoaded', () => {
  initAuthSwitchLinks();
  initLoginHandler();
  initRegisterHandler();
  initLogoutHandler();
  initFirstLoginHandler();
  initNavigation();
  initSidebarUserMenu();

  // Modal close button
  const modalClose = document.getElementById('modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }

  // Close modal on overlay click
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  // Attempt session restore
  restoreSession();
});
