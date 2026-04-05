<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import AppPanel from '../../components/base/AppPanel.vue'
import PageShell from '../../components/layout/PageShell.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { logBridge } from '../../services/bridge/log'
import { projectBridge } from '../../services/bridge/project'
import {
  formatProjectTimestamp,
  getProjectStageLabel,
  getPublishStateLabel,
  getSiteLabel,
  publishStateTones,
  sortPublishResults
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

interface VirtualRange {
  start: number
  end: number
  paddingTop: number
  paddingBottom: number
}

interface IndexedLogLine {
  index: number
  content: string
}

const FILE_LIST_ITEM_HEIGHT = 92
const FILE_LIST_OVERSCAN = 6
const LOG_LINE_HEIGHT = 24
const LOG_LINE_OVERSCAN = 160

const router = useRouter()
const { t } = useI18n()
const isLoading = ref(false)
const isExportingDiagnostics = ref(false)
const errorMessage = ref('')
const logDirectory = ref('')
const files = ref<LogFileSummary[]>([])
const selectedFilePath = ref('')
const selectedContent = ref('')
const selectedContentLines = shallowRef<string[]>([])
const selectedFileLoading = ref(false)
const projects = ref<PublishProject[]>([])
const fileListViewportRef = ref<HTMLElement | null>(null)
const viewerViewportRef = ref<HTMLElement | null>(null)
const fileListScrollTop = ref(0)
const fileListViewportHeight = ref(FILE_LIST_ITEM_HEIGHT)
const viewerScrollTop = ref(0)
const viewerViewportHeight = ref(LOG_LINE_HEIGHT)

const selectedFile = computed(
  () => files.value.find((file) => file.path === selectedFilePath.value) ?? null
)
const latestFailures = computed<FailureEntry[]>(() => {
  return projects.value
    .flatMap((project) =>
      sortPublishResults(project.publishResults)
        .filter((result) => result.status === 'failed')
        .map((result) => ({
          projectId: project.id,
          projectName: project.name,
          stage: project.stage,
          result
        }))
    )
    .sort((left, right) => {
      const leftValue = new Date(left.result.timestamp ?? 0).getTime()
      const rightValue = new Date(right.result.timestamp ?? 0).getTime()
      return rightValue - leftValue
    })
    .slice(0, 12)
})

const fileCount = computed(() => files.value.length)
const fileListVirtualRange = computed(() =>
  getVirtualRange(
    files.value.length,
    fileListScrollTop.value,
    fileListViewportHeight.value,
    FILE_LIST_ITEM_HEIGHT,
    FILE_LIST_OVERSCAN
  )
)
const visibleFiles = computed(() =>
  files.value.slice(fileListVirtualRange.value.start, fileListVirtualRange.value.end)
)
const logViewerVirtualRange = computed(() =>
  getVirtualRange(
    selectedContentLines.value.length,
    viewerScrollTop.value,
    viewerViewportHeight.value,
    LOG_LINE_HEIGHT,
    LOG_LINE_OVERSCAN
  )
)
const visibleSelectedContentLines = computed<IndexedLogLine[]>(() =>
  selectedContentLines.value
    .slice(logViewerVirtualRange.value.start, logViewerVirtualRange.value.end)
    .map((content, offset) => ({
      index: logViewerVirtualRange.value.start + offset,
      content
    }))
)

const stageRouteMap: Record<
  ProjectStage,
  'edit' | 'check' | 'bt_publish' | 'forum_publish' | 'finish'
> = {
  edit: 'edit',
  review: 'check',
  torrent_publish: 'bt_publish',
  forum_publish: 'forum_publish',
  completed: 'finish'
}

function splitLogContent(content: string) {
  if (!content) {
    return []
  }

  return content.split(/\r?\n/)
}

function setSelectedContent(content: string) {
  selectedContent.value = content
  selectedContentLines.value = splitLogContent(content)
}

function getVirtualRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  overscan: number
): VirtualRange {
  if (total === 0) {
    return {
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0
    }
  }

  const safeViewportHeight = Math.max(viewportHeight, itemHeight)
  const rawStart = Math.max(0, Math.floor(scrollTop / itemHeight))
  const rawEnd = Math.max(rawStart + 1, Math.ceil((scrollTop + safeViewportHeight) / itemHeight))
  const start = Math.max(0, rawStart - overscan)
  const end = Math.min(total, rawEnd + overscan)

  return {
    start,
    end,
    paddingTop: start * itemHeight,
    paddingBottom: Math.max(0, (total - end) * itemHeight)
  }
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
    str: JSON.stringify(failure, null, 2)
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
        failureCount: result.data.includedFailureCount
      })
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
  resetViewerScroll()
  await nextTick()
  syncViewerViewportMetrics()

  try {
    const result = await logBridge.readLog(path)
    if (!result.ok) {
      setSelectedContent(result.error.message)
      return
    }

    setSelectedContent(result.data.content)
  } catch (error) {
    setSelectedContent((error as Error).message)
  } finally {
    selectedFileLoading.value = false
    await nextTick()
    syncViewerViewportMetrics()
  }
}

