<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  }>(),
  {
    tone: 'neutral'
  }
)

const toneClass = computed(() => {
  switch (props.tone) {
    case 'info':
      return 'bg-accent-soft text-accent'
    case 'success':
      return 'bg-success-soft text-success'
    case 'warning':
      return 'bg-warning-soft text-warning'
    case 'danger':
      return 'bg-danger-soft text-danger'
    default:
      return 'bg-[rgba(102,91,82,0.12)] text-copy-secondary'
  }
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap',
      toneClass,
    ]"
  >
    <slot />
  </span>
</template>
