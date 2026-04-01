// 中国法定节假日数据 (auto-generated)
// Last updated: 2026-03-31
// type: 'holiday' = 放假, 'workday' = 调休上班

const holidays = {

  // ===== 2025 =====
  '2025-01-01': { name: '元旦', type: 'holiday' },
  '2025-01-26': { name: '春节前补班调休', type: 'workday' },
  '2025-01-28': { name: '除夕', type: 'holiday' },
  '2025-01-29': { name: '初一', type: 'holiday' },
  '2025-01-30': { name: '初二', type: 'holiday' },
  '2025-01-31': { name: '初三', type: 'holiday' },
  '2025-02-01': { name: '初四', type: 'holiday' },
  '2025-02-02': { name: '初五', type: 'holiday' },
  '2025-02-03': { name: '初六', type: 'holiday' },
  '2025-02-04': { name: '初七', type: 'holiday' },
  '2025-02-08': { name: '春节后补班调休', type: 'workday' },
  '2025-04-04': { name: '清明节', type: 'holiday' },
  '2025-04-05': { name: '清明节', type: 'holiday' },
  '2025-04-06': { name: '清明节', type: 'holiday' },
  '2025-04-27': { name: '劳动节前补班调休', type: 'workday' },
  '2025-05-01': { name: '劳动节', type: 'holiday' },
  '2025-05-02': { name: '劳动节', type: 'holiday' },
  '2025-05-03': { name: '劳动节', type: 'holiday' },
  '2025-05-04': { name: '劳动节', type: 'holiday' },
  '2025-05-05': { name: '劳动节', type: 'holiday' },
  '2025-05-31': { name: '端午节', type: 'holiday' },
  '2025-06-01': { name: '端午节', type: 'holiday' },
  '2025-06-02': { name: '端午节', type: 'holiday' },
  '2025-09-28': { name: '国庆节前补班调休', type: 'workday' },
  '2025-10-01': { name: '国庆节', type: 'holiday' },
  '2025-10-02': { name: '国庆节', type: 'holiday' },
  '2025-10-03': { name: '国庆节', type: 'holiday' },
  '2025-10-04': { name: '国庆节', type: 'holiday' },
  '2025-10-05': { name: '国庆节', type: 'holiday' },
  '2025-10-06': { name: '中秋节', type: 'holiday' },
  '2025-10-07': { name: '国庆节', type: 'holiday' },
  '2025-10-08': { name: '国庆节', type: 'holiday' },
  '2025-10-11': { name: '国庆节后补班调休', type: 'workday' },

  // ===== 2026 =====
  '2026-01-01': { name: '元旦', type: 'holiday' },
  '2026-01-02': { name: '元旦', type: 'holiday' },
  '2026-01-03': { name: '元旦', type: 'holiday' },
  '2026-01-04': { name: '元旦后补班调休', type: 'workday' },
  '2026-02-14': { name: '春节前补班调休', type: 'workday' },
  '2026-02-15': { name: '春节', type: 'holiday' },
  '2026-02-16': { name: '除夕', type: 'holiday' },
  '2026-02-17': { name: '初一', type: 'holiday' },
  '2026-02-18': { name: '初二', type: 'holiday' },
  '2026-02-19': { name: '初三', type: 'holiday' },
  '2026-02-20': { name: '初四', type: 'holiday' },
  '2026-02-21': { name: '初五', type: 'holiday' },
  '2026-02-22': { name: '初六', type: 'holiday' },
  '2026-02-23': { name: '初七', type: 'holiday' },
  '2026-02-28': { name: '春节后补班调休', type: 'workday' },
  '2026-04-04': { name: '清明节', type: 'holiday' },
  '2026-04-05': { name: '清明节', type: 'holiday' },
  '2026-04-06': { name: '清明节', type: 'holiday' },
  '2026-05-01': { name: '劳动节', type: 'holiday' },
  '2026-05-02': { name: '劳动节', type: 'holiday' },
  '2026-05-03': { name: '劳动节', type: 'holiday' },
  '2026-05-04': { name: '劳动节', type: 'holiday' },
  '2026-05-05': { name: '劳动节', type: 'holiday' },
  '2026-05-09': { name: '劳动节后补班调休', type: 'workday' },
  '2026-06-19': { name: '端午节', type: 'holiday' },
  '2026-06-20': { name: '端午节', type: 'holiday' },
  '2026-06-21': { name: '端午节', type: 'holiday' },
  '2026-09-20': { name: '中秋节前补班调休', type: 'workday' },
  '2026-09-25': { name: '中秋节', type: 'holiday' },
  '2026-09-26': { name: '中秋节', type: 'holiday' },
  '2026-09-27': { name: '中秋节', type: 'holiday' },
  '2026-10-01': { name: '国庆节', type: 'holiday' },
  '2026-10-02': { name: '国庆节', type: 'holiday' },
  '2026-10-03': { name: '国庆节', type: 'holiday' },
  '2026-10-04': { name: '国庆节', type: 'holiday' },
  '2026-10-05': { name: '国庆节', type: 'holiday' },
  '2026-10-06': { name: '国庆节', type: 'holiday' },
  '2026-10-07': { name: '国庆节', type: 'holiday' },
  '2026-10-10': { name: '国庆节后补班调休', type: 'workday' },
};

function getHoliday(dateStr) {
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
