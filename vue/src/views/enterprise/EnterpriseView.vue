<template>
  <div class="enterprise-page">
    <div class="tab-bar">
      <button v-for="t in tabs" :key="t.key" class="tab-btn" :class="{ active: activeTab === t.key }" @click="activeTab = t.key">
        {{ t.label }}
      </button>
    </div>

    <!-- ── Members ── -->
    <div v-if="activeTab === 'members'" class="tab-content">
      <div class="section-toolbar">
        <h3 class="section-title">成员管理</h3>
        <div class="toolbar-right">
          <button class="btn btn-secondary btn-sm" @click="showBulkModal = true">批量创建账号</button>
          <button class="btn btn-primary btn-sm" @click="showInviteModal = true">邀请成员</button>
        </div>
      </div>
      <div v-if="loadingMembers" class="loading-bar">加载中…</div>
      <div v-else class="member-list">
        <div v-for="m in members" :key="m.id" class="member-card">
          <div class="mc-avatar">{{ (m.name || m.email || '?')[0].toUpperCase() }}</div>
          <div class="mc-info">
            <span class="mc-name">{{ m.name || '(未设置)' }}</span>
            <span class="mc-email">{{ m.email || m.phone }}</span>
            <span class="mc-role badge" :class="`badge-${m.role}`">{{ roleLabel(m.role) }}</span>
          </div>
          <div class="mc-actions" v-if="canManage(m)">
            <select class="role-select" :value="m.role" @change="changeRole(m, $event.target.value)">
              <option value="basic">基础用户</option>
              <option value="manager">经理</option>
              <option value="admin">管理员</option>
            </select>
            <button class="btn btn-danger-outline btn-sm" @click="removeMember(m)">移除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Settings ── -->
    <div v-if="activeTab === 'settings'" class="tab-content">
      <h3 class="section-title">企业设置</h3>
      <div class="settings-form">
        <div class="form-group">
          <label class="form-label">企业名称</label>
          <input v-model="settingsForm.name" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">货币</label>
          <select v-model="settingsForm.currency" class="form-input">
            <option value="CNY">人民币 (¥)</option>
            <option value="USD">美元 ($)</option>
            <option value="EUR">欧元 (€)</option>
            <option value="HKD">港币 (HK$)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">主题色</label>
          <div class="theme-swatches">
            <div
              v-for="c in themeColors"
              :key="c.value"
              class="swatch"
              :style="{ background: c.color }"
              :class="{ active: settingsForm.theme_color === c.value }"
              :title="c.label"
              @click="settingsForm.theme_color = c.value"
            ></div>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="settingsSaving" @click="saveSettings">
          {{ settingsSaving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>

    <!-- ── Webhooks ── -->
    <div v-if="activeTab === 'webhooks'" class="tab-content">
      <h3 class="section-title">Webhook 通知</h3>
      <div class="settings-form">
        <div v-for="wh in webhookTypes" :key="wh.key" class="form-group">
          <label class="form-label">{{ wh.label }}</label>
          <input v-model="webhookForm[wh.key]" class="form-input" :placeholder="wh.placeholder" />
        </div>
        <button class="btn btn-primary" :disabled="webhookSaving" @click="saveWebhooks">
          {{ webhookSaving ? '保存中…' : '保存 Webhook' }}
        </button>
      </div>
    </div>

    <!-- ── Invite Modal ── -->
    <AppModal v-model="showInviteModal" title="邀请成员" width="420px">
      <div class="form-group">
        <label class="form-label">邮箱</label>
        <input v-model="inviteEmail" class="form-input" type="email" placeholder="输入邮箱地址" />
      </div>
      <div v-if="inviteCode" class="invite-code-box">
        <span>邀请码：</span>
        <strong>{{ inviteCode }}</strong>
        <button class="btn-link" @click="copyInviteCode">复制</button>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showInviteModal = false">关闭</button>
        <button type="button" class="btn btn-primary" :disabled="inviting" @click="sendInvite">
          {{ inviting ? '发送中…' : '发送邀请' }}
        </button>
      </template>
    </AppModal>

    <!-- ── Permissions Modal ── -->
    <AppModal v-model="showPermModal" :title="`权限设置 — ${editingMember?.name || ''}`" width="480px">
      <div v-if="editingMember" class="perm-list">
        <label class="perm-row" v-for="p in permOptions" :key="p.key">
          <input type="checkbox" v-model="permForm[p.key]" :disabled="editingMember.role === 'owner'" />
          <div class="perm-info">
            <span class="perm-label">{{ p.label }}</span>
            <span class="perm-desc">{{ p.desc }}</span>
          </div>
        </label>

        <!-- PM project assignment -->
        <div v-if="permForm.perm_project_manager" class="pm-projects">
          <label class="form-label">负责项目</label>
          <div class="pm-project-list">
            <label v-for="proj in allProjects" :key="proj.id" class="check-label">
              <input type="checkbox" :value="proj.id" v-model="permForm.managed_project_ids" />
              <span>{{ proj.name }}</span>
            </label>
          </div>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showPermModal = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="permSaving" @click="savePerms">
          {{ permSaving ? '保存中…' : '保存权限' }}
        </button>
      </template>
    </AppModal>

    <!-- ── Bulk Create Modal ── -->
    <AppModal v-model="showBulkModal" title="批量创建账号" width="560px">
      <p class="help-text">每行一个账号，格式：<code>邮箱,姓名,职位,部门</code>（职位和部门可选）</p>
      <textarea v-model="bulkText" class="form-input bulk-textarea" placeholder="zhangsan@co.com,张三,前端工程师,开发组&#10;lisi@co.com,李四,产品经理,产品组" rows="8"></textarea>
      <div class="form-group">
        <label class="form-label">初始密码（留空使用默认密码 Crewboard@2026）</label>
        <input v-model="bulkPassword" class="form-input" type="text" placeholder="Crewboard@2026" />
      </div>
      <div v-if="bulkResult" class="bulk-result">
        <p class="bulk-success">✓ 成功创建 {{ bulkResult.created?.length || 0 }} 个账号</p>
        <p v-if="bulkResult.errors?.length" class="bulk-error">✗ {{ bulkResult.errors.length }} 个失败：{{ bulkResult.errors.map(e => e.reason).join('；') }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showBulkModal = false">关闭</button>
        <button type="button" class="btn btn-primary" :disabled="bulkCreating" @click="doBulkCreate">
          {{ bulkCreating ? '创建中…' : '批量创建' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { enterpriseApi, projectApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import AppModal from '@/components/common/AppModal.vue'

const auth = useAuthStore()
const { toast } = useToast()

const tabs = [
  { key: 'members', label: '成员' },
  { key: 'settings', label: '企业设置' },
  { key: 'webhooks', label: 'Webhook' },
]
const activeTab = ref('members')

// ── Members ───────────────────────────────────────────────────────
const members = ref([])
const loadingMembers = ref(false)
const allProjects = ref([])

async function loadMembers() {
  loadingMembers.value = true
  try {
    members.value = await enterpriseApi.listMembers()
    allProjects.value = await projectApi.list(0)
  } finally { loadingMembers.value = false }
}

function roleLabel(r) { return { owner: '管理员', admin: '管理员', manager: '经理', member: '基础用户', basic: '基础用户' }[r] || r }
function canManage(m) { return auth.isAdmin && m.id !== auth.user?.id }

async function changeRole(m, newRole) {
  try {
    await enterpriseApi.updateMemberRole(m.id, newRole)
    m.role = newRole
    toast(`已将 ${m.name || m.email} 设为${roleLabel(newRole)}`)
  } catch (e) { toast(e.response?.data?.error || e.message, 'error'); await loadMembers() }
}

async function removeMember(m) {
  if (!confirm(`确认移除成员「${m.name || m.email}」？`)) return
  try {
    await enterpriseApi.removeMember(m.id)
    toast('成员已移除')
    await loadMembers()
  } catch (e) { toast(e.message, 'error') }
}

// ── Invite ────────────────────────────────────────────────────────
const showInviteModal = ref(false)
const inviteEmail = ref('')
const inviteCode = ref('')
const inviting = ref(false)

async function sendInvite() {
  inviting.value = true
  try {
    const res = await enterpriseApi.invite(inviteEmail.value)
    inviteCode.value = res.invite_code || ''
    toast('邀请已发送')
  } catch (e) { toast(e.message, 'error') }
  finally { inviting.value = false }
}

function copyInviteCode() {
  navigator.clipboard.writeText(inviteCode.value)
  toast('邀请码已复制')
}

// ── Role descriptions ─────────────────────────────────────────────
// basic  : 只读，查看排程/工时/报表
// manager: 可创建排程/项目，只能编辑自己创建的内容
// admin  : 全权，包含用户管理

// ── Settings ──────────────────────────────────────────────────────
const settingsForm = reactive({ name: '', currency: 'CNY', theme_color: 'indigo' })
const settingsSaving = ref(false)
const themeColors = [
  { value: 'indigo', label: '靛蓝', color: '#6366f1' },
  { value: 'blue', label: '蓝色', color: '#3b82f6' },
  { value: 'violet', label: '紫色', color: '#8b5cf6' },
  { value: 'rose', label: '玫瑰', color: '#f43f5e' },
  { value: 'orange', label: '橙色', color: '#f97316' },
  { value: 'green', label: '绿色', color: '#22c55e' },
  { value: 'teal', label: '青色', color: '#14b8a6' },
  { value: 'sky', label: '天蓝', color: '#0ea5e9' },
  { value: 'pink', label: '粉色', color: '#ec4899' },
  { value: 'amber', label: '琥珀', color: '#f59e0b' },
  { value: 'slate', label: '石板', color: '#64748b' },
  { value: 'emerald', label: '翡翠', color: '#10b981' },
]

async function loadSettings() {
  try {
    const e = await enterpriseApi.getInfo()
    Object.assign(settingsForm, { name: e.name || '', currency: e.currency || 'CNY', theme_color: e.theme_color || 'indigo' })
  } catch {}
}

async function saveSettings() {
  settingsSaving.value = true
  try {
    await enterpriseApi.updateSettings(settingsForm)
    toast('设置已保存')
  } catch (e) { toast(e.message, 'error') }
  finally { settingsSaving.value = false }
}

// ── Webhooks ──────────────────────────────────────────────────────
const webhookForm = reactive({ dingtalk: '', wecom: '', feishu: '' })
const webhookSaving = ref(false)
const webhookTypes = [
  { key: 'dingtalk', label: '钉钉 Webhook', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...' },
  { key: 'wecom', label: '企业微信 Webhook', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' },
  { key: 'feishu', label: '飞书 Webhook', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...' },
]

async function loadWebhooks() {
  try {
    const w = await enterpriseApi.getWebhooks()
    Object.assign(webhookForm, { dingtalk: w.dingtalk || '', wecom: w.wecom || '', feishu: w.feishu || '' })
  } catch {}
}

async function saveWebhooks() {
  webhookSaving.value = true
  try {
    await enterpriseApi.updateWebhooks(webhookForm)
    toast('Webhook 已保存')
  } catch (e) { toast(e.message, 'error') }
  finally { webhookSaving.value = false }
}

// ── Bulk Create ───────────────────────────────────────────────────
const showBulkModal = ref(false)
const bulkText = ref('')
const bulkPassword = ref('')
const bulkCreating = ref(false)
const bulkResult = ref(null)

async function doBulkCreate() {
  const lines = bulkText.value.trim().split('\n').filter(Boolean)
  const members_list = lines.map(line => {
    const [email, name, title, team] = line.split(',').map(s => s.trim())
    return { email, name, title, team }
  })
  bulkCreating.value = true
  bulkResult.value = null
  try {
    const res = await enterpriseApi.bulkCreate({
      members: members_list,
      initial_password: bulkPassword.value || undefined,
    })
    bulkResult.value = res
    toast(`成功创建 ${res.created?.length || 0} 个账号`)
    await loadMembers()
  } catch (e) { toast(e.message, 'error') }
  finally { bulkCreating.value = false }
}

onMounted(() => {
  loadMembers()
  loadSettings()
  loadWebhooks()
})
</script>

<style scoped>
.enterprise-page { display: flex; flex-direction: column; height: 100%; }
.tab-bar { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
.tab-btn { padding: 10px 20px; font-size: 14px; font-weight: 500; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-secondary); transition: all .15s; }
.tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
.tab-btn:hover { color: var(--text); }

.tab-content { flex: 1; overflow: auto; padding: 20px; }
.section-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-title { font-size: 16px; font-weight: 700; margin: 0 0 16px; }
.toolbar-right { display: flex; gap: 8px; }
.loading-bar { padding: 8px; text-align: center; font-size: 13px; color: var(--text-secondary); }

.member-list { display: flex; flex-direction: column; gap: 8px; }
.member-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.mc-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
.mc-info { flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mc-name { font-size: 14px; font-weight: 600; }
.mc-email { font-size: 12px; color: var(--text-secondary); }
.mc-role { font-size: 11px; }
.mc-actions { display: flex; gap: 6px; }
.badge { border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 500; }
.badge-owner { background: #ede9fe; color: #7c3aed; }
.badge-admin { background: #ede9fe; color: #7c3aed; }
.badge-manager { background: #fef3c7; color: #d97706; }
.badge-member { background: #f3f4f6; color: #374151; }
.badge-basic { background: #f3f4f6; color: #374151; }
.role-select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: var(--surface); cursor: pointer; }

.settings-form { max-width: 500px; display: flex; flex-direction: column; gap: 16px; }
.theme-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.swatch { width: 28px; height: 28px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: transform .1s; }
.swatch:hover { transform: scale(1.15); }
.swatch.active { border-color: var(--text); transform: scale(1.15); }

.perm-list { display: flex; flex-direction: column; gap: 12px; }
.perm-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.perm-info { display: flex; flex-direction: column; gap: 2px; }
.perm-label { font-size: 14px; font-weight: 500; }
.perm-desc { font-size: 12px; color: var(--text-secondary); }
.pm-projects { margin-top: 8px; padding: 12px; background: var(--hover); border-radius: 8px; }
.pm-project-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; max-height: 180px; overflow-y: auto; }
.check-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }

.invite-code-box { margin-top: 12px; padding: 10px 14px; background: var(--hover); border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
.btn-link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 12px; }

.bulk-textarea { font-family: monospace; font-size: 12px; resize: vertical; }
.help-text { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.bulk-result { margin-top: 10px; }
.bulk-success { color: #065f46; font-size: 13px; }
.bulk-error { color: #ef4444; font-size: 13px; }
.btn-danger-outline { border: 1px solid #ef4444; color: #ef4444; background: none; }
.btn-danger-outline:hover { background: #fef2f2; }
</style>
