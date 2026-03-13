<script setup lang="ts" name="ProjectListTable">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { ProjectStage, PublishProject } from '../types/project'
import {
  formatProjectTimestamp,
  getProjectSourceLabel,
  getProjectStageLabel,
  getSiteLabel,
} from '../services/project/presentation'
import type { SiteId } from '../types/site'

const router = useRouter()
const { t } = useI18n()
const isLoading = ref(false)
const showPublished = ref(false)
const projects = ref<PublishProject[]>([])

const stageRouteMap: Record<ProjectStage, 'edit' | 'check' | 'bt_publish' | 'forum_publish' | 'finish'> = {
  edit: 'edit',
  review: 'check',
  torrent_publish: 'bt_publish',
  forum_publish: 'forum_publish',
  completed: 'finish',
}

const visibleProjects = computed(() => {
  if (showPublished.value) {
    return projects.value
  }

  return projects.value.filter(project => project.status !== 'published')
})

function getStatusLabel(project: PublishProject) {
  if (project.status === 'published') {
    return t('taskList.status.published')
  }

  return getProjectStageLabel(project.stage)
}

function getSiteEntries(project: PublishProject) {
  const entries = Object.entries({
    ...project.siteLinks,
    forum: project.forumLink,
  }) as Array<[SiteId, string | undefined]>

  return entries.filter(([, value]) => Boolean(value))
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
    name: stageRouteMap[project.stage],
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
  <div class="project-list">
    <div class="project-list__toolbar">
      <el-checkbox v-model="showPublished" :label="t('taskList.filter.showPublished')" />
      <el-button plain @click="loadData">{{ t('taskList.actions.refresh') }}</el-button>
    </div>

    <el-table v-loading="isLoading" :data="visibleProjects" row-key="id" class="project-list__table">
      <el-table-column fixed="right" :label="t('taskList.actions.continue')" width="100">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openProject(row)">
            {{ t('taskList.actions.open') }}
          </el-button>
        </template>
      </el-table-column>

      <el-table-column fixed="right" :label="t('taskList.columns.folder')" width="90">
        <template #default="{ row }">
          <el-button link size="small" @click="openFolder(row.workingDirectory)">
            {{ t('taskList.actions.open') }}
          </el-button>
        </template>
      </el-table-column>

      <el-table-column fixed="right" :label="t('taskList.actions.delete')" width="90">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="removeProject(row)">
            {{ t('taskList.actions.delete') }}
          </el-button>
        </template>
      </el-table-column>

      <el-table-column prop="id" label="ID" width="140" sortable />
      <el-table-column prop="name" :label="t('taskList.columns.project')" min-width="220" show-overflow-tooltip />
      <el-table-column :label="t('taskList.columns.source')" width="110">
        <template #default="{ row }">
          {{ getProjectSourceLabel(row.sourceKind) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('taskList.columns.stage')" width="180">
        <template #default="{ row }">
          {{ getProjectStageLabel(row.stage) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('taskList.columns.status')" width="160">
        <template #default="{ row }">
          {{ getStatusLabel(row) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('taskList.columns.updated')" width="180">
        <template #default="{ row }">
          {{ formatProjectTimestamp(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column type="expand" width="54">
        <template #default="{ row }">
          <div class="project-list__details">
            <div class="project-list__detail-row">
              <span class="project-list__detail-label">{{ t('taskList.details.workingDirectory') }}</span>
              <button class="project-list__copy" type="button" @click="copyText(row.workingDirectory)">
                {{ row.workingDirectory }}
              </button>
            </div>

            <div v-if="getSiteEntries(row).length" class="project-list__links">
              <div
                v-for="[siteId, link] in getSiteEntries(row)"
                :key="`${row.id}-${siteId}`"
                class="project-list__detail-row"
              >
                <span class="project-list__detail-label">{{ getSiteLabel(siteId) }}</span>
                <div class="project-list__link-actions">
                  <a :href="link" class="project-list__link" target="_blank" rel="noreferrer">
                    {{ link }}
                  </a>
                  <el-button link size="small" @click="copyText(link)">{{ t('taskList.actions.copy') }}</el-button>
                </div>
              </div>
            </div>

            <div v-else class="project-list__empty">{{ t('taskList.details.noLinks') }}</div>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.project-list {
  width: 100%;
}

.project-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.project-list__table {
  width: 100%;
}

.project-list__details {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 6px;
}

.project-list__detail-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.project-list__detail-label {
  flex: 0 0 132px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.project-list__links {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-list__link-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-list__link,
.project-list__copy {
  min-width: 0;
  color: var(--accent);
  background: none;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}

.project-list__empty {
  color: var(--text-secondary);
  font-size: 14px;
}

@media (max-width: 980px) {
  .project-list__toolbar,
  .project-list__detail-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .project-list__detail-label {
    flex-basis: auto;
  }
}
</style>
