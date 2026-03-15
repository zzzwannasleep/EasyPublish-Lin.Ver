<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EpisodeEdit from '../../components/EpisodeEdit.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getPublishedSiteIds,
  getSiteLabel,
} from '../../services/project/presentation'
import type {
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  PublishProject,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesProjectWorkspace,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
} from '../../types/project'

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const workspace = ref<SeriesProjectWorkspace | null>(null)
const selectedEpisodeId = ref<number | null>(null)
const isWorkspaceLoading = ref(false)
const isCreatingEpisode = ref(false)
const isCreatingVariant = ref(false)
const isInheritingVariants = ref(false)
const activatingVariantId = ref<number | null>(null)
const syncingVariantId = ref<number | null>(null)
const workspaceError = ref('')

const episodeForm = reactive({
  episodeLabel: '',
  episodeTitle: '',
})

const variantForm = reactive<{
  videoProfile: SeriesVariantVideoProfile
  subtitleProfile: SeriesVariantSubtitleProfile
  nameOverride: string
}>({
  videoProfile: '1080p',
  subtitleProfile: 'chs',
  nameOverride: '',
})

const editorVisible = computed(() => {
  const value = route.query.editor
  if (Array.isArray(value)) {
    return value.includes('1')
  }

  return value === '1'
})

const editorKey = computed(() => {
  const activeEpisodeId = workspace.value?.activeEpisodeId ?? 'draft'
  const activeVariantId = workspace.value?.activeVariantId ?? 'root'
  return `${props.id}:${activeEpisodeId}:${activeVariantId}`
})

const episodes = computed(() => workspace.value?.episodes ?? [])

const selectedEpisode = computed(() => {
  if (selectedEpisodeId.value === null) {
    return null
  }

  return episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null
})

const previousEpisode = computed(() => {
  const currentEpisode = selectedEpisode.value
  if (!currentEpisode) {
    return null
  }

  const sortedEpisodes = [...episodes.value].sort((left, right) => left.sortIndex - right.sortIndex)
  const index = sortedEpisodes.findIndex(episode => episode.id === currentEpisode.id)
  if (index <= 0) {
    return null
  }

  return sortedEpisodes[index - 1] ?? null
})

const activeEpisode = computed(() => {
  const activeEpisodeId = workspace.value?.activeEpisodeId
  if (!activeEpisodeId) {
    return null
  }

  return episodes.value.find(episode => episode.id === activeEpisodeId) ?? null
})

const activeVariant = computed(() => {
  const episode = activeEpisode.value
  const activeVariantId = workspace.value?.activeVariantId
  if (!episode || !activeVariantId) {
    return null
  }

  return episode.variants.find(variant => variant.id === activeVariantId) ?? null
})

const videoProfileOptions = computed(() => [
  { value: '1080p' as const, label: t('seriesWorkspace.variants.profile.video.1080p') },
  { value: '2160p' as const, label: t('seriesWorkspace.variants.profile.video.2160p') },
  { value: 'custom' as const, label: t('seriesWorkspace.variants.profile.video.custom') },
])

const subtitleProfileOptions = computed(() => [
  { value: 'chs' as const, label: t('seriesWorkspace.variants.profile.subtitle.chs') },
  { value: 'cht' as const, label: t('seriesWorkspace.variants.profile.subtitle.cht') },
  { value: 'eng' as const, label: t('seriesWorkspace.variants.profile.subtitle.eng') },
  { value: 'bilingual' as const, label: t('seriesWorkspace.variants.profile.subtitle.bilingual') },
  { value: 'custom' as const, label: t('seriesWorkspace.variants.profile.subtitle.custom') },
])

const publishedSitesLabel = computed(() => {
  const sites = getPublishedSiteIds(props.project)
  if (!sites.length) {
    return t('seriesWorkspace.empty.published')
  }

  return sites.map(siteId => getSiteLabel(siteId)).join(', ')
})

const missingSitesLabel = computed(() => {
  const sites = getMissingTargetSiteIds(props.project)
  if (!sites.length) {
    return t('seriesWorkspace.empty.pending')
  }

  return sites.map(siteId => getSiteLabel(siteId)).join(', ')
})

const requiresVariantNameOverride = computed(
  () => variantForm.videoProfile === 'custom' || variantForm.subtitleProfile === 'custom',
)

