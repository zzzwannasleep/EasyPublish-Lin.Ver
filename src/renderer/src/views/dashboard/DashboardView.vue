<script setup lang="ts">
import { computed, onMounted, reactive, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { Document, DocumentAdd, FolderOpened, Key } from '@element-plus/icons-vue'
import TaskList from '../../components/TaskList.vue'
import AppShell from '../../components/layout/AppShell.vue'
import { useI18n } from '../../i18n'
import { useAppChrome } from '../../services/app-chrome'
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
const route = useRoute()
const chrome = useAppChrome()
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
  <div class="h-full w-full">
    <AppShell
      :nav-items="chrome.navItems"
      :current-path="route.path"
      :title="chrome.pageTitle"
      :subtitle="chrome.pageSubtitle"
      :dark="chrome.isDark"
      :active-toolbar-menu="chrome.activeToolbarMenu"
      :theme-palette="chrome.activeThemePalette"
      :theme-palette-options="chrome.themePaletteOptions"
      :sidebar-expanded="chrome.sidebarExpanded"
      :locale="chrome.locale"
      :locale-options="chrome.localeOptions"
      @close="chrome.winClose"
      @maximize="chrome.winMax"
      @minimize="chrome.winMini"
      @toggle-toolbar-menu="chrome.toggleToolbarMenu"
      @close-toolbar-menu="chrome.closeToolbarMenu"
      @set-theme-mode="chrome.setThemeMode"
      @select-theme-palette="chrome.setThemePalette"
      @toggle-sidebar="chrome.toggleSidebar"
      @change-locale="chrome.changeLocale"
    >
      <template #utility>
        <button
          :class="[
            'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
            chrome.activeToolbarMenu === 'proxy' ? 'dashboard-view__utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="chrome.toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
        <el-form :model="chrome.proxyForm" label-position="top" class="dashboard-view__proxy-form">
          <el-form-item :label="t('app.proxy.enabled')">
            <el-switch v-model="chrome.proxyForm.status" />
          </el-form-item>
          <el-form-item :label="t('app.proxy.type')">
            <el-select v-model="chrome.proxyForm.type" :placeholder="t('common.selectProtocol')">
              <el-option label="HTTP" value="http" />
              <el-option label="HTTPS" value="https" />
              <el-option label="SOCKS5" value="socks" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('app.proxy.host')">
            <el-input v-model="chrome.proxyForm.host" />
          </el-form-item>
          <el-form-item :label="t('app.proxy.port')">
            <el-input-number v-model="chrome.proxyForm.port" />
          </el-form-item>
          <el-form-item class="dashboard-view__proxy-actions">
            <el-button type="primary" @click="chrome.setProxyConfig">{{ t('common.save') }}</el-button>
            <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </template>

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
    </AppShell>
  </div>
</template>

<style scoped>
.dashboard-view__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.dashboard-view__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.dashboard-view__proxy-actions {
  margin-bottom: 0;
}
</style>
