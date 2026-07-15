/**
 * Audit log routes (admin only)
 */
const { listAuditLogs } = require('../../utils/audit');

module.exports = function register(router, ctx) {
  const { db, isAdmin } = ctx;

  // GET /api/audit-logs?limit=50&offset=0&action=&entity_type=
  router.get('/audit-logs', (req, res) => {
    if (!req.user?.enterprise_id) return res.status(400).json({ error: '请先创建或加入企业' });
    if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可查看审计日志' });

    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = listAuditLogs(db, req.user.enterprise_id, {
      limit,
      offset,
      action: req.query.action || undefined,
      entityType: req.query.entity_type || undefined,
    });

    // Parse details JSON when possible
    const data = rows.map(r => {
      let details = r.details;
      try { details = r.details ? JSON.parse(r.details) : null; } catch (_) {}
      return { ...r, details };
    });

    res.json({ rows: data, limit, offset });
  });
};
