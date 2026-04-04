<script setup lang="ts" name="ProjectListWorkspace">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  CircleCheck,
  Collection,
  FolderOpened,
  Link,
  Plus,
  RefreshRight,
  Timer,
  WarningFilled,
} from '@element-plus/icons-vue'
import SeriesProjectTreePreview from './SeriesProjectTreePreview.vue'
import StatusChip from './feedback/StatusChip.vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getProjectModeLabel,
  getProjectResumeRouteName,
  getProjectSourceLabel,
  getProjectStageLabel,
  getProjectStatusLabel,
  getPublishStateLabel,
  getSiteLabel,
  projectStatusTones,
  summarizeTargetSiteProgress,
} from '../services/project/presentation'
import type { ProjectMode, PublishProject } from '../types/project'
import type { SiteId } from '../types/site'

type OverviewTone = 'neutral' | 'info' | 'success' | 'warning'

interface OverviewItem {
  label: string
  value: number
  ratio: number
  percent: number
  tone: OverviewTone
  icon: Component
}

interface ProjectTargetProgress {
  total: number
  published: number
  pending: number
  failed: number
  completionRate: number
}

const props = withDefaults(
  defineProps<{
    variant?: 'full' | 'preview'
    limit?: number
  }>(),
  {
    variant: 'full',
    limit: 0,
  },
)

const router = useRouter()
const { t } = useI18n()
const isLoading = ref(false)
const showPublished = ref(false)
const projectModeFilter = ref<'all' | ProjectMode>('all')
const showOnlyMissingTargets = ref(false)
const projects = ref<PublishProject[]>([])
const isPreviewMode = computed(() => props.variant === 'preview')

const modeFilterOptions = computed(() => [
  { value: 'all' as const, label: t('taskList.filter.mode.all') },
  { value: 'episode' as const, label: getProjectModeLabel('episode') },
  { value: 'feature' as const, label: getProjectModeLabel('feature') },
])

