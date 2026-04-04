<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete,
  DocumentCopy,
  FolderOpened,
  RefreshRight,
  SwitchButton,
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
  SeriesTitleMatchConfig,
  SeriesTitleTagMapping,
  SeriesProjectVariant,
  SeriesProjectWorkspace,
} from '../../types/project'
import type { BangumiSubjectSearchItem, SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'
import {
  applySeriesTitleTagTemplateVariables,
  composeSeriesPublishTitle,
  getDefaultSeriesTitleTagTemplate,
  matchSeriesTitlePattern,
  normalizeMatchedSubtitleProfile,
  normalizeMatchedVideoProfile,
  normalizeSeriesTitleMatchConfig,
  resolveSeriesTitleMappedTagBindings,
  renderSeriesTitleTemplate,
  stripTorrentExtension,
} from '../../../../shared/utils/series-title-match'
import SeriesRichTextEditor from './SeriesRichTextEditor.vue'

const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
const DEFAULT_BANGUMI_CATEGORY = '549ef207fe682f7549f1ea90'
const DEFAULT_NYAA_CATEGORY = '1_3'
const DEFAULT_TITLE_TAG_TEMPLATE = getDefaultSeriesTitleTagTemplate()

type SiteFieldValue = string | number | boolean | undefined
type SiteFieldForm = Partial<Record<SiteId, Record<string, SiteFieldValue>>>
let titleTagMappingSeed = 0

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
const isSavingTitleMatch = ref(false)
const isImportingMatchedTorrents = ref(false)
const isPreparingReview = ref(false)
const selectedEpisodeId = ref<number | null>(null)
const loadError = ref('')
const switchingVariantKey = ref('')
const duplicatingVariantKey = ref('')
const removingVariantKey = ref('')
const savedFingerprint = ref('')
const bangumiSearchQuery = ref('')
const bangumiSearchResults = ref<BangumiSubjectSearchItem[]>([])
const bangumiSearchLoading = ref(false)
const bangumiSearchError = ref('')
const selectedBangumiSubject = ref<BangumiSubjectSearchItem | null>(null)

const titleMatchForm = reactive<SeriesTitleMatchConfig>({
  fileNamePattern: '',
  episodeTemplate: '<ep>',
  variantTemplate: '<res>p-<sub>',
  titleTemplate: '',
  releaseTeamTemplate: '',
  sourceTypeTemplate: '<source>',
  resolutionTemplate: '<res>p',
  videoCodecTemplate: '<video>',
  audioCodecTemplate: '<audio>',
  subtitleTemplate: '<sub>',
  titleTagMappings: [],
  targetSites: [],
})
const savedTitleMatchFingerprint = ref('')

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

function createTitleTagMapping(value?: Partial<SeriesTitleTagMapping>): SeriesTitleTagMapping {
  titleTagMappingSeed += 1
  return {
    id: value?.id?.trim() || `title-tag-${Date.now()}-${titleTagMappingSeed}`,
    keyword: value?.keyword?.trim() || '',
    templateToken: value?.templateToken?.trim() || DEFAULT_TITLE_TAG_TEMPLATE,
    label: value?.label?.trim() || '',
  }
}

function normalizeTitleTagMappings(value: SeriesTitleTagMapping[] | undefined) {
  return (value ?? []).map(item => createTitleTagMapping(item))
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
  return resolveLocaleText(field.helpKey, field.mode === 'required' ? '\u8be5\u5b57\u6bb5\u4e3a\u5fc5\u586b' : '\u8be5\u5b57\u6bb5\u4e3a\u9009\u586b')
}

function resolveSiteFieldPlaceholder(field: SiteFieldSchemaEntry) {
  return resolveLocaleText(field.placeholderKey, `\u586b\u5199${resolveSiteFieldLabel(field)}`)
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

function normalizeTitleMatchForm(config?: SeriesTitleMatchConfig | null) {
  const normalized = normalizeSeriesTitleMatchConfig(config) ?? {
    fileNamePattern: '',
    episodeTemplate: '<ep>',
    variantTemplate: '<res>p-<sub>',
    titleTemplate: '',
    releaseTeamTemplate: '',
    sourceTypeTemplate: '<source>',
    resolutionTemplate: '<res>p',
    videoCodecTemplate: '<video>',
    audioCodecTemplate: '<audio>',
    subtitleTemplate: '<sub>',
    titleTagMappings: [],
    targetSites: [],
  }

  titleMatchForm.fileNamePattern = normalized.fileNamePattern
  titleMatchForm.episodeTemplate = normalized.episodeTemplate || '<ep>'
  titleMatchForm.variantTemplate = normalized.variantTemplate || '<res>p-<sub>'
  titleMatchForm.titleTemplate = normalized.titleTemplate || ''
  titleMatchForm.releaseTeamTemplate = normalized.releaseTeamTemplate || ''
  titleMatchForm.sourceTypeTemplate = normalized.sourceTypeTemplate || '<source>'
  titleMatchForm.resolutionTemplate = normalized.resolutionTemplate || '<res>p'
  titleMatchForm.videoCodecTemplate = normalized.videoCodecTemplate || '<video>'
  titleMatchForm.audioCodecTemplate = normalized.audioCodecTemplate || '<audio>'
  titleMatchForm.subtitleTemplate = normalized.subtitleTemplate || '<sub>'
  titleMatchForm.titleTagMappings = normalizeTitleTagMappings(normalized.titleTagMappings)
  titleMatchForm.targetSites = sortSiteIds(normalized.targetSites ?? [])
  savedTitleMatchFingerprint.value = buildTitleMatchFingerprint()
}

function addTitleTagMapping() {
  titleMatchForm.titleTagMappings = [...(titleMatchForm.titleTagMappings ?? []), createTitleTagMapping()]
}

function removeTitleTagMapping(mappingId: string | undefined) {
  titleMatchForm.titleTagMappings = (titleMatchForm.titleTagMappings ?? []).filter(item => item.id !== mappingId)
}

function buildTitleMatchPayload() {
  return normalizeSeriesTitleMatchConfig({
    ...titleMatchForm,
    targetSites: sortSiteIds(titleMatchForm.targetSites ?? []),
  })
}

function buildTitleMatchFingerprint() {
  return JSON.stringify(buildTitleMatchPayload() ?? {})
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
const selectedBangumiSiteIds = computed(() =>
  selectedSiteFieldSections.value
    .filter(section => section.fields.some(field => field.key === 'bangumiId'))
    .map(section => section.site.id),
)
const selectedBangumiSites = computed(() =>
  selectedBangumiSiteIds.value
    .map(siteId => availableSites.value.find(site => site.id === siteId) ?? null)
    .filter((site): site is SiteCatalogEntry => Boolean(site)),
)
const unavailableSelectedSites = computed(() =>
  form.targetSites.filter(siteId => !availableSites.value.some(site => site.id === siteId)),
)

const currentProgress = computed(() =>
  summarizeTargetSiteProgress(form.targetSites, activeVariant.value?.publishResults),
)

const currentStructureLabel = computed(() =>
  activeEpisode.value && activeVariant.value
    ? `\u7b2c ${activeEpisode.value.episodeLabel} \u96c6 / ${activeVariant.value.name}`
    : '\u8fd8\u6ca1\u6709\u6253\u5f00\u7248\u672c',
)

const isDirty = computed(() => Boolean(draftConfig.value && activeVariant.value && buildDirtyFingerprint() !== savedFingerprint.value))
const isTitleMatchDirty = computed(() => buildTitleMatchFingerprint() !== savedTitleMatchFingerprint.value)

function buildTitleTagSourceTexts(payload: {
  fileName?: string
  variables?: Record<string, string>
  episodeLabel?: string
  variantName?: string
  releaseTeam?: string
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
  subtitle?: string
}) {
  return [
    payload.fileName,
    ...Object.values(payload.variables ?? {}),
    payload.episodeLabel,
    payload.variantName,
    payload.releaseTeam,
    payload.sourceType,
    payload.resolution,
    payload.videoCodec,
    payload.audioCodec,
    payload.subtitle,
  ]
}

const titleMatchPreview = computed(() => {
  const config = buildTitleMatchPayload()
  const currentFileName = form.torrentPath.trim() ? getFileName(form.torrentPath.trim()) : ''
  if (!config?.fileNamePattern || !currentFileName) {
    return null
  }

  const variables = matchSeriesTitlePattern(config.fileNamePattern, currentFileName)
  if (!variables) {
    return {
      fileName: currentFileName,
      matched: false as const,
    }
  }

  const episodeLabel = renderSeriesTitleTemplate(config.episodeTemplate || '<ep>', variables)
  const variantName = renderSeriesTitleTemplate(config.variantTemplate || '<res>p-<sub>', variables)
  const sourceType = renderSeriesTitleTemplate(config.sourceTypeTemplate, variables)
  const resolution = renderSeriesTitleTemplate(config.resolutionTemplate, variables)
  const videoCodec = renderSeriesTitleTemplate(config.videoCodecTemplate, variables)
  const audioCodec = renderSeriesTitleTemplate(config.audioCodecTemplate, variables)
  const subtitle = renderSeriesTitleTemplate(config.subtitleTemplate, variables)
  const releaseTeam = renderSeriesTitleTemplate(config.releaseTeamTemplate, variables)
  const titleTagBindings = resolveSeriesTitleMappedTagBindings(
    config.titleTagMappings,
    buildTitleTagSourceTexts({
      fileName: currentFileName,
      variables,
      episodeLabel,
      variantName,
      releaseTeam,
      sourceType,
      resolution,
      videoCodec,
      audioCodec,
      subtitle,
    }),
  )
  const titleVariables = applySeriesTitleTagTemplateVariables(variables, titleTagBindings)
  const title = renderSeriesTitleTemplate(config.titleTemplate, titleVariables)
  const suggestedTitle =
    title ||
    composeSeriesPublishTitle({
      releaseTeam: releaseTeam || form.releaseTeam.trim(),
      mainTitle: form.seriesTitleEN.trim() || form.seriesTitleCN.trim() || form.seriesTitleJP.trim() || props.project.name,
      seasonLabel: form.seasonLabel.trim(),
      episodeLabel,
      sourceType,
      resolution,
      videoCodec,
      audioCodec,
      variantName,
    })

  return {
    fileName: currentFileName,
    matched: true as const,
    variables,
    episodeLabel,
    variantName: variantName || stripTorrentExtension(currentFileName),
    title,
    titleTags: titleTagBindings.flatMap(binding => binding.labels),
    titleTagBindings,
    suggestedTitle,
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
    videoProfile: normalizeMatchedVideoProfile(resolution),
    subtitleProfile: normalizeMatchedSubtitleProfile(subtitle),
  }
})

const matchedTitleMatchPreview = computed(() =>
  titleMatchPreview.value?.matched ? titleMatchPreview.value : null,
)

const unmatchedTitleMatchPreview = computed(() =>
  titleMatchPreview.value && !titleMatchPreview.value.matched ? titleMatchPreview.value : null,
)

watch(
  [() => form.categoryBangumi, () => form.categoryNyaa],
  () => {
    syncCategoriesIntoSiteFields()
  },
  { immediate: true },
)

watch(selectedBangumiSiteIds, (siteIds) => {
  if (siteIds.length) {
    return
  }

  bangumiSearchResults.value = []
  bangumiSearchError.value = ''
  selectedBangumiSubject.value = null
})

function applyWorkspace(nextWorkspace: SeriesProjectWorkspace) {
  workspace.value = nextWorkspace
  normalizeTitleMatchForm(nextWorkspace.titleMatchConfig)
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

function composePublishTitle(options?: {
  releaseTeam?: string
  episodeLabel?: string
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
  variantName?: string
}) {
  return composeSeriesPublishTitle({
    releaseTeam: options?.releaseTeam ?? form.releaseTeam.trim(),
    mainTitle: form.seriesTitleEN.trim() || form.seriesTitleCN.trim() || form.seriesTitleJP.trim() || props.project.name,
    seasonLabel: form.seasonLabel.trim(),
    episodeLabel: options?.episodeLabel ?? activeEpisode.value?.episodeLabel?.trim() ?? '',
    sourceType: options?.sourceType ?? form.sourceType.trim(),
    resolution: options?.resolution ?? form.resolution.trim(),
    videoCodec: options?.videoCodec ?? form.videoCodec.trim(),
    audioCodec: options?.audioCodec ?? form.audioCodec.trim(),
    variantName: options?.variantName ?? activeVariant.value?.name?.trim() ?? '',
  })
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

function openWorkingDirectory() {
  window.globalAPI.openFolder(JSON.stringify({ path: props.project.workingDirectory }))
}

async function saveTitleMatchConfig() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('\u8bf7\u5148\u586b\u5199\u6587\u4ef6\u540d\u5339\u914d\u89c4\u5219')
    return false
  }

  isSavingTitleMatch.value = true
  try {
    const result = await projectBridge.saveSeriesTitleMatchConfig({
      projectId: props.id,
      config,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return false
    }

    applyWorkspace(result.data.workspace)
    ElMessage.success('\u6807\u9898\u5339\u914d\u65b9\u6848\u5df2\u4fdd\u5b58')
    return true
  } finally {
    isSavingTitleMatch.value = false
  }
}

async function importMatchedTorrents() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('\u8bf7\u5148\u586b\u5199\u6587\u4ef6\u540d\u5339\u914d\u89c4\u5219')
    return
  }

  if (isTitleMatchDirty.value) {
    const saved = await saveTitleMatchConfig()
    if (!saved) {
      return
    }
  }

  const response = await window.globalAPI.getFilePaths(JSON.stringify({ type: 'torrent' }))
  const payload = JSON.parse(response) as Message.Global.Paths
  if (!payload.paths.length) {
    return
  }

  isImportingMatchedTorrents.value = true
  try {
    const result = await projectBridge.importSeriesMatchedTorrents({
      projectId: props.id,
      filePaths: payload.paths,
      activateFirst: true,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    applyWorkspace(result.data.workspace)
    await loadDraftConfig()

    const importSummary = `\u5df2\u8bc6\u522b ${result.data.importedCount} \u4e2a .torrent\uff0c\u65b0\u589e ${result.data.createdEpisodeCount} \u96c6\uff0c${result.data.createdVariantCount} \u4e2a\u7248\u672c`
    const updatedSummary = result.data.updatedVariantCount
      ? `\uff0c\u66f4\u65b0 ${result.data.updatedVariantCount} \u4e2a\u5df2\u6709\u7248\u672c`
      : ''

    if (result.data.unmatchedFiles.length) {
      const unmatchedNames = result.data.unmatchedFiles.map(item => item.fileName).slice(0, 3).join(' / ')
      const unmatchedSuffix = result.data.unmatchedFiles.length > 3 ? '\u7b49' : ''
      ElMessage.warning(
        `${importSummary}${updatedSummary}\uff0c\u8fd8\u6709 ${result.data.unmatchedFiles.length} \u4e2a\u6587\u4ef6\u672a\u5339\u914d\uff1a${unmatchedNames}${unmatchedSuffix}`,
      )
    } else {
      ElMessage.success(`${importSummary}${updatedSummary}`)
    }
  } finally {
    isImportingMatchedTorrents.value = false
  }
}

function writeBangumiIdToSite(siteId: SiteId, bangumiId: number) {
  const bangumiField = getEditableSiteFields(siteId).find(field => field.key === 'bangumiId')
  if (bangumiField) {
    updateSiteFieldValue(siteId, bangumiField, bangumiId)
    return
  }

  ensureSiteFieldEntry(siteId).bangumiId = bangumiId
}

async function searchBangumiSubjects() {
  const query = bangumiSearchQuery.value.trim()
  if (!query) {
    ElMessage.warning('\u8bf7\u5148\u8f93\u5165 Bangumi \u6761\u76ee\u540d')
    return
  }

  bangumiSearchLoading.value = true
  bangumiSearchError.value = ''
  selectedBangumiSubject.value = null
  try {
    const result = await siteBridge.searchBangumiSubjects(query, 8)
    if (!result.ok) {
      bangumiSearchResults.value = []
      bangumiSearchError.value = result.error.message
      return
    }

    bangumiSearchResults.value = result.data.items
    if (!result.data.items.length) {
      bangumiSearchError.value = '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684 Bangumi \u6761\u76ee'
    }
  } finally {
    bangumiSearchLoading.value = false
  }
}

function applyBangumiSubject(subject: BangumiSubjectSearchItem) {
  if (!selectedBangumiSiteIds.value.length) {
    ElMessage.warning('\u5f53\u524d\u6ca1\u6709\u9700\u8981\u586b\u5199 Bangumi ID \u7684\u7ad9\u70b9')
    return
  }

  selectedBangumiSiteIds.value.forEach(siteId => {
    writeBangumiIdToSite(siteId, subject.id)
  })
  selectedBangumiSubject.value = subject
  bangumiSearchQuery.value = subject.nameCn || subject.name

  const siteNames = selectedBangumiSites.value.map(site => site.name).join(' / ')
  ElMessage.success(`\u5df2\u628a Bangumi ID #${subject.id} \u56de\u586b\u5230 ${siteNames}`)
}

function addTargetSite(siteId: SiteId) {
  if (form.targetSites.includes(siteId)) {
    return
  }

  form.targetSites = sortSiteIds([...form.targetSites, siteId])
}

function removeTargetSite(siteId: SiteId) {
  form.targetSites = form.targetSites.filter(item => item !== siteId)
}

async function persistDraft(options?: { quiet?: boolean; refresh?: boolean }) {
  if (!activeVariant.value) {
    if (!options?.quiet) {
      ElMessage.warning('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u7248\u672c')
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
      ElMessage.success('\u5f53\u524d\u7248\u672c\u5df2\u4fdd\u5b58')
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
      successMessage: `\u5df2\u590d\u5236\u7248\u672c\u5e76\u5207\u6362\u5230 ${result.data.variant.name}`,
    })
  } finally {
    duplicatingVariantKey.value = ''
  }
}

async function removeVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const confirmed = await ElMessageBox.confirm(
    `\u786e\u5b9a\u5220\u9664\u7b2c ${episode.episodeLabel} \u96c6\u7684\u7248\u672c\u300c${variant.name}\u300d\u5417\uff1f`,
    '\u5220\u9664\u7248\u672c',
    {
      type: 'warning',
      confirmButtonText: '\u5220\u9664',
      cancelButtonText: '\u53d6\u6d88',
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
    ElMessage.success(`\u5df2\u5220\u9664\u7248\u672c ${variant.name}`)
  } finally {
    removingVariantKey.value = ''
  }
}

async function prepareReview() {
  if (!activeVariant.value || !activeEpisode.value) {
    ElMessage.warning('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u7248\u672c\uff0c\u518d\u8fdb\u5165\u68c0\u67e5\u53d1\u5e03')
    return
  }
  if (!form.torrentPath.trim()) {
    ElMessage.warning('\u8bf7\u5148\u9009\u62e9\u5f53\u524d\u7248\u672c\u7684 .torrent \u6587\u4ef6')
    return
  }
  if (!form.targetSites.length) {
    ElMessage.warning('\u8bf7\u5148\u9009\u62e9\u81f3\u5c11\u4e00\u4e2a\u76ee\u6807\u7ad9\u70b9')
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
    ElMessage.success('\u5f53\u524d\u7248\u672c\u5df2\u6574\u7406\u5b8c\u6210\uff0c\u6b63\u5728\u8fdb\u5165\u68c0\u67e5\u53d1\u5e03\u9875')
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
      <section class="series-studio__section series-studio__section--primary">
        <div class="series-studio__headline">
          <div class="series-studio__title-block">
            <h2 class="series-studio__hero-title">{{ props.project.name }}</h2>
            <div class="series-studio__hero-meta">
              <StatusChip tone="info">{{ currentStructureLabel }}</StatusChip>
              <StatusChip tone="warning">{{ episodes.length }} {{ '\u96c6' }}</StatusChip>
              <StatusChip tone="success">{{ totalVariantCount }} {{ '\u4e2a\u7248\u672c' }}</StatusChip>
              <StatusChip v-if="currentProgress.publishedSiteIds.length" tone="success">
                {{ '\u5df2\u53d1' }} {{ currentProgress.publishedSiteIds.length }}
              </StatusChip>
              <StatusChip v-if="currentProgress.pendingSiteIds.length" tone="warning">
                {{ '\u5f85\u53d1' }} {{ currentProgress.pendingSiteIds.length }}
              </StatusChip>
              <StatusChip v-if="currentProgress.failedSiteIds.length" tone="danger">
                {{ '\u5931\u8d25' }} {{ currentProgress.failedSiteIds.length }}
              </StatusChip>
              <StatusChip v-if="isDirty" tone="warning">{{ '\u672a\u4fdd\u5b58\u66f4\u6539' }}</StatusChip>
            </div>
          </div>

          <div class="series-studio__hero-actions">
            <el-button plain @click="openWorkingDirectory">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ '\u6253\u5f00\u9879\u76ee\u76ee\u5f55' }}</span>
            </el-button>
            <el-button plain @click="loadWorkspacePage">
              <el-icon><RefreshRight /></el-icon>
              <span>{{ '\u5237\u65b0' }}</span>
            </el-button>
            <el-button plain :disabled="!activeVariant" :loading="isSaving" @click="persistDraft()">
              {{ '\u4fdd\u5b58\u5f53\u524d\u7248\u672c' }}
            </el-button>
            <el-button type="primary" :disabled="!activeVariant" :loading="isPreparingReview" @click="prepareReview">
              {{ '\u8fdb\u5165\u68c0\u67e5\u53d1\u5e03' }}
            </el-button>
          </div>
        </div>

        <article class="series-studio__match-card">
          <div class="series-studio__section-head">
            <div>
              <h3 class="series-studio__section-title">{{ '\u6807\u9898\u5339\u914d\u81ea\u52a8\u8bc6\u522b' }}</h3>
              <p class="series-studio__match-text">
                {{ '\u5148\u628a\u6587\u4ef6\u540d\u91cc\u7684\u5173\u952e\u4fe1\u606f\u6620\u5c04\u6210\u53d8\u91cf\uff0c\u540e\u9762\u5bfc\u5165 .torrent \u65f6\u5c31\u4f1a\u81ea\u52a8\u5efa\u5267\u96c6\u3001\u5efa\u7248\u672c\uff0c\u5e76\u56de\u586b\u6807\u9898\u548c\u53c2\u6570\u3002' }}
              </p>
            </div>
            <div class="series-studio__hero-meta">
              <StatusChip tone="info">{{ '\u53c2\u8003 OKPGUI \u601d\u8def' }}</StatusChip>
              <StatusChip v-if="isTitleMatchDirty" tone="warning">{{ '\u5339\u914d\u65b9\u6848\u672a\u4fdd\u5b58' }}</StatusChip>
            </div>
          </div>

          <div class="series-studio__match-grid">
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">{{ '\u6587\u4ef6\u540d\u5339\u914d' }}</span>
              <el-input
                v-model="titleMatchForm.fileNamePattern"
                placeholder="[SweetSub] Oniichan ha Oshimai! - <ep> [<source>][<res>P][<video>][<sub>]"
              />
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u5267\u96c6\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.episodeTemplate" placeholder="<ep>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u7248\u672c\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.variantTemplate" placeholder="<res>p-<sub>" />
            </label>
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">{{ '\u4e3b\u6807\u9898\u6a21\u677f' }}</span>
              <el-input
                v-model="titleMatchForm.titleTemplate"
                placeholder="[SweetSub][\u756a\u5267\u540d][<ep>][<source>][<res>P][<video>][<sub>]"
              />
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u6765\u6e90\u7c7b\u578b\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.sourceTypeTemplate" placeholder="<source>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u5206\u8fa8\u7387\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.resolutionTemplate" placeholder="<res>p" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u89c6\u9891\u7f16\u7801\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.videoCodecTemplate" placeholder="<video>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u97f3\u9891\u7f16\u7801\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.audioCodecTemplate" placeholder="<audio>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u5b57\u5e55\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.subtitleTemplate" placeholder="<sub>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u5236\u4f5c\u7ec4\u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.releaseTeamTemplate" placeholder="<team>" />
            </label>
          </div>

          <article class="series-studio__mapping-card">
            <div class="series-studio__site-fields-head">
              <div>
                <div class="series-studio__site-name">{{ '\u6807\u9898\u6807\u7b7e\u6620\u5c04' }}</div>
                <div class="series-studio__site-text">
                  {{ '\u6bcf\u6761\u89c4\u5219\u90fd\u53ef\u4ee5\u81ea\u5df1\u6307\u5b9a\u4e00\u4e2a\u6a21\u677f\u8bcd\u3002\u68c0\u6d4b\u5230\u88ab\u6620\u5c04\u8bcd\u540e\uff0c\u5c31\u4f1a\u628a\u6620\u5c04\u7ed3\u679c\u5199\u8fdb\u5bf9\u5e94\u7684\u6a21\u677f\u8bcd\uff0c\u4f60\u53ea\u9700\u5728\u4e3b\u6807\u9898\u6a21\u677f\u91cc\u81ea\u5df1\u6446\u653e\u4f4d\u7f6e\u3002' }}
                </div>
              </div>
              <div class="series-studio__site-actions">
                <el-button plain size="small" @click="addTitleTagMapping">{{ '\u65b0\u589e\u6620\u5c04' }}</el-button>
              </div>
            </div>

            <div v-if="titleMatchForm.titleTagMappings?.length" class="series-studio__mapping-stack">
              <div
                v-for="mapping in titleMatchForm.titleTagMappings"
                :key="mapping.id"
                class="series-studio__mapping-row"
              >
                <el-input v-model="mapping.keyword" :placeholder="'\u68c0\u6d4b\u8bcd\uff0c\u4f8b\u5982 ASSx2'" />
                <el-input v-model="mapping.templateToken" :placeholder="'\u6a21\u677f\u8bcd\uff0c\u4f8b\u5982 <subtag>'" />
                <el-input v-model="mapping.label" :placeholder="'\u6807\u9898\u6807\u7b7e\uff0c\u4f8b\u5982 \u7b80\u7e41\u65e5\u5185\u5c01'" />
                <el-button text type="danger" @click="removeTitleTagMapping(mapping.id)">{{ '\u5220\u9664' }}</el-button>
              </div>
            </div>

            <div v-else class="series-studio__empty">
              {{ '\u6682\u65f6\u8fd8\u6ca1\u6709\u6620\u5c04\u89c4\u5219\uff0c\u53ef\u4ee5\u5148\u52a0\u4e00\u6761\uff0c\u6bd4\u5982 ASSx2 -> <subtag> -> \u7b80\u7e41\u65e5\u5185\u5c01\u3002' }}
            </div>
          </article>

          <div v-if="titleMatchPreview" class="series-studio__match-preview">
            <template v-if="matchedTitleMatchPreview">
              <StatusChip tone="success">{{ '\u5f53\u524d torrent \u53ef\u5339\u914d' }}</StatusChip>
              <span class="series-studio__match-text">
                {{ matchedTitleMatchPreview.fileName }} -> {{ matchedTitleMatchPreview.episodeLabel || '??' }} / {{ matchedTitleMatchPreview.variantName }}
              </span>
              <StatusChip v-if="matchedTitleMatchPreview.sourceType" tone="neutral">{{ matchedTitleMatchPreview.sourceType }}</StatusChip>
              <StatusChip v-if="matchedTitleMatchPreview.resolution" tone="info">{{ matchedTitleMatchPreview.resolution }}</StatusChip>
              <StatusChip v-if="matchedTitleMatchPreview.videoCodec" tone="info">{{ matchedTitleMatchPreview.videoCodec }}</StatusChip>
              <StatusChip v-if="matchedTitleMatchPreview.audioCodec" tone="neutral">{{ matchedTitleMatchPreview.audioCodec }}</StatusChip>
              <StatusChip v-if="matchedTitleMatchPreview.videoProfile" tone="info">{{ matchedTitleMatchPreview.videoProfile }}</StatusChip>
              <StatusChip v-if="matchedTitleMatchPreview.subtitleProfile" tone="warning">{{ matchedTitleMatchPreview.subtitleProfile }}</StatusChip>
              <StatusChip
                v-for="titleTag in matchedTitleMatchPreview.titleTags"
                :key="`${matchedTitleMatchPreview.fileName}-${titleTag}`"
                tone="success"
              >
                {{ titleTag }}
              </StatusChip>
              <span
                v-for="binding in matchedTitleMatchPreview.titleTagBindings"
                :key="`${matchedTitleMatchPreview.fileName}-${binding.templateToken}`"
                class="series-studio__match-text"
              >
                {{ '\u6a21\u677f\u8bcd\uff1a' }}{{ binding.templateToken }} {{ '\u2192' }} {{ binding.value }}
              </span>
              <span v-if="matchedTitleMatchPreview.suggestedTitle" class="series-studio__match-text">
                {{ matchedTitleMatchPreview.title ? '\u6a21\u677f\u6807\u9898\uff1a' : '\u9884\u89c8\u6807\u9898\uff1a' }}{{ matchedTitleMatchPreview.suggestedTitle }}
              </span>
            </template>
            <template v-else-if="unmatchedTitleMatchPreview">
              <StatusChip tone="danger">{{ '\u5f53\u524d torrent \u672a\u547d\u4e2d' }}</StatusChip>
              <span class="series-studio__match-text">
                {{ unmatchedTitleMatchPreview.fileName }} {{ '\u6ca1\u6709\u547d\u4e2d\u6587\u4ef6\u540d\u5339\u914d\u89c4\u5219\u3002' }}
              </span>
            </template>
          </div>

          <div class="series-studio__match-actions">
            <el-button plain :loading="isSavingTitleMatch" @click="saveTitleMatchConfig">{{ '\u4fdd\u5b58\u5339\u914d\u65b9\u6848' }}</el-button>
            <el-button type="primary" :loading="isImportingMatchedTorrents" @click="importMatchedTorrents">
              {{ '\u5bfc\u5165 .torrent \u81ea\u52a8\u8bc6\u522b' }}
            </el-button>
          </div>
        </article>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <div>
            <h3 class="series-studio__section-title">{{ '\u5206\u96c6\u7248\u672c' }}</h3>
            <p class="series-studio__site-text">{{ '\u8fd9\u91cc\u53ea\u4fdd\u7559\u5267\u96c6\u4e0e\u7248\u672c\u5207\u6362\uff0c\u7b2c\u4e00\u6392\u4e0d\u518d\u653e\u90a3\u4e9b\u989d\u5916\u5b57\u6bb5\u3002' }}</p>
          </div>
          <div class="series-studio__hero-meta">
            <StatusChip tone="info">{{ episodes.length }} {{ '\u96c6' }}</StatusChip>
            <StatusChip tone="success">{{ totalVariantCount }} {{ '\u4e2a\u7248\u672c' }}</StatusChip>
            <StatusChip v-if="selectedEpisode" tone="info">
              {{ selectedEpisode.episodeTitle || `\u7b2c ${selectedEpisode.episodeLabel} \u96c6` }}
            </StatusChip>
          </div>
        </div>

        <div class="series-studio__workspace">
          <div class="series-studio__episode-strip">
            <button
              v-for="episode in episodes"
              :key="episode.id"
              type="button"
              :class="['series-studio__episode-chip', { 'is-active': selectedEpisode?.id === episode.id }]"
              @click="selectedEpisodeId = episode.id"
            >
              <span class="series-studio__episode-chip-title">{{ `\u7b2c ${episode.episodeLabel} \u96c6` }}</span>
              <span class="series-studio__episode-chip-text">
                {{ episode.episodeTitle || '\u672a\u586b\u5199\u5206\u96c6\u6807\u9898' }} / {{ episode.variantCount }} {{ '\u4e2a\u7248\u672c' }}
              </span>
            </button>
          </div>

          <div v-if="selectedEpisode?.variants.length" class="series-studio__variant-grid">
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
                    {{ getVariantSiteLabels(variant) || '\u5c1a\u672a\u8bbe\u7f6e\u76ee\u6807\u7ad9\u70b9' }}
                  </div>
                </div>
                <div class="series-studio__variant-status">
                  <StatusChip
                    v-if="activeEpisode?.id === selectedEpisode.id && activeVariant?.id === variant.id"
                    tone="success"
                  >
                    {{ '\u5f53\u524d\u8349\u7a3f' }}
                  </StatusChip>
                  <StatusChip v-if="variant.videoProfile" tone="info">{{ variant.videoProfile }}</StatusChip>
                  <StatusChip v-if="variant.subtitleProfile" tone="warning">{{ variant.subtitleProfile }}</StatusChip>
                </div>
              </div>

              <div class="series-studio__variant-progress">
                <StatusChip v-if="getVariantProgressSummary(variant).publishedSiteIds.length" tone="success">
                  {{ '\u5df2\u53d1' }} {{ getVariantProgressSummary(variant).publishedSiteIds.length }}
                </StatusChip>
                <StatusChip v-if="getVariantProgressSummary(variant).pendingSiteIds.length" tone="warning">
                  {{ '\u5f85\u53d1' }} {{ getVariantProgressSummary(variant).pendingSiteIds.length }}
                </StatusChip>
                <StatusChip v-if="getVariantProgressSummary(variant).failedSiteIds.length" tone="danger">
                  {{ '\u5931\u8d25' }} {{ getVariantProgressSummary(variant).failedSiteIds.length }}
                </StatusChip>
              </div>

              <div class="series-studio__variant-foot">
                <div class="series-studio__variant-text">
                  {{ '\u6700\u8fd1\u66f4\u65b0' }} {{ formatProjectTimestamp(variant.updatedAt) }}
                </div>
                <div class="series-studio__variant-buttons">
                  <el-button
                    type="primary"
                    plain
                    size="small"
                    :loading="switchingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                    @click="activateVariant(selectedEpisode, variant, { successMessage: `\u5df2\u5207\u6362\u5230 ${variant.name}` })"
                  >
                    <el-icon><SwitchButton /></el-icon>
                    <span>{{ '\u6253\u5f00' }}</span>
                  </el-button>
                  <el-button
                    plain
                    size="small"
                    :loading="duplicatingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                    @click="duplicateVariant(selectedEpisode, variant)"
                  >
                    <el-icon><DocumentCopy /></el-icon>
                    <span>{{ '\u590d\u5236' }}</span>
                  </el-button>
                  <el-button
                    text
                    type="danger"
                    size="small"
                    :loading="removingVariantKey === getVariantKey(selectedEpisode.id, variant.id)"
                    @click="removeVariant(selectedEpisode, variant)"
                  >
                    <el-icon><Delete /></el-icon>
                    <span>{{ '\u5220\u9664' }}</span>
                  </el-button>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="series-studio__empty">
            {{ selectedEpisode ? '\u8fd9\u4e00\u96c6\u8fd8\u6ca1\u6709\u7248\u672c\uff0c\u5148\u5bfc\u5165\u4e00\u4e2a\u79cd\u5b50\u3002' : '\u8fd8\u6ca1\u6709\u5267\u96c6\uff0c\u5148\u5bfc\u5165\u79cd\u5b50\u521b\u5efa\u7b2c\u4e00\u96c6\u3002' }}
          </div>
        </div>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">{{ '\u9009\u62e9\u7ad9\u70b9' }}</h3>
          <StatusChip tone="info">{{ form.targetSites.length }} {{ '\u4e2a\u76ee\u6807\u7ad9\u70b9' }}</StatusChip>
        </div>

        <div v-if="activeVariant" class="series-studio__site-grid">
          <article
            v-for="site in availableSites"
            :key="site.id"
            :class="['series-studio__site-card', { 'is-target': form.targetSites.includes(site.id) }]"
            @click="form.targetSites.includes(site.id) ? removeTargetSite(site.id) : addTargetSite(site.id)"
          >
            <div class="series-studio__site-head">
              <div>
                <div class="series-studio__site-name">{{ site.name }}</div>
                <div class="series-studio__site-text">
                  {{ site.accountMessage || '\u8d26\u53f7\u6709\u6548\uff0c\u53ef\u76f4\u63a5\u52a0\u5165\u5f53\u524d\u7248\u672c' }}
                </div>
              </div>
              <StatusChip :tone="form.targetSites.includes(site.id) ? 'success' : 'neutral'">
                {{ form.targetSites.includes(site.id) ? '\u5df2\u9009\u62e9' : '\u672a\u9009\u62e9' }}
              </StatusChip>
            </div>

            <div class="series-studio__site-actions">
              <span class="series-studio__site-count">
                {{ getEditableSiteFields(site.id).length ? `${getEditableSiteFields(site.id).length} \u4e2a\u586b\u5199\u9879` : '\u65e0\u9700\u989d\u5916\u586b\u5199' }}
              </span>
              <el-button
                v-if="!form.targetSites.includes(site.id)"
                type="primary"
                plain
                size="small"
                @click.stop="addTargetSite(site.id)"
              >
                {{ '\u9009\u62e9\u7ad9\u70b9' }}
              </el-button>
              <el-button v-else plain size="small" @click.stop="removeTargetSite(site.id)">{{ '\u79fb\u51fa\u76ee\u6807' }}</el-button>
            </div>
          </article>
        </div>

        <div v-else class="series-studio__empty">{{ '\u5148\u6253\u5f00\u4e00\u4e2a\u7248\u672c\uff0c\u518d\u9009\u62e9\u7ad9\u70b9' }}</div>

        <div v-if="unavailableSelectedSites.length" class="series-studio__tip">
          {{ '\u5f53\u524d\u8349\u7a3f\u91cc\u8fd8\u6709\u8fd9\u4e9b\u7ad9\u70b9\uff0c\u4f46\u5b83\u4eec\u73b0\u5728\u6ca1\u6709\u901a\u8fc7\u767b\u5f55\u68c0\u67e5\uff1a' }}{{ unavailableSelectedSites.map(siteId => getSiteLabel(siteId)).join(' / ') }}
        </div>
      </section>
      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">{{ '\u7ad9\u70b9\u5b57\u6bb5' }}</h3>
          <StatusChip tone="info">{{ selectedSiteFieldSections.length }} {{ '\u4e2a\u7ad9\u70b9\u5c55\u5f00' }}</StatusChip>
        </div>

        <article v-if="selectedBangumiSites.length" class="series-studio__bangumi-card">
          <div class="series-studio__section-head">
            <div>
              <div class="series-studio__site-name">{{ 'Bangumi ID \u641c\u7d22' }}</div>
              <div class="series-studio__site-text">
                {{ '\u9009\u4e2d\u6761\u76ee\u540e\uff0c\u4f1a\u81ea\u52a8\u56de\u586b\u5230\u5f53\u524d\u5df2\u9009\u3001\u4e14\u9700\u8981 Bangumi ID \u7684\u7ad9\u70b9\u3002' }}
              </div>
            </div>
            <div class="series-studio__hero-meta">
              <StatusChip v-for="site in selectedBangumiSites" :key="site.id" tone="info">{{ site.name }}</StatusChip>
            </div>
          </div>

          <el-input
            v-model="bangumiSearchQuery"
            :placeholder="'\u8f93\u5165\u52a8\u753b\u540d\u3001\u539f\u540d\u6216\u522b\u540d'"
            @keyup.enter="searchBangumiSubjects"
          >
            <template #append>
              <el-button :loading="bangumiSearchLoading" @click="searchBangumiSubjects">
                {{ '\u641c\u7d22' }}
              </el-button>
            </template>
          </el-input>

          <div v-if="bangumiSearchError" class="series-studio__tip">
            {{ bangumiSearchError }}
          </div>

          <div v-if="bangumiSearchResults.length" class="series-studio__bangumi-results">
            <button
              v-for="subject in bangumiSearchResults"
              :key="subject.id"
              type="button"
              :class="['series-studio__bangumi-result', { 'is-selected': selectedBangumiSubject?.id === subject.id }]"
              @click="applyBangumiSubject(subject)"
            >
              <img
                v-if="subject.images?.grid || subject.images?.small"
                class="series-studio__bangumi-cover"
                :src="subject.images?.grid || subject.images?.small"
                :alt="subject.nameCn || subject.name"
              />
              <div class="series-studio__bangumi-body">
                <div class="series-studio__bangumi-title">
                  {{ subject.nameCn || subject.name }}
                  <span class="series-studio__bangumi-id">#{{ subject.id }}</span>
                </div>
                <div class="series-studio__bangumi-meta">
                  {{ subject.name }}
                </div>
                <div class="series-studio__bangumi-meta">
                  {{ subject.airDate || '\u65e5\u671f\u672a\u77e5' }}
                  <span v-if="subject.score"> / {{ '\u8bc4\u5206' }} {{ subject.score }}</span>
                  <span v-if="subject.rank"> / Rank {{ subject.rank }}</span>
                </div>
              </div>
            </button>
          </div>

          <div v-if="selectedBangumiSubject" class="series-studio__match-preview">
            <StatusChip tone="success">{{ '\u5df2\u9009\u6761\u76ee' }}</StatusChip>
            <span class="series-studio__match-text">
              {{ (selectedBangumiSubject.nameCn || selectedBangumiSubject.name) + ' / #' + selectedBangumiSubject.id }}
            </span>
          </div>
        </article>

        <div v-if="activeVariant && selectedSiteFieldSections.length" class="series-studio__site-field-stack">
          <article
            v-for="section in selectedSiteFieldSections"
            :key="section.site.id"
            class="series-studio__site-fields-card"
          >
            <div class="series-studio__site-fields-head">
              <div>
                <div class="series-studio__site-name">{{ section.site.name }}</div>
                <div class="series-studio__site-text">
                  {{ section.site.accountMessage || '\u5f53\u524d\u7248\u672c\u4f1a\u5e26\u7740\u8fd9\u4e9b\u7ad9\u70b9\u5b57\u6bb5\u4e00\u8d77\u4fdd\u5b58' }}
                </div>
              </div>
              <div class="series-studio__site-actions">
                <StatusChip :tone="section.fields.length ? 'info' : 'neutral'">
                  {{ section.fields.length ? `${section.fields.length} \u4e2a\u5b57\u6bb5` : '\u65e0\u9700\u989d\u5916\u586b\u5199' }}
                </StatusChip>
                <el-button plain size="small" @click="removeTargetSite(section.site.id)">{{ '\u79fb\u51fa\u76ee\u6807' }}</el-button>
              </div>
            </div>

            <div v-if="section.fields.length" class="series-studio__field-grid">
              <label v-for="field in section.fields" :key="field.key" class="series-studio__field">
                <span class="series-studio__field-label">
                  {{ resolveSiteFieldLabel(field) }}
                  <span v-if="field.mode === 'required'" class="series-studio__required">{{ '\u5fc5\u586b' }}</span>
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

                <div v-else class="series-studio__switch-row">
                  <el-switch
                    :model-value="Boolean(readSiteFieldValue(section.site.id, field))"
                    @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
                  />
                  <span class="series-studio__field-text">{{ '\u4fdd\u5b58\u5230\u5f53\u524d\u7248\u672c' }}</span>
                </div>

                <span class="series-studio__field-help">{{ resolveSiteFieldHelp(field) }}</span>
              </label>
            </div>

            <div v-else class="series-studio__empty">{{ '\u8fd9\u4e2a\u7ad9\u70b9\u6ca1\u6709\u989d\u5916\u586b\u5199\u9879\uff0c\u76f4\u63a5\u53d1\u5e03\u5373\u53ef\u3002' }}</div>
          </article>
        </div>

        <div v-else class="series-studio__empty">
          {{ activeVariant ? '\u4e0a\u9762\u9009\u62e9\u51e0\u4e2a\u7ad9\u70b9\uff0c\u8fd9\u91cc\u5c31\u5c55\u5f00\u51e0\u4e2a\u7ad9\u70b9\u7684\u586b\u5199\u9879\u3002' : '\u5148\u6253\u5f00\u4e00\u4e2a\u7248\u672c\uff0c\u518d\u9009\u62e9\u7ad9\u70b9\u5b57\u6bb5\u3002' }}
        </div>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">{{ '\u6b63\u6587\u7f16\u8f91' }}</h3>
          <StatusChip tone="info">{{ '\u5f53\u524d\u7248\u672c\u6240\u6709\u7ad9\u70b9\u5171\u7528\u4e00\u4efd\u6b63\u6587' }}</StatusChip>
        </div>

        <SeriesRichTextEditor
          v-if="activeVariant"
          v-model="form.bodyMarkdown"
          :placeholder="'\u8fd9\u91cc\u586b\u5199\u5f53\u524d\u7248\u672c\u7684\u5b8c\u6574\u53d1\u5e03\u6b63\u6587'"
        />

        <div v-else class="series-studio__empty">{{ '\u5148\u6253\u5f00\u4e00\u4e2a\u7248\u672c\uff0c\u6b63\u6587\u7f16\u8f91\u5668\u624d\u4f1a\u7ed1\u5b9a\u5230\u8fd9\u4e2a\u7248\u672c' }}</div>
      </section>

    </template>
  </div>
</template>

<style scoped>
.series-studio {
  display: grid;
  gap: 18px;
}

.series-studio__section {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--border-soft);
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 42%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.series-studio__section--primary {
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--brand-soft) 88%, white 12%), transparent 30%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--accent-soft) 80%, white 20%), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
}

