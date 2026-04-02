<script setup lang="ts">
import { computed } from 'vue'
import Check from '../../components/Check.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import EpisodePublishConfirmStage from '../publish-panel/EpisodePublishConfirmStage.vue'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
const isSeriesProject = computed(() => project.value?.projectMode === 'episode')

const notes = computed(() => [
  {
    title: t('stage.review.note1.title'),
    text: t('stage.review.note1.text'),
  },
  {
    title: t('stage.review.note2.title'),
    text: t('stage.review.note2.text'),
  },
  {
    title: t('stage.review.note3.title'),
    text: t('stage.review.note3.text'),
  },
])
</script>

<template>
  <StageWorkspace
    v-if="isSeriesProject"
    :eyebrow="t('stage.review.eyebrow')"
    :title="t('stage.review.title')"
    :description="t('stage.review.description', { project: projectName })"
    :status-label="t('stage.review.status')"
    status-tone="success"
    :panel-eyebrow="t('stage.review.panelEyebrow')"
    :panel-title="t('stage.review.panelTitle', { project: projectName })"
    :panel-description="t('stage.review.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.review.asideDescription')"
  >
    <EpisodePublishConfirmStage :id="id" />

    <template #aside>
      <ProjectStageAside
        :project="project"
        :is-loading="isLoading"
        :error-message="errorMessage"
        :notes="notes"
      />
    </template>
  </StageWorkspace>

  <Check v-else :id="id" />
</template>
