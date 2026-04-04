<script setup lang="ts">
import { computed } from 'vue'
import BTPublish from '../../components/BTPublish.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import NexusProjectPublishPanel from './NexusProjectPublishPanel.vue'

type LegacyStageSiteType = 'bangumi_all' | 'bangumi' | 'miobt'

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
      project.value.targetSites.includes('miobt') ||
      project.value.targetSites.includes('mikan') ||
      project.value.targetSites.includes('dmhy') ||
      project.value.targetSites.includes('nyaa')
  )
})
const legacySiteTypes = computed<LegacyStageSiteType[]>(() => {
  if (!project.value || project.value.projectMode !== 'episode') {
    return ['bangumi_all', 'bangumi', 'miobt']
  }

  const siteMap: Partial<Record<string, LegacyStageSiteType>> = {
    bangumi: 'bangumi',
  }

  const targetRows = project.value.targetSites
    .map(siteId => siteMap[siteId])
    .filter((siteType): siteType is LegacyStageSiteType => Boolean(siteType))

  if (project.value.targetSites.length === 0) {
    return ['bangumi']
  }

  return [...new Set(targetRows)]
})
const shouldShowLegacyFallback = computed(() => legacySiteTypes.value.length > 0)

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

      <section
        v-if="shouldShowLegacyFallback"
        class="surface-subtle border-t-0 px-5 py-5"
      >
        <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">
          {{ t('stage.torrent.legacyEyebrow') }}
        </div>
        <h3 class="mt-3 font-display text-[1.4rem] leading-tight tracking-[-0.05em] text-copy-primary">
          {{ t('stage.torrent.legacyTitle') }}
        </h3>
        <p class="mt-3 mb-5 text-sm leading-7 text-copy-secondary">{{ t('stage.torrent.legacyDescription') }}</p>
        <BTPublish :id="id" :site-types="legacySiteTypes" />
      </section>
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
