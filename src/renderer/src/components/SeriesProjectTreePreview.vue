<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { FolderOpened, RefreshRight, Share, SwitchButton } from '@element-plus/icons-vue'
import StatusChip from './feedback/StatusChip.vue'
import { projectBridge } from '../services/bridge/project'
import {
  formatProjectTimestamp,
  getSiteLabel,
  summarizeTargetSiteProgress,
} from '../services/project/presentation'
import type {
  PublishProject,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesProjectWorkspace,
} from '../types/project'

const props = defineProps<{
  project: PublishProject
}>()

const router = useRouter()
const expanded = ref(false)
const isLoading = ref(false)
const loadError = ref('')
const workspace = ref<SeriesProjectWorkspace | null>(null)
const selectedEpisodeId = ref<number | null>(null)
const activatingKey = ref('')

function applyWorkspace(nextWorkspace: SeriesProjectWorkspace) {
  workspace.value = nextWorkspace

  const fallbackEpisodeId =
    nextWorkspace.activeEpisodeId ??
    (nextWorkspace.episodes.some(episode => episode.id === selectedEpisodeId.value) ? selectedEpisodeId.value : null) ??
    nextWorkspace.episodes[0]?.id ??
    null

  selectedEpisodeId.value = fallbackEpisodeId
}

const episodes = computed(() => workspace.value?.episodes ?? [])

const selectedEpisode = computed(
  () => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? episodes.value[0] ?? null,
)

const totalVariantCount = computed(() =>
  episodes.value.reduce((count, episode) => count + episode.variants.length, 0),
)

function getVariantKey(episodeId: number, variantId: number) {
  return `${episodeId}:${variantId}`
}

function getVariantTargetSites(variant: SeriesProjectVariant) {
  return (variant.targetSites ?? []).map(siteId => getSiteLabel(siteId)).join(' / ')
}

function getVariantPendingCount(variant: SeriesProjectVariant) {
  return summarizeTargetSiteProgress(variant.targetSites, variant.publishResults).pendingSiteIds.length
}

function getVariantPublishedCount(variant: SeriesProjectVariant) {
  return summarizeTargetSiteProgress(variant.targetSites, variant.publishResults).publishedSiteIds.length
}

function getVariantFailedCount(variant: SeriesProjectVariant) {
  return summarizeTargetSiteProgress(variant.targetSites, variant.publishResults).failedSiteIds.length
}

async function loadWorkspace(force = false) {
  if (workspace.value && !force) {
    return
  }

  isLoading.value = true
  loadError.value = ''
  try {
    const result = await projectBridge.getSeriesWorkspace(props.project.id)
    if (!result.ok) {
      loadError.value = result.error.message
      return
    }

    applyWorkspace(result.data.workspace)
  } finally {
    isLoading.value = false
  }
}

async function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) {
    await loadWorkspace()
  }
}

function openProject() {
  void router.push({
    name: 'edit',
    params: { id: props.project.id },
  })
}

async function openVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  activatingKey.value = getVariantKey(episode.id, variant.id)
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

    applyWorkspace(result.data.workspace)
    await router.push({
      name: 'edit',
      params: { id: props.project.id },
    })
  } finally {
    activatingKey.value = ''
  }
}
</script>

