<template>
  <AuthLayout>
    <div class="auth-view active">
      <div class="auth-card-header">
        <h1>设置您的密码</h1>
        <p>您正在使用初始密码登录，请立即设置一个专属密码以保障账号安全。</p>
      </div>
      <div v-if="auth.user" class="first-login-user">
        <div class="first-login-avatar" :style="{ background: '#4F46E5' }">
          {{ auth.user.name?.charAt(0) || '?' }}
        </div>
        <div class="first-login-info">
          <div class="first-login-name">{{ auth.user.name }}</div>
          <div class="first-login-email">{{ auth.user.email || auth.user.phone }}</div>
        </div>
      </div>
      <div class="auth-form">
        <div class="form-group">
          <label>新密码</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="form.password" type="password" class="text-input" placeholder="请设置新密码（至少6位）" />
          </div>
        </div>
        <div class="form-group">
          <label>确认新密码</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="form.confirm" type="password" class="text-input" placeholder="再次输入新密码" />
          </div>
        </div>
        <button class="btn btn-primary btn-block" :disabled="loading" @click="handleSubmit">
          {{ loading ? '保存中...' : '确认设置密码' }}
        </button>
      </div>
      <div v-if="error" class="auth-error">{{ error }}</div>
    </div>
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
  if (!form.password || form.password.length < 6) { error.value = '密码至少6位'; return }
  if (form.password !== form.confirm) { error.value = '两次输入的密码不一致'; return }
  loading.value = true
  try {
    await auth.completeFirstPassword(form.password)
    toast('密码设置成功，欢迎使用！')
    router.push('/')
  } catch (e) {
    error.value = e.message || '设置失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.first-login-user {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 20px;
  border: 1px solid var(--border);
}
.first-login-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.first-login-name { font-weight: 600; font-size: 14px; color: var(--text); }
.first-login-email { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
</style>