const presetVariantName = computed(() => {
  if (requiresVariantNameOverride.value) {
    return ''
  }

  return `${getVideoProfileLabel(variantForm.videoProfile)}-${getSubtitleProfileLabel(variantForm.subtitleProfile)}`
})

const variantName = computed(() => variantForm.nameOverride.trim() || presetVariantName.value)

const currentDraftText = computed(() => {
  if (!activeEpisode.value || !activeVariant.value) {
    return t('seriesWorkspace.currentDraft.text')
  }

  return t('seriesWorkspace.currentDraft.active', {
    episode: activeEpisode.value.episodeLabel,
    variant: activeVariant.value.name,
  })
})

const overviewItems = computed(() => [
  {
    label: t('seriesWorkspace.stat.episodes'),
    value: episodes.value.length,
    text:
      episodes.value.length > 0
        ? episodes.value.map(episode => episode.episodeLabel).join(', ')
        : t('seriesWorkspace.empty.episodes'),
  },
  {
    label: t('seriesWorkspace.stat.targetSites'),
    value: props.project.targetSites.length,
    text:
      props.project.targetSites.length > 0
        ? props.project.targetSites.map(siteId => getSiteLabel(siteId)).join(', ')
        : t('seriesWorkspace.empty.targets'),
  },
  {
    label: t('seriesWorkspace.stat.publishedSites'),
    value: getPublishedSiteIds(props.project).length,
    text: publishedSitesLabel.value,
  },
  {
    label: t('seriesWorkspace.stat.pendingSites'),
    value: getMissingTargetSiteIds(props.project).length,
    text: missingSitesLabel.value,
  },
  {
    label: t('seriesWorkspace.stat.updatedAt'),
    value: formatProjectTimestamp(workspace.value?.updatedAt ?? props.project.updatedAt),
    text: t('seriesWorkspace.stat.updatedHint'),
  },
])

function getVideoProfileLabel(profile?: SeriesVariantVideoProfile) {
  if (!profile) {
    return ''
  }

  return t(`seriesWorkspace.variants.profile.video.${profile}`)
}

function getSubtitleProfileLabel(profile?: SeriesVariantSubtitleProfile) {
  if (!profile) {
    return ''
  }

  return t(`seriesWorkspace.variants.profile.subtitle.${profile}`)
}

function syncSelectedEpisode(preferredEpisodeId?: number) {
  const nextEpisodes = workspace.value?.episodes ?? []
  if (!nextEpisodes.length) {
    selectedEpisodeId.value = null
    return
  }

  if (preferredEpisodeId && nextEpisodes.some(episode => episode.id === preferredEpisodeId)) {
    selectedEpisodeId.value = preferredEpisodeId
    return
  }

  if (selectedEpisodeId.value && nextEpisodes.some(episode => episode.id === selectedEpisodeId.value)) {
    return
  }

  const activeEpisodeId = workspace.value?.activeEpisodeId
  if (activeEpisodeId && nextEpisodes.some(episode => episode.id === activeEpisodeId)) {
    selectedEpisodeId.value = activeEpisodeId
    return
  }

  selectedEpisodeId.value = nextEpisodes[0].id
}

