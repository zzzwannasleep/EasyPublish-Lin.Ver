<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { Files, FolderOpened, Grid, Promotion, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import Edit from '../../components/Edit.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getProjectModeLabel,
  getProjectStageLabel,
  getProjectStatusLabel,
  getPublishedSiteIds,
  getSiteLabel,
  projectStatusTones,
} from '../../services/project/presentation'
import type { ProjectSourceKind, PublishProject } from '../../types/project'
import { useProjectContext } from '../project-detail/project-context'

type SourceOption = {
  value: ProjectSourceKind
  label: string
  description: string
  icon: Component
}

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const { t } = useI18n()
const { isLoading, refreshProject } = useProjectContext()

const draftConfig = ref<Config.PublishConfig | null>(null)
const selectedSourceKind = ref<ProjectSourceKind | null>(null)
const isConfigLoading = ref(false)
const isSavingSource = ref(false)
const configError = ref('')

const sourceOptions = computed<SourceOption[]>(() => [
  {
    value: 'quick',
    label: t('create.form.source.quick.label'),
    description: t('create.form.source.quick.description'),
    icon: Promotion,
  },
  {
    value: 'file',
    label: t('create.form.source.file.label'),
    description: t('create.form.source.file.description'),
    icon: Files,
  },
  {
    value: 'template',
    label: t('create.form.source.template.label'),
    description: t('create.form.source.template.description'),
    icon: Grid,
  },
])

const currentSourceLabel = computed(() => {
  const matched = sourceOptions.value.find(option => option.value === selectedSourceKind.value)
  return matched?.label ?? ''
})

const publishedSiteIds = computed(() => getPublishedSiteIds(props.project))
const missingTargetSiteIds = computed(() => getMissingTargetSiteIds(props.project))
const currentStageText = computed(() =>
  t('projectAside.currentStage', {
    stage: getProjectStageLabel(props.project.stage),
  }),
)

const statCards = computed(() => [
  {
    label: t('seriesWorkspace.stat.targetSites'),
    value: String(props.project.targetSites.length),
    hint: props.project.targetSites.length
      ? props.project.targetSites.map(siteId => getSiteLabel(siteId)).join(' / ')
      : t('seriesWorkspace.empty.targets'),
  },
  {
    label: t('seriesWorkspace.stat.publishedSites'),
    value: String(publishedSiteIds.value.length),
    hint: publishedSiteIds.value.length
      ? publishedSiteIds.value.map(siteId => getSiteLabel(siteId)).join(' / ')
      : t('seriesWorkspace.empty.published'),
  },
  {
    label: t('seriesWorkspace.stat.pendingSites'),
    value: String(missingTargetSiteIds.value.length),
    hint: missingTargetSiteIds.value.length
      ? missingTargetSiteIds.value.map(siteId => getSiteLabel(siteId)).join(' / ')
      : t('seriesWorkspace.empty.pending'),
  },
  {
    label: t('seriesWorkspace.stat.updatedAt'),
    value: formatProjectTimestamp(props.project.updatedAt),
    hint: t('seriesWorkspace.stat.updatedHint'),
  },
])

const notes = computed(() => [
  {
    title: t('stage.editor.note1.title'),
    text: t('stage.editor.note1.text'),
  },
  {
    title: t('stage.editor.note2.title'),
    text: t('stage.editor.note2.text'),
  },
  {
    title: t('stage.editor.note3.title'),
    text: t('stage.editor.note3.text'),
  },
])

function normalizeSourceKind(value: unknown): ProjectSourceKind | null {
  return value === 'quick' || value === 'file' || value === 'template' ? value : null
}

function isTemplateSourceKind(value: ProjectSourceKind | null | undefined) {
  return value === 'template'
}

function createDefaultFileContent(): Config.Content_file {
  return {
    path_md: '',
    path_html: '',
    path_bbcode: '',
  }
}

function createDefaultTemplateContent(): Config.Content_template {
  return {
    title_CN: '',
    title_EN: '',
    title_JP: '',
    depth: '10-bit',
    resolution: '1080p',
    encoding: 'HEVC',
    contentType: 'BDRip',
    reseed: false,
    nomination: false,
    note: [],
    comment_CN: '',
    comment_EN: '',
    rsVersion: 1,
    members: {
      script: '',
      encode: '',
      collate: '',
      upload: '',
    },
    posterUrl: '',
    prefill: false,
  }
}

function buildContentForSource(nextSourceKind: ProjectSourceKind, currentConfig: Config.PublishConfig | null) {
  const currentContent = currentConfig?.content

  if (nextSourceKind === 'template') {
    if (
      currentContent &&
      typeof currentContent === 'object' &&
      'members' in currentContent &&
      currentContent.members &&
      typeof currentContent.members === 'object'
    ) {
      return currentContent as Config.Content_template
    }

    return createDefaultTemplateContent()
  }

  if (
    currentContent &&
    typeof currentContent === 'object' &&
    'path_html' in currentContent &&
    'path_md' in currentContent &&
    'path_bbcode' in currentContent
  ) {
    return currentContent as Config.Content_file
  }

  return createDefaultFileContent()
}

