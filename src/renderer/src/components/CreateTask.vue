<script setup lang="ts" name="ProjectCreateOrchestrator">
import { computed, ref } from 'vue'
import type { ProjectMode } from '../types/project'
import { useI18n } from '../i18n'
import EpisodeCreateForm from './EpisodeCreateForm.vue'
import FeatureCreateForm from './FeatureCreateForm.vue'
import ProjectModeSelectDialog from './ProjectModeSelectDialog.vue'

const { t } = useI18n()
const selectedMode = ref<ProjectMode | null>(null)
const dialogVisible = ref(true)

const modeDescription = computed(() => {
  if (selectedMode.value === 'episode') {
    return t('create.mode.episode.description')
  }

  if (selectedMode.value === 'feature') {
    return t('create.mode.feature.description')
  }

  return t('create.mode.dialog.description')
})

function openModeDialog() {
  dialogVisible.value = true
}

function handleModeSelect(mode: ProjectMode) {
  selectedMode.value = mode
  dialogVisible.value = false
}
</script>

<template>
  <div class="create-flow">
    <ProjectModeSelectDialog v-model:visible="dialogVisible" @select="handleModeSelect" />

    <section class="create-flow__hero">
      <div class="create-flow__eyebrow">{{ t('create.mode.current') }}</div>
      <h3 class="create-flow__title">
        {{ selectedMode ? t(`create.mode.${selectedMode}.label`) : t('create.mode.unselected') }}
      </h3>
      <p class="create-flow__description">{{ modeDescription }}</p>
    </section>

    <FeatureCreateForm v-if="selectedMode === 'feature'" @back="openModeDialog" />
    <EpisodeCreateForm v-else-if="selectedMode === 'episode'" @back="openModeDialog" />

    <el-empty v-else class="create-flow__empty" :description="t('create.mode.dialog.description')">
      <template #default>
        <el-button type="primary" @click="openModeDialog">{{ t('create.mode.dialog.open') }}</el-button>
      </template>
    </el-empty>
  </div>
</template>

<style scoped>
.create-flow {
  display: grid;
  gap: 18px;
}

.create-flow__hero {
  padding: 18px 20px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(135deg, rgba(247, 219, 206, 0.42), rgba(255, 255, 255, 0.54)),
    var(--bg-panel);
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

.create-flow__empty {
  padding: 16px 0 6px;
}
</style>
