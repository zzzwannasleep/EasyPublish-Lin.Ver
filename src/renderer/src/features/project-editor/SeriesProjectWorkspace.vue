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
  SeriesTitleMatchConfig,
  SeriesProjectVariant,
  SeriesProjectWorkspace,
} from '../../types/project'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'
import {
  matchSeriesTitlePattern,
  normalizeMatchedSubtitleProfile,
  normalizeMatchedVideoProfile,
  normalizeSeriesTitleMatchConfig,
  renderSeriesTitleTemplate,
  stripTorrentExtension,
} from '../../../../shared/utils/series-title-match'
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
const isSavingTitleMatch = ref(false)
const isImportingMatchedTorrents = ref(false)
const isPreparingReview = ref(false)
const selectedEpisodeId = ref<number | null>(null)
const loadError = ref('')
const switchingVariantKey = ref('')
const duplicatingVariantKey = ref('')
const removingVariantKey = ref('')
const savedFingerprint = ref('')

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
  informationTemplate: '',
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
  return resolveLocaleText(field.helpKey, field.mode === 'required' ? '该字段为必填�? : '该字段为选填�?)
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

function normalizeTitleMatchForm(config?: SeriesTitleMatchConfig | null) {
  const normalized = normalizeSeriesTitleMatchConfig(config) ?? {
    fileNamePattern: '',
    episodeTemplate: '<ep>',
    variantTemplate: '<res>p-<sub>',
    sourceTypeTemplate: '<source>',
    resolutionTemplate: '<res>p',
    videoCodecTemplate: '<video>',
    audioCodecTemplate: '<audio>',
    subtitleTemplate: '<sub>',
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
  titleMatchForm.informationTemplate = normalized.informationTemplate || ''
  titleMatchForm.targetSites = sortSiteIds(normalized.targetSites ?? [])
  savedTitleMatchFingerprint.value = buildTitleMatchFingerprint()
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
const unavailableSelectedSites = computed(() =>
  form.targetSites.filter(siteId => !availableSites.value.some(site => site.id === siteId)),
)

const currentProgress = computed(() =>
  summarizeTargetSiteProgress(form.targetSites, activeVariant.value?.publishResults),
)

const currentStructureLabel = computed(() =>
  activeEpisode.value && activeVariant.value ? `�?${activeEpisode.value.episodeLabel} �?· ${activeVariant.value.name}` : '还没有打开版本',
)

const isDirty = computed(() => Boolean(draftConfig.value && activeVariant.value && buildDirtyFingerprint() !== savedFingerprint.value))
const isTitleMatchDirty = computed(() => buildTitleMatchFingerprint() !== savedTitleMatchFingerprint.value)
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

  return {
    fileName: currentFileName,
    matched: true as const,
    variables,
    episodeLabel,
    variantName: variantName || stripTorrentExtension(currentFileName),
    title: renderSeriesTitleTemplate(config.titleTemplate, variables),
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
    videoProfile: normalizeMatchedVideoProfile(resolution),
    subtitleProfile: normalizeMatchedSubtitleProfile(subtitle),
  }
})

watch(
  [() => form.categoryBangumi, () => form.categoryNyaa],
  () => {
    syncCategoriesIntoSiteFields()
  },
  { immediate: true },
)

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

async function saveTitleMatchConfig() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('先填写文件名匹配规则，再保存标题匹配方案�?)
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
    ElMessage.success('标题匹配方案已保�?)
    return true
  } finally {
    isSavingTitleMatch.value = false
  }
}

async function importMatchedTorrents() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('先把标题匹配方案保存好，再导�?torrent�?)
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

    if (result.data.unmatchedFiles.length) {
      const unmatchedNames = result.data.unmatchedFiles.map(item => item.fileName).slice(0, 3).join(' / ')
      ElMessage.warning(
        `已识�?${result.data.importedCount} �?torrent，另�?${result.data.unmatchedFiles.length} 个未匹配�?{unmatchedNames}`,
      )
    } else {
      ElMessage.success(
        `已自动识�?${result.data.importedCount} �?torrent，新�?${result.data.createdEpisodeCount} 集�?{result.data.createdVariantCount} 个版本`,
      )
    }
  } finally {
    isImportingMatchedTorrents.value = false
  }
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
      ElMessage.warning('先打开一个版本，当前页的编辑内容都绑定到这个版本�?)
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
      ElMessage.success('已保存当前版本草�?)
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
      successMessage: `已复制并切换�?${result.data.variant.name}`,
    })
  } finally {
    duplicatingVariantKey.value = ''
  }
}

