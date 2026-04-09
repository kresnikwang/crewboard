import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  // Auth
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { guest: true },
  },
  {
    path: '/first-login',
    name: 'FirstLogin',
    component: () => import('@/views/auth/FirstLoginView.vue'),
    meta: { requiresAuth: true },
  },

  // App shell
  {
    path: '/',
    component: () => import('@/views/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/schedule' },
      {
        path: 'schedule',
        name: 'Schedule',
        component: () => import('@/views/schedule/ScheduleView.vue'),
      },
      {
        path: 'timesheets',
        name: 'Timesheets',
        component: () => import('@/views/timesheets/TimesheetsView.vue'),
      },
      {
        path: 'reports',
        name: 'Reports',
        component: () => import('@/views/reports/ReportsView.vue'),
        meta: { requiresRole: 'manager' },
      },
      {
        path: 'manage',
        name: 'Manage',
        component: () => import('@/views/manage/ManageView.vue'),
        meta: { requiresRole: 'manager' },
      },
      {
        path: 'enterprise',
        name: 'Enterprise',
        component: () => import('@/views/enterprise/EnterpriseView.vue'),
        meta: { requiresRole: 'admin' },
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/views/profile/ProfileView.vue'),
      },
    ],
  },

  // Fallback
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Navigation guard
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Try to restore session once
  if (!auth.user && auth.token) {
    await auth.restoreSession()
  }

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'Login' }
  }
  if (to.meta.guest && auth.isLoggedIn) {
    return { path: '/' }
  }

  // Force first-password change
  if (auth.isLoggedIn && auth.mustChangePassword && to.name !== 'FirstLogin') {
    return { name: 'FirstLogin' }
  }

  // Redirect away from first-login if not needed
  if (to.name === 'FirstLogin' && auth.isLoggedIn && !auth.mustChangePassword) {
    return { path: '/' }
  }

  // Role-based access control
  if (to.meta.requiresRole && auth.isLoggedIn) {
    const role = auth.userRole
    if (to.meta.requiresRole === 'admin' && !auth.isAdmin) {
      return { path: '/schedule' }
    }
    if (to.meta.requiresRole === 'manager' && !auth.isManager) {
      return { path: '/schedule' }
    }
  }
})

export default router
