<script setup lang="ts" name="ProjectListWorkspace">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Collection, FolderOpened, Link, RefreshRight, Timer } from '@element-plus/icons-vue'
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
  getSiteLabel,
  projectStatusTones
} from '../services/project/presentation'
import type { ProjectMode, PublishProject } from '../types/project'
import type { SiteId } from '../types/site'

const props = withDefaults(
  defineProps<{
    variant?: 'full' | 'preview'
    limit?: number
  }>(),
  {
    variant: 'full',
    limit: 0
  }
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
  return [...projects.value].sort(
    (left, right) => {
      const priorityDelta = getProjectPriority(right) - getProjectPriority(left)
      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return getProjectTimeValue(right.updatedAt) - getProjectTimeValue(left.updatedAt)
    }
  )
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

const overviewItems = computed(() => [
  {
    label: t('taskList.summary.total'),
    value: projects.value.length,
    tone: 'neutral' as const
  },
  {
    label: t('taskList.summary.active'),
    value: projects.value.filter((project) => project.status !== 'published').length,
    tone: 'warning' as const
  },
  {
    label: t('taskList.summary.published'),
    value: projects.value.filter((project) => project.status === 'published').length,
    tone: 'success' as const
  },
  {
    label: t('taskList.summary.visible'),
    value: visibleProjects.value.length,
    tone: 'info' as const
  }
])

function getSiteEntries(project: PublishProject) {
  const entries = Object.entries({
    ...project.siteLinks,
    forum: project.forumLink
  }) as Array<[SiteId, string | undefined]>

  return entries.filter(([, value]) => Boolean(value))
}

function getMissingTargetLabels(project: PublishProject) {
  return getMissingTargetSiteIds(project).map(siteId => getSiteLabel(siteId)).join(', ')
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
    params: { id: project.id }
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
  <div :class="['project-list', { 'project-list--preview': isPreviewMode }]" v-loading="isLoading">
    <section v-if="!isPreviewMode" class="project-list__overview">
      <article v-for="item in overviewItems" :key="item.label" class="project-list__metric">
        <div class="project-list__metric-label">{{ item.label }}</div>
        <div class="project-list__metric-value">{{ item.value }}</div>
        <StatusChip :tone="item.tone">{{ item.label }}</StatusChip>
      </article>
    </section>

    <section v-if="!isPreviewMode" class="project-list__toolbar">
      <div class="project-list__toolbar-copy">
        <div class="project-list__toolbar-title">{{ t('projects.panel.title') }}</div>
        <div class="project-list__toolbar-text">{{ t('projects.panel.description') }}</div>
      </div>

      <div class="project-list__toolbar-actions">
        <label class="project-list__toggle">
          <span>{{ t('taskList.filter.showPublished') }}</span>
          <el-switch v-model="showPublished" />
        </label>
        <label class="project-list__toggle project-list__toggle--select">
          <span>{{ t('taskList.filter.mode.label') }}</span>
          <el-select v-model="projectModeFilter" class="project-list__select" size="small">
            <el-option v-for="option in modeFilterOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </label>
        <label class="project-list__toggle">
          <span>{{ t('taskList.filter.missingTargets') }}</span>
          <el-switch v-model="showOnlyMissingTargets" />
        </label>
        <el-button plain @click="loadData">
          <el-icon><RefreshRight /></el-icon>
          <span>{{ t('taskList.actions.refresh') }}</span>
        </el-button>
      </div>
    </section>

    <section v-if="renderedProjects.length" class="project-list__grid">
      <article v-for="project in renderedProjects" :key="project.id" class="project-card">
        <header class="project-card__head">
          <div class="project-card__title-group">
            <div class="project-card__eyebrow">#{{ project.id }}</div>
            <h3 class="project-card__title">{{ project.name }}</h3>
          </div>
          <StatusChip :tone="projectStatusTones[project.status]">
            {{ getProjectStatusLabel(project.status) }}
          </StatusChip>
        </header>

        <div class="project-card__chips">
          <StatusChip tone="info">{{ getProjectStageLabel(project.stage) }}</StatusChip>
          <StatusChip tone="warning">{{ getProjectModeLabel(project.projectMode) }}</StatusChip>
          <StatusChip v-if="project.sourceKind">{{ getProjectSourceLabel(project.sourceKind) }}</StatusChip>
          <StatusChip v-if="getMissingTargetSiteIds(project).length" tone="warning">
            待发布 {{ getMissingTargetSiteIds(project).length }}
          </StatusChip>
          <StatusChip v-if="getSiteEntries(project).length" tone="success">
            {{ getSiteEntries(project).length }} {{ t('taskList.card.links') }}
          </StatusChip>
        </div>

        <div class="project-card__meta">
          <article class="project-card__meta-card">
            <div class="project-card__meta-label">
              <el-icon><Timer /></el-icon>
              <span>{{ t('taskList.columns.updated') }}</span>
            </div>
            <div class="project-card__meta-value">
              {{ formatProjectTimestamp(project.updatedAt) }}
            </div>
          </article>

          <article class="project-card__meta-card project-card__meta-card--path">
            <div class="project-card__meta-label">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ t('taskList.details.workingDirectory') }}</span>
            </div>
            <button
              class="project-card__path"
              type="button"
              @click="copyText(project.workingDirectory)"
            >
              {{ project.workingDirectory }}
            </button>
          </article>
        </div>

        <section class="project-card__links-section">
          <div class="project-card__section-label">
            <el-icon><Link /></el-icon>
            <span>{{ t('taskList.card.links') }}</span>
          </div>

          <div v-if="getSiteEntries(project).length" class="project-card__links">
            <article
              v-for="[siteId, link] in getSiteEntries(project)"
              :key="`${project.id}-${siteId}`"
              class="project-card__link-row"
            >
              <div class="project-card__link-site">{{ getSiteLabel(siteId) }}</div>
              <div class="project-card__link-actions">
                <a :href="link" class="project-card__link" target="_blank" rel="noreferrer">
                  {{ link }}
                </a>
                <el-button link size="small" @click="copyText(link)">{{
                  t('taskList.actions.copy')
                }}</el-button>
              </div>
            </article>
          </div>

          <div v-if="getMissingTargetSiteIds(project).length" class="project-card__empty project-card__empty--warning">
            待发布：{{ getMissingTargetLabels(project) }}
          </div>

          <div v-if="!getSiteEntries(project).length && !getMissingTargetSiteIds(project).length" class="project-card__empty">
            {{ t('taskList.details.noLinks') }}
          </div>
        </section>

        <footer class="project-card__footer">
          <el-button type="primary" @click="openProject(project)">{{
            t('taskList.actions.continue')
          }}</el-button>
          <el-button plain @click="openFolder(project.workingDirectory)">
            {{ t('taskList.actions.openFolder') }}
          </el-button>
          <template v-if="!isPreviewMode">
            <el-button plain @click="copyText(project.workingDirectory)">{{
              t('taskList.actions.copy')
            }}</el-button>
            <el-button text type="danger" @click="removeProject(project)">
              {{ t('taskList.actions.delete') }}
            </el-button>
          </template>
        </footer>
      </article>
    </section>

    <el-empty
      v-else
      class="project-list__empty-state"
      :description="t('taskList.empty.description')"
    >
      <template #image>
        <div class="project-list__empty-icon">
          <el-icon><Collection /></el-icon>
        </div>
      </template>
      <template #default>
        <div class="project-list__empty-copy">
          <div class="project-list__empty-title">{{ t('taskList.empty.title') }}</div>
          <div class="project-list__empty-text">{{ t('taskList.empty.description') }}</div>
        </div>
      </template>
    </el-empty>

    <footer v-if="showOpenListAction" class="project-list__preview-footer">
      <router-link to="/projects">
        <el-button plain>{{ t('taskList.actions.openList') }}</el-button>
      </router-link>
    </footer>
  </div>
