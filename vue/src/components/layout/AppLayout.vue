<template>
  <div class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img src="/img/logo.svg" alt="crewboard" class="logo-img" />
        <span class="logo-text">Crewboard</span>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info" @click="showUserMenu = !showUserMenu">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-meta">
            <span class="user-name">{{ auth.user?.name || auth.user?.email }}</span>
            <span class="user-role">{{ roleLabel }}</span>
          </div>
          <span class="chevron">⌄</span>
        </div>
        <div v-if="showUserMenu" class="user-menu">
          <button class="menu-item" @click="goProfile">个人设置</button>
          <button class="menu-item danger" @click="logout">退出登录</button>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <main class="main-content">
      <RouterView />
    </main>
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
  { to: '/schedule', icon: '📅', label: '资源排程' },
  { to: '/timesheets', icon: '⏱️', label: '工时填报' },
  { to: '/reports', icon: '📊', label: '数据报表' },
  { to: '/manage', icon: '👥', label: '人员 & 项目' },
  { to: '/enterprise', icon: '🏢', label: '企业管理' },
]

const userInitial = computed(() => {
  const n = auth.user?.name || auth.user?.email || '?'
  return n[0].toUpperCase()
})

const roleLabel = computed(() => {
  return { owner: '所有者', admin: '管理员', member: '成员' }[auth.user?.role] || ''
})

function isActive(path) { return route.path.startsWith(path) }

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
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 200px;
  min-width: 200px;
  background: var(--sidebar-bg, #1e1e2e);
  color: #fff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255,255,255,.08);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.logo-img { width: 28px; height: 28px; }
.logo-text { font-size: 16px; font-weight: 700; color: #fff; }

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: rgba(255,255,255,.65);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all .15s;
}
.nav-item:hover { background: rgba(255,255,255,.08); color: #fff; }
.nav-item.active { background: var(--primary, #6366f1); color: #fff; }
.nav-icon { font-size: 15px; width: 20px; text-align: center; }

.sidebar-footer {
  padding: 12px 8px;
  border-top: 1px solid rgba(255,255,255,.08);
  position: relative;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background .15s;
}
.user-info:hover { background: rgba(255,255,255,.08); }
.user-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--primary, #6366f1);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.user-meta { flex: 1; min-width: 0; }
.user-name { display: block; font-size: 12px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-role { font-size: 10px; color: rgba(255,255,255,.5); }
.chevron { font-size: 12px; color: rgba(255,255,255,.5); }

.user-menu {
  position: absolute;
  bottom: 60px; left: 8px; right: 8px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,.15);
  overflow: hidden;
  z-index: 100;
}
.menu-item {
  display: block; width: 100%;
  padding: 10px 14px;
  text-align: left;
  background: none; border: none;
  font-size: 13px; color: var(--text);
  cursor: pointer;
}
.menu-item:hover { background: var(--hover); }
.menu-item.danger { color: #ef4444; }

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg, #f8fafc);
}
</style>
