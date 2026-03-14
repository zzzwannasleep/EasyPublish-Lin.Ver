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

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
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

function updateVisible(value: boolean) {
  emit('update:visible', value)
}

function selectMode(mode: ProjectMode) {
  emit('select', mode)
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="t('create.mode.dialog.title')"
    width="760px"
    align-center
    @update:model-value="updateVisible"
  >
    <div class="mode-dialog">
      <p class="mode-dialog__description">{{ t('create.mode.dialog.description') }}</p>

      <div class="mode-dialog__grid">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="mode-dialog__card"
          @click="selectMode(option.value)"
        >
          <div class="mode-dialog__icon">
            <el-icon><component :is="option.icon" /></el-icon>
          </div>
          <div class="mode-dialog__copy">
            <div class="mode-dialog__label">{{ option.label }}</div>
            <p class="mode-dialog__text">{{ option.description }}</p>
          </div>
          <span class="mode-dialog__action">{{ option.action }}</span>
        </button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.mode-dialog,
.mode-dialog__grid {
  display: grid;
  gap: 16px;
}

.mode-dialog__description,
.mode-dialog__text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.mode-dialog__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mode-dialog__card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.48);
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.mode-dialog__card:hover {
  transform: translateY(-2px);
  border-color: rgba(198, 90, 46, 0.24);
  box-shadow: var(--shadow-md);
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.72));
}

.mode-dialog__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.82));
  color: var(--brand);
  font-size: 18px;
}

.mode-dialog__label {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.mode-dialog__action {
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .mode-dialog__grid {
    grid-template-columns: 1fr;
  }
}
</style>
