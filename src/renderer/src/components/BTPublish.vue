<script setup lang="ts" name="BTPublish">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { TableInstance } from 'element-plus'
import StatusChip from './feedback/StatusChip.vue'
import { projectBridge } from '../services/bridge/project'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getSiteLabel,
  sortPublishResults,
} from '../services/project/presentation'
import type { PublishResult } from '../types/publish'
import type { PublishProject } from '../types/project'
import type { SiteId } from '../types/site'

type LegacySiteType =
  | 'bangumi_all'
  | 'bangumi'
  | 'mikan'
  | 'miobt'
  | 'nyaa'
  | 'acgrip'
  | 'dmhy'
  | 'acgnx_g'
  | 'acgnx_a'

interface LegacyPublishRow {
  name: string
  type: LegacySiteType
  siteId: SiteId
  description: string
  index: number
  status: string
  lock: boolean
  rowClass: string
  attemptCount: number
  latestLink?: string
  latestTimestamp?: string
  latestMessage?: string
  resolved: boolean
}

const props = withDefaults(defineProps<{ id: number; siteTypes?: LegacySiteType[] }>(), {
  siteTypes: () => [],
})

const router = useRouter()
const publishtable = ref<TableInstance>()
const project = ref<PublishProject | null>(null)
const isLoading = ref(false)
const loadError = ref('')
const selectedRowTypes = ref<LegacySiteType[]>([])

const loggedInStatuses = ['账号已登录', '璐﹀彿宸茬櫥褰?']
const loggedOutStatuses = ['账号未登录', '璐﹀彿鏈櫥褰?']
const mikanConfiguredStatuses = ['API token configured', '已配置 API Token', '宸查厤缃?API Token']
const miobtConfiguredStatuses = ['API credentials configured', '已配置 API 凭据', '宸查厤缃?API 鍑嵁']

const baseRows: Array<Omit<LegacyPublishRow, 'index' | 'status' | 'lock' | 'rowClass' | 'attemptCount' | 'resolved'>> = [
  {
    name: '萌番组（团队同步）',
    type: 'bangumi_all',
    siteId: 'bangumi',
    description: '沿用旧团队同步发布链路，结果改为从项目模型读取。',
  },
  {
    name: '萌番组',
    type: 'bangumi',
    siteId: 'bangumi',
    description: '旧 Bangumi 发布接口，实时回写项目结果。',
  },
  {
    name: 'Mikan',
    type: 'mikan',
    siteId: 'mikan',
    description: '通过 API Token 发布。',
  },
  {
    name: 'MioBT',
    type: 'miobt',
    siteId: 'miobt',
    description: '通过 UID + API Key 发布。',
  },
  {
    name: 'Nyaa',
    type: 'nyaa',
    siteId: 'nyaa',
    description: '旧 Nyaa 上传链路，结果和失败记录统一进项目历史。',
  },
  {
    name: 'Acgrip',
    type: 'acgrip',
    siteId: 'acgrip',
    description: '兼容旧站点发布实现。',
  },
  {
    name: '动漫花园',
    type: 'dmhy',
    siteId: 'dmhy',
    description: '兼容旧站点发布实现。',
  },
  {
    name: 'AcgnX',
    type: 'acgnx_g',
    siteId: 'acgnx_g',
    description: '兼容旧站点发布实现。',
  },
  {
    name: '末日动漫',
    type: 'acgnx_a',
    siteId: 'acgnx_a',
    description: '兼容旧站点发布实现。',
  },
]

const enabledSiteTypes =
  props.siteTypes.length > 0 ? props.siteTypes : baseRows.map(item => item.type)

const tabledata = reactive<LegacyPublishRow[]>(
  baseRows
    .filter(item => enabledSiteTypes.includes(item.type))
    .map((item, index) => ({
      ...item,
      index,
      status: '未发布',
      lock: false,
      rowClass: '',
      attemptCount: 0,
      latestLink: undefined,
      latestTimestamp: undefined,
      latestMessage: undefined,
      resolved: false,
    })),
)

const resolvedCount = computed(() => tabledata.filter(row => row.resolved).length)
const failedCount = computed(() => tabledata.filter(row => !row.lock && row.rowClass === 'danger-row').length)
const activeCount = computed(() => tabledata.filter(row => row.lock).length)
const hasActivePublish = computed(() => activeCount.value > 0)
const targetSiteCount = computed(() => project.value?.targetSites.length ?? 0)
const shouldSkipForumStage = computed(() => {
  if (!project.value) {
    return false
  }

  return project.value.projectMode === 'episode' || project.value.sourceKind === 'quick'
})
const missingTargetSites = computed(() => {
  if (!project.value) {
    return []
  }

  const availableSites = new Set(tabledata.map(row => row.siteId))
  return getMissingTargetSiteIds(project.value).filter(siteId => availableSites.has(siteId))
})
const missingTargetLabels = computed(() => missingTargetSites.value.map(siteId => getSiteLabel(siteId)).join(', '))

