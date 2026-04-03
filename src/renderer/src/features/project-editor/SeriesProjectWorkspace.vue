<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CirclePlus,
  Delete,
  DocumentCopy,
  FolderOpened,
  Plus,
  RefreshRight,
  Share,
  SwitchButton,
  UploadFilled,
} from '@element-plus/icons-vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import {
  formatProjectTimestamp,
  getSiteLabel,
  summarizeTargetSiteProgress,
} from '../../services/project/presentation'
import type {
  PublishProject,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesProjectWorkspace,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
} from '../../types/project'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'
import SeriesRichTextEditor from './SeriesRichTextEditor.vue'

const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
const DEFAULT_BANGUMI_CATEGORY = '549ef207fe682f7549f1ea90'
const DEFAULT_NYAA_CATEGORY = '1_3'
const SOURCE_OPTIONS = ['WebRip', 'BDRip', 'TVRip', 'WEB-DL']
const RESOLUTION_OPTIONS = ['1080p', '720p', '2160p']
const VIDEO_CODEC_OPTIONS = ['HEVC', 'AVC', 'AV1']
const AUDIO_CODEC_OPTIONS = ['AAC', 'FLAC', 'AC3', 'EAC3']

type SiteFieldValue = string | number | boolean | undefined
type SiteFieldForm = Partial<Record<SiteId, Record<string, SiteFieldValue>>>

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const router = useRouter()
const { t } = useI18n()

const workspace = ref<SeriesProjectWorkspace | null>(null)
const draftConfig = ref<Config.PublishConfig | null>(null)
const siteCatalog = ref<SiteCatalogEntry[]>([])
const storedTags = ref<Array<{ label: string; value: string }>>([])

const isLoading = ref(false)
const isSaving = ref(false)
const isPreparingReview = ref(false)
const isCreatingEpisode = ref(false)
const isCreatingVariant = ref(false)
const isInheritingVariants = ref(false)
const selectedEpisodeId = ref<number | null>(null)
const selectedSiteId = ref<SiteId | null>(null)
const loadError = ref('')
const switchingVariantKey = ref('')
const duplicatingVariantKey = ref('')
const removingVariantKey = ref('')
const savedFingerprint = ref('')

const episodeDialogVisible = ref(false)
const variantDialogVisible = ref(false)

const episodeForm = reactive({
  episodeLabel: '',
  episodeTitle: '',
})

const variantForm = reactive<{
  name: string
  videoProfile: SeriesVariantVideoProfile
  subtitleProfile: SeriesVariantSubtitleProfile
}>({
  name: '',
  videoProfile: '1080p',
  subtitleProfile: 'chs',
})

const form = reactive({
  seriesTitleCN: '',
  seriesTitleEN: '',
  seriesTitleJP: '',
  seasonLabel: '',
  releaseTeam: '',
  sourceType: '',
  resolution: '',
  videoCodec: '',
  audioCodec: '',
  summary: '',
  information: '',
  torrentPath: '',
  titleOverride: '',
  targetSites: [] as SiteId[],
  siteFieldDefaults: {} as SiteFieldForm,
  bodyMarkdown: '',
  categoryBangumi: DEFAULT_BANGUMI_CATEGORY,
  categoryNyaa: DEFAULT_NYAA_CATEGORY,
  completed: false,
  remake: false,
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

function normalizeSiteFieldDefaults(value: unknown): SiteFieldForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const nextFieldDefaults: SiteFieldForm = {}
  Object.entries(value as Record<string, unknown>).forEach(([siteId, defaults]) => {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return
    }

    nextFieldDefaults[siteId] = { ...(defaults as Record<string, SiteFieldValue>) }
  })
  return nextFieldDefaults
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
    case 'select':
    case 'text':
    default:
      return typeof value === 'string' ? value.trim() : ''
  }
}

function serializeSiteFieldValue(field: SiteFieldSchemaEntry, value: unknown): SiteFieldValue {
  switch (field.control) {
    case 'checkbox':
      return value === true || value === false ? value : undefined
    case 'number':
      return normalizeSiteFieldNumber(value)
    case 'select':
    case 'text':
    default: {
      const text = normalizeOptionalString(value)
      return text || undefined
    }
  }
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
  return resolveLocaleText(field.helpKey, field.mode === 'required' ? '该字段为必填。' : '该字段为选填。')
}

function resolveSiteFieldPlaceholder(field: SiteFieldSchemaEntry) {
  return resolveLocaleText(field.placeholderKey, `填写${resolveSiteFieldLabel(field)}`)
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

  if (siteId === 'bangumi' && field.key === 'category_bangumi') {
    form.categoryBangumi =
      (typeof normalizedValue === 'string' && normalizedValue.trim()) || DEFAULT_BANGUMI_CATEGORY
  }
  if (siteId === 'nyaa' && field.key === 'category_nyaa') {
    form.categoryNyaa = (typeof normalizedValue === 'string' && normalizedValue.trim()) || DEFAULT_NYAA_CATEGORY
  }
}

function syncCategoriesIntoSiteFields() {
  ensureSiteFieldEntry('bangumi').category_bangumi = form.categoryBangumi
  ensureSiteFieldEntry('nyaa').category_nyaa = form.categoryNyaa
}

function buildSiteFieldDefaultsPayload() {
  syncCategoriesIntoSiteFields()
  const payload: SiteFieldForm = {}

  Object.entries(form.siteFieldDefaults).forEach(([siteId, entry]) => {
    if (!entry || typeof entry !== 'object') {
      return
    }

    const schemaMap = new Map(getEditableSiteFields(siteId).map(field => [field.key, field]))
    const nextEntry: Record<string, SiteFieldValue> = {}

    Object.entries(entry).forEach(([key, value]) => {
      const field = schemaMap.get(key)
      const serializedValue = field ? serializeSiteFieldValue(field, value) : value
      if (serializedValue === undefined || serializedValue === '') {
        return
      }
      nextEntry[key] = serializedValue
    })

    if (Object.keys(nextEntry).length > 0) {
      payload[siteId] = nextEntry
    }
  })

  return payload
}

