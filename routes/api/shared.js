/**
 * Shared helpers for API route modules
 */
const fs = require('fs');
const path = require('path');
const { createAuthz, isAdmin, isManagerOrAdmin } = require('../../utils/authz');

function saveAvatarHelper(avatarData, oldAvatarUrl, prefix = 'resource') {
  if (!avatarData) {
    if (oldAvatarUrl) {
      const oldPath = path.join(__dirname, '..', '..', 'public', oldAvatarUrl);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }
    return '';
  }
  if (avatarData.startsWith('/avatars/')) {
    return avatarData;
  }
  const match = avatarData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return oldAvatarUrl || '';
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 500 * 1024) {
    return oldAvatarUrl || '';
  }
  const avatarDir = path.join(__dirname, '..', '..', 'public', 'avatars');
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }
  if (oldAvatarUrl) {
    const oldPath = path.join(__dirname, '..', '..', 'public', oldAvatarUrl);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (_) {}
    }
  }
  const filename = `avatar_${prefix}_${Date.now()}.${ext}`;
  const filePath = path.join(avatarDir, filename);
  fs.writeFileSync(filePath, buffer);
  return `/avatars/${filename}`;
}

// SSE Connection Pool — Map<enterpriseId, Set<{res, userId}>>
const _sseClients = new Map();

function sseAddClient(enterpriseId, userId, res) {
  if (!_sseClients.has(enterpriseId)) _sseClients.set(enterpriseId, new Set());
  const client = { res, userId };
  _sseClients.get(enterpriseId).add(client);
  res.on('close', () => {
    const pool = _sseClients.get(enterpriseId);
    if (pool) { pool.delete(client); if (pool.size === 0) _sseClients.delete(enterpriseId); }
  });
}

function sseBroadcast(enterpriseId, event, data, excludeUserId) {
  const pool = _sseClients.get(enterpriseId);
  if (!pool || pool.size === 0) return;
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  pool.forEach(client => {
    if (excludeUserId && client.userId === excludeUserId) return;
    try { client.res.write(payload); } catch (_) { /* dead connection */ }
  });
}

/** Build per-request context shared by all route modules */
function createApiContext(db) {
  const authz = createAuthz(db);
  return {
    db,
    authz,
    isAdmin,
    isManagerOrAdmin,
    saveAvatarHelper,
    sseAddClient,
    sseBroadcast,
  };
}

module.exports = {
  saveAvatarHelper,
  sseAddClient,
  sseBroadcast,
  createApiContext,
  isAdmin,
  isManagerOrAdmin,
};