function getProjectTimeValue(value?: string) {
  if (!value) {
    return 0
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getProjectPriority(project: PublishProject) {
  const missingTargetCount = getMissingTargetSiteIds(project).length
  if (project.projectMode === 'episode' && missingTargetCount > 0) {
    return 3
  }

  if (missingTargetCount > 0) {
    return 2
  }

  if (project.projectMode === 'episode') {
    return 1
  }

  return 0
}

const orderedProjects = computed(() => {
  return [...projects.value].sort((left, right) => {
    const priorityDelta = getProjectPriority(right) - getProjectPriority(left)
    if (priorityDelta !== 0) {
      return priorityDelta
    }

    return getProjectTimeValue(right.updatedAt) - getProjectTimeValue(left.updatedAt)
  })
})

const visibleProjects = computed(() => {
  return orderedProjects.value.filter(project => {
    if (!showPublished.value && project.status === 'published') {
      return false
    }

    if (projectModeFilter.value !== 'all' && project.projectMode !== projectModeFilter.value) {
      return false
    }

    if (showOnlyMissingTargets.value && getMissingTargetSiteIds(project).length === 0) {
      return false
    }

    return true
  })
})

const renderedProjects = computed(() => {
  const baseProjects = isPreviewMode.value ? orderedProjects.value : visibleProjects.value

  if (props.limit > 0) {
    return baseProjects.slice(0, props.limit)
  }

  return baseProjects
})

const showOpenListAction = computed(() => isPreviewMode.value)

const overviewItems = computed<OverviewItem[]>(() => {
  const total = projects.value.length
  const active = projects.value.filter(project => project.status !== 'published').length
  const published = projects.value.filter(project => project.status === 'published').length
  const visible = visibleProjects.value.length
  const base = total || 1

  return [
    {
      label: t('taskList.summary.total'),
      value: total,
      ratio: total > 0 ? 1 : 0,
      percent: total > 0 ? 100 : 0,
      tone: 'neutral',
      icon: Collection,
    },
    {
      label: t('taskList.summary.active'),
      value: active,
      ratio: active / base,
      percent: Math.round((active / base) * 100),
      tone: 'warning',
      icon: WarningFilled,
    },
    {
      label: t('taskList.summary.published'),
      value: published,
      ratio: published / base,
      percent: Math.round((published / base) * 100),
      tone: 'success',
      icon: CircleCheck,
    },
    {
      label: t('taskList.summary.visible'),
      value: visible,
      ratio: visible / base,
      percent: Math.round((visible / base) * 100),
      tone: 'info',
      icon: FolderOpened,
    },
  ]
})

const projectTargetProgressMap = computed(() => {
  const progressMap = new Map<number, ProjectTargetProgress>()

  projects.value.forEach(project => {
    const summary = summarizeTargetSiteProgress(project.targetSites, project.publishResults)
    const published = summary.publishedSiteIds.length
    const pending = summary.pendingSiteIds.length
    const failed = summary.failedSiteIds.length
    const total = published + pending + failed

    progressMap.set(project.id, {
      total,
      published,
      pending,
      failed,
      completionRate: total > 0 ? Math.round((published / total) * 100) : 0,
    })
  })

  return progressMap
})

function getOverviewTrackStyle(item: OverviewItem) {
  const width = item.value > 0 ? Math.max(Math.round(item.ratio * 100), 14) : 0
  return { width: `${width}%` }
}

function getProjectTargetProgress(project: PublishProject): ProjectTargetProgress {
  return (
    projectTargetProgressMap.value.get(project.id) ?? {
      total: 0,
      published: 0,
      pending: 0,
      failed: 0,
      completionRate: 0,
    }
  )
}

function getProjectProgressTrackStyle(project: PublishProject) {
  const progress = getProjectTargetProgress(project)
  const width = progress.published > 0 ? Math.max(progress.completionRate, 10) : 0
  return { width: `${width}%` }
}

function getSiteEntries(project: PublishProject) {
  const entries = Object.entries({
    ...project.siteLinks,
    forum: project.forumLink,
  }) as Array<[SiteId, string | undefined]>

  return entries.filter(([, value]) => Boolean(value))
}

function getMissingTargetLabels(project: PublishProject) {
  return getMissingTargetSiteIds(project)
    .map(siteId => getSiteLabel(siteId))
    .join(', ')
}

async function loadData() {
  isLoading.value = true
  try {
    const result = await projectBridge.listProjects()
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    projects.value = result.data.projects
  } finally {
    isLoading.value = false
  }
}

function openProject(project: PublishProject) {
  router.push({
    name: getProjectResumeRouteName(project),
    params: { id: project.id },
  })
}

function openFolder(path: string) {
  const message: Message.Global.Path = { path }
  window.globalAPI.openFolder(JSON.stringify(message))
}

async function removeProject(project: PublishProject) {
  const result = await projectBridge.removeProject(project.id)
  if (!result.ok) {
    ElMessage.error(result.error.message)
    return
  }

  ElMessage.success(t('taskList.success.removed', { name: project.name }))
  await loadData()
}

function copyText(value?: string) {
  if (!value) {
    return
  }

  const message: Message.Global.Clipboard = { str: value }
  window.globalAPI.writeClipboard(JSON.stringify(message))
  ElMessage.success(t('taskList.success.copied'))
}

window.projectAPI.refreshProjectData(loadData)

onMounted(() => {
  void loadData()
})
</script>

<template>
  <div :class="['task-list', isPreviewMode ? 'task-list--preview' : 'task-list--full']" v-loading="isLoading">
    <section v-if="!isPreviewMode" class="task-list__overview">
      <article
        v-for="item in overviewItems"
        :key="item.label"
        :class="['task-list__overview-card surface-panel', `task-list__overview-card--${item.tone}`]"
      >
        <div class="task-list__overview-head">
          <span class="task-list__overview-icon">
            <el-icon><component :is="item.icon" /></el-icon>
          </span>
          <span class="task-list__overview-label">{{ item.label }}</span>
        </div>

        <div class="task-list__overview-value">{{ item.value }}</div>

        <div class="task-list__overview-track">
          <span :style="getOverviewTrackStyle(item)" />
        </div>

        <div class="task-list__overview-foot">
          <span class="task-list__overview-accent">{{ item.label }}</span>
          <span class="task-list__overview-percent">{{ item.percent }}%</span>
        </div>
      </article>
    </section>

    <section v-if="!isPreviewMode" class="task-list__toolbar surface-panel">
      <div class="task-list__toolbar-copy">
        <div class="eyebrow-text">{{ t('projects.panel.eyebrow') }}</div>
        <h3 class="task-list__toolbar-title">{{ t('projects.panel.title') }}</h3>
      </div>

      <div class="task-list__toolbar-controls">
        <div class="task-list__filters">
          <label class="task-list__filter">
            <span class="task-list__filter-label">{{ t('taskList.filter.showPublished') }}</span>
            <el-switch v-model="showPublished" />
          </label>

          <label class="task-list__filter task-list__filter--select">
            <span class="task-list__filter-label">{{ t('taskList.filter.mode.label') }}</span>
            <el-select v-model="projectModeFilter" class="task-list__mode-select" size="small">
              <el-option
                v-for="option in modeFilterOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </label>

          <label class="task-list__filter">
            <span class="task-list__filter-label">{{ t('taskList.filter.missingTargets') }}</span>
            <el-switch v-model="showOnlyMissingTargets" />
          </label>
        </div>
      </div>
    </section>

    <section v-if="!isPreviewMode && renderedProjects.length" class="task-list__grid">
      <article v-for="project in renderedProjects" :key="project.id" class="task-list__card surface-panel">
        <header class="task-list__card-header">
          <div class="task-list__card-copy">
            <div class="task-list__card-topline">
              <span class="task-list__card-id">#{{ project.id }}</span>
              <span class="task-list__card-updated">
                <el-icon><Timer /></el-icon>
                <span>{{ formatProjectTimestamp(project.updatedAt) }}</span>
              </span>
            </div>

            <h3 class="task-list__card-title">{{ project.name }}</h3>

            <div class="task-list__card-chips">
              <StatusChip :tone="projectStatusTones[project.status]">
                {{ getProjectStatusLabel(project.status) }}
              </StatusChip>
              <StatusChip tone="info">{{ getProjectStageLabel(project.stage) }}</StatusChip>
              <StatusChip tone="warning">{{ getProjectModeLabel(project.projectMode) }}</StatusChip>
              <StatusChip v-if="project.sourceKind">{{ getProjectSourceLabel(project.sourceKind) }}</StatusChip>
              <StatusChip v-if="getSiteEntries(project).length" tone="success">
                {{ getSiteEntries(project).length }} {{ t('taskList.card.links') }}
              </StatusChip>
              <StatusChip v-if="getProjectTargetProgress(project).pending" tone="warning">
                {{ getPublishStateLabel('pending') }} {{ getProjectTargetProgress(project).pending }}
              </StatusChip>
            </div>
          </div>
        </header>

        <section v-if="getProjectTargetProgress(project).total" class="task-list__progress surface-subtle">
          <div class="task-list__progress-main">
            <div>
              <div class="task-list__progress-eyebrow">{{ t('taskList.columns.status') }}</div>
              <div class="task-list__progress-value">
                {{ getProjectTargetProgress(project).published }}/{{ getProjectTargetProgress(project).total }}
              </div>
            </div>
            <div class="task-list__progress-rate">
              {{ getProjectTargetProgress(project).completionRate }}%
            </div>
          </div>

          <div class="task-list__progress-track">
            <span :style="getProjectProgressTrackStyle(project)" />
          </div>

          <div class="task-list__progress-breakdown">
            <span class="task-list__metric task-list__metric--success">
              {{ getPublishStateLabel('published') }} {{ getProjectTargetProgress(project).published }}
            </span>
            <span class="task-list__metric task-list__metric--warning">
              {{ getPublishStateLabel('pending') }} {{ getProjectTargetProgress(project).pending }}
            </span>
            <span
              v-if="getProjectTargetProgress(project).failed"
              class="task-list__metric task-list__metric--danger"
            >
              {{ getPublishStateLabel('failed') }} {{ getProjectTargetProgress(project).failed }}
            </span>
          </div>
        </section>

        <section class="task-list__detail-grid">
          <article class="task-list__detail surface-subtle">
            <div class="task-list__detail-head">
              <span class="task-list__detail-icon">
                <el-icon><FolderOpened /></el-icon>
              </span>
              <span>{{ t('taskList.details.workingDirectory') }}</span>
            </div>

            <button class="task-list__path-button" type="button" @click="copyText(project.workingDirectory)">
              {{ project.workingDirectory }}
            </button>

            <div class="task-list__detail-actions">
              <el-button link size="small" @click="copyText(project.workingDirectory)">
                {{ t('taskList.actions.copy') }}
              </el-button>
            </div>
          </article>

          <article class="task-list__detail surface-subtle">
            <div class="task-list__detail-head">
              <span class="task-list__detail-icon">
                <el-icon><Link /></el-icon>
              </span>
              <span>{{ t('taskList.card.links') }}</span>
            </div>

            <div v-if="getSiteEntries(project).length" class="task-list__link-list">
              <article
                v-for="[siteId, link] in getSiteEntries(project)"
                :key="`${project.id}-${siteId}`"
                class="task-list__link-item"
              >
                <div class="task-list__link-site">{{ getSiteLabel(siteId) }}</div>
                <div class="task-list__link-row">
                  <a
                    :href="link"
                    class="task-list__link-anchor"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ link }}
                  </a>
                  <el-button link size="small" @click="copyText(link)">{{ t('taskList.actions.copy') }}</el-button>
                </div>
              </article>
            </div>

            <div v-else class="task-list__detail-empty">
              {{ t('taskList.details.noLinks') }}
            </div>

            <div v-if="getMissingTargetSiteIds(project).length" class="task-list__missing">
              {{ getPublishStateLabel('pending') }}: {{ getMissingTargetLabels(project) }}
            </div>
          </article>
        </section>

        <SeriesProjectTreePreview v-if="project.projectMode === 'episode'" :project="project" />

        <footer class="task-list__card-actions">
          <el-button type="primary" @click="openProject(project)">{{ t('taskList.actions.continue') }}</el-button>
          <el-button plain @click="openFolder(project.workingDirectory)">
            {{ t('taskList.actions.openFolder') }}
          </el-button>
          <el-button text type="danger" @click="removeProject(project)">
            {{ t('taskList.actions.delete') }}
          </el-button>
        </footer>
      </article>
    </section>

    <section v-else-if="isPreviewMode && renderedProjects.length" class="task-list__preview-grid">
      <article v-for="project in renderedProjects" :key="project.id" class="task-list__preview-card surface-panel">
        <header class="task-list__preview-header">
          <div class="task-list__preview-copy">
            <div class="task-list__preview-id">#{{ project.id }}</div>
            <h3 class="task-list__preview-title">{{ project.name }}</h3>
          </div>
          <StatusChip :tone="projectStatusTones[project.status]">
            {{ getProjectStatusLabel(project.status) }}
          </StatusChip>
        </header>

        <div class="task-list__preview-meta">
          <span class="task-list__preview-meta-item">
            <el-icon><Timer /></el-icon>
            <span>{{ formatProjectTimestamp(project.updatedAt) }}</span>
          </span>
          <span v-if="getProjectTargetProgress(project).total" class="task-list__preview-meta-item">
            <el-icon><CircleCheck /></el-icon>
            <span>
              {{ getProjectTargetProgress(project).published }}/{{ getProjectTargetProgress(project).total }}
            </span>
          </span>
        </div>

        <div class="task-list__preview-chips">
          <StatusChip tone="info">{{ getProjectStageLabel(project.stage) }}</StatusChip>
          <StatusChip tone="warning">{{ getProjectModeLabel(project.projectMode) }}</StatusChip>
        </div>

        <footer class="task-list__preview-actions">
          <el-button type="primary" @click="openProject(project)">{{ t('taskList.actions.continue') }}</el-button>
          <el-button link @click="openFolder(project.workingDirectory)">
            {{ t('taskList.actions.openFolder') }}
          </el-button>
        </footer>
      </article>
    </section>

    <el-empty v-else class="task-list__empty surface-panel">
      <template #image>
        <div class="task-list__empty-image">
          <el-icon><Collection /></el-icon>
        </div>
      </template>

      <template #description>
        <div class="task-list__empty-copy">
          <div class="task-list__empty-title">{{ t('taskList.empty.title') }}</div>
          <div class="task-list__empty-description">{{ t('taskList.empty.description') }}</div>
        </div>
      </template>

      <template #default>
        <div v-if="!isPreviewMode" class="task-list__empty-actions">
          <router-link to="/new-project">
            <el-button type="primary">
              <el-icon><Plus /></el-icon>
              <span>{{ t('nav.newProject.label') }}</span>
            </el-button>
          </router-link>
          <el-button plain @click="loadData">
            <el-icon><RefreshRight /></el-icon>
            <span>{{ t('taskList.actions.refresh') }}</span>
          </el-button>
        </div>
      </template>
    </el-empty>

    <footer v-if="showOpenListAction" class="task-list__footer">
      <router-link to="/projects">
        <el-button plain>{{ t('taskList.actions.openList') }}</el-button>
      </router-link>
    </footer>
  </div>