function back() {
  const targetProject = project.value
  router.push({
    name: targetProject && shouldSkipForumStage.value ? 'edit' : 'check',
    params: { id: props.id },
  })
}

async function next() {
  if (missingTargetSites.value.length > 0) {
    try {
      await ElMessageBox.confirm(`还有这些目标站点未完成发布：${missingTargetLabels.value}`, '未完成目标站点', {
        confirmButtonText: '仍然完成',
        cancelButtonText: '返回继续发布',
        type: 'warning',
      })
    } catch {
      return
    }
  }

  const targetProject = project.value
  router.push({
    name: targetProject && shouldSkipForumStage.value ? 'finish' : 'forum_publish',
    params: { id: props.id },
  })
}

function handleSelectionChange(rows: LegacyPublishRow[]) {
  selectedRowTypes.value = rows.map(row => row.type)
}

function selectable(row: LegacyPublishRow) {
  return !row.resolved && !row.lock
}

function tableRowClassName({ row }: { row: LegacyPublishRow }) {
  return row.rowClass
}

function getRowByType(type: LegacySiteType) {
  return tabledata.find(row => row.type === type)
}

function getResultsForRow(row: LegacyPublishRow) {
  return sortPublishResults(
    (project.value?.publishResults ?? []).filter(result => result.siteId === row.siteId),
  )
}

function isLoggedInStatus(status: string) {
  return loggedInStatuses.includes(status)
}

function isLoggedOutStatus(status: string) {
  return loggedOutStatuses.includes(status)
}

function isMikanConfiguredStatus(status: string) {
  return mikanConfiguredStatuses.includes(status)
}

function isMioBtConfiguredStatus(status: string) {
  return miobtConfiguredStatuses.includes(status)
}

function summarizePersistedResult(row: LegacyPublishRow, result: PublishResult) {
  const message = (result.message ?? '').toLowerCase()
  const indicatesExisting = message.includes('existing torrent') || message.includes('already exists')
  const indicatesUnauthorized = message.includes('unauthorized')

  if (result.status === 'published') {
    if (row.type === 'bangumi_all') {
      return {
        status: '团队同步已完成',
        rowClass: 'success-row',
        resolved: true,
      }
    }

    if (indicatesExisting) {
      return {
        status: result.remoteUrl ? '种子已存在，已记录链接' : '种子已存在',
        rowClass: result.remoteUrl ? 'success-row' : 'warning-row',
        resolved: Boolean(result.remoteUrl),
      }
    }

    return {
      status: '发布完成',
      rowClass: 'success-row',
      resolved: true,
    }
  }

  if (result.status === 'failed') {
    if (indicatesUnauthorized) {
      return {
        status: 'API账户无效',
        rowClass: 'danger-row',
        resolved: false,
      }
    }

    if (indicatesExisting) {
      return {
        status: '种子已存在，但未捕获链接',
        rowClass: 'warning-row',
        resolved: false,
      }
    }

    return {
      status: '发布失败',
      rowClass: 'danger-row',
      resolved: false,
    }
  }

  if (result.status === 'pending') {
    return {
      status: '发布处理中',
      rowClass: 'warning-row',
      resolved: false,
    }
  }

  return {
    status: '未发布',
    rowClass: '',
    resolved: false,
  }
}

function applyProjectResults() {
  tabledata.forEach(row => {
    const results = getResultsForRow(row)
    const latest = results[0]

    row.attemptCount = results.length
    row.latestLink = latest?.remoteUrl
    row.latestTimestamp = latest?.timestamp
    row.latestMessage = latest?.message

    if (row.lock) {
      return
    }

    if (!latest) {
      row.status = '未发布'
      row.rowClass = ''
      row.resolved = false
      return
    }

    const summary = summarizePersistedResult(row, latest)
    row.status = summary.status
    row.rowClass = summary.rowClass
    row.resolved = summary.resolved
  })
}

function copyText(value?: string) {
  if (!value) {
    return
  }

  const msg: Message.Global.Clipboard = { str: value }
  window.globalAPI.writeClipboard(JSON.stringify(msg))
  ElMessage.success('已复制到剪贴板')
}

