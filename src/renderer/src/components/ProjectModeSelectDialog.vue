<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { Collection, Film } from '@element-plus/icons-vue'
import type { ProjectMode } from '../types/project'
import { useI18n } from '../i18n'

type ModeOption = {
  value: ProjectMode
  label: string
  description: string
  action: string
  icon: Component
}

defineProps<{
  selectedMode?: ProjectMode | null
}>()

const emit = defineEmits<{
  select: [mode: ProjectMode]
}>()

const { t } = useI18n()

const options = computed<ModeOption[]>(() => [
  {
    value: 'episode',
    label: t('create.mode.episode.label'),
    description: t('create.mode.episode.description'),
    action: t('create.mode.episode.action'),
    icon: Collection,
  },
  {
    value: 'feature',
    label: t('create.mode.feature.label'),
    description: t('create.mode.feature.description'),
    action: t('create.mode.feature.action'),
    icon: Film,
  },
])

function selectMode(mode: ProjectMode) {
  emit('select', mode)
}
</script>

<template>
  <div class="mode-selector">
    <div class="mode-selector__grid">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="mode-selector__card"
        :class="{ 'is-active': selectedMode === option.value }"
        @click="selectMode(option.value)"
      >
        <div class="mode-selector__icon">
          <el-icon><component :is="option.icon" /></el-icon>
        </div>
        <div class="mode-selector__copy">
          <div class="mode-selector__label">{{ option.label }}</div>
          <p class="mode-selector__text">{{ option.description }}</p>
        </div>
        <span class="mode-selector__action">{{ option.action }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mode-selector,
.mode-selector__grid {
  display: grid;
  gap: 14px;
}

.mode-selector__text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.mode-selector__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mode-selector__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  min-height: 216px;
  padding: 24px 22px 22px;
  border: 1px solid var(--border-soft);
  border-radius: 22px;
  background:
    radial-gradient(circle at top left, var(--brand-soft), transparent 38%),
    var(--surface-soft-fill);
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.mode-selector__card:hover,
.mode-selector__card.is-active {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--brand-soft) 88%, white 12%), transparent 42%),
    var(--surface-brand-fill);
}

.mode-selector__card.is-active {
  box-shadow:
    var(--shadow-md),
    0 0 0 1px var(--brand-soft) inset;
}

.mode-selector__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-brand-fill-strong) 86%, white 14%);
  color: var(--brand);
  font-size: 18px;
}

.mode-selector__copy {
  display: grid;
  gap: 10px;
  flex: 1;
}

.mode-selector__label {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.mode-selector__action {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 74%, var(--bg-panel) 26%);
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .mode-selector__grid {
    grid-template-columns: 1fr;
  }
}
</style>
