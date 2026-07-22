/**
 * Unified auth / tenant helpers for CrewBoard.
 * Keep role checks and enterprise isolation in one place.
 */

const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  BASIC: 'basic',
});

function isAdmin(user) {
  return !!user && user.role === ROLES.ADMIN;
}

function isManager(user) {
  return !!user && user.role === ROLES.MANAGER;
}

function isManagerOrAdmin(user) {
  return isAdmin(user) || isManager(user);
}

function parseManagedProjectIds(user) {
  if (!user || !user.managed_project_ids) return [];
  try {
    const ids = JSON.parse(user.managed_project_ids);
    return Array.isArray(ids) ? ids.map(Number).filter(n => !Number.isNaN(n)) : [];
  } catch (_) {
    return [];
  }
}

/** Public enterprise payload — never expose webhook URLs or wecom_secret. */
function publicEnterprise(row, { forAdmin = false } = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    name: row.name,
    code: row.code,
    logo_url: row.logo_url || '',
    currency: row.currency || 'CNY',
    theme_color: row.theme_color || '',
    timezone: row.timezone || 'Asia/Shanghai',
    has_webhook_dingtalk: !!(row.webhook_dingtalk && String(row.webhook_dingtalk).trim()),
    has_webhook_wecom: !!(row.webhook_wecom && String(row.webhook_wecom).trim()),
    has_webhook_feishu: !!(row.webhook_feishu && String(row.webhook_feishu).trim()),
    has_wecom_app: !!(row.wecom_corp_id && row.wecom_agent_id && row.wecom_secret),
  };
  if (!forAdmin) return base;
  // Admin settings form needs non-secret config fields; secrets are write-only
  return {
    ...base,
    webhook_dingtalk: row.webhook_dingtalk || '',
    webhook_wecom: row.webhook_wecom || '',
    webhook_feishu: row.webhook_feishu || '',
    wecom_corp_id: row.wecom_corp_id || '',
    wecom_agent_id: row.wecom_agent_id || '',
    wecom_department_id: row.wecom_department_id || 1,
    // Never return raw secret; empty means "unchanged" on save
    wecom_secret: '',
    wecom_secret_set: !!(row.wecom_secret && String(row.wecom_secret).trim()),
  };
}

const ENTERPRISE_SELECT = `
  SELECT id, name, code, logo_url, webhook_dingtalk, webhook_wecom, webhook_feishu,
         wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id,
         currency, theme_color, timezone
  FROM enterprises WHERE id = ?
`;

function getEnterpriseRow(db, enterpriseId) {
  if (!enterpriseId) return null;
  return db.prepare(ENTERPRISE_SELECT).get(enterpriseId);
}