async function removeVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除�?${episode.episodeLabel} 集的版本�?{variant.name}」吗？`,
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
    ElMessage.success(`已删除版�?${variant.name}`)
  } finally {
    removingVariantKey.value = ''
  }
}

async function prepareReview() {
  if (!activeVariant.value || !activeEpisode.value) {
    ElMessage.warning('先打开一个版本，再进入检查发�?)
    return
  }
  if (!form.torrentPath.trim()) {
    ElMessage.warning('请先选择当前版本�?.torrent 文件')
    return
  }
  if (!form.targetSites.length) {
    ElMessage.warning('请先选择至少一个目标站�?)
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
      <section class="series-studio__section series-studio__section--primary">
        <div class="series-studio__headline">
          <div class="series-studio__title-block">
            <h2 class="series-studio__hero-title">{{ props.project.name }}</h2>
            <div class="series-studio__hero-meta">
              <StatusChip tone="info">{{ currentStructureLabel }}</StatusChip>
              <StatusChip tone="warning">{{ episodes.length }} �?/StatusChip>
              <StatusChip tone="success">{{ totalVariantCount }} 个版�?/StatusChip>
              <StatusChip v-if="currentProgress.publishedSiteIds.length" tone="success">
                已发 {{ currentProgress.publishedSiteIds.length }}
              </StatusChip>
              <StatusChip v-if="currentProgress.pendingSiteIds.length" tone="warning">
                待发 {{ currentProgress.pendingSiteIds.length }}
              </StatusChip>
              <StatusChip v-if="currentProgress.failedSiteIds.length" tone="danger">
                失败 {{ currentProgress.failedSiteIds.length }}
              </StatusChip>
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
              <span>刷新</span>
            </el-button>
            <el-button plain :disabled="!activeVariant" :loading="isSaving" @click="persistDraft()">
              保存当前版本
            </el-button>
            <el-button type="primary" :disabled="!activeVariant" :loading="isPreparingReview" @click="prepareReview">
              进入检查发�?            </el-button>
          </div>
        </div>

        <article class="series-studio__match-card">
          <div class="series-studio__section-head">
            <div>
              <h3 class="series-studio__section-title">标题匹配自动识别</h3>
              <p class="series-studio__match-text">
                先把文件名里的关键信息映射成变量，后面导�?torrent 时就会自动建剧集、建版本并回填标题和参数�?              </p>
            </div>
            <div class="series-studio__hero-meta">
              <StatusChip tone="info">�?OKPGUI 思路工作</StatusChip>
              <StatusChip v-if="isTitleMatchDirty" tone="warning">匹配方案未保�?/StatusChip>
            </div>
          </div>

          <div class="series-studio__match-grid">
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">文件名匹�?/span>
              <el-input
                v-model="titleMatchForm.fileNamePattern"
                placeholder="[SweetSub] Oniichan ha Oshimai! - <ep> [<source>][<res>P][<video>][<sub>]"
              />
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">剧集匹配</span>
              <el-input v-model="titleMatchForm.episodeTemplate" placeholder="<ep>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">版本匹配</span>
              <el-input v-model="titleMatchForm.variantTemplate" placeholder="<res>p-<sub>" />
            </label>
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">标题匹配</span>
              <el-input
                v-model="titleMatchForm.titleTemplate"
                placeholder="[SweetSub][不当哥哥了！][Oniichan ha Oshimai!][<ep>][<source>][<res>P][<video>][简日双语]"
              />
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">来源匹配</span>
              <el-input v-model="titleMatchForm.sourceTypeTemplate" placeholder="<source>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">分辨率匹�?/span>
              <el-input v-model="titleMatchForm.resolutionTemplate" placeholder="<res>p" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">视频编码匹配</span>
              <el-input v-model="titleMatchForm.videoCodecTemplate" placeholder="<video>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">音频编码匹配</span>
              <el-input v-model="titleMatchForm.audioCodecTemplate" placeholder="<audio>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">字幕匹配</span>
              <el-input v-model="titleMatchForm.subtitleTemplate" placeholder="<sub>" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">制作组匹�?/span>
              <el-input v-model="titleMatchForm.releaseTeamTemplate" placeholder="<team>" />
            </label>
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">Information 匹配</span>
              <el-input v-model="titleMatchForm.informationTemplate" placeholder="可�? />
            </label>
          </div>

          <div v-if="titleMatchPreview" class="series-studio__match-preview">
            <template v-if="titleMatchPreview.matched">
              <StatusChip tone="success">已匹配当�?torrent</StatusChip>
              <span class="series-studio__match-text">
                {{ titleMatchPreview.fileName }} �?�?{{ titleMatchPreview.episodeLabel || '??' }} �?/ {{ titleMatchPreview.variantName }}
              </span>
              <StatusChip v-if="titleMatchPreview.videoProfile" tone="info">{{ titleMatchPreview.videoProfile }}</StatusChip>
              <StatusChip v-if="titleMatchPreview.subtitleProfile" tone="warning">{{ titleMatchPreview.subtitleProfile }}</StatusChip>
              <span v-if="titleMatchPreview.title" class="series-studio__match-text">
                标题预览：{{ titleMatchPreview.title }}
              </span>
            </template>
            <template v-else>
              <StatusChip tone="danger">当前 torrent 未匹�?/StatusChip>
              <span class="series-studio__match-text">
                {{ titleMatchPreview.fileName }} 没有命中上面的文件名规则�?              </span>
            </template>
          </div>

          <div class="series-studio__match-actions">
            <el-button plain :loading="isSavingTitleMatch" @click="saveTitleMatchConfig">保存匹配方案</el-button>
            <el-button type="primary" :loading="isImportingMatchedTorrents" @click="importMatchedTorrents">
              导入 .torrent 自动识别
            </el-button>
          </div>
        </article>

        <div class="series-studio__workspace">
          <div class="series-studio__workspace-toolbar">
            <div class="series-studio__workspace-actions">
              <el-button type="primary" plain :loading="isImportingMatchedTorrents" @click="importMatchedTorrents">
                <el-icon><UploadFilled /></el-icon>
                <span>导入 .torrent 自动识别</span>
              </el-button>
            </div>
            <StatusChip v-if="selectedEpisode" tone="info">
              {{ selectedEpisode.episodeTitle || `�?${selectedEpisode.episodeLabel} 集` }}
            </StatusChip>
          </div>

          <div class="series-studio__episode-strip">
            <button
              v-for="episode in episodes"
              :key="episode.id"
              type="button"
              :class="['series-studio__episode-chip', { 'is-active': selectedEpisode?.id === episode.id }]"
              @click="selectedEpisodeId = episode.id"
            >
              <span class="series-studio__episode-chip-title">�?{{ episode.episodeLabel }} �?/span>
              <span class="series-studio__episode-chip-text">
                {{ episode.episodeTitle || '未填写分集标�? }} · {{ episode.variantCount }} 个版�?              </span>
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
                  最近更�?{{ formatProjectTimestamp(variant.updatedAt) }}
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
            {{ selectedEpisode ? '这一集还没有版本，先给它新增一个版本�? : '还没有剧集，先新增一集�? }}
          </div>

          <div v-if="activeVariant" class="series-studio__details-grid">
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">.torrent 文件</span>
              <el-input v-model="form.torrentPath" placeholder="选择当前版本对应�?.torrent 文件">
                <template #append>
                  <el-button @click="pickTorrentFile">
                    <el-icon><UploadFilled /></el-icon>
                  </el-button>
                </template>
              </el-input>
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">发布�?/span>
              <el-input v-model="form.releaseTeam" placeholder="可�? />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">来源类型</span>
              <el-select v-model="form.sourceType" clearable placeholder="可�?>
                <el-option v-for="option in SOURCE_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">分辨�?/span>
              <el-select v-model="form.resolution" clearable placeholder="可�?>
                <el-option v-for="option in RESOLUTION_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">视频编码</span>
              <el-select v-model="form.videoCodec" clearable placeholder="可�?>
                <el-option v-for="option in VIDEO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">音频编码</span>
              <el-select v-model="form.audioCodec" clearable placeholder="可�?>
                <el-option v-for="option in AUDIO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">Information 链接</span>
              <el-input v-model="form.information" placeholder="可�? />
            </label>
          </div>

        </div>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">选择站点</h3>
          <StatusChip tone="info">{{ form.targetSites.length }} 个目标站�?/StatusChip>
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
                  {{ site.accountMessage || '账号有效，可直接加入当前版本�? }}
                </div>
              </div>
              <StatusChip :tone="form.targetSites.includes(site.id) ? 'success' : 'neutral'">
                {{ form.targetSites.includes(site.id) ? '已选择' : '未选择' }}
              </StatusChip>
            </div>

            <div class="series-studio__site-actions">
              <span class="series-studio__site-count">
                {{ getEditableSiteFields(site.id).length ? `${getEditableSiteFields(site.id).length} 个填写项` : '无需额外填写' }}
              </span>
              <el-button
                v-if="!form.targetSites.includes(site.id)"
                type="primary"
                plain
                size="small"
                @click.stop="addTargetSite(site.id)"
              >
                选择站点
              </el-button>
              <el-button v-else plain size="small" @click.stop="removeTargetSite(site.id)">移出目标</el-button>
            </div>
          </article>
        </div>

        <div v-else class="series-studio__empty">先打开一个版本，再选择站点�?/div>

        <div v-if="unavailableSelectedSites.length" class="series-studio__tip">
          当前草稿里还有这些站点，但它们现在没有通过登录检查：{{
            unavailableSelectedSites.map(siteId => getSiteLabel(siteId)).join(' / ')
          }}
        </div>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">站点填写�?/h3>
          <StatusChip tone="info">{{ selectedSiteFieldSections.length }} 个站点展开</StatusChip>
        </div>

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
                  {{ section.site.accountMessage || '当前版本会带着这些站点字段一起保存�? }}
                </div>
              </div>
              <div class="series-studio__site-actions">
                <StatusChip :tone="section.fields.length ? 'info' : 'neutral'">
                  {{ section.fields.length ? `${section.fields.length} 个字段` : '无需额外填写' }}
                </StatusChip>
                <el-button plain size="small" @click="removeTargetSite(section.site.id)">移出目标</el-button>
              </div>
            </div>

            <div v-if="section.fields.length" class="series-studio__field-grid">
              <label v-for="field in section.fields" :key="field.key" class="series-studio__field">
                <span class="series-studio__field-label">
                  {{ resolveSiteFieldLabel(field) }}
                  <span v-if="field.mode === 'required'" class="series-studio__required">必填</span>
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
                  <span class="series-studio__field-text">保存到当前版�?/span>
                </div>

                <span class="series-studio__field-help">{{ resolveSiteFieldHelp(field) }}</span>
              </label>
            </div>

            <div v-else class="series-studio__empty">这个站点没有额外填写项，直接发布即可�?/div>
          </article>
        </div>

        <div v-else class="series-studio__empty">第二排选择几个站点，这里就展开几个站点的填写项�?/div>
      </section>

      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">正文编辑�?/h3>
          <StatusChip tone="info">当前版本所有站点共用一份正�?/StatusChip>
        </div>

        <SeriesRichTextEditor
          v-if="activeVariant"
          v-model="form.bodyMarkdown"
          placeholder="这里写当前版本的完整发布正文�?
        />

        <div v-else class="series-studio__empty">先打开一个版本，正文编辑器才会绑定到这个版本�?/div>
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

.series-studio__headline,
.series-studio__workspace,
.series-studio__title-block,
.series-studio__dialog-grid {
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
.series-studio__field-grid {
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

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__episode-chip,
.series-studio__site-fields-card {
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-studio__site-card,
.series-studio__variant-card,
.series-studio__site-fields-card {
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
.series-studio__variant-card.is-active,
.series-studio__site-fields-card {
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

