<script setup lang="ts">
import { computed, onMounted, reactive, type Component } from 'vue'
import { Document, DocumentAdd, FolderOpened, Key } from '@element-plus/icons-vue'
import TaskList from '../../components/TaskList.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import type { ProjectStats } from '../../types/project'

interface QuickLinkItem {
  to: string
  title: string
  text: string
  icon: Component
  iconClass: string
}

function createEmptyStats(): ProjectStats {
  return {
    total: 0,
    active: 0,
    published: 0,
    recent: 0,
    byStage: {
      edit: 0,
      review: 0,
      torrent_publish: 0,
      forum_publish: 0,
      completed: 0,
    },
    byMode: {
      episode: 0,
      feature: 0,
    },
    bySourceKind: {
      quick: 0,
      file: 0,
      template: 0,
    },
  }
}

const { t } = useI18n()
const stats = reactive<ProjectStats>(createEmptyStats())

const quickLinks = computed<QuickLinkItem[]>(() => [
  {
    to: '/new-project',
    title: t('dashboard.quickLinks.create.title'),
    text: t('dashboard.quickLinks.create.text'),
    icon: DocumentAdd,
    iconClass: 'bg-brand-soft text-brand',
  },
  {
    to: '/projects',
    title: t('dashboard.quickLinks.projects.title'),
    text: t('dashboard.quickLinks.projects.text'),
    icon: FolderOpened,
    iconClass: 'bg-accent-soft text-accent',
  },
  {
    to: '/accounts',
    title: t('dashboard.quickLinks.accounts.title'),
    text: t('dashboard.quickLinks.accounts.text'),
    icon: Key,
    iconClass: 'bg-warning-soft text-warning',
  },
  {
    to: '/logs',
    title: t('dashboard.quickLinks.logs.title'),
    text: t('dashboard.quickLinks.logs.text'),
    icon: Document,
    iconClass: 'bg-success-soft text-success',
  },
])

const statCards = computed(() => [
  {
    key: 'total',
    label: t('taskList.summary.total'),
    value: stats.total,
    text: t('dashboard.stats.total.text'),
  },
  {
    key: 'active',
    label: t('taskList.summary.active'),
    value: stats.active,
    text: t('dashboard.stats.active.text'),
  },
  {
    key: 'published',
    label: t('taskList.summary.published'),
    value: stats.published,
    text: t('dashboard.stats.published.text'),
  },
  {
    key: 'recent',
    label: t('dashboard.stats.recent.label'),
    value: stats.recent,
    text: t('dashboard.stats.recent.text'),
  },
])

async function loadStats() {
  const result = await projectBridge.getProjectStats()
  if (!result.ok) {
    return
  }

  const nextStats = createEmptyStats()
  Object.assign(nextStats, result.data.stats, {
    byStage: {
      ...nextStats.byStage,
      ...result.data.stats.byStage,
    },
    byMode: {
      ...nextStats.byMode,
      ...result.data.stats.byMode,
    },
    bySourceKind: {
      ...nextStats.bySourceKind,
      ...result.data.stats.bySourceKind,
    },
  })

  Object.assign(stats, nextStats)
}

onMounted(() => {
  void loadStats()
  window.projectAPI.refreshProjectData(loadStats)
})
</script>

<template>
  <div class="flex min-h-full flex-col gap-4">
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article v-for="card in statCards" :key="card.key" class="surface-tile px-4 py-4">
        <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
          {{ card.label }}
        </div>
        <div class="mt-2 font-display text-[1.7rem] leading-none tracking-[-0.04em] text-copy-primary">
          {{ card.value }}
        </div>
      </article>
    </section>

    <section class="grid gap-3">
      <h2 class="font-display text-[1.15rem] leading-tight tracking-[-0.03em] text-copy-primary">
        {{ t('dashboard.panel.links.title') }}
      </h2>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <router-link
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="surface-tile group flex h-full items-center justify-between gap-4 px-4 py-4"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span
              :class="[
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] shadow-[0_6px_16px_rgba(39,26,13,0.08)]',
                link.iconClass,
              ]"
            >
              <el-icon :size="18"><component :is="link.icon" /></el-icon>
            </span>
            <h3 class="truncate font-display text-[1.05rem] leading-tight tracking-[-0.03em] text-copy-primary">
              {{ link.title }}
            </h3>
          </div>

          <span class="text-[12px] font-medium text-copy-secondary transition group-hover:text-brand">
            {{ t('dashboard.quickLinks.action') }}
          </span>
        </router-link>
      </div>
    </section>

    <section class="grid gap-3">
      <h2 class="font-display text-[1.15rem] leading-tight tracking-[-0.03em] text-copy-primary">
        {{ t('dashboard.panel.projects.title') }}
      </h2>

      <TaskList variant="preview" :limit="4" />
    </section>
  </div>
</template>