.series-studio__match-card {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-soft));
  border-radius: 1.35rem;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--brand-soft) 70%, white 30%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 94%, white 6%);
}

.series-studio__mapping-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px dashed color-mix(in srgb, var(--accent) 24%, var(--border-soft));
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 94%, white 6%);
}

.series-studio__headline,
.series-studio__workspace,
.series-studio__title-block,
.series-studio__dialog-grid,
.series-studio__mapping-stack {
  display: grid;
  gap: 16px;
}

.series-studio__headline {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.series-studio__hero-title,
.series-studio__section-title {
  margin: 0;
  font-family: var(--font-display);
  color: var(--text-primary);
  letter-spacing: -0.04em;
}

.series-studio__hero-title {
  font-size: clamp(1.9rem, 3.2vw, 2.8rem);
  line-height: 1.02;
}

.series-studio__section-title {
  font-size: 1.2rem;
  line-height: 1.08;
}

.series-studio__field-label,
.series-studio__site-count {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.series-studio__site-text,
.series-studio__field-help,
.series-studio__field-text,
.series-studio__empty,
.series-studio__tip,
.series-studio__match-text,
.series-studio__episode-chip-text,
.series-studio__variant-text,
.series-studio__site-count {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.series-studio__hero-meta,
.series-studio__hero-actions,
.series-studio__workspace-actions,
.series-studio__match-actions,
.series-studio__match-preview,
.series-studio__variant-status,
.series-studio__variant-buttons,
.series-studio__site-actions,
.series-studio__section-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.series-studio__hero-actions,
.series-studio__section-head,
.series-studio__workspace-toolbar,
.series-studio__site-actions,
.series-studio__site-head,
.series-studio__site-fields-head,
.series-studio__variant-head,
.series-studio__variant-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.series-studio__episode-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-studio__variant-grid,
.series-studio__match-grid,
.series-studio__details-grid,
.series-studio__site-grid,
.series-studio__site-field-stack,
.series-studio__bangumi-results,
.series-studio__field-grid,
.series-studio__mapping-stack {
  display: grid;
  gap: 14px;
}

.series-studio__variant-grid {
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}

.series-studio__match-grid {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.series-studio__details-grid {
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}

.series-studio__site-grid {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.series-studio__field-grid {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.series-studio__bangumi-results {
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__episode-chip,
.series-studio__site-fields-card,
.series-studio__bangumi-card,
.series-studio__bangumi-result {
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__site-fields-card,
.series-studio__bangumi-card {
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
.series-studio__variant-card,
.series-studio__bangumi-result {
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.series-studio__site-card:hover,
.series-studio__episode-chip:hover,
.series-studio__variant-card:hover,
.series-studio__bangumi-result:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-soft));
}

.series-studio__site-card.is-target,
.series-studio__episode-chip.is-active,
.series-studio__variant-card.is-active,
.series-studio__site-fields-card,
.series-studio__bangumi-card,
.series-studio__bangumi-result.is-selected {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__episode-chip {
  display: grid;
  gap: 6px;
  min-width: 12rem;
  padding: 14px 16px;
  text-align: left;
}

.series-studio__site-name,
.series-studio__variant-name,
.series-studio__episode-chip-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.series-studio__bangumi-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
}

.series-studio__variant-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-studio__variant-status,
.series-studio__variant-buttons {
  justify-content: flex-end;
}

.series-studio__field {
  display: grid;
  gap: 8px;
}

.series-studio__mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.series-studio__bangumi-result {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  appearance: none;
  font: inherit;
}

.series-studio__bangumi-cover {
  width: 3.4rem;
  height: 4.8rem;
  border-radius: 0.9rem;
  object-fit: cover;
  flex: none;
  background: color-mix(in srgb, var(--brand-soft) 40%, white 60%);
}

.series-studio__bangumi-body {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.series-studio__bangumi-meta,
.series-studio__bangumi-id {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.series-studio__field--wide {
  grid-column: span 2;
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

.series-studio__switch-row {
  display: flex;
  gap: 10px;
  align-items: center;
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

@media (max-width: 860px) {
  .series-studio__headline,
  .series-studio__details-grid {
    grid-template-columns: 1fr;
  }

  .series-studio__mapping-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .series-studio__field--wide {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .series-studio__hero-actions,
  .series-studio__workspace-actions,
  .series-studio__workspace-toolbar,
  .series-studio__section-head,
  .series-studio__site-head,
  .series-studio__site-fields-head,
  .series-studio__site-actions,
  .series-studio__variant-head,
  .series-studio__variant-foot,
  .series-studio__variant-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .series-studio__hero-actions :deep(.el-button),
  .series-studio__workspace-actions :deep(.el-button),
  .series-studio__site-actions :deep(.el-button),
  .series-studio__variant-buttons :deep(.el-button) {
    width: 100%;
  }

  .series-studio__episode-chip {
    width: 100%;
  }

  .series-studio__section {
    padding: 18px;
  }
}
</style>

