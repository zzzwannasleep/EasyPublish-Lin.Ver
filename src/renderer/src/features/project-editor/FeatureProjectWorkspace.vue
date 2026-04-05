<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { FolderOpened, RefreshRight } from '@element-plus/icons-vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import SeriesRichTextEditor from './SeriesRichTextEditor.vue'
import { useI18n } from '../../i18n'
import {
  getProjectModeLabel,
  getProjectStatusLabel,
  getProjectSourceLabel,
  getSiteLabel,
  projectStatusTones,
} from '../../services/project/presentation'
import type { ProjectSourceKind, PublishProject, PublishTorrentEntry } from '../../types/project'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import { useProjectContext } from '../project-detail/project-context'

type SiteFieldValue = string | number | boolean | undefined
type SiteFieldForm = Partial<Record<SiteId, Record<string, SiteFieldValue>>>

type FeatureVariantDraft = {
  entry: PublishTorrentEntry
  id: string
  name: string
  path: string
  enabled: boolean
  titleOverride?: string
  targetSites: SiteId[]
  siteFieldDefaults: SiteFieldForm
}

const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'anibt', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const router = useRouter()
const { t } = useI18n()
const { isLoading: isProjectLoading, refreshProject } = useProjectContext()

const draftConfig = ref<Config.PublishConfig | null>(null)
const siteCatalog = ref<SiteCatalogEntry[]>([])
const variants = ref<FeatureVariantDraft[]>([])
const selectedVariantId = ref<string | null>(null)
const sharedBodyFallbackMarkdown = ref('')

const isLoadingWorkspace = ref(false)
const isSaving = ref(false)
const isPreparingReview = ref(false)
const loadError = ref('')
const savedFingerprint = ref('')

const form = reactive({
  targetSites: [] as SiteId[],
  siteFieldDefaults: {} as SiteFieldForm,
  bodyMarkdown: '',
})

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMarkdown(value: string | undefined) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : ''
}

function normalizeSourceKind(value: unknown): ProjectSourceKind | null {
  return value === 'quick' || value === 'file' || value === 'template' ? value : null
}

function normalizeSiteFieldNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeSiteFieldValue(field: SiteFieldSchemaEntry, value: unknown): SiteFieldValue {
  switch (field.control) {
    case 'checkbox':
      return value === true || value === false ? value : undefined
    case 'number':
      return normalizeSiteFieldNumber(value)
    case 'textarea':
      return typeof value === 'string' ? value : ''
    case 'select':
    case 'text':
    default:
      return typeof value === 'string' ? value.trim() : ''
  }
}

function serializeSiteFieldValue(value: unknown): SiteFieldValue {
  if (value === true || value === false) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = normalizeOptionalString(value)
  return text || undefined
}

function normalizeSiteFieldDefaults(value: unknown): SiteFieldForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value as Record<string, unknown>).reduce<SiteFieldForm>((accumulator, [siteId, defaults]) => {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return accumulator
    }

    accumulator[siteId as SiteId] = { ...(defaults as Record<string, SiteFieldValue>) }
    return accumulator
  }, {})
}

function sortSiteIds(siteIds: SiteId[]) {
  return [...new Set(siteIds.filter(Boolean))].sort((left, right) => {
    const leftIndex = SITE_ORDER.indexOf(left)
    const rightIndex = SITE_ORDER.indexOf(right)
    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex
    }
    if (leftIndex >= 0) {
      return -1
    }
    if (rightIndex >= 0) {
      return 1
    }
    return left.localeCompare(right)
  })
}

function getFileName(path: string) {
  return path.replace(/^.*[\\/]/, '')
}

