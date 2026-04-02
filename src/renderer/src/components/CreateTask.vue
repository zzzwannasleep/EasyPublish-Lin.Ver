<script setup lang="ts" name="ProjectCreateOrchestrator">
import { computed, ref } from 'vue'
import type { ProjectMode } from '../types/project'
import { useI18n } from '../i18n'
import EpisodeCreateForm from './EpisodeCreateForm.vue'
import FeatureCreateForm from './FeatureCreateForm.vue'
import ProjectModeSelectDialog from './ProjectModeSelectDialog.vue'

const { t } = useI18n()
const selectedMode = ref<ProjectMode | null>(null)
const selectingMode = ref(true)

const modeDescription = computed(() => {
  if (selectedMode.value === 'episode') {
    return t('create.mode.episode.description')
  }

  if (selectedMode.value === 'feature') {
    return t('create.mode.feature.description')
  }

  return t('create.mode.dialog.description')
})

const showModeSelector = computed(() => selectingMode.value || !selectedMode.value)

function openModeSelector() {
  selectingMode.value = true
}

function handleModeSelect(mode: ProjectMode) {
  selectedMode.value = mode
  selectingMode.value = false
}
</script>

<template>
  <div class="create-flow">
    <section class="create-flow__hero">
      <div class="create-flow__hero-main">
        <div class="create-flow__eyebrow">{{ t('create.mode.current') }}</div>
        <h3 class="create-flow__title">
          {{ selectedMode ? t(`create.mode.${selectedMode}.label`) : t('create.mode.unselected') }}
        </h3>
        <p class="create-flow__description">{{ modeDescription }}</p>
      </div>
      <div v-if="selectedMode" class="create-flow__hero-actions">
        <el-button plain @click="openModeSelector">{{ t('create.mode.back') }}</el-button>
      </div>
    </section>

    <section v-if="showModeSelector" class="create-flow__mode-panel">
      <div class="create-flow__mode-head">
        <div class="create-flow__mode-eyebrow">{{ t('create.mode.dialog.title') }}</div>
        <h4 class="create-flow__mode-title">{{ t('create.mode.dialog.title') }}</h4>
        <p class="create-flow__mode-description">{{ t('create.mode.dialog.description') }}</p>
      </div>
      <ProjectModeSelectDialog :selected-mode="selectedMode" @select="handleModeSelect" />
    </section>

    <FeatureCreateForm v-if="selectedMode === 'feature' && !showModeSelector" @back="openModeSelector" />
    <EpisodeCreateForm v-else-if="selectedMode === 'episode' && !showModeSelector" @back="openModeSelector" />
  </div>
</template>

<style scoped>
.create-flow {
  display: grid;
  gap: 18px;
}

.create-flow__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    var(--surface-panel-wash-strong),
    var(--bg-panel);
}

.create-flow__hero-main {
  min-width: 0;
}

.create-flow__hero-actions {
  flex: 0 0 auto;
}

.create-flow__eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.create-flow__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(22px, 2vw, 28px);
  letter-spacing: -0.04em;
}

.create-flow__description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.create-flow__mode-panel {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  background:
    var(--surface-panel-wash-strong),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.create-flow__mode-head {
  max-width: 720px;
}

.create-flow__mode-eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.create-flow__mode-title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.2vw, 30px);
  letter-spacing: -0.04em;
}

.create-flow__mode-description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 760px) {
  .create-flow__hero {
    flex-direction: column;
  }

  .create-flow__hero-actions {
    width: 100%;
  }

  .create-flow__hero-actions :deep(.el-button) {
    width: 100%;
  }

  .create-flow__mode-panel {
    padding: 18px;
  }
}
</style>
