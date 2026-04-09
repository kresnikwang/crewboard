<template>
  <div class="month-schedule" ref="containerRef">
    <div class="month-scroll" ref="scrollRef">
      <table class="month-table">
        <thead>
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
          <tr class="m-day-row">
            <th class="m-res-hd">人员</th>
            <th
              v-for="(d, idx) in days"
              :key="fmt(d)"
              :class="dayHeaderClass(d)"
            >
              <span v-if="idx % 7 === 0" class="m-week-label">W{{ getWeekNumber(d) }}</span>
              <span class="m-day-name">{{ DAY_SHORT[d.getDay()] }}</span>
              <span class="m-day-num" :class="{ 'm-today-num': isToday(d) }">{{ d.getDate() }}</span>
              <span v-if="holidayMap[fmt(d)] && holidayMap[fmt(d)].type === 'holiday'" class="m-holiday-dot" :title="holidayMap[fmt(d)].name"></span>
              <span v-else-if="holidayMap[fmt(d)] && holidayMap[fmt(d)].type === 'workday'" class="m-makeup-dot" :title="holidayMap[fmt(d)].name"></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(members, teamName) in teams" :key="teamName">
            <tr class="m-team-row">
              <td class="m-res-cell m-team-label-cell">
                <span class="team-label">{{ teamName }}</span>
              </td>
              <td v-for="d in days" :key="fmt(d)"></td>
            </tr>
            <tr v-for="r in members" :key="r.id">
              <td class="m-res-cell">
                <div class="m-res-inner">
                  <div class="m-res-avatar" :style="{ background: r.color || '#4F46E5' }">
                    {{ r.name.charAt(0) }}
                  </div>
                  <div class="m-res-info">
                    <div class="m-res-name">{{ r.name }}</div>
                    <div class="m-res-role">{{ r.role || '' }}</div>
                  </div>
                </div>
              </td>
              <td
                v-for="d in days"
                :key="fmt(d)"
                class="m-day-cell"
                :class="{
                  'm-weekend': isWeekend(d),
                  'm-holiday-cell': holidayMap[fmt(d)] && holidayMap[fmt(d)].type === 'holiday',
                  'drag-selecting': isDragSelected(r.id, fmt(d)),
                }"
                :data-resource="r.id"
                :data-date="fmt(d)"
                @mousedown="onCellMouseDown($event, r, d)"
              >
                <div
                  v-if="leaveOnDate(r.id, d)"
                  class="booking-block leave-block"
                  :class="leaveOnDate(r.id, d).type"
                  :title="leaveLabel(leaveOnDate(r.id, d).type)"
                  @click.stop="!props.readonly && $emit('edit-leave', leaveOnDate(r.id, d))"
                >
                  {{ leaveLabel(leaveOnDate(r.id, d).type) }}
                </div>
                <div
                  v-for="b in bookingsOnDate(r.id, d)"
                  :key="b.id"
                  class="booking-block"
                  :class="{ moving: movingIds.has(b.id), resizing: resizingId === b.id }"
                  :data-booking-id="b.id"
                  :style="bookingStyle(b)"
                  :title="b.hours + 'h ' + b.project_name + (b.client_name ? ' | ' + b.client_name : '')"
                  @mousedown.stop="!props.readonly && onBookingMouseDown($event, b)"
                  @click.stop="$emit('edit', b)"
                >
                  <span class="booking-hours">{{ b.hours }}h</span>
                  {{ truncate(b.project_name, 25) }}
                  <div
                    class="resize-handle"
                    v-if="!props.readonly"
                    @mousedown.stop="$emit('resize-start', { event: $event, booking: b })"
                  ></div>
                </div>
                <div v-if="isResizePreview(r.id, d)" class="m-preview-overlay m-resize-preview"></div>
                <div v-if="isResizeShrinkPreview(r.id, d)" class="m-preview-overlay m-shrink-preview"></div>
                <div v-if="isMovePreview(r.id, d)" class="m-preview-overlay m-move-preview"></div>
                <span
                  v-if="dailyTotal(r.id, d) > 0"
                  class="day-total"
                  :class="{ overbooked: dailyTotal(r.id, d) > (r.hours_per_day || 8) }"
                >{{ dailyTotal(r.id, d) }}h</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useDragSelect } from '@/composables/useDragSelect'

