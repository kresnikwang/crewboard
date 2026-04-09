<template>
  <div class="timesheets-page">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="btn btn-secondary btn-sm" @click="prevWeek">‹</button>
        <button class="btn btn-secondary btn-sm" @click="goToday">今天</button>
        <button class="btn btn-secondary btn-sm" @click="nextWeek">›</button>
        <span class="period-label">{{ periodLabel }}</span>
      </div>
      <div class="toolbar-right">
        <template v-if="!auth.isBasic">
          <button class="btn btn-secondary btn-sm" @click="copyFromSchedule" :disabled="copying">
            {{ copying ? '复制中…' : '从排程复制' }}
          </button>
          <button class="btn btn-primary btn-sm" @click="openAdd">+ 新增工时</button>
        </template>
      </div>
    </div>

    <div v-if="loading" class="loading-bar">加载中…</div>

    <!-- Grid -->
    <div v-else class="ts-grid-wrap">
      <table class="ts-table">
        <thead>
          <tr>
            <th class="ts-name-col">人员</th>
            <th
              v-for="d in days"
              :key="fmt(d)"
              class="ts-day-col"
              :class="{ 'is-today': fmt(d) === todayStr, 'is-weekend': isWeekend(d) }"
            >
              <div class="day-label">{{ CN_DAYS[d.getDay()] }}</div>
              <div class="day-num">{{ d.getDate() }}</div>
            </th>
            <th class="ts-total-col">合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="resource in resources" :key="resource.id">
            <td class="ts-name-col">
              <span class="resource-name">{{ resource.name }}</span>
            </td>
            <td
              v-for="d in days"
              :key="fmt(d)"
              class="ts-day-cell"
              :class="{ 'is-weekend': isWeekend(d) }"
              @click="!auth.isBasic && openAddForCell(resource.id, fmt(d))"
            >
              <div
                v-for="ts in timesheetsOnDate(resource.id, fmt(d))"
                :key="ts.id"
                class="ts-entry"
                :style="{ background: ts.project_color || '#8B5CF6', color: readableColor(ts.project_color) }"
                :title="ts.project_name"
                @click.stop="!auth.isBasic && openEdit(ts)"
              >
                {{ ts.hours }}h {{ truncate(ts.project_name, 16) }}
              </div>
              <div class="ts-day-total">{{ dailyTotal(resource.id, fmt(d)) }}</div>
            </td>
            <td class="ts-total-col">
              <strong>{{ weekTotal(resource.id) }}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal (only for manager/admin) -->
    <AppModal v-if="!auth.isBasic" v-model="showModal" :title="editingTs ? '编辑工时' : '新增工时'" width="440px">
      <form @submit.prevent="handleSave">
        <div class="form-group">
          <label class="form-label">人员</label>
          <select v-model="form.resource_id" class="form-input" required>
            <option value="">请选择</option>
            <option v-for="r in resources" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">项目</label>
          <select v-model="form.project_id" class="form-input" required>
            <option value="">请选择</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">日期</label>
            <input v-model="form.date" class="form-input" type="date" required />
          </div>
          <div class="form-group">
            <label class="form-label">工时</label>
            <input v-model.number="form.hours" class="form-input" type="number" min="0.5" max="24" step="0.5" required />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input v-model="form.notes" class="form-input" type="text" placeholder="可选" />
        </div>
        <p v-if="formError" class="form-error">{{ formError }}</p>
      </form>
      <template #footer>
        <button v-if="editingTs" type="button" class="btn btn-danger" @click="handleDelete">删除</button>
        <button type="button" class="btn btn-secondary" @click="showModal = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="handleSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { timesheetApi, bookingApi, resourceApi, projectApi } from '@/api'
import { fmt, CN_DAYS, getMonday, addDays, rangeLabel } from '@/utils/date'
import { truncate, readableColor } from '@/utils'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import AppModal from '@/components/common/AppModal.vue'

const { toast } = useToast()
const auth = useAuthStore()

const weekStart = ref(getMonday(new Date()))
const resources = ref([])
const projects = ref([])
const timesheets = ref([])
const loading = ref(false)
const copying = ref(false)
const saving = ref(false)
const showModal = ref(false)
const editingTs = ref(null)
const formError = ref('')

const form = reactive({ resource_id: '', project_id: '', date: '', hours: 8, notes: '' })

const todayStr = fmt(new Date())
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
const startStr = computed(() => fmt(days.value[0]))
const endStr = computed(() => fmt(days.value[6]))
const periodLabel = computed(() => rangeLabel(days.value))

function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6 }

function timesheetsOnDate(resourceId, date) {
  return timesheets.value.filter(t => t.resource_id === resourceId && t.date === date)
}
function dailyTotal(resourceId, date) {
  const t = timesheets.value
    .filter(x => x.resource_id === resourceId && x.date === date)
    .reduce((s, x) => s + x.hours, 0)
  return t > 0 ? `${t}h` : ''
}
function weekTotal(resourceId) {
  const t = timesheets.value
    .filter(x => x.resource_id === resourceId)
    .reduce((s, x) => s + x.hours, 0)
  return t > 0 ? `${t}h` : '—'
}

