<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FolderOpened, RefreshRight } from '@element-plus/icons-vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import FeatureSiteWorkspacePreview from './FeatureSiteWorkspacePreview.vue'
import FeatureTitleMatchPreview from './FeatureTitleMatchPreview.vue'
import FeatureVersionLayoutPreview from './FeatureVersionLayoutPreview.vue'
import { useI18n } from '../../i18n'
import {
  getProjectModeLabel,
  getProjectStatusLabel,
  projectStatusTones,
} from '../../services/project/presentation'
import type { ProjectSourceKind, PublishProject } from '../../types/project'
import { useProjectContext } from '../project-detail/project-context'

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const { t } = useI18n()
const { isLoading, refreshProject } = useProjectContext()

const draftConfig = ref<Config.PublishConfig | null>(null)
const previewTorrentPath = ref('')
const isConfigLoading = ref(false)
const configError = ref('')

function normalizeSourceKind(value: unknown): ProjectSourceKind | null {
  return value === 'quick' || value === 'file' || value === 'template' ? value : null
}

function resolvePreviewTorrentPath(config: Message.Task.PublishConfig | Config.PublishConfig | null) {
  if (!config) {
    return ''
  }

  if (typeof config.torrentPath === 'string' && config.torrentPath.trim()) {
    return config.torrentPath.trim()
  }

  const activeEntry = config.torrentEntries?.find(item => item.enabled !== false && item.path?.trim())
  return activeEntry?.path?.trim() || ''
}

const sourceLabels = computed<Record<ProjectSourceKind, string>>(() => ({
  quick: t('create.form.source.quick.label'),
  file: t('create.form.source.file.label'),
  template: t('create.form.source.template.label'),
}))

const sourceKind = computed(() => normalizeSourceKind(draftConfig.value?.sourceKind ?? props.project.sourceKind))
const currentSourceLabel = computed(() => (sourceKind.value ? sourceLabels.value[sourceKind.value] : ''))

async function loadDraftConfig() {
  isConfigLoading.value = true
  configError.value = ''
  try {
    const nextConfig = JSON.parse(
      await window.taskAPI.getPublishConfig(JSON.stringify({ id: props.id })),
    ) as Message.Task.PublishConfig
    draftConfig.value = nextConfig
    previewTorrentPath.value = resolvePreviewTorrentPath(nextConfig)
  } catch (error) {
    draftConfig.value = null
    previewTorrentPath.value = ''
    configError.value = (error as Error).message || t('featureWorkspace.source.loadingFailed')
  } finally {
    isConfigLoading.value = false
  }
}

function openWorkingDirectory() {
  const message: Message.Global.Path = { path: props.project.workingDirectory }
  window.globalAPI.openFolder(JSON.stringify(message))
}

async function refreshWorkspace() {
  await refreshProject()
  await loadDraftConfig()
}

function handlePreviewPathSelect(path: string) {
  previewTorrentPath.value = path || previewTorrentPath.value
}

watch(
  () => props.project.updatedAt,
  () => {
    void loadDraftConfig()
  },
)

onMounted(() => {
  window.taskAPI.setTaskProcess(JSON.stringify({ id: props.id, step: 'edit' }))
  void loadDraftConfig()
})
</script>

<template>
  <div class="feature-studio" v-loading="isLoading || isConfigLoading">
    <section class="feature-studio__section">
      <div class="feature-studio__toolbar">
        <div class="feature-studio__toolbar-meta">
          <StatusChip tone="info">{{ getProjectModeLabel(props.project.projectMode) }}</StatusChip>
          <StatusChip v-if="currentSourceLabel" tone="success">{{ currentSourceLabel }}</StatusChip>
          <StatusChip :tone="projectStatusTones[props.project.status]">
            {{ getProjectStatusLabel(props.project.status) }}
          </StatusChip>
        </div>

        <div class="feature-studio__toolbar-actions">
          <el-button plain @click="openWorkingDirectory">
            <el-icon><FolderOpened /></el-icon>
            <span>{{ t('common.openFolder') }}</span>
          </el-button>
          <el-button plain :loading="isLoading || isConfigLoading" @click="refreshWorkspace">
            <el-icon><RefreshRight /></el-icon>
            <span>{{ t('common.refresh') }}</span>
          </el-button>
        </div>
      </div>

      <FeatureTitleMatchPreview :project-name="props.project.name" :torrent-path="previewTorrentPath" />

      <el-alert v-if="configError" :title="configError" type="error" :closable="false" show-icon />
    </section>

    <FeatureVersionLayoutPreview
      :project-name="props.project.name"
      :source-label="currentSourceLabel"
      :torrent-entries="draftConfig?.torrentEntries"
      @select-path="handlePreviewPathSelect"
    />

    <FeatureSiteWorkspacePreview
      :initial-target-site-ids="draftConfig?.targetSites ?? props.project.targetSites"
      :initial-site-field-defaults="draftConfig?.siteFieldDefaults"
      :initial-body-markdown="draftConfig?.bodyTemplate ?? ''"
    />
  </div>
</template>

<style scoped>
.feature-studio {
  display: grid;
  gap: 18px;
}

.feature-studio__section {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--border-soft);
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.feature-studio__toolbar,
.feature-studio__toolbar-meta,
.feature-studio__toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.feature-studio__toolbar {
  justify-content: space-between;
}

@media (max-width: 720px) {
  .feature-studio__section {
    padding: 18px;
  }

  .feature-studio__toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .feature-studio__toolbar-actions :deep(.el-button) {
    width: 100%;
  }
}
</style>
