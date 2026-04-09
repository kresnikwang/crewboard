<template>
  <div
    class="booking-block"
    :class="{
      'is-tentative': booking.is_tentative,
      'is-moving': isMoving,
      'is-resizing': isResizing,
      'is-readonly': readonly,
    }"
    :style="blockStyle"
    :title="booking.project_name"
    @mousedown="!readonly && $emit('move-start', $event)"
    @click="$emit('click', $event)"
  >
    <span class="booking-label">{{ label }}</span>
    <div
      v-if="!readonly"
      class="resize-handle"
      @mousedown.stop="$emit('resize-start', $event)"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { truncate } from '@/utils'
import { readableColor } from '@/utils'

const props = defineProps({
  booking: { type: Object, required: true },
  isMoving: Boolean,
  isResizing: Boolean,
  previewMode: { type: String, default: '' }, // 'add' | 'remove' | ''
  readonly: { type: Boolean, default: false },
})

defineEmits(['click', 'resize-start', 'move-start'])

const blockStyle = computed(() => {
  const color = props.booking.project_color || '#8B5CF6'
  return {
    background: color,
    color: readableColor(color),
    opacity: props.isMoving ? 0.4 : 1,
  }
})

const label = computed(() => {
  const h = props.booking.hours
  const name = truncate(props.booking.project_name, 22)
  return `${h}h ${name}`
})
</script>

<style scoped>
.booking-block {
  position: relative;
  border-radius: 4px;
  padding: 2px 20px 2px 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: grab;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  height: 20px;
  line-height: 16px;
  user-select: none;
  box-sizing: border-box;
}
.booking-block.is-readonly { cursor: default; padding-right: 6px; }
.booking-block:hover .resize-handle { opacity: 1; }
.booking-block.is-tentative { opacity: 0.65; border: 2px dashed rgba(255,255,255,.5); }
.booking-block.is-resizing { outline: 2px solid #3b82f6; }
.booking-block.is-moving { cursor: grabbing; }

.booking-label { pointer-events: none; }

.resize-handle {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 8px;
  cursor: col-resize;
  opacity: 0;
  transition: opacity .15s;
  background: rgba(255,255,255,.35);
  border-radius: 0 4px 4px 0;
}
</style>
