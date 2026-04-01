#!/usr/bin/env node
/**
 * update-holidays.js
 * Fetch Chinese public holiday data for next year from timor.tech API
 * and regenerate db/holidays.js
 *
 * Usage:  node scripts/update-holidays.js [year]
 * If year is omitted, fetches next year's data.
 *
 * Designed to run via cron on Dec 15 each year.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const HOLIDAYS_FILE = path.join(__dirname, '..', 'db', 'holidays.js');

/* ---- HTTP GET with redirect support ---- */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'CrewBoard/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/* ---- Fetch holiday data for a given year ---- */
async function fetchYear(year) {
  const url = `https://timor.tech/api/holiday/year/${year}`;
  console.log(`Fetching holidays for ${year} from ${url} ...`);
  const raw = await httpGet(url);
  const json = JSON.parse(raw);

  if (json.code !== 0) {
    throw new Error(`API returned error: ${json.code} - ${json.msg || 'unknown'}`);
  }

  const entries = {};
  const data = json.holiday || {};

  Object.keys(data).forEach((key) => {
    const item = data[key];
    const dateStr = item.date; // YYYY-MM-DD
    const name = item.name;
    const isHoliday = item.holiday; // true = 放假, false = 调休上班

    entries[dateStr] = {
      name: isHoliday ? name : name + '调休',
      type: isHoliday ? 'holiday' : 'workday'
    };
  });

  return entries;
}

/* ---- Generate holidays.js file content ---- */
function generateFile(allEntries) {
  let code = '// 中国法定节假日数据 (auto-generated)\n';
  code += '// Last updated: ' + new Date().toISOString().slice(0, 10) + '\n';
  code += '// type: \'holiday\' = 放假, \'workday\' = 调休上班\n\n';
  code += 'const holidays = {\n';

  const sortedDates = Object.keys(allEntries).sort();
  let currentYear = '';

  sortedDates.forEach((dateStr) => {
    const year = dateStr.slice(0, 4);
    if (year !== currentYear) {
      currentYear = year;
      code += `\n  // ===== ${year} =====\n`;
    }
    const e = allEntries[dateStr];
    code += `  '${dateStr}': { name: '${e.name}', type: '${e.type}' },\n`;
  });

  code += '};\n\n';
  code += `function getHoliday(dateStr) {
  return holidays[dateStr] || null;
}

function isHoliday(dateStr) {
  const h = holidays[dateStr];
  return h && h.type === 'holiday';
}

function isMakeupWorkday(dateStr) {
  const h = holidays[dateStr];
  return h && h.type === 'workday';
}

// Check if a date is a working day (considering holidays and makeup workdays)
function isWorkingDay(dateStr) {
  const h = holidays[dateStr];
  if (h) return h.type === 'workday';
  const d = new Date(dateStr);
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

module.exports = { holidays, getHoliday, isHoliday, isMakeupWorkday, isWorkingDay };
`;

  return code;
}

/* ---- Main ---- */
async function main() {
  const argYear = parseInt(process.argv[2], 10);
  const currentYear = new Date().getFullYear();
  const targetYear = argYear || (currentYear + 1);

  // Always fetch current year + target year to keep both
  const yearsToFetch = [...new Set([currentYear, targetYear])].sort();

  let allEntries = {};

  for (const year of yearsToFetch) {
    try {
      const entries = await fetchYear(year);
      Object.assign(allEntries, entries);
      console.log(`  Got ${Object.keys(entries).length} entries for ${year}`);
    } catch (err) {
      console.error(`  Failed to fetch ${year}: ${err.message}`);
      // If we can't fetch, try to preserve existing data for that year
      try {
        const existing = require(HOLIDAYS_FILE);
        Object.keys(existing.holidays || {}).forEach((dateStr) => {
          if (dateStr.startsWith(String(year))) {
            allEntries[dateStr] = existing.holidays[dateStr];
          }
        });
        console.log(`  Preserved existing data for ${year}`);
      } catch (_) {
        // no existing data either
      }
    }
  }

  if (Object.keys(allEntries).length === 0) {
    console.error('No holiday data obtained. Aborting.');
    process.exit(1);
  }

  const content = generateFile(allEntries);
  fs.writeFileSync(HOLIDAYS_FILE, content, 'utf8');
  console.log(`\nWrote ${Object.keys(allEntries).length} entries to ${HOLIDAYS_FILE}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
