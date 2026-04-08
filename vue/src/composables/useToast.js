import { ref } from 'vue'

// Shared singleton ref pointing to the ToastContainer instance
export const toastRef = ref(null)

export function useToast() {
  function toast(message, type = 'success') {
    toastRef.value?.show(message, type)
  }
  return { toast }
}
