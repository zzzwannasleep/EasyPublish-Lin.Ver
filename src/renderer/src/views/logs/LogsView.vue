<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppPanel from '../../components/base/AppPanel.vue'
import WindowToolbar from '../../components/layout/WindowToolbar.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { useAppChrome } from '../../services/app-chrome'
import { logBridge } from '../../services/bridge/log'
import { projectBridge } from '../../services/bridge/project'
import {
  formatProjectTimestamp,
  getProjectStageLabel,
  getPublishStateLabel,
  getSiteLabel,
  publishStateTones,
  sortPublishResults,
} from '../../services/project/presentation'
import type { LogFileSummary } from '../../types/log'
import type { ProjectStage, PublishProject } from '../../types/project'
import type { PublishResult } from '../../types/publish'

interface FailureEntry {
  projectId: number
  projectName: string
  stage: ProjectStage
  result: PublishResult
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const chrome = useAppChrome()
const isLoading = ref(false)
const isExportingDiagnostics = ref(false)
const errorMessage = ref('')
const logDirectory = ref('')
const files = ref<LogFileSummary[]>([])
const selectedFilePath = ref('')
const selectedContent = ref('')
const selectedFileLoading = ref(false)
const projects = ref<PublishProject[]>([])

const selectedFile = computed(() => files.value.find(file => file.path === selectedFilePath.value) ?? null)
const latestFailures = computed<FailureEntry[]>(() => {
  return projects.value
    .flatMap(project =>
      sortPublishResults(project.publishResults)
        .filter(result => result.status === 'failed')
        .map(result => ({
          projectId: project.id,
          projectName: project.name,
          stage: project.stage,
          result,
        })),
    )
    .sort((left, right) => {
      const leftValue = new Date(left.result.timestamp ?? 0).getTime()
      const rightValue = new Date(right.result.timestamp ?? 0).getTime()
      return rightValue - leftValue
    })
    .slice(0, 12)
})

const fileCount = computed(() => files.value.length)

const stageRouteMap: Record<ProjectStage, 'edit' | 'check' | 'bt_publish' | 'forum_publish' | 'finish'> = {
  edit: 'edit',
  review: 'check',
  torrent_publish: 'bt_publish',
  forum_publish: 'forum_publish',
  completed: 'finish',
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function openLogsFolder() {
  if (!logDirectory.value) {
    return
  }

  const message: Message.Global.Path = { path: logDirectory.value }
  window.globalAPI.openFolder(JSON.stringify(message))
}

function formatRawResponse(rawResponse: unknown) {
  if (rawResponse === undefined) {
    return ''
  }

  return JSON.stringify(rawResponse, null, 2)
}

function copyFailureSnapshot(failure: FailureEntry) {
  const message: Message.Global.Clipboard = {
    str: JSON.stringify(failure, null, 2),
  }
  window.globalAPI.writeClipboard(JSON.stringify(message))
  ElMessage.success(t('logs.messages.copyFailure'))
}

async function exportDiagnostics() {
  isExportingDiagnostics.value = true

  try {
    const result = await logBridge.exportDiagnostics()
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    if (result.data.canceled) {
      ElMessage.info(t('logs.messages.exportCanceled'))
      return
    }

    ElMessage.success(
      t('logs.messages.exportSuccess', {
        logCount: result.data.includedLogCount,
        failureCount: result.data.includedFailureCount,
      }),
    )
  } catch (error) {
    ElMessage.error((error as Error).message)
  } finally {
    isExportingDiagnostics.value = false
  }
}

async function readLog(path: string) {
  selectedFileLoading.value = true
  selectedFilePath.value = path

  try {
    const result = await logBridge.readLog(path)
    if (!result.ok) {
      selectedContent.value = result.error.message
      return
    }

    selectedContent.value = result.data.content
  } catch (error) {
    selectedContent.value = (error as Error).message
  } finally {
    selectedFileLoading.value = false
  }
}

async function loadData() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const [logsResult, projectsResult] = await Promise.all([logBridge.listLogs(), projectBridge.listProjects()])

    if (!logsResult.ok) {
      errorMessage.value = logsResult.error.message
      files.value = []
      logDirectory.value = ''
    } else {
      files.value = logsResult.data.files
      logDirectory.value = logsResult.data.directory

      const currentSelectionStillExists = logsResult.data.files.some(
        file => file.path === selectedFilePath.value,
      )
      if (!currentSelectionStillExists) {
        selectedFilePath.value = logsResult.data.files[0]?.path ?? ''
      }
    }

    if (!projectsResult.ok) {
      if (!errorMessage.value) {
        errorMessage.value = projectsResult.error.message
      }
      projects.value = []
    } else {
      projects.value = projectsResult.data.projects
    }

    if (selectedFilePath.value) {
      await readLog(selectedFilePath.value)
    } else {
      selectedContent.value = ''
    }
  } catch (error) {
    errorMessage.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

function openProject(projectId: number, stage: ProjectStage) {
  router.push({
    name: stageRouteMap[stage],
    params: { id: projectId },
  })
}

onMounted(() => {
  void loadData()
  window.projectAPI.refreshProjectData(() => {
    void loadData()
  })
})
</script>

<template>
  <div class="logs-page">
    <WindowToolbar
      :current-path="route.path"
      :dark="chrome.isDark"
      :active-toolbar-menu="chrome.activeToolbarMenu"
      :theme-palette="chrome.activeThemePalette"
      :theme-palette-options="chrome.themePaletteOptions"
      :locale="chrome.locale"
      :locale-options="chrome.localeOptions"
      @close="chrome.winClose"
      @maximize="chrome.winMax"
      @minimize="chrome.winMini"
      @toggle-toolbar-menu="chrome.toggleToolbarMenu"
      @close-toolbar-menu="chrome.closeToolbarMenu"
      @set-theme-mode="chrome.setThemeMode"
      @select-theme-palette="chrome.setThemePalette"
      @change-locale="chrome.changeLocale"
    >
      <template #utility>
        <button
          :class="[
            'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
            chrome.activeToolbarMenu === 'proxy' ? 'logs-page__utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="chrome.toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
        <el-form :model="chrome.proxyForm" label-position="top" class="logs-page__proxy-form">
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
          <el-form-item class="logs-page__proxy-actions">
            <el-button type="primary" @click="chrome.setProxyConfig">{{ t('common.save') }}</el-button>
            <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </template>
    </WindowToolbar>

    <main class="logs-page__main">
      <div class="flex min-h-full flex-col gap-4">
        <section
          class="surface-panel flex flex-col gap-3 px-4 py-4 lg:px-5 lg:py-5 xl:flex-row xl:items-end xl:justify-between"
        >
          <div class="max-w-3xl">
            <div class="eyebrow-text">{{ t('logs.hero.eyebrow') }}</div>
            <h1 class="mt-2 font-display text-[clamp(1.2rem,1.6vw,1.55rem)] leading-tight tracking-[-0.03em] text-copy-primary">
              {{ t('logs.hero.title') }}
            </h1>
            <p class="mt-2 text-[13px] leading-5 text-copy-secondary">{{ t('logs.hero.summary') }}</p>
          </div>

          <div class="flex flex-wrap gap-2">
            <StatusChip tone="success">{{ t('logs.hero.fileCount', { count: fileCount }) }}</StatusChip>
            <StatusChip :tone="latestFailures.length > 0 ? 'warning' : 'info'">
              {{ t('logs.hero.failureCount', { count: latestFailures.length }) }}
            </StatusChip>
          </div>
        </section>

        <section class="grid gap-4 xl:grid-cols-12">
      <div class="xl:col-span-4">
        <AppPanel
          :eyebrow="t('logs.panel.files.eyebrow')"
          :title="t('logs.panel.files.title')"
          :description="t('logs.panel.files.description')"
        >
          <div class="mb-4 flex flex-wrap gap-3">
            <el-button plain @click="loadData">{{ t('common.refresh') }}</el-button>
            <el-button plain :loading="isExportingDiagnostics" @click="exportDiagnostics">
              {{ t('logs.actions.export') }}
            </el-button>
            <el-button plain :disabled="!logDirectory" @click="openLogsFolder">
              {{ t('logs.actions.openFolder') }}
            </el-button>
          </div>

          <div
            v-if="errorMessage"
            class="surface-subtle px-4 py-8 text-center text-sm leading-6 text-danger"
          >
            {{ errorMessage }}
          </div>
          <div
            v-else-if="isLoading && files.length === 0"
            class="surface-subtle px-4 py-8 text-center text-sm leading-6 text-copy-secondary"
          >
            {{ t('logs.empty.loadingFiles') }}
          </div>
          <div
            v-else-if="files.length === 0"
            class="surface-subtle px-4 py-8 text-center text-sm leading-6 text-copy-secondary"
          >
            {{ t('logs.empty.noFiles') }}
          </div>
          <div v-else class="grid gap-3">
            <button
              v-for="file in files"
              :key="file.path"
              :class="[
                'logs-file-button surface-tile w-full px-4 py-4 text-left',
                file.path === selectedFilePath ? 'logs-file-button--active' : '',
              ]"
              type="button"
              @click="readLog(file.path)"
            >
              <div class="font-semibold text-copy-primary">{{ file.name }}</div>
              <div class="mt-1 text-xs leading-6 text-copy-secondary">
                {{ formatProjectTimestamp(file.updatedAt) }} / {{ formatBytes(file.size) }}
              </div>
            </button>
          </div>
        </AppPanel>
      </div>