function normalizePublishTorrentEntry(value: unknown, index: number): PublishTorrentEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const path = normalizeOptionalString(raw.path)
  const name = normalizeOptionalString(raw.name)

  if (!path && !name) {
    return null
  }

  return {
    ...(raw as unknown as PublishTorrentEntry),
    id: normalizeOptionalString(raw.id) || `feature-variant-${index + 1}`,
    name: name || (path ? getFileName(path) : `版本 ${index + 1}`),
    path,
    enabled: raw.enabled !== false,
    titleOverride: normalizeOptionalString(raw.titleOverride) || undefined,
    bodyOverride: typeof raw.bodyOverride === 'string' ? raw.bodyOverride : undefined,
    targetSites: Array.isArray(raw.targetSites) ? sortSiteIds(raw.targetSites.filter(Boolean) as SiteId[]) : undefined,
    siteFieldDefaults: normalizeSiteFieldDefaults(raw.siteFieldDefaults),
  }
}

function buildFallbackVariant(config: Config.PublishConfig) {
  const path = normalizeOptionalString(config.torrentPath)
  const torrentName = normalizeOptionalString(config.torrentName)

  return {
    id: normalizeOptionalString(config.activeTorrentId) || 'feature-main',
    name: torrentName || props.project.name || '版本 1',
    path,
    enabled: true,
    titleOverride: undefined,
  } satisfies PublishTorrentEntry
}

function buildFeatureVariants(config: Config.PublishConfig) {
  const rawVariants = Array.isArray(config.torrentEntries)
    ? config.torrentEntries
        .map((entry, index) => normalizePublishTorrentEntry(entry, index))
        .filter((entry): entry is PublishTorrentEntry => Boolean(entry))
    : []

  const entries = rawVariants.length > 0 ? rawVariants : [buildFallbackVariant(config)]
  const activeVariantId = normalizeOptionalString(config.activeTorrentId)

  return entries.map((entry, index) => {
    const isActive = activeVariantId ? entry.id === activeVariantId : index === 0
    return {
      entry,
      id: entry.id,
      name: normalizeOptionalString(entry.name) || `版本 ${index + 1}`,
      path: normalizeOptionalString(entry.path),
      enabled: entry.enabled !== false,
      titleOverride: normalizeOptionalString(entry.titleOverride) || undefined,
      targetSites: sortSiteIds(entry.targetSites ?? (isActive ? ((config.targetSites ?? []) as SiteId[]) : [])),
      siteFieldDefaults: normalizeSiteFieldDefaults(entry.siteFieldDefaults ?? (isActive ? config.siteFieldDefaults : undefined)),
    } satisfies FeatureVariantDraft
  })
}

function getEditableSiteFields(siteId: SiteId) {
  return (siteCatalog.value.find(site => site.id === siteId)?.fieldSchemas ?? []).filter(field => field.mode !== 'readonly')
}

function ensureSiteFieldEntry(siteId: SiteId) {
  if (!form.siteFieldDefaults[siteId]) {
    form.siteFieldDefaults[siteId] = {}
  }
  return form.siteFieldDefaults[siteId] as Record<string, SiteFieldValue>
}

function readSiteFieldValue(siteId: SiteId, field: SiteFieldSchemaEntry) {
  const entry = ensureSiteFieldEntry(siteId)
  const value = entry[field.key]
  if (field.control === 'checkbox') {
    return typeof value === 'boolean' ? value : false
  }
  if (field.control === 'number') {
    return typeof value === 'number' ? value : undefined
  }
  return typeof value === 'string' ? value : ''
}

function updateSiteFieldValue(siteId: SiteId, field: SiteFieldSchemaEntry, value: unknown) {
  const entry = ensureSiteFieldEntry(siteId)
  const normalizedValue = normalizeSiteFieldValue(field, value)
  if (normalizedValue === undefined || normalizedValue === '') {
    delete entry[field.key]
  } else {
    entry[field.key] = normalizedValue
  }
}

function buildSiteFieldDefaultsPayload(targetSites: SiteId[], siteFieldDefaults: SiteFieldForm) {
  const payload: SiteFieldForm = {}

  sortSiteIds(targetSites).forEach(siteId => {
    const entry = siteFieldDefaults[siteId]
    if (!entry || typeof entry !== 'object') {
      return
    }

    const nextEntry = Object.entries(entry).reduce<Record<string, SiteFieldValue>>((result, [key, value]) => {
      const serializedValue = serializeSiteFieldValue(value)
      if (serializedValue === undefined || serializedValue === '') {
        return result
      }
      result[key] = serializedValue
      return result
    }, {})

    if (Object.keys(nextEntry).length > 0) {
      payload[siteId] = nextEntry
    }
  })

  return payload
}

