<script setup lang="ts">
import { computed } from 'vue'
import Check from '../../components/Check.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import EpisodePublishConfirmStage from '../publish-panel/EpisodePublishConfirmStage.vue'
import { useProjectContext } from '../project-detail/project-context'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
const isSeriesProject = computed(() => project.value?.projectMode === 'episode')
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
    :aside-eyebrow="''"
    :aside-title="''"
    :aside-description="''"
  >
    <EpisodePublishConfirmStage :id="id" />
  </StageWorkspace>

  <Check v-else :id="id" />
</template>