async function loadDraftConfig() {
  isConfigLoading.value = true
  configError.value = ''
  try {
    const nextConfig = JSON.parse(
      await window.taskAPI.getPublishConfig(JSON.stringify({ id: props.id })),
    ) as Message.Task.PublishConfig
    draftConfig.value = nextConfig
    selectedSourceKind.value = normalizeSourceKind(nextConfig.sourceKind ?? props.project.sourceKind)
  } catch (error) {
    draftConfig.value = null
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

async function selectSourceKind(nextSourceKind: ProjectSourceKind) {
  if (isSavingSource.value) {
    return
  }

  const currentSourceKind = normalizeSourceKind(selectedSourceKind.value ?? draftConfig.value?.sourceKind)
  if (currentSourceKind === nextSourceKind) {
    return
  }

  const currentConfig =
    draftConfig.value ??
    (JSON.parse(await window.taskAPI.getPublishConfig(JSON.stringify({ id: props.id }))) as Message.Task.PublishConfig)

  if (isTemplateSourceKind(currentSourceKind) !== isTemplateSourceKind(nextSourceKind) && currentSourceKind) {
    const confirmed = await ElMessageBox.confirm(
      t('featureWorkspace.source.switchText'),
      t('featureWorkspace.source.switchTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.continue'),
        cancelButtonText: t('common.cancel'),
      },
    ).catch(() => false)

    if (!confirmed) {
      return
    }
  }

  isSavingSource.value = true
  try {
    const nextConfig: Config.PublishConfig = {
      ...currentConfig,
      sourceKind: nextSourceKind,
      content: buildContentForSource(nextSourceKind, currentConfig),
    }

    const result = JSON.parse(
      await window.taskAPI.saveConfig(JSON.stringify({ id: props.id, config: nextConfig })),
    ) as Message.Task.Result

    if (!result.result.includes('success')) {
      ElMessage.error(t('featureWorkspace.source.saveFailed'))
      return
    }

    draftConfig.value = nextConfig
    selectedSourceKind.value = nextSourceKind
    await refreshProject()
    ElMessage.success(t('featureWorkspace.source.saved', { source: currentSourceLabel.value }))
  } catch {
    ElMessage.error(t('featureWorkspace.source.saveFailed'))
  } finally {
    isSavingSource.value = false
  }
}

watch(
  () => props.project.updatedAt,
  () => {
    void loadDraftConfig()
  },
)

onMounted(() => {
  void loadDraftConfig()
})
</script>

<template>
  <div class="feature-studio" v-loading="isLoading || isConfigLoading || isSavingSource">
    <section class="feature-studio__section feature-studio__section--primary">
      <div class="feature-studio__headline">
        <div class="feature-studio__title-block">
          <div class="eyebrow-text">{{ t('stage.editor.eyebrow') }}</div>
          <h2 class="feature-studio__hero-title">{{ props.project.name }}</h2>
          <div class="feature-studio__hero-meta">
            <StatusChip tone="info">{{ getProjectModeLabel(props.project.projectMode) }}</StatusChip>
            <StatusChip v-if="currentSourceLabel" tone="neutral">
              {{ t('featureWorkspace.source.current', { source: currentSourceLabel }) }}
            </StatusChip>
            <StatusChip :tone="projectStatusTones[props.project.status]">
              {{ getProjectStatusLabel(props.project.status) }}
            </StatusChip>
          </div>
          <p class="feature-studio__hero-text">{{ t('workflow.step.edit.description') }}</p>
          <div class="feature-studio__hero-path">
            {{ t('seriesWorkspace.hero.projectPath', { path: props.project.workingDirectory }) }}
          </div>
          <div class="feature-studio__hero-stage">{{ currentStageText }}</div>
        </div>

        <div class="feature-studio__hero-actions">
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

      <div class="feature-studio__stats-grid">
        <article v-for="item in statCards" :key="item.label" class="feature-studio__stat-card">
          <div class="feature-studio__stat-label">{{ item.label }}</div>
          <div class="feature-studio__stat-value">{{ item.value }}</div>
          <div class="feature-studio__stat-hint">{{ item.hint }}</div>
        </article>
      </div>

      <div class="feature-studio__notes-grid">
        <article v-for="item in notes" :key="item.title" class="feature-studio__note-card">
          <div class="feature-studio__note-title">{{ item.title }}</div>
          <div class="feature-studio__note-text">{{ item.text }}</div>
        </article>
      </div>
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <div class="eyebrow-text">{{ t('create.form.source.label') }}</div>
          <h3 class="feature-studio__section-title">{{ t('featureWorkspace.source.title') }}</h3>
        </div>
        <StatusChip v-if="currentSourceLabel" tone="info">{{ currentSourceLabel }}</StatusChip>
      </div>

      <p class="feature-studio__section-text">{{ t('featureWorkspace.source.text') }}</p>

      <el-alert
        v-if="!currentSourceLabel"
        :title="t('featureWorkspace.source.pending')"
        type="info"
        :closable="false"
        show-icon
      />

      <div class="feature-studio__source-grid">
        <button
          v-for="option in sourceOptions"
          :key="option.value"
          type="button"
          class="feature-studio__source-card"
          :class="{ 'is-active': selectedSourceKind === option.value }"
          @click="selectSourceKind(option.value)"
        >
          <div class="feature-studio__source-head">
            <span class="feature-studio__source-icon">
              <el-icon><component :is="option.icon" /></el-icon>
            </span>
            <div class="feature-studio__source-copy">
              <div class="feature-studio__source-label">{{ option.label }}</div>
              <div class="feature-studio__source-text">{{ option.description }}</div>
            </div>
          </div>
        </button>
      </div>
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <div class="eyebrow-text">{{ t('stage.editor.panelEyebrow') }}</div>
          <h3 class="feature-studio__section-title">{{ t('featureWorkspace.currentDraft.title') }}</h3>
        </div>
        <StatusChip v-if="currentSourceLabel" tone="neutral">
          {{ t('featureWorkspace.currentDraft.active', { source: currentSourceLabel }) }}
        </StatusChip>
      </div>

      <p class="feature-studio__section-text">{{ t('featureWorkspace.currentDraft.text') }}</p>

      <el-alert v-if="configError" :title="configError" type="error" :closable="false" show-icon />

      <div v-if="selectedSourceKind" class="feature-studio__draft-shell">
        <Edit :key="selectedSourceKind" :id="id" :project="project" :source-kind="selectedSourceKind" embedded />
      </div>
      <div v-else class="feature-studio__empty-state">
        {{ t('featureWorkspace.currentDraft.empty') }}
      </div>
    </section>
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
  padding: clamp(20px, 2.6vw, 28px);
  border: 1px solid var(--border-soft);
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(245, 248, 255, 0.82)),
    var(--surface-raised);
  box-shadow: var(--shadow-sm);
}