function createAuthz(db) {
  function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (req.user.status && req.user.status !== 'active') {
      return res.status(403).json({ error: '账号已停用' });
    }
    next();
  }

  function requireEnterprise(req, res, next) {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!req.user.enterprise_id) {
      return res.status(400).json({ error: '请先创建或加入企业' });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可操作' });
    next();
  }

  function requireManager(req, res, next) {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!isManagerOrAdmin(req.user)) {
      return res.status(403).json({ error: '仅经理及以上可操作' });
    }
    next();
  }

  function getResourceInEnterprise(resourceId, enterpriseId) {
    if (!resourceId || !enterpriseId) return null;
    return db.prepare('SELECT * FROM resources WHERE id = ? AND enterprise_id = ?').get(resourceId, enterpriseId);
  }

  function getProjectInEnterprise(projectId, enterpriseId) {
    if (!projectId || !enterpriseId) return null;
    return db.prepare('SELECT * FROM projects WHERE id = ? AND enterprise_id = ?').get(projectId, enterpriseId);
  }

  function getClientInEnterprise(clientId, enterpriseId) {
    if (!clientId || !enterpriseId) return null;
    return db.prepare('SELECT * FROM clients WHERE id = ? AND enterprise_id = ?').get(clientId, enterpriseId);
  }

  function getBookingInEnterprise(bookingId, enterpriseId) {
    if (!bookingId || !enterpriseId) return null;
    return db.prepare(`
      SELECT b.*, r.name as rname, r.enterprise_id
      FROM bookings b
      JOIN resources r ON b.resource_id = r.id
      WHERE b.id = ? AND r.enterprise_id = ?
    `).get(bookingId, enterpriseId);
  }

  function getLeaveInEnterprise(leaveId, enterpriseId) {
    if (!leaveId || !enterpriseId) return null;
    return db.prepare(`
      SELECT l.*, r.enterprise_id
      FROM leave_entries l
      JOIN resources r ON l.resource_id = r.id
      WHERE l.id = ? AND r.enterprise_id = ?
    `).get(leaveId, enterpriseId);
  }

  function getTimesheetInEnterprise(timesheetId, enterpriseId) {
    if (!timesheetId || !enterpriseId) return null;
    return db.prepare(`
      SELECT t.*, r.enterprise_id
      FROM timesheets t
      JOIN resources r ON t.resource_id = r.id
      WHERE t.id = ? AND r.enterprise_id = ?
    `).get(timesheetId, enterpriseId);
  }

  function canEditProject(user, projectId) {
    if (!user) return false;
    if (isAdmin(user)) return true;
    if (isManager(user)) {
      const proj = db.prepare('SELECT created_by, enterprise_id FROM projects WHERE id = ?').get(projectId);
      if (!proj || proj.enterprise_id !== user.enterprise_id) return false;
      if (proj.created_by === user.id) return true;
      return parseManagedProjectIds(user).includes(Number(projectId));
    }
    return false;
  }

  function canBookResource(user) {
    return isManagerOrAdmin(user);
  }

  function canEditBooking(user, booking) {
    if (!user || !booking) return false;
    if (isAdmin(user)) return true;
    if (isManager(user)) {
      if (booking.created_by === user.id) return true;
      return parseManagedProjectIds(user).includes(Number(booking.project_id));
    }
    return false;
  }

  /** basic: only own resource; manager/admin: any resource in enterprise */
  function canAccessResourceAsSelfOrElevated(user, resourceId) {
    if (!user) return false;
    if (isManagerOrAdmin(user)) return true;
    return user.resource_id != null && Number(user.resource_id) === Number(resourceId);
  }

  return {
    requireAuth,
    requireEnterprise,
    requireAdmin,
    requireManager,
    getResourceInEnterprise,
    getProjectInEnterprise,
    getClientInEnterprise,
    getBookingInEnterprise,
    getLeaveInEnterprise,
    getTimesheetInEnterprise,
    canEditProject,
    canBookResource,
    canEditBooking,
    canAccessResourceAsSelfOrElevated,
    isAdmin,
    isManager,
    isManagerOrAdmin,
    parseManagedProjectIds,
  };
}

function authMiddleware(db) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token) {
      const session = db.prepare(
        'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
      ).get(token, new Date().toISOString());
      if (session) {
        req.user = db.prepare(`
          SELECT id, name, phone, email, enterprise_id, resource_id, role, avatar,
                 managed_project_ids, status, must_change_password
          FROM users WHERE id = ?
        `).get(session.user_id);
      }
    }
    next();
  };
}

/** Remove expired sessions and used/expired password-reset tokens. */
function cleanupExpiredAuth(db) {
  // expires_at is stored as ISO-8601 UTC (toISOString); compare with ISO so
  // same-day expiry is honoured (datetime('now') string-compares incorrectly).
  const nowIso = new Date().toISOString();
  const sessions = db.prepare(
    'DELETE FROM sessions WHERE expires_at <= ?'
  ).run(nowIso);
  const tokens = db.prepare(
    'DELETE FROM password_reset_tokens WHERE used = 1 OR expires_at <= ?'
  ).run(nowIso);
  return {
    sessionsDeleted: sessions.changes,
    tokensDeleted: tokens.changes,
  };
}

module.exports = {
  ROLES,
  isAdmin,
  isManager,
  isManagerOrAdmin,
  parseManagedProjectIds,
  publicEnterprise,
  getEnterpriseRow,
  createAuthz,
  authMiddleware,
  cleanupExpiredAuth,
};
