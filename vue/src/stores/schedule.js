import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { bookingApi } from '@/api'
import { getMonday, fmt, addDays } from '@/utils/date'

export const useScheduleStore = defineStore('schedule', () => {
  const view = ref('week') // 'week' | 'month'
  const weekStart = ref(getMonday(new Date()))
  const resources = ref([])
  const bookings = ref([])
  const leave = ref([])
  const holidays = ref({})
  const loading = ref(false)

  const MONTH_WEEKS = 4

  const days = computed(() => {
    if (view.value === 'month') {
      const arr = []
      for (let w = 0; w < MONTH_WEEKS; w++)
        for (let d = 0; d < 7; d++)
          arr.push(addDays(weekStart.value, w * 7 + d))
      return arr
    }
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i))
  })

  const startStr = computed(() => fmt(days.value[0]))
  const endStr = computed(() => fmt(days.value[days.value.length - 1]))

  async function load() {
    loading.value = true
    try {
      const data = await bookingApi.scheduleData(startStr.value, endStr.value)
      resources.value = data.resources
      bookings.value = data.bookings
      leave.value = data.leave
      holidays.value = data.holidays
    } finally {
      loading.value = false
    }
  }

  function prevPeriod() {
    weekStart.value = addDays(weekStart.value, view.value === 'month' ? -28 : -7)
  }
  function nextPeriod() {
    weekStart.value = addDays(weekStart.value, view.value === 'month' ? 28 : 7)
  }
  function goToday() {
    weekStart.value = getMonday(new Date())
  }
  function setView(v) {
    view.value = v
    weekStart.value = getMonday(new Date())
  }

  return {
    view, weekStart, resources, bookings, leave, holidays, loading,
    days, startStr, endStr,
    load, prevPeriod, nextPeriod, goToday, setView,
  }
})
