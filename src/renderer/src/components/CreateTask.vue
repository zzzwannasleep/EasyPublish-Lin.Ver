<script setup lang="ts" name="ProjectCreateOrchestrator">
import { computed, ref } from 'vue'
import type { ProjectMode } from '../types/project'
import { useI18n } from '../i18n'
import EpisodeCreateForm from './EpisodeCreateForm.vue'
import ProjectModeSelectDialog from './ProjectModeSelectDialog.vue'

const { t } = useI18n()
const selectedMode = ref<ProjectMode | null>(null)
const selectingMode = ref(true)

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
    <section class="create-flow__mode-panel" :class="{ 'is-compact': !showModeSelector }">
      <div class="create-flow__mode-head">
        <div class="create-flow__mode-copy">
          <h4 class="create-flow__mode-title">{{ t('nav.newProject.label') }}</h4>
          <span v-if="selectedMode && !showModeSelector" class="create-flow__mode-chip">
            {{ t(`create.mode.${selectedMode}.label`) }}
          </span>
        </div>
        <el-button v-if="selectedMode && !showModeSelector" plain class="create-flow__mode-button" @click="openModeSelector">
          {{ t('create.mode.back') }}
        </el-button>
      </div>
      <ProjectModeSelectDialog v-if="showModeSelector" :selected-mode="selectedMode" @select="handleModeSelect" />
    </section>

    <EpisodeCreateForm
      v-if="selectedMode && !showModeSelector"
      :key="selectedMode"
      :mode="selectedMode"
      @back="openModeSelector"
    />
  </div>
</template>

<style scoped>
.create-flow {
  display: grid;
  gap: 20px;
}

.create-flow__mode-panel {
  display: grid;
  gap: 18px;
  padding: 20px 22px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  background:
    var(--surface-panel-wash-strong),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.create-flow__mode-panel.is-compact {
  gap: 0;
}

.create-flow__mode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.create-flow__mode-copy {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.create-flow__mode-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.2vw, 30px);
  letter-spacing: -0.04em;
}

.create-flow__mode-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 74%, var(--bg-panel) 26%);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.create-flow__mode-button {
  flex: 0 0 auto;
}

@media (max-width: 760px) {
  .create-flow__mode-head {
    flex-direction: column;
    align-items: stretch;
  }

  .create-flow__mode-copy {
    flex-direction: column;
    align-items: flex-start;
  }

  .create-flow__mode-head :deep(.el-button) {
    width: 100%;
  }

  .create-flow__mode-panel {
    padding: 18px;
  }
}
</style>