.feature-studio__section--primary {
  background:
    linear-gradient(135deg, rgba(235, 243, 232, 0.96), rgba(255, 247, 236, 0.84) 48%, rgba(255, 255, 255, 0.94)),
    var(--surface-raised);
}

.feature-studio__headline {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.feature-studio__title-block {
  display: grid;
  gap: 10px;
}

.feature-studio__hero-title,
.feature-studio__section-title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  line-height: 1;
  letter-spacing: -0.04em;
}

.feature-studio__hero-title {
  font-size: clamp(1.9rem, 3vw, 2.6rem);
}

.feature-studio__section-title {
  font-size: clamp(1.2rem, 1.6vw, 1.45rem);
}

.feature-studio__hero-meta,
.feature-studio__hero-actions,
.feature-studio__section-head,
.feature-studio__source-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.feature-studio__hero-actions,
.feature-studio__section-head {
  justify-content: space-between;
}

.feature-studio__hero-text,
.feature-studio__hero-path,
.feature-studio__hero-stage,
.feature-studio__section-text,
.feature-studio__stat-hint,
.feature-studio__note-text,
.feature-studio__source-text,
.feature-studio__empty-state {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.75;
}

.feature-studio__hero-path {
  word-break: break-all;
}

.feature-studio__stats-grid,
.feature-studio__notes-grid,
.feature-studio__source-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.feature-studio__stat-card,
.feature-studio__note-card,
.feature-studio__source-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.feature-studio__source-card {
  cursor: pointer;
  text-align: left;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.feature-studio__source-card:hover,
.feature-studio__source-card.is-active {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
  box-shadow: var(--shadow-sm);
}

.feature-studio__source-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--brand-soft) 74%, white 26%);
  color: var(--brand);
  font-size: 18px;
  flex: none;
}

.feature-studio__source-copy {
  display: grid;
  gap: 4px;
}

.feature-studio__stat-label,
.feature-studio__note-title,
.feature-studio__source-label {
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 700;
}

.feature-studio__stat-value {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: clamp(1.2rem, 1.8vw, 1.45rem);
  line-height: 1.1;
  letter-spacing: -0.03em;
}

.feature-studio__draft-shell {
  min-width: 0;
}

.feature-studio__empty-state {
  padding: 18px;
  border: 1px dashed var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--surface-soft-fill) 88%, white 12%);
}

@media (max-width: 960px) {
  .feature-studio__headline {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .feature-studio__section {
    padding: 18px;
    border-radius: 1.35rem;
  }

  .feature-studio__hero-actions,
  .feature-studio__section-head {
    flex-direction: column;
    align-items: stretch;
  }

  .feature-studio__hero-actions :deep(.el-button) {
    width: 100%;
  }
}
</style>
