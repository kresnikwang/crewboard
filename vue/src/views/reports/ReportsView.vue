<template>
  <div class="reports-page">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="preset-btns">
          <button
            v-for="p in presets"
            :key="p.key"
            class="btn btn-sm"
            :class="activePreset === p.key ? 'btn-primary' : 'btn-secondary'"
            @click="applyPreset(p.key)"
          >{{ p.label }}</button>
        </div>
        <input v-model="startDate" type="date" class="form-input date-input" @change="activePreset = ''; loadReports()" />
        <span class="sep">—</span>
        <input v-model="endDate" type="date" class="form-input date-input" @change="activePreset = ''; loadReports()" />
      </div>
      <div class="toolbar-right">
        <div class="tab-btns">
          <button
            class="btn btn-sm"
            :class="tab === 'utilization' ? 'btn-primary' : 'btn-secondary'"
            @click="tab = 'utilization'"
          >利用率</button>
          <button
            class="btn btn-sm"
            :class="tab === 'projects' ? 'btn-primary' : 'btn-secondary'"
            @click="tab = 'projects'"
          >项目</button>
        </div>
        <button class="btn btn-secondary btn-sm" @click="exportExcel">导出 Excel</button>
      </div>
    </div>

    <div v-if="loading" class="loading-bar">加载中…</div>

    <div v-else class="reports-body">
      <!-- ── Utilization Tab ── -->
      <template v-if="tab === 'utilization'">
        <!-- Chart -->
        <div class="chart-row">
          <div class="chart-card">
            <h4 class="chart-title">团队利用率</h4>
            <canvas ref="barChartRef" height="160"></canvas>
          </div>
          <div class="chart-card">
            <h4 class="chart-title">工时构成</h4>
            <canvas ref="pieChartRef" height="160"></canvas>
          </div>
        </div>

        <!-- Summary cards -->
        <div class="summary-cards">
          <div class="summary-card">
            <span class="sc-label">工作日</span>
            <span class="sc-value">{{ utilSummary.working_days }}</span>
          </div>
          <div class="summary-card">
            <span class="sc-label">总可用工时</span>
            <span class="sc-value">{{ utilSummary.total_available }}h</span>
          </div>
          <div class="summary-card">
            <span class="sc-label">总排程工时</span>
            <span class="sc-value">{{ utilSummary.total_booked }}h</span>
          </div>
          <div class="summary-card">
            <span class="sc-label">平均利用率</span>
            <span class="sc-value" :class="utilClass(utilSummary.avg_utilization)">
              {{ utilSummary.avg_utilization }}%
            </span>
          </div>
        </div>

        <!-- Table -->
        <table class="report-table">
          <thead>
            <tr>
              <th>人员</th>
              <th>可用工时</th>
              <th>排程工时</th>
              <th>实际工时</th>
              <th>利用率</th>
              <th>利用率条</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in utilRows" :key="row.resource_id">
              <tr class="report-row" @click="toggleDrill('util', row.resource_id)">
                <td>
                  <span class="drill-icon">{{ drillOpen.util === row.resource_id ? '▼' : '▶' }}</span>
                  {{ row.name }}
                </td>
                <td>{{ row.available_hours }}h</td>
                <td>{{ row.booked_hours }}h</td>
                <td>{{ row.actual_hours }}h</td>
                <td :class="utilClass(row.utilization)">{{ row.utilization }}%</td>
                <td>
                  <div class="util-bar-wrap">
                    <div class="util-bar" :style="{ width: Math.min(row.utilization, 100) + '%' }" :class="utilClass(row.utilization)"></div>
                  </div>
                </td>
              </tr>
              <!-- Drill-down row -->
              <tr v-if="drillOpen.util === row.resource_id" class="drill-row">
                <td colspan="6">
                  <div v-if="drillLoading" class="drill-loading">加载中…</div>
                  <table v-else class="drill-table">
                    <thead><tr><th>项目</th><th>排程工时</th><th>实际工时</th></tr></thead>
                    <tbody>
                      <tr v-for="d in drillData" :key="d.project_id">
                        <td>{{ d.project_name }}</td>
                        <td>{{ d.booked_hours }}h</td>
                        <td>{{ d.actual_hours }}h</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>

      <!-- ── Projects Tab ── -->
      <template v-else>
        <!-- Chart -->
        <div class="chart-row">
          <div class="chart-card">
            <h4 class="chart-title">预算消耗</h4>
            <canvas ref="budgetChartRef" height="160"></canvas>
          </div>
          <div class="chart-card">
            <h4 class="chart-title">排程 vs 实际</h4>
            <canvas ref="compareChartRef" height="160"></canvas>
          </div>
        </div>

        <!-- Table -->
        <table class="report-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>预算工时</th>
              <th>排程工时</th>
              <th>实际工时</th>
              <th>预算进度</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in projRows" :key="row.project_id">
              <tr class="report-row" @click="toggleDrill('proj', row.project_id)">
                <td>
                  <span class="drill-icon">{{ drillOpen.proj === row.project_id ? '▼' : '▶' }}</span>
                  <span class="proj-dot" :style="{ background: row.color }"></span>
                  {{ row.name }}
                  <span v-if="row.budget_pct > 100" class="badge-overrun">超支</span>
                </td>
                <td>{{ row.budget_hours > 0 ? row.budget_hours + 'h' : '—' }}</td>
                <td>{{ row.booked_hours }}h</td>
                <td>{{ row.actual_hours }}h</td>
                <td>
                  <div v-if="row.budget_hours > 0" class="util-bar-wrap">
                    <div
                      class="util-bar"
                      :style="{ width: Math.min(row.budget_pct, 100) + '%' }"
                      :class="row.budget_pct > 90 ? 'util-high' : 'util-ok'"
                    ></div>
                    <span class="util-pct">{{ row.budget_pct }}%</span>
                  </div>
                  <span v-else class="text-muted">—</span>
                </td>
              </tr>
              <!-- Drill-down -->
              <tr v-if="drillOpen.proj === row.project_id" class="drill-row">
                <td colspan="5">
                  <div v-if="drillLoading" class="drill-loading">加载中…</div>
                  <table v-else class="drill-table">
                    <thead><tr><th>人员</th><th>排程工时</th><th>实际工时</th></tr></thead>
                    <tbody>
                      <tr v-for="d in drillData" :key="d.resource_id">
                        <td>{{ d.name }}</td>
                        <td>{{ d.booked_hours }}h</td>
                        <td>{{ d.actual_hours }}h</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { reportApi } from '@/api'