      <div class="xl:col-span-8">
        <AppPanel
          :eyebrow="t('logs.panel.viewer.eyebrow')"
          :title="t('logs.panel.viewer.title')"
          :description="t('logs.panel.viewer.description')"
        >
          <div
            v-if="selectedFile"
            class="flex flex-col gap-3 border-b border-border-soft pb-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div>
              <div class="font-semibold text-copy-primary">{{ selectedFile.name }}</div>
              <div class="mt-1 text-xs leading-6 text-copy-secondary">
                {{ formatProjectTimestamp(selectedFile.updatedAt) }} / {{ formatBytes(selectedFile.size) }}
              </div>
            </div>
            <StatusChip :tone="selectedFileLoading ? 'warning' : 'info'">
              {{ selectedFileLoading ? t('logs.status.reading') : t('logs.status.loaded') }}
            </StatusChip>
          </div>

          <div
            v-else
            class="surface-subtle px-4 py-8 text-center text-sm leading-6 text-copy-secondary"
          >
            {{ t('logs.empty.selectFile') }}
          </div>

          <pre
            v-if="selectedFile"
            class="logs-code-block mt-4 min-h-[420px] max-h-[720px] overflow-auto rounded-[22px] border border-border-soft p-4 text-sm leading-6 whitespace-pre-wrap break-words text-copy-primary"
          >{{ selectedContent }}</pre>
        </AppPanel>
      </div>
    </section>