async function loadWorkspace(preferredEpisodeId?: number) {
  isWorkspaceLoading.value = true
  workspaceError.value = ''
  try {
    const result = await projectBridge.getSeriesWorkspace(props.project.id)
    if (!result.ok) {
      workspace.value = null
      selectedEpisodeId.value = null
      workspaceError.value = result.error.message
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(preferredEpisodeId)
  } finally {
    isWorkspaceLoading.value = false
  }
}

async function createEpisode() {
  const episodeLabel = episodeForm.episodeLabel.trim()
  const episodeTitle = episodeForm.episodeTitle.trim()

  if (!episodeLabel) {
    ElMessage.error(t('seriesWorkspace.episodes.validation.labelRequired'))
    return
  }

  isCreatingEpisode.value = true
  try {
    const input: CreateSeriesEpisodeInput = {
      projectId: props.project.id,
      episodeLabel,
      episodeTitle: episodeTitle || undefined,
    }
    const result = await projectBridge.createSeriesEpisode(input)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    episodeForm.episodeLabel = ''
    episodeForm.episodeTitle = ''
    ElMessage.success(t('seriesWorkspace.episodes.createSuccess', { episode: result.data.episode.episodeLabel }))
  } finally {
    isCreatingEpisode.value = false
  }
}

async function createVariant() {
  const episode = selectedEpisode.value

  if (!episode) {
    ElMessage.error(t('seriesWorkspace.variants.validation.episodeRequired'))
    return
  }

  if (!variantName.value) {
    ElMessage.error(t('seriesWorkspace.variants.validation.customNameRequired'))
    return
  }

  isCreatingVariant.value = true
  try {
    const input: CreateSeriesVariantInput = {
      projectId: props.project.id,
      episodeId: episode.id,
      name: variantName.value,
      videoProfile: variantForm.videoProfile,
      subtitleProfile: variantForm.subtitleProfile,
    }
    const result = await projectBridge.createSeriesVariant(input)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    variantForm.nameOverride = ''
    ElMessage.success(t('seriesWorkspace.variants.createSuccess', { variant: result.data.variant.name }))
  } finally {
    isCreatingVariant.value = false
  }
}

async function inheritVariantsFromPreviousEpisode() {
  const episode = selectedEpisode.value
  const sourceEpisode = previousEpisode.value

  if (!episode || !sourceEpisode) {
    ElMessage.error(t('seriesWorkspace.variants.inheritDisabled'))
    return
  }

  isInheritingVariants.value = true
  try {
    const result = await projectBridge.inheritSeriesEpisodeVariants({
      projectId: props.project.id,
      episodeId: episode.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    ElMessage.success(
      t('seriesWorkspace.variants.inheritSuccess', {
        episode: sourceEpisode.episodeLabel,
        count: result.data.copiedCount,
      }),
    )
  } finally {
    isInheritingVariants.value = false
  }
}

async function activateVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  activatingVariantId.value = variant.id
  try {
    const result = await projectBridge.activateSeriesVariant({
      projectId: props.project.id,
      episodeId: episode.id,
      variantId: variant.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    setEditorVisible(true)
    ElMessage.success(
      t('seriesWorkspace.variants.activateSuccess', {
        episode: result.data.episode.episodeLabel,
        variant: result.data.variant.name,
      }),
    )
  } finally {
    activatingVariantId.value = null
  }
}

async function syncVariantFromDraft(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  syncingVariantId.value = variant.id
  try {
    const result = await projectBridge.syncSeriesVariantFromDraft({
      projectId: props.project.id,
      episodeId: episode.id,
      variantId: variant.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    ElMessage.success(t('seriesWorkspace.variants.syncSuccess', { variant: result.data.variant.name }))
  } finally {
    syncingVariantId.value = null
  }
}

function isActiveVariant(episodeId: number, variantId: number) {
  return workspace.value?.activeEpisodeId === episodeId && workspace.value.activeVariantId === variantId
}

function selectEpisode(episodeId: number) {
  selectedEpisodeId.value = episodeId
}

function setEditorVisible(visible: boolean) {
  const nextQuery = { ...route.query }
  if (visible) {
    nextQuery.editor = '1'
  } else {
    delete nextQuery.editor
  }

  void router.replace({
    name: typeof route.name === 'string' ? route.name : 'edit',
    params: route.params,
    query: nextQuery,
  })
}

function openProjectFolder() {
  const message: Message.Global.Path = { path: props.project.workingDirectory }
  window.globalAPI.openFolder(JSON.stringify(message))
}

onMounted(() => {
  void loadWorkspace()
  window.projectAPI.refreshProjectData(() => {
    void loadWorkspace()
  })
})

watch(
  () => props.project.id,
  () => {
    selectedEpisodeId.value = null
    void loadWorkspace()
  },
)
</script>

<template>
  <div class="series-workspace">
    <section class="series-workspace__actions">
      <div class="series-workspace__actions-copy">
        <div class="series-workspace__section-title">{{ t('seriesWorkspace.currentDraft.title') }}</div>
        <p class="series-workspace__section-text">{{ currentDraftText }}</p>
      </div>
      <div class="series-workspace__buttons">
        <el-button type="primary" size="large" @click="setEditorVisible(!editorVisible)">
          {{ editorVisible ? t('seriesWorkspace.closeEditor') : t('seriesWorkspace.openEditor') }}
        </el-button>
        <el-button plain size="large" @click="openProjectFolder">
          {{ t('seriesWorkspace.openFolder') }}
        </el-button>
      </div>
    </section>

    <section class="series-workspace__overview">
      <article v-for="item in overviewItems" :key="item.label" class="series-workspace__metric">
        <div class="series-workspace__metric-label">{{ item.label }}</div>
        <div class="series-workspace__metric-value">{{ item.value }}</div>
        <div class="series-workspace__metric-text">{{ item.text }}</div>
      </article>
    </section>

    <section class="series-workspace__management">
      <article class="series-workspace__episodes-card">
        <div class="series-workspace__episodes-head">
          <div>
            <div class="series-workspace__section-title">{{ t('seriesWorkspace.episodes.title') }}</div>
            <p class="series-workspace__section-text">{{ t('seriesWorkspace.episodes.text') }}</p>
          </div>
        </div>

        <div class="series-workspace__episode-form">
          <el-input
            v-model="episodeForm.episodeLabel"
            :placeholder="t('seriesWorkspace.episodes.form.labelPlaceholder')"
          />
          <el-input
            v-model="episodeForm.episodeTitle"
            :placeholder="t('seriesWorkspace.episodes.form.titlePlaceholder')"
          />
          <el-button type="primary" :loading="isCreatingEpisode" @click="createEpisode">
            {{ t('seriesWorkspace.episodes.form.submit') }}
          </el-button>
        </div>

        <div v-if="isWorkspaceLoading" class="series-workspace__empty">
          {{ t('seriesWorkspace.episodes.loading') }}
        </div>
        <div v-else-if="workspaceError" class="series-workspace__empty">
          {{ workspaceError }}
        </div>
        <div v-else-if="episodes.length" class="series-workspace__episode-grid">
          <article
            v-for="episode in episodes"
            :key="episode.id"
            class="series-workspace__episode-card"
            :class="{ 'series-workspace__episode-card--selected': selectedEpisodeId === episode.id }"
            @click="selectEpisode(episode.id)"
          >
            <div class="series-workspace__episode-row">
              <div class="series-workspace__episode-label">{{ episode.episodeLabel }}</div>
              <el-tag
                v-if="workspace?.activeEpisodeId === episode.id"
                effect="plain"
                size="small"
                type="success"
              >
                {{ t('seriesWorkspace.episodes.card.active') }}
              </el-tag>
            </div>
            <div class="series-workspace__episode-title">
              {{ episode.episodeTitle || t('seriesWorkspace.episodes.card.titleFallback') }}
            </div>
            <div class="series-workspace__episode-meta">
              <span>{{ t('seriesWorkspace.episodes.card.directory') }}: {{ episode.directoryName }}</span>
              <span>{{ t('seriesWorkspace.episodes.card.variants') }}: {{ episode.variantCount }}</span>
            </div>
            <div class="series-workspace__episode-note">
              {{ t('seriesWorkspace.episodes.card.updatedAt', { time: formatProjectTimestamp(episode.updatedAt) }) }}
            </div>
          </article>
        </div>
        <div v-else class="series-workspace__empty">
          {{ t('seriesWorkspace.episodes.empty') }}
        </div>
      </article>

      <article class="series-workspace__variants-card">
        <div class="series-workspace__episodes-head">
          <div>
            <div class="series-workspace__section-title">{{ t('seriesWorkspace.variants.title') }}</div>
            <p class="series-workspace__section-text">
              {{
                selectedEpisode
                  ? t('seriesWorkspace.variants.text', { episode: selectedEpisode.episodeLabel })
                  : t('seriesWorkspace.variants.selectEpisodeFirst')
              }}
            </p>
          </div>
        </div>

        <template v-if="selectedEpisode">
          <div class="series-workspace__variant-focus">
            <div class="series-workspace__variant-focus-label">{{ selectedEpisode.episodeLabel }}</div>
            <div class="series-workspace__variant-focus-title">
              {{ selectedEpisode.episodeTitle || t('seriesWorkspace.episodes.card.titleFallback') }}
            </div>
            <div class="series-workspace__variant-focus-meta">
              {{ t('seriesWorkspace.variants.focusMeta', { directory: selectedEpisode.directoryName }) }}
            </div>
          </div>

          <div class="series-workspace__variant-form">
            <el-select v-model="variantForm.videoProfile" class="series-workspace__variant-field">
              <el-option
                v-for="option in videoProfileOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-select v-model="variantForm.subtitleProfile" class="series-workspace__variant-field">
              <el-option
                v-for="option in subtitleProfileOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-input
              v-model="variantForm.nameOverride"
              class="series-workspace__variant-field series-workspace__variant-field--name"
              :placeholder="
                requiresVariantNameOverride
                  ? t('seriesWorkspace.variants.form.nameCustomPlaceholder')
                  : t('seriesWorkspace.variants.form.nameOverridePlaceholder')
              "
            />
            <el-button type="primary" :loading="isCreatingVariant" @click="createVariant">
              {{ t('seriesWorkspace.variants.form.submit') }}
            </el-button>
          </div>

          <div class="series-workspace__variant-toolbar">
            <div class="series-workspace__variant-preview">
              <div class="series-workspace__variant-preview-label">
                {{ t('seriesWorkspace.variants.form.previewLabel') }}
              </div>
              <div class="series-workspace__variant-preview-value">
                {{ variantName || t('seriesWorkspace.variants.form.previewEmpty') }}
              </div>
            </div>
            <div class="series-workspace__variant-toolbar-actions">
              <div class="series-workspace__variant-inherit-text">
                {{
                  previousEpisode
                    ? t('seriesWorkspace.variants.inheritHint', { episode: previousEpisode.episodeLabel })
                    : t('seriesWorkspace.variants.inheritDisabled')
                }}
              </div>
              <el-button
                plain
                :disabled="!previousEpisode"
                :loading="isInheritingVariants"
                @click="inheritVariantsFromPreviousEpisode"
              >
                {{
                  previousEpisode
                    ? t('seriesWorkspace.variants.inheritAction', { episode: previousEpisode.episodeLabel })
                    : t('seriesWorkspace.variants.inheritActionDisabled')
                }}
              </el-button>
            </div>
          </div>

          <div v-if="selectedEpisode.variants.length" class="series-workspace__variant-grid">
            <article
              v-for="variant in selectedEpisode.variants"
              :key="variant.id"
              class="series-workspace__variant-card"
              :class="{ 'series-workspace__variant-card--active': isActiveVariant(selectedEpisode.id, variant.id) }"
            >
              <div class="series-workspace__variant-row">
                <div class="series-workspace__variant-name">{{ variant.name }}</div>
                <el-tag
                  v-if="isActiveVariant(selectedEpisode.id, variant.id)"
                  effect="plain"
                  size="small"
                  type="success"
                >
                  {{ t('seriesWorkspace.variants.card.active') }}
                </el-tag>
              </div>
              <div
                v-if="variant.videoProfile || variant.subtitleProfile"
                class="series-workspace__variant-specs"
              >
                <el-tag v-if="variant.videoProfile" effect="plain" size="small">
                  {{ getVideoProfileLabel(variant.videoProfile) }}
                </el-tag>
                <el-tag v-if="variant.subtitleProfile" effect="plain" size="small" type="info">
                  {{ getSubtitleProfileLabel(variant.subtitleProfile) }}
                </el-tag>
              </div>
              <div class="series-workspace__variant-meta">
                <span>{{ t('seriesWorkspace.variants.card.directory') }}: {{ variant.directoryName }}</span>
                <span>{{
                  t('seriesWorkspace.variants.card.updatedAt', { time: formatProjectTimestamp(variant.updatedAt) })
                }}</span>
              </div>
              <div class="series-workspace__variant-actions">
                <el-button
                  size="small"
                  type="primary"
                  :loading="activatingVariantId === variant.id"
                  @click.stop="activateVariant(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.activate') }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  :loading="syncingVariantId === variant.id"
                  @click.stop="syncVariantFromDraft(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.sync') }}
                </el-button>
              </div>
            </article>
          </div>
          <div v-else class="series-workspace__empty">
            {{ t('seriesWorkspace.variants.empty') }}
          </div>
        </template>
        <div v-else class="series-workspace__empty">
          {{ t('seriesWorkspace.variants.selectEpisodeFirst') }}
        </div>
      </article>
    </section>

    <section class="series-workspace__notes">
      <article class="series-workspace__note">
        <div class="series-workspace__section-title">{{ t('seriesWorkspace.future.title') }}</div>
        <p class="series-workspace__section-text">{{ t('seriesWorkspace.future.text') }}</p>
      </article>
      <article class="series-workspace__note">
        <div class="series-workspace__section-title">{{ t('seriesWorkspace.publish.title') }}</div>
        <p class="series-workspace__section-text">{{ t('seriesWorkspace.publish.text') }}</p>
      </article>
    </section>

    <section v-if="editorVisible" class="series-workspace__editor">
      <EpisodeEdit :id="id" :key="editorKey" />
    </section>
  </div>
</template>

<style scoped>
.series-workspace,
.series-workspace__actions,
.series-workspace__overview,
.series-workspace__management,
.series-workspace__notes {
  display: grid;
  gap: 16px;
}

.series-workspace__actions,
.series-workspace__metric,
.series-workspace__note,
.series-workspace__episodes-card,
.series-workspace__variants-card,
.series-workspace__episode-card,
.series-workspace__variant-card,
.series-workspace__variant-focus {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.54), transparent 42%),
    var(--bg-panel);
}

.series-workspace__actions,
.series-workspace__note,
.series-workspace__metric,
.series-workspace__episodes-card,
.series-workspace__variants-card,
.series-workspace__episode-card,
.series-workspace__variant-card,
.series-workspace__variant-focus {
  padding: 18px;
}

.series-workspace__episodes-card,
.series-workspace__variants-card,
.series-workspace__episode-card,
.series-workspace__variant-card {
  display: grid;
  gap: 14px;
}

.series-workspace__actions {
  grid-template-columns: minmax(0, 1.3fr) auto;
  align-items: center;
  gap: 18px;
}

.series-workspace__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.series-workspace__overview,
.series-workspace__notes,
.series-workspace__management {
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}

.series-workspace__episodes-head,
.series-workspace__episode-form,
.series-workspace__episode-grid,
.series-workspace__variant-form,
.series-workspace__variant-grid,
.series-workspace__variant-toolbar {
  display: grid;
  gap: 14px;
}

.series-workspace__episode-form {
  grid-template-columns: minmax(8rem, 0.6fr) minmax(0, 1fr) auto;
  align-items: center;
  margin-top: 8px;
}

.series-workspace__variant-form {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
}

.series-workspace__variant-field--name {
  grid-column: 1 / span 1;
}

.series-workspace__variant-form :deep(.el-button) {
  width: 100%;
  min-height: 40px;
}

.series-workspace__variant-toolbar {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.series-workspace__variant-toolbar-actions {
  display: grid;
  gap: 10px;
  justify-items: end;
}

.series-workspace__variant-preview {
  display: grid;
  gap: 6px;
}

.series-workspace__variant-preview-label,
.series-workspace__variant-inherit-text {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.series-workspace__variant-preview-value {
  font-family: var(--font-display);
  font-size: 20px;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.series-workspace__episode-grid,
.series-workspace__variant-grid {
  grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  margin-top: 12px;
}

.series-workspace__episode-card {
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.series-workspace__episode-card:hover,
.series-workspace__variant-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border-soft));
}

.series-workspace__episode-card--selected,
.series-workspace__variant-card--active {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border-soft));
  box-shadow: 0 14px 36px rgba(10, 27, 44, 0.08);
}

.series-workspace__episode-row,
.series-workspace__episode-meta,
.series-workspace__variant-row,
.series-workspace__variant-meta,
.series-workspace__variant-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.series-workspace__episode-meta,
.series-workspace__variant-meta,
.series-workspace__variant-actions,
.series-workspace__variant-specs {
  flex-wrap: wrap;
}

.series-workspace__variant-specs {
  display: flex;
  gap: 8px;
}

.series-workspace__episode-label,
.series-workspace__variant-focus-label {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.series-workspace__variant-name,
.series-workspace__variant-focus-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.series-workspace__episode-title {
  font-size: 15px;
  color: var(--text-primary);
}

.series-workspace__variant-focus {
  display: grid;
  gap: 8px;
}

.series-workspace__episode-meta,
.series-workspace__episode-note,
.series-workspace__variant-meta,
.series-workspace__variant-focus-meta,
.series-workspace__empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.series-workspace__empty {
  margin-top: 12px;
}

.series-workspace__section-title,
.series-workspace__metric-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.series-workspace__section-text,
.series-workspace__metric-text {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.series-workspace__metric-value {
  margin-top: 12px;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.2vw, 32px);
  letter-spacing: -0.04em;
  word-break: break-word;
}

.series-workspace__editor {
  display: grid;
}

@media (max-width: 880px) {
  .series-workspace__actions,
  .series-workspace__variant-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-workspace__episode-form,
  .series-workspace__variant-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-workspace__buttons {
    justify-content: stretch;
  }

  .series-workspace__buttons :deep(.el-button),
  .series-workspace__variant-toolbar-actions :deep(.el-button) {
    flex: 1 1 100%;
    margin-left: 0;
  }

  .series-workspace__variant-toolbar-actions {
    justify-items: stretch;
  }
}
</style>