async function loadData() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const [logsResult, projectsResult] = await Promise.all([
      logBridge.listLogs(),
      projectBridge.listProjects()
    ])

    if (!logsResult.ok) {
      errorMessage.value = logsResult.error.message
      files.value = []
      logDirectory.value = ''
    } else {
      files.value = logsResult.data.files
      logDirectory.value = logsResult.data.directory

      const currentSelectionStillExists = logsResult.data.files.some(
        (file) => file.path === selectedFilePath.value
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
      setSelectedContent('')
    }
  } catch (error) {
    errorMessage.value = (error as Error).message
  } finally {
    isLoading.value = false
    await nextTick()
    syncFileListViewportMetrics()
    syncViewerViewportMetrics()
  }
}

function openProject(projectId: number, stage: ProjectStage) {
  router.push({
    name: stageRouteMap[stage],
    params: { id: projectId }
  })
}

function syncFileListViewportMetrics() {
  const element = fileListViewportRef.value
  if (!element) {
    fileListScrollTop.value = 0
    fileListViewportHeight.value = FILE_LIST_ITEM_HEIGHT
    return
  }

  fileListScrollTop.value = element.scrollTop
  fileListViewportHeight.value = element.clientHeight || FILE_LIST_ITEM_HEIGHT
}

function syncViewerViewportMetrics() {
  const element = viewerViewportRef.value
  if (!element) {
    viewerScrollTop.value = 0
    viewerViewportHeight.value = LOG_LINE_HEIGHT
    return
  }

  viewerScrollTop.value = element.scrollTop
  viewerViewportHeight.value = element.clientHeight || LOG_LINE_HEIGHT
}

function handleFileListScroll(event: Event) {
  const element = event.target as HTMLElement
  fileListScrollTop.value = element.scrollTop
  fileListViewportHeight.value = element.clientHeight || FILE_LIST_ITEM_HEIGHT
}

function handleViewerScroll(event: Event) {
  const element = event.target as HTMLElement
  viewerScrollTop.value = element.scrollTop
  viewerViewportHeight.value = element.clientHeight || LOG_LINE_HEIGHT
}

function resetViewerScroll() {
  viewerScrollTop.value = 0
  viewerViewportRef.value?.scrollTo({ top: 0 })
}

function handleWindowResize() {
  syncFileListViewportMetrics()
  syncViewerViewportMetrics()
}