const props = defineProps({
  days:               { type: Array,  required: true },
  teams:              { type: Object, required: true },
  bookings:           { type: Array,  default: () => [] },
  leaves:             { type: Array,  default: () => [] },
  holidayMap:         { type: Object, default: () => ({}) },
  resizePreviewCells: { type: Array,  default: () => [] },
  resizeShrinkCells:  { type: Array,  default: () => [] },
  movePreviewCells:   { type: Array,  default: () => [] },
  movingIds:          { type: Object, default: () => new Set() },
  resizingId:         { type: Number, default: null },
  readonly:           { type: Boolean, default: false },
})

const emit = defineEmits(['create', 'edit', 'edit-leave', 'resize-start', 'move-start'])

const containerRef = ref(null)
const scrollRef    = ref(null)

const DAY_SHORT   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

import { computed } from 'vue'
const monthSpans = computed(() => {
  const spans = []
  let curMonth = -1, curYear = -1, curSpan = 0
  props.days.forEach(d => {
    const m = d.getMonth(), y = d.getFullYear()
    if (m === curMonth && y === curYear) { curSpan++ }
    else {
      if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan })
      curMonth = m; curYear = y; curSpan = 1
    }
  })
  if (curSpan > 0) spans.push({ month: curMonth, year: curYear, span: curSpan })
  return spans
})

function fmt(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0')
}
function isToday(d) {
  const t = new Date()
  return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate()
}
function isWeekend(d) { return d.getDay()===0 || d.getDay()===6 }
function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay()||7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1))
  return Math.ceil((((date-yearStart)/86400000)+1)/7)
}
function truncate(str, n) { return str && str.length > n ? str.slice(0,n)+'\u2026' : (str||'') }

function dayHeaderClass(d) {
  const cls = ['m-col-hd']
  if (isToday(d))   cls.push('m-today')
  if (isWeekend(d)) cls.push('m-weekend')
  const h = props.holidayMap[fmt(d)]
  if (h && h.type==='holiday') cls.push('m-holiday')
  if (h && h.type==='workday') cls.push('m-makeup')
  return cls
}

function bookingsOnDate(resourceId, d) {
  const ds = fmt(d)
  return props.bookings.filter(b => b.resource_id===resourceId && b.date===ds)
}
function leaveOnDate(resourceId, d) {
  const ds = fmt(d)
  return props.leaves.find(l => l.resource_id===resourceId && l.date===ds) || null
}
function dailyTotal(resourceId, d) {
  return bookingsOnDate(resourceId, d).reduce((s,b) => s+(b.hours||0), 0)
}
function leaveLabel(type) {
  return {vacation:'休假',sick:'病假',personal:'事假',holiday:'法定假期',other:'请假'}[type]||'休假'
}
function bookingStyle(b) {
  const color = b.project_color || '#6366F1'
  return { background: color, color: '#fff', borderColor: color }
}
function isResizePreview(rid, d) {
  const ds = fmt(d)
  return props.resizePreviewCells.some(c => c.resourceId===rid && c.date===ds)
}
function isResizeShrinkPreview(rid, d) {
  const ds = fmt(d)
  return props.resizeShrinkCells.some(c => c.resourceId===rid && c.date===ds)
}
function isMovePreview(rid, d) {
  const ds = fmt(d)
  return props.movePreviewCells.some(c => c.resourceId===rid && c.date===ds)
}

const { selectedCells, onCellMouseDown: dragSelectMouseDown } =
  useDragSelect(scrollRef, (resourceId, startDate, endDate) =>
    emit('create', { resourceId, startDate, endDate })
  )

function isDragSelected(resourceId, dateStr) {
  return selectedCells.value.some(c => String(c.resourceId)===String(resourceId) && c.date===dateStr)
}
function onCellMouseDown(e, r, d) {
  if (props.readonly) return
  if (e.target.closest('.booking-block,.m-leave')) return
  dragSelectMouseDown(e, r.id, fmt(d))
}
function onBookingMouseDown(e, b) {
  if (props.readonly) return
  if (e.target.closest('.resize-handle')) return
  emit('move-start', { event: e, booking: b })
}
</script>

<style scoped>
.month-schedule { flex:1; overflow:hidden; display:flex; flex-direction:column; }
.month-scroll   { flex:1; overflow:auto; }
.month-table    { border-collapse:collapse; table-layout:fixed; }

