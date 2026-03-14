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
  <article class="stack-list__item">
    <div class="stack-list__title">{{ t('projectAside.snapshot') }}</div>
    <div v-if="isLoading" class="stack-list__text">{{ t('projectAside.loading') }}</div>
    <div v-else-if="errorMessage" class="stack-list__text">{{ errorMessage }}</div>
    <div v-else-if="project" class="project-stage-aside__group">
      <div class="project-stage-aside__headline">{{ project.name }}</div>
      <div class="project-stage-aside__chips">
        <StatusChip tone="info">{{ getProjectModeLabel(project.projectMode) }}</StatusChip>
        <StatusChip v-if="project.sourceKind" tone="neutral">{{ getProjectSourceLabel(project.sourceKind) }}</StatusChip>
        <StatusChip :tone="projectStatusTones[project.status]">
          {{ getProjectStatusLabel(project.status) }}
        </StatusChip>
      </div>
      <div class="stack-list__text">
        {{ t('projectAside.currentStage', { stage: getProjectStageLabel(project.stage) }) }}
      </div>
    </div>
    <div v-else class="stack-list__text">{{ t('projectAside.unavailable') }}</div>
  </article>

  <article v-if="project" class="stack-list__item">
    <div class="stack-list__title">{{ t('projectAside.recordedResults') }}</div>
    <div class="stack-list__text">
      <template v-if="recordedSites">
        {{ recordedSites }}
      </template>
      <template v-else>
        {{ t('projectAside.noLinks') }}
      </template>
    </div>
    <div v-if="missingTargetSites" class="stack-list__text">待发布：{{ missingTargetSites }}</div>
    <div v-if="latestResult" class="project-stage-aside__latest">
      <StatusChip :tone="publishStateTones[latestResult.status]">
        {{ getPublishStateLabel(latestResult.status) }}
      </StatusChip>
      <span class="stack-list__text">
        {{
          t('projectAside.latestResult', {
            site: getSiteLabel(latestResult.siteId),
            time: formatProjectTimestamp(latestResult.timestamp),
          })
        }}
      </span>
    </div>
  </article>

  <article v-if="project" class="stack-list__item">
    <div class="stack-list__title">{{ t('projectAside.workingDirectory') }}</div>
    <button class="project-stage-aside__path" type="button" @click="openProjectFolder(project.workingDirectory)">
      {{ project.workingDirectory }}
    </button>
    <div class="stack-list__text">
      {{ t('projectAside.updatedAt', { time: formatProjectTimestamp(project.updatedAt) }) }}
    </div>
  </article>

  <article v-for="item in notes" :key="item.title" class="stack-list__item">
    <div class="stack-list__title">{{ item.title }}</div>
    <div class="stack-list__text">{{ item.text }}</div>
  </article>
</template>

<style scoped>
.project-stage-aside__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.project-stage-aside__headline {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.project-stage-aside__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.project-stage-aside__path {
  border: 0;
  padding: 0;
  background: none;
  color: var(--accent);
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}

.project-stage-aside__latest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
</style>
