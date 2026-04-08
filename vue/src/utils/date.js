/** Format Date to YYYY-MM-DD */
export function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD string to local Date */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Add N days to a Date, returns new Date */
export function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** Get Monday of the week containing d */
export function getMonday(d) {
  const r = new Date(d)
  const day = r.getDay()
  const diff = day === 0 ? -6 : 1 - day
  r.setDate(r.getDate() + diff)
  r.setHours(0, 0, 0, 0)
  return r
}

/** Get 7 days starting from Monday of the week containing d */
export function getWeekDays(d) {
  const mon = getMonday(d)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

/** Get 28 days (4 weeks) starting from Monday of the week containing d */
export function getMonthViewDays(d) {
  const mon = getMonday(d)
  return Array.from({ length: 28 }, (_, i) => addDays(mon, i))
}

/** Diff in days between two dates (b - a) */
export function diffDays(a, b) {
  return Math.round((b - a) / 86400000)
}

/** Chinese weekday label */
export const CN_DAYS = ['日', '一', '二', '三', '四', '五', '六']

/** Format range label */
export function rangeLabel(days) {
  if (!days || !days.length) return ''
  const s = days[0], e = days[days.length - 1]
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 - ${e.getMonth() + 1}月${e.getDate()}日`
}

/** Quick date range presets */
export function getPresetRange(preset) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const mon = getMonday(today)

  switch (preset) {
    case 'this_week': return { start: fmt(mon), end: fmt(addDays(mon, 6)) }
    case 'last_week': {
      const s = addDays(mon, -7)
      return { start: fmt(s), end: fmt(addDays(s, 6)) }
    }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { start: fmt(s), end: fmt(e) }
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: fmt(s), end: fmt(e) }
    }
    case 'this_quarter': {
      const q = Math.floor(today.getMonth() / 3)
      const s = new Date(today.getFullYear(), q * 3, 1)
      const e = new Date(today.getFullYear(), q * 3 + 3, 0)
      return { start: fmt(s), end: fmt(e) }
    }
    case 'this_year': {
      return {
        start: fmt(new Date(today.getFullYear(), 0, 1)),
        end: fmt(new Date(today.getFullYear(), 11, 31)),
      }
    }
    default: return null
  }
}
