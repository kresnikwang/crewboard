<template>
  <div class="week-view">
    <!-- Header row -->
    <div class="week-grid" :style="gridStyle">
      <div class="cell-name cell-header">人员</div>
      <div
        v-for="d in days"
        :key="fmt(d)"
        class="cell-header day-header"
        :class="{
          'is-today': fmt(d) === todayStr,
          'is-weekend': d.getDay() === 0 || d.getDay() === 6,
          'is-holiday': holidays[fmt(d)],
        }"
      >
        <span class="day-name">{{ CN_DAYS[d.getDay()] }}</span>
        <span class="day-num">{{ d.getDate() }}</span>
        <span v-if="holidays[fmt(d)]" class="holiday-dot" :title="holidays[fmt(d)]?.name">假</span>
      </div>
    </div>

    <!-- Resource rows -->
    <div
      v-for="resource in resources"
      :key="resource.id"
      class="week-grid resource-row"
      :style="gridStyle"
    >
      <!-- Name cell -->
      <div class="cell-name">
        <span class="resource-dot" :style="{ background: resource.color }"></span>
        <span class="resource-name">{{ resource.name }}</span>
        <span class="resource-role">{{ resource.role }}</span>
      </div>

      <!-- Day cells -->
      <div
        v-for="d in days"
        :key="fmt(d)"
        class="booking-cell"
        :class="{
          'is-weekend': d.getDay() === 0 || d.getDay() === 6,
          'is-holiday': holidays[fmt(d)],
          'drag-selecting': isDragSelected(resource.id, fmt(d)),
        }"
        :data-date="fmt(d)"
        :data-resource="resource.id"
        @mousedown="onCellMousedown($event, fmt(d), resource.id, getCellsForResource(resource.id))"
        @click="onCellClick($event, fmt(d), resource.id)"
      >
        <!-- Leave badge -->
        <div
          v-if="leaveOnDate(resource.id, fmt(d))"
          class="leave-badge"
          :title="leaveOnDate(resource.id, fmt(d))?.type"
        >休</div>

        <!-- Booking blocks -->
        <template v-for="b in bookingsOnDate(resource.id, fmt(d))" :key="b.id">
          <BookingBlock
            :booking="b"
            :is-moving="isMovingBooking(b)"
            :is-resizing="isResizingBooking(b)"
            @click="openEdit(b)"
            @resize-start="(e) => startResize(e, b, getGroupForBooking(b))"
            @move-start="(e) => startMove(e, b, getGroupForBooking(b))"
          />
        </template>

        <!-- Resize preview -->
        <div
          v-if="resizePreviewOnDate(fmt(d), resource.id)"
          class="resize-preview"
          :class="resizePreviewOnDate(fmt(d), resource.id) === 'remove' ? 'resize-preview-shrink' : ''"
        />

        <!-- Move preview -->
        <div v-if="movePreviewOnDate(fmt(d), resource.id)" class="move-preview" />

        <!-- Daily total -->
        <div class="day-total">{{ dailyTotal(resource.id, fmt(d)) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BookingBlock from './BookingBlock.vue'
import { fmt, CN_DAYS } from '@/utils/date'
import { useDragSelect } from '@/composables/useDragSelect'
import { useBookingDrag } from '@/composables/useBookingDrag'

const props = defineProps({
  days: { type: Array, required: true },
  resources: { type: Array, default: () => [] },
  bookings: { type: Array, default: () => [] },
  leave: { type: Array, default: () => [] },
  holidays: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['open-create', 'open-edit', 'resize-done', 'move-done'])

const todayStr = fmt(new Date())

const gridStyle = computed(() => ({
  gridTemplateColumns: `180px repeat(${props.days.length}, 1fr)`,
}))

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
function getCellsForResource(resourceId) {
  return props.days.map(d => ({ date: fmt(d), resourceId }))
}
function getGroupForBooking(booking) {
  return props.bookings
    .filter(b => b.resource_id === booking.resource_id && b.project_id === booking.project_id)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Drag select ───────────────────────────────────────────────────
const { selecting, selectedCells, onCellMousedown: _dragMousedown, clearSelection, isBlockingClick } =
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
const { resizing, resizePreviewCells, startResize, moving, movePreviewCells, startMove } =
  useBookingDrag({
    onResizeDone: (payload) => emit('resize-done', payload),
    onMoveDone: (payload) => emit('move-done', payload),
  })

function isResizingBooking(b) {
  return resizing.value
}
function isMovingBooking(b) {
  return moving.value
}

function resizePreviewOnDate(date, resourceId) {
  // Find if any active resize context matches this resource
  const p = resizePreviewCells.value.find(c => c.date === date)
  return p ? p.mode : null
}

function movePreviewOnDate(date, resourceId) {
  return movePreviewCells.value.includes(date)
}

function openEdit(booking) {
  emit('open-edit', booking)
}
</script>

<style scoped>
.week-view { overflow-x: auto; }
.week-grid {
  display: grid;
  min-width: 600px;
  border-bottom: 1px solid var(--border);
}
.cell-header {
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--surface);
  border-right: 1px solid var(--border);
  text-align: center;
  position: sticky;
  top: 0;
  z-index: 2;
}
.day-header { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.day-name { font-size: 10px; }
.day-num { font-size: 14px; font-weight: 700; }
.holiday-dot { font-size: 9px; background: #ef4444; color: #fff; border-radius: 3px; padding: 0 3px; }
.cell-header.is-today .day-num { color: var(--primary); }
.cell-header.is-weekend, .booking-cell.is-weekend { background: var(--weekend-bg, #f9fafb); }
.cell-header.is-holiday, .booking-cell.is-holiday { background: #fef3c7; }

.cell-name {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  left: 0;
  z-index: 1;
}
.resource-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
.resource-name { font-size: 13px; font-weight: 600; color: var(--text); }
.resource-role { font-size: 11px; color: var(--text-secondary); }

.booking-cell {
  position: relative;
  min-height: 44px;
  padding: 3px 4px 18px;
  border-right: 1px solid var(--border);
  cursor: pointer;
  transition: background .1s;
}
.booking-cell:hover { background: var(--hover); }
.booking-cell.drag-selecting { background: rgba(79,70,229,.12); }

.leave-badge {
  position: absolute;
  top: 2px; right: 2px;
  background: #fbbf24; color: #fff;
  font-size: 9px; font-weight: 700;
  border-radius: 3px; padding: 1px 4px;
}

.day-total {
  position: absolute;
  bottom: 2px; right: 4px;
  font-size: 10px;
  color: var(--text-secondary);
}

.resize-preview {
  position: absolute; inset: 2px;
  background: rgba(59,130,246,.2);
  border: 1px dashed #3b82f6;
  border-radius: 4px;
  pointer-events: none;
}
.resize-preview-shrink {
  background: rgba(239,68,68,.15);
  border-color: #ef4444;
}
.move-preview {
  position: absolute; inset: 2px;
  background: rgba(16,185,129,.2);
  border: 1px dashed #10b981;
  border-radius: 4px;
  pointer-events: none;
}
</style>
