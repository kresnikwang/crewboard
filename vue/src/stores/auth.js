import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, permApi } from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('crewboard_token') || '')
  const user = ref(null)
  const enterprise = ref(null)
  const permissions = ref({
    role: 'basic',
    can_book: false,
    can_manage: false,
    can_view_reports: false,
    can_admin: false,
    resource_id: null,
    // legacy aliases
    book_others: false,
    manage_resources: false,
    view_reports: false,
  })
  const loading = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const mustChangePassword = computed(() => user.value?.must_change_password === 1)

  // New three-role computed helpers
  const userRole = computed(() => user.value?.role || 'basic')
  const isAdmin = computed(() => userRole.value === 'admin' || userRole.value === 'owner')
  const isManager = computed(() => userRole.value === 'manager' || userRole.value === 'admin' || userRole.value === 'owner')
  const isBasic = computed(() => userRole.value === 'basic')

  // Permission shortcuts (derived from permissions API response)
  const canBook = computed(() => permissions.value.can_book || false)
  const canManage = computed(() => permissions.value.can_manage || false)
  const canViewReports = computed(() => permissions.value.can_view_reports || false)
  const canAdmin = computed(() => permissions.value.can_admin || false)

  // Role display label
  const roleLabel = computed(() => {
    const labels = { admin: '管理员', manager: '经理', basic: '基础用户' }
    return labels[userRole.value] || userRole.value
  })

  function setToken(t) {
    token.value = t
    if (t) localStorage.setItem('crewboard_token', t)
    else localStorage.removeItem('crewboard_token')
  }

  async function login(credentials) {
    loading.value = true
    try {
      const res = await authApi.login(credentials)
      setToken(res.token)
      user.value = res.user
      enterprise.value = res.enterprise
      await loadPermissions()
      return res
    } finally {
      loading.value = false
    }
  }

  async function register(data) {
    loading.value = true
    try {
      const res = await authApi.register(data)
      setToken(res.token)
      user.value = res.user
      enterprise.value = res.enterprise
      await loadPermissions()
      return res
    } finally {
      loading.value = false
    }
  }

  async function restoreSession() {
    if (!token.value) return false
    try {
      const res = await authApi.me()
      user.value = res.user
      enterprise.value = res.enterprise
      await loadPermissions()
      return true
    } catch {
      setToken('')
      user.value = null
      enterprise.value = null
      return false
    }
  }

  async function loadPermissions() {
    try {
      permissions.value = await permApi.get()
    } catch { /* ignore */ }
  }

  async function completeFirstPassword(newPassword) {
    await authApi.firstPassword({ new_password: newPassword })
    if (user.value) user.value.must_change_password = 0
  }

  function logout() {
    setToken('')
    user.value = null
    enterprise.value = null
    permissions.value = {
      role: 'basic', can_book: false, can_manage: false,
      can_view_reports: false, can_admin: false, resource_id: null,
      book_others: false, manage_resources: false, view_reports: false,
    }
  }

  return {
    token, user, enterprise, permissions, loading,
    isLoggedIn, mustChangePassword,
    userRole, isAdmin, isManager, isBasic,
    canBook, canManage, canViewReports, canAdmin,
    roleLabel,
    login, register, restoreSession, loadPermissions,
    completeFirstPassword, logout, setToken,
  }
})
