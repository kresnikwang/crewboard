import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, permApi } from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('crewboard_token') || '')
  const user = ref(null)
  const enterprise = ref(null)
  const permissions = ref({ book_others: false, manage_resources: false, view_reports: false })
  const loading = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const mustChangePassword = computed(() => user.value?.must_change_password === 1)
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role))
  const isOwner = computed(() => user.value?.role === 'owner')

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
    permissions.value = { book_others: false, manage_resources: false, view_reports: false }
  }

  return {
    token, user, enterprise, permissions, loading,
    isLoggedIn, mustChangePassword, isAdmin, isOwner,
    login, register, restoreSession, loadPermissions,
    completeFirstPassword, logout, setToken,
  }
})
