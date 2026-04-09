<template>
  <div class="schedule-wrap">
    <table class="schedule-table">
      <!-- ── Sticky header ── -->
      <thead>
        <tr>
          <th class="col-name">人员</th>
          <th
            v-for="d in days"
            :key="fmtDate(d)"
            :class="['col-day', { today: isToday(d), weekend: isWeekend(d) }]"
          >
            {{ shortDay(d) }}<br />{{ fmtDate(d) }}
            <template v-if="holidays[fmtDate(d)]">
              <br />
              <span
                class="holiday-marker"
                :class="holidays[fmtDate(d)].type === 'workday' ? 'workday' : 'holiday'"
              >{{ holidays[fmtDate(d)].type === 'workday' ? '调休上班' : holidays[fmtDate(d)].name }}</span>
            </template>
          </th>
        </tr>
      </thead>

      <!-- ── Body ── -->
      <tbody>
        <template v-for="(members, teamName) in teams" :key="teamName">
          <!-- Team divider row -->
          <tr class="team-divider">
            <td>
              <span class="team-label">{{ teamName }}</span>
            </td>
            <td v-for="d in days" :key="fmtDate(d)"></td>
          </tr>

          <!-- Resource rows -->
          <tr v-for="r in members" :key="r.id">
            <!-- Sticky left: resource info -->
            <td class="td-name">
              <div class="resource-cell">
                <div class="resource-avatar" :style="{ background: r.color || '#4F46E5' }">
                  {{ r.name.charAt(0) }}
                </div>
                <div class="resource-info">
                  <div class="resource-name">{{ r.name }}</div>
                  <div class="resource-role">{{ r.role || '' }}</div>
                </div>
              </div>
            </td>

            <!-- Day cells -->
            <td
              v-for="d in days"
              :key="fmtDate(d)"
              class="booking-cell"
              :class="{
                weekend: isWeekend(d),
                'drag-selecting': isDragSelected(r.id, fmtDate(d)),
                'drag-start': isDragStart(r.id, fmtDate(d)),
                'drag-end': isDragEnd(r.id, fmtDate(d)),
              }"
              :data-resource="r.id"
              :data-date="fmtDate(d)"
              @mousedown="!props.readonly && onCellMousedown($event, fmtDate(d), r.id)"
              @click="!props.readonly && onCellClick($event, fmtDate(d), r.id)"
            >
              <!-- Leave block -->
              <div
                v-if="leaveOnDate(r.id, fmtDate(d))"
                class="booking-block leave-block"
                :class="leaveOnDate(r.id, fmtDate(d)).type"
                :data-leave-id="leaveOnDate(r.id, fmtDate(d)).id"
                :title="leaveLabel(leaveOnDate(r.id, fmtDate(d)).type)"
                @click.stop="!props.readonly && $emit('open-leave', leaveOnDate(r.id, fmtDate(d)))"
              >
                {{ leaveLabel(leaveOnDate(r.id, fmtDate(d)).type) }}
              </div>

              <!-- Booking blocks -->
              <BookingBlock
                v-for="b in bookingsOnDate(r.id, fmtDate(d))"
                :key="b.id"
                :booking="b"
                :is-resizing="resizingId === b.id"
                :is-moving="movingIds.includes(b.id)"
                @click.stop="$emit('open-edit', b)"
                :readonly="props.readonly"
                @resize-start="(e) => !props.readonly && startResize(e, b, getGroup(b))"
                @move-start="(e) => !props.readonly && startMove(e, b, getGroup(b))"
              />

              <!-- Resize preview overlay -->
              <div
                v-if="resizePreviewOnDate(fmtDate(d), r.id)"
                class="resize-preview"
                :class="{ 'resize-preview-shrink': resizePreviewOnDate(fmtDate(d), r.id) === 'remove' }"
              />

              <!-- Move preview overlay -->
              <div
                v-if="movePreviewOnDate(fmtDate(d), r.id)"
                class="move-preview"
              />

              <!-- Daily total -->
              <span
                v-if="dailyTotal(r.id, fmtDate(d)) > 0"
                class="day-total"
                :class="{ overbooked: dailyTotal(r.id, fmtDate(d)) > (r.hours_per_day || 8) }"
              >{{ dailyTotal(r.id, fmtDate(d)) }}h</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BookingBlock from './BookingBlock.vue'
import { useDragSelect } from '@/composables/useDragSelect'
import { useBookingDrag } from '@/composables/useBookingDrag'

const props = defineProps({
  days:     { type: Array,  required: true },
  teams:    { type: Object, default: () => ({}) },
  bookings: { type: Array,  default: () => [] },
  leave:    { type: Array,  default: () => [] },
  holidays: { type: Object, default: () => ({}) },
  readonly: { type: Boolean, default: false },
})

const emit = defineEmits(['open-create', 'open-edit', 'open-leave', 'resize-done', 'move-done'])

// ── Date helpers ──────────────────────────────────────────────────────
const CN_DAYS = ['日', '一', '二', '三', '四', '五', '六']
const todayStr = fmtDate(new Date())

function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function shortDay(d) { return '周' + CN_DAYS[d.getDay()] }
function isToday(d)   { return fmtDate(d) === todayStr }
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6 }

