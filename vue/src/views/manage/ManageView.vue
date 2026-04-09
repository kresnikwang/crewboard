<template>
  <div class="manage-page">
    <!-- Tab bar -->
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- ── Resources ── -->
    <div v-if="activeTab === 'resources'" class="tab-content">
      <div class="section-toolbar">
        <h3 class="section-title">人员管理</h3>
        <button v-if="auth.isAdmin" class="btn btn-primary btn-sm" @click="openResourceModal()">+ 添加人员</button>
      </div>
      <div v-if="loadingResources" class="loading-bar">加载中…</div>
      <div v-else class="resource-list">
        <div v-for="group in resourceGroups" :key="group.team" class="resource-group">
          <div class="group-header">{{ group.team || '未分组' }}</div>
          <div
            v-for="r in group.members"
            :key="r.id"
            class="resource-card"
          >
            <div class="rc-color" :style="{ background: r.color }"></div>
            <div class="rc-info">
              <span class="rc-name">{{ r.name }}</span>
              <span class="rc-meta">{{ r.role }} · {{ r.team }}</span>
            </div>
            <div v-if="auth.isAdmin" class="rc-actions">
              <button class="btn-icon" @click="openResourceModal(r)">✏️</button>
              <button class="btn-icon" @click="deleteResource(r)">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Clients ── -->
    <div v-if="activeTab === 'clients'" class="tab-content">
      <div class="section-toolbar">
        <h3 class="section-title">客户管理</h3>
        <div class="toolbar-right">
          <label class="check-label">
            <input v-model="showArchivedClients" type="checkbox" @change="loadClients" />
            <span>显示已存档</span>
          </label>
          <button v-if="auth.isAdmin" class="btn btn-primary btn-sm" @click="openClientModal()">+ 添加客户</button>
        </div>
      </div>
      <div v-if="loadingClients" class="loading-bar">加载中…</div>
      <table v-else class="manage-table">
        <thead><tr><th>客户名称</th><th>状态</th><th v-if="auth.isAdmin">操作</th></tr></thead>
        <tbody>
          <tr v-for="c in clients" :key="c.id">
            <td>{{ c.name }}</td>
            <td><span class="badge" :class="c.archived ? 'badge-archived' : 'badge-active'">{{ c.archived ? '已存档' : '活跃' }}</span></td>
            <td v-if="auth.isAdmin">
              <button class="btn-link" @click="openClientModal(c)">编辑</button>
              <button class="btn-link" @click="toggleArchiveClient(c)">{{ c.archived ? '取消存档' : '存档' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Projects ── -->
    <div v-if="activeTab === 'projects'" class="tab-content">
      <div class="section-toolbar">
        <h3 class="section-title">项目管理</h3>
        <div class="toolbar-right">
          <label class="check-label">
            <input v-model="showArchivedProjects" type="checkbox" @change="loadProjects" />
            <span>显示已存档</span>
          </label>
          <button v-if="auth.isAdmin" class="btn btn-primary btn-sm" @click="openProjectModal()">+ 添加项目</button>
        </div>
      </div>
      <div v-if="loadingProjects" class="loading-bar">加载中…</div>
      <table v-else class="manage-table">
        <thead><tr><th>项目名称</th><th>客户</th><th>计费</th><th>预算工时</th><th>状态</th><th v-if="auth.isAdmin">操作</th></tr></thead>
        <tbody>
          <tr v-for="p in projects" :key="p.id">
            <td>
              <span class="proj-dot" :style="{ background: p.color }"></span>
              {{ p.name }}
            </td>
            <td>{{ p.client_name || '—' }}</td>
            <td>{{ p.is_billable ? '✓' : '—' }}</td>
            <td>{{ p.budget_hours > 0 ? p.budget_hours + 'h' : '—' }}</td>
            <td><span class="badge" :class="p.archived ? 'badge-archived' : 'badge-active'">{{ p.archived ? '已存档' : '活跃' }}</span></td>
            <td v-if="auth.isAdmin">
              <button class="btn-link" @click="openProjectModal(p)">编辑</button>
              <button class="btn-link" @click="toggleArchiveProject(p)">{{ p.archived ? '取消存档' : '存档' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Resource Modal ── -->
    <AppModal v-if="auth.isAdmin" v-model="showResourceModal" :title="editingResource ? '编辑人员' : '添加人员'" width="440px">
      <form @submit.prevent="saveResource">
        <div class="form-group">
          <label class="form-label">姓名 <span class="req">*</span></label>
          <input v-model="rForm.name" class="form-input" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">职位</label>
            <input v-model="rForm.role" class="form-input" placeholder="如：前端工程师" />
          </div>
          <div class="form-group">
            <label class="form-label">组别</label>
            <input v-model="rForm.team" class="form-input" placeholder="如：开发组" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">每日工时</label>
            <input v-model.number="rForm.daily_hours" class="form-input" type="number" min="1" max="24" />
          </div>
          <div class="form-group">
            <label class="form-label">颜色</label>
            <input v-model="rForm.color" class="form-input" type="color" />
          </div>
        </div>
        <p v-if="rError" class="form-error">{{ rError }}</p>
      </form>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showResourceModal = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="rSaving" @click="saveResource">
          {{ rSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- ── Client Modal ── -->
    <AppModal v-if="auth.isAdmin" v-model="showClientModal" :title="editingClient ? '编辑客户' : '添加客户'" width="400px">
      <form @submit.prevent="saveClient">
        <div class="form-group">
          <label class="form-label">客户名称 <span class="req">*</span></label>
          <input v-model="cForm.name" class="form-input" required />
        </div>
        <p v-if="cError" class="form-error">{{ cError }}</p>
      </form>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showClientModal = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="cSaving" @click="saveClient">保存</button>
      </template>
    </AppModal>

    <!-- ── Project Modal ── -->
    <AppModal v-if="auth.isAdmin" v-model="showProjectModal" :title="editingProject ? '编辑项目' : '添加项目'" width="480px">
      <form @submit.prevent="saveProject">
        <div class="form-group">
          <label class="form-label">项目名称 <span class="req">*</span></label>
          <input v-model="pForm.name" class="form-input" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">客户</label>
            <select v-model="pForm.client_id" class="form-input">
              <option value="">无</option>
              <option v-for="c in allClients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">颜色</label>
            <input v-model="pForm.color" class="form-input" type="color" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">项目编号</label>
            <input v-model="pForm.code" class="form-input" placeholder="可选" />
          </div>
          <div class="form-group">
            <label class="form-label">预算工时</label>
            <input v-model.number="pForm.budget_hours" class="form-input" type="number" min="0" />
          </div>
        </div>
        <div class="form-group">
          <label class="check-label">
            <input v-model="pForm.is_billable" type="checkbox" />
            <span>计费项目</span>
          </label>
        </div>
        <p v-if="pError" class="form-error">{{ pError }}</p>
      </form>
      <template #footer>
        <button v-if="editingProject" type="button" class="btn btn-danger" @click="deleteProject">删除</button>
        <button type="button" class="btn btn-secondary" @click="showProjectModal = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="pSaving" @click="saveProject">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { resourceApi, clientApi, projectApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import AppModal from '@/components/common/AppModal.vue'

const { toast } = useToast()
const auth = useAuthStore()

const tabs = [
  { key: 'resources', label: '人员' },
  { key: 'clients', label: '客户' },
  { key: 'projects', label: '项目' },
]
const activeTab = ref('resources')

// ── Resources ─────────────────────────────────────────────────────
const resources = ref([])
const loadingResources = ref(false)
const showResourceModal = ref(false)
const editingResource = ref(null)
const rSaving = ref(false)
const rError = ref('')
const rForm = reactive({ name: '', role: '', team: '', daily_hours: 8, color: '#8B5CF6' })

const resourceGroups = computed(() => {
  const groups = {}
  resources.value.forEach(r => {
    const t = r.team || ''
    if (!groups[t]) groups[t] = { team: t, members: [] }
    groups[t].members.push(r)
  })
  return Object.values(groups)
})

async function loadResources() {
  loadingResources.value = true
  try { resources.value = await resourceApi.list() }
  finally { loadingResources.value = false }
}

function openResourceModal(r = null) {
  if (!auth.isAdmin) return
  editingResource.value = r
  rError.value = ''
  if (r) Object.assign(rForm, { name: r.name, role: r.role || '', team: r.team || '', daily_hours: r.daily_hours || 8, color: r.color || '#8B5CF6' })
  else Object.assign(rForm, { name: '', role: '', team: '', daily_hours: 8, color: '#8B5CF6' })
  showResourceModal.value = true
}

async function saveResource() {
  rError.value = ''
  rSaving.value = true
  try {
    if (editingResource.value) {
      await resourceApi.update(editingResource.value.id, rForm)
      toast('人员已更新')
    } else {
      await resourceApi.create(rForm)
      toast('人员已添加')
    }
    showResourceModal.value = false
    await loadResources()
  } catch (e) { rError.value = e.message }
  finally { rSaving.value = false }
}

async function deleteResource(r) {
  if (!auth.isAdmin) return
  if (!confirm(`确认删除人员「${r.name}」？`)) return
  try {
    await resourceApi.remove(r.id)
    toast('人员已删除')
    await loadResources()
  } catch (e) { toast(e.message, 'error') }
}

// ── Clients ───────────────────────────────────────────────────────
const clients = ref([])
const allClients = ref([])
const loadingClients = ref(false)
const showArchivedClients = ref(false)
const showClientModal = ref(false)
const editingClient = ref(null)
const cSaving = ref(false)
const cError = ref('')
const cForm = reactive({ name: '' })

async function loadClients() {
  loadingClients.value = true
  try {
    clients.value = await clientApi.list(showArchivedClients.value ? 1 : 0)
    allClients.value = await clientApi.list(0)
  } finally { loadingClients.value = false }
}

function openClientModal(c = null) {
  if (!auth.isAdmin) return
  editingClient.value = c
  cError.value = ''
  cForm.name = c ? c.name : ''
  showClientModal.value = true
}

async function saveClient() {
  cError.value = ''
  cSaving.value = true
  try {
    if (editingClient.value) {
      await clientApi.update(editingClient.value.id, cForm)
      toast('客户已更新')
    } else {
      await clientApi.create(cForm)
      toast('客户已添加')
    }
    showClientModal.value = false
    await loadClients()
  } catch (e) { cError.value = e.message }
  finally { cSaving.value = false }
}

async function toggleArchiveClient(c) {
  if (!auth.isAdmin) return
  try {
    if (c.archived) await clientApi.unarchive(c.id)
    else await clientApi.archive(c.id)
    toast(c.archived ? '已取消存档' : '已存档')
    await loadClients()
  } catch (e) { toast(e.message, 'error') }
}

// ── Projects ──────────────────────────────────────────────────────
const projects = ref([])
const loadingProjects = ref(false)
const showArchivedProjects = ref(false)
const showProjectModal = ref(false)
const editingProject = ref(null)
const pSaving = ref(false)
const pError = ref('')
const pForm = reactive({ name: '', client_id: '', color: '#8B5CF6', code: '', budget_hours: 0, is_billable: false })

async function loadProjects() {
  loadingProjects.value = true
  try { projects.value = await projectApi.list(showArchivedProjects.value ? 1 : 0) }
  finally { loadingProjects.value = false }
}

function openProjectModal(p = null) {
  if (!auth.isAdmin) return
  editingProject.value = p
  pError.value = ''
  if (p) Object.assign(pForm, { name: p.name, client_id: p.client_id || '', color: p.color || '#8B5CF6', code: p.code || '', budget_hours: p.budget_hours || 0, is_billable: !!p.is_billable })
  else Object.assign(pForm, { name: '', client_id: '', color: '#8B5CF6', code: '', budget_hours: 0, is_billable: false })
  showProjectModal.value = true
}

async function saveProject() {
  pError.value = ''
  pSaving.value = true
  try {
    const payload = { ...pForm, is_billable: pForm.is_billable ? 1 : 0 }
    if (editingProject.value) {
      await projectApi.update(editingProject.value.id, payload)
      toast('项目已更新')
    } else {
      await projectApi.create(payload)
      toast('项目已添加')
    }
    showProjectModal.value = false
    await loadProjects()
  } catch (e) { pError.value = e.message }
  finally { pSaving.value = false }
}

async function toggleArchiveProject(p) {
  if (!auth.isAdmin) return
  try {
    if (p.archived) await projectApi.unarchive(p.id)
    else await projectApi.archive(p.id)
    toast(p.archived ? '已取消存档' : '已存档')
    await loadProjects()
  } catch (e) { toast(e.message, 'error') }
}

async function deleteProject() {
  if (!auth.isAdmin) return
  if (!confirm(`确认删除项目「${editingProject.value.name}」？`)) return
  try {
    await projectApi.remove(editingProject.value.id)
    toast('项目已删除')
    showProjectModal.value = false
    await loadProjects()
  } catch (e) { pError.value = e.message }
}

onMounted(() => {
  loadResources()
  loadClients()
  loadProjects()
})
</script>

<style scoped>
.manage-page { display: flex; flex-direction: column; height: 100%; }
.tab-bar {
  display: flex; gap: 0; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.tab-btn {
  padding: 10px 20px; font-size: 14px; font-weight: 500;
  background: none; border: none; border-bottom: 2px solid transparent;
  cursor: pointer; color: var(--text-secondary); transition: all .15s;
}
.tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
.tab-btn:hover { color: var(--text); }

.tab-content { flex: 1; overflow: auto; padding: 20px; }
.section-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-title { font-size: 16px; font-weight: 700; margin: 0; }
.toolbar-right { display: flex; align-items: center; gap: 10px; }
.loading-bar { padding: 8px; text-align: center; font-size: 13px; color: var(--text-secondary); }

/* Resources */
.resource-group { margin-bottom: 20px; }
.group-header { font-size: 12px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
.resource-card {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface); margin-bottom: 6px;
}
.rc-color { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.rc-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rc-name { font-size: 14px; font-weight: 600; color: var(--text); }
.rc-meta { font-size: 12px; color: var(--text-secondary); }
.rc-actions { display: flex; gap: 6px; }
.btn-icon { background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 4px; }
.btn-icon:hover { background: var(--hover); }

/* Table */
.manage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.manage-table th, .manage-table td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.manage-table th { background: var(--surface); font-weight: 600; }
.manage-table tr:hover td { background: var(--hover); }
.proj-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.badge { font-size: 11px; border-radius: 4px; padding: 2px 7px; font-weight: 500; }
.badge-active { background: #d1fae5; color: #065f46; }
.badge-archived { background: #f3f4f6; color: #6b7280; }
.btn-link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 12px; padding: 2px 6px; }
.btn-link:hover { text-decoration: underline; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.check-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
.req { color: #ef4444; }
.form-error { color: #ef4444; font-size: 13px; margin-top: 8px; }
.btn-danger { background: #ef4444; color: #fff; border: none; }
</style>
