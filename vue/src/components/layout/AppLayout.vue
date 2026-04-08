<template>
  <div class="app" :class="themeClass">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <img src="/img/logo.svg" alt="crewboard" width="24" height="24" />
          <span>Crewboard</span>
        </div>
      </div>

      <ul class="nav-menu">
        <li
          v-for="item in navItems"
          :key="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
          @click="router.push(item.to)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="item.icon"></svg>
          <span>{{ item.label }}</span>
        </li>
      </ul>

      <div class="sidebar-footer">
        <div class="sidebar-user-row" style="cursor:pointer" @click="showUserMenu = !showUserMenu">
          <div class="sidebar-avatar-text">{{ userInitial }}</div>
          <div class="user-info" style="margin-bottom:0;flex:1;min-width:0">
            <strong>{{ auth.user?.name || auth.user?.email }}</strong><br />
            <span style="font-size:11px;opacity:.6">{{ roleLabel }}</span>
          </div>
        </div>
        <div v-if="auth.enterprise" class="sidebar-enterprise">{{ auth.enterprise.name }}</div>
        <div v-if="showUserMenu" class="user-dropdown">
          <button class="user-dropdown-item" @click="goProfile">个人设置</button>
          <button class="user-dropdown-item danger" @click="logout">退出登录</button>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="main-content">
      <RouterView />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const showUserMenu = ref(false)

const navItems = [
  {
    to: '/schedule',
    label: '资源排程',
    icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
  },
  {
    to: '/timesheets',
    label: '工时填报',
    icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  },
  {
    to: '/reports',
    label: '数据报表',
    icon: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
  },
  {
    to: '/manage',
    label: '人员 & 项目',
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  },
  {
    to: '/enterprise',
    label: '企业管理',
    icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>',
  },
]

const userInitial = computed(() => {
  const n = auth.user?.name || auth.user?.email || '?'
  return n[0].toUpperCase()
})

const roleLabel = computed(() => {
  return { owner: '所有者', admin: '管理员', member: '成员' }[auth.user?.role] || ''
})

const themeClass = computed(() => {
  const t = auth.enterprise?.theme_color
  return t ? `theme-${t}` : ''
})

function isActive(path) {
  return route.path.startsWith(path)
}

function goProfile() {
  showUserMenu.value = false
  router.push('/profile')
}

async function logout() {
  showUserMenu.value = false
  await auth.logout()
  router.push('/login')
}
</script>

<style scoped>
/* User dropdown (not in original, minimal addition) */
.user-dropdown {
  margin-top: 6px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,.12);
}
.user-dropdown-item {
  display: block; width: 100%;
  padding: 9px 14px; text-align: left;
  background: none; border: none;
  font-size: 13px; color: var(--text);
  cursor: pointer; font-family: var(--font);
}
.user-dropdown-item:hover { background: var(--bg); }
.user-dropdown-item.danger { color: #EF4444; }
</style>