        <AppPanel
          :eyebrow="t('logs.panel.failures.eyebrow')"
          :title="t('logs.panel.failures.title')"
          :description="t('logs.panel.failures.description')"
        >
      <div
        v-if="latestFailures.length === 0"
        class="surface-subtle px-4 py-8 text-center text-sm leading-6 text-copy-secondary"
      >
        {{ t('logs.empty.noFailures') }}
      </div>

      <div v-else class="grid gap-3">
        <article
          v-for="failure in latestFailures"
          :key="`${failure.projectId}-${failure.result.siteId}-${failure.result.timestamp}`"
          class="surface-subtle px-5 py-5"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="font-semibold text-copy-primary">{{ failure.projectName }}</div>
              <div class="mt-1 text-xs leading-6 text-copy-secondary">
                {{ getSiteLabel(failure.result.siteId) }}
                /
                {{ getProjectStageLabel(failure.stage) }}
                /
                {{ formatProjectTimestamp(failure.result.timestamp) }}
              </div>
            </div>
            <StatusChip :tone="publishStateTones[failure.result.status]">
              {{ getPublishStateLabel(failure.result.status) }}
            </StatusChip>
          </div>

          <div class="mt-3 text-sm leading-6 text-copy-secondary">
            {{ failure.result.message || t('logs.messages.noFailureMessage') }}
          </div>

          <div v-if="failure.result.remoteId" class="mt-3 text-xs leading-6 text-copy-secondary">
            {{ t('common.remoteId') }}: {{ failure.result.remoteId }}
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <el-button link type="primary" @click="openProject(failure.projectId, failure.stage)">
              {{ t('logs.actions.openProject') }}
            </el-button>
            <el-button link type="primary" @click="copyFailureSnapshot(failure)">
              {{ t('common.copyJson') }}
            </el-button>
            <a
              v-if="failure.result.remoteUrl"
              :href="failure.result.remoteUrl"
              class="break-all text-sm leading-6 text-accent transition hover:text-brand"
              target="_blank"
              rel="noreferrer"
            >
              {{ failure.result.remoteUrl }}
            </a>
          </div>

          <details v-if="failure.result.rawResponse !== undefined" class="mt-4 text-sm text-copy-secondary">
            <summary class="cursor-pointer font-semibold text-copy-primary">
              {{ t('common.rawResponse') }}
            </summary>
            <pre
              class="logs-code-block mt-3 overflow-auto rounded-[18px] border border-border-soft p-4 text-xs leading-6 whitespace-pre-wrap break-words text-copy-primary"
            >{{ formatRawResponse(failure.result.rawResponse) }}</pre>
          </details>
        </article>
      </div>
        </AppPanel>
      </div>
    </main>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
}

.logs-page__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.logs-page__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.logs-page__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.logs-page__proxy-actions {
  margin-bottom: 0;
}

.logs-file-button--active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
}

.logs-code-block {
  background: var(--surface-code-fill);
}
</style>