function resolveLocaleText(key: string | undefined, fallback: string) {
  if (!key) {
    return fallback
  }
  const translated = t(key)
  return translated === key ? fallback : translated
}

function resolveSiteFieldLabel(field: SiteFieldSchemaEntry) {
  return resolveLocaleText(field.labelKey, field.key)
}

function resolveSiteFieldHelp(field: SiteFieldSchemaEntry) {
  return resolveLocaleText(field.helpKey, field.mode === 'required' ? '该字段为必填' : '该字段为选填')
}

function resolveSiteFieldPlaceholder(field: SiteFieldSchemaEntry) {
  return resolveLocaleText(field.placeholderKey, `填写${resolveSiteFieldLabel(field)}`)
}

const selectedVariant = computed(
  () => variants.value.find(variant => variant.id === selectedVariantId.value) ?? variants.value[0] ?? null,
)

const sourceKind = computed(() => normalizeSourceKind(draftConfig.value?.sourceKind ?? props.project.sourceKind))
const sourceLabel = computed(() => (sourceKind.value ? getProjectSourceLabel(sourceKind.value) : ''))
const isDirty = computed(() => Boolean(draftConfig.value && buildDirtyFingerprint() !== savedFingerprint.value))

const availableSites = computed(() =>
  [...siteCatalog.value]
    .filter(site => site.enabled && site.capabilitySet.publish.torrent && site.accountStatus === 'authenticated')
    .sort(
      (left, right) =>
        sortSiteIds([left.id, right.id]).indexOf(left.id) - sortSiteIds([left.id, right.id]).indexOf(right.id),
    ),
)

const selectedTargetSites = computed(() =>
  sortSiteIds(form.targetSites)
    .map(siteId => availableSites.value.find(site => site.id === siteId) ?? null)
    .filter((site): site is SiteCatalogEntry => Boolean(site)),
)

const selectedSiteFieldSections = computed(() =>
  selectedTargetSites.value.map(site => ({
    site,
    fields: getEditableSiteFields(site.id),
  })),
)

function resolveInitialBodyMarkdown(config: Config.PublishConfig) {
  return normalizeMarkdown(config.bodyTemplate || sharedBodyFallbackMarkdown.value || '')
}

function loadVariantIntoForm(variant: FeatureVariantDraft | null, options?: { preserveBody?: boolean }) {
  form.targetSites = sortSiteIds(variant?.targetSites ?? [])
  form.siteFieldDefaults = deepClone(variant?.siteFieldDefaults ?? {})
  if (!options?.preserveBody) {
    form.bodyMarkdown = resolveInitialBodyMarkdown(draftConfig.value ?? ({} as Config.PublishConfig))
  }
}

function syncCurrentVariantFromForm() {
  const variant = selectedVariant.value
  if (!variant) {
    return
  }

  variant.targetSites = sortSiteIds(form.targetSites)
  variant.siteFieldDefaults = deepClone(form.siteFieldDefaults)
}

function applyDraftConfig(config: Config.PublishConfig) {
  draftConfig.value = deepClone(config)
  variants.value = buildFeatureVariants(config)

  const preferredVariantId = normalizeOptionalString(config.activeTorrentId)
  selectedVariantId.value =
    variants.value.find(variant => variant.id === selectedVariantId.value)?.id ??
    variants.value.find(variant => variant.id === preferredVariantId)?.id ??
    variants.value.find(variant => variant.enabled)?.id ??
    variants.value[0]?.id ??
    null

  loadVariantIntoForm(selectedVariant.value)
  savedFingerprint.value = buildDirtyFingerprint()
}

function collectWorkingVariants() {
  return variants.value.map(variant =>
    variant.id === selectedVariantId.value
      ? {
          ...variant,
          targetSites: sortSiteIds(form.targetSites),
          siteFieldDefaults: deepClone(form.siteFieldDefaults),
        }
      : {
          ...variant,
          targetSites: sortSiteIds(variant.targetSites),
          siteFieldDefaults: deepClone(variant.siteFieldDefaults),
        },
  )
}