</template>

<style scoped>
.task-list {
  display: grid;
  width: 100%;
}

.task-list--full {
  gap: 18px;
}

.task-list--preview {
  gap: 12px;
}

.task-list__overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.task-list__overview-card {
  position: relative;
  overflow: hidden;
  display: grid;
  gap: 14px;
  min-height: 168px;
  padding: 20px;
}

.task-list__overview-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 62%);
  pointer-events: none;
}

.task-list__overview-card--neutral {
  --overview-color: var(--text-secondary);
  --overview-fill: rgba(102, 91, 82, 0.12);
}

.task-list__overview-card--warning {
  --overview-color: var(--warning);
  --overview-fill: var(--warning-soft);
}

.task-list__overview-card--success {
  --overview-color: var(--success);
  --overview-fill: var(--success-soft);
}

.task-list__overview-card--info {
  --overview-color: var(--accent);
  --overview-fill: var(--accent-soft);
}

.task-list__overview-head,
.task-list__overview-value,
.task-list__overview-track,
.task-list__overview-foot {
  position: relative;
  z-index: 1;
}

.task-list__overview-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-list__overview-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 14px;
  background: var(--overview-fill);
  color: var(--overview-color);
}

.task-list__overview-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.task-list__overview-value {
  font-family: var(--font-display);
  font-size: clamp(2rem, 3vw, 2.45rem);
  line-height: 1;
  letter-spacing: -0.05em;
  color: var(--text-primary);
}

