<script setup lang="ts">
import { computed } from 'vue'
import Edit from '../../components/Edit.vue'
import EpisodeEdit from '../../components/EpisodeEdit.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))

const notes = computed(() => [])
</script>

<template>
  <StageWorkspace
    :show-intro="false"
    :eyebrow="t('stage.editor.eyebrow')"
    :title="t('stage.editor.title')"
    :description="t('stage.editor.description', { project: projectName })"
    :status-label="t('stage.editor.status')"
    status-tone="info"
    :panel-eyebrow="t('stage.editor.panelEyebrow')"
    :panel-title="t('stage.editor.panelTitle', { project: projectName })"
    :panel-description="t('stage.editor.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.editor.asideDescription')"
  >
    <EpisodeEdit v-if="project?.projectMode === 'episode'" :id="id" />
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