function buildConfigFromForm() {
  const baseConfig = deepClone(draftConfig.value ?? ({} as Config.PublishConfig))
  const workingVariants = collectWorkingVariants()
  const activeVariant =
    workingVariants.find(variant => variant.id === selectedVariantId.value) ?? workingVariants[0] ?? null

  const nextEntries = workingVariants.map(variant => {
    const nextTargetSites = sortSiteIds(variant.targetSites)
    const nextSiteFieldDefaults = buildSiteFieldDefaultsPayload(nextTargetSites, variant.siteFieldDefaults)

    return {
      ...variant.entry,
      id: variant.id,
      name: variant.name,
      path: variant.path,
      enabled: variant.enabled,
      titleOverride: variant.titleOverride,
      targetSites: nextTargetSites.length ? nextTargetSites : undefined,
      siteFieldDefaults: Object.keys(nextSiteFieldDefaults).length ? nextSiteFieldDefaults : undefined,
    } satisfies PublishTorrentEntry
  })

  const activeEntry = nextEntries.find(entry => entry.id === activeVariant?.id) ?? nextEntries[0]
  const activeTargetSites = sortSiteIds(activeEntry?.targetSites ?? [])
  const activeSiteFieldDefaults = normalizeSiteFieldDefaults(activeEntry?.siteFieldDefaults)
  const bodyMarkdown = normalizeMarkdown(form.bodyMarkdown).trim()

  baseConfig.activeTorrentId = activeEntry?.id
  baseConfig.torrentEntries = nextEntries
  if (activeEntry?.path) {
    baseConfig.torrentPath = activeEntry.path
    baseConfig.torrentName = getFileName(activeEntry.path) || baseConfig.torrentName
  }
  if (activeEntry?.titleOverride?.trim()) {
    baseConfig.title = activeEntry.titleOverride.trim()
  }
  baseConfig.targetSites = activeTargetSites
  baseConfig.siteFieldDefaults = Object.keys(activeSiteFieldDefaults).length ? activeSiteFieldDefaults : undefined

  const bangumiCategory = normalizeOptionalString(activeSiteFieldDefaults.bangumi?.category_bangumi)
  if (bangumiCategory) {
    baseConfig.category_bangumi = bangumiCategory
  }

  const nyaaCategory = normalizeOptionalString(
    typeof activeSiteFieldDefaults.nyaa?.categoryCode === 'string'
      ? activeSiteFieldDefaults.nyaa?.categoryCode
      : activeSiteFieldDefaults.nyaa?.category_nyaa,
  )
  if (nyaaCategory) {
    baseConfig.category_nyaa = nyaaCategory
  }

  baseConfig.bodyTemplate = bodyMarkdown || undefined
  baseConfig.bodyTemplateFormat = bodyMarkdown ? 'md' : undefined

  return baseConfig
}

function buildDirtyFingerprint() {
  return JSON.stringify(buildConfigFromForm())
}

function getVariantSiteSummary(variant: FeatureVariantDraft) {
  if (!variant.targetSites.length) {
    return '\u672A\u8BBE\u7F6E\u7AD9\u70B9'
  }
  return variant.targetSites.map(siteId => getSiteLabel(siteId)).join(' / ')
}

function switchVariant(variantId: string) {
  if (variantId === selectedVariantId.value) {
    return
  }

  syncCurrentVariantFromForm()
  selectedVariantId.value = variantId
  loadVariantIntoForm(selectedVariant.value, { preserveBody: true })
}

function addTargetSite(siteId: SiteId) {
  if (form.targetSites.includes(siteId)) {
    return
  }
  form.targetSites = sortSiteIds([...form.targetSites, siteId])
}

function removeTargetSite(siteId: SiteId) {
  form.targetSites = form.targetSites.filter(item => item !== siteId)
  delete form.siteFieldDefaults[siteId]
}

async function loadWorkspace() {
  isLoadingWorkspace.value = true
  loadError.value = ''
  try {
    const [config, content, siteResult] = await Promise.all([
      taskBridge.getPublishConfig(props.id),
      taskBridge.getContent(props.id).catch(() => null),
      siteBridge.listSites(),
    ])

    if (siteResult.ok) {
      siteCatalog.value = siteResult.data.sites
    } else {
      loadError.value = siteResult.error.message
    }

    sharedBodyFallbackMarkdown.value = normalizeMarkdown(content?.md || '')
    applyDraftConfig(config)
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoadingWorkspace.value = false
  }
}

function openWorkingDirectory() {
  const message: Message.Global.Path = { path: props.project.workingDirectory }
  window.globalAPI.openFolder(JSON.stringify(message))
}

async function refreshWorkspace() {
  await refreshProject()
  await loadWorkspace()
}

async function persistDraft(options?: { quiet?: boolean }) {
  if (!draftConfig.value || !selectedVariant.value) {
    if (!options?.quiet) {
      ElMessage.warning('\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u7248\u672C')
    }
    return false
  }

  isSaving.value = true
  try {
    syncCurrentVariantFromForm()
    const nextConfig = buildConfigFromForm()
    const result = JSON.parse(
      await window.taskAPI.saveConfig(JSON.stringify({ id: props.id, config: nextConfig })),
    ) as Message.Task.Result

    if (!result.result.includes('success')) {
      ElMessage.error(result.result)
      return false
    }

    applyDraftConfig(nextConfig)
    await refreshProject()
    if (!options?.quiet) {
      ElMessage.success('\u5F53\u524D\u7248\u672C\u7AD9\u70B9\u914D\u7F6E\u4E0E\u5171\u4EAB\u6B63\u6587\u5DF2\u4FDD\u5B58')
    }
    return true
  } finally {
    isSaving.value = false
  }
}

async function prepareReview() {
  if (!draftConfig.value || !selectedVariant.value) {
    ElMessage.warning('\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u7248\u672C')
    return
  }

  syncCurrentVariantFromForm()
  const nextConfig = buildConfigFromForm()

  if (!nextConfig.torrentPath?.trim()) {
    ElMessage.warning('\u8BF7\u5148\u7ED9\u5F53\u524D\u7248\u672C\u51C6\u5907 torrent \u6587\u4EF6')
    return
  }

  if (!form.targetSites.length) {
    ElMessage.warning('\u8BF7\u5148\u5728\u4E0B\u9762\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u7AD9\u70B9')
    return
  }

  isPreparingReview.value = true
  try {
    const result = JSON.parse(
      await window.taskAPI.createConfig(
        JSON.stringify({
          id: props.id,
          type: sourceKind.value ?? draftConfig.value.sourceKind,
          config: nextConfig,
        }),
      ),
    ) as Message.Task.Result

    if (!result.result.includes('success')) {
      ElMessage.error(result.result)
      return
    }

    applyDraftConfig(nextConfig)
    await refreshProject()
    ElMessage.success(
      `\u5DF2\u6309\u7248\u672C\u300C${selectedVariant.value.name}\u300D\u6574\u7406\u53D1\u5E03\u7A3F\uFF0C\u6B63\u5728\u8FDB\u5165\u68C0\u67E5\u53D1\u5E03\u9875`,
    )
    await router.push({
      name: 'check',
      params: { id: props.id },
    })
  } finally {
    isPreparingReview.value = false
  }
}

onMounted(() => {
  window.taskAPI.setTaskProcess(JSON.stringify({ id: props.id, step: 'edit' }))
  void loadWorkspace()
})

watch(
  () => props.project.updatedAt,
  () => {
    if (isSaving.value || isPreparingReview.value || isDirty.value) {
      return
    }
    void loadWorkspace()
  },
)
</script>

<template>
  <div class="feature-studio" v-loading="isProjectLoading || isLoadingWorkspace">
    <section class="feature-studio__section feature-studio__section--primary">
      <div class="feature-studio__headline">
        <div class="feature-studio__title-block">
          <div class="feature-studio__eyebrow">{{ props.project.name }}</div>
          <h2 class="feature-studio__hero-title">编辑项目</h2>
          <p class="feature-studio__hero-text">
            版本列表只负责切换当前版本；真正的站点选择和站点字段都在下面单独维护。正文编辑区保持共享，只需要填写一次。
          </p>
        </div>

        <div class="feature-studio__hero-actions">
          <StatusChip tone="info">{{ getProjectModeLabel(props.project.projectMode) }}</StatusChip>
          <StatusChip v-if="sourceLabel" tone="success">{{ sourceLabel }}</StatusChip>
          <StatusChip :tone="projectStatusTones[props.project.status]">
            {{ getProjectStatusLabel(props.project.status) }}
          </StatusChip>
        </div>
      </div>

      <div class="feature-studio__toolbar">
        <div class="feature-studio__toolbar-meta">
          <StatusChip tone="info">{{ variants.length }} 个版本</StatusChip>
          <StatusChip v-if="selectedVariant" tone="success">当前版本：{{ selectedVariant.name }}</StatusChip>
          <StatusChip v-if="isDirty" tone="warning">有未保存改动</StatusChip>
        </div>

        <div class="feature-studio__toolbar-actions">
          <el-button plain @click="openWorkingDirectory">
            <el-icon><FolderOpened /></el-icon>
            <span>{{ t('common.openFolder') }}</span>
          </el-button>
          <el-button plain :loading="isProjectLoading || isLoadingWorkspace" @click="refreshWorkspace">
            <el-icon><RefreshRight /></el-icon>
            <span>{{ t('common.refresh') }}</span>
          </el-button>
          <el-button plain :loading="isSaving" @click="persistDraft()">
            <span>保存</span>
          </el-button>
          <el-button type="primary" :loading="isPreparingReview" @click="prepareReview">
            <span>进入检查发布</span>
          </el-button>
        </div>
      </div>

      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <h3 class="feature-studio__section-title">分集版本</h3>
          <p class="feature-studio__section-text">这里只负责看版本和切换版本，不在这里选站点。</p>
        </div>
        <StatusChip tone="info">{{ variants.length }} 个版本</StatusChip>
      </div>

      <div v-if="variants.length" class="feature-studio__variant-grid">
        <article
          v-for="variant in variants"
          :key="variant.id"
          :class="['feature-studio__variant-card', { 'is-active': selectedVariant?.id === variant.id }]"
          @click="switchVariant(variant.id)"
        >
          <div class="feature-studio__variant-head">
            <div>
              <div class="feature-studio__variant-name">{{ variant.name }}</div>
              <div class="feature-studio__variant-text">
                {{ variant.path || '当前版本还没有绑定 torrent 文件' }}
              </div>
            </div>
            <div class="feature-studio__variant-status">
              <StatusChip v-if="selectedVariant?.id === variant.id" tone="success">当前编辑</StatusChip>
              <StatusChip :tone="variant.enabled ? 'info' : 'neutral'">
                {{ variant.enabled ? '启用' : '已停用' }}
              </StatusChip>
            </div>
          </div>

          <div class="feature-studio__variant-foot">
            <div class="feature-studio__variant-text">{{ getVariantSiteSummary(variant) }}</div>
          </div>
        </article>
      </div>

      <div v-else class="feature-studio__empty">当前还没有可切换的版本。</div>
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <h3 class="feature-studio__section-title">选择站点</h3>
          <p class="feature-studio__section-text">这里选的是当前版本要发的站点，不和其他版本共享。</p>
        </div>
        <StatusChip tone="info">{{ form.targetSites.length }} 个目标站点</StatusChip>
      </div>

      <div v-if="selectedVariant && availableSites.length" class="feature-studio__site-grid">
        <article
          v-for="site in availableSites"
          :key="site.id"
          :class="['feature-studio__site-card', { 'is-active': form.targetSites.includes(site.id) }]"
          @click="form.targetSites.includes(site.id) ? removeTargetSite(site.id) : addTargetSite(site.id)"
        >
          <div class="feature-studio__site-head">
            <div>
              <div class="feature-studio__site-name">{{ site.name }}</div>
              <div class="feature-studio__site-text">
                {{ site.accountMessage || '账号有效，可直接加入当前版本' }}
              </div>
            </div>
            <StatusChip :tone="form.targetSites.includes(site.id) ? 'success' : 'neutral'">
              {{ form.targetSites.includes(site.id) ? '已选择' : '未选择' }}
            </StatusChip>
          </div>

          <div class="feature-studio__site-text">
            {{ getEditableSiteFields(site.id).length ? `${getEditableSiteFields(site.id).length} 个填写项` : '无需额外填写' }}
          </div>
        </article>
      </div>

      <div v-else-if="selectedVariant" class="feature-studio__empty">还没有已登录并通过校验的可发布站点。</div>
      <div v-else class="feature-studio__empty">先从上面选一个版本，再继续设置站点。</div>
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <h3 class="feature-studio__section-title">站点字段</h3>
          <p class="feature-studio__section-text">站点字段按版本单独保存，不再和别的版本共用。</p>
        </div>
        <StatusChip tone="info">{{ selectedSiteFieldSections.length }} 个站点展开</StatusChip>
      </div>

      <div v-if="selectedVariant && selectedSiteFieldSections.length" class="feature-studio__site-field-stack">
        <article
          v-for="section in selectedSiteFieldSections"
          :key="section.site.id"
          class="feature-studio__site-fields-card"
        >
          <div class="feature-studio__site-fields-head">
            <div>
              <div class="feature-studio__site-name">{{ section.site.name }}</div>
              <div class="feature-studio__site-text">
                {{ section.site.accountMessage || '这些字段只属于当前版本。' }}
              </div>
            </div>
            <StatusChip :tone="section.fields.length ? 'info' : 'neutral'">
              {{ section.fields.length ? `${section.fields.length} 个字段` : '无需额外填写' }}
            </StatusChip>
          </div>

          <div v-if="section.fields.length" class="feature-studio__field-grid">
            <label
              v-for="field in section.fields"
              :key="field.key"
              :class="['feature-studio__field', { 'feature-studio__field--wide': field.control === 'textarea' }]"
            >
              <span class="feature-studio__field-label">
                {{ resolveSiteFieldLabel(field) }}
                <span v-if="field.mode === 'required'" class="feature-studio__required">必填</span>
              </span>

              <el-select
                v-if="field.control === 'select'"
                :model-value="readSiteFieldValue(section.site.id, field)"
                clearable
                :placeholder="resolveSiteFieldPlaceholder(field)"
                @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
              >
                <el-option
                  v-for="option in field.options ?? []"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>

              <el-input
                v-else-if="field.control === 'textarea'"
                :model-value="readSiteFieldValue(section.site.id, field)"
                type="textarea"
                :rows="field.rows ?? 4"
                :placeholder="resolveSiteFieldPlaceholder(field)"
                @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
              />

              <el-input
                v-else-if="field.control === 'text'"
                :model-value="readSiteFieldValue(section.site.id, field)"
                :placeholder="resolveSiteFieldPlaceholder(field)"
                @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
              />

              <el-input-number
                v-else-if="field.control === 'number'"
                :model-value="readSiteFieldValue(section.site.id, field)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                :controls="false"
                @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
              />

              <div v-else class="feature-studio__switch-row">
                <el-switch
                  :model-value="Boolean(readSiteFieldValue(section.site.id, field))"
                  @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
                />
                <span class="feature-studio__field-help">当前版本启用这个选项</span>
              </div>

              <span class="feature-studio__field-help">{{ resolveSiteFieldHelp(field) }}</span>
            </label>
          </div>

          <div v-else class="feature-studio__empty">这个站点没有额外填写项，直接发布即可。</div>
        </article>
      </div>

      <div v-else-if="selectedVariant" class="feature-studio__empty">上面选几个站点，这里就展开对应站点字段。</div>
      <div v-else class="feature-studio__empty">先从上面选一个版本，再继续填写站点字段。</div>
    </section>

    <section class="feature-studio__section">
      <div class="feature-studio__section-head">
        <div>
          <h3 class="feature-studio__section-title">正文编辑</h3>
          <p class="feature-studio__section-text">这里的正文在当前项目所有版本之间共享，填一次即可。</p>
        </div>
        <StatusChip tone="info">共享正文</StatusChip>
      </div>

      <SeriesRichTextEditor
        v-model="form.bodyMarkdown"
        :placeholder="'在这里编辑合集 / 剧场版项目的共享 Markdown 正文。'"
      />
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
  padding: 22px;
  border: 1px solid var(--border-soft);
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.feature-studio__section--primary {
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--brand-soft) 84%, white 16%), transparent 32%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--accent-soft) 80%, white 20%), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
}

.feature-studio__headline,
.feature-studio__title-block,
.feature-studio__site-field-stack,
.feature-studio__field-grid,
.feature-studio__variant-grid,
.feature-studio__site-grid {
  display: grid;
  gap: 16px;
}

.feature-studio__headline,
.feature-studio__section-head,
.feature-studio__toolbar,
.feature-studio__toolbar-meta,
.feature-studio__toolbar-actions,
.feature-studio__hero-actions,
.feature-studio__variant-status,
.feature-studio__site-head,
.feature-studio__site-fields-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.feature-studio__headline,
.feature-studio__toolbar,
.feature-studio__section-head,
.feature-studio__site-head,
.feature-studio__site-fields-head {
  justify-content: space-between;
}

.feature-studio__eyebrow,
.feature-studio__field-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.feature-studio__hero-title,
.feature-studio__section-title {
  margin: 0;
  font-family: var(--font-display);
  color: var(--text-primary);
  letter-spacing: -0.04em;
}

.feature-studio__hero-title {
  font-size: clamp(1.8rem, 3vw, 2.7rem);
  line-height: 1.02;
}

.feature-studio__section-title {
  font-size: 1.18rem;
  line-height: 1.08;
}

.feature-studio__hero-text,
.feature-studio__section-text,
.feature-studio__site-text,
.feature-studio__variant-text,
.feature-studio__field-help,
.feature-studio__empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.feature-studio__hero-text,
.feature-studio__section-text {
  margin: 0;
}

