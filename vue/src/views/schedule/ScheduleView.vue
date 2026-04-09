<template>
  <div class="schedule-page">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="btn btn-secondary btn-sm" @click="store.prevPeriod(); store.load()">‹</button>
        <button class="btn btn-secondary btn-sm" @click="store.goToday(); store.load()">今天</button>
        <button class="btn btn-secondary btn-sm" @click="store.nextPeriod(); store.load()">›</button>
        <span class="period-label">{{ periodLabel }}</span>
      </div>
      <div class="toolbar-right">
        <div class="view-toggle">
          <button
            class="btn btn-sm"
            :class="store.view === 'week' ? 'btn-primary' : 'btn-secondary'"
            @click="switchView('week')"
          >周视图</button>
          <button
            class="btn btn-sm"
            :class="store.view === 'month' ? 'btn-primary' : 'btn-secondary'"
            @click="switchView('month')"
          >月视图</button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-bar">加载中…</div>

    <!-- Week view -->
    <WeekView
      v-if="store.view === 'week'"
      :days="store.days"
      :teams="store.teams"
      :bookings="store.bookings"
      :leave="store.leave"
      :holidays="store.holidays"
      :readonly="auth.isBasic"
      @open-create="openCreate"
      @open-edit="openEdit"
      @open-leave="openLeave"
      @resize-done="handleResizeDone"
      @move-done="handleMoveDone"
    />

    <!-- Month view -->
    <MonthView
      v-else
      :days="store.days"
      :teams="store.teams"
      :bookings="store.bookings"
      :leaves="store.leave"
      :holiday-map="store.holidays"
      :readonly="auth.isBasic"
      @create="openCreate"
      @edit="openEdit"
      @resize-start="handleResizeStart"
      @move-start="handleMoveStart"
    />

    <!-- Booking modal (only for manager/admin) -->
    <BookingModal
      v-if="!auth.isBasic"
      v-model="showModal"
      :booking="editingBooking"
      :default-date="createDefaults.startDate"
      :default-end-date="createDefaults.endDate"
      :default-resource-id="createDefaults.resourceId"
      :resources="store.resources"
      :projects="projects"
      :leave-map="leaveMap"
      @saved="store.load()"
      @deleted="store.load()"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { useAuthStore } from '@/stores/auth'
import { projectApi, bookingApi, leaveApi } from '@/api'
import { fmt } from '@/utils/date'
import { useToast } from '@/composables/useToast'
import WeekView from '@/components/schedule/WeekView.vue'
import MonthView from '@/components/schedule/MonthView.vue'
import BookingModal from '@/components/schedule/BookingModal.vue'

const store = useScheduleStore()
const auth = useAuthStore()
const { toast } = useToast()

const projects = ref([])
const showModal = ref(false)
const editingBooking = ref(null)
const createDefaults = ref({ startDate: '', endDate: '', resourceId: '' })

const periodLabel = computed(() => {
  const days = store.days
  if (!days.length) return ''
  const s = days[0], e = days[days.length - 1]
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 — ${e.getMonth() + 1}月${e.getDate()}日`
})

const leaveMap = computed(() => {
  const m = {}
  store.leave.forEach(l => { m[`${l.resource_id}_${l.date}`] = true })
  return m
})

onMounted(async () => {
  await store.load()
  const res = await projectApi.list(0)
  projects.value = res
})

watch(() => store.weekStart, () => store.load())

function switchView(v) {
  store.setView(v)
  store.load()
}

function openCreate({ resourceId, startDate, endDate }) {
  if (auth.isBasic) return
  editingBooking.value = null
  createDefaults.value = { resourceId, startDate, endDate }
  showModal.value = true
}

function openEdit(booking) {
  if (auth.isBasic) return
  editingBooking.value = booking
  createDefaults.value = {}
  showModal.value = true
}

function openLeave(leave) {
  if (auth.isBasic) return
  // Leave deletion handled via confirmation
  if (confirm(`确认删除 ${leave.type} 记录？`)) {
    leaveApi.remove(leave.resource_id, leave.date).then(() => store.load()).catch(e => toast(e.message, 'error'))
  }
}

// ── Resize start (from MonthView) ────────────────────────────────
function handleResizeStart({ event, booking }) {
  // Delegate to the vanilla-style resize logic via composable
  // For now, use the same approach as WeekView
  // This will be wired to useBookingDrag in a follow-up
}

// ── Move start (from MonthView) ───────────────────────────────────
function handleMoveStart({ event, booking }) {
  // Delegate to move logic
}

// ── Resize done ────────────────────────────────────────────────────
async function handleResizeDone({ booking, group, addDates, removeDates }) {
  try {
    // Add new dates
    for (const date of addDates) {
      await bookingApi.create({
        resource_id: booking.resource_id,
        project_id: booking.project_id,
        date,
        hours: booking.hours,
        is_tentative: booking.is_tentative,
        notes: booking.notes,
      })
    }
    // Remove dates
    for (const date of removeDates) {
      const b = group.find(x => x.date === date)
      if (b) await bookingApi.remove(b.id)
    }
    const delta = addDates.length - removeDates.length
    if (delta > 0) toast(`已延长 ${addDates.length} 天`)
    else if (delta < 0) toast(`已缩短 ${removeDates.length} 天`)
    await store.load()
  } catch (e) {
    toast(e.message, 'error')
  }
}

// ── Move done ──────────────────────────────────────────────────────
async function handleMoveDone({ booking, group, delta, newDates }) {
  try {
    // Delete old bookings
    for (const b of group) await bookingApi.remove(b.id)
    // Create at new dates
    for (let i = 0; i < group.length; i++) {
      await bookingApi.create({
        resource_id: booking.resource_id,
        project_id: booking.project_id,
        date: newDates[i],
        hours: group[i].hours,
        is_tentative: group[i].is_tentative,
        notes: group[i].notes,
      })
    }
    toast(`已${delta > 0 ? '向后' : '向前'}移动 ${Math.abs(delta)} 天`)
    await store.load()
  } catch (e) {
    toast(e.message, 'error')
  }
}
</script>

<style scoped>
.schedule-page { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }
.period-label { font-size: 14px; font-weight: 600; color: var(--text); margin-left: 8px; }
.view-toggle { display: flex; gap: 4px; }
.loading-bar {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--hover);
  text-align: center;
}
</style>
