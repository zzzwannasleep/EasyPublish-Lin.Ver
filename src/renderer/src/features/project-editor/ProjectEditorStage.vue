<script setup lang="ts">
import { computed } from 'vue'
import Edit from '../../components/Edit.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import SeriesProjectWorkspace from './SeriesProjectWorkspace.vue'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
const isSeriesProject = computed(() => project.value?.projectMode === 'episode')
const notes = computed(() => {
  if (!isSeriesProject.value) {
    return []
  }

  return [
    {
      title: t('stage.editor.series.note1.title'),
      text: t('stage.editor.series.note1.text'),
    },
    {
      title: t('stage.editor.series.note2.title'),
      text: t('stage.editor.series.note2.text'),
    },
  ]
})
</script>

<template>
  <StageWorkspace
    :show-intro="false"
    :eyebrow="t('stage.editor.eyebrow')"
    :title="isSeriesProject ? t('stage.editor.series.title') : t('stage.editor.title')"
    :description="
      isSeriesProject
        ? t('stage.editor.series.description', { project: projectName })
        : t('stage.editor.description', { project: projectName })
    "
    :status-label="isSeriesProject ? t('stage.editor.series.status') : t('stage.editor.status')"
    status-tone="info"
    :panel-eyebrow="isSeriesProject ? t('stage.editor.series.panelEyebrow') : t('stage.editor.panelEyebrow')"
    :panel-title="
      isSeriesProject
        ? t('stage.editor.series.panelTitle', { project: projectName })
        : t('stage.editor.panelTitle', { project: projectName })
    "
    :panel-description="isSeriesProject ? t('stage.editor.series.panelDescription') : t('stage.editor.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="isSeriesProject ? t('stage.editor.series.asideDescription') : t('stage.editor.asideDescription')"
  >
    <SeriesProjectWorkspace v-if="project?.projectMode === 'episode'" :id="id" :project="project" />
    <Edit v-else-if="project" :id="id" :project="project" />
    <div v-else class="project-editor-stage__loading">Loading project editor...</div>

    <template #aside>
      <ProjectStageAside
        :project="project"
        :is-loading="isLoading"
        :error-message="errorMessage"
        :notes="notes"
      />
    </template>
  </StageWorkspace>
</template>

<style scoped>
.project-editor-stage__loading {
  padding: 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
}
</style>
