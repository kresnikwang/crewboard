<template>
  <AppModal v-model="show" :title="isEdit ? '编辑排程' : '新建排程'" width="480px" @close="onClose">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label class="form-label">人员 <span class="req">*</span></label>
        <select v-model="form.resource_id" class="form-input" required>
          <option value="">请选择人员</option>
          <option v-for="r in resources" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">项目 <span class="req">*</span></label>
        <select v-model="form.project_id" class="form-input" required>
          <option value="">请选择项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input v-model="form.date" class="form-input" type="date" required />
        </div>
        <div class="form-group">
          <label class="form-label">结束日期</label>
          <input v-model="form.end_date" class="form-input" type="date" :min="form.date" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">每日工时</label>
          <input v-model.number="form.hours" class="form-input" type="number" min="0.5" max="24" step="0.5" />
        </div>
        <div class="form-group form-group-check">
          <label class="check-label">
            <input v-model="form.is_tentative" type="checkbox" />
            <span>暂定</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <input v-model="form.notes" class="form-input" type="text" placeholder="可选" />
      </div>

      <!-- Leave conflict warning -->
      <div v-if="leaveConflicts.length" class="conflict-warning">
        <strong>⚠ 以下日期存在休假记录：</strong>
        <span>{{ leaveConflicts.join('、') }}</span>
        <div class="conflict-actions">
          <button type="button" class="btn btn-sm btn-secondary" @click="skipConflicts = true; handleSubmit()">跳过休假日</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="leaveConflicts = []">取消</button>
        </div>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
    </form>
    <template #footer>
      <button v-if="isEdit" type="button" class="btn btn-danger" @click="handleDelete">删除</button>
      <button type="button" class="btn btn-secondary" @click="onClose">取消</button>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="handleSubmit">
        {{ saving ? '保存中…' : (isEdit ? '保存' : '创建') }}
      </button>
    </template>
  </AppModal>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import AppModal from '@/components/common/AppModal.vue'
import { bookingApi } from '@/api'
import { fmt, parseDate, addDays } from '@/utils/date'
import { useToast } from '@/composables/useToast'

const props = defineProps({
  modelValue: Boolean,
  booking: { type: Object, default: null }, // null = create mode
  defaultDate: { type: String, default: '' },
  defaultEndDate: { type: String, default: '' },
  defaultResourceId: { type: [Number, String], default: '' },
  resources: { type: Array, default: () => [] },
  projects: { type: Array, default: () => [] },
  leaveMap: { type: Object, default: () => ({}) }, // { 'resourceId_date': true }
})

const emit = defineEmits(['update:modelValue', 'saved', 'deleted'])
const { toast } = useToast()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const isEdit = computed(() => !!props.booking)

const form = reactive({
  resource_id: '',
  project_id: '',
  date: '',
  end_date: '',
  hours: 8,
  is_tentative: false,
  notes: '',
})

const saving = ref(false)
const error = ref('')
const leaveConflicts = ref([])
const skipConflicts = ref(false)

watch(() => props.modelValue, (v) => {
  if (v) {
    error.value = ''
    leaveConflicts.value = []
    skipConflicts.value = false
    if (props.booking) {
      Object.assign(form, {
        resource_id: props.booking.resource_id,
        project_id: props.booking.project_id,
        date: props.booking.date,
        end_date: props.booking.date,
        hours: props.booking.hours,
        is_tentative: !!props.booking.is_tentative,
        notes: props.booking.notes || '',
      })
    } else {
      Object.assign(form, {
        resource_id: props.defaultResourceId || '',
        project_id: '',
        date: props.defaultDate || fmt(new Date()),
        end_date: props.defaultEndDate || props.defaultDate || fmt(new Date()),
        hours: 8,
        is_tentative: false,
        notes: '',
      })
    }
  }
})

function getConflicts() {
  if (!form.resource_id) return []
  const conflicts = []
  const start = parseDate(form.date)
  const end = parseDate(form.end_date || form.date)
  const d = new Date(start)
  while (d <= end) {
    const key = `${form.resource_id}_${fmt(d)}`
    if (props.leaveMap[key]) conflicts.push(fmt(d))
    d.setDate(d.getDate() + 1)
  }
  return conflicts
}

async function handleSubmit() {
  error.value = ''

  // Check leave conflicts first (unless already acknowledged)
  if (!skipConflicts.value && !isEdit.value) {
    const conflicts = getConflicts()
    if (conflicts.length) {
      leaveConflicts.value = conflicts
      return
    }
  }

  saving.value = true
  try {
    const payload = {
      resource_id: Number(form.resource_id),
      project_id: Number(form.project_id),
      date: form.date,
      end_date: form.end_date || form.date,
      hours: form.hours,
      is_tentative: form.is_tentative ? 1 : 0,
      notes: form.notes,
      skip_leave: skipConflicts.value ? 1 : 0,
    }

    if (isEdit.value) {
      await bookingApi.update(props.booking.id, payload)
      toast('排程已更新')
    } else {
      await bookingApi.create(payload)
      toast('排程已创建')
    }

    emit('saved')
    show.value = false
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!confirm('确认删除该排程？')) return
  try {
    await bookingApi.remove(props.booking.id)
    toast('排程已删除')
    emit('deleted')
    show.value = false
  } catch (e) {
    error.value = e.message
  }
}

function onClose() {
  show.value = false
  leaveConflicts.value = []
}
</script>

<style scoped>
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-group-check { display: flex; align-items: flex-end; padding-bottom: 2px; }
.check-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--text); }
.req { color: #ef4444; }
.form-error { color: #ef4444; font-size: 13px; margin-top: 8px; }
.conflict-warning {
  background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px;
  padding: 10px 14px; font-size: 13px; color: #92400e; margin-top: 10px;
}
.conflict-warning strong { display: block; margin-bottom: 4px; }
.conflict-actions { display: flex; gap: 8px; margin-top: 10px; }
.btn-sm { padding: 4px 12px; font-size: 12px; }
.btn-danger { background: #ef4444; color: #fff; border: none; }
.btn-danger:hover { background: #dc2626; }
</style>
