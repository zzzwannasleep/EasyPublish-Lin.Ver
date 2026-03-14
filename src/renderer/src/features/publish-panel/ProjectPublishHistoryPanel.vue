<script setup lang="ts">
import { computed } from 'vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import {
  formatProjectTimestamp,
  getMissingTargetSiteIds,
  getPublishStateLabel,
  getSiteLabel,
  publishStateTones,
  sortPublishResults,
} from '../../services/project/presentation'
import type { PublishProject } from '../../types/project'

const props = withDefaults(
  defineProps<{
    project: PublishProject | null
    isLoading?: boolean
    errorMessage?: string | null
  }>(),
  {
    isLoading: false,
    errorMessage: null,
  },
)

const { t } = useI18n()

const results = computed(() => {
  if (!props.project) {
    return []
  }

  return sortPublishResults(props.project.publishResults)
})

const publishedCount = computed(
  () => new Set(results.value.filter(result => result.status === 'published').map(result => result.siteId)).size,
)
const failedCount = computed(() => results.value.filter(result => result.status === 'failed').length)
const targetSiteCount = computed(() => props.project?.targetSites.length ?? 0)
const missingTargetSites = computed(() => (props.project ? getMissingTargetSiteIds(props.project) : []))
const latestPublishedResult = computed(() =>
  results.value.find(result => result.status === 'published' && result.remoteUrl),
)

function copyText(value?: string) {
  if (!value) {
    return
  }

  const message: Message.Global.Clipboard = { str: value }
  window.globalAPI.writeClipboard(JSON.stringify(message))
  ElMessage.success(t('taskList.success.copied'))
}

function formatRawResponse(rawResponse: unknown) {
  if (rawResponse === undefined) {
    return ''
  }

  return JSON.stringify(rawResponse, null, 2)
}
</script>

<template>
  <div v-if="isLoading" class="history-empty">{{ t('history.loading') }}</div>
  <div v-else-if="errorMessage" class="history-empty history-empty--danger">
    {{ errorMessage }}
  </div>
  <div v-else-if="!project" class="history-empty">{{ t('history.unavailable') }}</div>
  <div v-else class="history-panel">
    <section class="history-summary">
      <article class="history-stat">
        <div class="history-stat__label">{{ t('history.stat.attempts.label') }}</div>
        <div class="history-stat__value">{{ results.length }}</div>
        <div class="history-stat__text">{{ t('history.stat.attempts.text') }}</div>
      </article>
      <article class="history-stat">
        <div class="history-stat__label">{{ t('history.stat.publishedSites.label') }}</div>
        <div class="history-stat__value">{{ publishedCount }}</div>
        <div class="history-stat__text">{{ t('history.stat.publishedSites.text') }}</div>
      </article>
      <article class="history-stat">
        <div class="history-stat__label">{{ t('history.stat.failures.label') }}</div>
        <div class="history-stat__value">{{ failedCount }}</div>
        <div class="history-stat__text">{{ t('history.stat.failures.text') }}</div>
      </article>
      <article class="history-stat">
        <div class="history-stat__label">{{ t('history.stat.remainingTargets.label') }}</div>
        <div class="history-stat__value">{{ missingTargetSites.length }}</div>
        <div class="history-stat__text">
          {{
            targetSiteCount
              ? t('history.stat.remainingTargets.text', { total: targetSiteCount })
              : t('history.stat.remainingTargets.empty')
          }}
        </div>
      </article>
    </section>

    <el-alert
      v-if="missingTargetSites.length"
      :title="t('history.missingTargets.warning', { sites: missingTargetSites.map(siteId => getSiteLabel(siteId)).join(', ') })"
      type="warning"
      :closable="false"
      show-icon
    />

    <article v-if="latestPublishedResult?.remoteUrl" class="history-highlight">
      <div>
        <div class="history-highlight__eyebrow">{{ t('history.highlight.latestLink') }}</div>
        <a
          :href="latestPublishedResult.remoteUrl"
          class="history-highlight__link"
          target="_blank"
          rel="noreferrer"
        >
          {{ latestPublishedResult.remoteUrl }}
        </a>
        <div class="history-highlight__text">
          {{ getSiteLabel(latestPublishedResult.siteId) }} ·
          {{ formatProjectTimestamp(latestPublishedResult.timestamp) }}
        </div>
      </div>
      <el-button plain @click="copyText(latestPublishedResult.remoteUrl)">{{ t('history.actions.copyLink') }}</el-button>
    </article>

    <div v-if="results.length === 0" class="history-empty">
      {{ t('history.empty.noAttempts') }}
    </div>

    <div v-else class="history-list">
      <article
        v-for="(result, index) in results"
        :key="`${result.siteId}-${result.status}-${result.remoteUrl || 'none'}-${result.timestamp || index}`"
        class="history-item"
      >
        <header class="history-item__header">
          <div>
            <div class="history-item__site">{{ getSiteLabel(result.siteId) }}</div>
            <div class="history-item__timestamp">
              {{ formatProjectTimestamp(result.timestamp) }}
            </div>
          </div>
          <StatusChip :tone="publishStateTones[result.status]">
            {{ getPublishStateLabel(result.status) }}
          </StatusChip>
        </header>

        <div v-if="result.message" class="history-item__message">
          {{ result.message }}
        </div>

        <div v-if="result.remoteId" class="history-item__meta">
          {{ t('common.remoteId') }}: <strong>{{ result.remoteId }}</strong>
        </div>

        <div v-if="result.remoteUrl" class="history-item__link-row">
          <a :href="result.remoteUrl" class="history-item__link" target="_blank" rel="noreferrer">
            {{ result.remoteUrl }}
          </a>
          <el-button link size="small" @click="copyText(result.remoteUrl)">{{ t('common.copy') }}</el-button>
        </div>

        <details v-if="result.rawResponse !== undefined" class="history-item__raw">
          <summary>{{ t('common.rawResponse') }}</summary>
          <pre>{{ formatRawResponse(result.rawResponse) }}</pre>
        </details>
      </article>
    </div>
  </div>
</template>

<style scoped>
.history-panel,
.history-summary,
.history-list {
  display: grid;
  gap: 16px;
}

.history-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.history-stat,
.history-highlight,
.history-item {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.history-stat,
.history-item {
  padding: 18px;
}

.history-highlight {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.55));
}

.history-stat__label,
.history-highlight__eyebrow,
.history-item__timestamp {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.history-stat__value {
  margin-top: 10px;
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1;
  letter-spacing: -0.05em;
}

.history-stat__text,
.history-highlight__text,
.history-item__message,
.history-item__meta,
.history-item__raw,
.history-empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.history-stat__text {
  margin-top: 10px;
}

.history-highlight__link,
.history-item__link {
  color: var(--accent);
  word-break: break-all;
}

.history-item__header,
.history-item__link-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.history-item__site {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.history-item__message,
.history-item__meta,
.history-item__link-row {
  margin-top: 12px;
}

.history-item__raw {
  margin-top: 14px;
}

.history-item__raw summary {
  cursor: pointer;
  color: var(--text-primary);
  font-weight: 700;
}

.history-item__raw pre {
  margin: 12px 0 0;
  padding: 14px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.history-empty {
  padding: 24px 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  text-align: center;
}

.history-empty--danger {
  color: var(--danger);
}

@media (max-width: 1180px) {
  .history-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .history-highlight,
  .history-item__header,
  .history-item__link-row {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 720px) {
  .history-summary {
    grid-template-columns: 1fr;
  }
}
</style>
