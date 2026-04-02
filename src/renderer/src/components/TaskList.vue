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
  projectStatusTones,
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

const overviewItems = computed(() => [
  {
    label: t('taskList.summary.total'),
    value: projects.value.length,
    tone: 'neutral' as const,
  },
  {
    label: t('taskList.summary.active'),
    value: projects.value.filter(project => project.status !== 'published').length,
    tone: 'warning' as const,
  },
  {
    label: t('taskList.summary.published'),
    value: projects.value.filter(project => project.status === 'published').length,
    tone: 'success' as const,
  },
  {
    label: t('taskList.summary.visible'),
    value: visibleProjects.value.length,
    tone: 'info' as const,
  },
])

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
  <div :class="['grid w-full', isPreviewMode ? 'gap-3' : 'gap-4']" v-loading="isLoading">
    <section v-if="!isPreviewMode" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article v-for="item in overviewItems" :key="item.label" class="surface-tile grid gap-2 px-4 py-4">
        <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
          {{ item.label }}
        </div>
        <div class="font-display text-[1.7rem] leading-none tracking-[-0.04em] text-copy-primary">
          {{ item.value }}
        </div>
        <StatusChip :tone="item.tone">{{ item.label }}</StatusChip>
      </article>
    </section>

    <section
      v-if="!isPreviewMode"
      class="surface-panel flex flex-col gap-3 px-4 py-4 xl:flex-row xl:items-end xl:justify-between"
    >
      <div class="min-w-0">
        <div class="font-display text-[1.2rem] leading-tight tracking-[-0.03em] text-copy-primary">
          {{ t('projects.panel.title') }}
        </div>
        <div class="mt-1.5 max-w-2xl text-[13px] leading-5 text-copy-secondary">
          {{ t('projects.panel.description') }}
        </div>
      </div>

      <div class="flex flex-wrap gap-2 xl:justify-end">
        <label class="soft-pill inline-flex min-h-9 items-center gap-2 px-3 text-[13px] text-copy-secondary">
          <span>{{ t('taskList.filter.showPublished') }}</span>
          <el-switch v-model="showPublished" />
        </label>
        <label class="soft-pill inline-flex min-h-9 items-center gap-2 px-3 py-1 text-[13px] text-copy-secondary">
          <span>{{ t('taskList.filter.mode.label') }}</span>
          <el-select v-model="projectModeFilter" class="min-w-[8rem]" size="small">
            <el-option
              v-for="option in modeFilterOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </label>
        <label class="soft-pill inline-flex min-h-9 items-center gap-2 px-3 text-[13px] text-copy-secondary">
          <span>{{ t('taskList.filter.missingTargets') }}</span>
          <el-switch v-model="showOnlyMissingTargets" />
        </label>
        <el-button plain @click="loadData">
          <el-icon><RefreshRight /></el-icon>
          <span>{{ t('taskList.actions.refresh') }}</span>
        </el-button>
      </div>
    </section>

    <section
      v-if="renderedProjects.length"
      class="grid gap-3"
      :class="isPreviewMode ? 'xl:grid-cols-2' : '2xl:grid-cols-2'"
    >
      <article
        v-for="project in renderedProjects"
        :key="project.id"
        :class="['surface-panel grid gap-3 px-4 py-4', isPreviewMode ? 'shadow-none' : '']"
      >
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">#{{ project.id }}</div>
            <h3 class="mt-1.5 font-display text-[1.2rem] leading-tight tracking-[-0.03em] text-copy-primary">
              {{ project.name }}
            </h3>
          </div>
          <StatusChip :tone="projectStatusTones[project.status]">
            {{ getProjectStatusLabel(project.status) }}
          </StatusChip>
        </header>

        <div class="flex flex-wrap gap-2">
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

        <div class="grid gap-3 lg:grid-cols-2">
          <article class="surface-subtle grid gap-2 px-3.5 py-3.5">
            <div class="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
              <el-icon><Timer /></el-icon>
              <span>{{ t('taskList.columns.updated') }}</span>
            </div>
            <div class="text-[13px] leading-5 text-copy-primary">
              {{ formatProjectTimestamp(project.updatedAt) }}
            </div>
          </article>

          <article class="surface-subtle grid gap-2 px-3.5 py-3.5">
            <div class="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ t('taskList.details.workingDirectory') }}</span>
            </div>
            <button
              class="min-w-0 break-all text-left text-[13px] leading-5 text-accent transition hover:text-brand"
              type="button"
              @click="copyText(project.workingDirectory)"
            >
              {{ project.workingDirectory }}
            </button>
          </article>
        </div>

        <section class="surface-subtle grid gap-3 px-3.5 py-3.5">
          <div class="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
            <el-icon><Link /></el-icon>
            <span>{{ t('taskList.card.links') }}</span>
          </div>

          <div v-if="getSiteEntries(project).length" class="grid gap-3">
            <article
              v-for="[siteId, link] in getSiteEntries(project)"
              :key="`${project.id}-${siteId}`"
              class="grid gap-2 border-t border-border-soft pt-3 first:border-t-0 first:pt-0"
            >
              <div class="text-[13px] font-semibold text-copy-primary">{{ getSiteLabel(siteId) }}</div>
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <a
                  :href="link"
                  class="min-w-0 break-all text-[13px] leading-5 text-accent transition hover:text-brand"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ link }}
                </a>
                <el-button link size="small" @click="copyText(link)">{{ t('taskList.actions.copy') }}</el-button>
              </div>
            </article>
          </div>

          <div v-if="getMissingTargetSiteIds(project).length" class="text-[13px] leading-5 text-warning">
            待发布：{{ getMissingTargetLabels(project) }}
          </div>

          <div
            v-if="!getSiteEntries(project).length && !getMissingTargetSiteIds(project).length"
            class="text-[13px] leading-5 text-copy-secondary"
          >
            {{ t('taskList.details.noLinks') }}
          </div>
        </section>

        <footer class="flex flex-wrap gap-2">
          <el-button type="primary" @click="openProject(project)">{{ t('taskList.actions.continue') }}</el-button>
          <el-button plain @click="openFolder(project.workingDirectory)">
            {{ t('taskList.actions.openFolder') }}
          </el-button>
          <template v-if="!isPreviewMode">
            <el-button plain @click="copyText(project.workingDirectory)">
              {{ t('taskList.actions.copy') }}
            </el-button>
            <el-button text type="danger" @click="removeProject(project)">
              {{ t('taskList.actions.delete') }}
            </el-button>
          </template>
        </footer>
      </article>
    </section>

    <el-empty v-else class="py-7" :description="t('taskList.empty.description')">
      <template #image>
        <div
          class="inline-flex h-16 w-16 items-center justify-center rounded-[20px] bg-brand-soft text-[1.5rem] text-brand"
        >
          <el-icon><Collection /></el-icon>
        </div>
      </template>
      <template #default>
        <div class="grid justify-items-center gap-2">
          <div class="font-display text-[1.2rem] tracking-[-0.03em] text-copy-primary">
            {{ t('taskList.empty.title') }}
          </div>
          <div class="max-w-[28rem] text-[13px] leading-5 text-copy-secondary">
            {{ t('taskList.empty.description') }}
          </div>
        </div>
      </template>
    </el-empty>

    <footer v-if="showOpenListAction" class="flex justify-center">
      <router-link to="/projects">
        <el-button plain>{{ t('taskList.actions.openList') }}</el-button>
      </router-link>
    </footer>
  </div>
</template>
