<script setup lang="ts">
import { computed } from 'vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import NexusProjectPublishPanel from './NexusProjectPublishPanel.vue'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
const shouldShowAdapterPanel = computed(() => {
  if (!project.value) {
    return false
  }

  return (
      project.value.projectMode !== 'episode' ||
      project.value.targetSites.includes('bangumi') ||
      project.value.targetSites.includes('miobt') ||
      project.value.targetSites.includes('mikan') ||
      project.value.targetSites.includes('dmhy') ||
      project.value.targetSites.includes('nyaa')
  )
})

const notes = computed(() => [
  {
    title: t('stage.torrent.note1.title'),
    text: t('stage.torrent.note1.text'),
  },
  {
    title: t('stage.torrent.note2.title'),
    text: t('stage.torrent.note2.text'),
  },
  {
    title: t('stage.torrent.note3.title'),
    text: t('stage.torrent.note3.text'),
  },
])
</script>

<template>
  <StageWorkspace
    :eyebrow="t('stage.torrent.eyebrow')"
    :title="t('stage.torrent.title')"
    :description="t('stage.torrent.description', { project: projectName })"
    :status-label="t('stage.torrent.status')"
    status-tone="info"
    :panel-eyebrow="t('stage.torrent.panelEyebrow')"
    :panel-title="t('stage.torrent.panelTitle', { project: projectName })"
    :panel-description="t('stage.torrent.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.torrent.asideDescription')"
  >
    <div class="flex flex-col gap-6">
      <NexusProjectPublishPanel v-if="shouldShowAdapterPanel" :id="id" />
    </div>

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