.m-res-hd {
  position:sticky; left:0; top:0; z-index:5;
  background:var(--surface); width:160px; min-width:160px;
  border:1px solid var(--border); padding:4px 10px;
  font-size:12px; font-weight:600; color:var(--text-secondary);
}
.m-month-row th:not(.m-res-hd) {
  position:sticky; top:0; z-index:3;
  background:var(--surface); border:1px solid var(--border);
  padding:3px 6px; text-align:left;
}
.m-month-label { font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:.04em; }

.m-day-row th.m-col-hd {
  position:sticky; top:28px; z-index:3;
  background:var(--surface); border:1px solid var(--border);
  padding:4px 2px 2px; text-align:center;
  width:36px; min-width:36px; vertical-align:bottom;
}
.m-day-row th.m-weekend { background:#f9fafb; }
.m-day-row th.m-today   { background:color-mix(in srgb, var(--primary) 8%, var(--surface)); }
.m-day-row th.m-holiday { background:#fef3c7; }
.m-week-label { display:block; font-size:9px; color:var(--text-secondary); opacity:.6; margin-bottom:1px; }
.m-day-name   { display:block; font-size:9px; color:var(--text-secondary); }
.m-day-num    { display:block; font-size:12px; font-weight:600; color:var(--text); }
.m-today-num  { color:var(--primary); }
.m-holiday-dot,.m-makeup-dot { display:block; width:4px; height:4px; border-radius:50%; margin:1px auto 0; }
.m-holiday-dot { background:#ef4444; }
.m-makeup-dot  { background:#f59e0b; }

.m-team-row td { background:var(--bg); border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:3px 0; }
.m-team-label-cell { position:sticky; left:0; z-index:2; background:var(--bg)!important; padding:3px 10px!important; }
.team-label { font-size:11px; font-weight:600; color:var(--text-secondary); display:inline-flex; align-items:center; gap:6px; }
.team-label::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary); opacity:.5; }

.m-res-cell { position:sticky; left:0; z-index:2; background:var(--surface); border:1px solid var(--border); width:160px; min-width:160px; padding:0; vertical-align:middle; }
.m-res-inner { display:flex; align-items:center; gap:6px; padding:4px 8px; }
.m-res-avatar { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:#fff; flex-shrink:0; }
.m-res-info   { min-width:0; }
.m-res-name   { font-size:12px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.m-res-role   { font-size:10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.m-day-cell {
  position:relative; width:36px; min-width:36px; height:56px;
  vertical-align:top; border:1px solid var(--border);
  padding:2px 2px 14px; cursor:pointer; overflow:hidden;
  transition:background .1s;
}
.m-day-cell:hover        { background:var(--hover); }
.m-day-cell.m-weekend    { background:#f9fafb; }
.m-day-cell.m-holiday-cell { background:#fef9ec; }
.m-day-cell.drag-selecting { background:rgba(79,70,229,.12)!important; }

.m-day-cell .booking-block {
  font-size:10px; padding:1px 16px 1px 4px; height:16px; line-height:16px;
  margin-bottom:1px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
  border-radius:3px; cursor:pointer; position:relative; display:block;
}
.m-day-cell .booking-block .booking-hours { font-weight:700; margin-right:2px; }
.m-day-cell .booking-block .resize-handle {
  position:absolute; right:0; top:0; bottom:0; width:6px;
  cursor:col-resize; opacity:0; transition:opacity .15s;
}
.m-day-cell .booking-block:hover .resize-handle { opacity:1; }
.m-day-cell .leave-block { background:#fbbf24!important; color:#fff!important; }

.day-total { position:absolute; bottom:1px; right:3px; font-size:9px; color:var(--text-secondary); pointer-events:none; }
.day-total.overbooked { color:#ef4444; font-weight:700; }

.m-preview-overlay { position:absolute; inset:0; pointer-events:none; z-index:5; }
.m-resize-preview  { background:rgba(59,130,246,.2);  border:1px dashed #3b82f6; }
.m-shrink-preview  { background:rgba(239,68,68,.15);  border:1px dashed #ef4444; }
.m-move-preview    { background:rgba(16,185,129,.2);  border:1px dashed #10b981; }
</style>
