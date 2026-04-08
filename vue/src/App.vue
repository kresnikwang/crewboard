<template>
  <RouterView />
  <ToastContainer ref="toastContainerRef" />
</template>

<script setup>
import { ref, onMounted } from 'vue'
import ToastContainer from '@/components/common/ToastContainer.vue'
import { toastRef } from '@/composables/useToast'

const toastContainerRef = ref(null)
onMounted(() => {
  toastRef.value = toastContainerRef.value
})
</script>
