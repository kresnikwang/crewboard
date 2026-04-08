<template>
  <AuthLayout>
    <h2 class="auth-title">设置您的密码</h2>
    <p class="auth-desc">您正在使用初始密码登录，请设置一个新密码以继续使用。</p>
    <div class="user-info">
      <span class="user-name">{{ auth.user?.name }}</span>
      <span class="user-email">{{ auth.user?.email || auth.user?.phone }}</span>
    </div>
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label class="form-label">新密码 <span class="required">*</span></label>
        <input v-model="form.password" class="form-input" type="password" placeholder="至少 6 位" required minlength="6" />
      </div>
      <div class="form-group">
        <label class="form-label">确认密码 <span class="required">*</span></label>
        <input v-model="form.confirm" class="form-input" type="password" placeholder="再次输入新密码" required />
      </div>
      <p v-if="error" class="auth-error">{{ error }}</p>
      <button type="submit" class="btn btn-primary btn-full" :disabled="loading">
        {{ loading ? '保存中…' : '确认设置' }}
      </button>
    </form>
  </AuthLayout>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import AuthLayout from './AuthLayout.vue'

const router = useRouter()
const auth = useAuthStore()
const { toast } = useToast()

const form = reactive({ password: '', confirm: '' })
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  if (form.password !== form.confirm) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    await auth.completeFirstPassword(form.password)
    toast('密码设置成功，欢迎使用！')
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-title { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: var(--text); }
.auth-desc { font-size: 13px; color: var(--text-secondary); margin: 0 0 18px; }
.user-info {
  display: flex; flex-direction: column; gap: 2px;
  background: var(--hover); border-radius: 8px; padding: 10px 14px;
  margin-bottom: 18px;
}
.user-name { font-weight: 600; font-size: 15px; color: var(--text); }
.user-email { font-size: 12px; color: var(--text-secondary); }
.auth-error { color: #ef4444; font-size: 13px; margin: -4px 0 10px; }
.required { color: #ef4444; }
.btn-full { width: 100%; margin-top: 8px; }
</style>
