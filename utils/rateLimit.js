/**
 * Lightweight in-memory rate limiter (no external deps).
 * Suitable for single-process PM2 fork mode.
 */

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 20;
  const message = options.message || '请求过于频繁，请稍后再试';
  const keyFn = options.keyFn || ((req) => req.ip || req.connection?.remoteAddress || 'unknown');
  const hits = new Map();

  // Periodic cleanup to avoid unbounded growth
  const cleanupEvery = Math.max(windowMs, 60 * 1000);
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  }, cleanupEvery).unref?.();

  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - entry.start)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimiter };
