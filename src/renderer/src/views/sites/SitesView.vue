<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppPanel from '../../components/base/AppPanel.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { siteBridge } from '../../services/bridge/site'
import { getPublishStateLabel, publishStateTones } from '../../services/project/presentation'
import type { PublishResult, SitePublishDraft } from '../../types/publish'
import type { SiteCatalogEntry, SiteId, SiteMetadataRecord, SiteSection } from '../../types/site'

interface SitePublishDraftForm {
  title: string
  description: string
  torrentPath: string
  smallDescription: string
  url: string
  technicalInfo: string
  ptGen: string
  price: string
  tagIds: number[]
  posState: string
  posStateUntil: string
  pickType: string
  anonymous: boolean
  sectionId?: number
  typeId?: number
  subCategories: Record<string, number | undefined>
  nfoPath: string
}

const { t } = useI18n()
const isLoading = ref(false)
const errorMessage = ref('')
const sites = ref<SiteCatalogEntry[]>([])
const metadataBySite = ref<Partial<Record<SiteId, SiteMetadataRecord>>>({})
const metadataErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const metadataLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishDrafts = ref<Partial<Record<SiteId, SitePublishDraftForm>>>({})
const publishErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const publishLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishResultBySite = ref<Partial<Record<SiteId, PublishResult>>>({})

const nexusCount = computed(() => sites.value.filter(site => site.adapter === 'nexusphp').length)
const metadataReadyCount = computed(() => sites.value.filter(site => site.capabilitySet.metadata.sections).length)
const tokenReadyCount = computed(() => sites.value.filter(site => site.capabilitySet.auth.token).length)
const adapterBreakdown = computed(() => {
  const counts = new Map<string, number>()

  sites.value.forEach(site => {
    counts.set(site.adapter, (counts.get(site.adapter) ?? 0) + 1)
  })

  return [...counts.entries()]
})

function createEmptyDraft(): SitePublishDraftForm {
  return {
    title: '',
    description: '',
    torrentPath: '',
    smallDescription: '',
    url: '',
    technicalInfo: '',
    ptGen: '',
    price: '',
    tagIds: [],
    posState: 'normal',
    posStateUntil: '',
    pickType: 'normal',
    anonymous: false,
    sectionId: undefined,
    typeId: undefined,
    subCategories: {},
    nfoPath: '',
  }
}

function ensureDraft(siteId: SiteId): SitePublishDraftForm {
  if (!publishDrafts.value[siteId]) {
    publishDrafts.value[siteId] = createEmptyDraft()
  }

  return publishDrafts.value[siteId] as SitePublishDraftForm
}

function initializeDraft(siteId: SiteId) {
  ensureDraft(siteId)
  publishErrorBySite.value[siteId] = ''
  publishResultBySite.value[siteId] = undefined
}

function resetSectionDependentFields(siteId: SiteId, section?: SiteSection) {
  const draft = ensureDraft(siteId)
  draft.typeId = section?.categories[0]?.id
  draft.tagIds = []
  draft.subCategories = Object.fromEntries(
    (section?.subCategories ?? []).map(subCategory => [subCategory.field, undefined]),
  )
}

function applyMetadataDefaults(siteId: SiteId, metadata: SiteMetadataRecord) {
  const draft = ensureDraft(siteId)
  draft.sectionId = metadata.sections[0]?.id
  resetSectionDependentFields(siteId, metadata.sections[0])
}

function capabilityLabels(site: SiteCatalogEntry) {
  const labels: string[] = []

  if (site.capabilitySet.publish.torrent) labels.push(t('sites.capability.publishTorrent'))
  if (site.capabilitySet.publish.article) labels.push(t('sites.capability.publishArticle'))
  if (site.capabilitySet.metadata.sections) labels.push(t('sites.capability.metadataSections'))
  if (site.capabilitySet.metadata.tags) labels.push(t('sites.capability.tags'))
  if (site.capabilitySet.metadata.subCategories) labels.push(t('sites.capability.subCategories'))
  if (site.capabilitySet.auth.token) labels.push(t('sites.capability.tokenAuth'))
  if (site.capabilitySet.auth.usernamePassword) labels.push(t('sites.capability.usernamePassword'))
  if (site.capabilitySet.auth.browserLogin) labels.push(t('sites.capability.browserLogin'))
  if (site.capabilitySet.publish.nfoUpload) labels.push(t('sites.capability.nfoUpload'))
  if (site.capabilitySet.publish.rawResponse) labels.push(t('sites.capability.rawResponse'))

  return labels
}

function isMetadataLoading(siteId: SiteId) {
  return Boolean(metadataLoadingBySite.value[siteId])
}

function isPublishLoading(siteId: SiteId) {
  return Boolean(publishLoadingBySite.value[siteId])
}

function getMetadata(siteId: SiteId) {
  return metadataBySite.value[siteId]
}

function getMetadataError(siteId: SiteId) {
  return metadataErrorBySite.value[siteId]
}

function getPublishError(siteId: SiteId) {
  return publishErrorBySite.value[siteId]
}

function getPublishResult(siteId: SiteId) {
  return publishResultBySite.value[siteId]
}

function getSelectedSection(siteId: SiteId) {
  const metadata = getMetadata(siteId)
  const draft = ensureDraft(siteId)
  return metadata?.sections.find(section => section.id === draft.sectionId) ?? metadata?.sections[0]
}

function getSectionPreview(siteId: SiteId): SiteSection[] {
  return getMetadata(siteId)?.sections.slice(0, 4) ?? []
}

function formatRawResponse(rawResponse: unknown) {
  if (rawResponse === undefined) {
    return ''
  }

  return JSON.stringify(rawResponse, null, 2)
}

async function chooseFile(siteId: SiteId, field: 'torrentPath' | 'nfoPath', extension: string) {
  const message: Message.Global.FileType = { type: extension }
  const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFilePath(JSON.stringify(message)))
  if (path) {
    ensureDraft(siteId)[field] = path
  }
}

function onSectionChange(siteId: SiteId) {
  resetSectionDependentFields(siteId, getSelectedSection(siteId))
}

async function loadSiteMetadata(siteId: SiteId) {
  metadataLoadingBySite.value[siteId] = true
  metadataErrorBySite.value[siteId] = ''

  try {
    const result = await siteBridge.loadMetadata(siteId)
    if (!result.ok) {
      metadataBySite.value[siteId] = undefined
      metadataErrorBySite.value[siteId] = result.error.message
      return
    }

    metadataBySite.value[siteId] = result.data.metadata
    applyMetadataDefaults(siteId, result.data.metadata)
  } catch (error) {
    metadataBySite.value[siteId] = undefined
    metadataErrorBySite.value[siteId] = (error as Error).message
  } finally {
    metadataLoadingBySite.value[siteId] = false
  }
}

function buildPublishInput(siteId: SiteId): SitePublishDraft {
  const draft = ensureDraft(siteId)

  return {
    siteId,
    typeId: draft.typeId ?? 0,
    title: draft.title.trim(),
    description: draft.description.trim(),
    torrentPath: draft.torrentPath.trim(),
    smallDescription: draft.smallDescription.trim() || undefined,
    url: draft.url.trim() || undefined,
    technicalInfo: draft.technicalInfo.trim() || undefined,
    ptGen: draft.ptGen.trim() || undefined,
    price: draft.price.trim() ? Number(draft.price.trim()) : undefined,
    tagIds: draft.tagIds.length > 0 ? [...draft.tagIds] : undefined,
    posState: draft.posState,
    posStateUntil: draft.posStateUntil.trim() || undefined,
    pickType: draft.pickType,
    anonymous: draft.anonymous,
    subCategories: Object.entries(draft.subCategories).reduce<Record<string, number>>((accumulator, [field, value]) => {
      if (typeof value === 'number' && value > 0) {
        accumulator[field] = value
      }
      return accumulator
    }, {}),
    nfoPath: draft.nfoPath.trim() || undefined,
  }
}

async function publishSite(siteId: SiteId) {
  publishLoadingBySite.value[siteId] = true
  publishErrorBySite.value[siteId] = ''

  try {
    const result = await siteBridge.publish(buildPublishInput(siteId))
    if (!result.ok) {
      publishResultBySite.value[siteId] = undefined
      publishErrorBySite.value[siteId] = result.error.message
      return
    }

    publishResultBySite.value[siteId] = result.data.result
  } catch (error) {
    publishResultBySite.value[siteId] = undefined
    publishErrorBySite.value[siteId] = (error as Error).message
  } finally {
    publishLoadingBySite.value[siteId] = false
  }
}

async function loadSites() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const result = await siteBridge.listSites()
    if (!result.ok) {
      errorMessage.value = result.error.message
      sites.value = []
      return
    }

    sites.value = result.data.sites
    sites.value.forEach(site => {
      initializeDraft(site.id)
    })
  } catch (error) {
    errorMessage.value = (error as Error).message
    sites.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void loadSites()
})
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('sites.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('sites.hero.title') }}</h1>
        <p class="page-summary">{{ t('sites.hero.summary') }}</p>
      </div>
      <StatusChip tone="success">{{ t('sites.hero.count', { count: sites.length }) }}</StatusChip>
    </section>

    <div class="site-summary-grid">
      <AppPanel
        :eyebrow="t('sites.summary.registry.eyebrow')"
        :title="t('sites.summary.registry.title')"
        :description="t('sites.summary.registry.description')"
      >
        <div class="summary-metrics">
          <div class="metric-card">
            <span class="metric-card__label">{{ t('sites.metric.nexus') }}</span>
            <strong class="metric-card__value">{{ nexusCount }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-card__label">{{ t('sites.metric.metadata') }}</span>
            <strong class="metric-card__value">{{ metadataReadyCount }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-card__label">{{ t('sites.metric.token') }}</span>
            <strong class="metric-card__value">{{ tokenReadyCount }}</strong>
          </div>
        </div>
      </AppPanel>

      <AppPanel
        :eyebrow="t('sites.summary.breakdown.eyebrow')"
        :title="t('sites.summary.breakdown.title')"
        :description="t('sites.summary.breakdown.description')"
      >
        <div class="adapter-breakdown">
          <div v-for="[adapter, count] in adapterBreakdown" :key="adapter" class="adapter-row">
            <span class="adapter-row__name">{{ adapter }}</span>
            <StatusChip :tone="adapter === 'nexusphp' ? 'success' : 'warning'">
              {{ t('sites.adapter.count', { count }) }}
            </StatusChip>
          </div>
        </div>
      </AppPanel>
    </div>

    <AppPanel
      :eyebrow="t('sites.catalog.eyebrow')"
      :title="t('sites.catalog.title')"
      :description="t('sites.catalog.description')"
    >
      <div v-if="isLoading" class="empty-state">{{ t('sites.catalog.loading') }}</div>
      <div v-else-if="errorMessage" class="empty-state empty-state--danger">{{ errorMessage }}</div>
      <div v-else class="site-grid">
        <article v-for="site in sites" :key="site.id" class="site-card">
          <header class="site-card__header">
            <div>
              <div class="site-card__name">{{ site.name }}</div>
              <div class="site-card__id">{{ site.id }}</div>
            </div>
            <StatusChip :tone="site.adapter === 'nexusphp' ? 'success' : 'warning'">
              {{ site.adapter }}
            </StatusChip>
          </header>

          <dl class="site-card__details">
            <div>
              <dt>{{ t('sites.labels.baseUrl') }}</dt>
              <dd>{{ site.normalizedBaseUrl }}</dd>
            </div>
            <div v-if="site.apiBaseUrl">
              <dt>{{ t('sites.labels.apiUrl') }}</dt>
              <dd>{{ site.apiBaseUrl }}</dd>
            </div>
          </dl>

          <div class="site-card__capabilities">
            <span v-for="label in capabilityLabels(site)" :key="label" class="capability-pill">
              {{ label }}
            </span>
          </div>

          <p v-if="site.notes.length" class="site-card__notes">
            {{ site.notes.join(' ') }}
          </p>

          <div v-if="site.capabilitySet.metadata.sections" class="site-card__metadata">
            <div class="site-card__metadata-header">
              <div>
                <div class="site-card__metadata-title">{{ t('sites.metadata.title') }}</div>
                <div class="site-card__metadata-subtitle">{{ t('sites.metadata.subtitle') }}</div>
              </div>
              <el-button
                :loading="isMetadataLoading(site.id)"
                type="primary"
                plain
                @click="loadSiteMetadata(site.id)"
              >
                {{ getMetadata(site.id) ? t('sites.metadata.reload') : t('sites.metadata.load') }}
              </el-button>
            </div>

            <div v-if="getMetadata(site.id)" class="site-card__metadata-body">
              <StatusChip tone="success">
                {{ t('sites.metadata.sectionCount', { count: getMetadata(site.id)?.sections.length ?? 0 }) }}
              </StatusChip>
              <div v-if="getMetadata(site.id)?.apiBaseUrl" class="site-card__metadata-endpoint">
                {{ getMetadata(site.id)?.apiBaseUrl }}
              </div>
              <div class="site-card__section-list">
                <span
                  v-for="section in getSectionPreview(site.id)"
                  :key="section.id"
                  class="section-pill"
                >
                  {{ section.displayName || section.name }}
                </span>
              </div>
            </div>

            <div v-else-if="getMetadataError(site.id)" class="site-card__metadata-error">
              {{ getMetadataError(site.id) }}
            </div>
          </div>

          <div
            v-if="site.capabilitySet.publish.torrent && getMetadata(site.id)"
            class="site-card__publish"
          >
            <div class="site-card__metadata-title">{{ t('sites.publish.title') }}</div>
            <div class="site-card__metadata-subtitle">{{ t('sites.publish.subtitle') }}</div>

            <el-form label-position="top" class="publish-form">
              <div class="publish-form__grid">
                <el-form-item :label="t('sites.form.section')">
                  <el-select v-model="ensureDraft(site.id).sectionId" @change="onSectionChange(site.id)">
                    <el-option
                      v-for="section in getMetadata(site.id)?.sections ?? []"
                      :key="section.id"
                      :label="`${section.displayName || section.name} (${section.name})`"
                      :value="section.id"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item :label="t('sites.form.category')">
                  <el-select v-model="ensureDraft(site.id).typeId">
                    <el-option
                      v-for="category in getSelectedSection(site.id)?.categories ?? []"
                      :key="category.id"
                      :label="`${category.name} (${category.id})`"
                      :value="category.id"
                    />
                  </el-select>
                </el-form-item>
              </div>

              <div class="publish-form__grid">
                <el-form-item :label="t('sites.form.title')">
                  <el-input v-model="ensureDraft(site.id).title" />
                </el-form-item>

                <el-form-item :label="t('sites.form.smallDescription')">
                  <el-input v-model="ensureDraft(site.id).smallDescription" />
                </el-form-item>
              </div>

              <el-form-item :label="t('sites.form.description')">
                <el-input v-model="ensureDraft(site.id).description" :rows="6" type="textarea" />
              </el-form-item>

              <div class="publish-form__grid publish-form__grid--files">
                <el-form-item :label="t('sites.form.torrentFile')">
                  <div class="file-picker">
                    <el-input v-model="ensureDraft(site.id).torrentPath" />
                    <el-button plain @click="chooseFile(site.id, 'torrentPath', 'torrent')">
                      {{ t('sites.actions.pickTorrent') }}
                    </el-button>
                  </div>
                </el-form-item>

                <el-form-item :label="t('sites.form.nfoFile')">
                  <div class="file-picker">
                    <el-input v-model="ensureDraft(site.id).nfoPath" />
                    <el-button plain @click="chooseFile(site.id, 'nfoPath', 'nfo')">
                      {{ t('sites.actions.pickNfo') }}
                    </el-button>
                  </div>
                </el-form-item>
              </div>

              <div class="publish-form__grid publish-form__grid--meta">
                <el-form-item :label="t('sites.form.referenceUrl')">
                  <el-input v-model="ensureDraft(site.id).url" />
                </el-form-item>

                <el-form-item :label="t('sites.form.ptgen')">
                  <el-input v-model="ensureDraft(site.id).ptGen" />
                </el-form-item>

                <el-form-item :label="t('sites.form.technicalInfo')">
                  <el-input v-model="ensureDraft(site.id).technicalInfo" />
                </el-form-item>

                <el-form-item :label="t('sites.form.price')">
                  <el-input v-model="ensureDraft(site.id).price" />
                </el-form-item>
              </div>

              <div class="publish-form__grid publish-form__grid--meta">
                <el-form-item :label="t('sites.form.tags')">
                  <el-select v-model="ensureDraft(site.id).tagIds" multiple collapse-tags collapse-tags-tooltip>
                    <el-option
                      v-for="tag in getSelectedSection(site.id)?.tags ?? []"
                      :key="tag.id"
                      :label="`${tag.name} (${tag.id})`"
                      :value="tag.id"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item :label="t('sites.form.positionState')">
                  <el-select v-model="ensureDraft(site.id).posState">
                    <el-option :label="t('sites.values.normal')" value="normal" />
                    <el-option :label="t('sites.values.sticky')" value="sticky" />
                    <el-option :label="t('sites.values.recommended')" value="recommended" />
                  </el-select>
                </el-form-item>

                <el-form-item :label="t('sites.form.pickType')">
                  <el-select v-model="ensureDraft(site.id).pickType">
                    <el-option :label="t('sites.values.normal')" value="normal" />
                    <el-option :label="t('sites.values.hot')" value="hot" />
                    <el-option :label="t('sites.values.classic')" value="classic" />
                  </el-select>
                </el-form-item>

                <el-form-item :label="t('sites.form.positionUntil')">
                  <el-input v-model="ensureDraft(site.id).posStateUntil" placeholder="YYYY-MM-DD HH:mm:ss" />
                </el-form-item>
              </div>

              <div
                v-if="(getSelectedSection(site.id)?.subCategories?.length ?? 0) > 0"
                class="publish-form__subcategories"
              >
                <el-form-item
                  v-for="subCategory in getSelectedSection(site.id)?.subCategories ?? []"
                  :key="subCategory.field"
                  :label="`${subCategory.label} (${subCategory.field})`"
                >
                  <el-select v-model="ensureDraft(site.id).subCategories[subCategory.field]">
                    <el-option :label="t('common.none')" :value="undefined" />
                    <el-option
                      v-for="option in subCategory.data"
                      :key="option.id"
                      :label="`${option.name} (${option.id})`"
                      :value="option.id"
                    />
                  </el-select>
                </el-form-item>
              </div>

              <div class="publish-form__actions">
                <el-checkbox v-model="ensureDraft(site.id).anonymous">{{ t('sites.flags.anonymous') }}</el-checkbox>
                <el-button
                  :loading="isPublishLoading(site.id)"
                  type="primary"
                  @click="publishSite(site.id)"
                >
                  {{ t('sites.actions.publishViaAdapter') }}
                </el-button>
              </div>
            </el-form>

            <div v-if="getPublishError(site.id)" class="site-card__metadata-error">
              {{ getPublishError(site.id) }}
            </div>

            <div v-if="getPublishResult(site.id)" class="publish-result">
              <div class="publish-result__header">
                <StatusChip :tone="publishStateTones[getPublishResult(site.id)!.status]">
                  {{ getPublishStateLabel(getPublishResult(site.id)!.status) }}
                </StatusChip>
                <a
                  v-if="getPublishResult(site.id)?.remoteUrl"
                  :href="getPublishResult(site.id)?.remoteUrl"
                  class="publish-result__link"
                  target="_blank"
                >
                  {{ getPublishResult(site.id)?.remoteUrl }}
                </a>
              </div>
              <pre class="publish-result__raw">{{ formatRawResponse(getPublishResult(site.id)?.rawResponse) }}</pre>
            </div>
          </div>
        </article>
      </div>
    </AppPanel>
  </div>
</template>

<style scoped>
.site-summary-grid,
.summary-metrics,
.site-grid,
.site-card__header,
.site-card__capabilities,
.adapter-row,
.site-card__metadata-header,
.file-picker,
.publish-form__actions,
.publish-result__header,
.site-card__section-list {
  display: flex;
}

.site-summary-grid,
.summary-metrics,
.site-grid {
  gap: 18px;
}

.site-summary-grid,
.site-grid {
  display: grid;
}

.site-summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  margin-bottom: 18px;
}

.summary-metrics {
  flex-wrap: wrap;
}

.metric-card {
  min-width: 132px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.metric-card__label,
.site-card__id,
.site-card__details dt,
.site-card__notes,
.site-card__metadata-subtitle,
.site-card__metadata-endpoint,
.site-card__metadata-error,
.publish-result__link {
  color: var(--text-secondary);
}

.metric-card__label,
.site-card__details dt {
  display: block;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.metric-card__value {
  display: block;
  margin-top: 10px;
  font-family: var(--font-display);
  font-size: 28px;
  letter-spacing: -0.04em;
}

.adapter-breakdown,
.site-card__details,
.publish-form__subcategories,
.publish-result {
  display: grid;
  gap: 12px;
}

.adapter-row {
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.adapter-row__name,
.site-card__name,
.site-card__metadata-title {
  font-weight: 700;
}

.empty-state {
  padding: 48px 20px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  text-align: center;
}

.empty-state--danger {
  color: var(--danger);
}

.site-grid {
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
}

.site-card {
  padding: 20px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.site-card__header,
.site-card__metadata-header,
.publish-result__header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.site-card__name {
  font-size: 18px;
}

.site-card__id {
  margin-top: 6px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.site-card__details {
  margin: 18px 0;
}

.site-card__details dd {
  margin: 6px 0 0;
  word-break: break-all;
}

.site-card__capabilities {
  flex-wrap: wrap;
  gap: 10px;
}

.site-card__metadata,
.site-card__publish {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border-soft);
}

.site-card__metadata-subtitle {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.site-card__metadata-body {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.site-card__metadata-endpoint,
.site-card__metadata-error,
.site-card__notes,
.publish-result__link {
  font-size: 13px;
  line-height: 1.6;
}

.site-card__metadata-endpoint {
  word-break: break-all;
}

.site-card__section-list {
  flex-wrap: wrap;
  gap: 10px;
}

.publish-form {
  margin-top: 16px;
}

.publish-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.publish-form__grid--meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.publish-form__grid--files {
  grid-template-columns: 1fr;
}

.file-picker {
  gap: 10px;
}

.file-picker :deep(.el-input) {
  flex: 1;
}

.publish-form__subcategories {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.publish-form__actions {
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 6px;
}

.publish-result__raw {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.capability-pill,
.section-pill {
  display: inline-flex;
  padding: 8px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.capability-pill {
  background: rgba(214, 123, 40, 0.14);
  color: var(--accent);
}

.section-pill {
  border: 1px solid var(--border-soft);
  background: var(--bg-panel);
  color: var(--text-primary);
}

.site-card__notes {
  margin: 18px 0 0;
}

@media (max-width: 1180px) {
  .site-grid,
  .publish-form__grid,
  .publish-form__grid--meta,
  .publish-form__subcategories {
    grid-template-columns: 1fr;
  }

  .publish-form__actions,
  .file-picker {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
