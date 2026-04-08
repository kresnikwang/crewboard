<template>
  <AuthLayout>
    <h2 class="auth-title">注册账号</h2>
    <form @submit.prevent="handleRegister">
      <div class="form-group">
        <label class="form-label">姓名 <span class="required">*</span></label>
        <input v-model="form.name" class="form-input" type="text" placeholder="请输入姓名" required />
      </div>
      <div class="form-group">
        <label class="form-label">手机号</label>
        <input v-model="form.phone" class="form-input" type="tel" placeholder="请输入手机号（可选）" />
      </div>
      <div class="form-group">
        <label class="form-label">邮箱</label>
        <input v-model="form.email" class="form-input" type="email" placeholder="请输入邮箱（可选）" />
      </div>
      <div class="form-group">
        <label class="form-label">密码 <span class="required">*</span></label>
        <input v-model="form.password" class="form-input" type="password" placeholder="至少 6 位" required minlength="6" />
      </div>
      <p v-if="error" class="auth-error">{{ error }}</p>
      <button type="submit" class="btn btn-primary btn-full" :disabled="loading">
        {{ loading ? '注册中…' : '注册' }}
      </button>
    </form>
    <p class="auth-switch">
      已有账号？<RouterLink to="/login">立即登录</RouterLink>
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

const form = reactive({ name: '', phone: '', email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function handleRegister() {
  error.value = ''
  if (!form.phone && !form.email) {
    error.value = '请填写手机号或邮箱'
    return
  }
  loading.value = true
  try {
    await auth.register({
      name: form.name,
      phone: form.phone || undefined,
      email: form.email || undefined,
      password: form.password,
    })
    router.push('/')
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
.required { color: #ef4444; }
.btn-full { width: 100%; margin-top: 8px; }
</style>
