/**
 * Minimal .env loader - no external dependency.
 *
 * Secrets (SMTP, WeCom, watchdog credentials) must not live in the repository,
 * so production supplies them via a gitignored `.env` next to the app. Values
 * already present in the real environment always take precedence, which keeps
 * PM2/systemd-supplied variables authoritative.
 */
/**
 * Minimal .env loader - no external dependency.
 *
 * Secrets (SMTP, WeCom, watchdog credentials) must not live in the repository,
 * so production supplies them via a gitignored `.env` next to the app. Values
 * already present in the real environment always take precedence, which keeps
 * PM2/systemd-supplied variables authoritative.
 */
const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comment on unquoted values.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function loadEnv(file) {
  const target = file || process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (_) {
    return {}; // No .env is fine — environment-only configuration.
  }
  const parsed = parse(text);
  for (const key of Object.keys(parsed)) {
    if (process.env[key] === undefined) process.env[key] = parsed[key];
  }
  return parsed;
}

module.exports = loadEnv;
module.exports.loadEnv = loadEnv;
module.exports.parse = parse;
module.exports.default = loadEnv;
