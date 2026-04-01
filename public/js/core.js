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

// --------------- Toast Notification ---------------
window.toast = function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2500);
};

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
};

// --------------- Auth View Switching ---------------
function showAuthView(view) {
  document.getElementById('view-login').classList.toggle('active', view === 'login');
  document.getElementById('view-register').classList.toggle('active', view === 'register');
  // Clear errors on switch
  var errLogin = document.getElementById('auth-error-login');
  var errReg = document.getElementById('auth-error-register');
  if (errLogin) errLogin.textContent = '';
  if (errReg) errReg.textContent = '';
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
      enterApp();
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
    clearToken();
    window.state.user = null;
    window.state.enterprise = null;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('auth-page').style.display = 'flex';
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
    enterApp();
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
  settings:   () => window.loadSettings   && window.loadSettings(),
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
    p.style.display = p.id === 'page-' + page ? 'block' : 'none';
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

// --------------- Init ---------------
document.addEventListener('DOMContentLoaded', () => {
  initAuthSwitchLinks();
  initLoginHandler();
  initRegisterHandler();
  initLogoutHandler();
  initNavigation();

  // User-info click -> account page
  var userInfoEl = document.getElementById('user-info');
  if (userInfoEl) {
    userInfoEl.addEventListener('click', function () {
      window.loadPage('account');
    });
  }

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
