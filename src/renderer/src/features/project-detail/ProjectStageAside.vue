<script setup lang="ts">
import { computed } from 'vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getProjectModeLabel,
  getPublishStateLabel,
  getRecordedSiteIds,
  getProjectSourceLabel,
  getProjectStageLabel,
  getProjectStatusLabel,
  getSiteLabel,
  projectStatusTones,
  publishStateTones,
  sortPublishResults,
} from '../../services/project/presentation'
import type { PublishProject } from '../../types/project'

const props = defineProps<{
  project: PublishProject | null
  isLoading?: boolean
  errorMessage?: string | null
  notes: Array<{
    title: string
    text: string
  }>
}>()

const { t } = useI18n()

const recordedSites = computed(() => {
  if (!props.project) {
    return ''
  }

  return getRecordedSiteIds(props.project).map(siteId => getSiteLabel(siteId)).join(', ')
})

const latestResult = computed(() => {
  if (!props.project || props.project.publishResults.length === 0) {
    return null
  }

  return sortPublishResults(props.project.publishResults)[0]
})

const missingTargetSites = computed(() => {
  if (!props.project) {
    return ''
  }

  return getMissingTargetSiteIds(props.project).map(siteId => getSiteLabel(siteId)).join(', ')
})

function openProjectFolder(path: string) {
  const message: Message.Global.Path = { path }
  window.globalAPI.openFolder(JSON.stringify(message))
}
</script>

<template>
  <article class="surface-subtle grid gap-3 px-4 py-4">
    <div class="text-sm font-semibold text-copy-primary">{{ t('projectAside.snapshot') }}</div>
    <div v-if="isLoading" class="text-sm leading-6 text-copy-secondary">{{ t('projectAside.loading') }}</div>
    <div v-else-if="errorMessage" class="text-sm leading-6 text-danger">{{ errorMessage }}</div>
    <div v-else-if="project" class="grid gap-3">
      <div class="font-display text-[1.15rem] leading-tight tracking-[-0.04em] text-copy-primary">
        {{ project.name }}
      </div>
      <div class="flex flex-wrap gap-2">
        <StatusChip tone="info">{{ getProjectModeLabel(project.projectMode) }}</StatusChip>
        <StatusChip v-if="project.sourceKind" tone="neutral">{{ getProjectSourceLabel(project.sourceKind) }}</StatusChip>
        <StatusChip :tone="projectStatusTones[project.status]">
          {{ getProjectStatusLabel(project.status) }}
        </StatusChip>
      </div>
      <div class="text-sm leading-6 text-copy-secondary">
        {{ t('projectAside.currentStage', { stage: getProjectStageLabel(project.stage) }) }}
      </div>
    </div>
    <div v-else class="text-sm leading-6 text-copy-secondary">{{ t('projectAside.unavailable') }}</div>
  </article>

  <article v-if="project" class="surface-subtle grid gap-3 px-4 py-4">
    <div class="text-sm font-semibold text-copy-primary">{{ t('projectAside.recordedResults') }}</div>
    <div class="text-sm leading-6 text-copy-secondary">
      <template v-if="recordedSites">
        {{ recordedSites }}
      </template>
      <template v-else>
        {{ t('projectAside.noLinks') }}
      </template>
    </div>
    <div v-if="missingTargetSites" class="text-sm leading-6 text-warning">待发布：{{ missingTargetSites }}</div>
    <div v-if="latestResult" class="flex flex-wrap items-center gap-2.5">
      <StatusChip :tone="publishStateTones[latestResult.status]">
        {{ getPublishStateLabel(latestResult.status) }}
      </StatusChip>
      <span class="text-sm leading-6 text-copy-secondary">
        {{
          t('projectAside.latestResult', {
            site: getSiteLabel(latestResult.siteId),
            time: formatProjectTimestamp(latestResult.timestamp),
          })
        }}
      </span>
    </div>
  </article>

  <article v-if="project" class="surface-subtle grid gap-3 px-4 py-4">
    <div class="text-sm font-semibold text-copy-primary">{{ t('projectAside.workingDirectory') }}</div>
    <button
      class="break-all text-left text-sm leading-6 text-accent transition hover:text-brand"
      type="button"
      @click="openProjectFolder(project.workingDirectory)"
    >
      {{ project.workingDirectory }}
    </button>
    <div class="text-sm leading-6 text-copy-secondary">
      {{ t('projectAside.updatedAt', { time: formatProjectTimestamp(project.updatedAt) }) }}
    </div>
  </article>

  <article v-for="item in notes" :key="item.title" class="surface-subtle grid gap-2.5 px-4 py-4">
    <div class="text-sm font-semibold text-copy-primary">{{ item.title }}</div>
    <div class="text-sm leading-6 text-copy-secondary">{{ item.text }}</div>
  </article>
</template>