.feature-studio__variant-grid {
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}

.feature-studio__site-grid,
.feature-studio__field-grid {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.feature-studio__variant-card,
.feature-studio__site-card,
.feature-studio__site-fields-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.feature-studio__variant-card,
.feature-studio__site-card {
  cursor: pointer;
}

.feature-studio__variant-card:hover,
.feature-studio__site-card:hover,
.feature-studio__variant-card.is-active,
.feature-studio__site-card.is-active {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.feature-studio__site-fields-card {
  border-color: color-mix(in srgb, var(--accent) 16%, var(--border-soft));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.58)),
    color-mix(in srgb, var(--bg-panel) 94%, white 6%);
}

.feature-studio__variant-head,
.feature-studio__variant-foot {
  display: grid;
  gap: 10px;
}

.feature-studio__variant-name,
.feature-studio__site-name {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.feature-studio__field {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 10%, var(--border-soft));
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.72);
}

.feature-studio__field--wide {
  grid-column: span 2;
}

.feature-studio__required {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warning-soft) 78%, white 22%);
  color: var(--warning);
  font-size: 11px;
  letter-spacing: normal;
}

.feature-studio__switch-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.feature-studio__empty {
  padding: 14px 16px;
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.feature-studio__field :deep(.el-input-number) {
  width: 100%;
}

@media (max-width: 860px) {
  .feature-studio__field--wide {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .feature-studio__headline,
  .feature-studio__section-head,
  .feature-studio__toolbar,
  .feature-studio__toolbar-actions,
  .feature-studio__site-head,
  .feature-studio__site-fields-head {
    flex-direction: column;
    align-items: stretch;
  }

  .feature-studio__toolbar-actions :deep(.el-button) {
    width: 100%;
  }

  .feature-studio__section {
    padding: 18px;
  }
}
</style>