</template>

<style scoped>
.project-list {
  display: grid;
  gap: 18px;
  width: 100%;
}

.project-list__overview,
.project-list__grid {
  display: grid;
  gap: 14px;
}

.project-list__overview {
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}

.project-list__metric,
.project-list__toolbar,
.project-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.44), transparent 38%), var(--bg-panel);
}

.project-list__metric {
  display: grid;
  gap: 10px;
  padding: 18px;
}

.project-list__metric-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.project-list__metric-value {
  font-family: var(--font-display);
  font-size: clamp(28px, 4vw, 36px);
  font-weight: 700;
  letter-spacing: -0.05em;
}

.project-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.project-list__toolbar-copy {
  min-width: 0;
}

.project-list__toolbar-title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.project-list__toolbar-text {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.project-list__toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.project-list__toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.54);
  color: var(--text-secondary);
  font-size: 13px;
}

.project-list__toggle--select {
  gap: 12px;
}

.project-list__select {
  min-width: 9.5rem;
}

.project-list__grid {
  grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
}

.project-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  box-shadow: var(--shadow-md);
}

.project-card__head,
.project-card__footer {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.project-card__title-group {
  min-width: 0;
}

.project-card__eyebrow {
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.project-card__title {
  margin: 8px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
  word-break: break-word;
}

.project-card__chips,
.project-card__meta {
  display: grid;
  gap: 12px;
}

.project-card__chips {
  grid-template-columns: repeat(auto-fit, minmax(7rem, max-content));
  align-items: start;
}

.project-card__meta {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.project-card__meta-card,
.project-card__links-section {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.48);
}

.project-card__meta-card {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.project-card__meta-label,
.project-card__section-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.project-card__meta-value {
  font-size: 14px;
  line-height: 1.6;
}

.project-card__path,
.project-card__link {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}

.project-card__links-section {
  display: grid;
  gap: 14px;
  padding: 14px;
}

.project-card__links {
  display: grid;
  gap: 12px;
}

.project-card__link-row {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.project-card__link-row:first-child {
  padding-top: 0;
  border-top: 0;
}

.project-card__link-site {
  font-size: 14px;
  font-weight: 700;
}

.project-card__link-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-card__empty {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.project-card__empty--warning {
  color: var(--warning);
}

.project-card__footer {
  flex-wrap: wrap;
}

.project-list__empty-state {
  padding: 24px 0 8px;
}

.project-list__preview-footer {
  display: flex;
  justify-content: center;
}

.project-list--preview {
  gap: 14px;
}

.project-list--preview .project-list__grid {
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
}

.project-list--preview .project-card {
  padding: 18px;
  box-shadow: none;
}

.project-list__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
  border-radius: 28px;
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.74));
  color: var(--brand);
  font-size: 36px;
}

.project-list__empty-copy {
  display: grid;
  gap: 8px;
  justify-items: center;
}

.project-list__empty-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.project-list__empty-text {
  max-width: 28rem;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

@media (max-width: 980px) {
  .project-list__toolbar,
  .project-card__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .project-list__toolbar-actions {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 720px) {
  .project-list__metric,
  .project-list__toolbar,
  .project-card {
    padding: 14px;
  }

  .project-card__links-section,
  .project-card__meta-card {
    padding: 12px;
  }

  .project-list__toggle {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
