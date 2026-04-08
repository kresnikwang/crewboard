<template>
  <div class="page-content">
    <div class="page-header">
      <h1>账号管理</h1>
    </div>

    <!-- Personal Info Card -->
    <div class="section-card">
      <h3>个人信息</h3>
      <div class="avatar-upload-section">
        <div class="avatar-preview" @click="triggerFileInput">
          <img v-if="avatarSrc" :src="avatarSrc" class="avatar-preview-img" alt="avatar" />
          <div v-else class="avatar-preview-placeholder">{{ (user.name || '?').charAt(0) }}</div>
          <div class="avatar-upload-overlay">更换</div>
        </div>
        <div class="avatar-upload-info">
          <button class="btn btn-outline btn-sm" @click="triggerFileInput">上传头像</button>
          <input ref="fileInputRef" type="file" accept="image/*" style="display:none" @change="onFileChange" />
          <div class="avatar-hint">支持 JPG/PNG/WebP，自动压缩至 500KB 以内</div>
        </div>
      </div>

      <div class="form-group">
        <label>姓名</label>
        <input v-model="form.name" type="text" class="text-input" placeholder="请输入姓名" />
      </div>
      <div class="form-group">
        <label>手机</label>
        <input v-model="form.phone" type="text" class="text-input" placeholder="未绑定" />
      </div>
      <div class="form-group">
        <label>邮箱</label>
        <input v-model="form.email" type="email" class="text-input" placeholder="未绑定" />
      </div>
      <button class="btn btn-primary" :disabled="savingProfile" @click="saveProfile">
        {{ savingProfile ? '保存中…' : '保存' }}
      </button>
    </div>

    <!-- Change Password Card -->
    <div class="section-card">
      <h3>修改密码</h3>
      <div class="form-group">
        <label>当前密码</label>
        <input v-model="pw.old" type="password" class="text-input" placeholder="请输入当前密码" />
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input v-model="pw.new" type="password" class="text-input" placeholder="至少 6 位" />
      </div>
      <div class="form-group">
        <label>确认新密码</label>
        <input v-model="pw.confirm" type="password" class="text-input" placeholder="再次输入新密码" />
      </div>
      <button class="btn btn-primary" :disabled="savingPw" @click="changePassword">
        {{ savingPw ? '修改中…' : '修改密码' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/index'
import { useToast } from '@/composables/useToast'

const authStore = useAuthStore()
const { toast } = useToast()

const user = computed(() => authStore.user || {})
const avatarSrc = ref('')
const fileInputRef = ref(null)
const savingProfile = ref(false)
const savingPw = ref(false)

const form = reactive({ name: '', phone: '', email: '' })
const pw   = reactive({ old: '', new: '', confirm: '' })

onMounted(() => {
  form.name  = user.value.name  || ''
  form.phone = user.value.phone || ''
  form.email = user.value.email || ''
  avatarSrc.value = user.value.avatar || ''
})

function triggerFileInput() {
  fileInputRef.value && fileInputRef.value.click()
}

function onFileChange(e) {
  const file = e.target.files[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return }
  compressAndUpload(file)
}

function compressAndUpload(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = async () => {
      const canvas = document.createElement('canvas')
      const maxSize = 400
      let w = img.width, h = img.height
      if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize } }
      else        { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize } }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)

      let quality = 0.85
      let dataUrl = canvas.toDataURL('image/jpeg', quality)
      while (dataUrl.length > 700000 && quality > 0.3) {
        quality -= 0.1
        dataUrl = canvas.toDataURL('image/jpeg', quality)
      }

      try {
        const res = await authApi.updateAvatar(dataUrl)
        avatarSrc.value = dataUrl
        authStore.user = { ...authStore.user, avatar: dataUrl }
        toast('头像已更新')
      } catch (err) {
        toast(err.message || '上传失败', 'error')
      }
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

async function saveProfile() {
  if (!form.name.trim()) { toast('请输入姓名', 'error'); return }
  savingProfile.value = true
  try {
    await authApi.updateProfile({ name: form.name, phone: form.phone, email: form.email })
    authStore.user = { ...authStore.user, name: form.name, phone: form.phone, email: form.email }
    toast('个人信息已更新')
  } catch (err) {
    toast(err.message || '保存失败', 'error')
  } finally {
    savingProfile.value = false
  }
}

async function changePassword() {
  if (!pw.old || !pw.new || !pw.confirm) { toast('请填写所有密码字段', 'error'); return }
  if (pw.new !== pw.confirm) { toast('两次输入的新密码不一致', 'error'); return }
  if (pw.new.length < 6) { toast('新密码至少 6 位', 'error'); return }
  savingPw.value = true
  try {
    await authApi.changePassword({ old_password: pw.old, new_password: pw.new })
    toast('密码修改成功')
    pw.old = ''; pw.new = ''; pw.confirm = ''
  } catch (err) {
    toast(err.message || '密码修改失败', 'error')
  } finally {
    savingPw.value = false
  }
}
</script>

<style scoped>
.page-content {
  padding: 24px;
  max-width: 640px;
}
.page-header {
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.section-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  margin-bottom: 20px;
}
.section-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 18px;
}
.avatar-upload-section {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
}
.avatar-preview {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  border: 2px solid var(--border);
}
.avatar-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-preview-placeholder {
  width: 100%;
  height: 100%;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
}
.avatar-upload-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.45);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity .2s;
}
.avatar-preview:hover .avatar-upload-overlay { opacity: 1; }
.avatar-upload-info { display: flex; flex-direction: column; gap: 6px; }
.avatar-hint { font-size: 12px; color: var(--text-secondary); }
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
}
</style>
