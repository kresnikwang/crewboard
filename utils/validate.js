/**
 * Shared request-input validation helpers.
 *
 * Route handlers use these to reject bad input with a 4xx + localized
 * message instead of letting it reach SQLite, where it surfaces as an
 * unhandled 500 (or silently NULLs out a NOT NULL column on a partial
 * update). See utils/server-i18n.js for the matching message keys.
 */

/** Strict YYYY-MM-DD check that also validates the calendar day. */
function isYmd(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Hours must be a finite number in (0, 24]. Returns null when invalid. */
function parseHours(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return n;
}

/** Optional non-negative finite number (budgets, rates). */
function parseNonNegativeNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** True when `a` is strictly before `b`; both must be valid YYYY-MM-DD. */
function isBefore(a, b) {
  return isYmd(a) && isYmd(b) && a < b;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Coerce a request body value to a trimmed string, or null when unusable.
 * Keeps `undefined` / `null` / non-strings from reaching NOT NULL columns.
 */
function optionalString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

module.exports = {
  isYmd,
  parseHours,
  parseNonNegativeNumber,
  isBefore,
  isNonEmptyString,
  optionalString,
};
