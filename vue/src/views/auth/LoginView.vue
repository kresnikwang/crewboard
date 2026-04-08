<template>
  <AuthLayout>
    <div class="auth-view active">
      <div class="auth-card-header">
        <h1>欢迎回来</h1>
        <p>登录您的账号以继续使用神马排班</p>
      </div>
      <div class="auth-form active">
        <div class="form-group">
          <label>手机号 / 邮箱</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/>
              <path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="account" type="text" class="text-input" placeholder="请输入手机号或邮箱" @keyup.enter="handleLogin" />
          </div>
        </div>
        <div class="form-group">
          <label>密码</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="password" type="password" class="text-input" placeholder="请输入密码" @keyup.enter="handleLogin" />
          </div>
        </div>
        <button class="btn btn-primary btn-block" :disabled="loading" @click="handleLogin">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <div class="auth-hint">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="vertical-align:-2px;margin-right:4px">
            <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
            <path d="M10 9v5M10 6.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          演示账号: admin@company.com / admin123
        </div>
      </div>
      <div v-if="error" class="auth-error">{{ error }}</div>
      <div class="auth-switch">
        还没有账号？<a href="#" @click.prevent="$router.push('/register')">立即注册</a>
      </div>
    </div>
  </AuthLayout>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AuthLayout from './AuthLayout.vue'

const router = useRouter()
const auth = useAuthStore()

const account = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  if (!account.value || !password.value) {
    error.value = '请填写账号和密码'
    return
  }
  loading.value = true
  try {
    await auth.login({ account: account.value, password: password.value })
    if (auth.mustChangePassword) {
      router.push('/first-login')
    } else {
      router.push('/')
    }
  } catch (e) {
    error.value = e.message || '登录失败，请检查账号密码'
  } finally {
    loading.value = false
  }
}
</script>
