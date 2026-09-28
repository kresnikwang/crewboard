/**
 * Shared helpers for API route modules
 */
const fs = require('fs');
const path = require('path');
const { createAuthz, isAdmin, isManagerOrAdmin } = require('../../utils/authz');

/**
 * Delete a previously uploaded file, but only when the stored path really
 * resolves inside `publicDir`. Avatar/logo URLs come back from the database
 * and were previously joined straight into a path, so a stored
 * '/avatars/../../server.js' would unlink a file outside public/.
 */
function safeUnlinkUnder(publicDir, urlPath) {
  if (!urlPath || typeof urlPath !== 'string') return;
  if (!urlPath.startsWith('/')) return;
  const root = path.resolve(publicDir);
  const target = path.resolve(path.join(root, urlPath));
  // Must stay within publicDir (prefix match on the resolved dir + separator).
  if (target !== root && !target.startsWith(root + path.sep)) return;
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (_) { /* best effort */ }
}

/** Accept only a plain '/avatars/<file>' reference, no traversal segments. */
function isSafeAssetPath(urlPath) {
  if (typeof urlPath !== 'string') return false;
  if (!urlPath.startsWith('/avatars/')) return false;
  return !urlPath.includes('..') && !urlPath.includes('\\');
}

function saveAvatarHelper(avatarData, oldAvatarUrl, prefix = 'resource') {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  if (!avatarData) {
    safeUnlinkUnder(publicDir, oldAvatarUrl);
    return '';
  }
  if (avatarData.startsWith('/avatars/')) {
    // Only pass through references we recognise; otherwise treat it as "no
    // change" rather than persisting an attacker-chosen path.
    return isSafeAssetPath(avatarData) ? avatarData : (oldAvatarUrl || '');
  }
  const match = avatarData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return oldAvatarUrl || '';
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 500 * 1024) {
    return oldAvatarUrl || '';
  }
  const avatarDir = path.join(publicDir, 'avatars');
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }
  safeUnlinkUnder(publicDir, oldAvatarUrl);
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
  safeUnlinkUnder,
  isSafeAssetPath,
  sseAddClient,
  sseBroadcast,
  createApiContext,
  isAdmin,
  isManagerOrAdmin,
};
