<template>
  <div class="month-view">
    <!-- Header: weekday labels -->
    <div class="month-header-row">
      <div class="m-name-col"></div>
      <div v-for="d in headerDays" :key="d" class="m-day-header">{{ CN_DAYS[d] }}</div>
    </div>

    <!-- Week sub-headers (dates) -->
    <template v-for="(week, wi) in weeks" :key="wi">
      <div class="month-date-row">
        <div class="m-name-col m-week-label">第{{ wi + 1 }}周</div>
        <div
          v-for="d in week"
          :key="fmt(d)"
          class="m-date-cell"
          :class="{
            'is-today': fmt(d) === todayStr,
            'is-weekend': d.getDay() === 0 || d.getDay() === 6,
            'is-holiday': holidays[fmt(d)],
          }"
        >
          <span>{{ d.getDate() }}</span>
          <span v-if="holidays[fmt(d)]" class="m-holiday-dot">假</span>
        </div>
      </div>

      <!-- Resource rows for this week -->
      <div
        v-for="resource in resources"
        :key="`${wi}-${resource.id}`"
        class="month-resource-row"
      >
        <div class="m-name-col">
          <span v-if="wi === 0" class="resource-name">{{ resource.name }}</span>
        </div>
        <td
          v-for="d in week"
          :key="fmt(d)"
          class="m-day-cell"
          :class="{
            'is-weekend': d.getDay() === 0 || d.getDay() === 6,
            'is-holiday': holidays[fmt(d)],
            'drag-selecting': isDragSelected(resource.id, fmt(d)),
          }"
          :data-date="fmt(d)"
          :data-resource="resource.id"
          @mousedown="onCellMousedown($event, fmt(d), resource.id, getCellsForResource(resource.id, wi))"
          @click="onCellClick($event, fmt(d), resource.id)"
        >
          <!-- Leave -->
          <div v-if="leaveOnDate(resource.id, fmt(d))" class="m-leave-badge">休</div>

          <!-- Bookings -->
          <div
            v-for="b in bookingsOnDate(resource.id, fmt(d))"
            :key="b.id"
            class="m-booking"
            :style="{ background: b.project_color || '#8B5CF6', color: readableColor(b.project_color) }"
            :title="b.project_name"
            @click.stop="openEdit(b)"
            @mousedown.stop="(e) => startMove(e, b, getGroupForBooking(b))"
          >
            <span class="m-booking-label">{{ truncate(b.project_name, 18) }}</span>
            <div
              class="resize-handle"
              @mousedown.stop="(e) => startResize(e, b, getGroupForBooking(b))"
            />
          </div>

          <!-- Resize preview -->
          <div
            v-if="resizePreviewOnDate(fmt(d))"
            class="resize-preview"
            :class="resizePreviewOnDate(fmt(d)) === 'remove' ? 'resize-preview-shrink' : ''"
          />
          <!-- Move preview -->
          <div v-if="movePreviewOnDate(fmt(d))" class="move-preview" />

          <!-- Daily total -->
          <div class="m-day-total">{{ dailyTotal(resource.id, fmt(d)) }}</div>
        </td>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fmt, CN_DAYS } from '@/utils/date'
import { truncate, readableColor } from '@/utils'
import { useDragSelect } from '@/composables/useDragSelect'
import { useBookingDrag } from '@/composables/useBookingDrag'

