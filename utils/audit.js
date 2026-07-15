/**
 * Lightweight audit log for CrewBoard write operations.
 */

function ensureAuditTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id INTEGER NOT NULL,
      user_id INTEGER,
      user_name TEXT DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT DEFAULT '',
      entity_id INTEGER,
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_enterprise_created ON audit_logs(enterprise_id, created_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)');
  } catch (_) {}
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} entry
 * @param {number} entry.enterpriseId
 * @param {object} [entry.user]
 * @param {string} entry.action  e.g. booking.create
 * @param {string} [entry.entityType]
 * @param {number|null} [entry.entityId]
 * @param {object|string} [entry.details]
 */
function logAudit(db, entry) {
  if (!db || !entry || !entry.enterpriseId || !entry.action) return;
  try {
    const details =
      entry.details == null
        ? ''
        : typeof entry.details === 'string'
          ? entry.details
          : JSON.stringify(entry.details);
    db.prepare(`
      INSERT INTO audit_logs (enterprise_id, user_id, user_name, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.enterpriseId,
      entry.user?.id || null,
      entry.user?.name || '',
      entry.action,
      entry.entityType || '',
      entry.entityId != null ? entry.entityId : null,
      details
    );
  } catch (e) {
    console.error('[audit] write failed:', e.message);
  }
}

function listAuditLogs(db, enterpriseId, { limit = 50, offset = 0, action, entityType } = {}) {
  let sql = `
    SELECT id, enterprise_id, user_id, user_name, action, entity_type, entity_id, details, created_at
    FROM audit_logs
    WHERE enterprise_id = ?
  `;
  const params = [enterpriseId];
  if (action) {
    sql += ' AND action = ?';
    params.push(action);
  }
  if (entityType) {
    sql += ' AND entity_type = ?';
    params.push(entityType);
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
  return db.prepare(sql).all(...params);
}

module.exports = {
  ensureAuditTable,
  logAudit,
  listAuditLogs,
};