async function load() {
  loading.value = true
  try {
    const [ts, res, proj] = await Promise.all([
      timesheetApi.list({ start: startStr.value, end: endStr.value }),
      resourceApi.list(),
      projectApi.list(0),
    ])
    timesheets.value = ts
    resources.value = res
    projects.value = proj
  } finally {
    loading.value = false
  }
}

function prevWeek() { weekStart.value = addDays(weekStart.value, -7); load() }
function nextWeek() { weekStart.value = addDays(weekStart.value, 7); load() }
function goToday() { weekStart.value = getMonday(new Date()); load() }

// ── Copy from schedule ────────────────────────────────────────────
async function copyFromSchedule() {
  copying.value = true
  try {
    const bookings = await bookingApi.list({ start: startStr.value, end: endStr.value })
    let count = 0
    for (const b of bookings) {
      const exists = timesheets.value.some(
        t => t.resource_id === b.resource_id && t.project_id === b.project_id && t.date === b.date
      )
      if (!exists) {
        await timesheetApi.save({
          resource_id: b.resource_id,
          project_id: b.project_id,
          date: b.date,
          hours: b.hours,
          notes: b.notes || '',
        })
        count++
      }
    }
    toast(`已复制 ${count} 条排程工时`)
    await load()
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    copying.value = false
  }
}

// ── Modal ─────────────────────────────────────────────────────────
function openAdd() {
  editingTs.value = null
  Object.assign(form, { resource_id: '', project_id: '', date: startStr.value, hours: 8, notes: '' })
  formError.value = ''
  showModal.value = true
}
function openAddForCell(resourceId, date) {
  editingTs.value = null
  Object.assign(form, { resource_id: resourceId, project_id: '', date, hours: 8, notes: '' })
  formError.value = ''
  showModal.value = true
}
function openEdit(ts) {
  editingTs.value = ts
  Object.assign(form, {
    resource_id: ts.resource_id,
    project_id: ts.project_id,
    date: ts.date,
    hours: ts.hours,
    notes: ts.notes || '',
  })
  formError.value = ''
  showModal.value = true
}

async function handleSave() {
  formError.value = ''
  saving.value = true
  try {
    const payload = {
      resource_id: Number(form.resource_id),
      project_id: Number(form.project_id),
      date: form.date,
      hours: form.hours,
      notes: form.notes,
    }
    if (editingTs.value) {
      await timesheetApi.save({ ...payload, id: editingTs.value.id })
      toast('工时已更新')
    } else {
      await timesheetApi.save(payload)
      toast('工时已添加')
    }
    showModal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!confirm('确认删除该工时记录？')) return
  try {
    await timesheetApi.remove(editingTs.value.id)
    toast('工时已删除')
    showModal.value = false
    await load()
  } catch (e) {
    formError.value = e.message
  }
}

onMounted(load)
</script>

<style scoped>
.timesheets-page { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }
.period-label { font-size: 14px; font-weight: 600; color: var(--text); margin-left: 8px; }
.loading-bar { padding: 8px 16px; font-size: 13px; color: var(--text-secondary); text-align: center; }

.ts-grid-wrap { overflow: auto; flex: 1; }
.ts-table { width: 100%; border-collapse: collapse; }
.ts-table th, .ts-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  font-size: 12px;
  vertical-align: top;
}
.ts-table th { background: var(--surface); font-weight: 600; text-align: center; }
.ts-name-col { min-width: 120px; text-align: left !important; position: sticky; left: 0; z-index: 1; background: var(--surface); }
.ts-day-col { min-width: 80px; }
.ts-total-col { min-width: 60px; text-align: center; }
.day-label { font-size: 10px; color: var(--text-secondary); }
.day-num { font-size: 14px; font-weight: 700; }
.ts-day-col.is-today .day-num { color: var(--primary); }
.ts-day-col.is-weekend, .ts-day-cell.is-weekend { background: var(--weekend-bg, #f9fafb); }

.ts-day-cell { cursor: pointer; position: relative; min-height: 40px; padding-bottom: 18px; }
.ts-day-cell:hover { background: var(--hover); }

.ts-entry {
  border-radius: 3px; padding: 2px 6px;
  font-size: 11px; font-weight: 500;
  margin-bottom: 2px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ts-day-total {
  position: absolute; bottom: 2px; right: 4px;
  font-size: 10px; color: var(--text-secondary);
}
.resource-name { font-size: 13px; font-weight: 600; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-error { color: #ef4444; font-size: 13px; margin-top: 8px; }
.btn-danger { background: #ef4444; color: #fff; border: none; }
.btn-danger:hover { background: #dc2626; }
</style>