import { fmt, getPresetRange } from '@/utils/date'
import { downloadBlob } from '@/utils'
import { useToast } from '@/composables/useToast'

Chart.register(...registerables)
const { toast } = useToast()

// ── Date range ────────────────────────────────────────────────────
const today = new Date()
const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0)
const startDate = ref(fmt(firstDay))
const endDate = ref(fmt(lastDay))
const activePreset = ref('this_month')
const tab = ref('utilization')
const loading = ref(false)

const presets = [
  { key: 'this_week', label: '本周' },
  { key: 'last_week', label: '上周' },
  { key: 'this_month', label: '本月' },
  { key: 'last_month', label: '上月' },
  { key: 'this_quarter', label: '本季度' },
  { key: 'this_year', label: '今年' },
]

function applyPreset(key) {
  const r = getPresetRange(key)
  if (!r) return
  startDate.value = r.start
  endDate.value = r.end
  activePreset.value = key
  loadReports()
}

// ── Data ──────────────────────────────────────────────────────────
const utilRows = ref([])
const utilSummary = ref({ working_days: 0, total_available: 0, total_booked: 0, avg_utilization: 0 })
const projRows = ref([])

// ── Drill-down ────────────────────────────────────────────────────
const drillOpen = reactive({ util: null, proj: null })
const drillData = ref([])
const drillLoading = ref(false)

async function toggleDrill(type, id) {
  if (type === 'util') {
    if (drillOpen.util === id) { drillOpen.util = null; return }
    drillOpen.util = id
    drillOpen.proj = null
    drillLoading.value = true
    try {
      drillData.value = await reportApi.resourceDrill(id, startDate.value, endDate.value)
    } finally { drillLoading.value = false }
  } else {
    if (drillOpen.proj === id) { drillOpen.proj = null; return }
    drillOpen.proj = id
    drillOpen.util = null
    drillLoading.value = true
    try {
      drillData.value = await reportApi.projectDrill(id, startDate.value, endDate.value)
    } finally { drillLoading.value = false }
  }
}

// ── Charts ────────────────────────────────────────────────────────
const barChartRef = ref(null)
const pieChartRef = ref(null)
const budgetChartRef = ref(null)
const compareChartRef = ref(null)
let charts = {}

function destroyCharts() {
  Object.values(charts).forEach(c => c?.destroy())
  charts = {}
}

