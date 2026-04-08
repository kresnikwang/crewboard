<template>
  <div class="month-schedule" ref="containerRef">
    <div class="month-scroll" ref="scrollRef">
      <table class="month-table">
        <thead>
          <!-- Month label row -->
          <tr class="m-month-row">
            <th class="m-res-hd"></th>
            <th
              v-for="ms in monthSpans"
              :key="ms.month + '-' + ms.year"
              :colspan="ms.span"
            >
              <span class="m-month-label">{{ MONTH_NAMES[ms.month] }} {{ ms.year }}</span>
            </th>
          </tr>
          <!-- Day header row -->
          <tr class="m-day-row">
            <th class="m-res-hd">人员</th>
            <th
              v-for="(d, idx) in days"
              :key="fmt(d)"
              :class="dayHeaderClass(d)"
              style="position:relative"
            >
              <span v-if="idx % 7 === 0" class="m-week-label">W{{ getWeekNumber(d) }}</span>
              <span class="m-day-name">{{ DAY_SHORT[d.getDay()] }}</span>
              <span class="m-day-num">{{ d.getDate() }}</span>
              <span v-if="holidayMap[fmt(d)] && holidayMap[fmt(d)].type === 'holiday'" class="m-holiday-dot" :title="holidayMap[fmt(d)].name"></span>
              <span v-else-if="holidayMap[fmt(d)] && holidayMap[fmt(d)].type === 'workday'" class="m-makeup-dot" :title="holidayMap[fmt(d)].name"></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(members, teamName) in teams" :key="teamName">
            <!-- Team divider -->
            <tr class="m-team-row">
              <td class="m-res-cell m-team-label">
                <span class="team-label">{{ teamName }}</span>
              </td>
              <td v-for="d in days" :key="fmt(d)"></td>
            </tr>
            <!-- Resource rows -->
            <tr v-for="r in members" :key="r.id">
              <td class="m-res-cell">
                <div class="m-res-inner">
                  <div class="m-res-avatar" :style="{ background: r.color || '#4F46E5' }">
                    {{ r.name.charAt(0) }}
                  </div>
                  <div>
                    <div class="m-res-name">{{ r.name }}</div>
                    <div class="m-res-role">{{ r.role || '' }}</div>
                  </div>
                </div>
              </td>
              <td
                v-for="d in days"
                :key="fmt(d)"
                :class="dayCellClass(d)"
                :data-resource="r.id"
                :data-date="fmt(d)"
                @mousedown="onCellMouseDown($event, r, d)"
              >
                <!-- Leave block -->
                <div
                  v-if="leaveOnDate(r.id, d)"
                  :class="leaveClass(leaveOnDate(r.id, d))"
                  :data-leave-id="leaveOnDate(r.id, d).id"
                >{{ leaveLabel(leaveOnDate(r.id, d).type).charAt(0) }}</div>

                <!-- Booking blocks -->
                <div
                  v-for="b in bookingsOnDate(r.id, d)"
                  :key="b.id"
                  class="m-booking"
                  :class="{ moving: movingIds.has(b.id), resizing: resizingId === b.id }"
                  :data-booking-id="b.id"
                  :data-resource-id="b.resource_id"
                  :data-date="b.date"
                  :style="bookingStyle(b)"
                  :title="b.hours + 'h ' + b.project_name + (b.client_name ? ' | ' + b.client_name : '')"
                  @mousedown.stop="onBookingMouseDown($event, b)"
                  @click.stop="$emit('edit', b)"
                >
                  <span class="m-booking-hours">{{ b.hours }}h</span>
                  {{ truncate(b.project_name, 25) }}
                  <div
                    class="resize-handle"
                    @mousedown.stop="$emit('resize-start', { event: $event, booking: b })"
                  ></div>
                </div>

                <!-- Resize / move preview overlays -->
                <div v-if="isResizePreview(r.id, d)" class="resize-preview-overlay"></div>
                <div v-if="isResizeShrinkPreview(r.id, d)" class="resize-shrink-overlay"></div>
                <div v-if="isMovePreview(r.id, d)" class="move-preview-overlay"></div>

                <!-- Utilization bar -->
                <div v-if="dailyTotal(r.id, d) > 0 && !isWeekend(d)" class="m-util-bar">
                  <div
                    class="m-util-fill"
                    :class="utilClass(r, d)"
                    :style="{ width: utilPct(r, d) + '%' }"
                  ></div>
                </div>

                <!-- Daily total -->
                <span v-if="dailyTotal(r.id, d) > 0" class="day-total" :class="{ overbooked: dailyTotal(r.id, d) > (r.hours_per_day || 8) }">
                  {{ dailyTotal(r.id, d) }}h
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDragSelect } from '@/composables/useDragSelect'