const props = defineProps({
  days: { type: Array, required: true }, // 28 days
  resources: { type: Array, default: () => [] },
  bookings: { type: Array, default: () => [] },
  leave: { type: Array, default: () => [] },
  holidays: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['open-create', 'open-edit', 'resize-done', 'move-done'])

const todayStr = fmt(new Date())
const headerDays = [1, 2, 3, 4, 5, 6, 0] // Mon-Sun

const weeks = computed(() => {
  const result = []
  for (let w = 0; w < 4; w++) {
    result.push(props.days.slice(w * 7, w * 7 + 7))
  }
  return result
})

// ── Data helpers ──────────────────────────────────────────────────
function bookingsOnDate(resourceId, date) {
  return props.bookings.filter(b => b.resource_id === resourceId && b.date === date)
}
function leaveOnDate(resourceId, date) {
  return props.leave.find(l => l.resource_id === resourceId && l.date === date)
}
function dailyTotal(resourceId, date) {
  const total = props.bookings
    .filter(b => b.resource_id === resourceId && b.date === date)
    .reduce((s, b) => s + b.hours, 0)
  return total > 0 ? `${total}h` : ''
}
function getCellsForResource(resourceId, weekIndex) {
  return weeks.value[weekIndex].map(d => ({ date: fmt(d), resourceId }))
}
function getGroupForBooking(booking) {
  return props.bookings
    .filter(b => b.resource_id === booking.resource_id && b.project_id === booking.project_id)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Drag select ───────────────────────────────────────────────────
const { selectedCells, onCellMousedown: _dragMousedown, isBlockingClick } =
  useDragSelect({
    onSelectDone: ({ resourceId, startDate, endDate }) => {
      emit('open-create', { resourceId, startDate, endDate })
    },
  })

function onCellMousedown(e, date, resourceId, cells) {
  _dragMousedown(e, date, resourceId, cells)
}
function onCellClick(e, date, resourceId) {
  if (isBlockingClick()) return
  emit('open-create', { resourceId, startDate: date, endDate: date })
}
function isDragSelected(resourceId, date) {
  return selectedCells.value.some(c => c.resourceId === resourceId && c.date === date)
}

// ── Drag resize / move ────────────────────────────────────────────
const { resizePreviewCells, startResize, movePreviewCells, startMove } =
  useBookingDrag({
    onResizeDone: (payload) => emit('resize-done', payload),
    onMoveDone: (payload) => emit('move-done', payload),
  })

function resizePreviewOnDate(date) {
  const p = resizePreviewCells.value.find(c => c.date === date)
  return p ? p.mode : null
}
function movePreviewOnDate(date) {
  return movePreviewCells.value.includes(date)
}
function openEdit(booking) {
  emit('open-edit', booking)
}
</script>

<style scoped>
.month-view { overflow-x: auto; }

.month-header-row, .month-date-row, .month-resource-row {
  display: grid;
  grid-template-columns: 120px repeat(7, 1fr);
  border-bottom: 1px solid var(--border);
}

.m-name-col {
  padding: 4px 8px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
}
.m-week-label { font-size: 11px; color: var(--text-secondary); }
.resource-name { font-size: 12px; font-weight: 600; color: var(--text); }

.m-day-header {
  text-align: center;
  padding: 6px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-right: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 2;
}

.m-date-cell {
  text-align: center;
  padding: 3px 4px;
  font-size: 11px;
  color: var(--text-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.m-date-cell.is-today { color: var(--primary); font-weight: 700; }
.m-date-cell.is-weekend, .m-day-cell.is-weekend { background: var(--weekend-bg, #f9fafb); }
.m-date-cell.is-holiday, .m-day-cell.is-holiday { background: #fef3c7; }
.m-holiday-dot { font-size: 9px; background: #ef4444; color: #fff; border-radius: 3px; padding: 0 2px; }

.m-day-cell {
  position: relative;
  min-height: 36px;
  padding: 2px 4px 14px;
  border-right: 1px solid var(--border);
  cursor: pointer;
  transition: background .1s;
}
.m-day-cell:hover { background: var(--hover); }
.m-day-cell.drag-selecting { background: rgba(79,70,229,.12); }

.m-leave-badge {
  position: absolute; top: 1px; right: 1px;
  background: #fbbf24; color: #fff;
  font-size: 8px; font-weight: 700;
  border-radius: 2px; padding: 0 3px;
}

.m-booking {
  position: relative;
  border-radius: 3px;
  padding: 1px 16px 1px 4px;
  font-size: 10px;
  font-weight: 500;
  margin-bottom: 1px;
  height: 16px;
  line-height: 14px;
  overflow: hidden;
  white-space: nowrap;
  cursor: grab;
  user-select: none;
}
.m-booking:hover .resize-handle { opacity: 1; }
.m-booking-label { pointer-events: none; }

.resize-handle {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 8px;
  cursor: col-resize;
  opacity: 0;
  transition: opacity .15s;
  background: rgba(255,255,255,.35);
  border-radius: 0 3px 3px 0;
}

.m-day-total {
  position: absolute;
  bottom: 1px; right: 3px;
  font-size: 9px;
  color: var(--text-secondary);
}

.resize-preview {
  position: absolute; inset: 1px;
  background: rgba(59,130,246,.2);
  border: 1px dashed #3b82f6;
  border-radius: 3px;
  pointer-events: none;
}
.resize-preview-shrink { background: rgba(239,68,68,.15); border-color: #ef4444; }
.move-preview {
  position: absolute; inset: 1px;
  background: rgba(16,185,129,.2);
  border: 1px dashed #10b981;
  border-radius: 3px;
  pointer-events: none;
}
</style>