async function loadData() {
  isLoading.value = true
  loadError.value = ''

  try {
    const projectResult = await projectBridge.getProject(props.id)
    if (!projectResult.ok) {
      project.value = null
      loadError.value = projectResult.error.message
      tabledata.forEach(row => {
        if (!row.lock) {
          row.status = '未发布'
          row.rowClass = ''
          row.resolved = false
        }
        row.attemptCount = 0
        row.latestLink = undefined
        row.latestTimestamp = undefined
        row.latestMessage = undefined
      })
      return
    }

    project.value = projectResult.data.project
    applyProjectResults()
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

function applyUnauthorizedStatus(row: LegacyPublishRow) {
  row.rowClass = 'danger-row'
  row.resolved = false

  if (row.type === 'mikan') {
    row.status = 'API Token 无效'
    return
  }

  if (row.type === 'miobt') {
    row.status = 'API 凭据无效'
    return
  }

  row.status = 'API账户无效'
}

async function publish(index: number) {
  const row = tabledata[index]
  row.lock = true
  row.rowClass = 'warning-row'
  row.status = '正在检查账户状态'

  const loginMessage: Message.BT.AccountType = {
    type: row.type === 'bangumi_all' ? 'bangumi' : row.type,
  }
  const { status }: Message.BT.LoginStatus = JSON.parse(
    await window.BTAPI.checkLoginStatus(JSON.stringify(loginMessage)),
  )

  if (row.type === 'mikan') {
    if (!isMikanConfiguredStatus(status)) {
      row.lock = false
      row.status = status
      row.rowClass = 'warning-row'
      return
    }
    row.status = 'API Token 已就绪，正在发布'
  } else if (row.type === 'miobt') {
    if (!isMioBtConfiguredStatus(status)) {
      row.lock = false
      row.status = status
      row.rowClass = 'warning-row'
      return
    }
    row.status = 'API 凭据已就绪，正在发布'
  } else if (!isLoggedInStatus(status)) {
    if ((row.type === 'acgnx_a' || row.type === 'acgnx_g') && isLoggedOutStatus(status)) {
      row.status = '账号未登录，尝试使用 API 发布'
    } else {
      row.lock = false
      row.status = status
      row.rowClass = 'warning-row'
      return
    }
  } else {
    row.status = '检查完成，正在发布'
  }

  const message: Message.Task.ContentType = { id: props.id, type: row.type }
  for (let i = 1; i <= 5; i++) {
    const { result }: Message.Task.Result = JSON.parse(await window.BTAPI.publish(JSON.stringify(message)))

    if (result === 'success' || result === 'exist' || result === 'unauthorized') {
      row.lock = false
      await loadData()
      if (result === 'unauthorized') {
        applyUnauthorizedStatus(row)
      }
      return
    }

    row.status = `发布失败，正在重试（${i}/5）`
    row.rowClass = 'warning-row'
  }

  row.lock = false
  row.status = '发布失败'
  row.rowClass = 'danger-row'
  await loadData()
}

async function multipublish() {
  for (const type of selectedRowTypes.value) {
    const row = getRowByType(type)
    if (row) {
      await publish(row.index)
    }
  }
}

async function publishPendingTargets() {
  const pendingRows = tabledata.filter(
    row => missingTargetSites.value.includes(row.siteId) && !row.lock && !row.resolved,
  )

  for (const row of pendingRows) {
    await publish(row.index)
  }
}

onMounted(async () => {
  const message: Message.Task.TaskStatus = { id: props.id, step: 'bt_publish' }
  window.taskAPI.setTaskProcess(JSON.stringify(message))
  window.projectAPI.refreshProjectData(() => {
    void loadData()
  })
  await loadData()
})
</script>

<template>
  <div class="legacy-bt">
    <header class="legacy-bt__header">
      <div class="legacy-bt__copy">
        <div class="legacy-bt__eyebrow">兼容 BT 发布</div>
        <h3 class="legacy-bt__title">旧发布面板已改为读取项目结果模型。</h3>
        <p class="legacy-bt__description">
          发布动作仍走原有 `BTAPI.publish`，但每次尝试的结果、远程链接和失败记录现在都从项目历史里回读。
        </p>
      </div>
      <div class="legacy-bt__chips">
        <StatusChip v-if="targetSiteCount" tone="info">目标站点 {{ targetSiteCount }}</StatusChip>
        <StatusChip v-if="missingTargetSites.length" tone="warning">待发布 {{ missingTargetSites.length }}</StatusChip>
        <StatusChip tone="success">已解决 {{ resolvedCount }} / {{ tabledata.length }}</StatusChip>
        <StatusChip v-if="failedCount" tone="danger">失败 {{ failedCount }}</StatusChip>
        <StatusChip v-if="activeCount" tone="warning">进行中 {{ activeCount }}</StatusChip>
      </div>
    </header>

    <div class="legacy-bt__toolbar">
      <div class="legacy-bt__toolbar-actions">
        <el-button plain @click="publishPendingTargets" :disabled="missingTargetSites.length === 0">发布剩余目标站点</el-button>
        <el-button plain @click="loadData">刷新项目结果</el-button>
        <el-button plain @click="multipublish" :disabled="selectedRowTypes.length === 0">发布选中站点</el-button>
      </div>
      <div class="legacy-bt__toolbar-text">
        <template v-if="loadError">
          {{ loadError }}
        </template>
        <template v-else-if="project">
          <div v-if="missingTargetSites.length">仍有待发布站点：{{ missingTargetLabels }}</div>
          最近同步：{{ formatProjectTimestamp(project.updatedAt) }}
        </template>
        <template v-else>
          正在加载项目上下文
        </template>
      </div>
    </div>

    <el-table
      ref="publishtable"
      v-loading="isLoading"
      :data="tabledata"
      row-key="type"
      class="legacy-bt__table"
      :row-class-name="tableRowClassName"
      @selection-change="handleSelectionChange"
    >
      <el-table-column fixed="left" label="发布" width="80">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            size="small"
            :disabled="row.resolved || (hasActivePublish && !row.lock)"
            :loading="row.lock"
            @click="publish(row.index)"
          >
            发布
          </el-button>
        </template>
      </el-table-column>

      <el-table-column type="selection" :selectable="selectable" width="55" />

      <el-table-column label="站点" min-width="170">
        <template #default="{ row }">
          <div class="legacy-bt__site">
            <div class="legacy-bt__site-name">{{ row.name }}</div>
            <div class="legacy-bt__site-description">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="状态 / 说明" min-width="260">
        <template #default="{ row }">
          <div class="legacy-bt__status">{{ row.status }}</div>
          <div v-if="row.latestMessage" class="legacy-bt__status-note">{{ row.latestMessage }}</div>
        </template>
      </el-table-column>

      <el-table-column label="尝试次数" width="110" align="center">
        <template #default="{ row }">
          {{ row.attemptCount }}
        </template>
      </el-table-column>

      <el-table-column label="最近记录" width="180">
        <template #default="{ row }">
          {{ row.latestTimestamp ? formatProjectTimestamp(row.latestTimestamp) : '—' }}
        </template>
      </el-table-column>

      <el-table-column label="链接" min-width="280">
        <template #default="{ row }">
          <div v-if="row.latestLink" class="legacy-bt__link">
            <a :href="row.latestLink" target="_blank" rel="noreferrer">{{ row.latestLink }}</a>
            <el-button link size="small" @click="copyText(row.latestLink)">复制</el-button>
          </div>
          <span v-else class="legacy-bt__link-empty">未记录</span>
        </template>
      </el-table-column>
    </el-table>

    <footer class="legacy-bt__footer">
      <el-button class="legacy-bt__footer-button" type="primary" plain @click="back">上一步</el-button>
      <el-button class="legacy-bt__footer-button" type="primary" @click="next">下一步</el-button>
    </footer>
  </div>
</template>

<style scoped>
.legacy-bt {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.legacy-bt__header,
.legacy-bt__toolbar,
.legacy-bt__toolbar-actions,
.legacy-bt__chips,
.legacy-bt__footer,
.legacy-bt__link {
  display: flex;
}

.legacy-bt__header,
.legacy-bt__toolbar,
.legacy-bt__footer {
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.legacy-bt__toolbar-actions,
.legacy-bt__chips,
.legacy-bt__link {
  align-items: center;
  gap: 10px;
}

.legacy-bt__copy {
  max-width: 720px;
}

.legacy-bt__eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.legacy-bt__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
}

.legacy-bt__description,
.legacy-bt__toolbar-text,
.legacy-bt__site-description,
.legacy-bt__status-note,
.legacy-bt__link-empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.legacy-bt__description {
  margin: 12px 0 0;
}

.legacy-bt__toolbar {
  padding: 16px 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.34);
}

.legacy-bt__toolbar-text {
  min-height: 32px;
  text-align: right;
}

.legacy-bt__table {
  width: 100%;
}

.legacy-bt__site,
.legacy-bt__status {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legacy-bt__site-name {
  font-weight: 700;
}

.legacy-bt__status {
  color: var(--text-primary);
  font-weight: 600;
}

.legacy-bt__link {
  flex-wrap: wrap;
}

.legacy-bt__link a {
  color: var(--accent);
  word-break: break-all;
}

.legacy-bt__footer {
  justify-content: center;
}

.legacy-bt__footer-button {
  width: 180px;
}

:deep(.el-table .warning-row) {
  --el-table-tr-bg-color: var(--warning-soft);
}

:deep(.el-table .success-row) {
  --el-table-tr-bg-color: var(--success-soft);
}

:deep(.el-table .danger-row) {
  --el-table-tr-bg-color: var(--danger-soft);
}

@media (max-width: 1180px) {
  .legacy-bt__header,
  .legacy-bt__toolbar,
  .legacy-bt__toolbar-actions,
  .legacy-bt__chips,
  .legacy-bt__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .legacy-bt__toolbar-text {
    text-align: left;
  }
}
</style>
