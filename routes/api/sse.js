/**
 * sse.js routes
 */
const express = require('express');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// ===== SSE Endpoint =====
router.get('/sse', (req, res) => {
  const user = req.user;
  if (!user || !user.enterprise_id) {
    return res.status(401).json({ error: '未授权' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Disable nginx buffering for SSE
  });
  res.write(':ok\n\n'); // initial comment to flush headers

  sseAddClient(user.enterprise_id, user.id, res);

  // Heartbeat every 30s to keep connection alive through proxies
  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); }
  }, 30000);

  req.on('close', () => clearInterval(hb));
});

};
