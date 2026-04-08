<template>
  <AuthLayout>
    <div class="auth-view active">
      <div class="auth-card-header">
        <h1>创建账号</h1>
        <p>注册后即可创建或加入企业，开始管理团队资源</p>
      </div>
      <div class="auth-form active">
        <div class="form-group">
          <label>姓名</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/>
              <path d="M3 18c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="form.name" type="text" class="text-input" placeholder="请输入姓名" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>手机号 <span class="label-optional">选填</span></label>
            <div class="input-with-icon">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="5" y="1" width="10" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M9 16h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <input v-model="form.phone" type="text" class="text-input" placeholder="手机号" />
            </div>
          </div>
          <div class="form-group">
            <label>邮箱 <span class="label-optional">选填</span></label>
            <div class="input-with-icon">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M2 6l8 5 8-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <input v-model="form.email" type="email" class="text-input" placeholder="邮箱地址" />
            </div>
          </div>
        </div>
        <div class="auth-field-note">手机号和邮箱请至少填写一项，用于登录</div>
        <div class="form-group">
          <label>密码</label>
          <div class="input-with-icon">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input v-model="form.password" type="password" class="text-input" placeholder="请设置密码（至少6位）" />
          </div>
        </div>
        <button class="btn btn-primary btn-block" :disabled="loading" @click="handleRegister">
          {{ loading ? '注册中...' : '注册' }}
        </button>
      </div>
      <div v-if="error" class="auth-error">{{ error }}</div>
      <div class="auth-switch">
        已有账号？<a href="#" @click.prevent="$router.push('/login')">返回登录</a>
      </div>
    </div>
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
  if (!form.name) { error.value = '请填写姓名'; return }
  if (!form.phone && !form.email) { error.value = '手机号和邮箱请至少填写一项'; return }
  if (!form.password || form.password.length < 6) { error.value = '密码至少6位'; return }
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
    error.value = e.message || '注册失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>
