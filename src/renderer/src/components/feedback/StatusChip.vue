<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  }>(),
  {
    tone: 'neutral'
  }
)
</script>

<template>
  <span class="status-chip" :data-tone="tone">
    <slot />
  </span>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(102, 91, 82, 0.12);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.status-chip[data-tone='info'] {
  background: var(--accent-soft);
  color: var(--accent);
}

.status-chip[data-tone='success'] {
  background: var(--success-soft);
  color: var(--success);
}

.status-chip[data-tone='warning'] {
  background: var(--warning-soft);
  color: var(--warning);
}

.status-chip[data-tone='danger'] {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