const episodes = computed(() => workspace.value?.episodes ?? [])
const activeEpisode = computed(() => episodes.value.find(item => item.id === workspace.value?.activeEpisodeId) ?? null)
const activeVariant = computed(() => activeEpisode.value?.variants.find(item => item.id === workspace.value?.activeVariantId) ?? null)
const selectedEpisode = computed(() => episodes.value.find(item => item.id === selectedEpisodeId.value) ?? activeEpisode.value ?? episodes.value[0] ?? null)
const totalVariantCount = computed(() => episodes.value.reduce((count, episode) => count + episode.variants.length, 0))

const availableSites = computed(() =>
  [...siteCatalog.value]
    .filter(site => site.enabled && site.capabilitySet.publish.torrent && site.accountStatus === 'authenticated')
    .sort((left, right) => sortSiteIds([left.id, right.id]).indexOf(left.id) - sortSiteIds([left.id, right.id]).indexOf(right.id)),
)

const selectedSite = computed(() => availableSites.value.find(site => site.id === selectedSiteId.value) ?? null)
const selectedSiteFields = computed(() => (selectedSite.value ? getEditableSiteFields(selectedSite.value.id) : []))
const unavailableSelectedSites = computed(() =>
  form.targetSites.filter(siteId => !availableSites.value.some(site => site.id === siteId)),
)

const currentProgress = computed(() =>
  summarizeTargetSiteProgress(form.targetSites, activeVariant.value?.publishResults),
)

const currentStructureLabel = computed(() =>
  activeEpisode.value && activeVariant.value ? `第 ${activeEpisode.value.episodeLabel} 集 · ${activeVariant.value.name}` : '还没有打开版本',
)

const autoTitle = computed(() => composePublishTitle())
const isDirty = computed(() => Boolean(draftConfig.value && activeVariant.value && buildDirtyFingerprint() !== savedFingerprint.value))

function readCurrentSiteFieldValue(field: SiteFieldSchemaEntry) {
  if (selectedSite.value) {
    return readSiteFieldValue(selectedSite.value.id, field)
  }

  if (field.control === 'checkbox') {
    return false
  }

  if (field.control === 'number') {
    return undefined
  }

  return ''
}

function updateCurrentSiteFieldValue(field: SiteFieldSchemaEntry, value: unknown) {
  if (!selectedSite.value) {
    return
  }

  updateSiteFieldValue(selectedSite.value.id, field, value)
}

function resolvePreferredSiteId() {
  if (selectedSiteId.value && availableSites.value.some(site => site.id === selectedSiteId.value)) {
    return selectedSiteId.value
  }
  return form.targetSites.find(siteId => availableSites.value.some(site => site.id === siteId)) ?? availableSites.value[0]?.id ?? null
}

watch(
  [() => availableSites.value.map(site => site.id).join('|'), () => form.targetSites.join('|')],
  () => {
    selectedSiteId.value = resolvePreferredSiteId()
  },
  { immediate: true },
)

watch(
  [() => form.categoryBangumi, () => form.categoryNyaa],
  () => {
    syncCategoriesIntoSiteFields()
  },
  { immediate: true },
)

function applyWorkspace(nextWorkspace: SeriesProjectWorkspace) {
  workspace.value = nextWorkspace
  selectedEpisodeId.value =
    nextWorkspace.activeEpisodeId ??
    (nextWorkspace.episodes.some(item => item.id === selectedEpisodeId.value) ? selectedEpisodeId.value : null) ??
    nextWorkspace.episodes[0]?.id ??
    null
}

function readEpisodeContent(config?: Config.PublishConfig | null) {
  if (!config || !config.content || typeof config.content !== 'object' || Array.isArray(config.content)) {
    return {} as Partial<Config.Content_episode>
  }
  return config.content as Partial<Config.Content_episode>
}