function renderUtilCharts() {
  destroyCharts()
  if (!barChartRef.value || !pieChartRef.value) return

  const labels = utilRows.value.map(r => r.name)
  const utils = utilRows.value.map(r => r.utilization)
  const booked = utilRows.value.map(r => r.booked_hours)
  const actual = utilRows.value.map(r => r.actual_hours)

  charts.bar = new Chart(barChartRef.value, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: '利用率 %', data: utils, backgroundColor: '#6366f1', borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { max: 120, ticks: { callback: v => v + '%' } } },
    },
  })

  const totalBooked = booked.reduce((a, b) => a + b, 0)
  const totalActual = actual.reduce((a, b) => a + b, 0)
  charts.pie = new Chart(pieChartRef.value, {
    type: 'doughnut',
    data: {
      labels: ['排程工时', '实际工时'],
      datasets: [{ data: [totalBooked, totalActual], backgroundColor: ['#6366f1', '#10b981'] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  })
}

function renderProjCharts() {
  destroyCharts()
  if (!budgetChartRef.value || !compareChartRef.value) return

  const rows = projRows.value.slice(0, 10)
  const labels = rows.map(r => r.name.length > 8 ? r.name.slice(0, 8) + '…' : r.name)

  charts.budget = new Chart(budgetChartRef.value, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '预算', data: rows.map(r => r.budget_hours), backgroundColor: '#e5e7eb', borderRadius: 4 },
        { label: '排程', data: rows.map(r => r.booked_hours), backgroundColor: '#6366f1', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
    },
  })

  charts.compare = new Chart(compareChartRef.value, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '排程', data: rows.map(r => r.booked_hours), backgroundColor: '#6366f1', borderRadius: 4 },
        { label: '实际', data: rows.map(r => r.actual_hours), backgroundColor: '#10b981', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
    },
  })
}

// ── Load ──────────────────────────────────────────────────────────
async function loadReports() {
  loading.value = true
  drillOpen.util = null
  drillOpen.proj = null
  try {
    const [util, proj] = await Promise.all([
      reportApi.utilization(startDate.value, endDate.value),
      reportApi.projects(startDate.value, endDate.value),
    ])
    utilRows.value = util.rows || util.data || []
    utilSummary.value = util.summary || {}
    projRows.value = proj.rows || proj.data || []
    await nextTick()
    if (tab.value === 'utilization') renderUtilCharts()
    else renderProjCharts()
  } finally {
    loading.value = false
  }
}

watch(tab, async () => {
  await nextTick()
  if (tab.value === 'utilization') renderUtilCharts()
  else renderProjCharts()
})

function utilClass(v) {
  if (v >= 90) return 'util-high'
  if (v >= 60) return 'util-ok'
  return 'util-low'
}

async function exportExcel() {
  try {
    const blob = await reportApi.exportExcel(tab.value, startDate.value, endDate.value)
    downloadBlob(blob, `report_${tab.value}_${startDate.value}.xlsx`)
  } catch (e) {
    toast(e.message, 'error')
  }
}

onMounted(loadReports)
</script>

<style scoped>
.reports-page { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.preset-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.date-input { width: 130px; }
.sep { color: var(--text-secondary); }
.tab-btns { display: flex; gap: 4px; }
.loading-bar { padding: 8px; text-align: center; font-size: 13px; color: var(--text-secondary); }

.reports-body { flex: 1; overflow: auto; padding: 16px; }

.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.chart-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px;
}
.chart-title { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: var(--text); }

.summary-cards { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.summary-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 18px;
  display: flex; flex-direction: column; gap: 4px; min-width: 120px;
}
.sc-label { font-size: 11px; color: var(--text-secondary); }
.sc-value { font-size: 20px; font-weight: 700; color: var(--text); }

.report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.report-table th, .report-table td {
  border: 1px solid var(--border); padding: 8px 12px; text-align: left;
}
.report-table th { background: var(--surface); font-weight: 600; }
.report-row { cursor: pointer; }
.report-row:hover { background: var(--hover); }
.drill-icon { font-size: 10px; margin-right: 6px; color: var(--text-secondary); }
.proj-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.badge-overrun { background: #ef4444; color: #fff; font-size: 10px; border-radius: 3px; padding: 1px 5px; margin-left: 6px; }

.util-bar-wrap { position: relative; background: var(--border); border-radius: 4px; height: 8px; width: 100%; }
.util-bar { height: 8px; border-radius: 4px; transition: width .3s; }
.util-pct { position: absolute; right: 0; top: -14px; font-size: 10px; color: var(--text-secondary); }
.util-high { background: #ef4444; color: #ef4444; }
.util-ok  { background: #10b981; color: #10b981; }
.util-low { background: #f59e0b; color: #f59e0b; }

.drill-row td { background: var(--hover); padding: 10px 16px; }
.drill-loading { font-size: 13px; color: var(--text-secondary); }
.drill-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.drill-table th, .drill-table td { border: 1px solid var(--border); padding: 6px 10px; }
.drill-table th { background: var(--surface); font-weight: 600; }
.text-muted { color: var(--text-secondary); }
</style>
