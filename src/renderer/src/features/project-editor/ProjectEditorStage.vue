<script setup lang="ts">
import { computed } from 'vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import FeatureProjectWorkspace from './FeatureProjectWorkspace.vue'
import SeriesProjectWorkspace from './SeriesProjectWorkspace.vue'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
</script>

<template>
  <SeriesProjectWorkspace v-if="project?.projectMode === 'episode'" :id="id" :project="project" />
  <FeatureProjectWorkspace v-else-if="project" :id="id" :project="project" />

  <StageWorkspace
    v-else
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
    aside-placement="side"
  >
    <div class="surface-subtle px-4 py-6 text-sm leading-6 text-copy-secondary">
      Loading project editor...
    </div>

    <template #aside>
      <ProjectStageAside
        :project="project"
        :is-loading="isLoading"
        :error-message="errorMessage"
        :notes="[]"
      />
    </template>
  </StageWorkspace>
</template>
