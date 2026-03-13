<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppPanel from '../../components/base/AppPanel.vue'
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

const router = useRouter()
const { t } = useI18n()
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
    const [logsResult, projectsResult] = await Promise.all([
      logBridge.listLogs(),
      projectBridge.listProjects(),
    ])

    if (!logsResult.ok) {
      errorMessage.value = logsResult.error.message
      files.value = []
      logDirectory.value = ''
    } else {
      files.value = logsResult.data.files
      logDirectory.value = logsResult.data.directory

      const currentSelectionStillExists = logsResult.data.files.some(file => file.path === selectedFilePath.value)
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
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('logs.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('logs.hero.title') }}</h1>
        <p class="page-summary">{{ t('logs.hero.summary') }}</p>
      </div>
      <div class="stack-list">
        <StatusChip tone="success">{{ t('logs.hero.fileCount', { count: fileCount }) }}</StatusChip>
        <StatusChip :tone="latestFailures.length > 0 ? 'warning' : 'info'">
          {{ t('logs.hero.failureCount', { count: latestFailures.length }) }}
        </StatusChip>
      </div>
    </section>

    <section class="page-grid">
      <div class="span-4">
        <AppPanel
          :eyebrow="t('logs.panel.files.eyebrow')"
          :title="t('logs.panel.files.title')"
          :description="t('logs.panel.files.description')"
        >
          <div class="logs-toolbar">
            <el-button plain @click="loadData">{{ t('common.refresh') }}</el-button>
            <el-button plain :loading="isExportingDiagnostics" @click="exportDiagnostics">
              {{ t('logs.actions.export') }}
            </el-button>
            <el-button plain :disabled="!logDirectory" @click="openLogsFolder">{{ t('logs.actions.openFolder') }}</el-button>
          </div>

          <div v-if="errorMessage" class="logs-empty logs-empty--danger">{{ errorMessage }}</div>
          <div v-else-if="isLoading && files.length === 0" class="logs-empty">{{ t('logs.empty.loadingFiles') }}</div>
          <div v-else-if="files.length === 0" class="logs-empty">{{ t('logs.empty.noFiles') }}</div>
          <div v-else class="log-file-list">
            <button
              v-for="file in files"
              :key="file.path"
              class="log-file"
              :class="{ 'is-active': file.path === selectedFilePath }"
              type="button"
              @click="readLog(file.path)"
            >
              <div class="log-file__name">{{ file.name }}</div>
              <div class="log-file__meta">
                {{ formatProjectTimestamp(file.updatedAt) }} · {{ formatBytes(file.size) }}
              </div>
            </button>
          </div>
        </AppPanel>
      </div>

      <div class="span-8">
        <AppPanel
          :eyebrow="t('logs.panel.viewer.eyebrow')"
          :title="t('logs.panel.viewer.title')"
          :description="t('logs.panel.viewer.description')"
        >
          <div v-if="selectedFile" class="log-viewer__header">
            <div>
              <div class="log-viewer__title">{{ selectedFile.name }}</div>
              <div class="log-viewer__meta">
                {{ formatProjectTimestamp(selectedFile.updatedAt) }} · {{ formatBytes(selectedFile.size) }}
              </div>
            </div>
            <StatusChip :tone="selectedFileLoading ? 'warning' : 'info'">
              {{ selectedFileLoading ? t('logs.status.reading') : t('logs.status.loaded') }}
            </StatusChip>
          </div>
          <div v-else class="logs-empty">{{ t('logs.empty.selectFile') }}</div>
          <pre v-if="selectedFile" class="log-viewer__content">{{ selectedContent }}</pre>
        </AppPanel>
      </div>
    </section>

    <AppPanel
      :eyebrow="t('logs.panel.failures.eyebrow')"
      :title="t('logs.panel.failures.title')"
      :description="t('logs.panel.failures.description')"
    >
      <div v-if="latestFailures.length === 0" class="logs-empty">{{ t('logs.empty.noFailures') }}</div>
      <div v-else class="failure-list">
        <article
          v-for="failure in latestFailures"
          :key="`${failure.projectId}-${failure.result.siteId}-${failure.result.timestamp}`"
          class="failure-item"
        >
          <div class="failure-item__header">
            <div>
              <div class="failure-item__title">{{ failure.projectName }}</div>
              <div class="failure-item__meta">
                {{ getSiteLabel(failure.result.siteId) }} ·
                {{ getProjectStageLabel(failure.stage) }} ·
                {{ formatProjectTimestamp(failure.result.timestamp) }}
              </div>
            </div>
            <StatusChip :tone="publishStateTones[failure.result.status]">
              {{ getPublishStateLabel(failure.result.status) }}
            </StatusChip>
          </div>

          <div class="failure-item__message">
            {{ failure.result.message || t('logs.messages.noFailureMessage') }}
          </div>

          <div v-if="failure.result.remoteId" class="failure-item__meta">
            {{ t('common.remoteId') }}: {{ failure.result.remoteId }}
          </div>

          <div class="failure-item__actions">
            <el-button link type="primary" @click="openProject(failure.projectId, failure.stage)">
              {{ t('logs.actions.openProject') }}
            </el-button>
            <el-button link type="primary" @click="copyFailureSnapshot(failure)">{{ t('common.copyJson') }}</el-button>
            <a
              v-if="failure.result.remoteUrl"
              :href="failure.result.remoteUrl"
              class="failure-item__link"
              target="_blank"
              rel="noreferrer"
            >
              {{ failure.result.remoteUrl }}
            </a>
          </div>

          <details v-if="failure.result.rawResponse !== undefined" class="failure-item__raw">
            <summary>{{ t('common.rawResponse') }}</summary>
            <pre>{{ formatRawResponse(failure.result.rawResponse) }}</pre>
          </details>
        </article>
      </div>
    </AppPanel>
  </div>
</template>

<style scoped>
.logs-toolbar,
.log-viewer__header,
.failure-item__header,
.failure-item__actions {
  display: flex;
}

.logs-toolbar,
.log-viewer__header,
.failure-item__header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.log-file-list,
.failure-list {
  display: grid;
  gap: 12px;
}

.logs-toolbar {
  margin-bottom: 14px;
}

.logs-empty {
  padding: 28px 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  text-align: center;
}

.logs-empty--danger {
  color: var(--danger);
}

.log-file {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
  text-align: left;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.log-file:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.log-file.is-active {
  border-color: rgba(198, 90, 46, 0.24);
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.42));
}

.log-file__name,
.log-viewer__title,
.failure-item__title {
  font-weight: 700;
}

.log-file__meta,
.log-viewer__meta,
.failure-item__meta,
.failure-item__message,
.failure-item__link,
.failure-item__raw {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.log-file__meta,
.log-viewer__meta {
  margin-top: 6px;
}

.log-viewer__content {
  margin: 16px 0 0;
  padding: 16px;
  min-height: 420px;
  max-height: 720px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(0, 0, 0, 0.06);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.failure-item {
  padding: 16px 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.failure-item__message {
  margin-top: 12px;
}

.failure-item__meta {
  margin-top: 10px;
}

.failure-item__actions {
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.failure-item__link {
  color: var(--accent);
  word-break: break-all;
}

.failure-item__raw {
  margin-top: 12px;
}

.failure-item__raw summary {
  cursor: pointer;
  color: var(--text-primary);
  font-weight: 700;
}

.failure-item__raw pre {
  margin: 10px 0 0;
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1180px) {
  .logs-toolbar,
  .log-viewer__header,
  .failure-item__header,
  .failure-item__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