const props = defineProps({
  days: { type: Array, required: true },
  teams: { type: Object, required: true },
  bookings: { type: Array, default: () => [] },
  leaves: { type: Array, default: () => [] },
  holidayMap: { type: Object, default: () => ({}) },
  resizePreviewCells: { type: Array, default: () => [] },
  resizeShrinkCells: { type: Array, default: () => [] },
  movePreviewCells: { type: Array, default: () => [] },
  movingIds: { type: Set, default: () => new Set() },
  resizingId: { type: Number, default: null },
})

const emit = defineEmits(['create', 'edit', 'resize-start', 'move-start'])

const containerRef = ref(null)
const scrollRef = ref(null)

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const monthSpans = computed(() => {
  const spans = []
  let curMonth = -1, curYear = -1, curSpan = 0
  props.days.forEach(d => {
    const m = d.getMonth(), y = d.getFullYear()
    if (m === curMonth && y === curYear) {
      curSpan++
    } else {
      if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan })
      curMonth = m; curYear = y; curSpan = 1
    }
  })
  if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan })
  return spans
})

function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isToday(d) {
  const t = new Date()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}

function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '\u2026' : str
}

function dayHeaderClass(d) {
  const cls = []
  if (isToday(d)) cls.push('m-today')
  if (isWeekend(d)) cls.push('m-weekend')
  const h = props.holidayMap[fmt(d)]
  if (h && h.type === 'holiday') cls.push('m-holiday')
  if (h && h.type === 'workday') cls.push('m-makeup')
  return cls
}

function dayCellClass(d) {
  const cls = ['m-day-cell']
  if (isWeekend(d)) cls.push('m-weekend')
  return cls
}

function leaveClass(leave) {
  const cls = ['m-leave']
  if (leave.type === 'sick') cls.push('sick')
  else if (leave.type === 'personal') cls.push('personal')
  else if (leave.type === 'holiday') cls.push('holiday')
  return cls
}

function leaveLabel(type) {
  return { vacation: '\u4f11\u5047', sick: '\u75c5\u5047', personal: '\u4e8b\u5047', holiday: '\u6cd5\u5b9a\u5047\u671f', other: '\u8bf7\u5047' }[type] || '\u4f11\u5047'
}

function bookingStyle(b) {
  const bg = (b.project_color || '#6366F1') + '33'
  const fg = b.project_color || '#6366F1'
  return { background: bg, color: fg, borderLeft: `2px solid ${fg}` }
}

function bookingsOnDate(resourceId, d) {
  const dateStr = fmt(d)
  return props.bookings.filter(b => b.resource_id === resourceId && b.date === dateStr)
}

function leaveOnDate(resourceId, d) {
  const dateStr = fmt(d)
  return props.leaves.find(l => l.resource_id === resourceId && l.date === dateStr) || null
}

function dailyTotal(resourceId, d) {
  return bookingsOnDate(resourceId, d).reduce((s, b) => s + (b.hours || 0), 0)
}

function utilPct(r, d) {
  const total = dailyTotal(r.id, d)
  const max = r.hours_per_day || 8
  return Math.min(Math.round((total / max) * 100), 100)
}

function utilClass(r, d) {
  const pct = utilPct(r, d)
  return pct >= 100 ? 'red' : pct >= 75 ? 'yellow' : 'green'
}

function isResizePreview(resourceId, d) {
  const dateStr = fmt(d)
  return props.resizePreviewCells.some(c => c.resourceId === resourceId && c.date === dateStr)
}
function isResizeShrinkPreview(resourceId, d) {
  const dateStr = fmt(d)
  return props.resizeShrinkCells.some(c => c.resourceId === resourceId && c.date === dateStr)
}
function isMovePreview(resourceId, d) {
  const dateStr = fmt(d)
  return props.movePreviewCells.some(c => c.resourceId === resourceId && c.date === dateStr)
}

// Drag select
const { onCellMouseDown: dragSelectMouseDown } = useDragSelect(
  scrollRef,
  (resourceId, startDate, endDate) => emit('create', { resourceId, startDate, endDate })
)

function onCellMouseDown(e, r, d) {
  if (e.target.closest('.m-booking, .m-leave')) return
  dragSelectMouseDown(e, r.id, fmt(d))
}

function onBookingMouseDown(e, b) {
  if (e.target.closest('.resize-handle')) return
  emit('move-start', { event: e, booking: b })
}
</script>

<style scoped>
.resize-preview-overlay {
  position: absolute; inset: 0; background: rgba(79,70,229,.15);
  border: 1px solid rgba(79,70,229,.4); pointer-events: none; z-index: 5;
}
.resize-shrink-overlay {
  position: absolute; inset: 0; background: rgba(239,68,68,.15);
  border: 1px solid rgba(239,68,68,.4); pointer-events: none; z-index: 5;
}
.move-preview-overlay {
  position: absolute; inset: 0; background: rgba(16,185,129,.15);
  border: 1px solid rgba(16,185,129,.4); pointer-events: none; z-index: 5;
}
</style>