onMounted(() => {
  void loadData()
  window.projectAPI.refreshProjectData(() => {
    void loadData()
  })
  window.addEventListener('resize', handleWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
})
</script>

<template>
  <PageShell>
    <div class="flex min-h-full flex-col gap-4">
      <section
        class="surface-panel flex flex-col gap-3 px-4 py-4 lg:px-5 lg:py-5 xl:flex-row xl:items-center xl:justify-between"
      >
        <div class="flex flex-wrap gap-3">
          <el-button plain @click="loadData">{{ t('common.refresh') }}</el-button>
          <el-button plain :loading="isExportingDiagnostics" @click="exportDiagnostics">
            {{ t('logs.actions.export') }}
          </el-button>
          <el-button plain :disabled="!logDirectory" @click="openLogsFolder">
            {{ t('logs.actions.openFolder') }}
          </el-button>
        </div>
        <div class="flex flex-wrap gap-2">
          <StatusChip tone="success">{{
            t('logs.hero.fileCount', { count: fileCount })
          }}</StatusChip>
          <StatusChip :tone="latestFailures.length > 0 ? 'warning' : 'info'">
            {{ t('logs.hero.failureCount', { count: latestFailures.length }) }}
          </StatusChip>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-12">
        <div class="xl:col-span-4">
          <AppPanel class="logs-panel" :title="t('logs.panel.files.title')">
            <div
              v-if="errorMessage"
              class="logs-state surface-subtle text-center text-sm leading-6 text-danger"
            >
              {{ errorMessage }}
            </div>
            <div
              v-else-if="isLoading && files.length === 0"
              class="logs-state surface-subtle text-center text-sm leading-6 text-copy-secondary"
            >
              {{ t('logs.empty.loadingFiles') }}
            </div>
            <div
              v-else-if="files.length === 0"
              class="logs-state surface-subtle text-center text-sm leading-6 text-copy-secondary"
            >
              {{ t('logs.empty.noFiles') }}
            </div>
            <div
              v-else
              ref="fileListViewportRef"
              class="logs-list-scroll"
              @scroll.passive="handleFileListScroll"
            >
              <div :style="{ height: `${fileListVirtualRange.paddingTop}px` }"></div>
              <div
                v-for="file in visibleFiles"
                :key="file.path"
                class="logs-file-item"
                :style="{ height: `${FILE_LIST_ITEM_HEIGHT}px` }"
              >
                <button
                  :class="[
                    'logs-file-button surface-tile w-full px-4 py-4 text-left',
                    file.path === selectedFilePath ? 'logs-file-button--active' : ''
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
              <div :style="{ height: `${fileListVirtualRange.paddingBottom}px` }"></div>
            </div>
          </AppPanel>
        </div>

        <div class="xl:col-span-8">
          <AppPanel class="logs-panel" :title="t('logs.panel.viewer.title')">
            <div v-if="selectedFile" class="logs-viewer-stack">
              <div
                class="flex flex-col gap-3 border-b border-border-soft pb-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <div class="font-semibold text-copy-primary">{{ selectedFile.name }}</div>
                  <div class="mt-1 text-xs leading-6 text-copy-secondary">
                    {{ formatProjectTimestamp(selectedFile.updatedAt) }} /
                    {{ formatBytes(selectedFile.size) }}
                  </div>
                </div>
                <StatusChip :tone="selectedFileLoading ? 'warning' : 'info'">
                  {{ selectedFileLoading ? t('logs.status.reading') : t('logs.status.loaded') }}
                </StatusChip>
              </div>

              <div
                ref="viewerViewportRef"
                class="logs-code-block logs-viewer-scroll"
                @scroll.passive="handleViewerScroll"
              >
                <div :style="{ height: `${logViewerVirtualRange.paddingTop}px` }"></div>
                <div
                  v-for="line in visibleSelectedContentLines"
                  :key="line.index"
                  class="logs-code-line"
                  :style="{ height: `${LOG_LINE_HEIGHT}px` }"
                >
                  {{ line.content }}
                </div>
                <div :style="{ height: `${logViewerVirtualRange.paddingBottom}px` }"></div>
              </div>
            </div>

            <div
              v-else
              class="logs-state surface-subtle text-center text-sm leading-6 text-copy-secondary"
            >
              {{ t('logs.empty.selectFile') }}
            </div>
          </AppPanel>
        </div>
      </section>

      <AppPanel :title="t('logs.panel.failures.title')">
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

            <details
              v-if="failure.result.rawResponse !== undefined"
              class="mt-4 text-sm text-copy-secondary"
            >
              <summary class="cursor-pointer font-semibold text-copy-primary">
                {{ t('common.rawResponse') }}
              </summary>
              <pre
                class="logs-code-block mt-3 overflow-auto rounded-[18px] border border-border-soft p-4 text-xs leading-6 whitespace-pre-wrap break-words text-copy-primary"
                >{{ formatRawResponse(failure.result.rawResponse) }}</pre
              >
            </details>
          </article>
        </div>
      </AppPanel>
    </div>
  </PageShell>
</template>

<style scoped>
.logs-panel {
  display: flex;
  flex-direction: column;
  min-height: clamp(28rem, 72vh, 56rem);
}

.logs-panel :deep(.app-panel__content) {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.logs-list-scroll,
.logs-viewer-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  contain: layout paint;
}

.logs-list-scroll {
  padding-right: 0.25rem;
}

.logs-viewer-stack {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.logs-state {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.logs-file-button {
  height: 100%;
  contain: layout paint;
}

.logs-file-item {
  box-sizing: border-box;
  padding-bottom: 0.75rem;
}

.logs-file-button--active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
}

.logs-code-block {
  background: var(--surface-code-fill);
  margin-top: 1rem;
  border: 1px solid var(--border-soft);
  border-radius: 22px;
  padding: 1rem;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.75;
  font-family:
    'SFMono-Regular',
    Consolas,
    'Liberation Mono',
    Menlo,
    monospace;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.logs-code-line {
  line-height: 24px;
}
</style>