.task-list__overview-track {
  height: 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--overview-fill) 74%, var(--surface-subtle-fill));
  overflow: hidden;
}

.task-list__overview-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--overview-color), color-mix(in srgb, var(--overview-color) 54%, white));
}

.task-list__overview-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-list__overview-accent {
  color: var(--overview-color);
  font-size: 12px;
  font-weight: 700;
}

.task-list__overview-percent {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.task-list__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px 24px;
  padding: 22px 24px;
  align-items: end;
}

.task-list__toolbar-copy {
  max-width: 680px;
}

.task-list__toolbar-controls {
  display: grid;
  justify-items: end;
}

.task-list__toolbar-title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.2rem, 1.6vw, 1.55rem);
  line-height: 1.06;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.task-list__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px 18px;
}

.task-list__filter {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-soft-fill) 88%, transparent);
  color: var(--text-secondary);
}

.task-list__filter--select {
  justify-content: space-between;
  min-width: 252px;
}

.task-list__filter-label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.task-list__mode-select {
  min-width: 144px;
}

.task-list__mode-select :deep(.el-select__wrapper) {
  min-height: 34px;
  padding-inline: 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  box-shadow: none !important;
}

.task-list__mode-select :deep(.el-select__wrapper.is-hovering),
.task-list__mode-select :deep(.el-select__wrapper.is-focused) {
  background: color-mix(in srgb, var(--brand-soft) 65%, var(--bg-panel));
  box-shadow: none !important;
}

