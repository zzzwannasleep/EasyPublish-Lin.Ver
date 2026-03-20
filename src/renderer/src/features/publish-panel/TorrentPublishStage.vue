<script setup lang="ts">
import { computed } from 'vue'
import BTPublish from '../../components/BTPublish.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import NexusProjectPublishPanel from './NexusProjectPublishPanel.vue'

type LegacyStageSiteType = 'bangumi_all' | 'bangumi' | 'miobt' | 'nyaa'

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
    project.value.targetSites.includes('mikan') ||
    project.value.targetSites.includes('dmhy')
  )
})
const legacySiteTypes = computed<LegacyStageSiteType[]>(() => {
  if (!project.value || project.value.projectMode !== 'episode') {
    return ['bangumi_all', 'bangumi', 'miobt', 'nyaa']
  }

  const siteMap: Partial<Record<string, LegacyStageSiteType>> = {
    bangumi: 'bangumi',
    miobt: 'miobt',
    nyaa: 'nyaa',
  }

  const targetRows = project.value.targetSites
    .map(siteId => siteMap[siteId])
    .filter((siteType): siteType is LegacyStageSiteType => Boolean(siteType))

  if (project.value.targetSites.length === 0) {
    return ['bangumi', 'miobt', 'nyaa']
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
    <div class="publish-stage-stack">
      <NexusProjectPublishPanel v-if="shouldShowAdapterPanel" :id="id" />

      <section v-if="shouldShowLegacyFallback" class="legacy-fallback">
        <div class="legacy-fallback__eyebrow">{{ t('stage.torrent.legacyEyebrow') }}</div>
        <h3 class="legacy-fallback__title">{{ t('stage.torrent.legacyTitle') }}</h3>
        <p class="legacy-fallback__description">{{ t('stage.torrent.legacyDescription') }}</p>
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

<style scoped>
.publish-stage-stack {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.legacy-fallback {
  padding-top: 20px;
  border-top: 1px solid var(--border-soft);
}

.legacy-fallback__eyebrow {
  color: var(--warning);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.legacy-fallback__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: -0.04em;
}

.legacy-fallback__description {
  margin: 12px 0 18px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
</style>