<template>
  <section class="series-tree">
    <div class="series-tree__head">
      <div class="series-tree__copy">
        <div class="series-tree__eyebrow">剧集结构</div>
        <div class="series-tree__text">
          先看项目，再展开到每一集和每个版本。发布始终以单个版本为单位，按目标站点批量执行。
        </div>
      </div>

      <div class="series-tree__actions">
        <el-button plain @click="toggleExpanded">
          {{ expanded ? '收起结构' : '展开结构' }}
        </el-button>
        <el-button plain @click="loadWorkspace(true)">
          <el-icon><RefreshRight /></el-icon>
          <span>刷新</span>
        </el-button>
        <el-button type="primary" @click="openProject">
          <el-icon><FolderOpened /></el-icon>
          <span>进入项目</span>
        </el-button>
      </div>
    </div>

    <div class="series-tree__stats">
      <article class="series-tree__stat">
        <div class="series-tree__stat-label">集数</div>
        <div class="series-tree__stat-value">{{ workspace?.episodes.length ?? '...' }}</div>
      </article>
      <article class="series-tree__stat">
        <div class="series-tree__stat-label">版本</div>
        <div class="series-tree__stat-value">{{ workspace ? totalVariantCount : '...' }}</div>
      </article>
      <article class="series-tree__stat">
        <div class="series-tree__stat-label">当前草稿</div>
        <div class="series-tree__stat-text">
          {{
            workspace?.activeEpisodeId && workspace?.activeVariantId
              ? `第 ${episodes.find(episode => episode.id === workspace?.activeEpisodeId)?.episodeLabel ?? '--'} 集 / ${
                  episodes
                    .find(episode => episode.id === workspace?.activeEpisodeId)
                    ?.variants.find(variant => variant.id === workspace?.activeVariantId)?.name ?? '未命名版本'
                }`
              : '还没有激活版本'
          }}
        </div>
      </article>
    </div>

    <div v-if="expanded" class="series-tree__body">
      <div v-if="isLoading" class="series-tree__empty">正在载入剧集层级...</div>
      <div v-else-if="loadError" class="series-tree__empty">{{ loadError }}</div>
      <div v-else-if="episodes.length === 0" class="series-tree__empty">这个项目还没有创建任何剧集。</div>
      <template v-else>
        <div class="series-tree__episode-strip">
          <button
            v-for="episode in episodes"
            :key="episode.id"
            type="button"
            :class="['series-tree__episode-chip', { 'is-active': selectedEpisode?.id === episode.id }]"
            @click="selectedEpisodeId = episode.id"
          >
            <span class="series-tree__episode-label">第 {{ episode.episodeLabel }} 集</span>
            <span class="series-tree__episode-meta">{{ episode.variantCount }} 个版本</span>
          </button>
        </div>

        <div v-if="selectedEpisode" class="series-tree__variant-list">
          <article
            v-for="variant in selectedEpisode.variants"
            :key="variant.id"
            :class="[
              'series-tree__variant-card',
              {
                'is-active':
                  workspace?.activeEpisodeId === selectedEpisode.id && workspace?.activeVariantId === variant.id,
              },
            ]"
          >
            <div class="series-tree__variant-head">
              <div>
                <div class="series-tree__variant-name">{{ variant.name }}</div>
                <div class="series-tree__variant-text">
                  {{ getVariantTargetSites(variant) || '尚未设置目标站点' }}
                </div>
              </div>

              <div class="series-tree__variant-status">
                <StatusChip
                  v-if="workspace?.activeEpisodeId === selectedEpisode.id && workspace?.activeVariantId === variant.id"
                  tone="success"
                >
                  当前草稿
                </StatusChip>
                <StatusChip v-if="getVariantPendingCount(variant)" tone="warning">
                  待发 {{ getVariantPendingCount(variant) }}
                </StatusChip>
                <StatusChip v-if="getVariantPublishedCount(variant)" tone="info">
                  已发 {{ getVariantPublishedCount(variant) }}
                </StatusChip>
                <StatusChip v-if="getVariantFailedCount(variant)" tone="danger">
                  失败 {{ getVariantFailedCount(variant) }}
                </StatusChip>
              </div>
            </div>

            <div class="series-tree__variant-foot">
              <div class="series-tree__variant-text">
                最近更新 {{ formatProjectTimestamp(variant.updatedAt) }}
              </div>
              <el-button
                type="primary"
                plain
                :loading="activatingKey === getVariantKey(selectedEpisode.id, variant.id)"
                @click="openVariant(selectedEpisode, variant)"
              >
                <el-icon><SwitchButton /></el-icon>
                <span>打开这个版本</span>
              </el-button>
            </div>
          </article>
        </div>

        <div v-else class="series-tree__empty">先选择一集，再查看这一集下面的版本分支。</div>
      </template>
    </div>

    <div class="series-tree__note">
      <el-icon><Share /></el-icon>
      <span>项目列表只负责浏览和切换入口，真正编辑和批量发布仍然在项目工作台里按版本进行。</span>
    </div>
  </section>
</template>

<style scoped>
.series-tree {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 1.5rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 42%),
    color-mix(in srgb, var(--bg-panel) 94%, white 6%);
}

.series-tree__head,
.series-tree__actions,
.series-tree__variant-head,
.series-tree__variant-foot,
.series-tree__variant-status,
.series-tree__note {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.series-tree__head {
  justify-content: space-between;
  align-items: flex-start;
}

.series-tree__copy {
  display: grid;
  gap: 6px;
  max-width: 42rem;
}

.series-tree__eyebrow,
.series-tree__stat-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.series-tree__text,
.series-tree__stat-text,
.series-tree__variant-text,
.series-tree__empty,
.series-tree__note {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.series-tree__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.series-tree__stat,
.series-tree__variant-card {
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 90%, white 10%);
}

.series-tree__stat {
  display: grid;
  gap: 8px;
}

.series-tree__stat-value {
  font-family: var(--font-display);
  font-size: 1.8rem;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.series-tree__body,
.series-tree__variant-list {
  display: grid;
  gap: 12px;
}

.series-tree__episode-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-tree__episode-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 90%, white 10%);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.series-tree__episode-chip:hover {
  transform: translateY(-1px);
}

.series-tree__episode-chip.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 90%, white 10%);
}

.series-tree__episode-label,
.series-tree__variant-name {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.series-tree__episode-meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.series-tree__variant-card {
  display: grid;
  gap: 12px;
}

.series-tree__variant-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border-soft));
}

.series-tree__variant-head,
.series-tree__variant-foot {
  justify-content: space-between;
  align-items: flex-start;
}

.series-tree__note {
  padding-top: 2px;
}

@media (max-width: 860px) {
  .series-tree__stats {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .series-tree__head,
  .series-tree__actions,
  .series-tree__variant-head,
  .series-tree__variant-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .series-tree__actions :deep(.el-button),
  .series-tree__variant-foot :deep(.el-button) {
    width: 100%;
  }
}
</style>