.task-list__grid,
.task-list__preview-grid {
  display: grid;
  gap: 16px;
}

.task-list__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.task-list__preview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.task-list__card,
.task-list__preview-card {
  position: relative;
  overflow: hidden;
}

.task-list__card {
  display: grid;
  gap: 18px;
  padding: 22px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-soft) 52%, transparent), transparent 32%),
    var(--surface-panel-wash),
    var(--bg-panel);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.task-list__card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.task-list__card-header,
.task-list__preview-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.task-list__card-topline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
}

.task-list__card-id,
.task-list__preview-id {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.task-list__card-updated,
.task-list__preview-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.task-list__card-title,
.task-list__preview-title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 1.28rem;
  line-height: 1.08;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.task-list__card-chips,
.task-list__preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-list__card-chips {
  margin-top: 14px;
}

.task-list__preview-card {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.task-list__preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.task-list__progress {
  display: grid;
  gap: 12px;
  padding: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--brand-soft) 30%, var(--surface-subtle-fill)), var(--surface-subtle-fill));
}

.task-list__progress-main {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.task-list__progress-eyebrow {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.task-list__progress-value {
  margin-top: 6px;
  font-family: var(--font-display);
  font-size: 1.5rem;
  line-height: 1;
  letter-spacing: -0.05em;
  color: var(--text-primary);
}

.task-list__progress-rate {
  color: var(--brand);
  font-size: 0.96rem;
  font-weight: 700;
}

.task-list__progress-track {
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-soft) 40%, var(--surface-soft-fill));
  overflow: hidden;
}