function composePublishTitle() {
  const team = form.releaseTeam.trim()
  const mainTitle =
    form.seriesTitleEN.trim() || form.seriesTitleCN.trim() || form.seriesTitleJP.trim() || props.project.name
  const seasonLabel = form.seasonLabel.trim()
  const episodeLabel = activeEpisode.value?.episodeLabel?.trim() ?? ''
  const techLabel = [
    form.sourceType.trim(),
    form.resolution.trim(),
    form.videoCodec.trim(),
    form.audioCodec.trim(),
    activeVariant.value?.name?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(' / ')

  let title = [team ? `[${team}]` : '', mainTitle, seasonLabel].filter(Boolean).join(' ')
  if (episodeLabel) {
    title = title ? `${title} - ${episodeLabel}` : episodeLabel
  }
  if (techLabel) {
    title = title ? `${title} [${techLabel}]` : `[${techLabel}]`
  }
  return title.slice(0, 128)
}

function buildConfigFromForm() {
  const targetSites = sortSiteIds(form.targetSites)
  const siteFieldDefaults = buildSiteFieldDefaultsPayload()
  const bodyMarkdown = normalizeMarkdown(form.bodyMarkdown).trim()

  return {
    torrentName: getFileName(form.torrentPath.trim()),
    torrentPath: form.torrentPath.trim(),
    category_bangumi: form.categoryBangumi,
    category_nyaa: form.categoryNyaa,
    siteFieldDefaults: Object.keys(siteFieldDefaults).length ? siteFieldDefaults : undefined,
    tags: deepClone(storedTags.value),
    content: {
      seriesTitleCN: form.seriesTitleCN.trim(),
      seriesTitleEN: form.seriesTitleEN.trim(),
      seriesTitleJP: form.seriesTitleJP.trim(),
      seasonLabel: form.seasonLabel.trim() || undefined,
      episodeLabel: activeEpisode.value?.episodeLabel ?? '',
      episodeTitle: activeEpisode.value?.episodeTitle?.trim() || undefined,
      releaseTeam: form.releaseTeam.trim(),
      sourceType: form.sourceType.trim(),
      resolution: form.resolution.trim(),
      videoCodec: form.videoCodec.trim(),
      audioCodec: form.audioCodec.trim(),
      summary: form.summary.trim(),
      targetSites,
    } satisfies Config.Content_episode,
    completed: form.completed,
    information: form.information.trim(),
    remake: form.remake,
    title: form.titleOverride.trim() || composePublishTitle(),
    sourceKind: draftConfig.value?.sourceKind,
    targetSites,
    bodyTemplate: bodyMarkdown || undefined,
    bodyTemplateFormat: bodyMarkdown ? 'md' : undefined,
  } satisfies Config.PublishConfig
}

function buildDirtyFingerprint() {
  return JSON.stringify(buildConfigFromForm())
}

function initializeFormFromConfig(config: Config.PublishConfig) {
  const content = readEpisodeContent(config)
  const siteFieldDefaults = normalizeSiteFieldDefaults(config.siteFieldDefaults)

  form.seriesTitleCN = normalizeOptionalString(content.seriesTitleCN)
  form.seriesTitleEN = normalizeOptionalString(content.seriesTitleEN)
  form.seriesTitleJP = normalizeOptionalString(content.seriesTitleJP)
  form.seasonLabel = normalizeOptionalString(content.seasonLabel)
  form.releaseTeam = normalizeOptionalString(content.releaseTeam)
  form.sourceType = normalizeOptionalString(content.sourceType)
  form.resolution = normalizeOptionalString(content.resolution)
  form.videoCodec = normalizeOptionalString(content.videoCodec)
  form.audioCodec = normalizeOptionalString(content.audioCodec)
  form.summary = normalizeOptionalString(content.summary)
  form.information = normalizeOptionalString(config.information)
  form.torrentPath = normalizeOptionalString(config.torrentPath)
  form.targetSites = sortSiteIds(config.targetSites ?? content.targetSites ?? [])
  form.siteFieldDefaults = siteFieldDefaults
  form.bodyMarkdown = normalizeMarkdown(config.bodyTemplate || content.summary || '')
  form.categoryBangumi =
    normalizeOptionalString(config.category_bangumi) ||
    normalizeOptionalString(siteFieldDefaults.bangumi?.category_bangumi) ||
    DEFAULT_BANGUMI_CATEGORY
  form.categoryNyaa =
    normalizeOptionalString(config.category_nyaa) ||
    normalizeOptionalString(siteFieldDefaults.nyaa?.category_nyaa) ||
    DEFAULT_NYAA_CATEGORY
  form.completed = config.completed === true
  form.remake = config.remake === true
  storedTags.value = Array.isArray(config.tags) ? deepClone(config.tags) : []

  const savedTitle = normalizeOptionalString(config.title)
  form.titleOverride = ''
  const recommendedTitle = composePublishTitle()
  form.titleOverride = savedTitle && savedTitle !== recommendedTitle ? savedTitle : ''
  syncCategoriesIntoSiteFields()
  selectedSiteId.value = resolvePreferredSiteId()
}

async function loadDraftConfig() {
  const config = await taskBridge.getPublishConfig(props.id)
  draftConfig.value = config
  initializeFormFromConfig(config)
  savedFingerprint.value = buildDirtyFingerprint()
}

async function refreshWorkspaceOnly() {
  const result = await projectBridge.getSeriesWorkspace(props.id)
  if (!result.ok) {
    ElMessage.error(result.error.message)
    return false
  }
  applyWorkspace(result.data.workspace)
  return true
}

async function loadWorkspacePage() {
  isLoading.value = true
  loadError.value = ''

  try {
    const [workspaceResult, sitesResult] = await Promise.all([
      projectBridge.getSeriesWorkspace(props.id),
      siteBridge.listSites(),
    ])

    if (!workspaceResult.ok) {
      loadError.value = workspaceResult.error.message
      return
    }

    if (sitesResult.ok) {
      siteCatalog.value = sitesResult.data.sites
    } else {
      siteCatalog.value = []
      ElMessage.warning(sitesResult.error.message)
    }

    applyWorkspace(workspaceResult.data.workspace)
    await loadDraftConfig()
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

async function pickTorrentFile() {
  const response = await window.globalAPI.getFilePath(JSON.stringify({ type: 'torrent' }))
  const payload = JSON.parse(response) as Message.Global.Path
  if (payload.path) {
    form.torrentPath = payload.path
  }
}

function openWorkingDirectory() {
  window.globalAPI.openFolder(JSON.stringify({ path: props.project.workingDirectory }))
}

function focusSite(siteId: SiteId) {
  selectedSiteId.value = siteId
  if (!form.targetSites.includes(siteId)) {
    form.targetSites = sortSiteIds([...form.targetSites, siteId])
  }
}

function removeTargetSite(siteId: SiteId) {
  form.targetSites = form.targetSites.filter(item => item !== siteId)
  if (selectedSiteId.value === siteId) {
    selectedSiteId.value = resolvePreferredSiteId()
  }
}

async function persistDraft(options?: { quiet?: boolean; refresh?: boolean }) {
  if (!activeVariant.value) {
    if (!options?.quiet) {
      ElMessage.warning('先在右侧打开一个版本，当前页的编辑内容都绑定到版本。')
    }
    return false
  }

  isSaving.value = true
  try {
    const nextConfig = buildConfigFromForm()
    const result = JSON.parse(
      await window.taskAPI.saveConfig(JSON.stringify({ id: props.id, config: nextConfig })),
    ) as Message.Task.Result

    if (!result.result.includes('success')) {
      ElMessage.error(result.result)
      return false
    }

    draftConfig.value = nextConfig
    savedFingerprint.value = JSON.stringify(nextConfig)
    if (options?.refresh !== false) {
      await refreshWorkspaceOnly()
    }
    if (!options?.quiet) {
      ElMessage.success('已保存当前版本草稿')
    }
    return true
  } finally {
    isSaving.value = false
  }
}

async function ensureDraftSavedBeforeSwitch() {
  if (!isDirty.value) {
    return true
  }
  return persistDraft({ quiet: true, refresh: false })
}

function getVariantKey(episodeId: number, variantId: number) {
  return `${episodeId}:${variantId}`
}

async function activateVariant(
  episode: SeriesProjectEpisode,
  variant: SeriesProjectVariant,
  options?: { skipAutoSave?: boolean; successMessage?: string },
) {
  selectedEpisodeId.value = episode.id

  if (workspace.value?.activeEpisodeId === episode.id && workspace.value?.activeVariantId === variant.id) {
    return
  }

  if (!options?.skipAutoSave) {
    const canContinue = await ensureDraftSavedBeforeSwitch()
    if (!canContinue) {
      return
    }
  }

  switchingVariantKey.value = getVariantKey(episode.id, variant.id)
  try {
    const result = await projectBridge.activateSeriesVariant({
      projectId: props.id,
      episodeId: episode.id,
      variantId: variant.id,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    await loadDraftConfig()
    if (options?.successMessage) {
      ElMessage.success(options.successMessage)
    }
  } finally {
    switchingVariantKey.value = ''
  }
}

function resetEpisodeForm() {
  episodeForm.episodeLabel = ''
  episodeForm.episodeTitle = ''
}

function resetVariantForm() {
  variantForm.name = ''
  variantForm.videoProfile = '1080p'
  variantForm.subtitleProfile = 'chs'
}

async function createEpisode() {
  const episodeLabel = episodeForm.episodeLabel.trim()
  if (!episodeLabel) {
    ElMessage.warning('请先填写集号')
    return
  }

  isCreatingEpisode.value = true
  try {
    const result = await projectBridge.createSeriesEpisode({
      projectId: props.id,
      episodeLabel,
      episodeTitle: episodeForm.episodeTitle.trim() || undefined,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    selectedEpisodeId.value = result.data.episode.id
    episodeDialogVisible.value = false
    variantDialogVisible.value = true
    resetEpisodeForm()
    ElMessage.success(`已建立第 ${result.data.episode.episodeLabel} 集`)
  } finally {
    isCreatingEpisode.value = false
  }
}

async function createVariant() {
  if (!selectedEpisode.value) {
    ElMessage.warning('请先选择一集，再新增版本')
    return
  }

  isCreatingVariant.value = true
  try {
    const result = await projectBridge.createSeriesVariant({
      projectId: props.id,
      episodeId: selectedEpisode.value.id,
      name: variantForm.name.trim() || undefined,
      videoProfile: variantForm.videoProfile,
      subtitleProfile: variantForm.subtitleProfile,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    variantDialogVisible.value = false
    resetVariantForm()
    await activateVariant(selectedEpisode.value, result.data.variant, {
      skipAutoSave: true,
      successMessage: `已切换到版本 ${result.data.variant.name}`,
    })
  } finally {
    isCreatingVariant.value = false
  }
}

function getPreviousEpisode(episodeId: number) {
  const orderedEpisodes = [...episodes.value].sort((left, right) => left.sortIndex - right.sortIndex)
  const index = orderedEpisodes.findIndex(episode => episode.id === episodeId)
  if (index <= 0) {
    return null
  }
  return orderedEpisodes[index - 1] ?? null
}

async function inheritPreviousEpisodeVariants() {
  if (!selectedEpisode.value) {
    ElMessage.warning('请先选择一集')
    return
  }
  if (!getPreviousEpisode(selectedEpisode.value.id)) {
    ElMessage.warning('当前这一集前面没有可继承的上一集')
    return
  }

  isInheritingVariants.value = true
  try {
    const result = await projectBridge.inheritSeriesEpisodeVariants({
      projectId: props.id,
      episodeId: selectedEpisode.value.id,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    ElMessage.success(`已从上一集继承 ${result.data.copiedCount} 个版本`)
  } finally {
    isInheritingVariants.value = false
  }
}

async function duplicateVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  duplicatingVariantKey.value = getVariantKey(episode.id, variant.id)
  try {
    const result = await projectBridge.duplicateSeriesVariant({
      projectId: props.id,
      episodeId: episode.id,
      variantId: variant.id,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    await activateVariant(episode, result.data.variant, {
      skipAutoSave: true,
      successMessage: `已复制并切换到 ${result.data.variant.name}`,
    })
  } finally {
    duplicatingVariantKey.value = ''
  }
}

async function removeVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除第 ${episode.episodeLabel} 集的版本「${variant.name}」吗？`,
    '删除版本',
    {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    },
  ).catch(() => false)

  if (!confirmed) {
    return
  }

  removingVariantKey.value = getVariantKey(episode.id, variant.id)
  try {
    const result = await projectBridge.removeSeriesVariant({
      projectId: props.id,
      episodeId: episode.id,
      variantId: variant.id,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    if (workspace.value?.activeVariantId) {
      await loadDraftConfig()
    }
    ElMessage.success(`已删除版本 ${variant.name}`)
  } finally {
    removingVariantKey.value = ''
  }
}

async function prepareReview() {
  if (!activeVariant.value || !activeEpisode.value) {
    ElMessage.warning('先在右侧打开一个版本，再进入检查发布')
    return
  }
  if (!form.torrentPath.trim()) {
    ElMessage.warning('请先选择当前版本的 .torrent 文件')
    return
  }
  if (!form.targetSites.length) {
    ElMessage.warning('请先选择至少一个目标站点')
    return
  }

  isPreparingReview.value = true
  try {
    const nextConfig = buildConfigFromForm()
    const result = JSON.parse(
      await window.taskAPI.createConfig(
        JSON.stringify({
          id: props.id,
          type: 'episode',
          config: nextConfig,
        }),
      ),
    ) as Message.Task.Result

    if (!result.result.includes('success')) {
      ElMessage.error(result.result)
      return
    }

    draftConfig.value = nextConfig
    savedFingerprint.value = JSON.stringify(nextConfig)
    await refreshWorkspaceOnly()
    ElMessage.success('当前版本已经整理完成，正在进入检查发布页')
    await router.push({
      name: 'check',
      params: { id: props.id },
    })
  } finally {
    isPreparingReview.value = false
  }
}

function getVariantSiteLabels(variant: SeriesProjectVariant) {
  return (variant.targetSites ?? []).map(siteId => getSiteLabel(siteId)).join(' / ')
}

function getVariantProgressSummary(variant: SeriesProjectVariant) {
  return summarizeTargetSiteProgress(variant.targetSites, variant.publishResults)
}

onMounted(() => {
  window.taskAPI.setTaskProcess(JSON.stringify({ id: props.id, step: 'edit' }))
  void loadWorkspacePage()
  window.projectAPI.refreshProjectData(loadWorkspacePage)
})
</script>

<template>
  <div class="series-studio" v-loading="isLoading">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />

    <template v-else>
      <section class="series-studio__hero">
        <div class="series-studio__hero-copy">
          <div class="series-studio__eyebrow">剧集模式工作台</div>
          <h2 class="series-studio__hero-title">{{ props.project.name }}</h2>
          <p class="series-studio__hero-text">
            一个剧是一个项目，一集是项目里的子项目，一个版本是该集下面的分支。当前页只编辑当前打开的版本，发布时也只会按这个版本批量投递到目标站点。
          </p>
          <div class="series-studio__hero-meta">
            <StatusChip tone="info">{{ currentStructureLabel }}</StatusChip>
            <StatusChip tone="warning">{{ episodes.length }} 集</StatusChip>
            <StatusChip tone="success">{{ totalVariantCount }} 个版本</StatusChip>
            <StatusChip v-if="isDirty" tone="warning">有未保存修改</StatusChip>
          </div>
        </div>

        <div class="series-studio__hero-actions">
          <el-button plain @click="openWorkingDirectory">
            <el-icon><FolderOpened /></el-icon>
            <span>打开项目目录</span>
          </el-button>
          <el-button plain @click="loadWorkspacePage">
            <el-icon><RefreshRight /></el-icon>
            <span>刷新工作台</span>
          </el-button>
        </div>
      </section>

      <div class="series-studio__layout">
        <main class="series-studio__main">
          <section class="series-studio__section">
            <div class="series-studio__section-head">
              <div>
                <div class="series-studio__section-eyebrow">第二排</div>
                <h3 class="series-studio__section-title">选择站点</h3>
                <p class="series-studio__section-text">
                  这里只展示已经登录并验证通过的站点。点一下就会加入当前版本的目标站点，并在下一排出现该站点的填写项。
                </p>
              </div>
              <StatusChip tone="info">{{ form.targetSites.length }} 个目标站点</StatusChip>
            </div>

            <div v-if="activeVariant" class="series-studio__site-grid">
              <article
                v-for="site in availableSites"
                :key="site.id"
                :class="[
                  'series-studio__site-card',
                  {
                    'is-target': form.targetSites.includes(site.id),
                    'is-focused': selectedSiteId === site.id,
                  },
                ]"
                @click="focusSite(site.id)"
              >
                <div class="series-studio__site-head">
                  <div>
                    <div class="series-studio__site-name">{{ site.name }}</div>
                    <div class="series-studio__site-text">
                      {{ site.accountMessage || '账号有效，可直接加入当前版本的批量发布目标。' }}
                    </div>
                  </div>
                  <StatusChip :tone="form.targetSites.includes(site.id) ? 'success' : 'neutral'">
                    {{ form.targetSites.includes(site.id) ? '已加入' : '待选择' }}
                  </StatusChip>
                </div>

                <div class="series-studio__site-actions">
                  <el-button
                    v-if="!form.targetSites.includes(site.id)"
                    type="primary"
                    plain
                    size="small"
                    @click.stop="focusSite(site.id)"
                  >
                    加入当前版本
                  </el-button>
                  <el-button v-else plain size="small" @click.stop="removeTargetSite(site.id)">移出目标</el-button>
                </div>
              </article>
            </div>

            <div v-else class="series-studio__empty">
              先在右侧打开一个版本，站点选择和正文编辑都会绑定到这个版本。
            </div>

            <div v-if="unavailableSelectedSites.length" class="series-studio__tip">
              当前草稿里还有这些站点，但它们现在没有通过登录检查：{{
                unavailableSelectedSites.map(siteId => getSiteLabel(siteId)).join(' / ')
              }}
            </div>
          </section>

          <section class="series-studio__section">
            <div class="series-studio__section-head">
              <div>
                <div class="series-studio__section-eyebrow">第三排</div>
                <h3 class="series-studio__section-title">
                  {{ selectedSite?.name ? `${selectedSite.name} 填写项` : '站点填写项' }}
                </h3>
                <p class="series-studio__section-text">
                  这里只编辑当前选中站点的字段，保存后只影响当前版本，不会把整部剧所有版本一起改掉。
                </p>
              </div>
            </div>

            <div v-if="activeVariant && selectedSite" class="series-studio__field-grid">
              <article v-if="selectedSiteFields.length === 0" class="series-studio__empty">
                这个站点当前没有额外填写项，选中后可以直接参与当前版本的批量发布。
              </article>

              <label v-for="field in selectedSiteFields" :key="field.key" class="series-studio__field">
                <span class="series-studio__field-label">
                  {{ resolveSiteFieldLabel(field) }}
                  <span v-if="field.mode === 'required'" class="series-studio__required">必填</span>
                </span>

                <el-select
                  v-if="field.control === 'select'"
                  :model-value="readCurrentSiteFieldValue(field)"
                  clearable
                  :placeholder="resolveSiteFieldPlaceholder(field)"
                  @update:model-value="value => updateCurrentSiteFieldValue(field, value)"
                >
                  <el-option
                    v-for="option in field.options ?? []"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>

                <el-input
                  v-else-if="field.control === 'text'"
                  :model-value="readCurrentSiteFieldValue(field)"
                  :placeholder="resolveSiteFieldPlaceholder(field)"
                  @update:model-value="value => updateCurrentSiteFieldValue(field, value)"
                />

                <el-input-number
                  v-else-if="field.control === 'number'"
                  :model-value="readCurrentSiteFieldValue(field)"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step ?? 1"
                  :controls="false"
                  @update:model-value="value => updateCurrentSiteFieldValue(field, value)"
                />

                <div v-else class="series-studio__switch-row">
                  <el-switch
                    :model-value="Boolean(readCurrentSiteFieldValue(field))"
                    @update:model-value="value => updateCurrentSiteFieldValue(field, value)"
                  />
                  <span class="series-studio__field-text">保存这个布尔开关到当前版本。</span>
                </div>

                <span class="series-studio__field-help">{{ resolveSiteFieldHelp(field) }}</span>
              </label>
            </div>

            <div v-else class="series-studio__empty">
              先选一个版本，再从上一排点一个站点，这里才会出现对应站点的填写项。
            </div>
          </section>

          <section class="series-studio__section">
            <div class="series-studio__section-head">
              <div>
                <div class="series-studio__section-eyebrow">第四排</div>
                <h3 class="series-studio__section-title">正文编辑器</h3>
                <p class="series-studio__section-text">
                  富文本使用 Tiptap，同时提供源码和预览切换。你也可以导入本地现成的 Markdown 文档，挑中之后直接载入到当前版本正文。
                </p>
              </div>
            </div>

            <SeriesRichTextEditor
              v-if="activeVariant"
              v-model="form.bodyMarkdown"
              placeholder="这里写当前版本的完整发布正文。"
            />

            <div v-else class="series-studio__empty">
              先在右侧打开一个版本，正文编辑器才会绑定到这个版本。
            </div>
          </section>
        </main>

        <aside class="series-studio__aside">
          <section class="series-studio__panel">
            <div class="series-studio__panel-head">
              <div>
                <div class="series-studio__panel-eyebrow">项目结构</div>
                <h3 class="series-studio__panel-title">项目 / 集 / 版本</h3>
                <p class="series-studio__panel-text">
                  这里是三级结构浏览器。先建集，再给每一集建立不同版本分支。
                </p>
              </div>
              <div class="series-studio__panel-actions">
                <el-button plain @click="episodeDialogVisible = true">
                  <el-icon><CirclePlus /></el-icon>
                  <span>新增剧集</span>
                </el-button>
                <el-button plain :disabled="!selectedEpisode" @click="variantDialogVisible = true">
                  <el-icon><Plus /></el-icon>
                  <span>新增版本</span>
                </el-button>
              </div>
            </div>

            <div class="series-studio__episode-strip">
              <button
                v-for="episode in episodes"
                :key="episode.id"
                type="button"
                :class="['series-studio__episode-chip', { 'is-active': selectedEpisode?.id === episode.id }]"
                @click="selectedEpisodeId = episode.id"
              >
                <span class="series-studio__episode-chip-title">第 {{ episode.episodeLabel }} 集</span>
                <span class="series-studio__episode-chip-text">
                  {{ episode.episodeTitle || '未填写分集标题' }} · {{ episode.variantCount }} 个版本
                </span>
              </button>
            </div>

            <div v-if="selectedEpisode" class="series-studio__episode-actions">
              <StatusChip tone="info">
                {{ selectedEpisode.episodeTitle || `第 ${selectedEpisode.episodeLabel} 集` }}
              </StatusChip>
              <el-button
                plain
                :disabled="!getPreviousEpisode(selectedEpisode.id)"
                :loading="isInheritingVariants"
                @click="inheritPreviousEpisodeVariants"
              >
                从上一集继承版本
              </el-button>
            </div>

            <div v-if="selectedEpisode?.variants.length" class="series-studio__variant-list">
              <article
                v-for="variant in selectedEpisode.variants"
                :key="variant.id"
                :class="[
                  'series-studio__variant-card',
                  {
                    'is-active': activeEpisode?.id === selectedEpisode.id && activeVariant?.id === variant.id,
                  },
                ]"
              >
                <div class="series-studio__variant-head">
                  <div>
                    <div class="series-studio__variant-name">{{ variant.name }}</div>
                    <div class="series-studio__variant-text">
                      {{ getVariantSiteLabels(variant) || '尚未设置目标站点' }}
                    </div>
                  </div>
                  <div class="series-studio__variant-status">
                    <StatusChip
                      v-if="activeEpisode?.id === selectedEpisode.id && activeVariant?.id === variant.id"
                      tone="success"
                    >
                      当前草稿
                    </StatusChip>
                    <StatusChip v-if="variant.videoProfile" tone="info">{{ variant.videoProfile }}</StatusChip>
                    <StatusChip v-if="variant.subtitleProfile" tone="warning">{{ variant.subtitleProfile }}</StatusChip>
                  </div>
                </div>

                <div class="series-studio__variant-progress">
                  <StatusChip v-if="getVariantProgressSummary(variant).publishedSiteIds.length" tone="success">
                    已发 {{ getVariantProgressSummary(variant).publishedSiteIds.length }}
                  </StatusChip>
                  <StatusChip v-if="getVariantProgressSummary(variant).pendingSiteIds.length" tone="warning">
                    待发 {{ getVariantProgressSummary(variant).pendingSiteIds.length }}
                  </StatusChip>
                  <StatusChip v-if="getVariantProgressSummary(variant).failedSiteIds.length" tone="danger">
                    失败 {{ getVariantProgressSummary(variant).failedSiteIds.length }}
                  </StatusChip>
                </div>

                <div class="series-studio__variant-foot">
                  <div class="series-studio__variant-text">
                    最近更新 {{ formatProjectTimestamp(variant.updatedAt) }}
                  </div>
                  <div class="series-studio__variant-buttons">
                    <el-button
                      type="primary"
                      plain
                      size="small"
                      :loading="switchingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                      @click="activateVariant(selectedEpisode, variant, { successMessage: `已切换到 ${variant.name}` })"
                    >
                      <el-icon><SwitchButton /></el-icon>
                      <span>打开</span>
                    </el-button>
                    <el-button
                      plain
                      size="small"
                      :loading="duplicatingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                      @click="duplicateVariant(selectedEpisode, variant)"
                    >
                      <el-icon><DocumentCopy /></el-icon>
                      <span>复制</span>
                    </el-button>
                    <el-button
                      text
                      type="danger"
                      size="small"
                      :loading="removingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                      @click="removeVariant(selectedEpisode, variant)"
                    >
                      <el-icon><Delete /></el-icon>
                      <span>删除</span>
                    </el-button>
                  </div>
                </div>
              </article>
            </div>

            <div v-else class="series-studio__empty">
              {{ selectedEpisode ? '这一集还没有版本分支，先给它新增一个版本。' : '还没有剧集，先从第一集开始。' }}
            </div>
          </section>

          <section class="series-studio__panel">
            <div class="series-studio__panel-head">
              <div>
                <div class="series-studio__panel-eyebrow">剧目信息</div>
                <h3 class="series-studio__panel-title">系列标题与摘要</h3>
                <p class="series-studio__panel-text">
                  这里写当前剧的基础信息。底层仍然按版本保存，所以建议先把第一版写好，后续版本复制或继承它。
                </p>
              </div>
            </div>

            <template v-if="activeVariant">
              <div class="series-studio__compact-grid">
                <label class="series-studio__field">
                  <span class="series-studio__field-label">中文标题</span>
                  <el-input v-model="form.seriesTitleCN" placeholder="可选" />
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">英文标题</span>
                  <el-input v-model="form.seriesTitleEN" placeholder="推荐填写" />
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">日文标题</span>
                  <el-input v-model="form.seriesTitleJP" placeholder="可选" />
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">季 / 篇章</span>
                  <el-input v-model="form.seasonLabel" placeholder="例如 Season 2 / Final Season" />
                </label>
              </div>

              <label class="series-studio__field">
                <span class="series-studio__field-label">当前分集</span>
                <div class="series-studio__static-value">
                  {{
                    activeEpisode
                      ? `第 ${activeEpisode.episodeLabel} 集 · ${activeEpisode.episodeTitle || '未填写分集标题'}`
                      : '未激活版本'
                  }}
                </div>
              </label>

              <label class="series-studio__field">
                <span class="series-studio__field-label">摘要</span>
                <el-input
                  v-model="form.summary"
                  type="textarea"
                  resize="none"
                  :rows="5"
                  placeholder="这里写剧集摘要、版本差异说明或者给站点字段复用的短说明。"
                />
              </label>
            </template>

            <div v-else class="series-studio__empty">打开一个版本之后，这里的剧目信息会绑定到当前版本草稿。</div>
          </section>

          <section class="series-studio__panel">
            <div class="series-studio__panel-head">
              <div>
                <div class="series-studio__panel-eyebrow">版本资料</div>
                <h3 class="series-studio__panel-title">种子、规格与发布动作</h3>
                <p class="series-studio__panel-text">
                  当前页只处理一个版本。保存和检查发布也是针对当前版本，不会把整部剧所有版本一次性塞进去。
                </p>
              </div>
            </div>

            <template v-if="activeVariant">
              <label class="series-studio__field">
                <span class="series-studio__field-label">当前版本</span>
                <div class="series-studio__static-value">{{ currentStructureLabel }}</div>
              </label>

              <label class="series-studio__field">
                <span class="series-studio__field-label">.torrent 文件</span>
                <el-input v-model="form.torrentPath" placeholder="选择当前版本对应的 .torrent 文件">
                  <template #append>
                    <el-button @click="pickTorrentFile">
                      <el-icon><UploadFilled /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </label>

              <div class="series-studio__compact-grid">
                <label class="series-studio__field">
                  <span class="series-studio__field-label">发布组</span>
                  <el-input v-model="form.releaseTeam" placeholder="可选" />
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">来源类型</span>
                  <el-select v-model="form.sourceType" clearable placeholder="可选">
                    <el-option v-for="option in SOURCE_OPTIONS" :key="option" :label="option" :value="option" />
                  </el-select>
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">分辨率</span>
                  <el-select v-model="form.resolution" clearable placeholder="可选">
                    <el-option v-for="option in RESOLUTION_OPTIONS" :key="option" :label="option" :value="option" />
                  </el-select>
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">视频编码</span>
                  <el-select v-model="form.videoCodec" clearable placeholder="可选">
                    <el-option v-for="option in VIDEO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
                  </el-select>
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">音频编码</span>
                  <el-select v-model="form.audioCodec" clearable placeholder="可选">
                    <el-option v-for="option in AUDIO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
                  </el-select>
                </label>
                <label class="series-studio__field">
                  <span class="series-studio__field-label">Information 链接</span>
                  <el-input v-model="form.information" placeholder="可选" />
                </label>
              </div>

              <label class="series-studio__field">
                <span class="series-studio__field-label">标题覆盖</span>
                <el-input v-model="form.titleOverride" placeholder="留空就使用下方自动生成标题" />
              </label>

              <div class="series-studio__preview-card">
                <div class="series-studio__preview-label">自动生成标题</div>
                <div class="series-studio__preview-value">{{ autoTitle || '当前信息还不足以生成标题' }}</div>
              </div>

              <div class="series-studio__switches">
                <el-checkbox v-model="form.completed">标记为完结</el-checkbox>
                <el-checkbox v-model="form.remake">标记为重制</el-checkbox>
              </div>

              <div class="series-studio__progress-note">
                <StatusChip v-if="currentProgress.publishedSiteIds.length" tone="success">
                  已发 {{ currentProgress.publishedSiteIds.length }}
                </StatusChip>
                <StatusChip v-if="currentProgress.pendingSiteIds.length" tone="warning">
                  待发 {{ currentProgress.pendingSiteIds.length }}
                </StatusChip>
                <StatusChip v-if="currentProgress.failedSiteIds.length" tone="danger">
                  失败 {{ currentProgress.failedSiteIds.length }}
                </StatusChip>
              </div>

              <div class="series-studio__savebar">
                <div class="series-studio__savebar-copy">
                  <div class="series-studio__savebar-title">版本级保存与发布</div>
                  <div class="series-studio__savebar-text">
                    保存只会回写当前版本草稿。进入检查发布页后，也只会针对这个版本按站点批量执行。
                  </div>
                </div>
                <div class="series-studio__savebar-actions">
                  <el-button plain :loading="isSaving" @click="persistDraft()">保存当前版本</el-button>
                  <el-button type="primary" :loading="isPreparingReview" @click="prepareReview">
                    进入检查发布
                  </el-button>
                </div>
              </div>
            </template>

            <div v-else class="series-studio__empty">
              先从右侧打开一个版本，再给这个版本选择种子、站点和正文。
            </div>
          </section>

          <section class="series-studio__panel series-studio__panel--tip">
            <div class="series-studio__note">
              <el-icon><Share /></el-icon>
              <span>现在的批量发布语义已经收束成“单版本批量投递到多站点”。</span>
            </div>
          </section>
        </aside>
      </div>

      <el-dialog v-model="episodeDialogVisible" title="新增剧集" width="26rem" destroy-on-close>
        <div class="series-studio__dialog-grid">
          <label class="series-studio__field">
            <span class="series-studio__field-label">集号</span>
            <el-input v-model="episodeForm.episodeLabel" placeholder="例如 01 / 02 / SP1" />
          </label>
          <label class="series-studio__field">
            <span class="series-studio__field-label">分集标题</span>
            <el-input v-model="episodeForm.episodeTitle" placeholder="可选" />
          </label>
        </div>
        <template #footer>
          <el-button @click="episodeDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="isCreatingEpisode" @click="createEpisode">建立剧集</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="variantDialogVisible" title="新增版本分支" width="28rem" destroy-on-close>
        <div class="series-studio__dialog-grid">
          <label class="series-studio__field">
            <span class="series-studio__field-label">版本名</span>
            <el-input v-model="variantForm.name" placeholder="可选，不填则自动生成" />
          </label>
          <label class="series-studio__field">
            <span class="series-studio__field-label">视频规格</span>
            <el-select v-model="variantForm.videoProfile">
              <el-option label="1080p" value="1080p" />
              <el-option label="2160p" value="2160p" />
              <el-option label="custom" value="custom" />
            </el-select>
          </label>
          <label class="series-studio__field">
            <span class="series-studio__field-label">字幕规格</span>
            <el-select v-model="variantForm.subtitleProfile">
              <el-option label="chs" value="chs" />
              <el-option label="cht" value="cht" />
              <el-option label="eng" value="eng" />
              <el-option label="bilingual" value="bilingual" />
              <el-option label="custom" value="custom" />
            </el-select>
          </label>
        </div>
        <template #footer>
          <el-button @click="variantDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="isCreatingVariant" @click="createVariant">建立版本</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.series-studio {
  display: grid;
  gap: 18px;
}

.series-studio__hero,
.series-studio__section,
.series-studio__panel {
  border: 1px solid var(--border-soft);
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 42%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.series-studio__hero,
.series-studio__section,
.series-studio__panel {
  padding: 22px;
}

.series-studio__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px 24px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--brand-soft) 88%, white 12%), transparent 30%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--accent-soft) 80%, white 20%), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
}

.series-studio__hero-copy,
.series-studio__section-head,
.series-studio__panel-head,
.series-studio__savebar-copy {
  display: grid;
  gap: 10px;
}

.series-studio__eyebrow,
.series-studio__section-eyebrow,
.series-studio__panel-eyebrow,
.series-studio__field-label,
.series-studio__preview-label,
.series-studio__savebar-title {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.series-studio__hero-title,
.series-studio__section-title,
.series-studio__panel-title {
  margin: 0;
  font-family: var(--font-display);
  color: var(--text-primary);
  letter-spacing: -0.04em;
}

.series-studio__hero-title {
  font-size: clamp(1.8rem, 3vw, 2.5rem);
  line-height: 1.02;
}

.series-studio__section-title,
.series-studio__panel-title {
  font-size: 1.24rem;
  line-height: 1.08;
}

.series-studio__hero-text,
.series-studio__section-text,
.series-studio__panel-text,
.series-studio__site-text,
.series-studio__field-help,
.series-studio__field-text,
.series-studio__static-value,
.series-studio__empty,
.series-studio__tip,
.series-studio__episode-chip-text,
.series-studio__variant-text,
.series-studio__savebar-text,
.series-studio__note,
.series-studio__preview-value {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.series-studio__hero-meta,
.series-studio__hero-actions,
.series-studio__panel-actions,
.series-studio__episode-actions,
.series-studio__variant-status,
.series-studio__variant-buttons,
.series-studio__savebar-actions,
.series-studio__progress-note,
.series-studio__switches,
.series-studio__site-actions,
.series-studio__note {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.series-studio__hero-actions {
  justify-content: flex-end;
  align-items: flex-start;
}

.series-studio__layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(21rem, 0.86fr);
  gap: 18px;
  align-items: start;
}

.series-studio__main,
.series-studio__aside,
.series-studio__episode-strip,
.series-studio__variant-list,
.series-studio__dialog-grid {
  display: grid;
  gap: 18px;
}

.series-studio__site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 12px;
}

.series-studio__field-grid,
.series-studio__compact-grid {
  display: grid;
  gap: 14px;
}

.series-studio__field-grid {
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.series-studio__compact-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__episode-chip,
.series-studio__preview-card {
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__preview-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.series-studio__site-card,
.series-studio__episode-chip {
  cursor: pointer;
}

.series-studio__site-card,
.series-studio__episode-chip,
.series-studio__variant-card {
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.series-studio__site-card:hover,
.series-studio__episode-chip:hover,
.series-studio__variant-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-soft));
}

.series-studio__site-card.is-target,
.series-studio__episode-chip.is-active,
.series-studio__variant-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__site-card.is-focused {
  box-shadow: 0 18px 30px rgba(198, 90, 46, 0.08);
}

.series-studio__site-head,
.series-studio__variant-head,
.series-studio__variant-foot,
.series-studio__section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.series-studio__site-name,
.series-studio__variant-name,
.series-studio__episode-chip-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.series-studio__field {
  display: grid;
  gap: 8px;
}

.series-studio__field :deep(.el-input-number) {
  width: 100%;
}

.series-studio__required {
  margin-left: 8px;
  color: var(--warning);
  font-size: 11px;
  letter-spacing: normal;
}

.series-studio__switch-row,
.series-studio__savebar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.series-studio__savebar {
  justify-content: space-between;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-soft));
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__episode-chip {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  text-align: left;
}

.series-studio__variant-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-studio__variant-buttons {
  justify-content: flex-end;
}

.series-studio__tip,
.series-studio__empty {
  padding: 14px 16px;
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__tip {
  border: 1px dashed color-mix(in srgb, var(--warning) 30%, var(--border-soft));
  background: color-mix(in srgb, var(--warning-soft) 84%, white 16%);
}

.series-studio__panel--tip {
  padding: 18px 22px;
}

@media (max-width: 1260px) {
  .series-studio__layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .series-studio__hero,
  .series-studio__compact-grid,
  .series-studio__field-grid,
  .series-studio__savebar {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .series-studio__hero,
  .series-studio__section-head,
  .series-studio__site-head,
  .series-studio__variant-head,
  .series-studio__variant-foot,
  .series-studio__savebar,
  .series-studio__hero-actions,
  .series-studio__panel-actions,
  .series-studio__variant-buttons,
  .series-studio__savebar-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .series-studio__hero-actions :deep(.el-button),
  .series-studio__panel-actions :deep(.el-button),
  .series-studio__variant-buttons :deep(.el-button),
  .series-studio__savebar-actions :deep(.el-button) {
    width: 100%;
  }

  .series-studio__hero,
  .series-studio__section,
  .series-studio__panel {
    padding: 18px;
  }
}
</style>