// ── Data helpers ──────────────────────────────────────────────────────
function bookingsOnDate(resourceId, date) {
  return props.bookings.filter(b => b.resource_id === resourceId && b.date === date)
}
function leaveOnDate(resourceId, date) {
  return props.leave.find(l => l.resource_id === resourceId && l.date === date) || null
}
function dailyTotal(resourceId, date) {
  return props.bookings
    .filter(b => b.resource_id === resourceId && b.date === date)
    .reduce((s, b) => s + b.hours, 0)
}
function getGroup(booking) {
  return props.bookings
    .filter(b => b.resource_id === booking.resource_id && b.project_id === booking.project_id)
    .sort((a, b) => a.date.localeCompare(b.date))
}
function leaveLabel(type) {
  const map = { vacation: '休假', sick: '病假', personal: '事假', holiday: '法定假期', other: '请假' }
  return map[type] || '休假'
}

// ── Drag select ───────────────────────────────────────────────────────
const { selectedCells, onCellMousedown: _dragMousedown, clearSelection, isBlockingClick } =
  useDragSelect({
    onSelectDone: ({ resourceId, startDate, endDate }) => {
      emit('open-create', { resourceId, startDate, endDate })
    },
  })

function onCellMousedown(e, date, resourceId) {
  if (props.readonly) return
  const cells = props.days.map(d => ({ date: fmtDate(d), resourceId }))
  _dragMousedown(e, date, resourceId, cells)
}
function onCellClick(e, date, resourceId) {
  if (props.readonly) return
  if (isBlockingClick()) return
  emit('open-create', { resourceId, startDate: date, endDate: date })
}
function isDragSelected(resourceId, date) {
  return selectedCells.value.some(c => c.resourceId === resourceId && c.date === date)
}
function isDragStart(resourceId, date) {
  const cells = selectedCells.value.filter(c => c.resourceId === resourceId)
  return cells.length > 0 && cells[0].date === date
}
function isDragEnd(resourceId, date) {
  const cells = selectedCells.value.filter(c => c.resourceId === resourceId)
  return cells.length > 0 && cells[cells.length - 1].date === date
}

// ── Drag resize / move ────────────────────────────────────────────────
const { resizing, resizePreviewCells, startResize, moving, movePreviewCells, startMove } =
  useBookingDrag({
    onResizeDone: (payload) => emit('resize-done', payload),
    onMoveDone:   (payload) => emit('move-done', payload),
  })

// Track which booking IDs are being dragged for visual state
const resizingId = computed(() => {
  if (!resizing.value) return null
  return resizing.value?.id ?? null
})
const movingIds = computed(() => {
  if (!moving.value) return []
  return moving.value?.map ? moving.value.map(b => b.id) : []
})

function resizePreviewOnDate(date, resourceId) {
  const p = resizePreviewCells.value.find(c => c.date === date)
  return p ? p.mode : null
}
function movePreviewOnDate(date, resourceId) {
  return movePreviewCells.value.includes(date)
}
</script>

<style scoped>
.schedule-wrap {
  overflow-x: auto;
  overflow-y: auto;
  flex: 1;
}

/* ── Table base ── */
.schedule-table {
  border-collapse: collapse;
  min-width: 700px;
  width: 100%;
  table-layout: fixed;
}

/* ── Header ── */
.schedule-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 6px 4px;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  color: var(--text-secondary);
  line-height: 1.4;
}
.schedule-table thead th.col-name {
  width: 160px;
  min-width: 160px;
  text-align: left;
  padding-left: 12px;
  position: sticky;
  top: 0;
  left: 0;
  z-index: 4;
}
.schedule-table thead th.today {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface));
}
.schedule-table thead th.weekend {
  background: var(--weekend-bg, #f9fafb);
}

/* ── Team divider ── */
.team-divider td {
  background: var(--bg);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.team-divider td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg);
}
.team-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.team-label::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  opacity: .5;
}

/* ── Sticky name column ── */
.td-name {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 0;
  width: 160px;
  min-width: 160px;
}
.resource-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}
.resource-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.resource-info { min-width: 0; }
.resource-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.resource-role {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Booking cells ── */
.booking-cell {
  position: relative;
  height: 60px;
  min-width: 80px;
  padding: 3px 4px 16px;
  border: 1px solid var(--border);
  vertical-align: top;
  cursor: pointer;
  transition: background .1s;
}
.booking-cell:hover { background: var(--hover); }
.booking-cell.weekend { background: var(--weekend-bg, #f9fafb); }
.booking-cell.drag-selecting { background: rgba(79, 70, 229, .12); }
.booking-cell.drag-start { border-left: 2px solid var(--primary) !important; }
.booking-cell.drag-end   { border-right: 2px solid var(--primary) !important; }

/* ── Day total ── */
.day-total {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 10px;
  color: var(--text-secondary);
  pointer-events: none;
}
.day-total.overbooked { color: #ef4444; font-weight: 700; }

/* ── Preview overlays ── */
.resize-preview {
  position: absolute;
  inset: 2px;
  background: rgba(59, 130, 246, .2);
  border: 1px dashed #3b82f6;
  border-radius: 4px;
  pointer-events: none;
  z-index: 1;
}
.resize-preview-shrink {
  background: rgba(239, 68, 68, .15);
  border-color: #ef4444;
}
.move-preview {
  position: absolute;
  inset: 2px;
  background: rgba(16, 185, 129, .2);
  border: 1px dashed #10b981;
  border-radius: 4px;
  pointer-events: none;
  z-index: 1;
}
</style>