.task-list__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 56%, white));
}

.task-list__progress-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-list__metric {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.task-list__metric--success {
  background: var(--success-soft);
  color: var(--success);
}

.task-list__metric--warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.task-list__metric--danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.task-list__detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.task-list__detail {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
}

.task-list__detail-head {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.task-list__detail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 12px;
  background: var(--surface-soft-fill);
  color: var(--accent);
}

.task-list__path-button,
.task-list__link-anchor {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  word-break: break-all;
  cursor: pointer;
  transition: color 160ms ease;
}

.task-list__link-anchor:hover,
.task-list__path-button:hover {
  color: var(--brand);
}

.task-list__detail-actions,
.task-list__card-actions,
.task-list__preview-actions,
.task-list__empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.task-list__link-list {
  display: grid;
  gap: 10px;
}

.task-list__link-item {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.task-list__link-item:first-child {
  padding-top: 0;
  border-top: 0;
}

.task-list__link-site {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.task-list__link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.task-list__detail-empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.task-list__missing {
  color: var(--warning);
  font-size: 13px;
  line-height: 1.7;
}

.task-list__footer {
  display: flex;
  justify-content: center;
}

.task-list__empty {
  padding: 28px 18px;
}

.task-list__empty :deep(.el-empty__image) {
  margin-bottom: 18px;
}

.task-list__empty :deep(.el-empty__description) {
  margin-top: 0;
}

.task-list__empty-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 82px;
  height: 82px;
  border-radius: 28px;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.34), transparent 58%),
    color-mix(in srgb, var(--brand-soft) 72%, var(--surface-soft-fill));
  color: var(--brand);
  font-size: 2rem;
}

.task-list__empty-copy {
  display: grid;
  justify-items: center;
  gap: 8px;
  max-width: 32rem;
}

.task-list__empty-title {
  font-family: var(--font-display);
  font-size: 1.28rem;
  line-height: 1.1;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.task-list__empty-description {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.task-list__empty-actions {
  justify-content: center;
  margin-top: 12px;
}

.task-list__empty-actions > * {
  display: inline-flex;
}

@media (max-width: 1280px) {
  .task-list__overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-list__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 960px) {
  .task-list__toolbar,
  .task-list__preview-grid,
  .task-list__detail-grid {
    grid-template-columns: 1fr;
  }

  .task-list__toolbar-controls {
    justify-items: start;
    width: 100%;
  }

  .task-list__filters {
    justify-content: flex-start;
  }
}

@media (max-width: 720px) {
  .task-list--full {
    gap: 14px;
  }

  .task-list__toolbar,
  .task-list__card,
  .task-list__preview-card,
  .task-list__empty {
    padding: 18px;
  }

  .task-list__overview {
    grid-template-columns: 1fr;
  }

  .task-list__card-header,
  .task-list__preview-header {
    grid-template-columns: 1fr;
  }

  .task-list__progress-main {
    align-items: flex-start;
    flex-direction: column;
  }

  .task-list__filter,
  .task-list__filter--select,
  .task-list__card-actions,
  .task-list__preview-actions,
  .task-list__empty-actions {
    width: 100%;
  }

  .task-list__card-actions,
  .task-list__preview-actions,
  .task-list__empty-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .task-list__card-actions :deep(.el-button),
  .task-list__preview-actions :deep(.el-button),
  .task-list__empty-actions :deep(.el-button) {
    width: 100%;
    justify-content: center;
  }

  .task-list__filter {
    justify-content: space-between;
  }

  .task-list__filter--select {
    min-width: 0;
  }

  .task-list__mode-select {
    width: min(100%, 168px);
  }
}
</style>
