<template>
  <AuthLayout>
    <h2 class="auth-title">登录</h2>
    <form @submit.prevent="handleLogin">
      <div class="form-group">
        <label class="form-label">手机号或邮箱</label>
        <input v-model="form.identifier" class="form-input" type="text" placeholder="请输入手机号或邮箱" required />
      </div>
      <div class="form-group">
        <label class="form-label">密码</label>
        <input v-model="form.password" class="form-input" type="password" placeholder="请输入密码" required />
      </div>
      <p v-if="error" class="auth-error">{{ error }}</p>
      <button type="submit" class="btn btn-primary btn-full" :disabled="loading">
        {{ loading ? '登录中…' : '登录' }}
      </button>
    </form>
    <p class="auth-switch">
      还没有账号？<RouterLink to="/register">立即注册</RouterLink>
    </p>
  </AuthLayout>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AuthLayout from './AuthLayout.vue'

const router = useRouter()
const auth = useAuthStore()

const form = reactive({ identifier: '', password: '' })
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const payload = form.identifier.includes('@')
      ? { email: form.identifier, password: form.password }
      : { phone: form.identifier, password: form.password }
    await auth.login(payload)
    if (auth.mustChangePassword) {
      router.push('/first-login')
    } else {
      router.push('/')
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-title { font-size: 22px; font-weight: 700; margin: 0 0 22px; color: var(--text); }
.auth-error { color: #ef4444; font-size: 13px; margin: -4px 0 10px; }
.auth-switch { margin-top: 18px; text-align: center; font-size: 13px; color: var(--text-secondary); }
.auth-switch a { color: var(--primary); text-decoration: none; font-weight: 500; }
.btn-full { width: 100%; margin-top: 8px; }
</style>
