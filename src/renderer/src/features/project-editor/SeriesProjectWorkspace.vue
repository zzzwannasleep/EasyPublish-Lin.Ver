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
  activeEpisode.value && activeVariant.value
    ? `\u7b2c ${activeEpisode.value.episodeLabel} \u96c6 / ${activeVariant.value.name}`
    : '\u8fd8\u6ca1\u6709\u6253\u5f00\u7248\u672c',
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

const matchedTitleMatchPreview = computed(() =>
  titleMatchPreview.value?.matched ? titleMatchPreview.value : null,
)

const unmatchedTitleMatchPreview = computed(() =>
  titleMatchPreview.value && !titleMatchPreview.value.matched ? titleMatchPreview.value : null,
)

async function pickTorrentFile() {
  const response = await window.globalAPI.getFilePath(JSON.stringify({ type: 'torrent' }))
  const payload = JSON.parse(response) as Message.Global.Path
  if (payload.path) {
    form.torrentPath = payload.path
  }
}

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

function openWorkingDirectory() {
  window.globalAPI.openFolder(JSON.stringify({ path: props.project.workingDirectory }))
}

async function saveTitleMatchConfig() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝棛绡€闁逞屽墴閺屽棗顓奸崨顖氬Е婵＄偑鍊栫敮鎺楀磹瑜版帒鍚归柍褜鍓熼弻锝嗘償閵忕姴姣堥梺鍛婄懃閸燁偊鎮惧畡鎵殾闁搞儜灞绢棥闂佽鍑界徊濠氬礉鐎ｎ€兾旈崨顔规嫼闂侀潻瀵岄崢濂稿礉鐎ｎ喗鐓曢柕濞垮劤缁夎櫣鈧娲橀崝娆撳箖濞嗘挻鍊绘俊顖濇〃閻㈢粯绻濋悽闈浶㈤柨鏇樺€濆畷顖炲箥椤斿彞绗夐梺鐓庮潟閸婃劙宕戦幘鏂ユ灁闁割煈鍠楅悘宥嗙節閻㈤潧浠滈柨鏇ㄤ簻椤曪綁顢曢敃鈧粈鍐┿亜閺冨洤浜归柨娑欑矊閳规垿鎮欓弶鎴犱桓闂佺厧缍婄粻鏍偘椤曗偓瀹曞ジ鎮㈤崜浣虹暰闂備胶绮崝锔界濠婂牆鐒垫い鎴炲劤閳ь剚绻傞悾鐑藉閿涘嫷娴勯柣搴秵娴滄粓鎮楅銏♀拺闁告捁灏欓崢娑㈡煕鐎ｎ亝顥㈤柕鍡楁嚇瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幗闂佽鍎抽悺銊х矆閸愵亞纾肩紓浣诡焽濞插鈧娲栧畷顒冪亙闂佸憡鍔︽禍鍫曞船閾忓湱纾介柛灞剧懆閸忓苯鈹戦鑺ュ唉闁炽儻绠撻幃婊堟寠婢跺孩鎲伴梻浣瑰缁嬫垹鈧凹浜滈埢浠嬵敂閸℃瑧锛滈柣搴秵娴滅偞绂掗姀銈嗙厓鐎瑰嫰鍋婂Ο鈧梺璇″枟椤ㄥ﹤鐣疯ぐ鎺濇晝闁挎繂娲ら崵鎺楁⒑鐠囨彃顒㈤柛鎴濈秺瀹曟娊鏁愭径濠冩К闂侀€炲苯澧柕鍥у楠炴帡骞嬮姘潬缂傚倷绀侀ˇ闈涱焽瑜斿﹢浣糕攽閻樿宸ラ悗姘煎枤缁鎮欏ǎ顑跨盎闂侀潧楠忕槐鏇㈠箠閸モ斁鍋撶憴鍕８闁告梹鍨块妴浣肝熺悰鈩冾潔濠电偛妫欓崝鏍ь熆閹达附鈷掗柛灞剧懆閸忓瞼绱掗鍛仸鐎规洘绻堝鎾倻閸℃顓块梻浣稿閸嬪懎煤閺嶎厽鍋傛繝闈涱儐閻撴盯鏌涢妷銏℃珒缂佽鲸濞婇弻锝夋偄閻撳簼鍠婇梺缁樻尪閸庣敻寮诲☉銏犲嵆闁靛鍎辩粻濠氭⒑缂佹ɑ灏ㄩ柛瀣尭閳规垿鎮╅崹顐ｆ瘎闂佺顑囬崑鐘诲Φ閹版澘绀冩い鏃囨閳ь剝鍩栫换婵嬫濞戝崬鍓伴梺缁樻尰閿曘垽寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎愰柛鏃€鐗犳俊鐢稿礋椤栨氨鐫勯梺鎼炲劀閸屾稓娼栨繝鐢靛仜椤曨參宕㈣鐓ら柕鍫濐槸閻撴﹢鏌熸潏楣冩闁稿﹪顥撻埀顒傛嚀婢瑰﹪宕板Δ浣规珡闂傚倸鍊烽懗鍫曞磿閻㈢鐤鹃柍鍝勬噹閸ㄥ倿鎮规潪鎷岊劅闁搞倖娲橀妵鍕箛閸撲胶鏆犵紓浣插亾闁告劏鏂傛禍婊堟煛閸屾稑顕滄い顐㈢Ф閹叉悂寮崼婵婃憰濠电偞鍨崹鐟版暜婵＄偑鍊栧Λ浣哥暦閻㈠憡鍎庨幖娣妽閸婂爼鐓崶銊﹀暗缂佺姷绮幈銊︾節閸曨厼绗＄紓浣诡殘閸犳牠宕洪埀顒併亜閹哄棗浜惧銈庡幖濞测晠藝瑜版帗瀵犳繝闈涙储娴滄粓鏌熼弶鍨暢闁伙綁浜堕弻锝夊Χ閸パ傚缂備胶绮换鍐崲濠靛纾兼繝濠傚枤閺嗩偊姊绘担铏瑰笡闁规瓕顕х叅闁绘梻鍘ч拑鐔兼煟閺傛寧鍟炵紓宥呮搐铻栭柨婵嗘噹閺嗙偞銇勬惔锛勑ф慨濠呮缁辨帒螣鐠囨煡鐎烘繝鐢靛仜瀵爼鈥﹂崶顒€绠查柕蹇曞Л閺€浠嬫倵閿濆骸浜芥俊顐㈠暙閳规垿鎮欓弶鎴犱桓闂佽崵鍣ラ崹鎷岀亱闂佺粯鍔曞Ο濠傘€掓繝姘厪闁割偅绻冮崳铏圭磼閸屾凹鍎旈柡灞剧洴楠炴﹢寮堕幋婵囨嚈濠电姷顣槐鏇㈠极鐠囪尙鏆﹂柣鏃傗拡閺佸秹鏌ㄥ┑鍡橆棡婵炲懎娲︽穱濠囨倷椤忓嫧鍋撻弽顐ｆ殰闁圭儤顨呯壕鐟扳攽閻樺疇澹樻慨瑙勭叀閺屾洟宕煎┑鎰ч梺鎶芥敱閸ㄥ潡寮诲☉妯锋斀闁糕剝顨忔禒鎯р攽閻橆偄浜鹃梺瑙勵問閸犳氨澹曟總鍛婂€甸柨婵嗛娴滄粍绻涢幖顓炴灍妞ゃ劊鍎甸幃娆撳矗婢舵ɑ锛嗛柣搴㈩問閸ｎ噣宕抽敐鍛殾闁绘挸瀵掗悢鍡樸亜韫囧海鍔嶆繛鍛躬閺岋紕浠﹂悙顒傤槹閻庤娲滈崢褔鍩為幋锕€鐐婇柤鍛婎問濡囨⒒閸屾瑧顦﹂柟纰卞亰椤㈡牠宕橀鑲╋紮濠电娀娼ч鍛存嫅閻斿吋鐓ユ繝闈涙椤ョ偤鏌涙惔锝呮灈闁哄本娲熷畷鐓庘攽閸♀晛濡风紓鍌氬€哥粔鎾偋閸℃稑鐓橀柟杈鹃檮閸婄兘鏌熺紒妯虹濡ょ姴娲ら—鍐Χ鎼粹€崇濠电偛妯婇崢濂割敋閿濆鏁冮柨鏃傜帛閺咁亪姊洪柅鐐茶嫰婢у鈧娲樺钘夌暦閻旂⒈鏁嶆慨姗€纭稿Σ浼存煟閻斿摜鐭婄紒缁樺笧閸掓帞鎷犲顔藉兊闂佺厧鎽滈。浠嬪箯濞差亝鍋℃繝濠傛噹椤ｅジ鎮介娑辨疁闁轰礁绉归幃銏ゅ礂閼测晛骞楅梻浣侯攰濞咃綁宕戦悢鍏煎仼闁汇垻顣介崑鎾斥枔閸喗鐏嶉悷婊勬緲閸熸挳鍨鹃敃鍌毼╅柍杞扮窔閸炲爼姊虹紒妯荤叆闁圭⒈鍋婇悰顕€宕奸妷锔规嫽婵炶揪绲介幉锛勬嫻閿熺姵鐓曢悗锝庡亝瀹曞矂鏌曢崱妤€鏆ｇ€规洏鍔庨埀顒佺⊕閿氭繛鍫到椤啴濡堕崱娆忊拡闂佺顑嗛惄顖炲箖閸ф鍊锋い鎴濆綖缁ㄥ姊虹憴鍕姢鐎规洦鍓熼幃姗€顢旈崼鐔哄帗闂備礁鐏濋鍛归鈧弻锛勪沪閸撗佲偓鎺懨归悪鍛暤鐎规洘绮忛ˇ鎶芥煕閿濆骸鐏︽慨濠呮缁瑧鎹勯妸褜鍞堕梻浣规た閸樺ジ宕愰崹顕呭殨濠电姵纰嶉崑鍕煕韫囨挸鎮戦柛搴簻椤啴濡堕崱妤€衼缂備浇灏欓弲顐ｇ珶閺囥垹绀冪€瑰壊鍠楃€靛矂姊洪棃娑氬闁哥噥鍋婇幃姗€顢旈崱蹇撲壕闁稿繐顦禍楣冩⒑瑜版帗锛熼梻鍕Ч閸┾偓妞ゆ垼娉曢ˇ锔姐亜椤愶絿鐭掗柛鈹惧亾濡炪倖甯婇悞锕傚矗韫囨稒鐓冪憸婊堝礈閻旂厧钃熼柨婵嗘啒閻斿搫鏋堥弶鍫涘妽椤斿洨绱撻崒娆戠獢濞存粏鍩栫粋宥囨崉娓氼垱缍庣紓鍌欑劍钃卞┑顖涙尦閺屟嗙疀閺囩喎娈岀紓浣广仜閳ь剚鏋奸弨鑺ャ亜閺冨倶鈧顔忛妷锔轰簻妞ゆ挾鍋涘Σ濠氭煟閿濆洤鍘村┑顔瑰亾闂佹寧绻傜€涒晠鐎风紓鍌氬€搁崐椋庢閿熺姴绐楅柡宥庡幐閳ь剨绠撻幃婊堟寠婢跺瞼鏆梻浣稿暱閹碱偊宕幍顔碱棜闁稿繘妫跨换鍡樸亜閺嶃劎鐭婇悽顖濆煐椤ㄣ儵鎮欓懠顒€顤€缂備胶绮换鍫ュ箖娴犲顥堟繛鎴烆殕閸曞啴姊绘担瑙勫仩闁告梹鍨甸…鍥樄闁诡噣绠栭幃婊呯驳鐎ｎ偅娅岄梻浣告啞濞诧箓宕滃▎鎾崇劦妞ゆ巻鍋撻柣鏍с偢瀵濡搁妷銏℃杸闂佺硶鍓濋敋缂佹劖绋戦埞鎴﹀煡閸℃ぞ鑸梺鎼炲妼閻栫厧顕ｆ繝姘亜缁炬媽椴搁弲顒勬⒑缁洖澧叉繛鍙夌矒钘濋柨鏇楀亾闂囧鏌ｅ▎灞戒壕闂侀潻缍囩徊浠嬶綖韫囨拋娲敂閸曨亞鐐婇梻浣告啞濞诧箓宕㈡ィ鍐ㄧ闁革富鍘剧壕钘壝归敐鍥ㄥ殌缂佹彃顭烽弻宥堫檨闁告挻鐩畷浼村箻鐎靛壊娲告繛瀵稿Т椤戝棝鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬闂佸憡鏌ｉ崐妤冩閹烘梻纾兼俊顖濇閻熴劑姊虹€圭媭鍤欑紒澶庮潐閹便劑鍩€椤掑嫭鐓忛煫鍥э攻椤﹥绻涢懖鈺佹灈婵﹨娅ｇ槐鎺懳熼崫鍕垫綍闂備胶顭堢花娲磹濠靛鏄ユ繛鎴欏灩缁狅綁鏌ㄩ弮鍌涙珪闁告ü绮欏铏圭磼濡崵鍙嗛梺纭咁嚋缁辨洖鈻庨姀銈呰摕闁靛濡囬崢鎼佹⒑缁洖澧茬紒瀣姍楠炲銈ｉ崘鈺冨幍濡炪倖姊婚悺鏂库枔閺冣偓閵囧嫰顢曢敐鍥╃杽濡炪們鍨哄ú鐔告叏閳ь剟鏌ｅΟ鐓庝化闁稿鐗犲铏规嫚閹绘帩鍔夊銈嗘⒐閻楃姴鐣锋导鏉戝唨妞ゆ挻绋堥崑鎾绘晝閳ь剟鎮鹃敓鐘崇劷闁挎洍鍋撴繛鍫涘姂濮婃椽宕烽鈩冾€楅梺鍝ュУ閻楃娀鏁愰悙鍝勫窛閻庢稒顭囬崢钘夆攽椤斿浠滈柛瀣尰缁绘稒鎷呴崘鍙夋悙闁绘帒鐏氶妵鍕箳閹存績鍋撻崨濠勵浄闂侇剙绉甸悡娆愩亜閺冨倸甯舵俊鑼帛閵囧嫰顢樺鍐潎閻庤娲橀敃銏ゃ€侀幘娲绘晬闁糕剝顨呴銉ッ瑰鍕煉闁哄本娲濈粻娑欑節閸屾埃鎷ゆ俊鐐€戦崕閬嶆偋婵犲洤桅闁告洦鍨伴～鍛存煃閽樺鍤€闁逞屽墮濞硷繝寮婚悢纰辨晩闁告繂瀚ч崑鎾诲冀椤撶偟顔嗛梺鍛婁緱閸ㄨ京鈧碍宀搁弻宥夊Ψ閵婏妇褰у┑鐐叉噺閻楃姴顫忔繝姘＜婵﹩鍏橀崑鎾绘倻閼恒儱娈戦梺鍛婃尫缁€渚€宕瑰┑鍥ヤ簻闁哄稁鍋勬禒婊呯磼閳ь剚寰勯幇顓犲幐闂佹悶鍎弲娑㈠礈闁秵鐓曢柕鍫濇缁€瀣煛鐏炲墽娲存い銏℃礋閺佹劙宕卞▎妯恍氱紓鍌氬€烽悞锕傚礉閺嶎厹鈧啴宕卞☉妯肩杽闂侀潧顭堥崕鍝勩€掓繝姘仯闁搞儺浜滅槐锕€顭跨憴鍕婵﹦绮幏鍛村川婵犲啫鍓甸梻浣告惈閻楁粓宕滈悢鐓庣畾闁告洦鍨奸弫宥夋煟閹邦剙绾ф俊宸墴濮婅櫣绱掑Ο鍝勵潓闂佸湱鈷堥崑鍡欏垝鐠囧樊娼╅弶鍫涘妼閺嬫垿鎮楅獮鍨姎妞わ富鍨堕幃锟犲即閻戝棛鍞甸梺鍏兼倐濞佳勬叏閸儲鐓冮梺鍨儏閻忔挳鏌″畝瀣М闁诡喓鍨藉畷銊︾節閸曨偄娈ュ┑鐘殿暯閸撴繆銇愰崘顔光偓锕傛倻閽樺鎽曢梺缁樻⒒閸樠呯矆閸愵喗鐓犵痪鏉垮船婢х増銇勯弬鎸庢悙妞ゎ亜鍟存俊鑸垫償閳ュ磭顔愭繝鐢靛仜濡﹪宕ｉ崘顔嘉ュ〒姘ｅ亾鐎殿噮鍣ｅ畷鐓庘攽鐎ｎ亝鏆梻鍌欒兌缁垰螞娴ｆ悶鈧帡宕烽鐘碉紴闂佸搫娲㈤崹娲煕閹烘嚚褰掓晲閸ュ墎鍔稿銈冨劚缁绘﹢寮诲☉姘ｅ亾閿濆簼绨奸柛锝勭矙閺岀喖鐛崹顔句紙闂佺硶鏂侀崑鎾愁渻閵堝棗绗掗柛濠呭吹婢规洘绺介崨濠勫帾婵犵數鍋涢悘婵嬪礉濮椻偓閺屾稓鈧絻鍔岄悘顏堟煙娓氬灝濡界紒缁樼箞瀹曟帡濡堕崶褎鍊梺璇叉唉椤煤濡吋鏆滈柟鐑橆殣缂嶆牗绻濋棃娑卞剾闁轰礁瀚伴弻锕€螣娓氼垱啸婵犮垼顫夊ú鐔奉潖妤﹁￥浜归柟鐑樻惈缁辩數绱撴担鎻掍壕婵炶揪绲介幖顐λ夊鑸电厽闁绘梻鍘ф禍鐗堢箾閹炬剚鐓奸柟顔筋殜閺佹劖鎯斿┑鍫濆毈闂備礁婀卞▍銏㈢礊娓氣偓瀵鏁愭径妯绘櫍闂佺粯鍔栭幆灞轿涢悙鐑樷拺闂傚牊绋掗ˉ鐐烘偨椤栨稑娴柨婵堝仜閳规垹鈧綆鍋呭▍婊堟⒑閸涘﹣绶遍柛鎾寸懇钘熸慨姗嗗厴閺€浠嬪箳閹惰棄纾规俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁炬儳顭烽弻锝夊箛椤旂厧濡洪梺绋款儏椤戝寮婚敐鍛傜喖鎳￠妶鍡氬即闂備線鈧偛鑻崢鍝ョ磼閼镐絻澹樻い鏇秮楠炴﹢顢欑喊杈ㄧ秱闂備焦鏋奸弲娑㈠疮椤栫偞鍋熼柡宥庡幗閳锋帒銆掑锝呬壕闂侀€炲苯澧伴柛瀣洴閹崇喖顢涘☉娆愮彿闂佽顔栭崰姘卞閸忕浜滈柡鍐ㄥ€甸幏锟犳煟閹剧偨鍋㈤柡宀€鍠栭、娆戞喆閸曨剛褰嬮梻浣告贡椤掕尙鎹㈠┑鍥︾箚闁割偅娲栧婵囥亜閹捐泛孝妞ゆ洟浜跺濠氬磼濮橆兘鍋撻悜鑺ュ€块柨鏇炲€哥粻鏍煕椤愶絾绀€缁剧偓瀵ч妵鍕冀椤愵澀绮剁紓浣插亾濠㈣埖鍔曠粻瑙勭箾閿濆骸澧┑鈥炽偢閺岋綁骞橀妤€浜鹃柟棰佽兌閸炵敻鏌ｉ悩鑽ょ窗婵炲拑缍侀幃妯绘綇閳哄啯锛忛梺璇″瀻娴ｉ晲鍒掗梻浣告惈閻寰婇崐鐔轰航闂備焦鍎崇换鎺戔枍閵忋垺顫曢柣鎰嚟缁♀偓闂佸啿鐨濋崑鎾绘煕濞戝崬鏋熸慨锝呯墦濮婃椽宕崟顓犲姽缂備浇椴稿ú妯肩矉閹烘鏅濋柛灞炬皑椤︻參鎮峰鍐炬Ц閸楅亶鏌涢鐘插姕闁抽攱鍨甸湁闁稿繗鍋愰幊鍛磼鐎ｎ厼鍚圭紒杈ㄥ笧閹风娀鎳犻鈧埅鐢告倵鐟欏嫭绀冩俊鐐扮矙瀹曟椽鍩€椤掍降浜滈柟鍝勭Ч濡惧嘲霉濠婂嫮鐭掗柡宀€鍠栭幃婊兾熼搹閫涙樊婵＄偑鍊曠换鍡涘疾濠靛鍎夋い蹇撶墕缁€鍫㈡喐韫囨洘鏆滄繛鎴炴皑绾捐偐绱撴担璇＄劷婵炴彃鐡ㄩ〃銉╂倷瀹割喖鍓伴梺瀹狀嚙濮橈妇绮诲☉銏犲嵆婵椴搁敍蹇涙⒒閸屾瑦绁版い鏇嗗應鍋撳☉鎺撴珚闁硅櫕绻冮妶锝夊礃閵娧呮瀮婵犳鍠楅妵娑㈠磻閹惧灈鍋撳▓鍨灈妞ゎ厾鍏樺顐﹀箛椤撶偟绐炴繝鐢靛Т閸犳艾螞閻斿吋鈷掑ù锝囶焾椤ュ繘鏌ｉ幘宕囧ⅵ鐎规洘婢樿灃闁告侗鍘鹃敍娆忣渻閵堝棛澧遍柛瀣仱閸╂盯骞嬮悩鐢碉紳婵炶揪缍€閸嬪倿骞嬮悩杈╁墾濡炪倕绻愰悧濠囨偂閺囥垹绠归弶鍫濆⒔缁嬪鏌￠崱鈺佸闁逞屽墯椤旀牠宕伴弽顓涒偓锕傛倻閽樺鐎梺褰掑亰閸樿偐娆㈤悙娴嬫斀闁绘ɑ褰冮弸銈嗕繆椤愩倕鏋涙慨濠勭帛閹峰懘宕ㄦ繝鍛攨婵＄偑鍊ら崢濂告偋韫囨稑鐒垫い鎺嶈兌閳绘捇鏌￠崨顖毿㈤柣锝囧厴瀵挳濮€閻樻鍟嬬紓鍌氬€烽悞锕傛晪闂侀€炲苯澧柣蹇旀皑閹广垹鈽夐姀鐘殿吅闂佺粯鍔曢悘姘跺闯椤斿墽纾藉ù锝呮惈鏍″銈庡幖濞层劌危閹版澘绠抽柟鎯ь嚟缁夊爼姊洪棃娑辩劸闁稿氦灏欓幏鐘绘倷閻戞ǚ鎷洪柣鐘叉礌閳ь剝娅曢悘宥夋⒑閼姐倕鏆遍柡鍛█婵″瓨鎷呴懖婵囨瀹曘劑顢橀悩鎻捫曞┑锛勫亼閸婃牜鏁幒鏂哄亾濮樼厧澧扮紒顔肩墛瀵板嫰骞囬鐘插妇闂備礁澹婇崑鍛崲瀹ュ憘锝堛亹閹烘挾鍘介梺瑙勫劤閻°劎绮堥崘顔界厵濞撴艾鐏濇俊鍏笺亜椤愶絿鐭掔€规洖宕灃闁逞屽墴閸╂盯骞掑Δ浣叉嫼缂備礁顑呴悘婵嬵敆閵忊剝鍙忓┑鐘插€荤粔娲煏閸℃鏆ｅ┑锛勫厴閸╋繝宕掑锝呬壕闁绘垼濮ら悡鐘电棯閺夊灝鑸瑰褜鍣ｉ弻宥夘敂閸曨厺绮电紓浣虹帛缁诲嫰宕版繝鍋界喖宕崟銊﹀珶闂傚倷娴囬鏍窗閺嶎厼纾归悷娆忓閳瑰秴鈹戦悩鍙夊闁稿﹨宕电槐鎺戔槈濮楀棗鍓遍梺鍝勬噳閺呯姴顫忓ú顏呭殟闁靛鍠氭禍顏囨闁哄鐗冮弲婊堬綖閺囥垺鐓ラ柡鍥╁仜閳ь剙缍婇崺娑㈠箳濡や胶鍘遍柣蹇曞仜婢т粙骞婇崱娑欑厱闊洦鎸鹃悘閬嶆煟閵夘喕閭い銏★耿閹瑩妫冨☉姘箺闂佽姘﹂～澶娒哄Ο鐓庡灊鐎光偓閸曨偆鍘撮梺鐟邦嚟婵參宕戦幘缁樻櫜闁告劑鍔屽敮闂備胶顭堥鍡涘箲閸パ呮殾婵せ鍋撴い銏＄懇閹剝鎯旈敐鍥ф槬婵犵绱曢崑鎴﹀磹閺嶎厽鍋嬫俊銈呭暙閸ㄦ繈鏌涢鐘茬伄缂佺姵鏌ㄩ…璺ㄦ崉娓氼垰鍓崇紓浣叉閸嬫捇姊绘担鍦菇闁搞劏妫勯…鍥槼闁绘娴风槐鎾存媴閸濆嫪澹曞┑鐘灪椤洨鍒掗弮鍥ヤ汗闁圭儤鍨跺Σ顒€鈹戦悙鏉戠仧闁搞劌婀辩划濠氭晲婢跺鍘藉┑鈽嗗灠閸氬寮抽埡鍛叆婵炴垶鐟х粻鏍磼缂佹鈯曟繛鐓庣箻瀹曟粏顦寸悮锝夋⒒娴ｄ警鐒炬い鎴濇嚇瀹曟劙宕稿Δ鍐ㄧウ闁诲函缍嗛崰妤呭磻閹版澘绾ч柛顐ｇ濞呭懎顭胯閸庢娊鍩為幋锔藉€风€瑰壊鍠栧▓鍫曟⒑閸涘鐒奸柛銉ｅ妼娴犻亶姊洪棃娴ュ牓寮插鍫濈；闁稿瞼鍋為悡娑㈡煕閵夛絽鍔氶柣蹇ｄ邯閺岋綁骞樺畷鍥╊唶闂佸疇顫夐崹鍧楀箖濞嗘挸绠ｆ繝闈涙濞堫厼顪冮妶鍛濞存粍绻堥獮鍫ュΩ閳哄倹娅滈梺鍛婁緱閸ㄤ即鍩呴棃娑掓斀妞ゆ梻銆嬫Λ姘箾閸滃啰绉€规洜濞€瀵粙顢橀悙鎻掔ギ闂備胶绮弻銊╁箺濠婂棎浜归柛銉墯閳锋帒霉閿濆嫯顒熼柣鎺斿亾閵囧嫰骞嬪┑鍡樻閻庤娲橀崝鏇㈠煘閹寸姭鍋撻敐搴′簻濞寸姵甯掗—鍐Χ閸℃﹩妫冮梺杞扮贰閸ｏ絽鐣烽幋锕€绠荤紓浣股戝▍婊堟煙閼测晞藟闁告挻绻堥幃妯侯吋婢跺鎷洪梺鍛婄箓鐎氼參宕抽搹鍦＜妞ゆ棁濮ゅ畷宀€鈧鍠栭…鐑藉极閸愵喖鐒垫い鎺戝暟娴滆棄鈹戦悙瀛樺鞍闁告垵缍婂畷褰掑础閻愬灚鎳冮梻鍌氬€搁崐鐑芥嚄閸洍鈧箓宕奸妷顔芥櫈闂佺硶鍓濈粙鎴犵不閺屻儲鐓曢柕澶樺枛婢ь喚绱掗悩宕囧缂佺粯绻冪换婵嬪磼濠婂喚鏉搁梻浣规偠閸婃洜绮旇ぐ鎺戣摕闁哄洨鍠撻悵鑸点亜閺嶃劏澹橀柡鍡樼懅缁辨帡鎮╅棃娑楃捕闂佸疇顫夐崹鍧楀箖閳哄懎鍨傛い鎰剁稻閻﹀酣姊绘担渚劸妞ゆ垵妫涚划娆撳箣閿濆洣缃曞┑鐘茬棄閺夊簱鍋撻幇鏉跨；闁瑰墽绮ˉ鍡楊熆鐠轰警鍎愰柛娆忕箲閹便劌螖閳ь剙螞濡ゅ懎绀夐柨鏇炲€归悡鐔兼煛閸愩劌鈧摜鏁崼鏇熲拺闁告鍋為崰姗€鏌″畝瀣М鐎殿噮鍓熷畷褰掝敋閸涱喗顔戠紓鍌氬€烽懗鑸垫叏閻㈠憡鍤屽Δ锝呭暊閳ь剚妫冨畷姗€顢欓崲澹洦鐓曢柍鈺佸枤濞堟梻鎮伴懖鈺冪＝闁稿本鐟︾粊鎵偓娈垮枟閹搁箖宕氶幒鎴旀瀻闁规儳纾悾鍝勨攽閳藉棗鐏犻柣銊у厴瀹曟垿骞橀弬銉︻潔濠电偛鎳撳▍鏇㈠垂閸喚鏆﹂柨婵嗙墢閻も偓闂佸湱铏庨崹閬嶅棘閳ь剟姊绘担铏瑰笡閽冭京鎲搁弶鍨殻鐎殿喗濞婇幃娆撴倻濡厧甯鹃梻浣规偠閸庮垶宕濇惔锝囦笉闁哄秲鍔婃禍婊堟煏婵犲繒鍒伴柛鏃撶畵閺岀喖顢欓悾灞惧櫘闂侀€炲苯澧伴柡浣规倐閳ワ箓宕奸妷銉у幈閻庡厜鍋撻柛鏇ㄥ厴閹锋椽鏌ｉ悩鍙夌闁逞屽墲濞呮洟鎮樺澶嬧拺闁煎鍊曢弳閬嶆煛閸涱垰鈻堥柟顔诲嵆椤㈡岸鍩€椤掑嫮宓佹俊顖氬悑鐎氭岸鏌ょ喊鍗炲⒒闁哥偟鍎ょ换婵嬫偨闂堟稈鏋呭┑鐐板尃閸忕姵妞芥俊姝岊槾闁活厽鎹囧鍫曞醇濞戞ê顬嬬紓浣叉閸嬫捇姊绘担鍦菇闁搞劏妫勯…鍥槻闁哄棌鏅滄穱濠囨倷椤忓嫧鍋撹缁辩偤鍩€椤掍椒绻嗘い鎰╁灩椤忊晝鈧鎸哥€氭澘顫忓ú顏勫窛濠电姴瀚ф慨鍥р攽閻愭彃鎮戦柣鐔濆嫮鐝堕柡鍥╁枔缁♀偓濠殿喗锕╅崢楣冨储闁秵鈷戦柛婵嗗閸屻劑鏌涢弬璺ㄧ劯闁绘侗鍣ｉ獮鍥偋閸垹骞堥梺璇插嚱缂嶅棝宕戦崨顖欑剨妞ゆ挾鍠嗘禍婊勩亜閹板墎鎮肩紒鐘靛仦閵囧嫰濮€閳╁啰顦版繝娈垮枓閸嬫捇姊虹紒姗嗙劷闁稿缍佸畷鎴﹀冀瑜夐弨浠嬪箳閹惰棄纾规俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁惧墽绮换娑㈠箣濞嗗繒浠奸梺姹囧€ら崰妤呭Φ閸曨垰鍐€妞ゆ劦婢€缁爼鏌涢妷锔藉唉婵﹥妞介獮鎰償閿濆洨鏆ゆ俊鐐€х€靛矂宕瑰畷鍥у灊闁割偁鍎辩粈鍐┿亜閺冨倹娅曢柛妯绘崌閺屸剝寰勭仦鎴掓勃婵犳鍨划娆撱€佸▎鎰窞闁归偊鍘鹃崢閬嶆煟鎼搭垳绉甸柛瀣噽娴滄悂骞嶉鍓э紲缂傚倷鐒﹂…鍥╃不閹炬番浜滄い鎰剁悼缁犵偞銇勯姀鈽呰€块柟顔规櫊楠炴捇骞掗弮鍌涚秮婵犵數濮烽弫鍛婃叏閻戝鈧倿鎸婃竟鈺嬬秮瀹曘劑寮堕幋婵堚偓顓㈡倵鐟欏嫭绀€婵炶缍侀幃鐐寸節閸ャ劎鍘繝鐢靛€崘顭戜紝濠电偠鍋愰崰搴ㄥ煘閹达富鏁婄紒娑橆儑閸旀悂姊虹化鏇熸珕闁绘濞€楠炲啴妾辩紒鐘崇洴楠炴﹢顢涘☉娆愭緫闂傚倷鑳剁划顖炲礉濞嗗浚鐒界憸搴ｇ矉瀹ュ鍊锋い鎺戝€婚鏇㈡⒑閸涘﹣绶遍柛妯圭矙钘熼柕蹇嬪€栭悡娑氣偓鍏夊亾閻庯綆鍓涜ⅵ婵°倗濮烽崑鐐烘晪闂佷紮绲块崗妯虹暦閸洖鐓涘┑鐘插€归弳顏呯節绾板纾块柛瀣灴瀹曟劙濡舵径濠傚亶闂佺粯鎸哥€垫帡鎮炴禒瀣叆闁绘柨鎼瓭缂備胶濮锋慨鐢垫崲濠靛洨绡€闁稿本纰嶉悘鎾绘⒑閹肩偛鈧牠銆冮崱妯尖攳濠电姴娲ゅ洿闂佸憡绮岄崯顖炪€傛總鍛娾拻濞撴艾娲ゅ楣冩煕閵婏箑鈻曢柛鈹惧亾濡炪倖甯婄欢锟犲疮韫囨稒鐓曢柣妯哄暱閸濇椽鏌嶉妷顖滅暤鐎规洖銈告俊鐑藉Ψ瑜嶅銊モ攽閻橆喖鐏遍柛鈺傜墵瀹曟繈寮撮～顔剧◤闂佸憡绋戦悺銊╂偂閵夛妇绠鹃柟瀵镐紳椤忓牜鏁傞柍鍝勫亞濞堜粙鏌ｉ幇顖氱毢閺嶁剝绻涢敐鍛悙闁挎洦浜獮鍐ㄢ枎閹垮啯鏅滈梺鍛婃磸閸斿本绂嶆ィ鍐╃厸鐎广儱娴锋禒婊勭箾閹寸偟鎳勫┑顖涙尦閺屻倝宕ｆ径宀€鐣洪梺鐑╂櫓閸ㄤ即鎮鹃悜鑺ュ亜缁炬媽椴搁弲顒€鈹戦悙鏉戠仸閼裤倝鏌涚€ｎ偅宕岀€规洖銈稿鎾偄鐏忎礁浜鹃柛顭戝亞缁犻箖鏌熺€电鍓卞ù鐓庢閺岀喐娼忛崜褏鏆犻梺娲诲幗椤ㄥ﹪鎮￠锕€鐐婇柕濠忕畱閻ㄦ垿姊虹悰鈥充壕婵炲濮撮鍡涙偂閻旈晲绻嗘い鏍ㄧ箥閸ゆ瑧绱掗幓鎺濈吋闁哄矉绻濆畷鍗炩枎韫囧孩顫曢梻浣告惈閺堫剙煤閻旈鏆﹂柛顐ｆ礀鎯熼悷婊冪箻閹偓绺介崨濞炬嫼闂備緡鍋嗛崑娑㈡嚐椤栨稒娅犻柛娆忣槶娴滄粍銇勯幇鈺佺労婵″弶鎮傞幃锟犲Χ婢跺苯褰勯梺鎼炲劘閸斿酣鍩ユ径宀€纾奸柍褜鍓氬鍕沪缁嬪じ澹曞Δ鐘靛仜閻忔繈宕濆顓犵閻犲泧鍛殸闂佷紮绲块崗妯虹暦閿濆棗绶炵€光偓閳ь剟鎯侀崼銉︹拻闁稿本姘ㄦ晶娑氱磼鐎ｎ偄绗氱€垫澘瀚板畷鐔碱敃閻斿憡鏉告俊鐐€栭悧妤冪矙閹烘柧鐒婇柨鏇炲€归悡娑㈡倶閻愰潧鏋庢俊顐ｇ洴閹潡鍩€椤掑嫭鈷戦柣鐔告緲閳锋梹銇勯妷锕€濮夋繛鎴犳暬閸┾偓妞ゆ帒瀚埛鎺懨归敐澶樻濞戞捁灏欑槐鎺楁嚑椤掆偓娴滃墽绱掔紒妯尖姇缂佺粯绻堝畷鎺楀Χ閸℃瑧鈻夋繝鐢靛Х閺佸憡鎱ㄩ悽鍛婂殞闁告挆鍐炬闂佺绻楅崑鎰不妤ｅ啯鐓曢柍鈺佸幘椤忓牊鍊块柣鎰靛厸缁诲棛鈧懓澹婇崰鏍р枍瀹ュ棙鍙忓┑鐘叉噺椤忕姵绻涢幋鐘虫毈鐎规洦浜濋幏鍛村川婵犲嫭婢撶紓鍌氬€搁崐鐑芥嚄閸撲礁鍨濇い鏍ㄧ矋瀹曟煡鏌涢锝囩闁搞倖娲橀妵鍕箛閸撲胶鏆犵紓浣插亾闁告劏鏂傛禍婊堟煛閸愩劌鈧敻骞忛埄鍐闁绘挸鍑介煬顒佹叏婵犲啯銇濇俊顐㈠暙閳藉鈻庨幋顓熺倞濠电姷鏁告慨顓㈠箠閸ヮ剙纾婚柟鎯у绾捐棄霉閿濆牜鍤冩繛鍫熸⒐閵囧嫰鏁冮崒娑欓敪濡炪値鍋勭换鎰弲濡炪倕绻愮€氼亞妲愰崼鏇熲拺闁告稑锕ユ径鍕煕閻樺疇澹樻い顒€锕俊鎼佸煛閸屾瀚奸梻浣告啞缁嬫垿鏁冮敐鍥偨闂侇剙绉甸悡鏇㈡煟濡澧繛鍫熺矋閵囧嫰濮€閿涘嫭鍣伴悗娈垮枟閹歌櫕鎱ㄩ埀顒勬煃闁款垰浜鹃梺褰掝棑缁垳鎹㈠☉娆愮秶闁告挆鍐ㄧ厒闂備胶顢婇婊呮崲濠靛棛鏆︽い鏍仦閸婄兘鏌ｉ姀銏℃毄闁挎稒绮撻弻锝夋偐閸欏顦╅悷婊勬緲閸熸挳宕洪埀顒併亜閹哄棗浜惧銈庡幘閸忔ê鐣峰ú顏勭劦妞ゆ帊闄嶆禍婊堟煙閸濆嫮肖闁告柨绉归弻锝夊Ω閿曗偓閻忔挳鏌＄仦鍓ь灱缂佺姵鐩顒勫幢閳衡偓闁垶鏌熼鈧粻鏍箖濠婂牊瀵犲鍏夋杺閸斿酣骞夐崨濠傜窞闁归偊鍓涢敍娑㈡⒑閻熸澘鈷旂紒顕呭灦瀵煡寮婚妷銉ь啇闁诲孩绋掗…鍥╃不閺嶎厽鐓曢柣妯哄暱閸濈儤鎱ㄦ繝鍛仩缂佽鲸甯掕灒闁煎鍊曞铏節绾版ɑ顫婇柛瀣噽閹广垽宕奸妷褍绁﹂梺鍛婂姦娴滄繈宕伴崱娑欑厱闁哄洢鍔屾晶顔姐亜椤愵剛绡€婵﹥妞介幃鐑藉级閹稿巩鈺呮⒑濞茶骞栭柣妤佹尭閻ｅ嘲鈹戠€ｎ亜绐涢柣搴㈢⊕鑿ら柟鐤缁辨挻鎷呴崜鎻掑壈濠电偟銆嬬换婵嬨€侀幘婢勬棃宕ㄩ鎯у箺婵＄偑鍊栭幐楣冨磻濞戙垹鐒垫い鎺嗗亾闁诲繑绻堥、姘舵晲閸℃瑧鐦堝┑顔斤供閸樺吋绂嶅鍫熲拺闁告稑锕ョ亸顓犫偓娈垮枦閸╂牠寮查妷鈺傗拻濞达絼璀﹂弨鏉款熆閻熸壆澧︽鐐存崌椤㈡棃宕卞Δ鍐摌闂備椒绱徊浠嬫儔閼测晝涓嶉柡鍐ㄧ墛閻撱儲绻涢幋鐏活亪顢旈銈囨／闁硅鍔栭ˉ澶愭婢舵劖鐓ユ繝闈涙婢ф稒銇勮箛鏇炩枅闁诡喕绮欓、娑樷槈濮樸儮鍋撻幒鏃傜＜閺夊牄鍔岀粭褔鏌嶈閸撱劎绱為崱娑樼；闁告洦鍘剧粻鏃堟煙閻戞ɑ灏ù婊勭矋閵囧嫰骞樼捄杞版勃缂備礁鐭佸▔鏇犳閹烘鍋愮€规洖娲犲Σ鍫ユ⒑鐎圭姵顥夋い锔诲灥閻忔帞绱掗悙顒€顎滃瀛樼摃閸婃挳姊婚崒娆愮グ鐎规洜鏁诲畷浼村箛椤旂厧鐏婇悗鍏夊亾闁逞屽墴楠炴垿濮€閻樻牗妫冨畷銊╊敇閻樻彃啸闂傚倷绀佸﹢杈╁垝椤栨凹鍟呭┑鐘宠壘缂佲晛霉閻樺樊鍎愰柣鎾卞劜缁绘盯骞嬮悘娲讳邯椤㈡棃鍩℃导杈╂嚀椤劑宕橀敃鈧禒顕€姊洪崫鍕拱缂佸甯為幑銏犫槈閵忕姴鐎銈嗘⒒閹虫挻绂嶉悙顒傜瘈闂傚牊绋掗ˉ鐘绘煛閸☆厾鐣甸柡宀€鍠愬蹇涘礈瑜忛弳鐘电磽娴ｆ彃浜鹃柣搴秵閸嬩焦绂嶅鍫熺厸鐎广儱鍟埀顒佹礃缁傚秵銈ｉ崘鈹炬嫼闂佺鍋愰崑娑㈠礉閹绢喗鐓曢柟鎯ь嚟閹冲懏绻涢幋鐘虫毈闁糕斁鍋撳銈嗗笒鐎氼參鍩涢幋鐘电＝濞达絽顫栭鍛弿闁逞屽墴濮婃椽宕崟顒€娅ょ紓渚囧枟閹瑰洭鐛崘銊庢梹鎷呴搹鍦婵犳鍠楅敃鈺呭储閹间礁绠繛宸簼閳锋帡鏌涚仦鐐殤濠⒀勭〒缁辨帞鈧綆鍋呯亸鐢电磼椤旂⒈鐓奸柟顔界懇閹粌螣閻撳骸绠炴繝鐢靛Х閺佸憡鎱ㄩ幘顔肩柈闁绘鐗婂▍鐘绘煟閵忋埄鏆柛瀣尵閹叉挳宕熼鍌ゆФ闂備浇妗ㄧ粈渚€鈥﹂悜鑺ュ仒妞ゆ棃鏁崑鎾绘晲鎼粹剝鐏嶉梺绋匡躬閺€閬嶅Φ閸曨喚鐤€闁规崘娅曞▓鍫曟⒑閻戔晜娅呴梺甯到椤繒绱掑Ο璇差€撻梺鍛婄☉閿曘劎娑甸埀顒勬⒒娴ｄ警鐒剧紒銊︽そ瀹曟劕鈹戦崱娆愭閻熸粎澧楃敮妤呭磻閵娧呯＜閻庯綆鍘界涵鍫曟煕閺冩挾鐣辨い顏勫暣婵″爼宕卞Δ鈧鎴︽⒑缁嬫鍎愰柟绋款煼婵＄敻宕熼锝嗘櫍闂佺粯蓱瑜板啴鐛€ｎ喗鍊垫繛鍫濈仢濞呮﹢鏌涚€ｎ亜顏い銏∩戠缓鐣岀矙閹稿簺浠㈠┑鐐舵彧缁蹭粙骞栭銏╁殨闁规儼濮ら埛鎺懨归敐鍛暈闁哥喓鍋炵换娑氭嫚瑜忛悾鐢碘偓瑙勬磸閸ㄦ椽濡堕敐澶婄闁宠桨绀佹晶楣冩⒒娴ｇ顥忛柛瀣╃窔瀹曟洟寮婚妷銉у幈闂佺鎻梽鍕煕閹烘鐓曟い鎰╁€曢弸鏃€绻涢崣澶嬪唉闁哄矉绲介埥澶娾枎閹寸姷鍘掔紓鍌欐祰妞村摜鏁敓鐘靛祦闁规崘顕х粻鎶芥煙鐎涙ɑ鈷愰悗鍨墬缁绘繈鎮介棃娑楁勃闂佹悶鍔庨弫濠氬箖濡警娼╅悹杞扮秿瑜旈弻銊モ攽閸♀晜笑缂備讲鍋撻柛鎰靛枟閻撳啴鏌涘┑鍡楊仼闁哄棙鐟﹂〃銉╂倷閻￠攱鍨归幑銏犫攽鐎ｎ偄浠洪梻鍌氱墛缁嬫劙宕Δ鍛厽闊洦鎸荤粋瀣瑰搴濋偗闁靛棔绀侀～婵嬪箛娴ｅ厜鏋岄梻鍌欐祰椤曟牠宕板Δ鍛櫇闁靛繈鍊曢弸渚€鏌涘畝鈧崑鐐烘偂閵夛负浜滈柡宥冨妿閻擃垰顭跨憴鍕闁哄矉缍侀幃銏ゅ传閵夛箑娅戦梺璇插閸戝綊宕㈤悙顒傜彾闁哄洢鍨圭粻鐟懊归敐鍛础闁告﹢浜跺娲濞戣京鍔搁梺绋匡攻椤ㄥ﹪骞嗙仦瑙ｆ瀻闁规儳顕崢钘夆攽閻愭潙鐏ョ€规洦鍓熷绋库槈濞嗗秳绨诲銈嗗姧缁插潡鎯岄幒妤佺厱闁宠鍎虫禍鐐繆閻愵亜鈧牜鏁幒鏂哄亾濮樸儱濮傞柛鈹惧亾濡炪倖鍨煎▔鏇⑺囬敃鍌涚厓閻犲洦鐓￠崣鍕殽閻愯揪鑰跨€殿喖鐖奸獮瀣煥閸曨偂绨奸梻鍌氬€峰ù鍥敋瑜忛幑銏ゅ箳濡も偓绾惧鏌ｅΟ鍝勬婵炴垯鍨圭粈瀣亜閹邦剝鐧侀柛銉戝拋鍞介梻浣烘嚀閹碱偄螞濞嗘挸妫橀柍褜鍓熷缁樻媴閾忕懓绗￠梺鎸庡哺閺岋綀绠涢弬鍨懙閻庢鍠楁繛濠囧春閳╁啯濯撮柛娆忣槹閺夋悂姊绘担铏瑰笡闁告柨绻樺鎻掆槈濞嗘埈娲搁梺缁樺姦閸撴稓寮ч埀顒勬⒑濮瑰洤鐏叉繛浣冲嫮顩烽柟鐑橆殕閻撴洟鏌″搴′簻闁宠鐗忛埀顒冾潐濞叉牠鎮ラ崗闂寸箚闁归棿绀佸敮闂侀潧鐗嗗ú銊х矓閸ф鈷掗柛灞捐壘閳ь剛鍏橀幊妤呭礈娴ｇ懓鍘归梺鍓插亝濞叉牜绮堥崼鐔虹瘈闂傚牊渚楅崕宀勬煃瑜滈崜銊х不閹惧磭鏆﹂柛顐ｆ处閺佸嫰姊哄▎鎯х仩濞存粓绠栭弻娑樷槈濡吋鎲奸梺绋匡工椤兘寮婚妶澶婄畳闁圭儤鍨垫慨銏ゆ⒑閸涘﹦鎳冩俊顐ｇ箓椤繐煤椤忓嫪绱堕梺鍛婃处閸嬪懎鈻撻銏♀拺缂備焦锕╁▓鏃堟煥閺囥劋绨绘い鏇秮瀹曟ê顔忛鎯у汲闂備礁澹婇崑鍡涘窗閹捐鍌ㄩ梺顒€绉甸悡鐔煎箹閹碱厼鐏ｇ紒澶屾暬閺屾稓鈧綆浜濋崳褰掓煟閿濆懎妲婚柣锝嗙箞閸┾偓妞ゆ帒瀚悞鍨亜閹烘垵鏋ゆ繛鍏煎姈缁绘盯宕ｆ径灞解拡缂備浇浜崑鐐垫崲濠靛鐐婇柕澶堝灩娴滄儳銆掑锝呬壕閻庢鍠楅幐铏叏閳ь剟鏌嶉埡浣告殲闁绘繃濞婂缁樻媴鐟欏嫬浠╅梺绋垮缁挸鐣峰鈧崺鈩冪節閸屾稑鈧垶姊婚崒姘偓鎼佸磹閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒顦伴弲顏堟偡濠婂啰绠婚柛鈹惧亾濡炪倖甯婇懗鍫曞煝閹剧粯鐓涢柛娑卞灠閳诲牊顨ラ悙鍙夘棞闁伙絾绻堝畷鐔煎垂椤愶絾鐝ㄩ梻鍌欑窔閳ь剛鍋涢懟顖涙櫠椤曗偓閺岋綁鏁愰崶褍骞嬮梺杞扮劍閹瑰洭骞冮埡鍛殤妞ゆ帒顦弫鍫曟⒒閸屾瑧顦﹂柛姘儐缁傚秵绂掔€ｎ亞锛熼柡澶婄墑閸斿酣銆呴悜鑺ョ厵闁绘垶锚閻掔偓绻涢幘鎰佺吋闁哄本娲熷畷鐓庘攽閸ヨ埖锛佺紓浣瑰劤婢т粙寮繝姘摕婵炴垶鍩冮崑鎾绘晲鎼粹€茬凹闁诲繐绻掗弫濠氬蓟瀹ュ牜妾ㄩ梺鍛婃尰缁诲牓鏁愰悙鏉戠窞濠电偞甯楀钘夘嚕娴犲鏁囬柣鏃囨腹閸戣棄鈹戦悩缁樻锭闁稿﹤缍婇獮鍐醇閺囩偟鍔﹀銈嗗灱濞夋洟藝閿曞倹鎳氶柡宥庣亹瑜版帗鏅查柛娑卞枟閸犳劗绱撴担鐟板闁稿鍊濆濠氭晲閸℃ê鍔呭銈嗙墬缁孩鐗庨梻鍌欒兌椤牓顢栭崨鏉戠疇婵せ鍋撴鐐插暣濡啫鈽夋潏鈺佸汲闂備礁澹婇崑鍡涘疮閸ф绠┑鐘崇閳锋垹绱掔€ｎ偄顕滄繝鈧导瀛樼厽闁绘梹娼欐慨鍌溾偓瑙勬礃椤ㄥ牊绂掗敂鐣屸攳闁告瑦顭囬惄搴繆閻愵亜鈧牠骞愭ィ鍐ㄧ；闁绘柨鎲″▍鐘绘煏韫囧鈧牠鎮″▎鎰╀簻闁哄洨鍋為崳瑙勭箾閸涱厾校闁靛洤瀚版慨鈧柍鈺佸暟椤︿即姊烘潪鎵槮闁哥喐鎸冲畷娲焵椤掍降浜滈柟鐑樺灥閳ь剚鎮傝棢婵椴搁崰鎰版煟濡も偓閻楀棛绮鑸电厽闁规儳顕妴鎺楁煃瑜滈崜婵嬶綖婢舵劕绠归柍鍝勬噹缁愭鏌″搴″箹缂佺姷濞€閻擃偊宕堕妸褉妲堢紓浣哄Х婵炩偓闁哄本鐩獮鍥煛娴ｈ倽銊╂⒑鐞涒€充壕婵炲濮撮鍡涙偂閻旈晲绻嗘い鏍ㄧ箖椤忕姴霉閻樺磭娲撮柡宀嬬節瀹曡精绠涢弮鈧悵鏃堟⒑鐎圭媭娼愰柛銊ユ健閵嗕礁鈻庨幘宕囩暰閻熸粌绉归悰顔锯偓锝庡枟閸婂灚绻涢崼婵堜虎婵炲懏锕㈤弻娑氣偓锝庝悍瀹搞儵鏌ｉ敐鍥у幋濠碘剝鎮傞弫鍌炲礈瑜忓Σ鍥⒒娴ｅ憡鍟為柛鏃€鍨垮畷婵堜沪閹屽殼闁瑰吋鐣崝宥夊煕閹烘嚚褰掓晲閸噥浠╅柣銏╁灡閻╊垶寮诲☉銏犖╃憸宥囨暜閸洘鎳氶柣鎰劋閻撴洟鏌￠崶銉ュ闁诲繒濞€閺屾盯骞嬮悩娈嬨垽鏌曢崱妯虹瑨妞ゎ偅绻堥弫鎰板川椤掆偓椤ユ岸姊婚崒娆戭槮闁圭⒈鍋婇幆澶嬬附缁嬭法鐛ラ梺鍝勮癁鐏炲墽绋侀梻浣哄帶椤洟宕愰幇鏉跨；闁瑰墽绮ˉ鍫熺箾閹寸儑渚涙俊顐㈣嫰閳规垿鍨鹃搹顐熸灆闂佸摜濮靛銊ノｉ幇鏉跨婵°倐鍋撶紒鐘虫皑閹茬顓兼径濠勫幈闂佸搫鍟崐鑽ゅ閸忕浜滈柡鍥╁仦閸ｅ綊鏌ｈ箛銉хМ闁哄瞼鍠栭悰顕€宕归鍙ユ偅闂備礁鐤囧Λ鍕囬崹顐ｅ弿闁逞屽墴閺岋絽螣濞茶鏅遍梺鍛婅壘閹虫ê顫忕紒妯诲闁惧繒鎳撶粭锟犳⒑閹肩偛濮傛繛浣冲棛浜辨繝鐢靛仦閸垶宕归崷顓犵焼濠㈣泛顑冩禍婊堟煛瀹ュ啫濡奸柣鎺戠秺閺岋繝鍩€椤掍胶顩烽悗锝庡亞閸樹粙姊鸿ぐ鎺戜喊闁告鏅槐鐐哄箣閿旂晫鍘介棅顐㈡储閸庢娊鎮鹃悽鍛婄厵缂佹稑婀辩粔顔尖攽闄囬崺鏍ь嚗閸曨厸鍋撻敐搴″妤犵偞鍔欏铏规嫚閹绘帒姣愮紓鍌氱Т濡瑧绮嬪澶樻晜闁割偅绻勯悡鎴︽⒑閸涘﹥澶勯柛銊╀憾閹€斥槈濮橈絽浜鹃柛蹇擃槸娴滈箖姊洪柅鐐茶嫰婢у鈧娲戦崡鍐差嚕娴犲鏁囬柣鎰暩閺嗩偅绻濋悽闈涗粶婵☆偅鐟╅獮鏍煛閸涱厽鐎梺绯曞墲椤﹂缚銇愰幒鎾存珳闂佸壊鍋嗛崳銉︾閳哄懏鈷戦悗鍦閸ゆ瑧绱掔紒妯哄闁糕晝鍋ら獮瀣晜閽樺鍋撴搴樺亾閻熸澘顥忛柛鐘崇墪閳绘捇鎳滈悽鐢电槇濠电偛鐗嗛悘婵嬫倶闁秵鐓曟繛鍡楃箰閺嗘瑩鏌ｉ敐鍥у幋闁轰焦鍔栧鍕節閸曞灚袨濠碉紕鍋戦崐鏍涙笟鈧畷鎴﹀箛閻楀牆浠煎┑鐐叉▕娴滄繈宕愰悽鍛婄厽闁绘柨鎲＄欢鍙夈亜韫囷絽寮柡灞剧〒閳ь剨缍嗘禍鐑界叕椤掑嫭鐓欐い鏇炴缁♀偓婵犵绱曢崗姗€宕洪敓鐘茬＜婵犲﹤鍟粻鐐烘⒒閸屾瑦绁版い顐㈩槸椤灝顫滈埀顒€鐣烽妷鈺佺劦妞ゆ帒鍊荤壕濂告煏婵炲灝濡肩悮姘舵⒑闂堟稒鎼愰悗姘緲椤曪綁顢楅崟顐ゎ槺闂傚嫬娲畷銉╊敃閳垛晜鏂€濡炪倖姊婚妴瀣绩缂佹ü绻嗛柣鎰煐椤ュ鏌ｉ敐鍥у幋濠碘剝鎮傞弫鍌炲礈瑜忓Σ鍥⒒娴ｄ警鐒鹃柡鍫墰閸掓帗鎯旈妸銉х枃闂佸搫绋侀崢浠嬪煕閹寸偞鍙忛柣鐔哄閹兼劙鏌ｉ幒鎾淬仢闁哄本鐩垾锕傚箣濠婂牆浠愰梻浣虹《閺備線宕戦幘鎰佹富闁靛牆妫楅崸濠囨煕鐎ｎ偅灏甸柣銉簽缁辨帡濮€閻樿尙鐫勯柣搴㈩問閸犳绻涙繝鍥ф瀬闁告劦鍠栭悞鍨亜閹烘垵顏╅柣鎾达耿閺岀喐娼忛崜褏鏆犵紒鐐劤閸氬骞堥妸銉建闁糕剝顨呯粻褰掓⒑閸濆嫭顥滈柣妤佹尭椤繘鎼归崷顓犵厯濠电偛妫欓崕鎶藉礈娴煎瓨鐓熼幖娣灩閸ゎ剟鏌涢幘璺烘灈闁搞劑绠栧顕€宕煎┑鍫О婵＄偑鍊曠换瀣矆娴ｅ湱顩插Δ锝呭暞閻撱儲绻濋棃娑欘棤闁告垵婀辩槐鎺楀Ω閵夛絽浠梺鍝勭灱閸犳牠骞嗛崒鐐蹭紶闁靛鐏濆鍫熲拺闁告繂瀚悞璺ㄧ磼闊厾鐭欓柛鈹垮劜瀵板嫰骞囬鍌ゆ敤闂備胶绮崝鏇㈩敋椤撀颁汗閹兼番鍨荤弧鈧┑鐐茬墕閻忔繈寮稿☉銏＄叆闁哄浂浜滈々顒勬煕閹烘挸娴い銏＄洴閹瑩鎳犻澶婃暩闂傚倷绀侀幉锛勭矙閹烘埈鐒芥繛鍡樺姇椤曢亶鏌ｅΟ鑲╁笡闁绘挸绻愰…鍧楁嚋濞堣法鍔锋繛瀵稿О閸ㄤ粙寮婚弴鐔虹闁绘劦鍓氶悵鏇㈡⒑閹惰姤鏁遍柛銊ユ贡濡叉劙骞掗弬鍝勪壕闁挎繂楠告禍浠嬫煕鎼存稑鍔﹂柡灞剧⊕閹棃鏁嶉崟顓у晪闂備礁鎼悮顐﹀礉閹存繍鍤曢柟缁㈠枛鎯熼梺闈涚墕濞层劌鈻旈崸妤佲拻濞达綁顥撴稉鑼磼閹绘帗鍋ョ€规洘顨呰灒缂備焦锚瀵潡姊洪柅鐐茶嫰婢у瓨顨ラ悙鏉戞诞妤犵偛閰ｉ幐濠冨緞瀹€瀣耿闂傚倷绀侀幉锛勭矙閹达附鍋ら柕濞炬櫆閸嬪倿鏌￠崶銉ョ仾闁绘挻鐟╅弻鐔告媴閸愨晝褰у┑鐐叉噹閹冲酣鍩為幋锕€鐏抽柣鎰娴狀噣姊洪崫鍕拱缂佸鎹囬崺鈧い鎺戯功缁夐潧霉濠婂懎浠﹂柡鍛劜缁绘繂鈻撻崹顔界亪闂佹寧娲╂俊鍥礆閹烘鏁嶆繝濠傛噽閻ｅ爼姊虹紒妯烩拻闁告鍥ㄥ€峰┑鐘插閸犳劗鈧箍鍎遍¨鈧紓宥嗙墵閺屽秹宕崟顐ｆ缂佺偓宕樺Λ鍕箒闂佹寧绻傞幊搴ㄋ夎箛鏂剧箚闁告瑥顦伴妵婵嬫煛鐏炵澧查柟宄版嚇瀹曟粓鎳犻鈧幃鎴︽煟鎼淬値娼愭繛鍙夌墵楠炴牠顢曢敃鈧悡鈥愁熆閼搁潧濮囨い顐㈡嚇閺岋絽螣濞茶鏅遍梺鍛婅壘閹虫ê顫忕紒妯诲闁惧繒鎳撶粭锟犳⒑閹稿骸鍝洪柡灞剧洴閹垽鏌ㄧ€ｎ亙娣柣搴㈩問閸犳骞冮崒鐐靛祦閻庯綆鍠楅弲婊堟偡濞嗘瑧绋婚悗姘冲亹缁辨捇宕掑顑藉亾閻戣姤鍊块柨鏇炲€归弲婵嬫煃鏉炴媽顔夐柡瀣閺岋繝宕橀妸褍顤€闂佺粯鎸鹃崰鎰┍婵犲洤围闁稿本鐭竟鏇熺節绾版ɑ顫婇柛瀣噽缁瑩骞樼拠鑼槴闂佸湱鍎ら〃蹇涘极閸ヮ剚鐓忛煫鍥ㄦ礀鍟稿銈嗘煥閿曨亜顫忓ú顏勬嵍妞ゆ挾鍋樼紓鎾绘⒑閸涘﹥鐓ラ梺甯秮閻涱喗绻濋崶褏顔掗梺缁樺灍閺備線宕戦幘缁樻櫇闁稿本顕遍埡鍛厓閺夌偞濯介崗宀勬煕閺冩挾鐣辨い顏勫暣婵″爼宕卞Δ鍐噯闂佽瀛╅崙褰掑礈濞戞ǚ妲堥柣銏㈩焾閻掑灚銇勯幒鎴濐仾闁抽攱鍨块幃宄扳枎韫囨搩浠奸梺鍛婃閸╂牗绌辨繝鍥舵晝闁靛繒濯导鍐⒑瑜版帗鏁遍柛銊ユ健楠炲啴濮€閵堝懍绱堕梺闈涳紡鐏炶姤娅楅梻鍌氬€烽懗鍫曞箠閹剧粯鍋ら柕濞炬櫆閸嬶繝鏌曟径鍡樻珕闁稿﹤鐖奸弻宥夊传閸曨偅娈剁紒鐐劤閵堟悂寮婚敐鍛傜喖鎮滃Ο閿嬬亞闂備胶绮幐鎼佸Χ閹间礁钃熼柣鏃傗拡閺佸﹦绱掑☉姗嗗剱闁汇倓绶氬铏规嫚閳ヨ櫕鐏嗙紓渚囧枟閻熲晠鐛崘鈺冾浄閻庯綆鍋勯埀顒傚厴閺屾稖绠涢幙鍐┬︽繛瀛樼矋閸庢娊鍩為幋锔藉亹闁圭粯甯楀▓銊х磽娴ｇ瓔鍤欐俊顐ｇ箞瀵鎮㈤搹鍦紲濠碘槅鍨靛▍锝夘敄閸屾稓绡€闁冲皝鍋撶€广儱顦伴宥夋⒑闁稓鈹掗柛鏂跨Ф閹广垹鈹戠€ｎ亞锛滃┑鐐村灦閻熴儵宕滈悽鍛娾拺缂備焦蓱鐏忣亪鏌涙繝鍐疄鐎殿喖顭锋俊鍫曞幢濡搫浼庨梻浣哥秺閸嬪﹪宕楀鈧畷鎴﹀箻鐠囨彃宓嗛梺缁橆焾濞呮洖鈻撴导瀛樷拺闂傚牊渚楀Σ鎾煛閸涱喚鐭掗柛鈺傜洴楠炲鏁傞悾灞藉箞婵犵數鍋為崹鍫曟晝椤愶箑缁╁┑鐘崇閸婂爼鐓崶銊︾叆妞ゃ儱顑囩槐鎺撴綇閵娿儳顑傞梺閫炲苯澧剧紓宥呮瀹曟垿宕ㄩ娆戝墾濡炪倖鎸堕崹鍦兜閳ь剟姊绘笟鍥у缂佸鏁婚幃鈥斥枎閹惧鍘藉┑掳鍊愰崑鎾绘煟濡も偓閿曪箑鈻庨姀銈嗗殤妞ゆ帒鍊婚敍婊堟⒑缂佹◤顏勎熸繝鍥ㄥ亗濠靛倸鎲￠悡娆愩亜閺冨洤浜圭紒澶庢閳ь剝顫夊ú鏍偉婵傛悶鈧線寮崼婵堫槹濡炪倖鎸鹃崳銉╁吹閸曨垱鈷掗柛灞剧懅閸斿秹鎮楃粭娑樻噽閻瑩鏌熼悜妯荤叆闁搞劍绻勯埀顒€鍘滈崑鎾绘煕閺囥劌浜為柛妯绘尦濮婅櫣娑甸崨顔兼锭闂傚倸瀚€氭澘鐣烽幇鐗堝€婚柤鎭掑劤閸樺崬鈹戦悙鍙夘棞婵炲瓨鑹捐灒闁割偆鍠嶇换鍡樸亜閹伴潧澧扮紒鈾€鍋撻梻浣告惈閻绱炴担瑙勫弿闁逞屽墴閺屽秵娼幏灞藉帯婵炲濯崣鍐蓟閿濆顫呴柍杞拌兌娴犳岸姊洪柅鐐茶嫰婢ь喚鐥紒銏犲籍鐎殿喗濞婇弫鍐磼濞戞艾甯鹃梻濠庡亜濞层倝顢栭崨鏉戠劦妞ゆ帊鑳舵晶鐢碘偓娈垮枟閻擄繝銆佸Δ鍛妞ゆ帒鍊搁獮鍫ユ⒒娴ｅ憡鎯堟繛灞傚灲瀹曟繂鐣濋崟顓炵ウ濠殿喗銇涢崑鎾绘煛鐏炶濡奸柍钘夘槸閳诲酣骞嬮悩鍨瘒缂傚倸鍊烽懗鍓佸垝椤栫偞鍎庢い鏍仧瀹撲焦淇婇婊冨付妞ゃ儲宀搁幃妤呮晲鎼存繃鍠氬┑鈽嗗亞閸犳劗鎹㈠┑瀣仺闂傚牊绋愮划鍫曟⒑濞茶绨烽柛妤€鍟块悾鐑藉箛閺夊灝宓嗛梺闈涚箳婵兘宕㈠ú顏呭€垫鐐茬仢閸旀岸鏌熷畡閭﹀剰妞ゎ厼娲俊鎼佸煛閸屾粌甯楅柣鐔哥矋缁挸鐣峰鍫熷亜濠靛倸顦▓銊╂煟閻樺弶澶勭紒浣规綑鍗遍柛顐犲劜閻撳繘鐓崶銊︾妞ゎ偄绉归弻宥夊传閸曨剙娅ら梺缁樻尭缁绘﹢寮诲☉銏╂晝闁挎繂娲ㄩ悾娲⒑闂堚晝鍒版繝鈧潏鈺傤潟闁圭儤鎸鹃悷褰掓煕閵夋垵瀚ぐ搴㈢節濞堝灝鏋涢柨鏇樺劚椤啯绂掔€ｎ剙绁﹂梺褰掑亰閸樹粙宕曢悢鍏肩叆婵犻潧妫欏婵嬫煛閸♀晛寮慨濠勭帛閹峰懏绗熼婊冨Ъ婵＄偑鍊栭崹闈浳涘┑瀣畾闁告洦鍨奸弫宥夋煟閹邦剙绾ф俊宸墴濮婅櫣绱掑Ο鍝勵潓闂佸湱鈷堥崑鍡欏垝婵犳碍鏅插璺侯儑閸樿棄鈹戦绛嬫當婵☆偅顨嗙粋宥咁煥閸忕姷鎳撻…銊╁醇閵忋垺姣囬梻浣告惈鐞氼偊宕濆畝鍕厴闁硅揪绠戦獮銏＄箾閸℃绠伴柟鐣屾暬濮婄粯鎷呮笟顖滃姼濡炪倖鍨靛Λ婵嬬嵁閹达箑鐐婃い鎴︽暜閸嬫挻鎷呴懖婵堝枔閹即鍩勯崘鐐秾濠电姷鏁搁崑娑樜涘▎鎾崇婵°倕瀚ㄦ禍褰掓倵閿濆骸鏋熼柍閿嬪笒闇夐柨婵嗘噺閸熺偤鏌熼姘卞ⅵ闁哄被鍊曠叅閻犲洩灏欐禒顖滅磽娓氬洤鏋熸俊顐㈠暙铻為柛鎰╁妷濡插牓寮堕崼姘珔濠殿喚鍎ゆ穱濠囨倷椤忓嫧鍋撻弴鐘冲床闁规壆澧楅崑瀣煕閳╁啰鎳呭☉鎾崇У閵囧嫰寮介顫勃闂佺锕ら悥濂稿蓟閿濆绠涙い鏍ㄦ皑閸橆偄顪冮妶鍐ㄥ姎妞わ妇鏁婚獮鍐╃鐎ｅ灚鏅梺鎸庣箓閹虫劖绂掔粙搴撴斀妞ゆ梻銆嬮崝鐔虹磼椤曞懎鐏︽鐐茬箻瀹曘劑寮堕幋婵堢崺濠电姷鏁告慨鎾磹閻熸壋鏋旀俊顖濆吹缁♀偓缂佸墽澧楄摫妞ゎ偄锕弻娑氣偓锝庝簼閸ゅ洨鈧娲栫紞濠傜暦閻戠瓔鏁囬柣鎰皺娴滄澘鈹戦悩鍨毄濠殿喚鏁婚幊婵嬪礈瑜忔稉宥夋煥濠靛棭妲归柣鎾卞劦閺岋繝宕掑鍙樿檸闁汇埄鍨崝鎴﹀蓟濞戞埃鍋撻敐搴′簼鐎规洖鐬奸埀顒侇問閸ｎ噣宕抽敐鍛殾闁绘挸绨堕弨浠嬫煕椤愵偄浜濈悮銊︾節绾板纾块柛瀣灴瀹曟劙寮介鐐舵憰闂侀潧顭堥崕娆撴晲婢跺﹪鍞堕梺鎸庣箓鐎涒晠鍩㈠畝鍕拻濞达絽鎲￠幆鍫ユ煛閸偄澧撮柟顖氬椤㈡盯鎮欓崣澶嬓氶梻浣告啞濞诧箓宕归幍顔剧焼闁告劦鍠楅悡鐔兼煙娴煎瓨娑у褌鍗抽弻锟犲幢閳轰礁绫嶅┑顔硷功缁垶骞忛崨瀛樺癄濠㈣泛锕ラ崕顏堟⒒娴ｅ憡鎲稿┑顔炬暬瀹曟繂鈻庤箛鏇熸濠电娀娼уΛ宀勫几鎼淬劎鍙撻柛銉╊棑缁嬭崵绱撳鍛搭€楅柍瑙勫灴閹瑩宕ｆ径鍡樼亞濠电偛鐡ㄧ划宥囨崲閸繄鏆﹂柟杈剧畱绾惧ジ鏌ｉ幇顖氱毢妞ゆ梹鍔楃槐鎾寸瑹閸パ勭亾闂佺娅曢幐濠氬疾閸洖鐭楀璺侯儏瀵潡姊洪幐搴ｇ畵婵☆偅顨嗛幈銊ヮ吋閸℃ê寮挎繝鐢靛Т閹冲繘顢旈悩鐢电＜閺夊牄鍔岀粭鎺楁懚閿濆鐓熼柟鎯х－瀹€鎼佹煕濮橆剙鈧灝顫忕紒妯肩懝闁逞屽墮椤洩顦归柟顔ㄥ棛鐤€婵炴垶宸婚崑鎾绘晝閸屾岸鍞堕梺闈涱檧缁犳垶绂掓總鍛娾拺缂備焦锚閻忓崬鈹戦鍝勨偓婵嗙暦閹邦喚纾兼俊顖氭贡缁犳艾顪冮妶鍡欏缂佽鍊圭粋宥堛亹閹烘挾鍘介梺鎸庢磵閸嬫捇鏌ｅΔ浣瑰碍妞ゎ偄绻愮叅妞ゅ繐瀚鎰版⒑缂佹ê濮堢憸鏉垮暞娣囧﹨顦规慨濠冩そ瀹曘劍绻濋崒姘兼綆闂備礁鎲￠弻銊╂煀閿濆棔绻嗛柛顐ｆ处閺佸鏌嶈閸撴瑩锝炶箛鏃傜瘈婵﹩鍓涢敍婊冣攽閻愬弶顥為柛銊ョ秺閹即濮€閻橆偅鏂€闂佺粯鍔栧妯间焊閸愵喗鐓曢柡鍥╁仧娴犳稒銇勯弮鈧Λ鍐ㄎ涢崨鎼晝闁靛繆鈧剚妲辨繝鐢靛仜瀵爼鏁冮姀銈嗘櫜闁绘劕鎼崡鎶芥煏韫囥儳纾块柛妯绘倐濮婃椽骞栭悙鎻掑闂佺閰ｆ禍鍫曞箖濮椻偓閸╋繝宕ㄩ鎯у箺婵＄偑鍊栭幐楣冨闯閵夈儮鏋旀繝濠傜墛閻撴盯鎮橀悙鎻掆挃婵炲弶鎸抽弻娑㈠煛娴ｅ壊浼冮悗瑙勬礃閿曘垽寮崒婊勫磯闁靛绠戠粈瀣⒒閸屾艾鈧嘲霉閸ヮ剙违闁逞屽墴閺屾稓鈧綆鍋呭畷宀勬煛鐏炶鈧繈鐛笟鈧獮鎺楀箣濠靛棭娼欐繝鐢靛仜閻°劎鍒掑鍥у灊闁规崘顕ч拑鐔兼煥閻斿搫孝缂佲偓閸愵喗鐓忓┑鐐茬仢閸旀鏌涚€ｎ偅灏扮紒缁樼箓椤繈顢楅崒銈呮櫏闂傚倷鑳堕…鍫ユ儔婵傜纾婚柣鎰劋閸嬪倿鏌ｉ弬鍨倯闁绘挻鐟╅弻锝夊箣閻戝洣绶靛┑鐐茬墛閿曘垽寮婚敐澶嬫櫜闁糕剝菧娴犮垽姊洪崫鍕効缂佽鲸娲樼粋鎺楁晝閸屾氨顦悷婊冮叄瀹曟艾鈽夐姀鈾€鎷虹紓渚囧灡濞叉ê鈻嶉弮鍌滅＜缂備焦顭囩粻鎾绘煟閿濆洤鍘存鐐村浮楠炲顢橀悩鎻掓辈闂傚倷绀侀幉锟犲礉瑜忓濠囧礈瑜夐崑鎾愁潩椤撶姴寮ㄥ┑顔硷龚濞咃綁骞忛悩璇茬煑濠㈣泛锕ラ弫顏呬繆閻愵亜鈧倝宕戦崟顖€鍥敍濠婂啫鐤惧┑鐘愁問閸犳濡靛☉銏犵；闁规儳鐏堥崑鎾舵喆閸曨剛顦ㄧ紓浣筋嚙閸婂潡宕洪姀鈩冨劅闁靛牆娲ㄩ弶鎼佹⒑閸濆嫭宸濋柛鐘冲姍椤㈡瑩寮撮悙鈺傛杸闂佺粯顭囩划顖氣槈瑜旈弻娑欑節閸屻倗鍚嬮梺鐐藉劵缁犳挸鐣锋總绋课ㄩ柕澹本鏁ら梻鍌欐祰椤宕曢崗鍏煎弿闁靛牆顦伴崑鍌炴煟閺冨牊娅滅紒璇叉閵囧嫰寮介妸褏顓奸梺鎼炲€栭悷褏妲愰幒妤佸殤閻犲搫鎼幆鐐电磽娴ｄ粙鍝洪悽顖ょ節閻涱噣骞樼拠鑼唺闁诲函缍嗘禍娆撳礆閹烘挾绡€婵炲牆鐏濋弸娑㈡煥閺囶亜顩柛鎺撳浮椤㈡盯鎮欓懠顒夊數闂備礁鎲℃笟妤呭垂闁秴绐楅柛鈩冪⊕閻撴洟鏌￠崶銉ュ濞存粍顨婇弻娑樷攽閸ヨ埖鐤佸┑顔硷功缁垶骞忛崨顔剧懝妞ゆ牗绮屾慨鍏肩節閻㈤潧浠滄い鏇ㄥ弮瀹曟螣娓氼垰娈ㄥ銈嗗姧缁犳垿宕ｆ繝鍥╁彄闁搞儯鍔嶉ˉ鏍磼鏉堛劍宕屾慨濠傤煼瀹曟帒鈻庨幇顔哄仒婵＄偑鍊ら崑鍕囬鐐村仼鐎瑰嫰鍋婂銊╂煃瑜滈崜鐔煎Υ娴ｅ壊娼╅柟棰佺劍闉嬬紓鍌氬€风欢锟犲窗閺嶎厽鍋嬮柟鎯х－閺嗭箓鏌涘Δ鍐ㄤ汗婵℃彃鐗婄换娑㈠幢濡櫣浠村Δ鐘靛仦椤ㄥ棛鎹㈠┑鍡╁殫闂佸灝顑嗙欢鏌ユ煃瑜滈崜姘跺礉濞嗗繒鏆﹂柟杈剧畱缁犺崵绱撴担璇＄劷闁告妫勯埞鎴炲箠闁稿﹥鍔欏畷鎴﹀箻閸撲胶锛滅紓鍌欑劍閿氱紒妞﹀洦鐓曢柟鐑樻尭缁椦呯磼鏉堛劌绗掗摶锝囩磼鐎ｎ亗浠掔紒銊ャ偢濮婄粯鎷呴崨濠傛殘闂佸憡鏌ㄧ换妯侯嚕閹绘巻鏀介悗锝庝簻閸嬪秹姊洪崨濠庢畼闁稿鍔欏銊︾鐎ｎ偆鍘介梺褰掑亰閸樼晫绱為幋锔界厽闊洤顑呴崝銈夋煃瑜滈崜婵嬶綖婢跺⊕娲晝閸屾氨顦梺缁樻煥閸氬宕戝Ο姹囦簻闁哄啫鍊甸幏鈩冪箾缁楀搫濮傞柡灞界Х椤т線鏌涢幘瀵告噰妞ゃ垺宀搁弫鎰緞濡粯娅囬梻浣瑰濞插秹宕戦幘缁樷拺闁告鍋為崰姗€鏌＄仦鐐鐎垫澘瀚埥澶婎煥閸愨晛鈧洟姊绘担鍝ョШ闁衡偓閸楃儐娓婚柦妯侯樈濞兼牗绻涘顔荤盎鐎瑰憡绻傞埞鎴︽偐閹绘帩浼€闂佷紮绲块弫濠氬蓟閿濆棙鍎熼柕蹇曞Т濮ｅ牓姊洪棃鈺冪Ф缂傚秳绶氶悰顕€宕橀钘夆偓鐑芥煕椤垵浜滅痪缁㈠灦濮婃椽妫冨ù銈嗙洴瀹曨亪宕橀鍕搸闂傚倸鍊风粈渚€骞栭位鍥敍閻愭潙浜遍梺鍛婃处閸ㄦ壆绮堟径灞稿亾楠炲灝鍔氭繛灞傚姂閹矂宕卞☉娆戝幈闂佽婢橀崥鈧紒銊ф櫕閻ヮ亪骞嗚閸嬨垽鏌＄仦鍓с€掑ù鐙呯畵瀹曟粏顦俊鎻掔墕閳规垿鎮欑€涙ê鍓归梺闈╃秶缂嶄礁顕ｆ繝姘労闁告劏鏅涢鎾剁磽娴ｅ壊鍎愰悗绗涘啠鏋斿┑鐘崇閸婄敻鎮峰▎蹇擃仾缂佲偓閸愵喗鍋ㄦい鏍ㄧ☉濞搭噣鏌ㄥ┑鍫濅粶闁宠鍨归埀顒婄到閻忔岸寮查敐澶嬪仭婵犲﹤鍟撮崣鍕寠閻斿吋鐓忛柛顐ｇ箥濡插綊鏌嶉柨瀣诞闁哄本绋撴禒锕傚礈瑜庨崳顔剧磽娴ｇ懓濮堟慨濠傛贡閹广垹鈽夊▎鎰€撻梺鍛婂姇瀵埖寰勯崟顖涚厱閻庯綆浜堕崕鏃堟煛鐏炲墽娲撮柛鈺佸瀹曟﹢顢旀担璇℃綌缂傚倸鍊烽懗鑸垫叏闁垮鍙忛柣鎴ｆ閻掑灚銇勯幒鍡椾壕缂備胶濮寸粔鐟扮暦閺囥垹纭€闁诲繒绮浠嬪极閸愵喖纾奸柨鏂垮⒔閳笺倝姊绘担鍛婃儓婵炲眰鍨藉畷鐟懊洪鍛簵闂侀潧顧€婵″洨寮ч埀顒勬⒒閸屾氨澧涚紒瀣浮钘熼柣鎰暘娴滄粓鏌曟径娑橆洭闁瑰啿鎳愮槐鎺撴綇閵娿儳顑傞梺褰掝棑婵炩偓鐎规洩绲惧鍕熸导娆戠闂傚倸鍊风粈渚€骞栭锔藉剹濠㈣泛鐬肩粈濠傘€掑锝呬壕闂佺粯渚楅崳锝呯暦閸洦鏁嗛柍褜鍓涚划鍫ュ磼閻愬鍘卞┑鐘绘涧鐎氼剟宕濋妶鍡欑濠㈣泛锕ラ崑銉︽叏婵犲嫮甯涚紒妤冨枛閸┾偓妞ゆ帒瀚悞鍨亜閹烘垵鈧憡绂掑鍫熺厾婵炶尪顕ч悘锟犳煛閸涱厾鍩ｆい銏＄洴閹瑧鈧數顭堥獮妤佺節瀵伴攱婢橀埀顒佹礋瀹曨垶顢曢敃鈧悡婵嬫煕椤愮姴鍔滈柣鎾跺枑缁绘盯骞嬪┑鍡氬煘濠电偛鎳庣粔鐢搞€冮妷鈺傚€烽柛娆忣槸閺嬬娀鎮楀▓鍨灈濠⒀冮叄楠炴垿宕熼妞诲亾閿曞倸绠ｆ繝闈涙处閻濇繃绻濋悽闈浶ラ柡浣规倐瀹曟垿鎮╃拠鑼唽濡炪倕绻愬Λ娑氱矆婵犲洦鐓冪憸婊堝礈閻旂厧钃熸繛鎴炵懅缁♀偓闂佺鏈〃鍛妤ｅ啯鐓熼柡鍥ㄦ皑閸斿秹妫勭€ｎ剛纾介柛灞捐壘閳ь剙鍢查湁闁搞儯鍔婃禒鍫ユ煕濠靛嫬鍔滈柡鍡樼矒閺岋綁骞囬浣瑰創闂佺粯甯掗悘姘跺Φ閸曨垰绠抽柟鎼灠婵稓绱撴担鍓叉Ш闁轰礁顭峰璇测槈濡粎鍠栧畷妤呭礂閼测晛娑у┑鐘垫暩閸嬬偤宕硅ぐ鎺戞瀬閻犲洩灏欓弳锕€鈹戦崒婊庣劸闁告濞婇弻锝夊棘閹稿孩鍎撳Δ鐘靛仦閸旀瑥顫忕紒妯诲闁惧繐绠嶉埀顒€锕ユ穱濠囧箵閹烘挸娈楅悗瑙勬磸閸ㄦ椽濡堕敐澶婄闁宠桨妞掗幃锝夋⒒娴ｅ湱婀介柛銊ョ秺楠炲鏁撻悩鍐蹭簵濠电偞鍨崹娲磹閸洘鐓熼柟閭﹀幖缁插鏌嶉柨瀣棃闁哄苯绉归幐濠冨緞濡儵鏋呴梻浣侯攰濡嫰鎮ラ悡搴殨濞寸姴顑愰弫鍥煟閺傛寧鎯堟鐐茬墦濮婄粯鎷呯粵瀣秷婵犮垻鎳撻澶婎嚕閹绘巻妲堟繛鍡楁捣缁犳岸姊虹紒妯虹伇濠殿喓鍊濋幃锟犲即閵忊€斥偓鐢告煥濠靛棝顎楀ù婊勭箘閳ь剝顫夊ú鏍儗閸岀偛钃熼柍鈺佸暞婵挳鏌ｉ悢鍛婄凡妞ゎ偄绉归幃妤呭垂椤愶絿鍑￠柣搴㈠嚬閸ｏ綁宕洪埀顒併亜閹烘埊鍔熺紒澶愭涧闇夋繝濠傚閹冲懘鏌ゆウ鍧楀摵缂佺粯绻傞～婵嬵敇濞戞瑥顏烘繝鐢靛仩閹活亞寰婇懖鈺傚闁挎洖鍊归崐鍧楁煕閹炬鎳愰敍婊呯磽閸屾瑧鍔嶉柨姘箾閹碱厼鏋ら柍褜鍓濋～澶娒鸿箛娑樺瀭濠靛倹娼岄崶褏鏆﹂柛銉㈡櫇閿涙粓姊虹粙鎸庢拱婵ǜ鍔岄悺顓㈡⒑閸撗呭笡闁绘濞€瀵鈽夊Ο閿嬵潔闂佸憡顨堥崑鐐烘倶閹剧粯鈷戦柛娑橆煬閻掍粙鏌℃担绛嬪殭妞ゎ偄绻愮叅妞ゅ繐鎳庢禍妤呮煙閸忚偐鏆橀柛銊ㄥ亹濞戠敻鍩€椤掆偓閳规垿鎮╅锝咁€忛梺鍛婃礀閻忔岸鎮炬禒瀣拺闂傚牊绋掓径鍕煕閺冣偓閿曘垼妫熼柣搴ㄦ涧閹芥粎澹曟總绋跨骇闁割偅绋戞俊鑲╃磼濡や胶顣茬紒缁樼洴閹剝鎯旈敐鍥跺晪濠电姷顣介崜婵嬪箖閸岀偛鏋侀柛灞剧矌绾惧ジ鏌曡箛濠傤嚒鐟滃秹鍩為幋锔芥櫖闁告洦鍋傞弶顓㈡⒑缁嬪尅鏀婚柛銊ョ仢閻ｇ兘鎮烽幊濠冩そ椤㈡棃宕ㄩ鐣屽絿闂傚倷绶氬褏鎹㈤幒鎾村弿闁绘垼妫勫Ч鏌ユ煥閺冣偓閸ㄦ繄鎹㈤崱娑欑厪闁割偅绻冮崳娲煕閿濆棙銇濋柡灞剧洴婵″爼宕ㄩ鐔割啋闂備礁鎼懟顖滅矓閻熸壆鏆︽い鎰剁畱缁€瀣亜閹板墎绋绘い鏂跨У缁?)
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
    ElMessage.success('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝洨纾界€广儱鎷戦煬顒傗偓娈垮枛椤兘骞冮姀銈呯閻忓繑鐗楃€氫粙姊虹拠鏌ュ弰婵炰匠鍕彾濠电姴浼ｉ敐澶樻晩闁告挆鍜冪床闂備浇顕栭崹搴ㄥ礃閿濆棗鐦遍梻鍌欒兌椤㈠﹤鈻嶉弴銏犵闁搞儺鍓欓悘鎶芥煛閸愩劎澧曠紒鈧崘鈹夸簻闊洤娴烽ˇ锕€霉濠婂牏鐣洪柡灞诲妼閳规垿宕卞▎蹇撴瘓缂傚倷闄嶉崝宀勫Χ閹间礁钃熼柣鏂垮悑閸庡矂鏌涘┑鍕姢鐞氾箓姊绘担鍛婃儓闁活厼顦辩槐鐐寸瑹閳ь剟濡存担鍓叉建闁逞屽墴楠炲啫鈻庨幘宕囶啇濡炪倖鎸鹃崳銉ノ涜濮婂宕掑▎鎴犵崲濠电偘鍖犻崗鐐☉閳诲酣骞嬮悙瀛橆唶闂備礁婀遍崕銈夈€冮幇顔剧闁哄秲鍔庣弧鈧梻鍌氱墛娓氭宕曢幇鐗堢厸闁告侗鍠氶崣鈧梺鍝勬湰缁嬫垿鍩ユ径鎰闁绘劕妯婂缁樹繆閻愵亜鈧垿宕曢弻銉﹀殞濡わ絽鍟悡姗€鏌熺€电浠滅紒鐘靛█濮婅櫣绮欓崠鈩冩暰濡炪們鍔屽Λ婵嬬嵁閸儱惟闁冲搫鍊搁埀顒€顭烽弻锕€螣娓氼垱楔闂佹寧绋掗惄顖氼潖閾忓湱纾兼俊顖氭惈椤酣姊虹粙璺ㄦ槀闁稿﹥绻傞悾鐑藉箣閻橆偄浜鹃柨婵嗛閺嬬喖鏌ｉ幘璺烘瀾濞ｅ洤锕、娑樷攽閸℃鍎繝鐢靛Л閸嬫挸霉閻樺樊鍎愰柣鎾冲暟閹茬顭ㄩ崼婵堫槯濠电偞鍨剁喊宥夘敃閼恒儲鍙忔慨妤€妫楁晶濠氭煕閵堝棙绀嬮柡宀€鍠撶槐鎺楀閻樺磭浜俊鐐€ら崑鍕箠濮椻偓瀵鏁愰崨鍌滃枛閹筹繝濡堕崨顖欐偅闂傚倷鐒﹂幃鍫曞磿椤栫偛绀夐幖娣妼閸屻劑姊洪鈧粔鐢稿煕閹达附鈷掗柛顐ゅ枍缁惰鲸淇婇幓鎺斿煟闁哄本鐩俊鎼佸Ψ閿旇棄鍓甸梻浣哥枃椤曆呯矓閻熸壆鏆﹂柛顐ｆ处閺佸棗霉閿濆懏鎯堟鐐茬墛缁绘繄鍠婂Ο娲绘綉闂佹悶鍔嶆繛濠傜暦閵忥綆妯勯梺绯曟杺閸ㄨ棄鐣锋總鍛婂亜缂佸鐏濇导搴♀攽閻樺灚鏆╁┑顔碱嚟閳ь剚鍑归崰姘跺极椤斿皷妲堥柕蹇ョ磿閸樼敻鎮楅悷鏉款伀濠⒀勵殜瀹曠敻宕堕埞鎯т壕閻熸瑥瀚壕鎼佹煕閺傝法肖闁瑰箍鍨归埞鎴犫偓锝庝簽椤︺劑姊洪棃娑辩劸闁稿酣浜惰棢闁圭儤鎸剧弧鈧紒鐐緲椤﹁京澹曢崸妤佺厱閻庯綆鍋勯悘瀵糕偓瑙勬礃閸旀﹢藝鐎靛摜纾奸弶鍫涘妽鐏忣厽銇勯锝囩畼闁圭懓瀚伴幖鍦嫚閳╁啯鏆忛梻鍌氬€风粈渚€骞夐敓鐘茬婵☆垶妫块悞濠冪箾閸℃ɑ灏慨瑙勭叀閺屻劑寮撮悙娴嬪亾瑜版帒鐓曢柟鐑橆殕閻撴洘銇勯幇鈺佲偓鏇㈠几瀹ュ洨纾奸柟顖欏嵆閸濊櫣绱掔紒妯笺€掑ù婊勬倐瀵粙濡搁敂鎯х稻闂傚倷绶氬褍煤閵堝洠鍋撳顐㈠祮闁绘侗鍠氶埀顒婄秵閸犳宕戦幇鐗堫棅妞ゆ劦鍋勯獮妤呮煕閺囩偛鏆炵紒缁樼箘閸犲﹥寰勫畝鈧敍鐔兼⒑缁嬫鍎愭い顓炴喘瀹曟岸骞掗幋鏃€鐎婚梺鍦亾缁剁偤濡烽妷锝傚亾閹烘埈娼╅柨婵嗘噸婢规洟鏌ｆ惔銏╁晱闁革綆鍣ｅ畷婊冣枎閹惧磭鍘洪柟鍏肩暘閸斿瞼绮诲杈ㄥ枑閹兼番鍔岀壕瑙勩亜閺嶎偄浠﹂柍閿嬪笒闇夐柨婵嗙墛椤忕娀鏌曢崱妤嬭含闁哄本鐩獮妯尖偓闈涙憸閻ｉ箖姊洪崷顓犳憘闁稿锕ら～蹇涙惞閸︻厾锛滃┑鈽嗗灥閸嬫劙鎮鹃搹鍦＝濞达絿鐡旈崵娆撴煕婵犲倹鍋ョ€规洘妞介幃娆撳传閸曨収鍚呴梻浣瑰濡焦鎱ㄩ妶鍛瀺闁哄稁鍘介埛鎴︽煕濞戞﹫鏀诲璺哄閺屾稓鈧綆浜滈埀顒€鐏濋锝夊醇閺囥劍鏅ｉ梺闈涚箚濡狙囧箯閾忓湱纾藉ù锝呭閸庢劖銇勯幋鐐垫噰闁诡喚鍋為妶锝夊礃閳哄啫骞堝┑鐘垫暩婵挳宕幍顔句笉闁瑰墽绮悡鐔兼煥濠靛棙鎼愰柛妯虹摠椤ㄣ儵鎮欏顔煎壎闂佽桨绀侀崯鎾春閳ь剚銇勯幒鎴濃偓缁樼▔瀹ュ鐓ｉ煫鍥风到娴滄绱掔拠鍙夘棦闁哄本娲熷畷鐓庘攽閸″繐浜鹃柛娑橈功椤╂煡鏌涢幘妤€鎳愰敍婵囩箾鏉堝墽绋荤憸鏉垮暞缁傚秵銈ｉ崘鈹炬嫼缂備礁顑嗙€笛冿耿閹殿喚纾奸悗锝庡亜濞搭喚鈧娲╃紞鈧紒鐘崇洴瀵剟宕滆閻ｉ箖姊绘担铏瑰笡闁告梹鐟╄矾闁稿瞼鍋涢崥瑙勭箾閸℃璐╅柣鐔煎亰閻撱儵鏌涢鐘茬伄闁哄棭鍋婂铏规嫚閳ヨ櫕鐏嶅銈冨妼閻楁捇鐛径鎰妞ゆ棁鍋愰ˇ鏉款渻閵堝棗绗掗柛瀣鍗卞ù鐓庣摠閳锋帒霉閿濆牜娼愰柛瀣█閺屾盯寮懗顖氼伃濡炪値鍘煎ú顓㈠极閹剧粯鍋愰柛鎰紦缁勪繆閻愵亜鈧牠寮婚妸銉庯綁宕奸妷锕€浜滈梺缁樻尭濞寸兘藝瑜斿铏圭磼濡纰嶅┑鐐差嚟閺屽濡甸幇鏉跨妞ゆ棁袙閹风粯绻涙潏鍓хК婵☆偄瀚粋宥堛亹閹烘挾鍘撻悗鐟板婢瑰棙鏅堕敂閿亾鐟欏嫭绀冪紒顔芥尰娣囧﹤顫㈠畝濠冃俊鐐€ら崑鍛洪悢鐓庤摕婵炴垶菤閺嬪酣鐓崶椋庣ɑ濡ゆ梻绱撻崒娆掝唹婵＄嫏鍥х；闁瑰墽绮埛鎺懨归敐鍛础婵犫偓娴犲鐓曢柕濞垮妽椤ュ銇勯鐐寸┛妞わ箑纾槐鎺楀磼濞戞ɑ璇為梺杞扮閸熸潙鐣烽幒鎴旀婵﹩鍓欑粻鐐烘⒒閸屾瑧绐旀繛浣冲洠鈧箓宕奸妷銉э紵闂佽鍎煎Λ鍕及閵夆晜鐓ユ繝闈涙缁€宀勬煕鐎ｎ偅灏甸柟鍙夋尦瀹曠喖顢楅崒銈喰為梻鍌欐祰瀹曠敻宕崸妤€鐤鹃柣妯垮吹瀹撲線鏌涢幇闈涙灍闁稿﹤顭烽弻锕€螣娓氼垱楔闂佹眹鍊曞ú锔炬崲濠靛鍋ㄩ梻鍫熷垁閵忋倖鐓曞┑鐘叉噹閸氬湱绱掗鑺ヮ棃闁圭厧缍婂畷妤佸緞婵犱礁顥氶梺鑽ゅ枑閻熴儳鈧凹鍘剧划鍫ュ醇閵夛妇鍘遍梺缁樏壕顓熸櫠閻㈠憡鐓忛柛鈩冩礈椤︼箓鏌嶉挊澶樻Ц閾伙綁姊洪崹顕呭剾婵炲吋姊圭换婵嗏枔閸喗鐏嶉梺鎸庢磵閺呯姴鐣峰鍐ｆ瀻闁瑰濮崇粭澶娾攽閻愬弶鈻曞ù婊勭箞閸╂盯骞掗幊銊ョ秺閺佹劙宕惰婵℃椽姊洪幖鐐测偓鎰板磻閹剧粯鈷掑ù锝呮啞閸熺偤鏌よぐ鎺旂暫妞ゃ垺鐗楀鍕箛椤旇偐銈﹂梻浣虹《閸撴繈銆冮崼銉ユ辈闁糕剝绋掗悡鏇㈡煛閸ャ儱濡煎ù婊勭矒閺岋絾鎯旈鐓庣睄闂佽鍠楅〃鍫ュ箟閹绢喖绀嬫い鎺戝亞濡差剚绻濋悽闈涗粶闁活亙鍗冲畷婵嬪箣閿曗偓缁犳氨鈧厜鍋撻柛鏇ㄥ亞椤旀帞绱撻崒娆戝妽閼裤倝鏌熷畡閭︾吋婵﹥妞藉畷婊堝箵閹哄秶鏁栭梻浣告憸婵潧煤閻旂厧鏄ラ柍褜鍓氶妵鍕箣閿濆棛銆婇梺娲诲幗閻熲晠寮婚悢纰辨晩闁诡垎鍐ㄧ闂備礁鎼懟顖毭洪銏犳瀬闁稿瞼鍋涚粻姘辨喐瀹ュ憛褔寮婚妷锔规嫽闂佺鏈悷褔藝閿曞倹鐓欐繛鏉戭儏婢ц尙绱掑Δ鍐ㄦ瀻閾绘牠鏌涘☉鍗炲箹闁稿绉瑰娲川婵犲嫮鐣甸柣搴㈠焹閸嬫捇姊洪幐搴ｇ畵妞わ富鍨崇划璇测槈閵忥紕鍘藉┑掳鍊愰崑鎾绘煟濡も偓缁绘ê鐣烽敐澶婄闁靛鍨洪弬鈧梻浣哥枃濡嫬螞濡ゅ懏鍊堕柕澹偓閸嬫挾鎲撮崟顒傤槶闂佽桨绀侀幗婊堝礆閹烘挾绡€婵﹩鍘奸埀顒傚厴閹鈽夊▍顓т簻椤曪綁骞愭惔锝囩槇闂佹眹鍨藉褍鐡梻浣告憸閸ｃ儵宕归懜鍏哥箚闂傚牊绋堥弨浠嬫煕閵夛絽鍔欑紒銊ヮ煼濮婃椽妫冨☉姘辩暰濠碘剝褰冮幊搴ㄥ煝閹炬剚鐓ラ柛顐ゅ枔閸橀亶姊虹€圭媭娼愰柛搴ゆ珪缁傚秹鎮欓璺ㄧ畾闂佺粯鍔︽禍婊堝焵椤掍胶澧遍柡渚囧櫍楠炴帒螖閳ь剛澹曢悷鎵虫斀闁绘ê纾。鏌ユ煕鎼淬埄娈滈柡宀€鍠栧畷婊嗩槾閻㈩垱鐩弻锝夊箻鐠虹儤鐏堥梺鍝勬湰濞叉繄绮诲☉姘ｅ亾閿濆簼绨介柛鏃€鎸冲铏圭磼濡櫣鐟ㄦ繝鈷€鍌滅煓闁诡垪鍋撳銈呯箰閻楀棛绮诲杈ㄥ枑婵犲﹤鐗婇崑鍌氣攽閸屾碍鍟為柣鎾寸洴閹﹢鎮欓崹顐ｇ彧闁轰礁鐗撳铏瑰寲閺囩喐婢掗梺鍛婃尰缁诲牓鐛箛娑樺窛闁哄鍨电粣娑欑節閻㈤潧孝闁哥姵宀稿畷顖炲焵椤掑倻纾介柛灞捐壘閳ь剚鎮傚畷鎰槹鎼淬垹顎涢梺鍦帛鐢晠鎮楅崜浣瑰枑闁哄倽娉曢弳锕傛煙鏉堝墽鐣辩紒鐘差煼閺岋繝宕掑Ο鍝勫闂佸搫鍊甸崑鎾绘⒒閸屾瑨鍏岀紒顕呭灦閺佸姊虹拠鑼鐎光偓缁嬫鍤曢柟鎯版閻撴稑霉閿濆懎绾ч柡鍌楀亾濠碉紕鍋戦崐鏍涙担瑙勫弿闁靛牆娲ｉ悞濠囨煥閺冨牊鏆滈柛瀣尵閹叉挳宕熼鍌ゆО闂備礁鎲″褰掓晝閵忊€茬箚闁汇垻顭堢粻娑㈡煛婢跺孩纭舵い鏂匡躬濮婅櫣娑甸崨顔兼锭闂傚倸瀚€氫即寮鍛傛棃宕ㄩ瑙勫闂備胶鍘ч～鏇㈠磹閺囥垹鍑犻柟杈鹃檮閻撶喖鏌ｉ弮鈧娆撳礉閵堝鐓冪憸婊堝礈濮樿泛浼犻幖娣妼缁€澶屸偓骞垮劚濞层劑鎯屾径灞稿亾楠炲灝鍔氶柟宄邦儔閹繝濡烽埡鍌滃幈濡炪倖鍔戦崐鏇㈠几閺冨牊鐓曟繛鍡楃箲椤ユ粓鏌嶇憴鍕伌闁诡喒鏅濈槐鎺懳熸繝姘殬濠电姷顣藉Σ鍛村磻閸涘瓨鍋￠柍杞拌兌閺嗭箓鏌熼幆鏉啃撻柛濠傤煼閺屻倝骞侀幒鎴濆Б闂佸憡锕㈡禍鍫曞蓟閿濆棙鍎熸い鏍ㄧ矌閵堢兘姊洪崨濠冪叆闁活厼鍊块獮鍐潨閳ь剙顕ｆ繝姘ㄩ柨鏃€鍎抽獮鎰版煟鎼粹€冲辅闁稿鎹囬弻宥堫檨闁告挾鍠庨悾閿嬪閺夋垵鍞ㄥ銈嗘尰婢规洟宕戦幘瀛樺缂侇垱娲橀悗濠氭⒑閸︻厼浜炬繛鍏肩懃閳绘捇濡烽埡鍌楁嫼闂傚倸鐗婄粙鎾存櫠閺囩喓绠鹃悘鐐插€告慨鍌溾偓瑙勬磸閸ㄤ粙銆佸☉妯锋婵°倕鍟伴悾楣冩⒒娴ｈ櫣甯涢柛鏃撻檮缁傚秴顭ㄩ崼婵堝姦濡炪倖甯婄粈渚€鎮樼€电硶鍋撶憴鍕缂傚秴锕獮鏍亹閹烘垶宓嶅銈嗘尵婵兘宕㈤鐐粹拻濞达絼璀﹂弨浼存煙濞茶绨界紒顔碱煼楠炲鏁傞挊澶夌暗闂備胶鍋ㄩ崕鏌ュ礈濮樿埖鍋勯柛鈩冪⊕閸嬶綁鏌涘┑鍡楊仴闁稿鍔戦弻銊╂偄閸濆嫅锝夋煕鐎ｎ亜顏柡灞剧☉閳规垿宕卞Δ濠佺棯闂備浇顕х€涒晜绻涙繝鍌ゆ綎婵炲樊浜滃婵嗏攽閻樻彃顒㈤柣锝呫偢濮婅櫣绮欏▎鎯у壉缂備礁顑嗙敮鐐靛垝閳哄懏鍋勯柣鎾虫捣椤︺劌顪冮妶鍡橆梿鐞氭瑩鏌熷畡閭︾吋婵﹨娅ｇ划娆撳箰鎼淬垺瀚抽梻浣哄帶缂嶅﹦绮婚弽顓炴槬闁逞屽墯閵囧嫰骞掗崱妞惧闂備焦鎮堕崹娲偂閳ョ鑰垮〒姘ｅ亾婵﹥妞介獮鏍倷閹绘帒螚闂佽绻掗崑娑欐櫠娴犲鈧懘顢曢敂瑙ｆ嫽婵炴挻鍩冮崑鎾寸箾娴ｅ啿妫楀▍锝夋⒒娴ｅ憡鍟炴繛鑼枎椤洩顦崇紒鍌涘笒鐓ゆい蹇撴噳閹风粯绻涙潏鍓хК濠殿喓鍊楀☉鐢稿醇閺囩喓鍘遍梺缁橆焾濞呮洜浜告导瀛樼厵濞撴艾鐏濇慨鍌涱殽閻愯揪鑰挎い銏＄懅閹叉挳鏁愰崱妤婁紲婵犵绱曢崑鎴﹀磹閺嶎厽鍋嬫繝濠傜墕绾惧鏌ｉ幇顔煎妺闁稿鍊块弻鏇熷緞濞戞﹩娲紓浣叉閸嬫捇姊婚崒姘偓鎼佹偋婵犲嫮鐭欓柟鐑橆殕閺咁剛鈧箍鍎卞Λ鏃傛崲閸℃稒鐓犻柤瑙勬緲閻撴劖銇勮箛鏇炩枅闁哄苯绉烽¨渚€鏌涢幘瀵哥疄闁挎繄鍋炲鍕箛椤掑偆鍞跺┑锛勫仜椤戝懐鈧稈鏅犻、鏇㈡嚍閵夛箑寮垮┑鈽嗗灠閹碱偊銆傚畷鍥ｅ亾鐟欏嫭灏紒鑸靛哺瀵鍨鹃幇浣告倯闁硅壈鎻徊鑲╁垝閹剧粯鐓欓柛蹇撳悑閸庢鏌ｉ幘宕囧ⅵ鐎殿噮鍋婂畷鍗炩槈濞嗘垵甯楅柣鐔哥矋缁挸鐣峰鍐炬僵妞ゆ挾濮弨铏節閻㈤潧孝闁哥喍鍗抽妴鍛存倻閼恒儱鈧敻鏌ㄥ┑鍡涱€楀ù婊呭仱閺屾稑顫滈埀顒佺鐠轰警娼栨繛宸簼椤ュ牊绻涢幋鐐跺妞わ絾妞藉铏规兜閸涱喚褰ч梺鍛婃⒐閻楃姴顕ｉ弻銉ノㄩ柍鍝勫€甸幏缁樼箾鏉堝墽鍒伴柟璇х節楠炲棝宕奸妷锔惧幐闂佸壊鍋掗崑鍕櫠椤曗偓閹繝濡堕崱鏇犵畾濡炪倖鐗楃换鍌涚瑜版帗鐓曟俊銈勭閸濇椽鏌″畝瀣М鐎殿噮鍣ｅ畷鎺懳旀担鍝ュ降闂傚倷娴囧銊х矆娴ｈ櫣鐭撻柣銏㈩焾缁犵偤鏌曟繛鍨姶婵炵鍔戦弻娑㈠焺閸愮偓鐣跺銈庡亽娴滄粓鍩為幋锔藉€烽柤纰卞墮閳峰牓姊洪崨濞掝亝鏅堕挊澹╋綁骞囬弶璺啋闁诲孩绋掗敋妞ゅ孩鎹囧娲川婵犲嫮鐣甸柣搴㈣壘閹虫﹢寮幘缁樺亹鐎规洖娲ら獮鍫熺節瀵伴攱婢橀埀顒佸姍瀹曟垿骞樼紒妯煎幈闂佺粯妫冮弨閬嶅磻閵夆晜鐓ユ繝闈涚墕娴犫晝绱掗悩宕囨创鐎殿噮鍣ｅ畷鎺戭煥閸涱噮娼撴繝鐢靛У椤旀牠宕板Δ鍛櫇闁冲搫鎳庣粈鍫熺箾閹存瑥鐏柡鍜佸墯缁绘繃绻濋崒姘疁闂佽　鍋撳ù鐘差儐閻撶喖鏌熼柇锕€澧紒鐙欏嫨浜滈柕澹啩妲愰梺璇″枙缁瑩銆佸☉妯锋婵☆垱妲掗惂渚€鏌ｆ惔銈庢綈婵炴彃绻樺畷瑙勭鐎ｎ亜鐎俊銈忕到閸燁偆绮诲☉妯忓綊鏁愰崶銊ユ畬闂佷紮闄勭划鎾愁潖缂佹鐟归柍褜鍓欓…鍥樄闁诡啫鍥у耿婵妫欓鏃堟⒑瑜版帗锛熼柤瀹犳硾閻ｅ灚绗熼埀顒勫蓟閳ユ剚鍚嬮幖绮光偓宕囶啈闂備胶绮幐楣冨窗閹邦厾鈹嶅┑鐘叉搐鍥撮梺鍛婃处閸樺吋淇婃禒瀣厽闊洦鎸荤粋瀣煕濡湱鐭欏┑锛勬暬瀹曠喖顢涘顒€绁俊鐐€曠换鎰涘☉婧惧徍闂傚倸鍊峰ù鍥敋閺嶎厼绐楅柡鍥╁Т閸ㄦ繃绻涢崱妤冪闁哄棴闄勭换婵囩節閸屾粌顣洪梺娲诲幗椤ㄥ懘鈥︾捄銊﹀磯濞撴凹鍨伴崜閬嶆⒑缂佹绠栫紒顔芥尭椤繑绻濆顒傦紲濠电偛妫欑敮鎺楀储閳ユ剚娓婚柕鍫濋楠炴牠鏌ｅΔ浣瑰碍妞ゆ洩缍侀幃浠嬪礈閸欏娅岄梻浣侯焾閺堫剛鍒掓惔銊﹀亗闁瑰墽绮埛鎴︽煟閻旂厧浜伴柛銈囧枛閺屾稓鈧綆鍓欐禒杈┾偓瑙勬礃濞茬喖骞冮姀顫剨濞达綀顫夐弶鎼佹⒒娴ｈ櫣甯涢柨姘扁偓娈垮枦閸╂牕顕ラ崟顖氱妞ゆ牗绋撻崢杈ㄧ節閻㈤潧孝闁稿﹦绮粋鎺戔槈濞嗗秳绨婚梺闈涱煭缁蹭粙宕濋敃鍌涚厵妞ゆ梻鏅幊鍥煙瀹曞洤鈻堟い銏＄墵閹虫顢涘☉鎵佸亾濡ゅ懏鈷掗柛灞剧懅椤︼箓鏌熷ù瀣у亾閹颁焦缍庨梺鑽ゅ枑婢瑰棝寮抽崱娑欑厵闂傚倸顕ˇ锕傛煢閸愵亜鏋涢柡宀嬬秮瀵噣宕奸锝庢闂備礁鎼Λ妤咁敄婢跺娼栨繛宸憾閺佸洭鏌曟繛褍鎳忓▓鎼佹⒒娴ｅ憡鍟為柟鍛婃倐閹儵鎮℃惔顔界稁闂佹儳绻楅～澶屸偓姘哺閺屽秹濡烽妸锔惧涧闂佽绻戦幑鍥ь潖閾忓湱鐭欐繛鍡樺劤閸撴娊姊虹粙娆惧剳闁哥姵鎹囧畷姘跺箳閺傚搫浜鹃柨婵嗛閺嬫稓绱掗悩鍐测枙闁哄矉绻濆畷鎺戭潩椤撶喎鍓靛┑鐐茬摠缁挾绮婚弽顓炶摕闁靛鍎弨浠嬫煕閳╁啩绶遍柍褜鍓氶〃鍛存箒濠电姴锕ら幊搴㈢闁秵鐓涢悘鐐插⒔閳藉鎽堕敐澶嬬厱闊洦鎸搁幃鎴炴叏閿濆懐澧曢柍瑙勫灴椤㈡瑧娑靛畡鏉款潬缂傚倷绶￠崳顕€宕瑰畷鍥у灊妞ゆ挶鍨洪崑鍕煟閹捐櫕鎹ｉ柛濠勫仱閹嘲顭ㄩ崘顎綁鎮楅棃娑樻倯闁诡垱妫冮弫鎰板炊閳哄闂繝鐢靛仩閹活亞寰婃禒瀣妞ゆ劧绲挎晶锟犳⒒閸屾瑧鍔嶉柟顔肩埣瀹曟繄浠︾粵瀣姺闂佽法鍠撴慨瀵哥不閺嶎灐褰掑礂閸忕厧鍓归梺杞扮椤戝寮诲鍫闂佸憡鎸鹃崰鏍箖娴兼惌鏁婇梺娆惧灠娴滈箖鏌ㄥ┑鍡欏嚬闁规煡绠栭弻锝夊棘閹稿寒妫＄紓浣虹帛缁诲牆螞閸愩劉妲堟慨姗嗗墻閺夋悂姊绘担瑙勫仩闁稿﹥鍔欏畷鎴﹀箻缂堢姷绠氶梺缁樺姦娴滄粓鍩€椤戞儳鈧繂鐣烽姀锝冧汗闁圭儤鍨归ˇ顕€姊洪悷鎵憼缂佽瀚板鎶芥晝閸屾稓鍘介梺鍝勫暙閸婄敻骞忛敓鐘崇厸濞达絽鎲￠崰姗€鏌″畝瀣埌妞ゎ偅绮撻崺鈧い鎺嗗亾妞ゎ厼娲╅ˇ鎾煛娓氬洤娅嶅┑鈩冩倐閸╋繝宕掑Δ浣割伜闂傚倷鑳堕…鍫ュ嫉椤掑嫭鍋＄憸鏃囨闂佹寧娲栭崐褰掓偂濞嗘垹妫柡澶婄仢閼哥懓霉濠婂嫬顥嬮柍褜鍓氶鏍窗濮樿泛鏋佸┑鐘冲搸閳ь兛绀佽灃闁告侗鍘鹃崝锕€顪冮妶鍡楃瑨闁稿﹦顭堥锝夊矗婢跺瞼鐦堥梺姹囧灲濞佳囧煝閸喓绠惧ù锝呭暱濞诧箓宕戠€ｎ喚鍙撻柛銉ｅ妽閳锋帡鏌嶇紒妯烩拻闁逞屽墮缁犲秹宕曢崡鐐嶆稑鈽夊鍙樼瑝婵°倧绲介崯顖炴偂濞嗘挻鍊垫繛鎴炵懐閻掍粙鏌熼崘鎻掓殻闁哄矉缍€缁犳稒绻濋崘鈺冨綃闂備礁鎼張顒傜矙閹达絿浜欏┑鐐舵彧缁茶法娑甸崼鏇炲嚑婵炲棙鎸婚埛鎴︽煕濠靛棗顏柣鎺曟硶缁辨挸顓奸崟顓犵崲闂佺粯渚楅崳锝呯暦閸洦鏁嗗璺侯儐濞呭秹姊绘担铏瑰笡闁告梹娲栬灒濠电姴鍋嗛悞浠嬪箹濞ｎ剙濡介柍閿嬪笒闇夐柨婵嗗椤掔喖鏌ｉ幒妤冪暫闁诡喗顨呴埥澶愬箳閹惧褰嗙紓鍌欒兌缁垳绮欓幒鏃€宕叉繝闈涱儏閻愬﹦鎲告惔鈭ワ綁顢楅崟顑芥嫼闂備緡鍋嗛崑娑㈡嚐椤栨稒娅犳い鏍仦閻撳繘鏌涢妷鎴濆枤娴煎啫螖閻橀潧浠﹂悽顖涘浮椤㈡ɑ绺界粙鍧楀敹濠电娀娼уΛ妤呮嚈閹扮増鈷掗柛灞剧懅閸斿秹鏌涢幘鏉戝摵鐎规洖缍婂畷锟犳倶鐠囧弶鎯堟い顓滃姂瀹曘劑顢氶崨顔剧◥闂傚倷绀佸﹢閬嶅磿閵堝拋娼栭柛锔诲幐閸嬫挸顫濋鐐叉懙闂佸搫鐬奸崰鎾舵閹烘嚦鐔煎传閸曨剛绉归梻鍌欒兌椤牓顢栭崱娑樼闁搞儜鍛缂備礁顑堥鎶藉籍閸繄鍔﹀銈嗗笒鐎氼參宕愰崼鏇熺厵闁诡垱婢樿闂佺粯鎸婚惄顖炲蓟濞戙垹绠涢柍杞扮椤绻濋埛鈧崟顒傤槶缂備浇椴哥敮锟犲春閳ь剚銇勯幒鎴濐仼缂佲偓閸愵喗鐓冮柣鐔诲焽娴犳帞绱掗妸銉吋婵﹥妞藉畷顐﹀礋椤愮喎浜鹃柛锔诲幐閸嬫挾绮☉妯荤カ缂傚秵鐗滈埀顒€绠嶉崕鍗灻洪敃鍌氱獥闁规壆澧楅悡娑㈡煕閹扳晛濡垮褎娲熼弻锕傚礃椤忓嫭鐎剧紓浣虹帛閻╊垶鐛€ｎ亖鏋庨煫鍥ㄦ磻閹綁姊绘担铏瑰笡閻㈩垱顨呴—鍐╃鐎ｎ亣鎽曞┑鐐村灟閸ㄥ湱绮诲☉娆嶄簻闁瑰搫妫楁禍楣冩⒑閹惰姤鏁辨俊顐㈠暣瀵鈽夐姀鐘电潉闂佺鏈懝楣冪嵁鐎ｎ亖鏀芥い鏃傘€嬮弨缁樹繆閻愯埖顥夐柣锝囧厴婵℃悂鏁傞崜褏妲囬梻浣告啞濞诧箓宕滃▎蹇婃瀺闁瑰鍋熺弧鈧紒鍓у钃辨い顐躬閺屾稓鈧綆浜濋崳鐣岀磼椤旂晫鎳囨鐐疵…鍧楀礋閸撲胶袦濡ょ姷鍋涘ú顓烆嚕閸撲焦宕夋い顓熷灥閺咁亪姊绘担绛嬪殭閻庢稈鏅濈划娆撳箳濡や焦娅斿┑锛勫亼閸婃洜鈧稈鏅犻獮鎴﹀炊瑜滃鏍ㄧ箾瀹割喕绨荤紒鐘虫皑閹叉瓕绠涢弴鐘辩瑝闂佽鍎兼慨銈夋偂濞嗘挻鐓ｉ煫鍥风到娴滄繈鎮樿箛鏇熸毄缂佽鲸甯￠、姘跺川椤撶偟鐫勯梻浣芥〃閻掞箓骞戦崶顒€绠栭柍鍝勬噹濡﹢鏌曟径娑氱暠妞ゅ繐缍婂濠氬磼濞嗘埈妲┑鐘亾闂侇剙绉埀顒婄畵瀹曞ジ鍩楅埡浣峰濠电偞鍨剁敮妤€鈻嶉崶褜鐔嗛悷娆忓缁€瀣殽閻愬澧柟宄版嚇瀹曠兘顢橀悙鑼杽闂傚倸鍊风欢姘焽瑜旈垾锕傚醇閵夈儳锛欏┑掳鍊曢幊蹇涘磿濡や胶绠鹃柛鈩兩戠亸浼存煟閹捐泛鏋戠紒缁樼洴楠炲鈹戦崱姘厴婵犵數鍋涢幊搴ｇ矓閸洖鐒垫い鎺戝枤濞兼劖绻涢崣澶涜€块柡浣稿暣婵偓闁靛牆鍟犻崑鎾存媴缁洘鐎婚梺鍦亾濞兼瑥鈻撻悢鍏尖拺闂傚牊渚楀褔鎮楅棃娑欐拱缂佸倹甯熼ˇ瑙勬叏婵犲偆鐓肩€规洘甯掗埢搴ㄥ箳閹存繂鑵愮紓鍌氬€风欢锟犲闯椤曗偓瀹曞綊宕奸弴鐐电暫闂佺粯鍨煎Λ鍕綖閸涘瓨鐓忛柛顐ｇ箖閸ｄ粙鏌ㄥ☉娆戞创婵﹥妞介幃鐑藉级鎼存挻瀵栫紓鍌欑贰閸ｎ噣宕归崼鏇炵畺闁炽儲鏋煎Σ鍫熶繆椤栨氨绠扮紓宥咃躬瀵偊骞囬弶璺ㄥ€為梺鍛婃尫缁€浣规叏婵傚憡鈷掑ù锝呮啞閹牊淇婇銏╁殶缂佽京鍋炵粭鐔煎焵椤掆偓椤曪絾绻濆顓熸珫闂佸憡娲︽禍婵嬪礋閸愵喗鐓熼柣妯哄级婢跺嫮鎲搁弶鍨殻闁挎繄鍋ゅ畷鍫曨敆娴ｇ硶鍋撻崹顐ょ闁割偅绻勬禒銏＄箾閸涱噯鑰块柡灞剧洴閺佹劘绠涢弴鐐茬厒闂備椒绱徊鍧楀礂濮椻偓閻涱噣骞掑Δ鈧粻锝嗐亜閹捐泛孝鐎殿喗濞婂缁樻媴閸涘﹤鏆堥梺鍛婃闂勫嫮绮嬪澶婇唶闁哄洨鍋熼敍娑㈡偡濠婂嫭鐓ユい顐㈢箲缁绘繂顫濋鍌︾床婵犵數鍋涘Λ娆撳春閸惊锝夘敋閳ь剙顫忓ú顏勬嵍妞ゆ挻绋掔€氭盯姊虹粙娆惧剰闁挎洦浜幃浼搭敊鐠恒劎鏉稿┑鐐村灦椤洭顢樺ú顏呪拺缂備焦锕╅悞浠嬫煛娴ｈ鍊愰挊婵囥亜閺嶃劎銆掔紒鐘荤畺瀵爼宕煎┑鍡忔寖闂佸憡甯楀姗€鈥﹂崸妤佸仭閻㈩垼鍠栨导鎰渻閵堝骸骞栨繛宸幖椤曪絾绂掔€ｅ灚鏅ｉ梺缁樻煥閹碱偄顕ｆ导瀛樷拻濠电姴楠告禍婊勭箾鐠囇呯暤妤犵偞鍔欓幊锟犲Χ閸℃浼曢梻浣瑰缁嬫垹鈧凹鍠栬灋妞ゆ牜鍋為悡娆愩亜閺嵮勵棞闁哥噥鍨跺畷鎰邦敍濞戞氨顔曢梺鎸庣箓閹冲繘骞栭幇鐗堢叆闁哄洢鍔嬮柇顖炴煏閸℃洜顦﹂柍钘夘槸铻ｉ梺鍨儛濞兼梹绻濋悽闈涗粶婵☆偅鐟╁畷娲醇濠㈩亷绲剧€佃偐鈧稒菤閹风粯绻涙潏鍓хК妞ゎ偄顦靛畷鎴︽偐缂佹鍘遍梺鍝勫€介崕鑽も偓姘卞閵囧嫰顢橀悙鏉戞灎闂佽桨鐒﹂幑鍥箖閳哄懎鐭楅柛灞久崝姘舵婢舵劖鐓ユ繝闈涙瀹告繈鏌曢崱妤嬭含闁哄矉绱曢埀顒婄秵娴滎亪宕ｉ崟顖涚厸鐎光偓閳ь剟宕伴弽顓犲祦闁糕剝鍑瑰Σ濠氭⒑閸濆嫭顥㈠ù婊冪埣瀵鈽夐姀鈥斥偓閿嬨亜韫囨挸顏╂い顒€鐗嗛—鍐Χ鎼存繄鐩庨梺鍝ュ枎閻°劍绌辨繝鍥ч唶闁哄洨鍋涢懓鍨攽閳藉棗鐏ｉ柛搴涘€曢埢鎾活敃閿旇В鎷绘繛杈剧导鐠€锕傛倿閻愵兙浜滈柟瀛樼箖閸犳鈧娲戦崡鍐差嚕閸婄噥妾ㄩ梺鎼炲€栧ú鏍煘閹达附鍋愰悗鍦Т椤ユ繈姊绘担绋胯埞婵炲樊鍙冨濠氬即閻旈绐炲┑鐐村灦濮樸劑寮抽悩缁樷拺闂侇偆鍋涢懟顖涙櫠椤曗偓閺岋綀绠涢弬鍨懙闂侀潧妫楅崯瀛樹繆閻戣棄鐓涢柛灞惧焹閸嬫捇鎮滈懞銉у幘缂佺偓婢樺畷顒勫储閹间焦鐓ｉ煫鍥ㄦ崌閸欏嫭鎱ㄦ繝鍐┿仢鐎规洏鍔嶇换婵嬪礃閿濆棗顏哥紓鍌欒兌閸嬫挸顭垮Ο鑲╃煋閻熸瑥瀚换鍡涙煟閵忋埄鐒剧紒鈧€ｎ偁浜滈柡宥冨妿閳洘绻涢崨顓燁棦婵﹥妞藉畷婊堟嚑椤掆偓鐢儵姊洪崫銉バｉ柣妤佺矌閸掓帗绻濋崶鑸垫櫔闂侀€炲苯澧い?)
    return true
  } finally {
    isSavingTitleMatch.value = false
  }
}

async function importMatchedTorrents() {
  const config = buildTitleMatchPayload()
  if (!config?.fileNamePattern) {
    ElMessage.warning('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝棛绡€闁逞屽墴閺屽棗顓奸崨顖氬Е婵＄偑鍊栫敮鎺楀磹瑜版帒鍚归柍褜鍓熼弻锝嗘償閵忕姴姣堥梺鍛婄懃閸燁偊鎮惧畡鎵殾闁搞儜灞绢棥闂佽鍑界徊濠氬礉鐎ｎ€兾旈崨顔规嫼闂侀潻瀵岄崢濂稿礉鐎ｎ喗鐓曢柕濞垮劤缁夎櫣鈧娲橀崝娆撳箖濞嗘挻鍊绘俊顖濇〃閻㈢粯绻濋悽闈浶㈤柨鏇樺€濆畷顖炲箥椤斿彞绗夐梺鐓庮潟閸婃劙宕戦幘鏂ユ灁闁割煈鍠楅悘宥嗙節閻㈤潧浠滈柨鏇ㄤ簻椤曪綁顢曢敃鈧粈鍐┿亜閺冨洤浜归柨娑欑矊閳规垿鎮欓弶鎴犱桓闂佺厧缍婄粻鏍偘椤曗偓瀹曞ジ鎮㈤崜浣虹暰闂備胶绮崝锔界濠婂牆鐒垫い鎴炲劤閳ь剚绻傞悾鐑藉閿涘嫷娴勯柣搴秵娴滄粓鎮楅銏♀拺闁告捁灏欓崢娑㈡煕鐎ｎ亝顥㈤柕鍡楁嚇瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幗闂佽鍎抽悺銊х矆閸愵亞纾肩紓浣诡焽濞插鈧娲栧畷顒冪亙闂佸憡鍔︽禍鍫曞船閾忓湱纾介柛灞剧懆閸忓苯鈹戦鑺ュ唉闁炽儻绠撻幃婊堟寠婢跺孩鎲伴梻浣瑰缁嬫垹鈧凹浜滈埢浠嬵敂閸℃瑧锛滈柣搴秵娴滅偞绂掗姀銈嗙厓鐎瑰嫰鍋婂Ο鈧梺璇″枟椤ㄥ﹤鐣疯ぐ鎺濇晝闁挎繂娲ら崵鎺楁⒑鐠囨彃顒㈤柛鎴濈秺瀹曟娊鏁愭径濠冩К闂侀€炲苯澧柕鍥у楠炴帡骞嬮姘潬缂傚倷绀侀ˇ闈涱焽瑜斿﹢浣糕攽閻樿宸ラ悗姘煎枤缁鎮欏ǎ顑跨盎闂侀潧楠忕槐鏇㈠箠閸モ斁鍋撶憴鍕８闁告梹鍨块妴浣肝熺悰鈩冾潔濠电偛妫欓崝鏍ь熆閹达附鈷掗柛灞剧懆閸忓瞼绱掗鍛仸鐎规洘绻堝鎾倻閸℃顓块梻浣稿閸嬪懎煤閺嶎厽鍋傛繝闈涱儐閻撴盯鏌涢妷銏℃珒缂佽鲸濞婇弻锝夋偄閻撳簼鍠婇梺缁樻尪閸庣敻寮诲☉銏犲嵆闁靛鍎辩粻濠氭⒑缂佹ɑ灏ㄩ柛瀣尭閳规垿鎮╅崹顐ｆ瘎闂佺顑囬崑鐘诲Φ閹版澘绀冩い鏃囨閳ь剝鍩栫换婵嬫濞戝崬鍓伴梺缁樻尰閿曘垽寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎愰柛鏃€鐗犳俊鐢稿礋椤栨氨鐫勯梺鎼炲劀閸屾稓娼栨繝鐢靛仜椤曨參宕㈣鐓ら柕鍫濐槸閻撴﹢鏌熸潏楣冩闁稿﹪顥撻埀顒傛嚀婢瑰﹪宕板Δ浣规珡闂傚倸鍊烽懗鍫曞磿閻㈢鐤鹃柍鍝勬噹閸ㄥ倿鎮规潪鎷岊劅闁搞倖娲橀妵鍕箛閸撲胶鏆犵紓浣插亾闁告劏鏂傛禍婊堟煛閸屾稑顕滄い顐㈢Ф閹叉悂寮崼婵婃憰濠电偞鍨崹鐟版暜婵＄偑鍊栧Λ浣哥暦閻㈠憡鍎庨幖娣妽閸婂爼鐓崶銊﹀暗缂佺姷绮幈銊︾節閸曨厼绗＄紓浣诡殘閸犳牠宕洪埀顒併亜閹哄棗浜惧銈庡幖濞测晠藝瑜版帗瀵犳繝闈涙储娴滄粓鏌熼弶鍨暢闁伙綁浜堕弻锝夊Χ閸パ傚缂備胶绮换鍐崲濠靛纾兼繝濠傚枤閺嗩偊姊绘担铏瑰笡闁规瓕顕х叅闁绘梻鍘ч拑鐔兼煟閺傛寧鍟炵紓宥呮搐铻栭柨婵嗘噹閺嗙偞銇勬惔锛勑ф慨濠呮缁辨帒螣鐠囨煡鐎烘繝鐢靛仜瀵爼鈥﹂崶顒€绠查柕蹇曞Л閺€浠嬫倵閿濆骸浜芥俊顐㈠暙閳规垿鎮欓弶鎴犱桓闂佽崵鍣ラ崹鎷岀亱闂佺粯鍔曞Ο濠傘€掓繝姘厪闁割偅绻冮崳铏圭磼閸屾凹鍎旈柡灞剧洴楠炴﹢寮堕幋婵囨嚈濠电姷顣槐鏇㈠极鐠囪尙鏆﹂柣鏃傗拡閺佸秹鏌ㄥ┑鍡橆棡婵炲懎娲︽穱濠囨倷椤忓嫧鍋撻弽顐ｆ殰闁圭儤顨呯壕鐟扳攽閻樺疇澹樻慨瑙勭叀閺屾洟宕煎┑鎰ч梺鎶芥敱閸ㄥ潡寮诲☉妯锋斀闁糕剝顨忔禒鎯р攽閻橆偄浜鹃梺瑙勵問閸犳氨澹曟總鍛婂€甸柨婵嗛娴滄粍绻涢幖顓炴灍妞ゃ劊鍎甸幃娆撳矗婢舵ɑ锛嗛柣搴㈩問閸ｎ噣宕抽敐鍛殾闁绘挸瀵掗悢鍡樸亜韫囧海鍔嶆繛鍛躬閺岋紕浠﹂悙顒傤槹閻庤娲滈崢褔鍩為幋锕€鐐婇柤鍛婎問濡囨⒒閸屾瑧顦﹂柟纰卞亰椤㈡牠宕橀鑲╋紮濠电娀娼ч鍛存嫅閻斿吋鐓ユ繝闈涙椤ョ偤鏌涙惔锝呮灈闁哄本娲熷畷鐓庘攽閸♀晛濡风紓鍌氬€哥粔鎾偋閸℃稑鐓橀柟杈鹃檮閸婄兘鏌熺紒妯虹濡ょ姴娲ら—鍐Χ鎼粹€崇濠电偛妯婇崢濂割敋閿濆鏁冮柨鏃傜帛閺咁亪姊洪柅鐐茶嫰婢у鈧娲樺钘夌暦閻旂⒈鏁嶆慨姗€纭稿Σ浼存煟閻斿摜鐭婄紒缁樺笧閸掓帞鎷犲顔藉兊闂佺厧鎽滈。浠嬪箯濞差亝鍋℃繝濠傛噹椤ｅジ鎮介娑辨疁闁轰礁绉归幃銏ゅ礂閼测晛骞楅梻浣侯攰濞咃綁宕戦悢鍏煎仼闁汇垻顣介崑鎾斥枔閸喗鐏嶉悷婊勬緲閸熸挳鍨鹃敃鍌毼╅柍杞扮窔閸炲爼姊虹紒妯荤叆闁圭⒈鍋婇悰顕€宕奸妷锔规嫽婵炶揪绲介幉锛勬嫻閿熺姵鐓曢悗锝庡亝瀹曞矂鏌曢崱妤€鏆ｇ€规洏鍔庨埀顒佺⊕閿氭繛鍫到椤啴濡堕崱娆忊拡闂佺顑嗛惄顖炲箖閸ф鍊锋い鎴濆綖缁ㄥ姊虹憴鍕姢鐎规洦鍓熼幃姗€顢旈崼鐔哄帗闂備礁鐏濋鍛归鈧弻锛勪沪閸撗佲偓鎺懨归悪鍛暤鐎规洘绮忛ˇ鎶芥煕閿濆骸鐏︽慨濠呮缁瑧鎹勯妸褜鍞堕梻浣规た閸樺ジ宕愰崹顕呭殨濠电姵纰嶉崑鍕煕韫囨挸鎮戦柛搴簻椤啴濡堕崱妤€衼缂備浇灏欓弲顐ｇ珶閺囥垹绀冪€瑰壊鍠楃€靛矂姊洪棃娑氬闁哥噥鍋婇幃姗€顢旈崱蹇撲壕闁稿繐顦禍楣冩⒑瑜版帗锛熼梻鍕Ч閸┾偓妞ゆ垼娉曢ˇ锔姐亜椤愶絿鐭掗柛鈹惧亾濡炪倖甯婇悞锕傚矗韫囨稒鐓冪憸婊堝礈閻旂厧钃熼柨婵嗘啒閻斿搫鏋堥弶鍫涘妽椤斿洨绱撻崒娆戠獢濞存粏鍩栫粋宥囨崉娓氼垱缍庣紓鍌欑劍钃卞┑顖涙尦閺屟嗙疀閺囩喎娈岀紓浣广仜閳ь剚鏋奸弨鑺ャ亜閺冨倶鈧顔忛妷锔轰簻妞ゆ挾鍋涘Σ濠氭煟閿濆洤鍘村┑顔瑰亾闂佹寧绻傜€涒晠鐎风紓鍌氬€搁崐椋庢閿熺姴绐楅柡宥庡幐閳ь剨绠撻幃婊堟寠婢跺瞼鏆梻浣稿暱閹碱偊宕幍顔碱棜闁稿繘妫跨换鍡樸亜閺嶃劎鐭婇悽顖濆煐椤ㄣ儵鎮欓懠顒€顤€缂備胶绮换鍫ュ箖娴犲顥堟繛鎴烆殕閸曞啴姊绘担瑙勫仩闁告柨鐭傞幃銉︾附缁嬭法浼嬮梺鎸庢礀閸婃悂鎮欐繝鍐︿簻闁瑰搫妫楁禍鍓х磽娴ｅ搫校婵＄偘绮欏濠氭晲閸涘倻鍠栭幊鏍煛娴ｄ警鍋ч梻鍌欒兌缁垶骞愭ィ鍐ㄧ獥闁哄稁鍘奸拑鐔兼煟閺冨倸甯剁紒鐘虫皑閹茬顓兼径濠冭緢闂備緡鍓欑粔鐢告偂濞戙垺鐓曢柍钘夋楠炴绱掓径妯烘珝闁哄矉绱曟禒锔惧寲閺囩偘澹曢悗瑙勬礀濞诧箑鈻撻弴銏＄厽閹兼惌鍨崇粔鐢告煕閹惧顬奸柍顏嗘暬濮婂宕掑▎鎰偘濡炪倖娲橀悧鐘茬暦娴兼潙绠婚悹鍥ㄥ絻閻庮參姊洪悡搴綗闁稿﹥娲熷畷鐟扳攽閸モ晝顔曢梺绯曞墲椤ㄥ牏绮诲鑸电厸閻庯綆浜崣鍕煛瀹€瀣М妤犵偛娲Λ鍐ㄢ槈濡攱瀚藉┑鐘殿暯濡插懘宕戦崟顐嬫稑鈹戦崱鈺傜稁缂傚倷鐒﹁摫濠殿垱鎸抽弻娑樷槈濮楀牊鏁鹃梺绋垮閹稿墽妲愰幘瀛樺闁告挻褰冮崜浼存煟鎼淬垹鍤柛鐘崇墪瀹撳嫰姊洪崷顓烆暭婵犮垺锕㈠畷锟犲箮閼恒儳鍘藉┑鈽嗗灥椤曆勬櫠椤栨稓绠鹃柤娴嬫櫅閺嬫稒鎱ㄦ繝鍛仩闁瑰弶鎸冲畷鐔碱敃閵忕姌鎴︽⒒娴ｅ壊鍚旈柡澶婄仢椤姊洪崨濠傜瑨闁挎洦浜悰顔碱潨閳ь剟銆佸▎鎾村仼閻忕偠妫勯崣濠囨⒒閸屾凹鐓柛瀣鐓ら柨鏇楀亾閻撱倖鎱ㄥ璇蹭壕閻庤娲滈弫濠氬春閳ь剚銇勯幒鎴濃偓鑽ゅ閽樺褰掓晲閸偄娈愬┑鐐茬墳缁茶法妲愰幒鎾寸秶闁靛濡囬ˇ顓炩攽閳ュ啿绾ч柛鏃€鐟╅悰顔嘉熺亸鏍т壕婵炴垶顏鍫晛闁规儳澧庣壕钘壝归敐鍛础闁宠棄顦伴妵鍕箣濠靛洤娅ｉ梺宕囩帛閹瑰洭銆佸鈧慨鈧柍閿亾闁圭柉娅ｇ槐鎾诲磼濞嗘垵濡介梺鎸庢磵閺呮盯鍩㈤幘璇茬睄闁逞屽墯缁岃鲸绻濋崶鑸垫櫇闂佹寧绻傚ú銊╂偂婢舵劖鈷戦悹鍥ｂ偓铏亶濡炪値鍘煎ú顓㈠春閳ь剚銇勯幒鎴姛缂佸鏁婚弻娑㈡偐閹颁焦鐤侀梺绯曟櫆閻╊垶鐛€ｎ喗鏅滈柣锝呰嫰楠炲牊绻濋悽闈涗沪闁搞劌鐖奸弫鍐敃閵忊晛鏅犻梺闈涱槶閸庮噣寮ㄩ懞銉ｄ簻闁哄啫鍊哥敮鍫曟煃瑜滈崜娆忣焽閳ユ剚鍤曢悹鍥ㄧゴ濡插牓鏌曡箛鏇炐ｆい銉︾箓閳规垿鎮欓崣澶樻￥闂佺顑嗛幐楣冩偡瑜斿缁樻媴閸涘﹤鏆堝銈冨妼閿曘儳绮嬪澶婇唶闁哄洨鍋犻幗鏇炩攽閻愭潙鐏熼柛鈺佸瀵偊宕橀鐣屽帾闂佸壊鍋呯换鍐闯濞差亝鐓熼煫鍥ф唉閸忓瞼绱掓潏銊﹀鞍闁瑰嘲鎳樺畷顐﹀礋閵婏妇鈧壆绱撻崒娆掑厡濠殿喚鏁婚幃褔鎮╁顔兼闁荤姴娲︾粊鏉懳ｉ崼銉︾厪闊洦娲栧暩闂佸憡姊归幐鍐差潖濞差亜宸濆┑鐘插€歌〖闂備礁銈稿褏绱炴繝鍌滄殾闁硅揪绠戠粻鑽ょ磽娴ｅ顏堝焵椤掑倸鍘撮柡灞剧☉閳规垿宕卞Δ濠佺磻婵＄偑鍊栭幐璇差渻閽樺娼栨繛宸簻缁犱即骞栧ǎ顒€鐒烘慨濠冨缁绘繂鈻撻崹顔界亖闂佺锕ュú鐔煎春閵忕媭鍚嬪璺侯煬濞煎﹪姊洪棃娑氬婵☆偄鐭傞獮蹇撁洪鍛嫽闂佺鏈銊︽櫠濞戞ǜ鈧帒顫濋褎鐣堕柛妤呬憾閺岀喓绱掗姀鐘崇亶闂佺粯鎸婚惄顖炲蓟濞戞ǚ妲堥柛妤冨仦閻忔捇姊哄ú璇插箺閻㈩垽绻濆璇测槈閵忕姷鍘搁梺绋挎湰缁秹宕氬☉妯滄棃鎮╅棃娑楁勃闁汇埄鍨界换婵嬫偘椤旂晫绡€闁搞儺鐏涢埡鍛厪濠㈣鍨伴幉娑㈠Ω閳哄倵鎷洪柡澶屽仦婢瑰棝宕濆澶嬬厱闁哄啠鍋撻柣鐔村劦閹箖鎮滈挊澹┾晠鏌嶉崫鍕舵敾闁哄應鏅犲铏圭矙鐠恒劎顔囬梺鍛婅壘椤戝骞冮悙顒傞檮闁告稑艌閹风粯绻涙潏鍓хК婵☆偄瀚板畷銉╂偡閹佃櫕鏂€濡炪倖姊婚崑鎾诲汲椤掑倵鍋撶憴鍕缂佽妫濊棟闁圭虎鍠楅悡娆愵殽閻愯尙浠㈤柣蹇婃櫊閺屽秶鎲撮崟顐や患闂侀€炲苯澧剧紓宥呮缁傚秹鏁愭径濠勵啈闂佸搫娲㈤崹娲煕閹达附鍋ｉ柟顓熷笒婵″ジ鏌＄€ｎ偅鐓ラ柍瑙勫灴椤㈡瑩鎳為妷褏鈻忔俊鐐€ゆ禍婊堝疮閹绢喖绠板┑鐘插暟閻濊埖绻濋棃娑欘棤缂佸妞介弻鈩冩媴閻熸澘顫嶉悗鍨緲鐎氼噣鍩€椤掑﹦绉甸柛瀣閵囨劙宕妷褏锛濋梺绋挎湰閻熲晛顬婇悜鑺ョ厱闁哄倽娉曠粻鑽も偓瑙勬礃閸ㄥ潡鐛崶顒夋晩缂佹稑顑嗙紞妤呮⒒娴ｇ瓔娼愰柛搴㈠▕閹椽濡搁敃鈧崹鏃堟煙缂併垹鏋熼柣鎿勭秮閻擃偊宕堕妸锔绢槰闂佹悶鍊愰崑鎾剁磽閸屾瑧鍔嶆い銊﹀姉閹广垹鈹戦崱鈺傜稁濠电偛妯婃禍婵嬪磹婵犳碍鐓冮柛婵嗗閳ь剙缍婇幃鐢告晝閸屾稈鎷洪梺纭呭亹閸嬫稒鎱ㄩ埀顒€鈹戦悙宸Ч闁烩晩鍨堕獮鍐箚瑜忛弳瀣煙閸愯鏀绘俊鐐扮矙閵嗕線寮崼婵堫槹濡炪倖鎸鹃崑娑滎杺濠电姷顣槐鏇㈠磻閹达箑纾归柡宥庡亝閺嗘粌鈹戦悩鍙夊闁抽攱姊婚埀顒€绠嶉崕鍗炍涘☉顫偓鍛村矗婢跺瞼鐦堟繝鐢靛Т閸婄粯鏅跺☉銏＄厽闁规儳顕幊鍥煛瀹€瀣М妤犵偛顑夐幃妯好虹拋鎶藉仐闂佽鍠楅敃銏′繆閻戣姤鏅滈弶鐐村閻╁酣姊绘繝搴′簻婵炴潙瀚濠冪附閸涘﹦鍔峰銈嗙墱閸嬬偤鎮″☉姘ｅ亾閸忓浜鹃柣搴秵閸撴稖鈪靛┑掳鍊楁慨鐑藉磻閻愯　鈧箓宕堕鈧悞鍨亜閹烘垵顏繛鎳峰洦鐓欓悹鍥囧懐鐦堥悗瑙勬礃閼归箖鍩ユ径鎰潊闁抽敮鍋撻柟閿嬫そ閺岋綁鎮╅崣澶岊槺闂侀€炲苯澧叉繛鍛礋閹ê顓兼径瀣ф嫼闂佸湱顭堢€涒晝澹曢幖浣圭厱闁靛鍊楅惌娆撴煟濞戝崬娅嶇€规洘锕㈡俊鎼佸閿涘嫧鍋撴繝姘拺闁革富鍘兼禍鐐箾閸忚偐鎳勭紒鍌涘笒鐓ゆい蹇撴噳閹疯櫣绱撻崒娆戝妽闁挎艾鈹戦鍏煎枠闁哄本绋戣灒闁煎鍊楅悡澶愭倵鐟欏嫭绀冮柛銊ユ健閻涱喖螣鐏忔牕浜鹃梻鍫熺⊕閹叉悂鏌ｉ敃鈧悧鎾愁潖濞差亜绠归柣鎰絻婵矂姊洪崨濠冪叆闂佸府绲介悾鐑藉閵堝棛鍔堕悗骞垮劚濡盯宕㈡禒瀣厵闁稿繐鍚嬮崕妤呮煕閵娿儳锛嶇紒顔芥閹粙宕ㄦ繝鍕箞闂佽鍑界紞鍡樼濠靛闂憸鐗堝笚閻撶喖鏌ㄥ┑鍡╂▓婵☆偅鍨甸湁闁绘瑥鎳庨々顒傜磼鏉堛劌娴┑顔瑰亾闂佸疇妫勫Λ妤呭疾椤掑嫭鈷掗柛灞剧懆閸忓瞼绱掗鍛仸鐎规洘绻堝鎾倻閸℃顓块梻浣稿悑閹倸顭囪濞嗐垽鎮欓悜妯煎幈闂佸搫娲㈤崝宀勬倶閿熺姵鐓熼柟鎯ь嚟閹冲懘鏌嶈閸撴盯骞婇幘鍨涘亾濮樼厧鏋熼柡鍛版硾铻栭柛娑卞幖閹偤姊洪幖鐐插姉闁哄倷绶氬畷鎴﹀箻閼搁潧鏋傞梺鍛婃处閸撴盯鏁嶅鈧娲川婵犲啰鍙嗙紓浣割槸閻栧ジ鐛幋锕€顫呴柣姗嗗亝閺傗偓闂佽鍑界紞鍡樼閻愮儤鏅繝濠傚暊閺€浠嬪箳閹惰棄纾归柟鐗堟緲绾惧鏌熼幑鎰滈柣鐔煎亰閻撱儵鏌涘☉鍗炲箳濠㈣娲熷娲濞戞瑦鎮欓柣搴㈢濠㈡﹢顢氶敐鍡欘浄閻庯絽鐏氶弲婵嗩渻閵堝骸浜介柛妯圭矙瀹曠喖宕橀瑙ｆ嫽婵炶揪绲块幊鎾诲煝閺囥垺鐓涢柍褜鍓氬蹇涘煛閸屾稒顔囬梻浣告贡閸庛倝銆冮崱娆戜笉闁圭儤顨嗛埛鎺懨归敐鍥ㄥ殌妞ゆ洘绮庣槐鎺旀嫚閹绘巻鍋撻崸妤冨祦濠电姴鎳愰悿鈧┑鐐村灦椤洭寮婚崼銉︹拺缂備焦锚婵鏌涙惔娑樷偓婵嬪箖閿熺姴鍗抽柕蹇ョ磿閸樹粙姊洪崫鍕偓鍦偓绗涘洤绠氶柛顐ｇ贩瑜版帗鍋愮€规洖娲ㄩ悡澶愭⒑閸濆嫭婀版繛鑼枎閻ｇ兘宕￠悙宥囧枛閹煎綊宕烽鐔锋珯婵犵绱曢崑鎴﹀磹閵堝纾婚柛娑卞灡瀹曟煡鏌涢鐘插姌闁逞屽厸缁€浣界亽濠电偛妫涢崑鎾寸搹闂傚倸鍊烽悞锕傛儑瑜版帒纾归柟鎹愬煐椤愯姤鎱ㄥΟ鎸庣【缂佺姵鐗楁穱濠囧Χ閸涱厽娈查梺鍝ュТ濡繈寮诲☉銏犲嵆闁靛鍎遍～顐︽⒑閹稿海鈯曢柣鈺婂灠椤繐煤椤忓嫬绐涙繝鐢靛Т鐎涒晠鎮鹃崼鏇熲拺闁告縿鍎遍弸搴㈢箾绾绡€闁靛棔绀侀～婵嬫嚋閸偅鐝抽梻浣虹《閸撴繈鎮烽姣綊宕熼娑氬幗闁瑰吋鎯岄崹鎶藉礆娴煎瓨鐓熼煫鍥ㄦ煥閸濊櫣鈧鍠楅悡锟犲极閹邦厼绶為悗锛卞嫬顏圭紓鍌氬€搁崐鐑芥倿閿曞倹鏅┑鐘愁問閸犳牠鎮ц箛娑樼疅闁归棿绀佺痪褔鏌涢…鎴濇灍婵炲牜鍙冨鍝勭暦閸モ晛绗￠梺鍦嚀濞诧附绌辨繝鍥ㄥ殝闂傚牊绋撶粣鐐烘煟鎼搭垱鈧儵宕熼顐＄床婵犵數濮烽弫鎼佸磻閻樿绠垫い蹇撴缁€濠囨煃瑜滈崜姘辨崲濞戙垹妞介柛鎰典簼閸嬔囨⒑鏉炴壆璐伴柛鐘崇墵閸┿儲寰勯幇顒夋綂闂佹寧绋戠€氼剙顕ｉ搹顐ょ瘈婵炲牆鐏濋弸鐔兼煥閺囨娅婄€规洏鍨介幖鍦喆閸曨偄绨ラ梻浣虹《閸撴繆褰犳繛瀛樼矋缁捇寮婚垾鎰佸悑闁告劑鍔岄‖瀣⒑閸濄儱鏋欓悘蹇旂懇閸┾偓妞ゆ帒鍠氬鎰版煙椤旇偐鍩ｇ€规洘娲熼幃鐣岀矙閼愁垱鎲伴梻浣告惈濞层垽宕硅ぐ鎺斿祦闁靛繆鈧尙绠氬銈嗙墬缁诲啴顢旈悩缁樼厽闁绘棁顕ч惃铏圭磼鏉堛劍灏伴柟宄版嚇閹煎綊鎮烽幍顕呭仹缂傚倸鍊峰ù鍥敋瑜斿畷鎰板锤濡や焦娅滈梺缁樺姈缁佹挳寮ㄦ禒瀣€甸柨婵嗘噽娴犳盯鏌￠崪鍐М婵﹨娅ｇ槐鎺懳熼弴鐔风伇闁靛洦鍔欏畷姗€鍩￠埀顒傛崲閸℃稒鐓曢柕澶樺枛婢ь垶鏌嶉柨瀣诞闁哄本绋撴禒锕傚礈瑜庨崳顔碱渻閵堝繗顓虹紒鐘冲灴閳ワ箓宕稿Δ浣镐画闁汇埄鍨奸崰娑㈠触椤愶附鍊甸悷娆忓缁€鍐煕閵娿儳浠㈤柣锝囧厴婵℃悂鍩℃繝鍐╂珫婵犵數鍋為崹鍫曟晪缂備降鍔婇崕闈涱潖缂佹ɑ濯撮柛娑橈工閺嗗牆鈹戦悙棰濆殝缂佺姵鎸搁悾鐑藉閵堝棗鈧攱銇勯幒鎴濃偓鐢稿几閺嶎厽鍊垫鐐茬仢閸旀碍銇勯敂鍨祮闁诡喒鈧枼鏋庨柟鎯ь嚟閸橀潧顪冮妶鍡欏缂佸甯炲▎銏ゆ嚑椤掍礁浠忓┑顔筋焾閸╂牠鍩涢幋鐘电＜閻庯綆浜滈惃锟犳椤掑澧紒缁樼⊕閹峰懘宕橀崣澶婎槱缂備胶濮电敮鈥愁潖缂佹ɑ濯撮柣鐔煎亰閸ゅ绱撴担绛嬪殭闁稿﹤娼￠悰顔界節閸愨晛鍔呴梺闈涱焾閸庡弶娼忛崼婵冩斀闁绘劕寮堕ˉ婊呯磼閸撲礁鍘撮柟顔惧厴閺屽洭鏁傞幆褍姹查梻鍌欑閹诧繝宕濊箛娑樼柧闁绘劕鐏氶崗婊堟煃瑜滈崜娑氭閹捐纾兼繛鍡樺姉閵堢増淇婇悙瀛樼稇闁硅姤绮撳顐︻敊閸㈠妫冮崺鈧い鎺戝閳ь剨绠撳畷鍫曨敂閸℃瑦婢戞繝鐢靛仦閸ㄥ爼鈥﹂崒鐐茬厸闁告侗鍠氶崢顏呯節閵忥絽鐓愮紒瀣崌閹箖骞庨懞銉у幗閻熸粌鐭傞幃鐐烘晜閻ｅ备鏀虫繝鐢靛Т濞诧箓宕愰柨瀣ㄤ簻闊洦鎸搁銈夋煕鐎ｎ偅宕屾鐐差儔閺佸啴鍩€椤掑嫬鍨傞柛灞剧〒缁犲墽鈧懓澹婇崰鏇犺姳婵傚憡鐓曢悗锝呭缁♀偓闂佸搫鑻粔鐟扮暦椤愶箑绀嬫い鎺嗗亾婵炲拑绲跨槐鎾存媴閸濆嫅锝夋煟濡ゅ啫鈻堢€殿喛顕ч埥澶愬閻樻鍟嬫繝寰锋澘鈧劙宕戦幘缁樼厱濠电姴鍊荤粔铏光偓瑙勬礈閸犳牕鐣峰鈧、娆戞喆閿濆棗顏归梻浣藉吹婵潙煤閻樿鐒垫い鎺嗗亾缁剧虎鍙冮崺鈧い鎺嗗亾妞ゎ厾鍏樺璇测槈閵忕姴宓嗛梺闈涱焾閸庤京绮婚崷顓犵＝闁稿本姘ㄦ牎闂佸湱鎳撳ú銈夛綖韫囨梻绡€婵﹩鍓涢敍婊冣攽椤旀枻渚涢柛蹇旓耿瀹曟垿骞樼拠鑼啇婵炶揪绲介幗婊堟晬濞嗘挻鍊甸柣鐔告緲椤忣參鏌涚€ｎ亷宸ラ柕鍡樺笚缁绘繂顫濋鐘插箥闂備胶绮崹鎯版懌闂佹娊鏀遍崝鏍Φ閸曨垼鏁冮柨婵嗘椤︺劑姊洪棃娑欐悙閻庢碍婢橀锝夘敋閳ь剟宕洪埀顒併亜閹烘垵顏╃痪鎹愭硶閳ь剝顫夊ú鏍洪敃鍌ゆ晝濞寸姴顑嗛悡蹇涙煕椤愶絿绠ユ俊鎻掔秺閺岋綁骞樼€涙顦梺瑙勫絻閹诧繝骞嗛弮鍫澪╅柨婵嗗€告禍楣冩煕閹伴潧鏋涚€瑰憡绻冮妵鍕冀閵娧呯厒闂佺粯甯掗妶绋款潖閾忓湱鐭欓柟绋垮閹疯京绱撴担鍓插剱閻㈩垪鈧磭鏆﹂柨婵嗙墢閻も偓闂佸搫鍊告晶鐣岀不濮樿埖鈷戠紓浣姑慨宥嗐亜閵堝懎鈧灝鐣烽棃娑掓瀻鐎电増绻勯幊鎾烩€﹂妸鈺佺妞ゆ劑鍨硅闂備礁澧界划顖炴偋閻樿钃熼柨婵嗘媼濞笺劑鏌嶈閸撴瑩鈥﹂崶顏嶆Ъ缂備礁鍊圭敮鎺椻€﹂妸鈺侀唶闁绘柨鎼獮鍫ユ⒒娴ｈ櫣甯涢柡灞诲姂楠炲鏁嶉崟顏嗗墾闂佹寧妫冮弫顕€宕戦幘鑸靛枂闁告洦鍓涢ˇ銊モ攽閿涘嫬浠掔紒顔界懃椤曪綁顢曢敃鈧粻鑽ょ磽娴ｅ顏呯瑜版帗鈷戦柛锔诲幘鐢盯鎮介婊冧槐闁诡喕鍗抽崺锟犲磼濞嗘垹鐣鹃梻浣虹帛閸旓附绂嶅鍫濈劦妞ゆ帊鑳舵晶鍨殽閻愭潙濮嶉柟顔界懇椤㈡鎷呯粙澶哥礋闂傚倷鑳剁划顖炲垂閻撳宫娑㈠礋椤愬诞鍥ц摕闁靛濡囬崢顏堟椤愩垺鎼愭い鎴濇嚇閸┾偓妞ゆ帊鑳舵晶鐢告煕閳哄倻娲存鐐村浮楠炲﹪濡搁妷褏楔闂佽桨鐒﹂崝娆忕暦閹偊妲绘繝纰樺墲濡炶棄顫忓ú顏勭闁绘劖绁撮崑鎾诲箛閺夎法锛涢梺鐟板⒔缁垶鍩涢幒鎳ㄥ綊鏁愰崨顔兼殘闁荤姵鍔х换婵嬪蓟瀹ュ懐鏆嬮柟娈垮枛閳敻鎮楃憴鍕闁搞劌鐏濋悾鐑藉础閻愨晜鐎婚棅顐㈡处閹哥偓绂嶆导瀛樷拻濞达絽鎲￠幆鍫ユ煕閻曚礁浜伴柟顔ㄥ嫮绡€闁搞儜鍜冪幢闂備線娼ц墝闁哄懏绮撻幃锟犲即閻旇櫣顔曢梺鐟邦嚟閸庢垿宕楅鍌楀亾鐟欏嫭鍋犻柛搴ｆ暬瀵鈽夐姀鐘殿啋闂佽偐顭堥悘姘掗崼婵冩斀闁宠棄妫楁禍婊堟煙閾忣偓鑰块柕鍡曠窔瀵挳濮€閻欌偓濞煎﹪姊洪悙钘夊姕闁告挻鑹惧嵄閺夊牃鏅濈壕浠嬫煕鐏炲墽鎳呮い锔奸檮閵囧嫰骞嬪┑鍥舵￥闂佽桨绶￠崳锝夊极閹剧粯鍋愰柛娆忣槹琚ｅ┑鐘垫暩閸嬬偤宕归鐐插瀭闁革富鍘炬稉宥夋煙閹澘袚闁绘挻鐟╅弻锝夊箛椤栨侗妫勬繝寰枫倕浜圭紒杈ㄦ尭椤撳ジ宕崘顓炴儓闁诲孩顔栭崳顕€宕戞繝鍥╁祦闁搞儺鍓欑痪褔鏌涢…鎴濇灓闁绘稈鏅滄穱濠囨倷椤忓嫧鍋撻弽顓炶摕闁靛ň鏅涚憴锕傛倵閿濆簼绨撮柡瀣⒐閹便劌顪冪拠韫婵犳鍠栭敃銉ヮ渻娴犲绠犻柨鐔哄Т鍥撮梺鍛婄☉閹锋垹绱炴笟鈧璇测槈閵忕姵顥濋梺缁樺姇瀵爼宕抽搹鍏夊亾鐟欏嫭绀€鐎殿喖澧庨幑銏犫攽鐎ｎ偒妫冨┑鐐村灥瀹曨剟宕滄导瀛樷拺闁芥ê顦弳鐔兼煕閻樺啿濮夐柟骞垮灩閳藉濮€閻樻鍚呴梻浣虹帛閸旀洟鎮樺璺洪棷妞ゆ挶鍨洪埛鎴犵磼鐎ｎ偄顕滈柟鐧哥秮閺屾盯鎮╅崘鎻掝潕闂佺懓绠嶉崹褰掑煡婢舵劕顫呴柣妯活問閸氬懘姊绘担铏瑰笡闁告梹娲熷畷顖烆敍濮樿鲸娈曠紓浣割儓濞夋洟寮抽敃鍌涚厵閺夊牆澧介悾杈╃磼閻樺樊鐓奸柡宀嬬節瀹曟帒螣閸濆嫬顫氶梻浣告惈閸婄敻宕戦幘缁樷拻闁稿本鐟ㄩ崗宀€鐥鐐靛煟鐎规洘绮岄埞鎴犫偓锝庡亜娴狀參姊洪幐搴㈢５闁稿鎹囬弻宥囩磼濡闉嶉梺闈涚墳缂嶄礁鐣峰鈧崺鈩冩媴妞嬪孩鏆版繝鐢靛Х閺佸憡鎱ㄩ幘顔芥櫇闁靛牆顦粻鐘诲箹濞ｎ剙濡搁柍褜鍓欓崐鍦紦娴犲宸濆┑鐘插€风紓鎾翠繆閻愵亜鈧牠鎮уΔ浣虹懝婵°倐鍋撻柍缁樻尭椤劑宕ㄩ鍕闁荤喐鐟ョ€氼厾绮堥崘顔界厱闁靛绠戦婊兦庨崶褝韬鐐寸墬閹峰懘宕妷銉ョ闂傚倷鑳堕…鍫ュ嫉椤掑倸鍨濈€光偓閸曨厼绁﹂梺鍓插亞閸犲秶鎹㈤崱娑欑厽闁规澘鍚€缁ㄥ鏌嶈閸忔瑩宕愬┑鍡欐殾闁靛骏绱曢々鐑芥倵閿濆簼绨婚柣搴弮濮婃椽宕滈懠顒€甯ラ梺绋款儏濡繈濡撮崨鏉戠煑濠㈣泛鐬奸惁鍫熺節閻㈤潧孝闁稿﹦绮弲璺衡槈閵忥紕鍘介梺瑙勫礃濞夋盯寮搁幋锔界厪闁搞儜鍐句純濡炪們鍨洪敃銏ゅ箖閵忊槅妲归幖瀛樼箖濡﹥绻濋悽闈涗粶闁宦板妿閸掓帡宕奸妷銉ь攨闂佽鍎煎Λ鍕嫅閻斿吋鐓冮柕澶堝劤閿涘秹鏌￠崱妤侇棦闁诡喗顨婇弫鎰償閳ユ剚娼鹃梺钘夊暣娴滆泛顫忕紒妯诲缂佹稑顑呭▓鎰版⒑閹肩偛濡肩€规洦鍓濋悘瀣⒑閸涘﹤濮﹂柛鐘虫崌閸┾偓妞ゆ垼娉曢ˇ锕傛煃閽樺妲告い顐ｇ矒瀹曞崬鈻庤箛鎾磋緢闂傚倸鍊风粈渚€骞夐敍鍕煓闁硅揪绠戠粻顖炴煙鐎电啸缂佲偓婵犲伅褰掓晲閸涱収妫屽┑鐐插悑閻楁鎹㈠☉姗嗗晠妞ゆ棁宕甸惄搴㈢箾绾惧浜瑰┑鐐╁亾闂佸搫鏈ú妯侯嚗閸曨垰閱囨繝闈涙椤ユ繈姊绘担鐟邦嚋缂佽鍊歌灋閹兼番鍨婚々鍙夌節婵犲倻澧涢柣鎾崇箰閳规垿鎮欓懠顑胯檸闂佸憡姊婚弫璇参涢崨鎼晢濠㈣泛锕ら～顐︽⒑闁偛鑻晶鍙夈亜椤愩埄妲搁悡銈夋煛瀹ュ骸骞栫紒鐘侯潐閵囧嫰骞囬崜浣烘殸闂佺粯鎸撮埀顒佸墯閻斿棝鏌ら幖浣规锭濠殿喖娲﹂妵鍕敃閵忊€虫畻闂佸搫鐭夌徊鍊熺亽濠电偠灏褔寮查柆宥嗏拺闁告稑锕ㄦ竟姗€鏌熼搹顐€顏堬綖韫囨洜纾兼俊顖濐嚙椤庢捇姊洪懡銈呮灈闁稿锕畷鐢碘偓锝庝簴閺€鑺ャ亜閺冨倶鈧顔忛妷锔轰簻妞ゆ挾鍋涘Σ缁樸亜閺囶亞绉€殿喖顭锋俊鐑筋敊閼恒儲鐝栭梻鍌欑劍鐎笛兠哄澶婄；闁瑰墽绮悡鏇㈡倶閻愰鍤欏┑顔煎€块弻锛勪沪閸撗€妲堥柧缁樼墵閺屾盯骞囬埡浣割瀱濠殿喛顫夐〃濠傤潖閾忚鍋橀柍銉ュ帠婢规洖鈹戦悙宸殶濠殿喗鎸抽、鏍幢濞戞瑥浜楅梺缁樻閺呰尙鎹㈤崱妯镐簻闁哄秲鍔庣粻鎾趁瑰鍐Ш闁诡喕绮欓、娑樷槈濮橈絽顫岀紓鍌欒兌缁垶鎯勯鐐靛祦濠电姴鍊婚弳瀣煛婢跺鍎ュù鐘叉贡缁辨挻鎷呯粵瀣濠碘槅鍋呴悷鈺備繆閻㈢绀嬫い鏍ㄦ皑閻も偓闂備礁鎲￠幐鐑芥嚄閼哥數澧℃繝鐢靛Х閺佹悂宕戝☉銏″亱濠电姴瀚崹婵堚偓骞垮劚椤︻垱顢婇梻浣告啞濞诧箓宕规导杈剧稏闁告稑鐡ㄩ悡鍐煃鏉炴壆顦﹂柡瀣ㄥ€栨穱濠囶敃閵忕姵娈诲┑顔硷龚濞咃綁宕犻弽顓炲嵆闁绘柨鎽滆ぐ锝囩磽閸屾瑨鍏岀紒顕呭灣閹广垽宕掗悙鏉戜患闂佺粯鍨煎Λ鍕劔闂備礁鍟块幖顐︽晝閵夆晛鐤鹃柍鍝勬噺閳锋垿鎮归崶锝傚亾瀹曞洠鍋撴繝姘厱闁规澘鍚€缁ㄤ粙鏌熼搹顐ゅ⒌婵﹤顭峰畷鎺戔枎閹邦喓鍋橀柣搴ゎ潐濞叉粓寮拠鑼殾濞村吋娼欑粻娑欍亜閺冨倸甯堕柣蹇擄躬閹鐛崹顔煎濠电偛鐪伴崐婵嗙暦閻熸壋鏀介悗锝庡亞閸樼敻姊虹拠鈥崇€婚柛婊冨暟缁€濠囨⒒娴ｅ憡鎯堟俊顐ｆ尦濮婁粙宕熼鍌楁敵婵犵數濮村ú銈呮纯闂備胶顭堥張顒勬儗椤旂晫鐝堕柡鍥ュ灪閳锋帒霉閿濆懏鎲搁柡瀣暞娣囧﹪顢曢姀鐙€浼冮柦妯荤箖閵囧嫰寮介銏犲缂傚倸绉甸悧妤冩崲濠靛顥堟繛鎴濆船閸撻箖姊烘潪鎵槮婵☆偅绻堝璇差吋閸偅顎囬梻浣告啞閹搁箖宕伴弽顓犲祦闁告劑鍓悢鍏煎殥闁靛牆娲ㄥΣ鍥⒒娴ｄ警鐒鹃柡鍫墴閵嗗啴宕卞☉妯活棟闂侀€炲苯澧存慨濠勭帛閹峰懘鎼归悷鎵偧闂備礁鎲″鐟懊洪弽顓ф晪闁挎繂顦柋鍥煛閸ワ絽浜炬繝銏ｅ煐閸旀牠宕愰悜鑺ョ厽闁瑰鍎愰悞浠嬫煕濡吋鏆╃紒杈ㄦ尰閹峰懘宕滈幓鎺戝婵＄偑鍊栭崹鍫曟偡閳哄懎绠栭柨鐔哄У閸ゅ啴鏌嶇憴鍕姢濞存粎鍋撶换娑㈠醇濠靛牅铏庨梺鍝勵儑閸犳牠寮婚敐澶婄妞ゆ牗顨呮禍楣冩煙妫颁胶顦︽繛鍫涘妽缁绘繈鎮介棃娴讹綁鏌ょ憴鍕姢闁轰緡鍣ｅ缁樻媴閻熼偊鍤嬪┑顔硷工缂嶅﹤鐣烽弴銏犵闁伙絽鑻粊锕€鈹戞幊閸婃洟骞婅箛娑樼厱闁圭儤鍤氳ぐ鎺撴櫜闁告侗鍠楅崰鎰磽娴ｅ壊妲规俊鐐扮矙瀵鈽夊锝呬壕闁挎繂绨奸幃宥夋椤掑澧伴柍褜鍓濋～澶娒鸿箛娑樺瀭濞寸姴顑呯粻鏍煙椤栧棗鎳忓▓鏇㈡⒑闁偛鑻晶鎵磼椤旇偐澧涚紒缁樼箞瀹曞爼濡歌楠炲秹姊虹拠鍙夋崳闁轰焦鎮傞垾锕傚醇濠靛洦鐦庣紓鍌氬€烽懗鍫曞磻閹捐纾块柟鎯版鍥撮梺褰掓？缁€渚€鎷戦悢鍝ョ闁瑰瓨鐟ラ悘鈺冪磼閻樺樊鐓奸柡灞诲€楅崰濠囧础閻愭祴鎷绘繝纰樷偓铏枙闁哥姵顨堥幑銏犫槈濮橈絽浜鹃柣銏☆問閻掗箖鏌嶇拠鑼闂囧绻濇繝鍌氭殶闁糕晪绲块埀顒侇問閸犳牠鈥﹂悜钘夊瀭闁诡垎鍛闂佹悶鍎崝宥夋偩閻戣姤鈷掑〒姘ｅ亾闁逞屽墰閸嬫盯鎳熼娑欐珷閻庣數纭堕崑鎾舵喆閸曨剛锛涢梺鍛婎殔閸熷潡顢氶敐鍡欘浄閻庯絽鐏氶弲锝夋⒑缂佹﹩鐒鹃悘蹇旂懇婵″爼鏁冮崒娑氬幗闁硅壈鎻槐鏇㈡偩椤撱垺鐓曢幖娣妺閹查箖鎸婂┑鍠㈠綊宕楅崗鑲╃▏缂備胶濮靛畝鎼佸蓟閿濆绠涙い鎾跺У濞堫剚绻涚€涙鐭嬬紒顔芥崌瀵鎮㈤悡搴ｉ獓闂佸壊鐓堥崳顕€寮抽姀銏㈢＝濞达絽澹婇崕鎾垛偓瑙勬礈閺佺危閹版澘绠抽柟鍨閻鈹戦悩缁樻锭婵☆偅顨婇崺娑氣偓锝庝簴閺€鑺ャ亜閺冨倶鈧宕濋悢铏圭＜妞ゆ洖鎳庨悘锔筋殽閻愯尙绠荤€规洏鍔戦、娆撳礈瑜庨崵灞句繆閻愵亜鈧牠鎮уΔ鍐ㄥ灊閻忕偟鍋撻崣蹇涙煕韫囨稒锛熺紒璇叉閺岋綁骞囬崗鍝ョ泿闂侀€炲苯澧柣妤冨Т閻ｇ柉銇愰幒鎿冩濠电偟顥愬▍鏇犵矙閹达箑鐓橀柟瀵稿Л閸嬫捇鏁愭惔鈥愁潻缂備椒绶ょ粻鎾愁潖妤﹁￥浜归柟鐑樺灣閸犲﹪姊洪崨濞掝亝鏅堕挊澶樺殨鐟滄棃宕洪埀顒併亜閹哄棗浜鹃梺瀹狀潐閸ㄥ潡銆佸▎鎾虫闁靛牆瀚潻鏃堟⒒娴ｅ憡鍟為柟绋款煼閹嫰顢涢悙顏佸亾娴ｇ硶鏋庨柟鎯у暱閼板灝鈹戦悙鏉戠仸闁荤喆鍨介獮蹇撁洪鍛嫼闂佸憡绋戦敃锕傚煡婢舵劖鐓ラ柡鍥朵簽閻ｇ敻鏌涢埡渚婅含鐎殿喗鎸抽幃銏ゆ惞鐠団€虫櫗闂傚倷鑳堕…鍫㈡崲濡ゅ懎纾婚柟鐗堟緲缁犵娀鏌涘☉鍗炵仯缁炬儳鍚嬮妵鍕籍閸パ傛睏婵犫拃宥咁洭闁逞屽墲椤煤閺嶎厼围闁告稑锕ｇ换鍡涙煟閹达絽袚闁哄懏绮撻弻鐔碱敍閸℃鏆熸い鎾瑰亹缁辨捇宕掑顑藉亾閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛濠傛健閺屻劑寮撮悙娴嬪亾瑜版帒鐤炬い蹇撴绾句粙鏌涚仦鍓ф噮闁告柨绉甸妵鍕Ω閵夛富妫為梺浼欑稻缁诲牓鐛弽銊﹀婵繂鏈幉鐗堢節閻㈤潧浠﹂柛銊ョ埣閹柉顦寸€殿啫鍥х劦妞ゆ帒瀚悡娆撴煠閸︻厼顣肩憸鎶婂懐纾奸弶鍫涘妽缁€鍐磼閸屾稑娴柛鈺嬬節瀹曘劑顢欑憴鍕伖闂備浇顕ф绋匡耿鏉堛劌鍨旀い鎾跺剱閻掍粙鏌熼幍顔碱暭闁绘挻娲熼弻鏇熺箾閸喖濮曢梺绋款儍閸庢煡銆冮妷鈺傚€烽柟缁樺笚濞堝姊虹化鏇熸珨缂佺粯绻傞悾鐑筋敂閸涱喖顎撻柣鐔哥懃鐎氼參鎮甸敃鍌涒拻闁稿本鐟чˇ锕傛煕濮橆剦鍎戠紒顔硷躬楠炴﹢顢欓懖鈺傜叄婵犵數鍋涘Λ娆撳垂閸洩缍栭柡鍥╁枍缁诲棙銇勯弽銊х畵闁告艾婀辩槐鎺楀煢閳ь剟宕戦幘缁樷拻濞达絽婀卞﹢浠嬫煕閵娿劍顥夋い顓炴穿椤﹀磭绱掗崒娑樼瑨妞ゎ厹鍔戝畷鐔煎煛閳ь剛鑺辨繝姘拺闁圭瀛╅悡銉╂煟韫囨梻绠撻柣锝囨暬瀹曞崬鈽夊▎鎴濆箥婵＄偑鍊栭悧妤呮嚌妤ｅ喚鏁傛い鎾跺枂娴滄粓鏌曡箛銉х？婵炲弶鎸抽弻鐔碱敊閻ｅ本鍣板銈冨灪濮婂綊骞忛崨瀛樷拹闁归偊鍓﹀Λ婊勭節閻㈤潧浠﹂柟绋款煼瀹曟椽宕橀鑲╋紱闂佽鍎抽悘鍫ュ磻閹炬枼鏋旈柛顭戝枟閻忓棛绱撴笟鍥ф灍闁荤啿鏅犳俊瀛樻媴閸撳弶寤洪梺閫炲苯澧存鐐插暙閳诲酣骞橀弶鎴烆吇闂備焦鎮堕崝宥囩矙閹寸偟顩插Δ锝呭暞閻撴洘銇勯鐔风仴闁哄鎹囬弻锟犲焵椤掍胶顩烽悗锝庡亞閸欏棗鈹戦悙鏉戠仸闁挎碍銇勮箛濠冩珔闂囧鏌ｅΟ鑽ゆ噧闁硅櫕鍔楁竟鏇㈠礂缁楄桨绨婚梺鍝勬川閸嬬偤宕宠ぐ鎺撶厽闊洢鍎抽悾鐢告煛瀹€鈧崰鏍€佸▎鎴犻┏閻庯綆鍋嗛弳銉╂⒑缂佹ɑ灏柛濠冪墵婵＄敻宕熼鍓ф澑闂佸湱鍋撳娆忊枍濠靛鈷戠憸鐗堝笚閺佽鲸淇婇悙鑸殿棄妞ゎ偄绻愮叅妞ゅ繐瀚粣娑欑節閻㈤潧孝閻庢凹鍣ｉ幃楣冩偨閸涘﹦鍘介柟鍏肩暘閸ㄥ綊宕甸鍕厱闁挎繂绻掔粔顔锯偓瑙勬礃濡炶姤鎱ㄩ埀顒勬煃閵夈儳锛嶇紒鎰仱濮婇缚銇愰幒鎴滃枈闂佸憡锕㈢粻鏍х暦閵忋倕纭€闁绘劏鏅滈弬鈧梻浣哥枃濡嫬螞濡ゅ懏鍊堕柣妯虹－缁♀偓闂侀€炲苯澧撮柡灞芥椤撳ジ宕卞Δ鈧竟鎺撶節閻㈤潧浠滄俊顐ｇ懇楠炴劖绻濆顓炰簵濠电偛妫欓崝鎴炵濠婂牊鐓涢柛銉㈡櫅娴狅附銇勯妷褍啸缂佽鲸甯￠崺锕傚焵椤掑嫬纾婚柟鍓х帛閳锋帒霉閿濆洨鎽傞柛銈呭暣閺屾盯鎮╅搹顐㈢３閻庤娲濋～澶岀矉閹烘柡鍋撻敐搴濈敖闁汇倕娲娲传閸曨厸鏋嗛梺鍛娒妶鎼佸箖閳ユ枼妲堟俊顖氱箰缂嶅﹪寮幇鏉垮窛妞ゆ棁妫勯弸鎴︽⒑鐠囨煡鍙勬繛浣冲洤围缂佸顑欏鏍р攽閻樺疇澹樼痪鎯у悑缁绘盯宕卞Ο铏逛淮婵犵鈧尙鐭欐慨濠呮閹风娀鍨鹃搹顐や邯闂備胶绮悧婊堝储瑜旈幃楣冩倻閽樺宓嗛梺闈涚箚閺呮粓寮查鍕拺缂備焦锚婵矂鎮樿箛鏃傛噰閽樻繃銇勯弴妤€浜鹃梺璇″枟椤ㄥ﹪鎮伴鈧畷褰掝敊閻撳寒娼涘┑鐘垫暩閸嬫盯鎯囨导鏉戠闁硅揪绠戠粻姘扁偓鍏夊亾闁告洦鍋勯懓鍨攽閻愭潙鐏﹂柣鐔濆洤鍌ㄩ柟鍓х帛閸嬧剝绻濇繝鍌氼伀闁活厽甯為埀顒冾潐濞叉鍒掑畝鍕剁稏婵犻潧娲︾紞鍥煏婵炲灝鍔氱紒銊ｅ劜缁绘繈鎮介棃娑楁勃闂佹悶鍔岄悥鐓庣暦濞差亜绀冩い鏃囧亹閿涙盯姊洪悷鏉库挃缂侇噮鍨跺畷鎴﹀Ω閿斿墽顔曢梺鍓插亾缁插墽娑甸崼鏇熺厱闁哄啠鍋撻柟顔煎€块獮鍐崉娓氼垱鍍甸梺闈涱槶閸庤鲸鎱ㄩ敃鈧埞鎴︻敊绾攱鏁惧┑锛勫仩濡嫰鎮鹃悜绛嬫晝闁挎洍鍋撶紒鈧€ｎ偁浜滈柟鍝勬娴滄儳鈹戦悙鍙夊櫡闁稿﹥顨堝Σ鎰板箻鐎靛摜鎳濋梺鎼炲劀閸曨厺閭紓鍌氬€风粈渚€藝椤栨稒娅犻幖娣妼缁€鍡涙煙閻戞ê鐒炬繛灏栨櫆閵囧嫰骞樼捄鐑樼亖缂備礁顦悥鐓庮潖濞差亝顥堟繛娣€栭惄顖氱暦閵娾晩鏁嶆繛鎴ｉ哺缂嶅姊婚崒姘偓鎼佸磹閻戣姤鍊块柨鏇炲€哥粻鏍煕椤愶絾绀€缁炬儳娼￠弻鐔虹磼閵忕姵鐏堥梺鍝勫閸庣敻寮婚垾鎰佸悑閹肩补鈧磭顔愰梻浣圭湽閸婃宕戦幘鑸靛床婵犻潧顑嗛ˉ鍫熺箾閹存繂鑸归柛鎾讳憾濮婃椽骞庨懞銉︽殸闂佹悶鍔岄悘婵嬶綖韫囨梻绡€婵﹩鍓熼崬鍫曟⒑缂佹ɑ鈷愬ù婊€绮欓崺鈧い鎺嶇缁椦呯磼鏉堛劌娴柟顔规櫊楠炴捇骞掗幘瀵告И闂傚倷绀侀悿鍥綖婢舵劕鍨傞柛褎銇滈埀顑跨閳藉濮€閳╁啯鐝抽梻浣告啞娓氭宕㈡ィ鍐炬晩闁硅揪闄勯埛鎴︽偣閸ャ劎鍙€闁告瑥瀚换娑欐媴閸愬弶鎼愰崶瀵哥磽娴ｅ壊鍎撴繛澶嬫礋瀵娊鏁傞懞銉ュ伎濠碉紕鍋犻褎绂嶉幆褜娓婚柕鍫濆暙閻忣亪鏌ｉ悢鍙夋珚妤犵偞鍔栫换婵嬪礃閵娧呯嵁闂備胶纭堕崜婵嬪Φ閻愬鐝堕柡鍥ュ灪閳锋垿鏌涢幘鐟扮毢闁告ɑ鐩弻娑氣偓锝庝簼椤ョ姷绱掗鍓у笡闁靛牞缍佸畷姗€鍩￠崘銊ョ疄濠碉紕鍋戦崐鏍礉瑜忓濠勬崉閵娧傜瑝濠碘槅鍨伴妶鍊熴亹閹烘挸浜瑰銈嗘閸嬫劖瀵奸崼銉︹拺闁告繂瀚悞璺ㄧ磼鏉堛劍绀嬮柛鈹惧亾濡炪倖甯掗敃锔剧矓閻㈠憡鐓曢柟鎯ь嚟閹冲洨鈧鍠楅幃鍌氼嚕椤曗偓瀹曞ジ鎮㈤崫鍕闂傚倷绀侀幉锟犳偡閵夆敡鍥ㄥ閺夋垹锛欓梺褰掑亰閸犳帡宕戦幘鏂ユ灁闁割煈鍠楅悘鍫ユ⒑缂佹澧遍柛妯犲洦鍋╅柣銈庡灛娴滃綊鏌熼悜妯肩畺闁哄應鏅犲娲礂闂傜鍩呴梺绋垮濡炶棄鐣烽婧惧亾閿濆骸鏋熼柍閿嬪浮閺屾稓浠﹂崜褎鍣梺绋跨箰閻ジ鎯€椤忓牜鏁囬柣鎰版涧閻撶喖鎮楀▓鍨珮闁告挾鍠庨悾鐑藉箳濡や礁鈧兘鏌熺紒妯虹闁逞屽墻閸樺ジ鍩為幋锔藉€烽柛娆忣槴閺嬫瑦绻涚€涙鐭嬬紒顔兼捣閸掓帞鎷犲顔藉兊闂佺厧鎽滈弫鎼佸储閹间焦鈷戦柛娑橈工婵倿鏌涢弬鍨劉闁哄懎鐖煎鎾閻樼數鏆伴梻浣虹帛閺屻劑宕ョ€ｎ喖鐓曢柟杈鹃檮閳锋帡鏌涢銈呮瀻闁哥姵娲滅槐鎺楀箟鐎ｎ剛鐦堥梺璇″枟閿曘垽骞冨▎鎴炲磯闁烩晜甯楅幐鑽ゆ崲濞戙垹宸濇い鏃傜摂濡啫鈹戦纭峰伐妞ゎ厼鍢查悾鐑藉箳閹搭厽鍍靛銈嗗灱濡嫭绂嶉幆褜娓婚悗锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鏉戭潩鏉堚敩銏ゆ⒒娴ｈ鍋犻柛搴灦瀹曟繂鐣濋崟鍨櫔闂備緡鍓欑粔鐢告偂濞戞﹩鐔嗛悹杞拌閸庡繘鏌ｈ箛瀣姦闁哄矉绲鹃幆鏃堫敊閻撳海鐫勬繝娈垮枛閿曘劌鈻嶉敐鍥潟闁圭儤鍤﹂悢鍏煎€婚柍鍝勫€搁娲⒒閸屾瑧顦﹂柟璇х節閳ワ箓宕卞☉妯虹獩濡炪倖鎸嗛崟鍨紖濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣銏ゆ涧閺嬪牏鈧箍鍎遍ˇ浼村磻閸屾稓绠鹃柛鈩兩戠亸浼存煟閹惧瓨绀嬮柡宀€鍠栭幃娆擃敆婢跺鏆ラ梻浣烘嚀閸熷灝霉妞嬪骸鍨濇い鎾卞灪閺呮悂鏌ｅΟ缁樼伇闁圭柉娅ｇ槐鎾存媴閸撴彃鍓卞銈嗗灦閻熲晛鐣烽弴鐑嗗悑濠㈣泛顑囬崢閬嶆⒑閸濆嫬鏆婇柛瀣崌閺屾盯濡搁妷褌铏庡銈嗘穿缁插潡骞忛悩瑁佸湱鈧綆鍋掑鏃€绻濈喊妯活潑闁搞劌鐖煎銊╂焼瀹ュ繒绋忛悗骞垮劚閹冲寮ㄩ懞銉ｄ簻闁哄啫鍊婚幗鍌涚箾閸喐顥堥柡宀嬬到铻栭柍褜鍓欒灋婵炲棙鎸哥粻鐐烘煏婵炲灝鍔楁俊鎻掔墦閺屾洝绠涙繝鍐锯偓鍡涙煙闁垮銇濇慨濠冩そ瀹曘劍绻濋崟銊︻潔闂備焦鍓氶崹鍗灻洪悢鐓庣疇闁哄稁鍘奸悡娑樏归敐鍛喐濞存粎澧楃换婵嬫偨闂堟稐绮跺┑鈽嗗亝椤ㄥ懘婀佸┑顔斤供閸擄箓鎮炴禒瀣厸鐎广儱鍟俊璺ㄧ磼閻樻彃鈷旈柍褜鍓涢幊鎾寸珶婵犲洤绐楅柡鍥╁Ь婵娊鏌涜箛鏇ㄥ劆濞存粍绮撻弻鏇熷緞閸繂濮㈡繝鈷€鍕€掔紒杈ㄥ笧缁辨帒螣閸忕厧鍨辨俊銈囧Х閸嬫盯顢栨径鎰畺婵炲棙鍨熼崑鎾绘濞戞瑥鏆堝銈嗘尭椤嘲顫忕紒妯诲闁革富鍘介懣鍥⒑缁嬪尅鏀绘繛鍙夌矒閸┾偓妞ゆ帊鑳堕。鍙夌節閵忊槄鑰块柨婵堝仩缁犳稑鈽夊▎鎰姃闂備線娼荤€靛矂宕㈡ィ鍐╁亗闁瑰墽绮埛鎴︽煕濞戞﹫鍔熷褋鍊濋弻娑㈠箻鐎靛摜鐤勯悗娈垮櫘閸嬪懘濡堕敐澶婄闁冲湱鍋撶€氳偐绱撻崒姘偓鐑芥倿閿曞倹鏅濋柍杞拌閺嬫棃鏌￠崶鈺佹灁缂佺娀绠栭弻銈囧枈閸楃偛顫╅梺鍝勵儐缁嬫捇鍩€椤掑喚娼愭繛鍙壝—鍐嚍閵夈倗绠氶梺缁樺灱婵倝寮插┑瀣厓鐟滄粓宕滃☉妯锋瀻闁靛繈鍊栭崐鐑芥煕濠靛棗顏い鏃€鍔欏娲捶椤撴稒瀚涢梺鍛娒妶绋款嚕閹间焦鍋勯柛蹇氬亹閸樻捇鏌ｉ悩鍙夌┛閻忓繑鐟╅幃鐐哄川婵犲啫寮挎繝鐢靛Т鐎氼喚鏁☉銏＄厵鐎瑰嫮澧楅崳鐣岀磼椤旂偓鏆╅柍褜鍓ㄧ紞鍡樼濠靛鍋╁ù鐓庣摠閳锋帒霉閿濆懏鍟為柟鑼焾閳规垿顢氶埀顒€顭囪閸欏懎鈹戦悩璇у伐闁绘妫涚划鍫ュ幢濞戞瑧鍘甸梺缁樺灦閿氶柣蹇撶Ч閺岋紕鈧綆浜崣鍕煛瀹€鈧崰鏍箖濞嗘搩鏁嗛柍褜鍓熼妴鍌炲箮閼恒儳鍘遍柣搴秵閸嬪懐浜告导瀛樼厵鐎瑰嫮澧楅崳浠嬫煕閺嶃劎澧电€殿喗鎸抽幃銈嗘媴閸︻厾鞋濠电姷鏁告慨鐢割敊閺嶎厼绐楁俊銈呮噷閳ь剙鍟村畷銊╊敇閸ャ劎鈽夐柍璇查叄楠炴ê鐣烽崶椋庨棷闂傚倷鐒﹂惇褰掑垂瑜版帒绠熼柨鐔哄Т閻撴洟鏌熸潏楣冩闁绘挻娲樼换娑㈠箣閻戝洣绶甸梺缁樻惄閸撴氨鎹㈠☉銏犻唶闁绘洖鍊介埀顒€娼￠弻锛勪沪閸撗佲偓鎺楁煃瑜滈崜銊х礊閸℃稑绀堟繛鍡樻尭閸戠姵绻涢幋鐐茬劰闁稿鎸鹃幉鎾礋椤掑偊绱梻浣规偠閸斿繐鈻嶉敐鍥у灊閻庯綆鍠栫粻鎶芥煛閸屾碍鎯堝ù婊堢畺閺屻劌鈹戦崱娑扁偓妤€霉濠婂嫬濮嶉柡?.torrent 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝洨纾界€广儱鎷戦煬顒傗偓娈垮枛椤兘骞冮姀銈呯閻忓繑鐗楃€氫粙姊虹拠鏌ュ弰婵炰匠鍕彾濠电姴浼ｉ敐澶樻晩闁告挆鍜冪床闂備浇顕栭崹搴ㄥ礃閿濆棗鐦遍梻鍌欒兌椤㈠﹤鈻嶉弴銏犵闁搞儺鍓欓悘鎶芥煛閸愩劎澧曠紒鈧崘鈹夸簻闊洤娴烽ˇ锕€霉濠婂牏鐣洪柡灞诲妼閳规垿宕卞▎蹇撴瘓缂傚倷闄嶉崝宀勫Χ閹间礁钃熼柣鏂垮悑閸庡矂鏌涘┑鍕姢鐞氾箓姊绘担鍛婃儓闁活厼顦辩槐鐐寸瑹閳ь剟濡存担鍓叉建闁逞屽墴楠炲啫鈻庨幘宕囶啇濡炪倖鎸鹃崳銉ノ涜濮婂宕掑▎鎴犵崲濠电偘鍖犻崗鐐☉閳诲酣骞嬮悙瀛橆唶闂備礁婀遍崕銈夈€冮幇顔剧闁哄秲鍔庣弧鈧梻鍌氱墛娓氭宕曢幇鐗堢厸闁告侗鍠氶崣鈧梺鍝勬湰缁嬫垿鍩ユ径鎰闁绘劕妯婂缁樹繆閻愵亜鈧垿宕曢弻銉﹀殞濡わ絽鍟悡姗€鏌熺€电浠滅紒鐘靛█濮婅櫣绮欓崠鈩冩暰濡炪們鍔屽Λ婵嬬嵁閸儱惟闁冲搫鍊搁埀顒€顭烽弻锕€螣娓氼垱楔闂佹寧绋掗惄顖氼潖閾忓湱纾兼俊顖氭惈椤酣姊虹粙璺ㄦ槀闁稿﹥绻傞悾鐑藉箣閻橆偄浜鹃柨婵嗛閺嬬喖鏌ｉ幘璺烘瀾濞ｅ洤锕、娑樷攽閸℃鍎繝鐢靛Л閸嬫挸霉閻樺樊鍎愰柣鎾冲暟閹茬顭ㄩ崼婵堫槯濠电偞鍨剁喊宥夘敃閼恒儲鍙忔慨妤€妫楁晶濠氭煕閵堝棙绀嬮柡宀€鍠撶槐鎺楀閻樺磭浜俊鐐€ら崑鍕箠濮椻偓瀵顓兼径濠勫幐婵炶揪绲介幉鈥斥枔閺屻儲鈷戠紓浣诡焽缁犳牠鏌ｅΔ鍐ㄐ㈡い顐㈢箳缁辨帒螣閼测晜鍤岄梻渚€鈧偛鑻晶鎾煕閳规儳浜炬俊鐐€栫敮鎺楀磹閸涘﹦顩锋繝濠傜墛閻撶姵绻涢懠棰濆殭闁诲骏绻濋弻锟犲川椤撶姴鐓熼悗娈垮枦濞夋盯鍩㈡惔銊ョ鐟滃秹寮幖浣光拺闁煎鍊曢弸鎴︽煟閻旀潙鍔ら柍褜鍓氶崙褰掑储閸撗冨灊闁割偀鎳囬崑鎾绘晲鎼粹€冲箣闂佺顑嗛幐楣冨箟閹绢喖绀嬫い鎺戝亞濡插爼姊绘担渚劸缂佺粯鍨块弫鍐閵堝憘銉ッ归敐鍛棌婵炵鍔戦弻宥堫檨闁告挾鍠栭悰顕€宕橀鑲╁幐闂佸憡鍔戦崝宥夋倵閾忣偆绡€闁靛骏绲剧涵楣冩煠濞茶鐏ｉ柤娲憾婵＄兘鍩￠崒妤佸闂備胶顭堥張顒勬偡閿斿墽鐭堥柣妤€鐗勬禍婊堟煛閸パ勵棞婵炲眰鍊楃划鍫ュ礋椤栨稓鍘介梺鎸庣箓閹虫劙鎮樻潏鈺冪＜闁逞屽墯缁绘繈宕堕妸褍骞堥梻浣规灱閺呮盯宕导鏉戠叀濠㈣泛鐬煎Λ顖炴煙椤栧棗鐬奸崥瀣⒑閸濆嫮鐏遍柛鐘崇墵閻涱噣骞嬮敃鈧粻娑欍亜閹烘垵鈧摜鏁幐搴濈箚闁绘劦浜滈埀顑惧€濆畷鎴﹀川椤掑吋妞介幃銏ゆ偂鎼淬倖鎲伴柣搴＄畭閸庨亶藝椤栨稑顕遍柣妯肩帛閻撴洟鏌￠崶銉ュ濞存粍鍔欓弻娑氣偓锝庡亝瀹曞矂鏌熺粵鍦瘈濠碘€崇埣瀹曞爼鏁傞崜褎鍠掗梻鍌氬€风粈渚€骞夐敓鐘茬闁糕剝绋戦悞鍨亜閹烘垵顏╃痪鎯ь煼閺岀喖宕滆鐢盯鏌涚€ｅ墎绡€闁哄备鍓濆鍕偓锝夋涧閸斿苯鈹戦埥鍡椾簻闁活厼鍊搁～蹇撁洪鍕炊闂侀潧顦崕娑㈡晲閸℃瑧顔曢梺鍛婄懃椤﹂亶鎯岄幒妤佺厵鐎规洖娲ゆ禒锔界箾閻撳海绠诲┑鈩冪摃椤﹁淇婄紒銏犳珝婵﹥妞藉畷銊︾節閸曘劍顫嶉梻浣瑰濞测晝绮婚幘宕囨殾闁靛繈鍊曠粻鐟懊归敐鍛辅闁归攱妞藉娲川婵犲嫧妲堥梺鎸庢穿缁插灝鈻庨姀銈嗙劶鐎广儱妫涢崢閬嶆⒑缂佹◤顏堝疮閸ф浼犻柧蹇撳帨閸嬫挾鎲撮崟顒傗敍缂傚倸绉崇欢姘暦濞差亜鐒垫い鎺嶉檷娴滄粓鏌熼悜妯虹仴妞ゅ浚浜弻宥夋煥鐎ｎ亞浼岄梺鍝勬湰缁嬫垿鍩為幋锕€骞㈡俊銈咃梗閻ヮ亝绻濋悽闈浶涢柛瀣崌閺岀喎鈻撻崹顔界亾缂佺偓鍎抽妶鎼佸箖濡ゅ懏鏅查幖绮光偓鑼泿闂備浇顕х换鎴﹀箰閹惰棄钃熸繛鎴欏灩閻撴﹢鏌涢…鎴濇灈濠殿喗娲熼幃妤呭垂椤愶絿鍑￠柣搴㈢煯閸楁娊鎮伴鈧畷鍫曨敆婢跺娅岄梻浣侯焾閺堫剛鍒掑畝鍕祦闁逞屽墯缁绘繈鎮介棃娴躲儲銇勯敐鍫燁棄閸楅亶鏌涘☉娆愮稇闁搞劌鍊块弻鐔煎箚閻楀牜妫勯梺绋胯閸斿酣骞夐幖浣告閻犳亽鍔嶅▓楣冩⒑濮瑰洤鐏╁鐟帮躬瀵偊宕卞☉娆戝幈闂佸搫娲㈤崝宀勫储閹绢喗鐓?)
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
        `闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈嗙節閳ь剟鏌嗗鍛姦濡炪倖甯掗崐褰掑吹閳ь剟鏌ｆ惔銏犲毈闁告瑥鍟悾宄扮暦閸パ屾闁诲函绲婚崝瀣уΔ鍛拺闁革富鍘奸崝瀣煕閵娿儳绉虹€规洘鍔欓幃娆忣啅椤旇棄鐦滈梻渚€娼ч悧鍡椢涘Δ鍐當闁圭儤鎸舵禍婊堟煥閺傝法浠㈢€规挸妫涢埀顒侇問閸犳鎮￠敓鐘偓渚€寮崼婵嬪敹闂佺粯妫佸〒褰掓偨缂佹绡€闁汇垽娼у瓭闂佹寧娲忛崐婵嗙暦椤栫偞鍋嬮柛顐ゅ枑閻濓繝姊婚崒姘偓鐑芥倿閿旈敮鍋撶粭娑樻噺瀹曟煡鏌涢弴銊ョ仩缁惧墽绮换娑㈠箣濞嗗繒浠奸梺缁樻尰閿曘垽寮婚悢琛″亾閻㈡鐒剧悮銉╂⒑缁嬫鍎愰柟鐟版喘瀵偊骞囬鐔峰妳闂佺偨鍎寸亸娆撳礄鐟欏嫮绡€闁汇垽娼ф禒婊堟煙閸愭煡顎楅悡銈嗐亜閹捐泛鍓辨繛鍏肩墵閺屟嗙疀閹剧纭€闂佹椿鍘介悷鈺呭箖瑜版帒绠掗柟鐑樺灥椤姊洪崨濠冾梿妞ゎ偄顦遍幑銏犫攽閸繃鐎冲┑鈽嗗灠閸㈠弶绂嶆ィ鍐╃叄闊浄绲芥禍婊呯磼閹邦厾銆掔紒杈ㄦ尰缁楃喖宕惰閻忓秹姊洪懡銈呮瀭闁告柨娴烽崚鎺旀嫚濞村顫嶉梺闈涚箳婵兘鎯堥崟顖涒拺缂佸瀵у﹢鎵磼椤斿ジ顎楅崡閬嶆煕閵夘喖澧柍閿嬪笒閵嗘帒顫濋敐鍛婵犵數鍋橀崠鐘诲礋閸偒鍟嶉梻濠庡亜濞诧箑煤閺嶎偅顐介柕鍫濇偪瑜版帗鍋愮€瑰壊鍠栭崜閬嶆⒑缁嬫鍎忛柛濠傛健瀵鎮㈤悡搴ｎ吋濡炪倖姊婚埛鍫ュ汲椤撱垺鈷戠紓浣股戠亸鐗堢箾閼碱剙鏋涚€殿喖顭烽弫鎾绘偐閼碱剦妲伴梻浣瑰缁诲倿骞婂鍡欑彾闁哄洢鍨洪埛鎺懨归敐鍫燁仩閻㈩垱绋掗妵鍕Ω閵壯冾杸闂侀€涚┒閸旀垿鐛鈧、娆撴寠婢跺鍋呴梻鍌欒兌缁垶宕归悡骞盯宕熼鐘辩瑝闂佹寧绻傞ˇ浼存偂閵夆晜鐓涢柛銉厛濞堟柨霉濠婂牏鐣洪柡灞剧洴婵＄兘濡疯閹茶偐绱撴担铏瑰笡缂佽鐗婇幈銊╁焵椤掑嫭鐓ユ繝闈涙椤ョ娀鏌曢崱妯哄妞ゎ亜鍟存俊鍫曞幢濡ゅ啩娣繝鐢靛仜濡﹪宕㈡總鍛婂仼闁绘垼妫勯～鍛存煏閸繃鍣芥い鏃€鍔栫换娑欐綇閸撗冨煂闂佸憡蓱缁捇鐛箛鎾佹椽顢旈崨顏呭缂備胶铏庨崢濂稿箠鎼淬垻顩茬憸鐗堝笚閻撴洟鎮楅敐搴′簽婵炴彃顕埀顒冾潐濞叉鎹㈤崒婵堜簷闂備礁鎲℃笟妤呭窗濮樿泛鍌ㄩ柟闂寸劍閳锋垿鏌涘☉姗堟缂佸爼浜堕弻娑㈡偐閸愭彃鎽甸梺绯曟杺閸庢彃顕ラ崟顖氱疀妞ゆ挾濮撮獮妤佷繆閻愵亜鈧倝宕㈡禒瀣瀭闁割煈鍋呭▍鐘绘倵濞戞鎴﹀矗韫囨挴鏀介柣妯诲絻椤忣偊鎮介娑氭创闁哄瞼鍠庨悾锟犳偋閸繃鐣婚梻浣告贡閸樠呯礊婵犲洤绠栭柣鎴ｆ缁犮儲銇勯弴鐐村櫣濞寸姴缍婂濠氬磼濞嗘垵濡介梺娲讳簻缂嶅﹤鐣峰ú顏勭妞ゆ牗鑹鹃悗顓㈡煛婢跺﹦澧愰柡鍛矒瀵啿顭ㄩ崼鐔哄弳闂佺粯鏌ㄩ幖顐㈢摥闂備礁鎼鍕濮樿泛钃熸繛鎴欏灩缁犳盯姊婚崼鐔衡姇闁诲繐鐗撻弻娑㈡倻閸℃浠稿┑顔硷龚濞咃綁鍩€椤掆偓濠€杈ㄦ叏閻㈢违闁告劦浜炵壕濂告煙缂佹ê绔鹃柛瀣ㄥ灲閺屸剝鎷呯粙鎸庢閻庤娲樼敮鎺楀煡婢跺娼╂い鎺嗗亾缂佺姷鍋ゅ濠氬磼濞嗘埈妲梺鍦拡閸嬪嫮鍙呴梺闈涚箞閸婃洜绮堟径灞稿亾閸忓浜鹃梺鍛婃处閸嬪嫰宕甸幋锔解拺闂傚牊绋撴晶鏇熴亜閿斿灝宓嗛柟顕嗙節閹垽宕楅懖鈺佸妇闂備礁澹婇崑鍛崲閸岀偛鐒垫い鎺嗗亾闁硅绱曠划瀣吋閸℃劕浜濋梺鍛婂姀閺備線骞忔繝姘拺缂佸瀵у﹢浼存煟閻曞倸顩紒顔硷躬閹囧醇濞戞鐩庢俊鐐€栭崝鎴﹀春閸曨倠锝夊箹娴ｅ湱鍘介梺鎸庣箓閹冲骸危婵犳碍鎳氶柨婵嗩槹閸嬬姵绻涢幋鐐茬瑨濠⒀勭叀閺岋綀绠涢幘铏闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿С閹查箖姊绘担鍛婅础妞ゎ厼鐗撻、鏍ㄥ緞閹邦剛鐣哄┑鐘诧工閻楀﹦鈧數濮撮…璺ㄦ崉妤﹀灝顏繝娈垮櫙闂勫嫭绌辨繝鍥ㄥ€锋い蹇撳閸嬫捇寮介锝嗘闂佸湱鍎ら弻锟犲磻閹炬剚娼╅柣鎾抽缁秹姊虹化鏇熸珕闁烩晩鍨堕悰顕€骞掑Δ鈧粻鐘绘煏婵炲灝鍔ょ紒澶嬫そ閺屸剝鎷呴悷鏉款潚閻庤娲滈崰鏍€佸璺哄窛妞ゆ挾鍊ｉ妶澶嬧拻闁稿本鐟ㄩ崗宀€绱掗鍛仯闁轰緡鍠栬灃闁告侗鍘鹃敍鐔兼煟鎼粹剝璐″┑顕€鏀辩粋宥呪枎閹剧补鎷绘繛杈剧秬濞咃絿鏁☉娆嶄簻妞ゆ挾鍋熸晶鏇㈡煃鐠囪尙效鐎殿喗鎸虫慨鈧柣妯碱暜缁鳖噣姊绘担绛嬫綈濠㈢懓妫欓弲璺何旈崨顔间簵濠电偞鍨堕埣銈堛亹閹烘挻娅滈梺鎼炲劚婢у酣宕濋幖浣光拺闁告繂瀚敍鏃傜磼閺屻儳鐣哄┑锛勬暬瀹曠喖顢涘鍏肩秱闂備焦鏋奸弲娑㈠窗濮橆儵娑㈠礃椤旇棄鈧敻鎮峰▎蹇擃仾缂佲偓閸儲鐓曟俊顖滃Т濞层倝鎮″鈧弻鐔衡偓鐢殿焾娴犙呯磼閳锯偓閸嬫捇姊绘担鍛婂暈闁告柨绻樺鎻掆槈閵忕姵杈堝銈嗗姧闂勫嫰鍩涢幒妤佺厱閻忕偞宕樻竟姗€鏌嶈閸撴盯宕楀鈧獮濠偽旈崨顓狀槶婵炶揪绲块…鍫ユ倶婵犲偆娓婚柕鍫濇婢ч亶鏌涚€ｎ偆娲撮柟閿嬪灴閹垽宕楅懖鈺佸妇濠电姷鏁搁崑鐔煎磻閹炬枼鏋嶉柛娑卞灣绾惧ジ鏌ｅ鈧褔寮稿☉銏＄厸閻忕偠顕ф俊濂告煃閽樺妲搁摶锝呫€掑鐓庣仧缂佽鲸鍨圭槐鎾诲磼濞嗘帩鍞归梺绋款儐閹告悂鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑缂佹ɑ灏版繛鑼枛瀵寮撮悢椋庣獮濠碘槅鍨抽崕銈夋倶閸喓绡€闁冲皝鍋撻悘鐐垫櫕娴犳悂姊洪崫鍕効缂傚秳绶氶悰顔嘉熺亸鏍т壕婵炴垶鐟悞鑺ャ亜閿斿灝宓嗘慨濠冩そ瀹曨偊宕熼鐘辩礃闂備礁鎽滄慨鐢告偋閻樿崵宓侀柛鎰╁妷閺嬪酣鏌熼崹顔兼殲闁哄懌鍨虹换婵嬪閿濆棛銆愬銈嗗灥濞差厼顕ｉ幎钘壩ㄩ柍鍝勫€甸幏缁樼箾鏉堝墽鎮奸柛搴涘€濆畷鐢稿焵椤掑嫭鈷戦柛婵勫劚閺嬫瑦绻涙径瀣妤犵偞鍨挎慨鈧柕鍫濇噽閻も偓闂備礁鎼ˇ鍐测枖閺囥垹鍌ㄦ繛宸簼閳锋垿鎮峰▎蹇擃仼缂佲偓閸愨斂浜滈柡鍥ф鐎氼剟顢氶柆宥嗙厽婵☆垵鍋愮敮娑㈡煟閹惧磭绠版い顓℃硶閹风娀鍨惧畷鍥﹀摋闂備礁缍婇弨閬嶅垂閻熸嫈锝夊箛閺夎法顔呴梺鍏间航閸庮噣骞忕紒妯肩閺夊牆澧界€靛ジ鎮归埀顒勬晝閸屾稑鈧灝螖閿濆懎鏆為柣鎾寸洴閺屾盯顢曢顫盎婵犫拃鍕唉闁哄瞼鍠栭、娆撳箚瑜嶉獮瀣節绾版ê澧查柟顔煎€垮畷娲焺閸愵亞鐦堥梺鍛婂姀閺呮粓鎮甸敂鐣岀瘈闁汇垽娼цⅷ闂佹悶鍔岄妶绋跨暦濞差亜鍐€妞ゆ挾鍋熼ˇ顕€姊洪崫鍕枆闁告ü绮欏畷?${result.data.importedCount} 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮诲☉妯锋婵鐗婇弫楣冩⒑閸涘﹦鎳冪紒缁橈耿瀵鏁愭径濠勵吅闂佹寧绻傚Λ顓炍涢崟顖涒拺闁告繂瀚烽崕搴ｇ磼閼搁潧鍝虹€殿喛顕ч埥澶娢熼柨瀣垫綌婵犳鍠楅〃鍛存偋婵犲洤鏋佸Δ锝呭暞閳锋垿鏌涘☉姗堝姛闁瑰啿鍟扮槐鎺旂磼濮楀牐鈧法鈧鍠栭…鐑藉极閹邦厼绶炲┑鐘插閸氬懘姊绘担鐟邦嚋缂佽鍊歌灋妞ゆ挾鍊ｅ☉銏犵妞ゆ牗绋堥幏娲⒑閸涘﹦绠撻悗姘卞厴瀹曟洘鎯旈敐鍥╋紲闂佸吋鎮傚褔宕搹鍏夊亾濞堝灝鏋涙い顓犲厴楠炲啴濮€閵堝懐顦ч柣蹇撶箲閻楁鈧矮绮欏铏规嫚閺屻儱寮板┑鐐板尃閸曨厾褰炬繝鐢靛Т娴硷綁鏁愭径妯绘櫓闂佸憡鎸嗛崪鍐簥闂傚倷鑳剁划顖炲礉閿曞倸绀堟繛鍡樻尭缁€澶愭煏閸繃顥撳ù婊勭矋閵囧嫰骞樼捄鐩掋垽鏌涘Ο渚殶闁逞屽墯椤旀牠宕伴弽顓涒偓锕傛倻閽樺鐎梺褰掑亰閸樿偐娆㈤悙娴嬫斀闁绘ɑ褰冮顐︽煛婢跺﹥鍟炲ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍋呴弳婊冣攽閻樺弶澶勯柛濠傛健閺屻劑寮撮悙娴嬪亾閸濄儱顥氶柛褎顨嗛悡娆撴煕閹炬鎳庣粭锟犳⒑閹惰姤鏁遍柛銊ユ健瀵鎮㈤崗鐓庢異闂佸疇妗ㄥ鎺斿垝閼哥數绡€缁剧増菤閸嬫捇鎮欓挊澶夊垝闂備礁鎼張顒傜矙閹烘梹宕叉繝闈涱儏绾惧吋绻涢幋鐏荤厧菐椤曗偓閺岋絾鎯旈姀鈺佹櫛闂佸摜濮甸惄顖炪€佸鎰佹▌闂佺硶鏂傞崕鎻掝嚗閸曨垰绠涙い鎺戭槹缂嶅倿姊绘担绋挎毐闁圭⒈鍋婂畷鎰版偡閹佃櫕鐎洪梺鎼炲労閸撴岸鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬濡炪倖娲樼划搴ｆ閹烘梹瀚氶柟缁樺坊閸嬫挸顫㈠畝鈧禍杈ㄧ節閻㈤潧浠﹂柛銊у枛楠炲﹪鎮欓崫鍕€炲銈嗗坊閸嬫捇宕鐐村仭婵犲﹤鍟扮粻鍐差熆鐟欏嫭绀嬮柟绋匡攻缁旂喎鈹戦崱娆懶ㄩ梺杞扮劍閸旀瑥鐣烽妸鈺婃晩闁芥ê顦竟宥夋⒑鐠囨彃顒㈢紒瀣笧閹广垽宕熼鐕佹綗闂佽宕橀褏澹曢崗鍏煎弿婵☆垵宕靛Ο鍌炴煏韫囧鈧牠鎮￠妷鈺傜厸闁搞儯鍎辨俊铏圭磼閵娧呭笡闁靛洤瀚板鎾敂閸℃ê浠归梻浣哥秺椤ユ挻鎱ㄩ幘顕呮晩闊洦渚楅弫濠囨煕韫囨洖甯堕柍褜鍓﹂崹浼村煘閹达附鍋愭い鏃囧亹娴煎洤鈹戦悙宸Ч闁烩晩鍨跺顐﹀礃椤旇姤娅滈梺鎼炲労閻撳牆顭囬悢鍏尖拺闁告挻褰冩禍婵囩箾閸欏鑰块柛鈺傜洴楠炲鏁傞悾灞藉箞婵犵數鍋為崹鍫曟晝椤愶箑缁╅悹鍥ф▕閻斿棝鎮归崫鍕儓妞ゅ浚鍙冮弻锛勪沪閸撗佲偓鎺楁煃瑜滈崜銊╁箑閵夆晛绀冪憸宥壦夊鑸碘拻闁稿本鑹鹃埀顒傚厴閹虫宕奸弴妞诲亾閿曞倸閱囬柕澶樺枟閺呯偤姊虹化鏇炲⒉缂佸鍨圭划缁樺鐎涙鍘炬繝娈垮枟閸旀洟鍩€椤掍胶澧柣锝囧厴瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涚紒瀣浮閺佸秴顓奸崱娆戭啎闁诲繐绻戦悧妤€鈻嶆繝鍥ㄧ厸閻忕偟鍋撶粈鍐偓鍨緲鐎氭澘鐣烽悡搴樻斀闁割偅绮嶉崑鍛節閻㈤潧浠滈柣掳鍔庨崚鎺楀箻閸撲椒绗夐梺鍝勭▉閸樺ジ鎷戦悢鍝ョ闁瑰鍊戝顑╋綁宕奸悢铏诡啎闂佺硶鍓濋敋濠殿喖顦辩槐鎺斺偓锝庝簼閸犳ɑ鎱ㄦ繝鍐┿仢闁圭锕ュ鍕節閸愨晩鍟€闂傚倷绀侀幗婊勬叏閻㈠憡鍋嬮柣妯烘▕閸ゆ洖鈹戦悩瀹犲闁告濞婇弻锝夊籍閸偅顥栫紓浣瑰姉閸嬫盯鍩為幋锔藉€烽柡澶嬪灩娴犳悂姊洪幐搴㈢５闁哄懏绋撻崣鍛渻閵堝棙灏柛銊︽そ閸╂盯骞嬮敂鐣屽幈濠电偞鍨惰彜濠殿喖娲弻銈吤圭€ｎ偅鐝旈梺鎼炲妽缁诲啰鎹㈠☉銏犲耿婵°倓鑳堕々鏉库攽閻愭彃鎮戦柣妤佹礉閻忓啴姊洪幐搴㈢；缂佽翰鍊栭〃銉ㄧ疀閹句胶鎳撻…銊╁礃椤忓柊銊╂⒑閸濆嫮鐏遍柛鐘崇墵楠炲啫顭ㄩ崗鍓у枛閹煎綊鏌呭☉妯侯嚙闂傚倸鍊风粈渚€骞楀鍕弿闁圭虎鍠楅弲婵囥亜韫囨挸顏存繛鍏肩墬缁绘稑顔忛鑽ょ泿婵炵鍋愭繛鈧柡灞炬礃瀵板嫰宕煎┑鍡楊棟闂備焦瀵х换鍌炈囨导瀛樺亗闁绘棃鏅茬换鍡涙煏閸繃鍣归柡鍡樼懇閺屽秶鎷犻懠顒€顤€濡炪們鍔婇崕鐢稿箖濞嗘挸鐭楀鑸瞪戦敍鍡涙煟鎼淬値娼愭繛鍙夛耿閺佸啴濮€閵堝啠鍋撴担绯曟瀻闁圭偓娼欏▓鎰版⒑閸愬弶鎯堥柨鏇樺€濋獮鍐醇閵夛腹鎷婚梺绋挎湰閻熴劑宕楀畝鈧槐鎺楊敋閸涱厾浠搁梺鐐藉劵缁犳挸鐣烽崼鏇ㄦ晢闁逞屽墴瀵憡绗熼埀顒勫蓟閻斿吋鈷掗悗鐢殿焾婵′粙姊洪崫鍕闁告挻姘ㄩ幑銏犫攽鐎ｎ偒妫冨┑鐐村灥瀹曨剟宕滈柆宥嗏拺缂佸灏呭銉╂煟韫囨柨鍝洪柕鍡楀暣婵＄兘鍩￠崒姘ｅ亾閻戣姤鐓犵痪鏉垮船閸樻悂鏌ц箛鎾诲弰婵﹥妞藉畷銊︾節閸愶絾瀚荤紓浣哄亾濠㈡绮旈悽鐢电煔閺夊牄鍔庣弧鈧梺鎼炲劥閸╂牠寮插┑瀣拺闁圭娴风粻鎾寸箾閼碱剙校闁逛究鍔戝畷鍫曨敆娴ｅ弶瀚奸梻浣告啞缁诲倻鈧凹鍙冨畷瀹犮亹閹烘挾鍘介梺鍝勮癁娴ｉ晲鍒掓俊銈囧Х閸嬫盯宕婊呯焿闁圭儤鏌￠崑鎾绘晲鎼存繄鐩庣紓浣瑰姈缁嬫帞鎹㈠┑瀣仺闂傚牊鍒€閵忋倖鍊垫慨妯煎帶婢ф挳鏌ｅ☉鍗炴珝妤犵偛娲幃褔宕奸姀鐘茬闂備胶顢婇崑鎰偘閵夆晛鐒垫い鎺嗗亾闁哥喐瀵у蹇涘川鐎涙ǚ鎷虹紓浣割儐椤戞瑩宕曢幇鐗堢厵闁荤喓澧楅崰妯尖偓娈垮枦椤曆囶敇婵傜閱囨い鎰剁秵閳ь剙娲缁樻媴閸涘﹤鏆堥梺瑙勬倐缁犳牕鐣烽悧鍫熷劅闁靛绠戞禒濂告⒒娴ｅ摜浠㈡い鎴濇嚇椤㈡岸鏌嗗鍡欏幐婵犮垼娉涢鍛存倶閵夆晜鐓曢柣鎰典簻婵″吋銇勯鍕殻濠碘€崇埣瀹曞崬螣閻戞ɑ顔傞梻鍌欒兌椤牓顢栭崶顒€绐楅柡宥庡幖缁犳牕螖閿濆懎鏆欏ù鑲╁█閺屾盯寮村Ο鍝勵瀴闂佸搫鍊甸崑鎾绘⒒閸屾瑨鍏岀紒顕呭灦閳ワ箓宕奸妷顔芥櫔濠电姴锕ら崰姘跺疮閸涘瓨鐓忓璺烘濞呭棝鏌ｉ幘瀛樼闁逛究鍔岄～婊堝幢濡も偓娴煎酣姊洪崗鍏肩凡婵炵》绻濆濠氭偄绾拌鲸鏅╅梺鍛婄箓鐎氼喗瀵奸崼銉﹀€甸悷娆忓缁€鍐┿亜閵娿儻韬鐐插暣閸╁嫰宕橀埡浣稿Τ闂備線娼х换鍡涘疾濞戙垹绠栭柟杈鹃檮閳锋帡鏌涚仦鎹愬闁逞屽墴椤ユ挸鈻庨姀鐙€娼╂い鎺戭槺閸旂兘鎮峰鍕棃妤犵偛鍟抽ˇ鍦偓瑙勬礀瀹曨剟鍩ユ径濞㈢喖鎳栭埡鍌溾偓顕€姊绘担渚敯濠㈢懓鐗撻獮鎾活敂閸℃绛忛梺鍦焾濞寸兘鍩㈤弮鍌楀亾楠炲灝鍔氶柟顔垮劵閵囨劙骞掗幘鍏呯暗闂佺澹堥幓顏嗗緤妤ｅ啫绠熷┑鍌氭啞閳锋垿鏌熼幆鏉啃撻柡渚€浜堕幃浠嬵敍閵堝洨鐦堥悗娈垮枦椤曆囧煡婢跺娼╂い鎰剁到婵即姊绘担鍛婂暈闁圭妫濆畷鐔碱敃閿濆洤璁查梻鍌氬€搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佸湱澧楀妯尖偓姘槹閵囧嫰骞掗幋婵愪患婵℃鎳樺娲川婵犲啫顦╅梺鎼炲妼閵堢顕ｉ锕€鐐婃い鎺嶈兌閸樹粙姊虹憴鍕棆濠⒀勵殔閳藉顦归柡灞界Ч椤㈡棃宕奸悢鎼佹暘婵＄偑鍊ゆ禍婊堝疮鐎涙ü绻嗛柛顐ｆ礀缁€鍐煏婵炑冨€诲Λ顖炴⒒閸屾瑨鍏岀紒顕呭灦閵嗗啴宕奸悢绋垮伎闂佸湱铏庨崰妤呭磻閳哄懏鐓熼柟杈剧稻椤ュ鐥娑樹壕闂傚倷鑳剁划顖炲礉韫囨稑鐤炬繝濠傜墳缂嶆牜鈧箍鍎遍幊澶愬绩娴犲鐓冮柦妯侯槹椤ユ粓鏌ｈ箛銉хМ闁哄苯绉撮悾锟犲箥椤斿皷鍙洪柣搴ゎ潐濞诧箓宕滈悢椋庢殾濠靛倻顭堥崡鎶芥煟閺傚灝绾ч悗姘虫閳规垿鎮欓懜闈涙锭缂備浇寮撶划娆撶嵁濡も偓椤劑宕ㄩ婊呭帬闂備胶绮崹鍓佹箒缂備浇顕уΛ娆撳Φ閸曨垰绠涢柍杞扮婵洜绱掔紒銏犲箹濠⒀冩捣濡叉劙骞掑Δ濠冩櫓闂佸吋绁撮弲娑⒙烽埀顒傜磽閸屾瑧鍔嶆い銊ョ墦瀹曚即寮介鐐存К闂侀€炲苯澧柕鍥у楠炴帡骞嬪┑鎰偅缂傚倷鑳舵慨鐢告偋閻樿钃熼柕濞炬櫆閸嬪嫰鏌涘┑鍡楃彅闁靛繈鍊栭悡鐔肩叓閸ャ劍鐓ラ柍缁樻礋閺屸€崇暆閳ь剟宕伴幇鐗堟櫖闁归偊鍘芥刊鎾煢濡警妲搁悽顖ｅ灦濮婄粯鎷呴崨濠冨枑闂佺顑囬崰鏍ь嚕椤愶絿绡€婵﹩鍓濋幗鏇㈡⒑閹稿海绠撴い锔垮嵆瀹曟垿骞囬悧鍫㈠幈濠电偛妫楀ù姘ｈぐ鎺撶厱閹兼番鍨哄畷宀勬煙椤旂厧妲绘い顓滃姂瀹曠喖顢楅崒姘濠电姷鏁搁崑娑㈡儍閻戣棄鐒垫い鎺嗗亾缁剧虎鍙冨鎶芥晝閳ь剟鍩為幋锕€纾兼繝濠傛捣閸旀悂鏌涢悜鍡楃仸婵﹥妞藉Λ鍐ㄢ槈鏉堛剱銈夋⒑缁嬪潡顎楃€规洦鍓熼崺銏ゅ箻鐠囧弬褍顭跨捄渚剬闁归攱妞藉娲嚒閵堝懏鐎惧┑鐘灪閿曘垽鐛崘顔肩闁挎梻鏅崢浠嬫⒑閹稿海绠撶紒銊ャ偢閺屽洭顢涘┃鎯т壕閻熸瑥瀚粈鍐磼鐠囨彃鏆ｆ鐐叉瀵噣宕煎顏佹櫊閺屾洘绔熼姘櫣妤犵偐鍋撻梻鍌氬€搁崐鐑芥嚄閸洖绠犻柟鎯х摠濞呯娀鏌ｉ敐鍛板闁搞劍绻冮妵鍕冀椤愵澀娌梺绋款儏閸婂潡寮婚敓鐘茬倞闁靛鍎虫禒楣冩⒑缂佹ɑ灏紒缁樺姍閳ワ箓宕稿Δ浣告疂闂佹眹鍨婚崑锝夊焵椤掍礁娴柡灞剧洴楠炴帡骞樼€电鍤掗梻浣哥枃椤宕归崸妤€鍨傚Δ锝呭暞閸ゆ垶銇勯幒鎴濃偓濠氬储椤栫偞鈷掑ù锝囩摂閸ゅ啴鏌涢悩鎰佹疁闁靛棗鍟换婵嬪磼濠婂嫭顔曢柣鐔哥矌婢ф鏁埡鍛瀬闁告劦鍠楅悡蹇涙煕椤愶絿绠栭柛锝嗗▕閺屾稑顫濋鈧埀顒€鐏濋～蹇旂節濮橆剛锛滃┑顔斤供閸樹粙骞冨▎蹇ｆ富闁靛牆绻愰々顒勬煛娴ｇ瓔鍤欐い鏇稻缁绘繂顫濋鈹炬櫊閺屾洘寰勯崼婵堜痪闂佸搫鍊甸崑鎾绘⒒閸屾瑨鍏岀痪顓炵埣瀹曟粌鈹戠€ｎ偄浠梺闈涱槴閺佹帡鎮滈挊澶屽姦濡炪倖甯婂鎺旀崲閸℃稒鐓熼柟鏉垮悁缁ㄥ鏌嶈閸撴艾煤濠婂牆绠查柕蹇嬪€曠粻鎶芥煙閻愵剚缍戠€殿喖娼″铏圭磼濡櫣浼囨繝娈垮枔閸婃繂鐣烽弴鐔风窞閻庯絻鍔嬬花濠氭椤愩垺澶勯柟鍝ュ亾閺呭爼寮撮悩鐢碉紲闂佺粯锚绾绢參宕ｉ埀顒勬⒑閸濆嫮鐏遍柛鐘崇墵瀵宕堕浣规珖闂侀€炲苯澧い鏇秮閹瑩顢栫捄銊х暰婵＄偑鍊栭崝鎴﹀垂瑜版帩鏁傛い鎾跺枑閸欏繐鈹戦悩鎻掍簽闁绘捁鍋愰埀顒冾潐濞叉﹢宕曟總鍢庛劍鎷呴柅娑氱畾濡炪倖鐗楅〃鍛妤ｅ啯鈷掗柛灞剧懅椤︼箓鏌熺喊鍗炰簽闁诡噮鍣ｉ、鏇㈡晝閳ь剛绮堟径灞稿亾閸忓浜鹃梺鍛婃处閸嬪棝宕㈤幘顔解拺缁绢厼鎳忚ぐ褏绱掗悩鍐茬伌闁绘侗鍣ｆ慨鈧柍銉ㄥ皺缁犳岸姊洪棃娑氬闁归攱鍨甸～蹇撐旈崘顏嗭紲闁哄鐗勯崝宀勬倶鐎涙ɑ鍙忓┑鐘插鐢盯鏌熷畡鐗堝櫧闁瑰弶鎸冲畷鐔煎煛閳ь剟骞嬮悜鑺モ拻濞达絽鎲￠崯鐐烘儑婢跺瞼纾兼い鏃傛櫕閹冲洦顨ラ悙鎻掓殻闁诡喗绮撻幐濠冨緞鐏炶棄绠伴梻鍌欑閹测剝绗熷Δ鍛煑闁逞屽墴閺岀喖鎳為妷锔绢槬闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿С濡楁捇姊洪懝甯獜闁稿﹥绻堝濠氭晸閻樿尙鍔﹀銈嗗笒鐎氼厾鈧數濮撮…璺ㄦ崉閻戞﹩妫￠梺鍝勫€甸崑鎾绘⒒閸屾瑨鍏岀紒顕呭灥閹筋偊鎮峰鍕凡闁哥喐娼欓锝夊箹娴ｈ倽褔鏌涘銉モ偓鏇犵礊婵犲洤绠栭柍鍝勬媼閺佸啴鏌ㄥ┑鍡橆棤鐟滄澘娲ㄧ槐鎾诲磼濞嗘劗銈版俊鐐茬摠閹倿鐛幇顓犵瘈婵﹩鍓涢鍡涙⒑閸涘﹣绶遍柛鐘冲哺閵嗗懘鎮滈懞銉モ偓鐢告煥濠靛棛鍑圭紒銊ャ偢閺岀喖鎼归銈嗗櫚濠殿喖锕ら幖顐ｆ櫏闂佹悶鍎滈崨顓炐ら梻鍌欑劍閹爼宕濆鍡欑濠电姴鍊婚弳锕傛煙鏉堝墽鐣遍崶瀛樼節閵忥絾纭鹃柤娲诲灣缁﹪鏁冮崒娑辨濡炪倖鍔戦崹鐑樺緞閸曨厾纾奸悗锝庡亜濞搭喚鈧娲橀崹鍧楃嵁閸ヮ剦鏁婇柛鎾楀秶闂繝鐢靛仩閹活亞寰婃禒瀣剁稏闁哄稁鍙庨弫鍌炴煕閺囨ê濡介柣蹇庣窔濮婃椽妫冨☉姘暫闂佺懓鍢查鍛村Υ閹烘挾绡€婵﹩鍘鹃崢顏堟⒑閸撴彃浜濈紒璇插暣钘熸繝濠傜墛閻撴洜鎲稿澶嬫櫇妞ゅ繐鐗嗛拑鐔哥箾閹寸偛鐒归柛瀣崌閺佹劖鎯旈垾鑼嚬闂佽绻愮换瀣础閹惰棄钃熼柡鍥ュ灩閻愬﹦鎲稿澶樻晜妞ゆ挶鍨洪悡娑樏归敐鍥ㄥ殌濠殿喖绉堕埀顒冾潐濞叉牕鐣烽鍐航闂傚倸鍊甸崑鎾绘煙闁箑鐏℃い搴㈩殕缁绘繈鎮介棃娴讹絾銇勯弮鈧悧鐘茬暦娴兼潙鍐€妞ゆ挾鍠愬▍鍥⒑閹稿孩绀€闁稿﹤鎽滄竟鏇㈠锤濡や胶鍘梺鍓插亝缁诲啰绮堝畝鍕厱閻庯綆鍋呭畷宀勬煙椤旇崵鐭欐俊顐㈠暙閳藉螣閸︻厼绗￠梻鍌氬€风粈渚€鎮块崶顒夋晪鐟滄棃寮绘繝鍥ㄦ櫜濠㈣泛鑻粊锕傛煟鎼搭垳绉甸柛鐘愁殜瀹曟劙鎮滈懞銉濡炪倖鍔﹂崑鍕嚕閵娧呯＜缂備焦蓱缁€瀣叏婵犲偆鐓肩€规洘甯掗～婵嬵敄閽樺澹曢梺缁樺灱婵倝宕甸崟顖涚厱妞ゆ劧绲剧壕鐢告煃瑜滈崜銊х不閹惧磭鏆﹀┑鍌滎焾椤懘鏌嶉妷銉ユ毐缂併劊鍎靛缁樻媴娓氼垱鏁梺瑙勬た娴滎亜顫忔禒瀣妞ゆ牗姘ㄩ弻褍鈹戦悩缁樻锭妞ゆ垵妫濋幃陇绠涘☉姘絼闂佹悶鍎崝宥囩矆閳ь剙顪冮妶鍛搭€楅柣顓炲€垮璇测槈閵忕姈褔鏌涢埄鍐剧劷妞わ负鍔戝娲濞戞瑦鎮欓柣搴㈢煯閸楁娊鎮伴鈧畷鍫曨敆閳ь剛绮堥崼婢濆綊鏁愰崶褍濡哄┑鐐茬墕閹芥粎妲愰幘璇茬＜婵炲棙甯掗崢鈩冪節濞堝灝鏋ら柡浣告憸閸掓帒鈻庨幘宕囶唺濠德板€愰崑鎾愁浖閸涘瓨鈷戦柛娑橈攻婢跺嫰鏌涢妸锕€顥嬬紒顔剧帛缁绘繂顫濋鐐板寲濠德板€ч梽鍕偓绗涘洤违闁告劦鍠楅悡娆撴煙缂併垹娅樻俊顐ｅ灩缁辨帗娼忛妸锕€闉嶉梺鐟板槻閹虫﹢骞冮悜钘夌骇婵炲棛鍋撶紞宥夋⒒閸屾瑨鍏屾い顓炵墦椤㈡牠宕橀鑲╋紮濠电娀娼уΛ顓㈠吹閺囩偐鏀介柣妯虹－椤ｆ煡鏌￠崨顔惧弨闁哄本鐩崺鍕礂閻欌偓娴滎亜鐣峰┑瀣窛妞ゆ挆鍕槣闂備線娼ч悧鍡椢涘☉娆愭珷妞ゆ帒鍊荤壕鍏笺亜閺冨倸甯舵い鎺嬪灲閺岋絽螖閳ь剟鏌婇敐鍜佹綎濠电姵鑹剧壕鍏肩箾閸℃ê绗掗柛妯封偓鎰佹富闁靛牆楠搁獮鏍煟濡や焦宕岄柕鍡曠窔瀵粙顢橀悙鑼崺闂備礁鎼ˇ浼村垂瑜版帗鍋柛銉戔偓閺€鑺ャ亜閺傛娼熷ù鐘崇矒閺屾稓鈧綆鍋呯亸鐗堛亜閵婏絽鍔﹂柟顔界懇楠炴捇骞掗幘鎼晪闂傚倷娴囬鏍窗濮樿泛鐤炬い鎰╁€曢崹婵囩箾閸℃ɑ灏柛銊ュ€归妵鍕籍閸パ傛睏闂侀潧鐗滈崳锝咁潖婵犳艾纾兼繛鍡樺灩閻涖垹鈹戦悙鏉垮皟闁告侗鍠栨惔濠囨⒑缁洖澧叉い銊ョ箻閹宕滄担鐟版瀾闂佸搫鍟悧蹇撶暤娓氣偓閻擃偊宕堕妸锔绢槶缂佺偓鍎抽崥瀣┍婵犲浂鏁嶆繝闈涙濮规顪冮妶鍡樷拹婵炶尙鍠栧濠氬焺閸愩劎绐炴繝鐢靛Т鐎氼剟銆傞悜妯肩瘈闁冲皝鍋撻柛灞剧矌閻撴挸螖閻橀潧浠滈柛鐔告綑閻ｅ嘲螖閸愵亞鐣堕柡澶屽仦婢瑰棝鎯勬惔顫箚闁绘劦浜滈埀顒佺墵楠炴劖銈ｉ崘銊э紱闂佺粯鏌ㄩ幉鈥斥枍閻樼粯鐓ラ柡鍐ㄥ€婚幗鍌涚箾閸粎鐭欓柡宀嬬秮楠炲洭顢橀悙鐢点偡闂備礁鎼Λ瀵稿緤妤ｅ啨鈧啴濡烽埡鍌氣偓椋庘偓鐟板閸犳牠宕滈弶娆炬富闁靛牆楠搁獮鏍煟韫囨梻绠為柛鈺冨仱楠炲鏁冮埀顒勬煁閸ヮ剚鐓熼柡鍐ㄧ墛閺侀亶鏌ｉ敐搴″濞ｅ洤锕幃娆擃敂閸曘劌浜鹃柕鍫濐槸閸屻劎鎲搁悧鍫濈瑨缂佲偓婢舵劖鐓欓弶鍫濆⒔閻ｉ亶鏌￠崟鈺佸姦闁哄苯绉烽¨渚€鏌涢幘鏉戝摵濠碉紕鏁诲畷鐔碱敍濮橀硸鍞洪梻浣烘嚀閻°劎缂撴ィ鍐ㄧ；闁规崘顕х粻鐟懊归敐鍥剁劸闁诲寒鍘奸埞鎴︽偐缂佹ɑ閿┑鐐茬湴閸斿海鍒掔紒妯稿亝闁告劏鏅濋崢閬嶆⒑閺傘儲娅呴柛鐘宠壘閳绘挸螣閼测晝锛滈梺缁樏崯鍧楀煝閺囥垺鐓涚€光偓鐎ｎ剛鐦堥悗瑙勬礋娴滃爼銆佸鈧幃鈺呭垂椤愶綆鍟岄梻鍌氬€风粈渚€骞栭锔藉剹濠㈣泛鏈畷鍙夌節闂堟稒顥犻柡鍡畵閺屾盯顢曢敐鍡欘槬闁哥儐鍨跺娲濞戝磭纭€闂佺鏈粙鎴炵濠靛牏纾介柛灞捐壘閳ь剚鎮傚畷鎰版倻閼恒儱娈戦梺鍏兼倐濞佳囧垂閺冣偓閵囧嫰骞橀崡鐐典患闂傚倸鍋嗛崹鍫曞蓟閵娿儮鏀介柛鈾€鏅滅瑧闂備浇妫勯崯浼村窗閺嶎厼钃熼柡鍥ュ灩闁卞洦绻濋崹顐㈠缁楁垹绱撻崒娆掑厡濠殿喚鏁搁弫顕€鏁撻悩鑼舵憰闂佺粯鏌ㄩ崥瀣磹缂佹ü绻嗘い鏍ㄧ箖椤忕姴霉閻樿尙鎽犵紒缁樼箓閳绘捇宕归鐣屼邯闂佽瀛╃粙鍫ュ疾濠靛绠?${result.data.unmatchedFiles.length} 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮诲☉妯锋婵鐗婇弫楣冩⒑閸涘﹦鎳冪紒缁橈耿瀵鏁愭径濠勵吅闂佹寧绻傚Λ顓炍涢崟顖涒拺闁告繂瀚烽崕搴ｇ磼閼搁潧鍝虹€殿喛顕ч埥澶娢熼柨瀣垫綌婵犳鍠楅〃鍛存偋婵犲洤鏋佸Δ锝呭暞閳锋垿鏌涘☉姗堝姛闁瑰啿鍟扮槐鎺旂磼濮楀牐鈧法鈧鍠栭…鐑藉极閹邦厼绶炲┑鐘插閸氬懘姊绘担鐟邦嚋缂佽鍊歌灋妞ゆ挾鍊ｅ☉銏犵妞ゆ牗绋堥幏娲⒑閸涘﹦绠撻悗姘卞厴瀹曟洘鎯旈敐鍥╋紲闂佸吋鎮傚褔宕搹鍏夊亾濞堝灝鏋涙い顓犲厴楠炲啴濮€閵堝懐顦ч柣蹇撶箲閻楁鈧矮绮欏铏规嫚閺屻儱寮板┑鐐板尃閸曨厾褰炬繝鐢靛Т娴硷綁鏁愭径妯绘櫓闂佸憡鎸嗛崪鍐簥闂傚倷鑳剁划顖炲礉閿曞倸绀堟繛鍡樻尭缁€澶愭煏閸繃顥撳ù婊勭矋閵囧嫰骞樼捄鐩掋垽鏌涘Ο渚殶闁逞屽墯椤旀牠宕伴弽顓涒偓锕傛倻閽樺鐎梺褰掑亰閸樿偐娆㈤悙娴嬫斀闁绘ɑ褰冮顐︽煛婢跺﹥鍟炲ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍋呴弳婊冣攽閻樺弶澶勯柛濠傛健閺屻劑寮撮悙娴嬪亾閸濄儱顥氶柛褎顨嗛悡娆撴煕閹炬鎳庣粭锟犳⒑閹惰姤鏁遍柛銊ユ健瀵鎮㈤崗鐓庢異闂佸疇妗ㄥ鎺斿垝閼哥數绡€缁剧増菤閸嬫捇鎮欓挊澶夊垝闂備礁鎼張顒傜矙閹烘梹宕叉繝闈涱儏绾惧吋绻涢幋鐏荤厧菐椤曗偓閺岋絾鎯旈姀鈺佹櫛闂佸摜濮甸惄顖炪€佸鎰佹▌闂佺硶鏂傞崕鎻掝嚗閸曨垰绠涙い鎺戭槹缂嶅倿姊绘担绋挎毐闁圭⒈鍋婂畷鎰版偡閹佃櫕鐎洪梺鎼炲労閸撴岸鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬濡炪倖娲樼划搴ｆ閹烘梹瀚氶柟缁樺坊閸嬫挸顫㈠畝鈧禍杈ㄧ節閻㈤潧浠﹂柛銊у枛楠炲﹪鎮欓崫鍕€炲銈嗗坊閸嬫捇宕鐐村仭婵犲﹤鍟扮粻鍐差熆鐟欏嫭绀嬮柟绋匡攻缁旂喎鈹戦崱娆懶ㄩ梺杞扮劍閸旀瑥鐣烽妸鈺婃晩闁芥ê顦竟宥夋⒑鐠囨彃顒㈢紒瀣笧閹广垽宕熼鐕佹綗闂佽宕橀褏澹曢崗鍏煎弿婵☆垵宕靛Ο鍌炴煏韫囧鈧牠鎮￠妷鈺傜厸闁搞儯鍎辨俊铏圭磼閵娧呭笡闁靛洤瀚板鎾敂閸℃ê浠归梻浣哥秺椤ユ挻鎱ㄩ幘顕呮晩闊洦渚楅弫濠囨煕韫囨洖甯堕柍褜鍓﹂崹浼村煘閹达附鍋愭い鏃囧亹娴煎洤鈹戦悙宸Ч闁烩晩鍨跺顐﹀礃椤旇姤娅滈梺鎼炲労閻撳牆顭囬悢鍏尖拺闁告挻褰冩禍婵囩箾閸欏鑰块柛鈺傜洴楠炲鏁傞悾灞藉箞婵犵數鍋為崹鍫曟晝椤愶箑缁╅悹鍥ф▕閻斿棝鎮归崫鍕儓妞ゅ浚鍙冮弻锛勪沪閸撗佲偓鎺楁煃瑜滈崜銊╁箑閵夆晛绀冪憸宥壦夊鑸碘拻闁稿本鑹鹃埀顒傚厴閹虫宕奸弴妞诲亾閿曞倸閱囬柕澶樺枟閺呯偤姊虹化鏇炲⒉缂佸鍨圭划缁樺鐎涙鍘炬繝娈垮枟閸旀洟鍩€椤掍胶澧柣锝囧厴瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涚紒瀣浮閺佸秴顓奸崱娆戭啎闁诲繐绻戦悧妤€鈻嶆繝鍥ㄧ厸閻忕偟鍋撶粈鍐偓鍨緲鐎氭澘鐣烽悡搴樻斀闁割偅绮嶉崑鍛節閻㈤潧浠滈柣掳鍔庨崚鎺楀箻閸撲椒绗夐梺鍝勭▉閸樺ジ鎷戦悢鍝ョ闁瑰鍊戝顑╋綁宕奸悢铏诡啎闂佺硶鍓濋敋濠殿喖顦辩槐鎺斺偓锝庝簼閸犳ɑ鎱ㄦ繝鍌涙儓閻撱倝鎮归崶銊ョ祷缂佺姴鎼—鍐Χ閸愩劌顬堥梺纭呮珪閿曘垽宕规ィ鍐╂櫆闁绘劦鍓欑壕顖炴⒑闂堟侗鐓紒鐘冲灩婢规洟顢涢悙绮规嫼闂佽鍨庨崨顖ｅ敹婵犵數濮崑鎾诲级閸稑濡兼い鏇憾閺屾盯濡烽鐓庮潽闂佹娊鏀遍崹鐢告箒闂佺绻楅崑鎰板箠閸涘瓨鐓熼柨婵嗩槷閹查箖鏌″畝瀣埌閾绘牕霉閿濆洦鍤€缁炬澘绉撮—鍐Χ鎼粹€茬盎缂備胶绮崹褰掑箲閵忕姭鏀介柛鈾€鏅滈崓闈涱渻閵堝棗绗掗柛瀣功濡叉劙宕ｆ径宀€鐦堝┑鐐茬墕閻忔繈寮搁悢鍏肩叆婵ɑ澧庨崑鎾舵喆閸曨剙顦╅梺鍛婃尵閸犳洟鎯屾ィ鍐┾拺闂侇偆鍋涢懟顖涙櫠閹殿喚纾奸弶鍫涘妽瀹曞瞼鈧娲樼敮鎺楀煝鎼淬劌绠ｆい鎾跺晿濠婂嫪绻嗛柣鎰典簻閳ь剚鐗犲畷褰掓濞磋櫕绋戦埥澶愬閻樺磭鈧剙顪冮妶鍡樼５闁稿鎹囬弻鈩冩媴鐟欏嫬纾抽梺璇″枓閺呯姴鐣烽敐鍡楃窞閻忕偟顭堟禍鐐亜閹烘垵顏柛濠傜仛椤ㄣ儵鎮欓懠顑胯檸闂佸憡姊圭喊宥夊Φ閸曨垱鏅滈悹鍥皺娴狀垶姊虹紒妯碱暡闁稿孩濞婇、姗€宕楅悡搴ｇ獮闁诲函缍嗛崜娆撶嵁閸喍绻嗛柣鎰典簻閳ь剚鐗犲畷婵嬪箣閿曗偓绾惧綊鏌￠崶銉ョ仼闁告垹濞€閺岋繝宕橀妸褍顤€闂佺粯鎸诲ú姗€骞堥妸銉富閻犲洩寮撴竟鏇犵磽閸屾瑨鍏屽┑顔炬暬閹囧即椤喚绋忛棅顐㈡处缁嬫帡骞嗛悙鐑樼厱闁挎棁顕ч獮姗€鏌ㄥ☉娆戠煀闁宠鍨块、娆戠驳鐎ｎ偆鏆ユ繝纰樻閸嬪懘鎮烽埡鍛畺濡わ絽鍟柋鍥煛閸モ晛鏆遍柟鐤缁辨捇宕掑▎鎴濆闂佹寧娲嶉弲娑㈠煝閹捐绫嶉柍褜鍓氱粚杈ㄧ節閸ヨ埖鏅濋梺鎸庣箓濞层劑鎮块崟顖涒拺闂傚牊绋掗ˉ娆戠磼閳ь剚绗熼埀顒勬晲閻愭祴鏀介悗锝呯仛閺呫垺绻濋姀锝嗙【闁兼椿鍨伴锝夊箮閼恒儮鎷绘繛杈剧悼椤牓藟韫囨稒鐓曢悗锝庝簼椤ャ垻鈧娲戦崡鎶界嵁濡吋瀚氶柟缁樺笒娴滆埖淇婇悙顏勨偓鏇犳崲閹扮増鍋嬪┑鐘叉搐閻撴洟鏌熸潏楣冩闁绘挻鐟╅弻銈吤圭€ｎ偅鐝旀繛瀵稿У缁捇寮诲☉銏犳闁告繂瀚竟鏇㈡⒒閸屾艾鈧绮堟笟鈧獮澶愭晸閻樿尙顦梺鍝勬瘽妫颁焦鐫忛梻浣虹帛閸旀洟鎮樺璁圭稏闁哄洢鍨洪悡娑㈡煕閹板墎鍒板ù婊呭亾缁绘盯鏁愰崨顔芥倷闂佹寧娲︽禍婵囩┍婵犲洤閱囬柡鍥╁仧閸婄偛顪冮妶搴″⒒闁哥姵鎹囧畷鏇㈡偨缁嬭儻鎽曞┑鐐村灦閸╁啴宕戦幘缁樻櫜閹肩补鈧剚娼诲┑鐐差嚟婵炩偓濞存粌鐖煎濠氬焺閸愨晛顎撶紓浣割儐鐎笛冣枔缂佹绡€婵炲牆鐏濋弸鎾绘煕鐎ｎ偅宕屾慨濠呮缁辨帒螣韫囷絼閭柟顔矫～婵嬵敄閼恒儳浜栧┑掳鍊х徊浠嬪疮椤栫偛鐓曢柟杈鹃檮閸嬶綁鏌熼鐔风瑨濠碘€炽偢閺岋紕鈧綆鍋呴悡銉╂煃鐟欏嫬鐏存い銏＄懇閹瑩顢楁担鍦闂佽姘﹂～澶娒哄鈧畷婵嗏枎閹惧磭鐣哄┑鐘诧工閻楀﹪宕靛澶嬬厪濠㈣鍨伴崯顐ょ不閻愮儤鈷掗柛灞惧嚬閻擃剟鏌涚€ｎ亜顏╅悡銈夋煥閺囩偛鈧摜绮婚弶搴撴斀闁绘ê鐤囨竟姗€鏌ｉ妶搴℃珝闁哄矉缍侀獮鍥敊閻撳骸顬嗛梻浣虹帛閹歌煤閻旂厧绠栨俊銈呮噺閺呮煡骞栫€涙绠橀柛鎴濈秺濮婃椽妫冮埡鍐╁仹闂佸搫鎷嬮崑鍡椢ｉ幇鏉跨闁规儳顕粔鍫曟⒑闂堟侗鐓紒鐘冲灩婢规洟骞庨懞銉モ偓鐢告偡濞嗗繐顏紒鈧崘顔藉仺妞ゆ牗绋戝ù顕€鏌ㄥ┑鍫濅粶闁宠鍨归埀顒婄到閻忔岸寮查悙鐑樷拺闁兼亽鍎嶉鍩跺洭顢欓悾宀€褰鹃梺鍝勬川閸犲秶鎹㈤崱娑欑厽闁归偊鍓氶埢鏇㈡煕鎼达紕绠婚柟顔筋殔閳藉骞掗幘瀵稿絾闂備礁鎲＄敮鎺楁晝閵壯呯处濞寸姴顑呭婵嗏攽閻樻彃顏╂鐐村姍濮婅櫣鎷犻懠顒傤唺闂佺顑囨繛鈧い銏′亢椤﹀湱鈧娲樼换鍌烇綖濠靛洦缍囬柍鍝勫亰缁憋繝姊绘担绛嬪殐闁搞劌楠搁悾婵嬪焵椤掑嫬瑙﹂悗锝庡枟閳锋垿鏌涘┑鍡楊伀闁诲繘浜堕弻娑㈡偐瀹曞洤鈷岄梺缁樹緱閸ｏ絽鐣烽崡鐑嗘僵闁稿繐銇欓鈧埞鎴︽倷閼碱剚鎲肩紓渚囧枤婵數绮嬪澶樻晜闁割偅绻嗛幗鏇炩攽閻愭潙鐏﹂柛鈺佸暣瀹曟垿骞樼紒妯绘珳闁硅偐琛ラ埀顒冨皺閸戝綊鏌ｆ惔銈庢綈婵炲弶鐗犻幆澶嬬附缁嬭法鍔﹀銈嗗笒閸犳艾顭囬幇顓犵闁告瑥顧€閼板潡鏌曢崱妤€鏆ｇ€规洖宕灃濠电姴鍊归鍌炴⒒娴ｅ憡鍟炴繛璇х畵瀹曟粌鈽夊顒€袣闂侀€炲苯澧紒缁樼⊕濞煎繘宕滆閸╁本绻濋姀銏″殌闁挎洏鍊涢悘瀣攽閻樿宸ラ柣妤€锕崺娑㈠箳濡や胶鍘遍柣蹇曞仦瀹曟ɑ绔熷鈧弻宥堫檨闁告挾鍠栬棢闁圭偓鏋奸弸搴ㄦ煏韫囨洖顎屾繛灏栨櫊閹銈﹂幐搴哗闂佸憡妫戠粻鎴︹€旈崘顔嘉ч柛鈩冾殘閻熴劑姊虹粙鍖″伐闁硅绱曠划瀣箳閹搭厾鍙嗛梺鍓插亞閸犳捇宕㈤幆褉鏀介柣鎰硾閽勫吋銇勯弴鍡楁处閸婂爼鏌ㄩ悢鍝勑ｉ柣鎾寸洴閺屾稑鈽夐崡鐐茬濡炪倧绲炬繛濠囧蓟瀹ュ牜妾ㄩ梺鍛婃尰濮樸劎鍒掑▎鎾崇婵°倓鐒﹀▍鍥⒑鐎圭姵銆冮悹浣圭叀瀵悂寮Λ闈涚秺閹晛顔忛鐓庡闂備胶绮幐楣冨窗閺嶎厼钃熼柣鏂垮悑閻掍粙鏌ㄩ弴妤€浜炬繝鈷€灞界仸闁哄苯绉剁槐鎺懳熼懡銈庢О濠电儑绲藉ú銈夋晝椤忓牄鈧礁鈽夊Ο婊勬閸┾偓妞ゆ帊鑳堕々鏌ユ煙椤栧棌鍋撻柡鈧禒瀣闁规儼妫勭壕瑙勪繆閵堝嫮鍔嶉柛娆忕箻閺岋綁骞嬮敐鍡╂缂佺偓鍎抽…鐑藉蓟閿濆绠涙い鏃傚帶婵℃椽姊虹粙娆惧剰妞ゆ垵妫欑粚杈ㄧ節閸ヮ灛褔鏌涘☉鍗炴灈婵炲拑绲跨槐鎾存媴閸濆嫷鈧矂鏌涢妸銉у煟鐎殿喛顕ч埥澶娢熼柨瀣垫綌婵犵妲呴崹浼村触鐎ｎ喖绠熷┑鍌氭啞閳锋垹绱掔€ｎ偒鍎ラ柛搴＄焸閺屽秷顧侀柛鎾存皑濞嗐垽鎮欏ù瀣潔濠电偛妫欓悷褔鎯屽Δ浣虹閺夊牆澧界粔顒佷繆椤愩垹顏€规洏鍨介弫宥夊礋椤撶媴绱抽梻浣侯焾閺堫剙顫濋妸銉ф懃缂傚倸鍊风粈渚€藝闁秴绠犻柟鍙ョ串缂嶆牠鐓崶銊︹拻缂佲檧鍋撴繝娈垮枟閿曗晠宕滃☉銏℃櫖婵犲﹤鍟犻弨浠嬫煟閹邦剙绾фい銉у仱閺屾盯鍩℃担鍝勵暫闁告椴搁妵鍕籍閸屾稒鐝紓浣叉閸嬫捇姊绘笟鈧褏鎹㈤崼銉ュ瀭婵炲樊浜滈崥褰掓煃瑜滈崜鐔奉潖濞差亜绠伴幖娣灩椤︹晜绻涚€涙鐭嬬紒顔芥崌楠炲啯銈ｉ崘鈺佲偓濠氭煢濡警妲烘い鎾存そ濮婃椽骞愭惔銏紩闂佺顑嗛幐楣冨焵椤掑倹鍤€闁硅绱曢幑銏ゅ礃椤斿槈锕傛煕閺囥劌鐏犻柛鎰ㄥ亾闂備線娼ц噹闁逞屽墮鍗遍柛顐犲劜閻撴瑩鏌涜箛鎾虫倯缂傚秵鍨块弻銊╁即閵娿倗鐩庡銈庡亜缁绘劗鍙呭銈呯箰鐎氼剛绮ｅ☉娆戠瘈闁汇垽娼у瓭闂佸摜鍣ラ崑濠呮闂佸啿鎼幊蹇涘煕閹达附鐓欓柤娴嬫櫅娴犳粌鈹戦鐓庘偓鎼佹箒濠电姴锕ゅΛ娆戞兜妤ｅ啯鐓熼柨婵嗘搐閸樺瓨顨ラ悙宸剶闁轰礁鍊块幊鐐哄Ψ閿旇鎴烽梻鍌氬€烽懗鍓佸垝椤栫偞鏅紓浣稿⒔閾忓酣宕ｉ崘銊ф殾闁靛繈鍊ら弫鍌炴煕濞戝崬鐏ｉ柣锕€鐗撳鍝勑ч崶褏浼堝┑鐐板尃閸曨収娴勯悷婊勬瀵鈽夊锝呬壕闁挎繂楠告禍婵嬫倶韫囷絽寮柡灞界Ф閹风娀鎳犻顐庡應鍋撶憴鍕鐎规洦鍓熼崺銉﹀緞婵炵偓鐎婚梺鐟扮摠缁诲倻绮诲ú顏呪拻闁稿本鐟︾粊鐗堛亜椤愩埄妲搁柣锝呭槻铻ｉ悶娑掑墲閻忓啫鈹戦悙鏉戠仧闁搞劌缍婂畷娆撴偐瀹曞洨顔曢梺鐟扮摠閻熴儵鎮橀鍫熺厽闁规儳顕ú鎾煙椤旀枻鑰块柟顔界懇濡啫鈽夊Δ鈧ˉ姘辩磽閸屾瑨顔夐柛瀣尭椤法鎹勯搹鍦紘缂佺偓鍎抽妶鎼佸蓟閿濆憘鐔兼惞閻у摜绀婇梻浣瑰墯閸ㄥ崬煤濠婂懏顫曢柟鐑樻⒒绾惧吋淇婇婵嗕汗闁汇倕瀚伴幃妤冩喆閸曨剛顦ㄩ梺鎸庢磸閸ㄨ棄鐣峰ú顏呮櫢闁绘灏欓ˇ銊╂⒑闂堟丹娑㈠礃閵娧冨笓闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊炲銈嗗笒椤︿即寮查鍫熷仭婵犲﹤鍟扮粻缁橆殽閻愭潙鐏村┑顔瑰亾闂侀潧鐗嗛幊搴ㄦ嚀閸喒鏀介柣鎰綑閻忥附銇勯鐐村枠鐎规洘绻堥弫鍐焵椤掑嫧鈧棃宕橀鍢壯囨煕閳╁喚娈橀柣鐔稿姍濮婅櫣绱掑Ο娲殝缂備胶濮甸幑鍥嵁閸愵煈娼ㄩ柍褜鍓熷濠氬幢濡ゅ﹤鎮戦梺绯曞墲閻熴儵鐛幇鐗堚拻濞撴埃鍋撻柍褜鍓涢崑娑㈡嚐椤栨稒娅犳い鏍ㄧ矌绾惧ジ鏌涚仦鍓р槈缂佹う鍥ㄧ厓鐟滄粓宕滈妸褏绀婇柛鈩冪☉绾惧鏌涢埄鍐槈闁稿被鍔岄湁闁绘ê妯婇崕鎰版煃闁垮鐏╅柟鍙夋倐閹囧醇濠靛牏鎳嗗┑鐐茬摠缁牓宕￠幎钘夎摕婵炴垯鍨规儫闂侀潧顧€缁茶姤绂掗鈧幃妤冩喆閸曨剛顦梺杞扮劍閹倿宕洪埀顒併亜閹烘埊鍔熺紒澶屾暬閺屾盯鎮╅幇浣圭杹闁芥鍠庨埞鎴︽偐閹绘帗娈ф繛瀛樼矋缁捇寮婚悢鍏煎€绘俊顖濇閸旂鈹戦檱鐏忔瑩鈥﹂崼銉⑩偓锕傛嚄椤栵絾楔闂備礁鎲￠〃鍡樼箾婵犲偆鍤?{unmatchedNames}`,
      )
    } else {
      ElMessage.success(
        `闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈嗙節閳ь剟鏌嗗鍛姦濡炪倖甯掗崐褰掑吹閳ь剟鏌ｆ惔銏犲毈闁告瑥鍟悾宄扮暦閸パ屾闁诲函绲婚崝瀣уΔ鍛拺闁革富鍘奸崝瀣煕閵娿儳绉虹€规洘鍔欓幃娆忣啅椤旇棄鐦滈梻渚€娼ч悧鍡椢涘Δ鍐當闁圭儤鎸舵禍婊堟煥閺傝法浠㈢€规挸妫涢埀顒侇問閸犳鎮￠敓鐘偓渚€寮崼婵嬪敹闂佺粯妫佸〒褰掓偨缂佹绡€闁汇垽娼у瓭闂佹寧娲忛崐婵嗙暦椤栫偞鍋嬮柛顐ゅ枑閻濓繝姊婚崒姘偓鐑芥倿閿旈敮鍋撶粭娑樻噺瀹曟煡鏌涢弴銊ョ仩缁惧墽绮换娑㈠箣濞嗗繒浠奸梺缁樻尰閿曘垽寮婚悢琛″亾閻㈡鐒剧悮銉╂⒑缁嬫鍎愰柟鐟版喘瀵偊骞囬鐔峰妳闂佺偨鍎寸亸娆撳礄鐟欏嫮绡€闁汇垽娼ф禒婊堟煙閸愭煡顎楅悡銈嗐亜閹捐泛鍓辨繛鍏肩墵閺屟嗙疀閹剧纭€闂佹椿鍘介悷鈺呭箖瑜版帒绠掗柟鐑樺灥椤姊洪崨濠冾梿妞ゎ偄顦遍幑銏犫攽閸繃鐎冲┑鈽嗗灠閸㈠弶绂嶆ィ鍐╃叄闊浄绲芥禍婊呯磼閹邦厾銆掔紒杈ㄦ尰缁楃喖宕惰閻忓秹姊洪懡銈呮瀭闁告柨娴烽崚鎺旀嫚濞村顫嶉梺闈涚箳婵兘鎯堥崟顖涒拺缂佸瀵у﹢鎵磼椤斿ジ顎楅崡閬嶆煕閵夘喖澧柍閿嬪笒閵嗘帒顫濋敐鍛婵犵數鍋橀崠鐘诲礋閸偒鍟嶉梻濠庡亜濞诧箑煤閺嶎偅顐介柕鍫濇偪瑜版帗鍋愮€瑰壊鍠栭崜閬嶆⒑缁嬫鍎忛柛濠傛健瀵鎮㈤悡搴ｎ吋濡炪倖姊婚埛鍫ュ汲椤撱垺鈷戠紓浣股戠亸鐗堢箾閼碱剙鏋涚€殿喖顭烽弫鎾绘偐閼碱剦妲伴梻浣瑰缁诲倿骞婂鍡欑彾闁哄洢鍨洪埛鎺懨归敐鍫燁仩閻㈩垱绋掗妵鍕Ω閵壯冾杸闂侀€涚┒閸旀垿鐛鈧、娆撴寠婢跺鍋呴梻鍌欒兌缁垶宕归悡骞盯宕熼鐘辩瑝闂佹寧绻傞ˇ浼存偂閵夆晜鐓涢柛銉厛濞堟柨霉濠婂牏鐣洪柡灞剧洴婵＄兘濡疯閹茶偐绱撴担铏瑰笡缂佽鐗婇幈銊╁焵椤掑嫭鐓ユ繝闈涙椤ョ娀鏌曢崱妯哄妞ゎ亜鍟存俊鍫曞幢濡ゅ啩娣繝鐢靛仜濡﹪宕㈡總鍛婂仼闁绘垼妫勯～鍛存煏閸繃鍣芥い鏃€鍔栫换娑欐綇閸撗冨煂闂佸憡蓱缁捇鐛箛鎾佹椽顢旈崨顏呭缂備胶铏庨崢濂稿箠鎼淬垻顩茬憸鐗堝笚閻撴洟鎮楅敐搴′簽婵炴彃顕埀顒冾潐濞叉鎹㈤崒婵堜簷闂備礁鎲℃笟妤呭窗濮樿泛鍌ㄩ柟闂寸劍閳锋垿鏌涘☉姗堟缂佸爼浜堕弻娑㈡偐閸愭彃鎽甸梺绯曟杺閸庢彃顕ラ崟顖氱疀妞ゆ挾濮撮獮妤佷繆閻愵亜鈧倝宕㈡禒瀣瀭闁割煈鍋呭▍鐘绘倵濞戞鎴﹀矗韫囨挴鏀介柣妯诲絻椤忣偊鎮介娑氭创闁哄瞼鍠庨悾锟犳偋閸繃鐣婚梻浣告贡閸樠呯礊婵犲洤绠栭柣鎴ｆ缁犮儲銇勯弴鐐村櫣濞寸姴缍婂濠氬磼濞嗘垵濡介梺娲讳簻缂嶅﹤鐣峰ú顏勭妞ゆ牗鑹鹃悗顓㈡煛婢跺﹦澧愰柡鍛矒瀵啿顭ㄩ崼鐔哄弳闂佺粯鏌ㄩ幖顐㈢摥闂備礁鎼鍕濮樿泛钃熸繛鎴欏灩缁犳盯姊婚崼鐔衡姇闁诲繐鐗撻弻娑㈡倻閸℃浠稿┑顔硷龚濞咃綁鍩€椤掆偓濠€杈ㄦ叏閻㈢违闁告劦浜炵壕濂告煙缂佹ê绔鹃柛瀣ㄥ灲閺屸剝鎷呯粙鎸庢閻庤娲樼敮鎺楀煡婢跺娼╂い鎺嗗亾缂佺姷鍋ゅ濠氬磼濞嗘埈妲梺鍦拡閸嬪嫮鍙呴梺闈涚箞閸婃洜绮堟径灞稿亾閸忓浜鹃梺鍛婃处閸嬪嫰宕甸幋锔解拺闂傚牊绋撴晶鏇熴亜閿斿灝宓嗛柟顕嗙節閹垽宕楅懖鈺佸妇闂備礁澹婇崑鍛崲閸岀偛鐒垫い鎺嗗亾闁硅绱曠划瀣吋閸℃劕浜濋梺鍛婂姀閺備線骞忔繝姘拺缂佸瀵у﹢浼存煟閻曞倸顩紒顔硷躬閹囧醇濞戞鐩庢俊鐐€栭崝鎴﹀春閸曨倠锝夊箹娴ｅ湱鍘介梺鎸庣箓閹冲骸危婵犳碍鎳氶柨婵嗩槹閸嬬姵绻涢幋鐐茬瑨濠⒀勭叀閺岋綀绠涢幘铏闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿Т婵吋绻濋悽闈涗户闁告鍐剧劷闁跨喓濮撮弰銉╂煃瑜滈崜姘跺Φ閸曨垰绠抽柛鈩冦仦婢规洟姊绘担渚劸闁挎洏鍊濋獮妤€顭ㄩ崼婵堢厬闂佸憡渚楅崣搴°€掓繝姘厪闁割偅绻冮崳鐣岀磼閻樺崬宓嗛柡宀€鍠栧畷妯侯啅椤旇В鏋呮俊銈囧Х閸嬫稓鎹㈤幇顔煎疾婵＄偑鍊曠换鎰板箠婢舵劕绠繛宸簼閳锋垿鏌涘☉姗堝姛闁宠棄顦甸弻銊╁即椤忓棛鏆ら梺绯曟杺閸庢彃顕ラ崟顖氱疀妞ゆ挾濮村鎶芥⒒娴ｅ憡鎯堟繛鏉戝€圭粋宥夋倷閻㈢數鐓撻梺鐓庮潟閸婃澹曟總鍛婄厱閻忕偟鍋撻惃鎴﹀极閸喓绡€婵炲牆鐏濋弸鎾绘煕鐎ｎ偅宕岄柡宀€鍠愰妶锕傚箰鎼达絽娑х紓鍌欑閸婂摜绮旈幘顔光偓锕傚Ω閳轰胶顦伴梺瀹犮€€閸嬫挾绱掗妸銉吋婵﹨娅ｉ幉鎾礋椤愵偅顥撻梻浣告惈閹冲繘鎯勯鐐茬畺闁绘劗鍎ら崐缁樹繆椤栨碍璐＄紒鐘冲哺濮婃椽宕ㄦ繝鍕櫑濡炪倧缂氶崡铏繆闂堟稈鏀介悗锝庡亞閸樻悂鎮楅崗澶婁壕闂侀€炲苯澧寸€规洑鍗冲浠嬵敇閻旇渹绮ф俊鐐€栧ú宥夊磻閹惧灈鍋撶憴鍕缂傚秴锕妴浣糕枎閹惧磭鐓戦梺闈涱檧缁犳垶绂嶅┑瀣拻闁稿本鑹鹃埀顒勵棑缁牊绗熼埀顒勫箖閸ф鐐婃い鎺戯功缁嬪繑绻濋姀锝呯厫闁告梹娲熷畷褰掑磼閻愬鍘卞銈庡幗閸ㄧ敻寮搁妶澶嬬厸闁糕槅鍘鹃悾鐢告煛鐏炲墽娲存い銏℃礋閺佹劙宕卞▎妯恍氶梻鍌欒兌缁垶骞愭繝姘剮妞ゆ牜鍋涢拑鐔哥箾閹存瑥鐏╃紒鐘崇洴閺屾稖绠涢幘瀛樺枑闂佸憡鍨归幊鎾烩€旈崘顔嘉ч幖绮光偓鑼泿闂備焦妞块崢濂稿磹閹间緤缍栭煫鍥ㄦ⒒缁♀偓濠殿喗锕╅崜娑㈡晬濠婂啠鏀介柣鎰级椤ョ偤鎮介娑樻诞鐎规洏鍨介崹楣冨箛娴ｇ懓鐦滈梻渚€娼ч悧鍡橆殽閹间胶宓侀柡宥庡幗閻撶喐淇婇妶鍕妽閻忓浚鍘介妵鍕即椤忓棛袦闂佽鍠曠划娆忕暦濠婂牆鐭楀璺侯儐閻濇粓姊婚崒娆掑厡妞ゎ厼鐗撳鐢割敆閸曨剙娈炴俊銈忕到閸燁垶宕愮捄琛℃斀闁绘ê寮舵径鍕煕婵犲嫭鏆柡灞剧缁犳盯骞欓崘鈹附绻涚€涙鐭掔紒鐘崇墪椤繐煤椤忓嫬绐涙繝鐢靛Т閸熶即鏁嶉弴銏♀拺闁告繂瀚埀顒勵棑濞嗐垹顫濋鍌涙闂佺鎻粻鎴犵不婵犳碍鍋ｉ柛銉簻閻ㄦ椽鏌ㄥ☉娆戠煉婵﹨娅ｇ槐鎺懳熼崫鍕垫綋闂備礁顓介弶鍨潎閻庤娲樺ú鐔笺€侀弮鍫濋唶闁绘柨寮剁€氬ジ姊婚崒姘偓鎼佹偋閸愵喖鐤炬繛鎴欏灪閸庡﹥绻濇繝鍌滃闁绘挻娲橀幈銊ヮ渻鐠囪弓澹曠紓鍌欒兌婵敻鎮ч悩宸殨妞ゆ劑鍩勯崥瀣煕濞戝彉绨奸柡鍌楀亾闂傚倷鐒﹂幃鍫曞磿椤曗偓瀵彃鈹戠€ｅ灚鏅╅梺鍝勬储閸ㄦ椽鎮″☉姗嗙唵閻犺櫣灏ㄩ崝鐔奉熆瑜庡ú鏍€﹂懗顖ｆЬ闂佸搫鎷嬮崑鍡涘礆閹烘垟鏋庨柟鐐綑濞堛儵姊洪棃娑氬婵☆偅顨婂鎼佸箣閿旇В鎷洪梺鍛婄箓鐎氬嘲危閹间焦鐓熼煫鍥ㄦ⒒缁犵偟鈧鍠楁繛濠囧箖濞嗘挻鍋ㄩ柣銏㈩暜缁辨煡姊绘担渚劸闁哄牜鍓欓～婵嬪Ω閿旇姤鐝￠梻鍌氬€峰ù鍥敋閺嶎厼绐楁俊銈呮噺閸嬶繝鏌嶉崫鍕櫡闁逞屽厸缁€浣界亙闂佸憡渚楅崢楣冩晬濠婂啠鏀介柣妯款嚋瀹搞儵鏌熼崘鑼闁挎繄鍋涢悾婵嬪礋椤戣姤瀚介梻浣侯焾閺堫剟鎮疯缁綁寮埀顒傛崲濞戞瑦濯撮柛鎰絻椤忓瓨绻涢崼婊呯煓闁绘搩鍋婂畷鍫曞Ω閿旂虎妲紓鍌欐祰缂堜即宕愰弴銏＄畳闂備胶绮敋婵☆垰锕畷鏇㈠箛閻楀牏鍘遍柣搴秵娴滄粓鍩€椤掆偓濞尖€愁嚕婵犳碍鍋勯柣鎾虫捣椤撶厧顪冮妶鍡樷拻闁冲嘲鐗撳鎶筋敇閵忊檧鎷虹紓鍌欑劍钃遍悘蹇曞缁绘盯鎳犻鈧弸娑氣偓娈垮枛椤兘寮幘缁樺亹闁肩⒈鍓﹀Σ浼存⒒娴ｇ懓顕滅紒璇插€块獮濠傤吋閸℃瑧褰鹃梺鍝勬储閸ㄦ椽鍩涢幒鎳ㄥ綊鏁愰崼鐕佷哗闁汇埄鍨辩粙鎺楀Φ閸曨垰惟闁靛／鍐炬澑缂傚倷鑳剁划顖炴儎椤栫偛鏄ラ柍褜鍓氶妵鍕箳瀹ュ洩绐楀┑鐐茬墔缁瑩寮婚敐澶婄疀妞ゆ挾鍋熺粊鐑芥⒑閸濆嫭锛旂紒鑼亾缁岃鲸绻濋崶褏顔夐梺褰掑亰娴滄粓骞嗛崼銏㈢＝濞达絼绮欓崫娲偨椤栥倗绡€妤犵偛鍟撮崺鈩冩媴閻戞ɑ顔曢梻浣规偠閸庮垶宕濆畝鍕瀭閺夊牄鍔嬬换鍡涙煏閸繃鎼愰崯鎼佹⒑缁嬫鍎戦柛瀣ㄥ€濆顐﹀礃椤旂⒈娼婇梺闈涚墕閸熺娀宕戦幘瀛樺缂侇垱娲橀～宥呪攽閳藉棗鐏﹂柡鈧柆宥忕稏鐎广儱鎳夐弨浠嬫煟閹邦剙绾фい銉у仱閺屾盯寮埀顒勬偋濠婂啠鏋庨柕蹇嬪€ら弫鍐煥閺冨泦鎺楀箯婵犳碍鈷戠紒瀣濠€浼存煠瑜版帞鐣洪柛鈹惧亾濡炪倖甯掗崐鎼佸储閹绢喗鐓欓柧蹇ｅ亽濞堟粎鈧娲樼划宥夊箯閸涱垳鐭欓悹鎭掑妺閸犲﹤鈹戦敍鍕杭闁稿﹥鐗犻幃褍顭ㄩ崼婵堬紱濠电偞鍨跺銊╂儗閸℃鐔嗛悹杞拌閸庡海绱掔拠鍙夘棡闁靛洤瀚板浠嬵敃椤厽鍕冮梻浣瑰缁嬫捇宕伴弽顓炶摕闁挎繂顦粻鎶芥煙閹碱厼鐏￠柡浣稿⒔缁辨挻鎷呴搹鐟扮闂佺儵鏅╅崹浼存偩閻戣棄纭€闁绘劕绉堕崰鏍х暦椤愶箑绀嬮柛顭戝亞缁夋寧绻濈喊澶岀？闁稿鍨垮畷鎰板箛閺夎法鏌у┑鐘绘涧椤戝懐绮堥崒娑欏弿婵＄偠顕ф禍楣冩倵濞堝灝鏋涙い顓炲槻椤曪綁骞橀鑺ユ珫闂佸憡娲﹂崢钘夘熆閹达附鈷掑ù锝呮啞閹牊绻涚仦鍌氬鐎规洘鍔欓、鏇㈠煑閳哄偆娼旈梻渚€娼ф蹇曟閺囥垹鍌ㄩ柟闂寸劍閳锋垿姊洪銈呬粶闁兼椿鍨遍弲鍫曨敍濠婂懐锛滈梺绋挎湰缁嬫垹绮閺屽秷顧侀柛鎾卞妿缁辩偤宕卞☉妯硷紱闂佺硶鍓濈粙鎴﹀磼閵娾晜鐓欓柛鎾楀懎绗￠梺鎶芥敱閸ㄥ潡骞冨Δ鍛嵍妞ゆ挾鍊敐澶嬬厪闁糕剝顨呴弳鐔虹磼鏉堛劌娴柛鈹惧亾濡炪倖甯婇懗鍫曟偡瑜版帗鐓冪憸婊堝礈濞嗘搩鏁嬮柨婵嗩槸缁€鍐╃箾閺夋埈鍎愰柣搴☆煼濮婅櫣鎲撮崟顐闂佸搫鎳忛悷褔鎳炴潏銊х瘈婵﹩鍘搁幏娲⒑閸涘﹦绠撻悗姘煎幖椤斿繐鈹戠€ｎ偆鍘遍梺缁橆焾濞呮洖鐣峰畝鍕厵妞ゆ牗纰嶅﹢鎵磼缂佹绠炵€规洖鐖兼俊鎼佸Ψ閿旇鎮梻鍌氬€峰ù鍥綖婢跺鐝堕柛鈩兩戝▍鐘充繆閵堝懏鍣洪柛瀣€块弻锟犲炊閵夈儳浠鹃梺缁樻尭缁绘劙鈥︾捄銊﹀磯濞撴凹鍨伴崜浼存⒑鐠囪尙绠為柛搴＄－濡叉劙骞掗幘宕囩獮闁诲繒鍋犲Λ鍕嵁鐎ｎ喗鍊甸悷娆忓绾炬悂鏌涙惔锝嗘毈闁靛棔绶氬鎾閳╁啯鐝曢梻浣藉Г閿氭い锔诲亰瀹曟垿骞樼紒妯轰缓闂佸憡绋戦敃銈嗙椤撶偐鏀介柣鎰级椤ユ粎绱掔紒妯哄妞ゃ垺妫冮、鏃堝幢濞嗘埊绱查柣搴″帨閸嬫捇鏌涢幇銊︽珖闁靛棗锕︾槐鎾存媴娴犲鎽甸柣銏╁灙閳ь剙纾弳锕傛煥濠靛棙顥滅紒鍓佸仜閳规垿鎮╅幓鎺嗗亾濮濆矈鏆┑鐘殿暜缁辨洟宕戦幋锕€纾归柡宥庣亹妤﹁法鐤€婵炴垶顭囬敍鐔兼⒒閸屾氨澧涚紒瀣崌瀵娊鏁冮崒娑氬幗闂佸搫鍟崐鐢稿箯閿熺姵鐓涘ù锝呮啞婢跺嫮绱掔紒妯兼创妤犵偛顑夐幃妯兼嫚閹绘帗鍊紓浣规⒒閸犳牕顕ｉ幘顔碱潊闁抽敮鍋撻柟閿嬫そ濮婃椽宕烽褏鍔稿┑鐐存尦椤ユ挾鍒掓繝姘婵犮垹瀚Λ鍐箖閳哄懎鐭楀璺猴攻濞堟﹢姊绘担鍛婃儓闁瑰啿瀛╅弲鑸垫償閿濆棭娼熼梺鍦劋閸わ箓鎮㈤悡搴㈠祶濡炪倖鎸炬慨鐑藉汲娴煎瓨鈷掗柛灞剧懅椤︼附绻濋埀顒佹綇閳轰礁鐏婂銈嗙墬缁秹寮冲鍫熺厽闁归偊鍠楅弳鈺呮煟椤撶喐宕岄柡宀嬬秮楠炲鎮欓崱妯虹伌鐎?${result.data.importedCount} 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮诲☉妯锋婵鐗婇弫楣冩⒑閸涘﹦鎳冪紒缁橈耿瀵鏁愭径濠勵吅闂佹寧绻傚Λ顓炍涢崟顖涒拺闁告繂瀚烽崕搴ｇ磼閼搁潧鍝虹€殿喛顕ч埥澶娢熼柨瀣垫綌婵犳鍠楅〃鍛存偋婵犲洤鏋佸Δ锝呭暞閳锋垿鏌涘☉姗堝姛闁瑰啿鍟扮槐鎺旂磼濮楀牐鈧法鈧鍠栭…鐑藉极閹邦厼绶炲┑鐘插閸氬懘姊绘担鐟邦嚋缂佽鍊歌灋妞ゆ挾鍊ｅ☉銏犵妞ゆ牗绋堥幏娲⒑閸涘﹦绠撻悗姘卞厴瀹曟洘鎯旈敐鍥╋紲闂佸吋鎮傚褔宕搹鍏夊亾濞堝灝鏋涙い顓犲厴楠炲啴濮€閵堝懐顦ч柣蹇撶箲閻楁鈧矮绮欏铏规嫚閺屻儱寮板┑鐐板尃閸曨厾褰炬繝鐢靛Т娴硷綁鏁愭径妯绘櫓闂佸憡鎸嗛崪鍐簥闂傚倷鑳剁划顖炲礉閿曞倸绀堟繛鍡樻尭缁€澶愭煏閸繃顥撳ù婊勭矋閵囧嫰骞樼捄鐩掋垽鏌涘Ο渚殶闁逞屽墯椤旀牠宕伴弽顓涒偓锕傛倻閽樺鐎梺褰掑亰閸樿偐娆㈤悙娴嬫斀闁绘ɑ褰冮顐︽煛婢跺﹥鍟炲ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍋呴弳婊冣攽閻樺弶澶勯柛濠傛健閺屻劑寮撮悙娴嬪亾閸濄儱顥氶柛褎顨嗛悡娆撴煕閹炬鎳庣粭锟犳⒑閹惰姤鏁遍柛銊ユ健瀵鎮㈤崗鐓庢異闂佸疇妗ㄥ鎺斿垝閼哥數绡€缁剧増菤閸嬫捇鎮欓挊澶夊垝闂備礁鎼張顒傜矙閹烘梹宕叉繝闈涱儏绾惧吋绻涢幋鐏荤厧菐椤曗偓閺岋絾鎯旈姀鈺佹櫛闂佸摜濮甸惄顖炪€佸鎰佹▌闂佺硶鏂傞崕鎻掝嚗閸曨垰绠涙い鎺戭槹缂嶅倿姊绘担绋挎毐闁圭⒈鍋婂畷鎰版偡閹佃櫕鐎洪梺鎼炲労閸撴岸鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬濡炪倖娲樼划搴ｆ閹烘梹瀚氶柟缁樺坊閸嬫挸顫㈠畝鈧禍杈ㄧ節閻㈤潧浠﹂柛銊у枛楠炲﹪鎮欓崫鍕€炲銈嗗坊閸嬫捇宕鐐村仭婵犲﹤鍟扮粻鍐差熆鐟欏嫭绀嬮柟绋匡攻缁旂喎鈹戦崱娆懶ㄩ梺杞扮劍閸旀瑥鐣烽妸鈺婃晩闁芥ê顦竟宥夋⒑鐠囨彃顒㈢紒瀣笧閹广垽宕熼鐕佹綗闂佽宕橀褏澹曢崗鍏煎弿婵☆垵宕靛Ο鍌炴煏韫囧鈧牠鎮￠妷鈺傜厸闁搞儯鍎辨俊铏圭磼閵娧呭笡闁靛洤瀚板鎾敂閸℃ê浠归梻浣哥秺椤ユ挻鎱ㄩ幘顕呮晩闊洦渚楅弫濠囨煕韫囨洖甯堕柍褜鍓﹂崹浼村煘閹达附鍋愭い鏃囧亹娴煎洤鈹戦悙宸Ч闁烩晩鍨跺顐﹀礃椤旇姤娅滈梺鎼炲労閻撳牆顭囬悢鍏尖拺闁告挻褰冩禍婵囩箾閸欏鑰块柛鈺傜洴楠炲鏁傞悾灞藉箞婵犵數鍋為崹鍫曟晝椤愶箑缁╅悹鍥ф▕閻斿棝鎮归崫鍕儓妞ゅ浚鍙冮弻锛勪沪閸撗佲偓鎺楁煃瑜滈崜銊╁箑閵夆晛绀冪憸宥壦夊鑸碘拻闁稿本鑹鹃埀顒傚厴閹虫宕奸弴妞诲亾閿曞倸閱囬柕澶樺枟閺呯偤姊虹化鏇炲⒉缂佸鍨圭划缁樺鐎涙鍘炬繝娈垮枟閸旀洟鍩€椤掍胶澧柣锝囧厴瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涚紒瀣浮閺佸秴顓奸崱娆戭啎闁诲繐绻戦悧妤€鈻嶆繝鍥ㄧ厸閻忕偟鍋撶粈鍐偓鍨緲鐎氭澘鐣烽悡搴樻斀闁割偅绮嶉崑鍛節閻㈤潧浠滈柣掳鍔庨崚鎺楀箻閸撲椒绗夐梺鍝勭▉閸樺ジ鎷戦悢鍝ョ闁瑰鍊戝顑╋綁宕奸悢铏诡啎闂佺硶鍓濋敋濠殿喖顦辩槐鎺斺偓锝庝簼閸犳ɑ鎱ㄦ繝鍐┿仢闁圭锕ュ鍕節閸愨晩鍟€闂傚倷绀侀幗婊勬叏閻㈠憡鍋嬮柣妯烘▕閸ゆ洖鈹戦悩瀹犲闁告濞婇弻锝夊籍閸偅顥栫紓浣瑰姉閸嬫盯鍩為幋锔藉€烽柡澶嬪灩娴犳悂姊洪幐搴㈢５闁哄懏绋撻崣鍛渻閵堝棙灏柛銊︽そ閸╂盯骞嬮敂鐣屽幈濠电偞鍨惰彜濠殿喖娲弻銈吤圭€ｎ偅鐝旈梺鎼炲妽缁诲啰鎹㈠☉銏犲耿婵°倓鑳堕々鏉库攽閻愭彃鎮戦柣妤佹礉閻忓啴姊洪幐搴㈢；缂佽翰鍊栭〃銉ㄧ疀閹句胶鎳撻…銊╁礃椤忓柊銊╂⒑閸濆嫮鐏遍柛鐘崇墵楠炲啫顭ㄩ崗鍓у枛閹煎綊鏌呭☉妯侯嚙闂傚倸鍊风粈渚€骞楀鍕弿闁圭虎鍠楅弲婵囥亜韫囨挸顏存繛鍏肩墬缁绘稑顔忛鑽ょ泿婵炵鍋愭繛鈧柡灞炬礃瀵板嫰宕煎┑鍡楊棟闂備焦瀵х换鍌炈囨导瀛樺亗闁绘棃鏅茬换鍡涙煏閸繃鍣归柡鍡樼懇閺屽秶鎷犻懠顒€顤€濡炪們鍔婇崕鐢稿箖濞嗘挸鐭楀鑸瞪戦敍鍡涙煟鎼淬値娼愭繛鍙夛耿閺佸啴濮€閵堝啠鍋撴担绯曟瀻闁圭偓娼欏▓鎰版⒑閸愬弶鎯堥柨鏇樺€濋獮鍐醇閵夛腹鎷婚梺绋挎湰閻熴劑宕楀畝鈧槐鎺楊敋閸涱厾浠搁梺鐐藉劵缁犳挸鐣烽崼鏇ㄦ晢闁逞屽墴瀵憡绗熼埀顒勫蓟閻斿吋鈷掗悗鐢殿焾婵′粙姊洪崫鍕闁告挻姘ㄩ幑銏犫攽鐎ｎ偒妫冨┑鐐村灥瀹曨剟宕滈柆宥嗏拺缂佸灏呭銉╂煟韫囨柨鍝洪柕鍡楀暣婵＄兘鍩￠崒姘ｅ亾閻戣姤鐓犵痪鏉垮船閸樻悂鏌ц箛鎾诲弰婵﹥妞藉畷銊︾節閸愶絾瀚荤紓浣哄亾濠㈡绮旈悽鐢电煔閺夊牄鍔庣弧鈧梺鎼炲劥閸╂牠寮插┑瀣拺闁圭娴风粻鎾寸箾閼碱剙校闁逛究鍔戝畷鍫曨敆娴ｅ弶瀚奸梻浣告啞缁诲倻鈧凹鍙冨畷瀹犮亹閹烘挾鍘介梺鍝勮癁娴ｉ晲鍒掓俊銈囧Х閸嬫盯宕婊呯焿闁圭儤鏌￠崑鎾绘晲鎼存繄鐩庣紓浣瑰姈缁嬫帞鎹㈠┑瀣仺闂傚牊鍒€閵忋倖鍊垫慨妯煎帶婢ф挳鏌ｅ☉鍗炴珝妤犵偛娲幃褔宕奸姀鐘茬闂備胶顢婇崑鎰偘閵夆晛鐒垫い鎺嗗亾闁哥喐瀵у蹇涘川鐎涙ǚ鎷虹紓浣割儐椤戞瑩宕曢幇鐗堢厵闁荤喓澧楅崰妯尖偓娈垮枦椤曆囶敇婵傜閱囨い鎰剁秵閳ь剙娲缁樻媴閸涘﹤鏆堥梺瑙勬倐缁犳牕鐣烽悧鍫熷劅闁靛绠戞禒濂告⒒娴ｅ摜浠㈡い鎴濇嚇椤㈡岸鏌嗗鍡欏幐婵犮垼娉涢鍛存倶閵夆晜鐓曢柣鎰典簻婵″吋銇勯鍕殻濠碘€崇埣瀹曞崬螣閻戞ɑ顔傞梻鍌欒兌椤牓顢栭崶顒€绐楅柡宥庡幖缁犳牕螖閿濆懎鏆欏ù鑲╁█閺屾盯寮村Ο鍝勵瀴闂佸搫鍊甸崑鎾绘⒒閸屾瑨鍏岀紒顕呭灦閳ワ箓宕奸妷顔芥櫔濠电姴锕ら崰姘跺疮閸涘瓨鐓忓璺烘濞呭棝鏌ｉ幘瀛樼闁逛究鍔岄～婊堝幢濡も偓娴煎酣姊洪崗鍏肩凡婵炵》绻濆濠氭偄绾拌鲸鏅╅梺鍛婄箓鐎氼喗瀵奸崼銉﹀€甸悷娆忓缁€鍐┿亜閵娿儻韬鐐插暣閸╁嫰宕橀埡浣稿Τ闂備線娼х换鍡涘疾濞戙垹绠栭柟杈鹃檮閳锋帡鏌涚仦鎹愬闁逞屽墴椤ユ挸鈻庨姀鐙€娼╂い鎺戭槺閸旂兘鎮峰鍕棃妤犵偛鍟抽ˇ鍦偓瑙勬礀瀹曨剟鍩ユ径濞㈢喖鎳栭埡鍌溾偓顕€姊绘担渚敯濠㈢懓鐗撻獮鎾活敂閸℃绛忛梺鍦焾濞寸兘鍩㈤弮鍌楀亾楠炲灝鍔氶柟顔垮劵閵囨劙骞掗幘鍏呯暗闂佺澹堥幓顏嗗緤妤ｅ啫绠熷┑鍌氭啞閳锋垿鏌熼幆鏉啃撻柡渚€浜堕幃浠嬵敍閵堝洨鐦堥悗娈垮枦椤曆囧煡婢跺娼╂い鎰剁到婵即姊绘担鍛婂暈闁圭妫濆畷鐔碱敃閿濆洤璁查梻鍌氬€搁崐鐑芥嚄閸洍鈧箓宕奸姀鈥冲簥闂佸湱澧楀妯尖偓姘槹閵囧嫰骞掗幋婵愪患婵℃鎳樺娲川婵犲啫顦╅梺鎼炲妼閵堢顕ｉ锕€鐐婃い鎺嶈兌閸樹粙姊虹憴鍕棆濠⒀勵殔閳藉顦归柡灞界Ч椤㈡棃宕奸悢鎼佹暘婵＄偑鍊ゆ禍婊堝疮鐎涙ü绻嗛柛顐ｆ礀缁€鍐煏婵炑冨€诲Λ顖炴⒒閸屾瑨鍏岀紒顕呭灦閵嗗啴宕奸悢绋垮伎闂佸湱铏庨崰妤呭磻閳哄懏鐓熼柟杈剧稻椤ュ鐥娑樹壕闂傚倷鑳剁划顖炲礉韫囨稑鐤炬繝濠傜墳缂嶆牜鈧箍鍎遍幊澶愬绩娴犲鐓冮柦妯侯槹椤ユ粓鏌ｈ箛銉хМ闁哄苯绉撮悾锟犲箥椤斿皷鍙洪柣搴ゎ潐濞诧箓宕滈悢椋庢殾濠靛倻顭堥崡鎶芥煟閺傚灝绾ч悗姘虫閳规垿鎮欓懜闈涙锭缂備浇寮撶划娆撶嵁濡も偓椤劑宕ㄩ婊呭帬闂備胶绮崹鍓佹箒缂備浇顕уΛ娆撳Φ閸曨垰绠涢柍杞扮婵洜绱掔紒銏犲箹濠⒀冩捣濡叉劙骞掑Δ濠冩櫓闂佸吋绁撮弲娑⒙烽埀顒傜磽閸屾瑧鍔嶆い銊ョ墦瀹曚即寮介鐐存К闂侀€炲苯澧柕鍥у楠炴帡骞嬪┑鎰偅缂傚倷鑳舵慨鐢告偋閻樿钃熼柕濞炬櫆閸嬪嫰鏌涘┑鍡楃彅闁靛繈鍊栭悡鐔肩叓閸ャ劍鐓ラ柍缁樻礋閺屸€崇暆閳ь剟宕伴幇鐗堟櫖闁归偊鍘芥刊鎾煢濡警妲搁悽顖ｅ灦濮婄粯鎷呴崨濠冨枑闂佺顑囬崰鏍ь嚕椤愶絿绡€婵﹩鍓濋幗鏇㈡⒑閹稿海绠撴い锔垮嵆瀹曟垿骞囬悧鍫㈠幈濠电偛妫楀ù姘ｈぐ鎺撶厱閹兼番鍨哄畷宀勬煙椤旂厧妲绘い顓滃姂瀹曠喖顢楅崒姘濠电姷鏁搁崑娑㈡儍閻戣棄鐒垫い鎺嗗亾缁剧虎鍙冨鎶芥晝閳ь剟鍩為幋锕€纾兼繝濠傛捣閸旀悂鏌涢悜鍡楃仸婵﹥妞藉Λ鍐ㄢ槈鏉堛剱銈夋⒑缁嬪潡顎楃€规洦鍓熼崺銏ゅ箻鐠囧弬褍顭跨捄渚剬闁归攱妞藉娲嚒閵堝懏鐎惧┑鐘灪閿曘垽鐛崘顔肩闁挎梻鏅崢浠嬫⒑閹稿海绠撶紒銊ャ偢閺屽洭顢涘┃鎯т壕閻熸瑥瀚粈鍐磼鐠囨彃鏆ｆ鐐叉瀵噣宕煎顏佹櫊閺屾洘绔熼姘櫣妤犵偐鍋撻梻鍌氬€搁崐鐑芥嚄閸洖绠犻柟鎯х摠濞呯娀鏌ｉ敐鍛板闁搞劍绻冮妵鍕冀椤愵澀娌梺绋款儏閸婂潡寮婚敓鐘茬倞闁靛鍎虫禒楣冩⒑缂佹ɑ灏紒缁樺姍閳ワ箓宕稿Δ浣告疂闂佹眹鍨婚崑锝夊焵椤掍礁娴柡灞剧洴楠炴帡骞樼€电鍤掗梻浣哥枃椤宕归崸妤€鍨傚Δ锝呭暞閸ゆ垶銇勯幒鎴濃偓濠氬储椤栫偞鈷掑ù锝囩摂閸ゅ啴鏌涢悩鎰佹疁闁靛棗鍟换婵嬪磼濠婂嫭顔曢柣鐔哥矌婢ф鏁埡鍛瀬闁告劦鍠楅悡蹇涙煕椤愶絿绠栭柛锝嗗▕閺屾稑顫濋鈧埀顒€鐏濋～蹇旂節濮橆剛锛滃┑顔斤供閸樹粙骞冨▎蹇ｆ富闁靛牆绻愰々顒勬煛娴ｇ瓔鍤欐い鏇稻缁绘繂顫濋鈹炬櫊閺屾洘寰勯崼婵堜痪闂佸搫鍊甸崑鎾绘⒒閸屾瑨鍏岀痪顓炵埣瀹曟粌鈹戠€ｎ偄浠梺闈涱槴閺佹帡鎮滈挊澶屽姦濡炪倖甯婂鎺旀崲閸℃稒鐓熼柟鏉垮悁缁ㄥ鏌嶈閸撴艾煤濠婂牆绠查柕蹇嬪€曠粻鎶芥煙閻愵剚缍戠€殿喖娼″铏圭磼濡櫣浼囨繝娈垮枔閸婃繂鐣烽弴鐔风窞閻庯絻鍔嬬花濠氭椤愩垺澶勯柟鍝ュ亾閺呭爼寮撮悩鐢碉紲闂佺粯锚绾绢參宕ｉ埀顒勬⒑閸濆嫮鐏遍柛鐘崇墵瀵宕堕浣规珖闂侀€炲苯澧い鏇秮閹瑩顢栫捄銊х暰婵＄偑鍊栭崝鎴﹀垂瑜版帩鏁傛い鎾跺枑閸欏繐鈹戦悩鎻掍簽闁绘捁鍋愰埀顒冾潐濞叉﹢宕曟總鍢庛劍鎷呴柅娑氱畾濡炪倖鐗楅〃鍛妤ｅ啯鈷掗柛灞剧懅椤︼箓鏌熺喊鍗炰簽闁诡噮鍣ｉ、鏇㈡晝閳ь剛绮堟径灞稿亾閸忓浜鹃梺鍛婃处閸嬪棝宕㈤幘顔解拺缁绢厼鎳忚ぐ褏绱掗悩鍐茬伌闁绘侗鍣ｆ慨鈧柍銉ㄥ皺缁犳岸姊洪棃娑氬闁归攱鍨甸～蹇撐旈崘顏嗭紲闁哄鐗勯崝宀勬倶鐎涙ɑ鍙忓┑鐘插鐢盯鏌熷畡鐗堝櫧闁瑰弶鎸冲畷鐔煎煛閳ь剟骞嬮悜鑺モ拻濞达絽鎲￠崯鐐烘儑婢跺瞼纾兼い鏃傛櫕閹冲洦顨ラ悙鎻掓殻闁诡喗绮撻幐濠冨緞鐏炶棄绠伴梻鍌欑閹测剝绗熷Δ鍛煑闁逞屽墴閺岀喖鎳為妷锔绢槬闂佸疇顫夐崹鍧楀箖濞嗘挸绾ч柟瀵稿С濡楁捇姊洪懝甯獜闁稿﹥绻堝濠氭晸閻樿尙鍔﹀銈嗗笒鐎氼厾鈧數濮撮…璺ㄦ崉閻戞﹩妫￠梺鍝勫€甸崑鎾绘⒒閸屾瑨鍏岀紒顕呭灥閹筋偊鎮峰鍕凡闁哥喐娼欓锝夊箹娴ｈ倽褔鏌涘銉モ偓鏇犵礊婵犲洤绠栭柍鍝勬媼閺佸啴鏌ㄥ┑鍡橆棤鐟滄澘娲ㄧ槐鎾诲磼濞嗘劗銈版俊鐐茬摠閹倿鐛幇顓犵瘈婵﹩鍓涢鍡涙⒑閸涘﹣绶遍柛鐘冲哺閵嗗懘鎮滈懞銉モ偓鐢告煥濠靛棛鍑圭紒銊ャ偢閺岀喖鎼归銈嗗櫚濠殿喖锕ら幖顐ｆ櫏闂佹悶鍎滈崨顓炐ら梻鍌欑劍閹爼宕濆鍡欑濠电姴鍊婚弳锕傛煙鏉堝墽鐣遍崶瀛樼節閵忥絾纭鹃柤娲诲灣缁﹪鏁冮崒娑辨濡炪倖鍔戦崹鐑樺緞閸曨厾纾奸悗锝庡亜濞搭喚鈧娲橀崹鍧楃嵁閸ヮ剦鏁婇柛鎾楀秶闂繝鐢靛仩閹活亞寰婃禒瀣剁稏闁哄稁鍙庨弫鍌炴煕閺囨ê濡介柣蹇庣窔濮婃椽妫冨☉姘暫闂佺懓鍢查鍛村Υ閹烘挾绡€婵﹩鍘鹃崢顏堟⒑閸撴彃浜濈紒璇插暣钘熸繝濠傜墛閻撴洜鎲稿澶嬫櫇妞ゅ繐鐗嗛拑鐔哥箾閹寸偛鐒归柛瀣崌閺佹劖鎯旈垾鑼嚬闂佽绻愮换瀣础閹惰棄钃熼柡鍥ュ灩閻愬﹦鎲稿澶樻晜妞ゆ挶鍨洪悡娑樏归敐鍥ㄥ殌濠殿喖绉堕埀顒冾潐濞插繘宕濋幋锔衡偓浣糕枎閹炬潙鐧勬繝銏ｆ硾閿曘倝藟閹烘挾绡€缁炬澘顦辩壕鍧楁煕鐎ｎ偄鐏寸€规洘鍔欐俊鍫曞幢濞嗘ɑ閿ゆ繝鐢靛Т閿曘倝鎮ч崱娑欏仾妞ゆ洍鍋撻柟顔筋殔閳藉鈻嶉鈥充汗闁瑰箍鍨藉畷鍗炩槈濞嗘垵骞堟俊鐐€栭崝褏寰婇崜褏鐭嗛柍褜鍓欒灃闁绘﹢娼ф禍濂告煕閵娧冨妺缂佸矁椴哥换婵嬪炊閼稿灚娅栨繝娈垮枟椤牊銇旈幖浣瑰剬濞撴埃鍋撴慨濠勫劋濞碱亪骞嶉鍛滅紓鍌欑椤︻垱鏅舵惔鈭ワ綁骞囬弶璺啋闁荤姴娲╃亸娆撴晬濠婂啠鏀芥い鏃€鏋绘笟娑㈡煕韫囨棑鑰跨€规洘鍨块獮妯兼嫚闊厾鐐婇梻渚€娼ч敍蹇涘川椤栨艾鑴梻浣筋嚙濮橈箓锝炴径濞掓椽寮介‖鈩冩そ閺佸啴宕掗妶鍡樻珖闂備礁鍚嬫禍浠嬪磿閺屻儱鐭楅煫鍥ㄦ煣缁诲棙銇勯弽銊р槈妞ゆ洘绮庨惀顏堫敇閻樿弓澹曞┑鐐跺椤曆囧煘閹达箑鐐婇柍鍝勫枤閸熷酣姊洪崫鍕垫Ц闁绘妫欓弲鍫曟偩瀹€鈧惌鎾淬亜閹烘垵顏柣鎾存礀閳规垿鎮╂潏顐㈠帯闂佹椿鍘介悷褔鍩€椤掍緡鍟忛柛锝庡櫍瀹曟娊鏁愰崨顖涙闂佺粯鎸哥花鍫曞绩娴犲鐓曢柍鈺佸暟閹冲懐鈧娲栭幖顐﹀煘閹达附鏅柛鏇ㄥ亗閺夘參姊虹粙鍖℃敾闁绘濞€閻涱噣骞囬悧鍫濃偓閿嬨亜閹哄棗浜鹃梺鎼炲妽濮婂綊濡甸崟顖氱閻犻缚銆€閸嬫捇鏁愭径瀣珳闂佹悶鍎崝宀勫几閸岀偞鈷戦柛娑橈攻婢跺嫬霉濠婂懎浠х紒顔款嚙椤繈鎳滅喊妯诲缂傚倸鍊烽悞锕傛晪婵犳鍣粻鎴︽箒濠电姴锕ょ€氼噣鎯岄幒妤佺厱闁宠鍎虫禍鐐繆閻愵亜鈧牜鏁繝鍥ㄥ殑闁肩鐏氬▍鐘绘煟閵忋埄鏆柛瀣尵閹叉挳宕熼鍌ゆО缂傚倷娴囬褔鎮ч幘缁樺仒妞ゆ棃鏁崑鎾绘晲鎼粹剝鐏嶉梺鍝勬噺缁诲牓寮诲鍫闂佸憡鎸荤粙鎺旂博閻旂厧鍗抽柣妯哄暱閺嬪倿姊洪崨濠冨闁告﹢绠栭幆渚€宕奸妷锔规嫽闂佺鏈銊︽櫠濞戞ǜ鈧帒顫濋褎鐤侀悗瑙勬礃濞茬喖鐛崶顒佸亱闁割偁鍨归獮鍫ユ⒑鐠囨彃鍤辩紓宥呮瀹曟垿骞樼紒妯烘畬闂佺鍕垫畷闁绘挻绋撻埀顒€鍘滈崑鎾绘煃瑜滈崜鐔风暦娴兼潙鍐€鐟滃繘寮抽敂鐣岀瘈濠电姴鍊归敍宥嗕繆閺屻儳鐣洪柡宀嬬秮婵偓闁宠桨鑳舵禒顓㈡⒑閻戔晜娅撻柛銊ㄦ硾椤曪絿鎷犲顔兼倯婵犮垼娉涢鍥矗閸℃稒鐓熼幖鎼灣缁夐潧霉濠婂懎浠﹂悗鐢靛帶閻ｆ繈宕熼鑺ュ闂備礁鎲＄换鍌溾偓姘煎灦閿濈偤鏁冮崒娑氬幈婵犵數濮撮崯鐗堟櫠閸偒娈介柣鎰皺婢э箑鈹戦埄鍐╁€愰柛鈹惧墲閹峰懘鎼圭憴鍕帆婵犵绱曢崑鎴﹀磹閺嶎厼鍨傞柣鎾冲濞戙垹绀嬫い鎺戝亞濞插憡淇婇妶蹇曞埌闁哥噥鍨堕幃鈥斥槈閵忥紕鍘遍梺闈涱槶閸ㄥ搫鈻嶉崨瀛樼厸閻庯綆鍋呴悡銉︺亜椤撯€冲姷妞わ富鍣ｉ弻娑㈠箻鐎靛摜鐣奸梺鐟扮畭閸ㄥ綊鍩為幋鐘亾閿濆骸浜滃ù鐘虫そ濮婂宕掑鍗烆杸缂備礁顑嗛崝妤呭礆閹烘閱囬柡鍥╁暱閹锋椽鏌ｆ惔锝嗩仧闂傚嫬瀚…鍨熺拋宕囩畾闂佺鍕垫畷闁绘挻娲熼弻鐔兼倻濡纰嶅┑鐐存儗閸犳岸鍩€椤掑喚娼愭繛鍙夌墵婵″爼宕ㄦ繝鍐ㄥ伎闂侀€炲苯澧撮柡宀嬬到铻ｉ柛顭戝枤濮ｃ垺绻涚€涙鐭屽褎顨堥幑銏犫攽鐎ｎ偄浠洪梻鍌氱墛缁嬫劗鍒掔捄琛℃斀闁宠棄妫楁禍婵囥亜閵娿儳澧︽鐐村灴婵偓闁靛牆鎳愰濠傗攽鎺抽崐鎰板磻閹惧瓨鍙忛悷娆忓閸欌偓闂佸搫琚崝鎴濐嚕椤曗偓瀹曟帒鈽夊▎鎴濇锭缂傚倸鍊风拋鎻掝瀶瑜斿畷鎴﹀箻缂佹ǚ鎷婚梺绋挎湰閼归箖鍩€椤掍焦鍊愰柟顔ㄥ嫮绡€闁告洦鍘鹃悡鎾绘⒑閸︻厼鍔嬮柟绋挎憸濞嗐垽鎮欓悜妯煎幈闂佸搫娲㈤崝宀勬倶閿熺姵鐓熼柟鎯х摠缁€瀣殽閻愬澧繛鐓庣箻瀹曟粏顦查柛鈺佺焸濮婃椽宕崟闈涘壉闂佺儵鏅╅崹璺侯嚕婵犳碍鏅柛鏇ㄤ簼閸曞啴姊虹紒妯哄Е闁告挻鐩棟妞ゆ柨澧界壕钘壝归敐鍛儓閺嶏繝姊洪悜鈺傛珦闁搞劋鍗抽、姘舵晲婢跺﹦顔掑銈嗘濡嫰鍩€椤掑倸鍘撮柡宀€鍠栭獮宥夋惞椤愶絿褰呴梻浣告啞閺岋綁宕愬Δ鍐╊潟?${result.data.createdEpisodeCount} 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝洨纾界€广儱鎷戦煬顒傗偓娈垮枛椤兘骞冮姀銈呯閻忓繑鐗楃€氫粙姊虹拠鏌ュ弰婵炰匠鍕彾濠电姴浼ｉ敐澶樻晩闁告挆鍜冪床闂備胶绮崝锕傚礈濞嗘挸绀夐柕鍫濇川绾剧晫鈧箍鍎遍幏鎴︾叕椤掑倵鍋撳▓鍨灈妞ゎ厾鍏橀獮鍐閵堝懐顦ч柣蹇撶箲閻楁鈧矮绮欏铏规嫚閺屻儱寮板┑鐐板尃閸曨厾褰炬繝鐢靛Т娴硷綁鏁愭径妯绘櫓闂佸憡鎸嗛崪鍐簥闂傚倷鑳剁划顖炲礉閿曞倸绀堟繛鍡樻尭缁€澶愭煏閸繃宸濈痪鍓ф櫕閳ь剙绠嶉崕閬嶅箯閹达妇鍙曟い鎺戝€甸崑鎾斥枔閸喗鐏堝銈庡幘閸忔﹢鐛崘顔碱潊闁靛牆鎳愰ˇ褔鏌ｈ箛鎾剁闁绘顨堥埀顒佺煯缁瑥顫忛搹瑙勫珰闁哄被鍎卞鏉库攽閻愭澘灏冮柛鏇ㄥ幘瑜扮偓绻濋悽闈浶㈠ù纭风秮閺佹劖寰勫Ο缁樻珦闂備礁鎲￠幐鍡涘椽閸愵亜绨ラ梻鍌氬€烽懗鍓佸垝椤栫偛绀夐柨鏇炲€哥粈鍫熺箾閸℃ɑ灏紒鈧径鎰厪闁割偅绻冮ˉ鐘电磼閳锯偓閸嬫捇姊绘笟鈧埀顒傚仜閼活垱鏅堕娑氱闁绘挸娴风粻濠氭煕閳哄绡€鐎规洘甯℃俊鍫曞幢濞嗘垟妫╅梻鍌氬€搁崐椋庣矆娴ｉ潻鑰块梺顒€绉寸壕鍧楁煏閸繍妲搁柦鍐枛閺屻劑鎮㈤崫鍕戙垻鐥幆褜鐓奸柡宀€鍠栧畷婊嗩槾閻㈩垱鐩弻锟犲川椤旀儳寮ㄥΔ鐘靛仦閻楁粓宕氶幒妤€绀傚璺猴梗婢规洟姊洪崨濠傚婵☆垰锕畷婵嬪焵椤掑嫭鈷掗柛灞捐壘閳ь剛鍏橀幃鐐烘晝閸屾氨鐣洪梺鍓插亝濞叉牜澹曢崷顓熷枑闁哄倹顑欏鏍归悩宸剰缂佲偓鐎ｎ偁浜滈柟鎹愭硾閺嬪酣骞栭弶鎴伐闁宠鍨块幃娆撳级閹寸姳鎴烽梻浣规偠閸斿苯锕㈡潏鈺佸灊濠电姵纰嶉弲鎻掝熆鐠轰警鍎戦柛妯圭矙濮婃椽鎮烽幍顔芥喖缂備浇顕ч崯纾嬫＂闂佺粯顭囩划顖炴偂閺囥垺鐓涢柛鎰ㄦ櫅閻忋儵鏌ｈ箛銉╂闁逛究鍔嶇换婵嬪礃閳瑰じ铏庨柣搴ゎ潐濞诧箓宕戞繝鍌滄殾闁绘梻鈷堥弫鍐煥濠靛棙锛嶉柛鐐寸叀濮婂宕掑▎鎺戝帯缂備緡鍣崹鍫曞Υ閸愵喖宸濇い鎾虫处缁嬫垿鍩為幋鐘亾閿濆簼绨介柣锝嗘そ濮婅櫣绱掑Ο鍝勵潓闂佸湱鈷堥崑濠傜暦瑜版帒纾兼繛鎴炵墧缁ㄥ姊鸿ぐ鎺戜喊闁哥姵鐗曢惃顒傜磽閸屾瑩妾烽柛鏂跨焸閳ワ箑鐣￠柇锔界稁濠电偛妯婃禍婊堝箲閼哥偣浜滈柟鎹愭硾娴犳粌鈹戦埄鍐┿仢婵﹥妞介獮鏍倷閹绘帩鐎烽梻浣芥〃濞村洭顢氳椤㈡岸鏁愭径濠勵唴闂佸吋浜介崕杈ㄧ濠婂牊鐓熼柣妯块哺缁佺増绻涙径瀣妤犵偛锕獮姗€鎮滈埞鎯т壕闁挎洖鍊告儫闂佸疇妗ㄧ欢姘跺船鐠鸿　鏀介柣妯款嚋瀹搞儵鎮楀鐓庡⒋鐎殿喗鎮傛俊鍫曞幢濞嗘垹妲囨繝鐢靛仜閻楀棝鎮樺┑瀣嚑婵炴垯鍨洪悡銉╂煛閸ヮ煁顏堝礉濮橆厹浜滄い蹇撳閺嗙偟绱掗崒娑樼闁逞屽墾缂嶅棙绂嶉悙鐑樺仼婵炲樊浜濋埛鎴犵磽娴ｅ顏堟倶鏉堛劋绻嗘い鎰╁灩椤忣偊鏌ｉ妷顔绘捣妞わ箑缍婇弻鈥崇暆閳ь剟宕伴幘璺哄灊婵炲棙鎸搁柨銈嗕繆閵堝惇鍫ュ磻閹炬緞鏃堝川椤旀儳甯楅柣鐔哥矋缁挸鐣峰鍫熸櫇闁稿本鑹鹃悗顓㈡煟閻樼儤銆冮悹鈧敃鈧…鍥冀椤撶喓鍘介梺鐟邦嚟娴兼繈顢旈崼顐ｆ櫔闁哄鐗勯崝搴ｇ不妤ｅ啯鐓曢柍鈺佸幘椤忓牊鍊堕柍鍝勬噹閸愨偓闂佺偨鍎查弸濂稿绩娴犲鐓熼柟閭﹀灠閻ㄦ椽鏌熼悾灞叫ョ紒杈ㄥ浮椤㈡瑩骞嗛‖顕嗙悼缁辨帡宕掑姣欍垺銇勯婊冨鐎规洖銈搁幃銏ゆ憥閸屾稑浜濋梻浣筋嚙濞寸兘骞婇幘鍨涘亾濮樼厧骞楃紒鏃傚枔閳ь剨缍嗛崰鏍磼閳轰急褰掓偐瀹割喖鍓遍梺缁樻尰濞茬喖寮诲澶婄厸濞达絽鎲″▓鍫曟⒑閻熸澘鏆遍悗姘煎幘閹广垹鈽夐姀鐘诲敹闂佺粯鏌ㄩ幗婊埶囬弶搴撴斀妞ゆ梻銆嬮弨缁樹繆閻愯埖顥夐柣锝囧厴婵℃悂鏁傞崜褏妲囬梻浣告啞閸旓箓鎮￠崼婢綁鏌嗗鍡忔嫽婵炶揪绲介幉锟犲疮閻愮儤鐓欑紒瀣儥閻撳ジ鏌熼鎯у幋闁糕晪绻濆畷銊╊敇閻旀劅姘舵⒒?{result.data.createdVariantCount} 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣閿濆棭妫勯梺鍝勵儎缁舵岸寮诲☉妯锋婵鐗婇弫楣冩⒑閸涘﹦鎳冪紒缁橈耿瀵鏁愭径濠勵吅闂佹寧绻傚Λ顓炍涢崟顖涒拺闁告繂瀚烽崕搴ｇ磼閼搁潧鍝虹€殿喛顕ч埥澶娢熼柨瀣垫綌婵犳鍠楅〃鍛存偋婵犲洤鏋佸Δ锝呭暞閳锋垿鏌涘☉姗堝姛闁瑰啿鍟扮槐鎺旂磼濮楀牐鈧法鈧鍠栭…鐑藉极閹邦厼绶炲┑鐘插閸氬懘姊绘担鐟邦嚋缂佽鍊歌灋妞ゆ挾鍊ｅ☉銏犵妞ゆ牗绋堥幏娲⒑閸涘﹦绠撻悗姘卞厴瀹曟洘鎯旈敐鍥╋紲闂佸吋鎮傚褔宕搹鍏夊亾濞堝灝鏋涙い顓犲厴楠炲啴濮€閵堝懐顦ч柣蹇撶箲閻楁鈧矮绮欏铏规嫚閺屻儱寮板┑鐐板尃閸曨厾褰炬繝鐢靛Т娴硷綁鏁愭径妯绘櫓闂佸憡鎸嗛崪鍐簥闂傚倷鑳剁划顖炲礉閿曞倸绀堟繛鍡樻尭缁€澶愭煏閸繃顥撳ù婊勭矋閵囧嫰骞樼捄鐩掋垽鏌涘Ο渚殶闁逞屽墯椤旀牠宕伴弽顓涒偓锕傛倻閽樺鐎梺褰掑亰閸樿偐娆㈤悙娴嬫斀闁绘ɑ褰冮顐︽煛婢跺﹥鍟炲ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍋呴弳婊冣攽閻樺弶澶勯柛濠傛健閺屻劑寮撮悙娴嬪亾閸濄儱顥氶柛褎顨嗛悡娆撴煕閹炬鎳庣粭锟犳⒑閹惰姤鏁遍柛銊ユ健瀵鎮㈤崗鐓庢異闂佸疇妗ㄥ鎺斿垝閼哥數绡€缁剧増菤閸嬫捇鎮欓挊澶夊垝闂備礁鎼張顒傜矙閹烘梹宕叉繝闈涱儏绾惧吋绻涢幋鐏荤厧菐椤曗偓閺岋絾鎯旈姀鈺佹櫛闂佸摜濮甸惄顖炪€佸鎰佹▌闂佺硶鏂傞崕鎻掝嚗閸曨垰绠涙い鎺戭槹缂嶅倿姊绘担绋挎毐闁圭⒈鍋婂畷鎰版偡閹佃櫕鐎洪梺鎼炲労閸撴岸鍩涢幒鎳ㄥ綊鏁愰崶銊ユ畬濡炪倖娲樼划搴ｆ閹烘梹瀚氶柟缁樺坊閸嬫挸顫㈠畝鈧禍杈ㄧ節閻㈤潧浠﹂柛銊у枛楠炲﹪鎮欓崫鍕€炲銈嗗坊閸嬫捇宕鐐村仭婵犲﹤鍟扮粻鍐差熆鐟欏嫭绀嬮柟绋匡攻缁旂喎鈹戦崱娆懶ㄩ梺杞扮劍閸旀瑥鐣烽妸鈺婃晩闁芥ê顦竟宥夋⒑鐠囨彃顒㈢紒瀣笧閹广垽宕熼鐕佹綗闂佽宕橀褏澹曢崗鍏煎弿婵☆垵宕靛Ο鍌炴煏韫囧鈧牠鎮￠妷鈺傜厸闁搞儯鍎辨俊铏圭磼閵娧呭笡闁靛洤瀚板鎾敂閸℃ê浠归梻浣哥秺椤ユ挻鎱ㄩ幘顕呮晩闊洦渚楅弫濠囨煕韫囨洖甯堕柍褜鍓﹂崹浼村煘閹达附鍋愭い鏃囧亹娴煎洤鈹戦悙宸Ч闁烩晩鍨跺顐﹀礃椤旇姤娅滈梺鎼炲労閻撳牆顭囬悢鍏尖拺闁告挻褰冩禍婵囩箾閸欏鑰块柛鈺傜洴楠炲鏁傞悾灞藉箞婵犵數鍋為崹鍫曟晝椤愶箑缁╅悹鍥ф▕閻斿棝鎮归崫鍕儓妞ゅ浚鍙冮弻锛勪沪閸撗佲偓鎺楁煃瑜滈崜銊╁箑閵夆晛绀冪憸宥壦夊鑸碘拻闁稿本鑹鹃埀顒傚厴閹虫宕奸弴妞诲亾閿曞倸閱囬柕澶樺枟閺呯偤姊虹化鏇炲⒉缂佸鍨圭划缁樺鐎涙鍘炬繝娈垮枟閸旀洟鍩€椤掍胶澧柣锝囧厴瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涚紒瀣浮閺佸秴顓奸崱娆戭啎闁诲繐绻戦悧妤€鈻嶆繝鍥ㄧ厸閻忕偟鍋撶粈鍐偓鍨緲鐎氭澘鐣烽悡搴樻斀闁割偅绮嶉崑鍛節閻㈤潧浠滈柣掳鍔庨崚鎺楀箻閸撲椒绗夐梺鍝勭▉閸樺ジ鎷戦悢鍝ョ闁瑰鍊戝顑╋綁宕奸悢铏诡啎闂佺硶鍓濋敋濠殿喖顦辩槐鎺斺偓锝庝簼閸犳ɑ鎱ㄦ繝鍐┿仢闁圭锕ュ鍕節閸愨晩鍟€闂傚倷绀侀幗婊勬叏閻㈠憡鍋嬮柣妯烘▕閸ゆ洖鈹戦悩瀹犲闁告濞婇弻锝夊籍閸偅顥栫紓浣瑰姉閸嬫盯鍩為幋锔藉€烽柡澶嬪灩娴犳悂姊洪幐搴㈢５闁哄懏绋撻崣鍛渻閵堝棙灏柛銊︽そ閸╂盯骞嬮敂鐣屽幈濠电偞鍨惰彜濠殿喖娲弻銈吤圭€ｎ偅鐝旈梺鎼炲妽缁诲啰鎹㈠☉銏犲耿婵°倓鑳堕々鏉库攽閻愭彃鎮戦柣妤佹礉閻忓啴姊洪幐搴㈢；缂佽翰鍊栭〃銉ㄧ疀閹句胶鎳撻…銊╁礃椤忓柊銊╂⒑閸濆嫮鐏遍柛鐘崇墵楠炲啫顭ㄩ崗鍓у枛閹煎綊鏌呭☉妯侯嚙闂傚倸鍊风粈渚€骞楀鍕弿闁圭虎鍠楅弲婵囥亜韫囨挸顏存繛鍏肩墬缁绘稑顔忛鑽ょ泿閻庣懓鎲＄换鍌炲煘閹达附鍋愰柟缁樺笚濞堫參姊婚崒姘兼Ц缂佸鎳撻～蹇撁洪鍛偓濠氭煃閸濆嫬鈧綊鎮甸敃鍌涒拺闁硅偐鍋涙俊濂告煟閺嵮佸仮妤犵偛鍟€靛ジ骞栭鐔告珦闂備焦鎮堕崹褰捤囬弶璇炬盯宕橀妸褎娈鹃梺闈浥堥弲鈺呭极婵犲洦鈷掗柛灞炬皑閹界娀鏌ｉ銏㈢婵﹨娅ｉ幏鐘诲矗婢跺﹥鏁俊鐐€ら崑鍕囬婊冨疾闂備礁鎼粙渚€鎮橀幇顑炴椽顢旈崟搴樻櫊閺屽秹宕崟鑸垫暰闂佸搫鎳夐弲鐘差潖濞差亜浼犻柛鏇ㄥ墮閸嬪秹姊洪幖鐐插婵＄偘绮欏畷鍝勨槈閵忕姷顓洪梺鎸庢⒒閺咁偊宕㈤崡鐐╂斀闁绘劖娼欓悘锕傛煥閺囥劌浜滄い顐㈢箰铻栭柛鎰典簽閿涙粓姊洪崜鎻掍簼婵炲弶鍨块獮澶嬨偅閸愨晝鍘搁柣蹇曞仜婢ц棄煤閺夋垟鏀介柍鈺佸暟閹藉啯銇勯敃鈧鍫曞Φ閸曨垱鏅查柛娑卞亜娴狀噣姊洪崫鍕効缂佹彃鈧喓浜欓梻渚€鈧偛鑻晶顖涖亜閵婏絽鍔︽鐐寸墬閹峰懘宕妷銉ョ闂傚倷鑳堕、濠囧箵椤忓牊鈷旈柛鏇ㄥ灠绾剧懓鈹戦悩宕囶暡闁绘挻娲熼弻鏇熷緞閸繄浠惧┑鐐叉噹閹虫﹢寮诲☉銏犵厸濞达綀妫勯顓㈡⒑鐎圭媭娼愰柛銊ユ健楠炲啫鈻庨幘鏉戞濡炪倖甯婄粈浣衡偓锝傚亾闂傚倸鍊烽懗鍫曗€﹂崼銉︽櫇闁靛／鍕簥闂佸壊鍋呯换宥夊吹閺囩喆浜滈柟鏉垮閻ｈ京绱掗埀顒勫礃閳瑰じ绨婚梺鍝勬川閸嬬偤宕冲ú顏呯厸闁告侗鍠氶惌鎺撴叏婵犲啯銇濈€规洏鍔嶇换婵囨媴閾忓湱鐣抽梻鍌欑閹诧繝骞愰懡銈囩煓闁规崘娉涢崹婵嬫偣閸パ勨枙婵炲皷鏅犻弻銈夊传閵夘喗姣岄梺褰掓敱濡炶棄顫忓ú顏勫窛濠电姴鍟棄宥夋偡濠婂嫭绶查柛鐕佸灣缁顓奸崨顏呮杸闂佹悶鍎弲婵嬵敊閺囥垺鈷戦柛娑橈功閹冲啯銇勯敃渚€鍝洪柡鍛埣椤㈡棃宕ㄩ锛勭泿闂備礁鎼崐钘夆枖閺囩姷涓嶅ù鐓庣摠閻撳啴鎮峰▎蹇擃仼闁诲繐顕埀顒冾潐濞叉牠鎮ラ崗闂寸箚闁绘垼妫勫洿闂佹悶鍎弲婊堝疾閵娾晜鈷掗柛灞捐壘閳ь剟顥撶划鍫熺瑹閳ь剟鐛弽顓ф晝闁挎洍鍋撶痪鎯х秺閺岀喖姊荤€电濡介梺绋匡龚閸╂牜鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｅ搫校闁绘濞€瀵鎮㈢悰鈥充壕闁汇垺顔栭悞鎯瑰鍛付闂囧绻濇繝鍌氼伀闁活厽甯￠弻锝夊箼閸愩劋鍠婇悗瑙勬礀閻栧吋淇婇幖浣规櫆缂備降鍨鸿ⅲ闂傚倸鍊风粈渚€鎮块崶顒夋晪鐟滄棃骞冭缁绘繈宕惰閻ゅ嫰姊洪棃娑辩叚濠碘€虫川瀵囧焵椤掑嫭鈷戦柛娑橈梗缁堕亶鏌涢敐搴℃灍缂佸倹甯￠崺锟犲川椤旇瀚奸柣鐔哥矌婢ф鏁埡浣勬盯骞嬪┑鍐╂杸闂佺粯鍔忛弲娑欑閻愵兛绻嗛柕鍫濇搐鍟搁梺绋款儑閸嬨倝鐛幋锕€鐐婃い鎺戝€哥粊锕傛⒑閸︻厼鍔嬮柛銊у枛瀵劍绂掔€ｎ偆鍘遍梺鏂ユ櫅閸熴劍绂嶅Δ鍛厪濠电偟鍋撳▍鍡涙煃闁垮娴柡灞剧〒娴狅箓宕滆閸ｎ垶姊虹粙璺ㄧ闁活厼鍊垮璇测槈濡粎鍠栭幃鈺呭矗婢跺﹥顏ょ紓鍌欒閸嬫挸鈹戦悩鎻掆偓鐢稿绩娴犲鐓熸俊顖濐嚙缁茬粯銇勮箛锝呬簻闁宠棄顦甸獮妯虹暦閸ュ柌鍥ㄧ厸閻忕偟纭堕崑鎾诲箛娴ｅ憡鍊梺纭呭亹鐞涖儵鍩€椤掍礁澧繛鑹板Г娣囧﹪鎮欓鍕ㄥ亾閹达箑纾挎い鏍仜绾捐绻濋棃娑欙紞婵炲吋鐗滅槐鎾存媴閼测剝鍨堕崚濠囧箻椤旂晫鍘遍梺鎸庢椤曆囩嵁濡ゅ懏鐓犻柛顭戝枟閸犳ɑ鎱ㄦ繝鍐┿仢妤犵偞鐗犻幃娆撳箵閹烘繄鈧櫕淇婇悙顏勨偓銈夊储妤ｅ啫绀傛慨妞诲亾鐎规洝顫夐妶锝夊礃閳哄倹鐝栭梻浣侯焾閺堫剙鐣濋幖浣歌埞闁割偅娲橀埛鎴︽⒒閸喍绶辨俊鐙欏懐纾奸柣妯哄暱閻忔挳鏌?
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
      ElMessage.warning('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈囩磽瀹ュ拑韬€殿喖顭烽幃銏ゅ礂鐏忔牗瀚介梺璇查叄濞佳勭珶婵犲伣锝夘敊閸撗咃紲闂佺粯鍔﹂崜娆撳礉閵堝棛绡€闁逞屽墴閺屽棗顓奸崨顖氬Е婵＄偑鍊栫敮鎺楀磹瑜版帒鍚归柍褜鍓熼弻锝嗘償閵忕姴姣堥梺鍛婄懃閸燁偊鎮惧畡鎵殾闁搞儜灞绢棥闂佽鍑界徊濠氬礉鐎ｎ€兾旈崨顔规嫼闂侀潻瀵岄崢濂稿礉鐎ｎ喗鐓曢柕濞垮劤缁夎櫣鈧娲橀崝娆撳箖濞嗘挻鍊绘俊顖濇〃閻㈢粯绻濋悽闈浶㈤柨鏇樺€濆畷顖炲箥椤斿彞绗夐梺鐓庮潟閸婃劙宕戦幘鏂ユ灁闁割煈鍠楅悘宥嗙節閻㈤潧浠滈柨鏇ㄤ簻椤曪綁顢曢敃鈧粈鍐┿亜閺冨洤浜归柨娑欑矊閳规垿鎮欓弶鎴犱桓闂佺厧缍婄粻鏍偘椤曗偓瀹曞ジ鎮㈤崜浣虹暰闂備胶绮崝锔界濠婂牆鐒垫い鎴炲劤閳ь剚绻傞悾鐑藉閿涘嫷娴勯柣搴秵娴滄粓鎮楅銏♀拺闁告捁灏欓崢娑㈡煕鐎ｎ亝顥㈤柕鍡楁嚇瀹曪絾寰勫畝鈧惁鍫ユ⒒閸屾氨澧涘〒姘殜瀹曟洟骞囬悧鍫㈠幗闂佽鍎抽悺銊х矆閸愵亞纾肩紓浣诡焽濞插鈧娲栧畷顒冪亙闂佸憡鍔︽禍鍫曞船閾忓湱纾介柛灞剧懆閸忓苯鈹戦鑺ュ唉闁炽儻绠撻幃婊堟寠婢跺孩鎲伴梻浣瑰缁嬫垹鈧凹浜滈埢浠嬵敂閸℃瑧锛滈柣搴秵娴滅偞绂掗姀銈嗙厓鐎瑰嫰鍋婂Ο鈧梺璇″枟椤ㄥ﹤鐣疯ぐ鎺濇晝闁挎繂娲ら崵鎺楁⒑鐠囨彃顒㈤柛鎴濈秺瀹曟娊鏁愭径濠冩К闂侀€炲苯澧柕鍥у楠炴帡骞嬮姘潬缂傚倷绀侀ˇ闈涱焽瑜斿﹢浣糕攽閻樿宸ラ悗姘煎枤缁鎮欏ǎ顑跨盎闂侀潧楠忕槐鏇㈠箠閸モ斁鍋撶憴鍕８闁告梹鍨块妴浣肝熺悰鈩冾潔濠电偛妫欓崝鏍ь熆閹达附鈷掗柛灞剧懆閸忓瞼绱掗鍛仸鐎规洘绻堝鎾倻閸℃顓块梻浣稿閸嬪懎煤閺嶎厽鍋傛繝闈涱儐閻撴盯鏌涢妷銏℃珒缂佽鲸濞婇弻锝夋偄閻撳簼鍠婇梺缁樻尪閸庣敻寮诲☉銏犲嵆闁靛鍎辩粻濠氭⒑缂佹ɑ灏ㄩ柛瀣尭閳规垿鎮╅崹顐ｆ瘎闂佺顑囬崑鐘诲Φ閹版澘绀冩い鏃囨閳ь剝鍩栫换婵嬫濞戝崬鍓伴梺缁樻尰閿曘垽寮婚悢鍛婄秶濡わ絽鍟宥夋⒑缁嬫鍎愰柛鏃€鐗犳俊鐢稿礋椤栨氨鐫勯梺鎼炲劀閸屾稓娼栨繝鐢靛仜椤曨參宕㈣鐓ら柕鍫濐槸閻撴﹢鏌熸潏楣冩闁稿﹪顥撻埀顒傛嚀婢瑰﹪宕板Δ浣规珡闂傚倸鍊烽懗鍫曞磿閻㈢鐤鹃柍鍝勬噹閸ㄥ倿鎮规潪鎷岊劅闁搞倖娲橀妵鍕箛閸撲胶鏆犵紓浣插亾闁告劏鏂傛禍婊堟煛閸屾稑顕滄い顐㈢Ф閹叉悂寮崼婵婃憰濠电偞鍨崹鐟版暜婵＄偑鍊栧Λ浣哥暦閻㈠憡鍎庨幖娣妽閸婂爼鐓崶銊﹀暗缂佺姷绮幈銊︾節閸曨厼绗＄紓浣诡殘閸犳牠宕洪埀顒併亜閹哄棗浜惧銈庡幖濞测晠藝瑜版帗瀵犳繝闈涙储娴滄粓鏌熼弶鍨暢闁伙綁浜堕弻锝夊Χ閸パ傚缂備胶绮换鍐崲濠靛纾兼繝濠傚枤閺嗩偊姊绘担铏瑰笡闁规瓕顕х叅闁绘梻鍘ч拑鐔兼煟閺傛寧鍟炵紓宥呮搐铻栭柨婵嗘噹閺嗙偞銇勬惔锛勑ф慨濠呮缁辨帒螣鐠囨煡鐎烘繝鐢靛仜瀵爼鈥﹂崶顒€绠查柕蹇曞Л閺€浠嬫倵閿濆骸浜芥俊顐㈠暙閳规垿鎮欓弶鎴犱桓闂佽崵鍣ラ崹鎷岀亱闂佺粯鍔曞Ο濠傘€掓繝姘厪闁割偅绻冮崳铏圭磼閸屾凹鍎旈柡灞剧洴楠炴﹢寮堕幋婵囨嚈濠电姷顣槐鏇㈠极鐠囪尙鏆﹂柣鏃傗拡閺佸秹鏌ㄥ┑鍡橆棡婵炲懎娲︽穱濠囨倷椤忓嫧鍋撻弽顐ｆ殰闁圭儤顨呯壕鐟扳攽閻樺疇澹樻慨瑙勭叀閺屾洟宕煎┑鎰ч梺鎶芥敱閸ㄥ潡寮诲☉妯锋斀闁糕剝顨忔禒鎯р攽閻橆偄浜鹃梺瑙勵問閸犳氨澹曟總鍛婂€甸柨婵嗛娴滄粍绻涢幖顓炴灍妞ゃ劊鍎甸幃娆撳矗婢舵ɑ锛嗛柣搴㈩問閸ｎ噣宕抽敐鍛殾闁绘挸瀵掗悢鍡樸亜韫囧海鍔嶆繛鍛躬閺岋紕浠﹂悙顒傤槹閻庤娲滈崢褔鍩為幋锕€鐐婇柤鍛婎問濡囨⒒閸屾瑧顦﹂柟纰卞亰椤㈡牠宕橀鑲╋紮濠电娀娼ч鍛存嫅閻斿吋鐓ユ繝闈涙椤ョ偤鏌涙惔锝呮灈闁哄本娲熷畷鐓庘攽閸♀晛濡风紓鍌氬€哥粔鎾偋閸℃稑鐓橀柟杈鹃檮閸婄兘鏌熺紒妯虹濡ょ姴娲ら—鍐Χ鎼粹€崇濠电偛妯婇崢濂割敋閿濆鏁冮柨鏃傜帛閺咁亪姊洪柅鐐茶嫰婢у鈧娲樺钘夌暦閻旂⒈鏁嶆慨姗€纭稿Σ浼存煟閻斿摜鐭婄紒缁樺笧閸掓帞鎷犲顔藉兊闂佺厧鎽滈。浠嬪箯濞差亝鍋℃繝濠傛噹椤ｅジ鎮介娑辨疁闁轰礁绉归幃銏ゅ礂閼测晛骞楅梻浣侯攰濞咃綁宕戦悢鍏煎仼闁汇垻顣介崑鎾斥枔閸喗鐏嶉悷婊勬緲閸熸挳鍨鹃敃鍌毼╅柍杞扮窔閸炲爼姊虹紒妯荤叆闁圭⒈鍋婇悰顕€宕奸妷锔规嫽婵炶揪绲介幉锛勬嫻閿熺姵鐓曢悗锝庡亝瀹曞矂鏌曢崱妤€鏆ｇ€规洏鍔庨埀顒佺⊕閿氭繛鍫到椤啴濡堕崱娆忊拡闂佺顑嗛惄顖炲箖閸ф鍊锋い鎴濆綖缁ㄥ姊虹憴鍕姢鐎规洦鍓熼幃姗€顢旈崼鐔哄帗闂備礁鐏濋鍛归鈧弻锛勪沪閸撗佲偓鎺懨归悪鍛暤鐎规洘绮忛ˇ鎶芥煕閿濆骸鐏︽慨濠呮缁瑧鎹勯妸褜鍞堕梻浣规た閸樺ジ宕愰崹顕呭殨濠电姵纰嶉崑鍕煕韫囨挸鎮戦柛搴簻椤啴濡堕崱妤€衼缂備浇灏欓弲顐ｇ珶閺囥垹绠柤鎭掑劗閹锋椽鏌ｉ悩鍙夌闁逞屽墲濞呮洟鎮樺鍛斀闁挎稑瀚禒鈺佲攽椤斿搫鈧牜绮氭潏銊х瘈闁搞儜鍜佸晣濠电偠鎻徊浠嬪箺濠婂牆鍌ㄩ柟闂寸劍閳锋垹绱掔€ｎ偄顕滄繝鈧导瀛樼厽妞ゆ挆鍐╃彎闂佽鍠涙慨銈囨崲濠靛棭娼╂い鎾寸⊕鐎氳棄鈹戦悙瀛樺鞍闁糕晛鍟村畷鎴﹀箻鐎靛摜顔曟繛杈剧到閸熷灝鈻斿璺虹倞妞ゆ帒顦伴弲婵嬫⒑閹稿孩纾甸柛瀣崌閺岋綁濡堕崶褌澹曠紓浣虹帛缁诲啰鎹㈠┑瀣＜婵犲﹤鍠氶弳顐ょ磽娴ｅ搫浜鹃柛搴＄－缁辩偞绻濋崶褑鎽曞┑鐐村灟閸╁嫰寮崘顔界叆婵犻潧妫欓ˉ鐘炽亜閿斿搫濮傛慨濠呮缁辨帒螣鐠囪尙顣查梻浣告憸閸犳劙骞愰崘宸殨閻犲洦绁村Σ鍫熶繆椤栫偞鏁遍柡鍌楀亾闂傚倷鑳剁涵鍫曞礈濠靛鈧啳绠涢弮鍌ゆ祫婵犻潧鍊搁幉锟犲煕閹达附鐓曟繝闈涙椤忣亝銇勯妷褍鈻堥柡灞剧洴閹晠鎼归銏紦闂備浇顕栭崹顏堝磻閹炬剚娓婚柕鍫濇噽缁犱即鏌ｅΔ鈧Λ娑氬垝鐠囧樊娼╅弶鍫涘妼閺嬫垿鏌ｆ惔顖滅У闁哥姵鐗滄竟鏇熺節濮橆厾鍘棅顐㈡搐椤戝懘鍩€椤掍胶澧甸柟顔光偓鏂ユ婵﹫绲芥禍楣冩煕韫囨搩妲稿ù婊堢畺閺岋絾鎯旈婊呅ｉ梺鍛婃尰閻熲晛鐣烽搹閫涙勃缂佹稑顑嗙€靛矂姊洪棃娑氬濡ょ姴鎲＄粋宥呪攽閸垻锛滃銈嗘婵倗浜搁銏＄厽闁挎繂娲ら崢瀵糕偓瑙勬穿缁绘繈骞冨▎蹇ｅ悑闁糕剝菤閹峰綊姊洪悷鏉挎Щ闁瑰啿绻愰…鍥敂閸涱収鍤ら梺鍝勵槹閸ㄥ磭鍒掗敐澶嬧拻闁稿本鑹鹃埀顒佹倐瀹曟劙骞栨担鍝ワ紮婵＄偛顑呭ù鐑芥儗閸℃ぜ鈧帒顫濋敐鍛婵°倗濮烽崑娑⑺囬悽绋垮瀭闁诡垎宀€鍞甸梺鍛婃处閸撴稑煤鐎涙﹩娈介柣鎰▕閸庢棃鏌熼瑙勬珚鐎规洘顨婂畷顐﹀Ψ瑜庨崰鎺楁⒒閸屾艾鈧嘲霉閸ヮ剨缍栧璺猴功閺嗭附鎱ㄥ璇蹭壕濡炪們鍨烘穱娲囪ぐ鎺撶厵闂佸灝顑呴悘鎾煙椤斿搫鐏茬€规洘顨婇幊鏍煛娴ｅ摜鐟查梻鍌氬€风欢姘焽瑜旇棟妞ゆ挶鍨圭壕鍧楁煙閹澘袚闁哄拋鍓涢埀顒€绠嶉崕閬嵥囨导瀛樺亗婵炴垯鍨洪悡鏇㈡煃閳轰礁鏋ゆ繛鍫熸礃閵囧嫰濡烽敐鍛紙闂佸搫鐭夌槐鏇熺閿曞倹鍋╅悘鐐寸缚閸庢煡濡甸崟顕呮Ш缂備浇鍩栧畝绋款嚕鐠囨祴妲堥柕蹇曞Х椤旀帡鏌ｉ悩鐑橆仩闁稿簺鍊濋幃妤佺節濮橆厸鎷烘繛鏉戝悑閻熝呯矓椤曗偓閺岋繝鍩€椤掍焦缍囬柍瑙勫劤娴滈箖姊婚崼鐔衡棨闁稿鍨婚埀顒侇問閸犳牠鎮ユ總鍝ュ祦閻庯綆浜栭弨浠嬫煕閳╁叐鎴濃枔閵忥紕绡€缁炬澘顦辩壕鍧楁煕鐎ｎ偄鐏寸€规洘鍔欏浠嬵敇閻愭鍞堕梻浣虹帛閸旓箓宕滃璺虹煑闊洦绋掗崐鐢告⒒閸喓鈯曢柟鍙夋倐閺岋綁顢橀悙闈涒叺闂佸搫琚崝鎴濐嚕閹绢喗鍊锋繛鏉戭儏娴滃墽鎲搁悧鍫濈瑨闁绘挻娲熼弻鐔衡偓鐢殿焾鍟哥紒鐐劤閸氬濡甸崟顖氬唨闁靛ě鈧慨鍥╃磽娴ｆ彃浜鹃梺閫炲苯澧紒缁樼箞閸╂盯鍩€椤掑嫬绀嬫い鎾跺仜缂佲晠姊绘担鍛婃儓闁哄牜鍓熼幆鍕敍閻愰潧绁﹂柣搴秵閸犳宕戦幇鐗堢厱闁归偊鍓欑痪褔鏌ｉ敐搴″⒋婵﹥妞藉畷銊︾節鎼淬垻鏆ラ柣搴ゎ潐濞诧箓宕滃┑瀣€堕柛鎰靛枟閳锋垿鏌熺粙鎸庢崳缂佺姵鎹囬弻鐔煎礃閺屻儱寮伴悗娈垮枟婵炲﹪骞冨▎鎾村€绘俊顖滃帶鐢姊婚崒娆戭槮闁诲繑绻堥、鏍川鐎涙ê鈧爼鏌熺紒銏犳灍闁绘挻绋撻埀顒€鍘滈崑鎾绘煃瑜滈崜鐔风暦娴兼潙绠婚悹鍝勬惈閻忓﹤鈹戦悙鍙夘棡闁圭鎽滅划缁樺閺夋垹顔愬┑鐑囩秵閸撴瑩鎮橀埡鍛拻闁稿被鍊曢悘锔芥叏婵犲嫮甯涢柟宄版嚇瀹曨偊濡烽敂閿亾椤斿皷鏀介柍钘夋娴滄粓鎮楀顓烆€滄俊顐ゅ枛閺屸剝寰勬繝鍕暤闂佸搫鎳忕划鎾绘晲閻愬搫鍗抽柕蹇ョ磿閸樼敻姊虹紒妯虹仸閽冮亶鎮樿箛锝呭箻缂佽鲸甯″畷婊勬媴闂€鎰崟闂備礁鐤囬～澶愬垂閸ф绠栭柍鍝勬噹缁犵敻鏌熼悜妯肩畱闁诡噯缍佸缁樻媴閾忕懓绗￠梺瑙勬倐缁犳牕鐣锋导鏉戝唨鐟滄粌顭囬弽顓熺叄闊洦鍑瑰鎰版倵濮橆厼鍝洪柡灞界Ч婵＄兘濡疯缁辩偞绻涚€电校鐎光偓缁嬫娼栭柧蹇撴贡閻瑦绻涢崱妯哄姢闁告捇浜跺娲偡閻楀牆鏆堥梺璇″枛閸婂潡宕规ィ鍐ㄧ睄闁割偅绻勯ˇ銊ヮ渻閵堝棙鐓ユ俊鎻掔墣椤﹀綊鏌＄仦鍓р槈闁宠棄顦靛畷锟犳倷閸忕瀵插┑锛勫亼閸婃牠寮婚妸銉冩椽顢橀悜鍡樼稁闂佹儳绻愬﹢杈╁閸忓吋鍙忔俊銈傚亾婵☆偅鐟╅幃鍓ф崉鐞涒剝鏂€闂佸疇妫勫Λ妤佺濠靛牏纾奸悗锝庡亝瀹曞瞼鈧娲樺畝鎼佺嵁閹烘绠婚柛鎾茶兌濡插洦绻濆▓鍨灍闁挎洍鏅犲畷婊冣攽鐎ｎ亞顔戦梺鍝勬储閸ㄦ椽鍩涢幋锔解拻闁割偆鍠嶇欢杈ㄤ繆閻欐瑥鍟犻弨浠嬫煃閵夈劍鐝柛鐘愁焽閳ь剝顫夊ú蹇涘垂閽樺鏆︾憸鐗堝俯閺佸啴鏌曢崼婵囩ォ闁哥喎閰ｅ铏规嫚閸欏宕抽梺杞扮劍閹倿鍨鹃敃鍌氶唶闁靛繆鍓濆▓浼存⒑閸撴彃浜濇繛鍙夛耿閹繝鎮㈤悡搴ｎ唺闂佽鍎煎Λ鍕矆婢跺备鍋撻崗澶婁壕闂佸憡娲﹂崑鍡涘矗閳ь剙鈹戦悩顔肩伇婵炲绋撻埀顒€鐏氱敮鎺戝祫闂佸吋绁撮弲婵堝閽樺褰掓晲閸噥浠╅柣銏╁灡閻╊垶寮婚敐澶婄厸濠电姴鍊绘禒鈺呮⒑娴兼瑧绉柡鈧潏鈺冪处濞寸姴顑呯粈鍫ユ煕濞嗗浚妲规繛鍛喘濮婄粯绗熼埀顒€顭囪閹广垽骞掗幘鏉戝伎闂佺粯鍨兼慨銈夊磿閹剧粯鐓曢柡鍥ュ妼婢ф壆绱掗埦鈧崑鎾寸節閻㈤潧浠滈柣妤€妫濋幃妯衡攽鐎ｎ亜鍤戝┑鐐村灟閸ㄦ椽鎮￠妷鈺傜厸闁搞儺鐓侀鍛箚濠靛倸鎲￠悡鍐偣閸ヮ亜鐨洪弫鍫ユ⒑鏉炴壆鍔嶉柛鏃€鐗曢銉╁礋椤掑倻鐦堥梺鍛婃处閸嬪嫯顤傚┑鐘殿暜缁辨洟宕戦幋锕€纾归柡宓苯鏅犳繝鐢靛У閼瑰墽澹曟繝姘厵闁诡垎灞芥缂備讲妾ч崑鎾绘⒒娓氣偓閳ь剛鍋涢懟顖涙櫠椤栨稓绠鹃柣鎾虫捣缁犺鈹戦埄鍐╁€愰柡浣稿暣閸┾偓妞ゆ巻鍋撴い鏇秮瀹曠螖娴ｅ弶瀚兼繝娈垮枤閹虫挸煤閵堝鍊舵い蹇撴噽缁犻箖鏌ｉ幘鍐差劉婵犫偓閹殿喒鍋撻崹顐ｇ凡閻庢凹鍣ｉ崺鈧い鎺戯功缁夐潧霉濠婂懎浠х紒顕嗙秮閹瑩鎮滃Ο鐓庡箺闂佺懓鍚嬮幆宀勫垂瀹曞洨鐭堥柣鎴ｅГ閻撴洟鏌￠崒娑卞劌闁稿孩鍨块弻銈嗐偊閸ф鎽电紓浣虹帛缁诲倿锝炲┑瀣垫晣婵炴垶鐟ラ褰掓⒒閸屾瑧顦︽繝鈧柆宥佲偓锕傚醇閳垛晛浜炬繛鎴炲笚濞呭﹪鏌涢埡鍌滄创妤犵偞甯掕灃濞达絽鎼獮鍫ユ⒑鐠囨彃鍤辩紓宥呮瀹曟垿宕ㄩ鐘虫閻庡厜鍋撻柍褜鍓熼崺鈧い鎺嶇贰閸熷繘鏌涢悩鎰佹畷缂佺粯绋掔换婵嬪炊閵夈垹浜惧ù锝堝€介弮鍫濆窛妞ゆ挾濯Σ瑙勪繆閻愵亜鈧牜鏁幒妤€纾归柟闂磋兌瀹撲焦淇婇妶鍕厡缂佲檧鍋撻梻浣圭湽閸ㄨ棄顭囪缁傛帡鏁冮崒娑氬幈闂侀潧艌閺呮粌鈽夎閺岋綁鏁愰崶褍骞嬪銈冨灪椤ㄥ﹤鐣烽悢纰辨晝闁靛繒濮甸璇测攽閻樺灚鏆╅柛瀣仱瀹曞綊宕奸弴鐔蜂画闂佹寧绻傚Λ娑€呴崣澶岀瘈濠电姴鍊搁銉ッ瑰鍕煉闁哄瞼鍠栧鍫曞垂椤曞懏娈洪梻浣筋嚃閸犳牠濡堕幖浣歌摕闁挎繂顦介弫鍥煟閺冨牊鏁遍悹鍥╁仱濮婃椽宕崟顒佹嫳闂佺儵鏅╅崹璺虹暦濞差亝鍊烽柛婵嗗閻ｉ箖鎮峰鍐╂拱缂佹梻鍠栧鎾倷閳哄倹鏉搁梻浣瑰缁嬫垹鈧凹鍓氱粋宥嗙附閸涘﹦鍘辨繝鐢靛Т閸熺増鏅堕柆宥嗙厸濞撴艾娲ゅ▍宥嗩殽閻愭潙娴€殿噮鍓熷畷顐﹀礋椤忓嫷妫滃┑鐘愁問閸犳褰犻梺绋挎唉妞存悂骞堥妸鈺佺＜闁绘劕顕崢閬嶆⒑鐎圭媭娼愰柛搴ゆ珪缁傚秹鎮欓璺ㄧ畾闂佺粯鍔︽禍婊堝焵椤掍胶澧电€规洖缍婇幃鈩冩償濡崵浜欓梻浣告惈濞茬娀骞婇悙鍝勭倞妞ゆ帊鐒﹀▍鍥⒑缁嬫寧婀扮紒瀣崌瀹曘垽骞樼紒妯锋嫼闂佸吋浜介崕宥夘敂閸╄泛娲幐濠冪珶閳哄绉€规洏鍔嶇换娑欏緞閸濄儳娉垮┑锛勫亼閸婃牠宕濊瀵板﹪宕稿Δ浣稿壒闂佸湱鍎ら弻锟犲磻閹捐埖鍠嗛柛鏇ㄥ墰椤︺儵鎮楃憴鍕闁告挻绻堥幃姗€骞掑Δ浣叉嫼闂佸憡绋戦敃锔剧不閹剧粯鍊垫慨妯煎帶婢т即鏌℃笟鍥ф珝妞ゃ垺妫冨畷銊╊敍濠婂懏顫岀紓鍌欒兌閸嬫挸顭垮鈧棟閺夊牃鏅涢ˉ姘舵煕瑜庨〃鍡涙偂閺囥垺鍊甸柨婵嗛娴滄粓鏌ｈ箛鎿冨殶闁逞屽墲椤煤濮椻偓瀹曟繂鈻庤箛锝呮婵炲濮撮鎰板极閸ヮ剚鐓熼柟閭﹀弾閸熷繑淇婇懠顒€鍘存慨濠勭帛閹峰懏绗熼娑欐殲闂備浇顫夊鎸庣閻愰潧鍨濆┑鐘宠壘缁狅綁鏌ㄩ弴妤€浜鹃梺鍛婄懃閿曨亪寮婚弴鐔风窞闁糕剝蓱閻濇洟姊虹紒妯诲鞍婵炶尙鍠栧濠氭晸閻樿尙鍊為梺闈涱槶閸庨亶鈥栭崼銉︹拺闂侇偆鍋涢懟顖涙櫠閺夊簱鏀芥い鏃囧Г鐏忥箓鏌涢埞鍨姕鐎垫澘瀚换婵囨償閵忕姷绱﹂梻鍌欒兌绾爼宕滃┑瀣仭闁靛鍎洪崵鏇㈡煙閹澘袚闁抽攱甯掗湁闁挎繂鎳忛崯鐐烘煕閻斿搫浠遍柡灞剧洴瀵剟鎮欓崣澶婃缂備浇缈伴崐鏇＄亙闂佹寧绻傞幊搴ㄥ汲濞嗘劒绻嗘い鎰剁秶閼板潡鏌＄仦鐣屝ユい褌绶氶弻娑㈠箻鐠虹儤鐎诲銈庡亜缁绘帞妲愰幒鎳崇喓鎷犲顔瑰亾閹剧粯鈷戦柟顖嗗懐顔婇梺纭呮珪閹稿墽鍒掗銏℃櫢闁绘ɑ鏋奸幏娲⒑閸︻収鐒惧Δ鐘虫倐瀹曨偄煤椤忓懐鍘搁悗鍏夊亾閻庯綆鍓涜ⅲ缂傚倷鑳舵慨鐢告儎椤栨凹鍤曟い鎺戝閸ㄥ倹銇勯弮鍥撻柛銈呯墦濮婅櫣鎷犻幓鎺濆妷濡炪倖姊归悧鐘茬暦閺夎鏃€鎷呴搹璇″晭濠电姷鏁告慨鏉懨洪妶澶婂強闁靛鏅滈悡銉╂煟閺傛寧鎯堢€涙繈鎮楅悷鐗堝暈缂佽鍟存俊鐢稿礋椤栨氨鐫勯梺閫炲苯澧寸€规洘娲熼獮搴ㄦ偩鐏炵晫銈﹂梻浣稿閸嬩線宕曢弻銉ョ厱闁硅揪闄勯崑锝夋煕閵夛絽濡肩紒鎻掝煼閺屾盯濡堕崼婊冩儓缂備浇椴搁幐鎼侇敇婵傜宸濇い鏇炴噺閿涘棝鏌ｆ惔銈庢綈婵炲弶顭囬崚鎺戠暆閸曨偆鍘洪柟鍏肩暘閸斿瞼绮诲☉娆嶄簻闁哄洨鍋為崳铏圭磼娓氬洤浜版慨濠冩そ瀹曨偊宕熼崹顐嶏箓姊虹紒姗嗘當闁哥喐娼欓锝夘敆娴ｈ櫣鎳濋梺閫炲苯澧柣锝囧厴楠炲鏁冮埀顒傜不婵犳碍鐓犻柟闂寸劍濞懷囨煛鐎ｎ亜鈧灝顫忓ú顏勫窛濠电姴鍟ˇ鈺呮⒑閸涘﹥灏伴柣鈺婂灥濡喖姊洪棃娑崇础闁告侗鍨界槐鎶芥⒒娴ｄ警鐒鹃柡鍫墮椤繈濡搁妷褎鎳冮梻鍌氬€烽悞锔锯偓绗涘厾楦跨疀濞戞锛欏┑鐘绘涧椤戝懐绮婚弽顬棃鏁愰崨顓熸闂佺粯鎸堕崕鐢稿箖濡ゅ懏鏅查幖绮光偓鏂ユ嫬婵犵绱曢搹搴ㄥ窗濮樿鲸顫曢柟鎯х摠婵挳鏌涢幘鏉戠祷闁告挷鍗冲铏规嫚閼碱剛顔夌紓浣筋嚙閸婂潡骞冩ィ鍐╁仺缂佸鐏濋懓鍨攽閻愭潙鐏﹂柣鐔村灲楠炲繘鎼归崷顓狅紳闂佺鏈悷褔宕濆澶嬬叆婵﹩鍏橀弨鑺ャ亜閺冨洤浜瑰褎鐩弻鏇㈠炊瑜嶉顓犫偓娈垮櫘閸ｏ綁宕洪埀顒併亜閹烘垵顏柛瀣儔閺岋絽螣閸喚姣㈤梺鍝勬４闂勫嫰濡甸崟顖氬唨妞ゆ劦婢€缁爼姊虹紒妯哄闁挎洏鍎垫俊鐢稿礋椤栨氨顔婇悗骞垮劚閻楁粓宕ぐ鎺撯拺鐟滅増甯╁Λ鎴犵磼椤曞懎鐏ｉ柟骞垮灩閳藉鈻庨幇顔拘ら梻浣告啞閹稿棝宕熼陇绻曟繝纰夌磿閸嬫垿宕愰妶澶婂偍濠靛倸鎲￠崑瀣煙閻愵剙澧柛銈嗘礋閺岀喖骞嗛弶鍟冩捇鏌ｉ幒鏇炰汗闁逞屽墮缁犲秹宕曢崡鐐嶆稑鈽夐姀鐘插亶闂佹眹鍨婚弫鍝ュ婵傚憡鐓熼柟浼存涧婢ь垳绱掗幆鏉跨毢闁逞屽墲椤煤閿曞倸绀堟慨妯夸含閻鈧箍鍎遍ˇ顖滅不閵夛负浜滈柡鍐ㄥ€归崵鈧繛瀛樼矒缁犳牠骞冨畡鎵虫瀻闊洦鎼╂禒鍓х磽娴ｆ彃浜鹃梺鍛婂姦閸犳鎮￠弴銏＄厸闁告劧绲芥禍楣冩⒑缂佹﹩娈曠紒顔芥崌閻涱噣骞嬮敃鈧～鍛存煟濮楀棗浜濋柡鍌楀亾闂傚倷鑳剁涵璺侯瀶瑜斿鎻掝煥閸繄锛濋梺姹囧灩閹诧繝鍩涢幋锔解拻闁割偆鍠嶇欢杈ㄤ繆閹绘帞鍩ｉ柡灞剧洴婵℃悂鈥﹂幋鐐电Х缂傚倷绀侀崐鍝ョ矓閻㈢围闁挎繂顦粈鍐煃閸濆嫬鏆欐鐐茬墛缁绘繈鎮介棃娑楁勃闂佹悶鍔岄悥濂稿箖閻戣姤鏅滈柛鎾楀拋妲搁梻浣侯攰閹活亪姊介崟顖涘亗闁靛繈鍊栭悡鏇㈡煙閺夊灝鎮佺紒銊ヮ煼閺岋紕鈧綆鍋嗗ú鎾煛瀹€瀣？濞寸媴绠撻幃娆擃敆閸屻倖袨闂佽楠搁悘姘熆濡皷鍋撳鐓庡⒋闁糕斂鍎插鍕節鎼淬垹缂撻梻浣虹《閸撴繈鏁嬮梺鍝勵儑婵炩偓婵﹤顭峰畷鎺戔枎閹搭厽袦闂備胶顢婇婊呮閺囩儑鑰垮ù锝堟绾捐棄銆掑顒佹悙闁哄鍠栭弻锝夋偄閺夋垵濮﹂梺鎸庣箘閸嬬姷绮诲☉銏犳閻犲洩寮撻崰濠囨⒑閼姐倕鏋嶉梻鍕Ч瀹曟劙骞橀幍鍨﹀吘鏃堝川椤旇瀚奸梻渚€娼荤€靛矂宕㈡總绋跨閻庯綆鍠楅悡鏇㈡煏婵犲繒鐣遍柍缁樻礈閳ь剝顫夊ú婊勬櫠濡ゅ啯宕叉繝闈涱儏閻愬﹪鏌曟繛鍨仾閻庢艾銈稿缁樻媴閸涘﹤鏆堢紓浣割儐閸ㄥ潡寮崘顔嘉ㄧ憸宀勬倿婵犲伅褰掓偂鎼达絾鎲奸梺缁樻尵閸犳牠寮诲澶婁紶闁告洝娉涙导鎰版⒑鐠囨煡鐛滅紒鐘虫崌瀵鏁愰崨顏咁潔闂佸憡顨堥崑鐐烘倶閸儲鐓ｇ紓浣诡焽婢х敻鏌＄仦鍓р槈闁宠棄顦靛畷锟犳倷鐎甸晲閭繝鐢靛仜閻°劎鍒掑畝鈧槐鐐寸節閸パ呯暫濠德板€曢崯顖炲窗閸℃稒鐓曢柡鍥ュ妼婢х増銇勯敂鍝勫姎闁宠鍨块幃娆撴嚑椤掍礁瀣€闂備礁鎲″褰掑垂閸ф违濞达絿纭堕弸搴ㄦ煙閹冩毐鐎规挸妫濆娲濞戞氨鐣惧┑锛勫珡閸パ咁唵濠电偛妯婃禍婵嬪煕閹达附鐓曟繛鎴烇公閸旂喖鏌嶉挊澶樻█闁哄被鍔戝鎾敂閸℃ê浠规繝鐢靛仜濡酣宕规禒瀣摕闁糕剝顨忛崥瀣煕閳╁啰鎳冩鐐茬墦濮婄粯绗熼埀顒€顭囪閸ｅ綊姊洪崨濠傚闁稿鎸歌濠㈣埖鍔栭埛鎺懨归敐鍫燁仩閻㈩垱绋掗妵鍕Ω閵夛箑娅ゅ銈冨妸閸庣敻鐛弽銊﹀闁告縿鍎遍獮瀣⒒娴ｄ警鏀伴柟娲讳邯濮婁粙宕熼姘憋紮婵犵數濮电喊宥夋偂閺囥垺鐓忓璺虹墕閻忣亝绻涢崨顓熷殗闁哄本鐩崺鈩冩媴閽樺浼冮梻浣哥枃椤宕归崸妤€绠栨繛鍡樻尰閸ゆ垶銇勯幒宥囶槮閻庯絺鍋撻梻鍌氬€烽懗鍫曗€﹂崼銉︽櫇闁靛／鍕簥闂佸壊鍋呯换宥夊吹閺囩喆浜滈柟鏉垮閻ｈ京绱掗埀顒勫礃閳瑰じ绨婚梺鍝勬川閸嬬偤宕冲ú顏呯厸闁告侗鍠氶惌鎺撴叏婵犲啯銇濈€规洏鍔嶇换婵囨媴閾忓湱鐣抽梻鍌欑閹诧繝骞愰懡銈囩煓闁规崘娉涢崹婵嬫偣閸パ勨枙婵炲皷鏅犻弻銈夊传閵夘喗姣岄梺褰掓敱濡炶棄顫忓ú顏勫窛濠电姴鍟棄宥夋偡濠婂嫭绶查柛鐕佸灣缁顓奸崨顏呮杸闂佹悶鍎弲婵嬵敊閺囥垺鈷戦柛娑橈功閹冲啯銇勯敃渚€鍝洪柡鍛埣椤㈡棃宕ㄩ锛勭泿闂備礁鎼崐钘夆枖閺囩姷涓嶅ù鐓庣摠閻撳啴鎮峰▎蹇擃仼闁诲繐顕埀顒冾潐濞叉牠鎮ラ崗闂寸箚闁绘垼妫勫洿闂佹悶鍎弲婊堝疾閵娾晜鈷掗柛灞捐壘閳ь剟顥撶划鍫熺瑹閳ь剟鐛弽顓ф晝闁挎洍鍋撶痪鎯х秺閺岀喖姊荤€电濡介梺绋匡龚閸╂牜鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｅ搫校闁绘濞€瀵鎮㈢悰鈥充壕闁汇垺顔栭悞鎯瑰鍛付闂囧绻濇繝鍌氼伀闁活厽甯￠弻锝夊箼閸愩劋鍠婇悗瑙勬礀閻栧吋淇婇幖浣规櫆缂備降鍨鸿ⅲ闂傚倸鍊风粈渚€鎮块崶顒夋晪鐟滄棃骞冭缁绘繈宕惰閻ゅ嫰姊洪棃娑辩叚濠碘€虫川瀵囧焵椤掑嫭鈷戦柛娑橈梗缁堕亶鏌涢敐搴℃灍缂佸倹甯￠崺锟犲川椤旇瀚奸柣鐔哥矌婢ф鏁埡浣勬盯骞嬪┑鍐╂杸闂佺粯鍔忛弲娑欑閻愵兛绻嗛柕鍫濇搐鍟搁梺绋款儑閸嬨倝鐛幋锕€鐐婃い鎺戝€哥粊锕傛⒑閸︻厼鍔嬮柛銊у枛瀵劍绂掔€ｎ偆鍘遍梺鏂ユ櫅閸熴劍绂嶅Δ鍛厪濠电偟鍋撳▍鍡涙煃闁垮娴柡灞剧〒娴狅箓宕滆閸ｎ垶姊虹粙璺ㄧ闁活厼鍊垮璇测槈濡粎鍠栭幃鈺呭矗婢跺﹥顏ょ紓鍌欒閸嬫挸鈹戦悩鎻掆偓鐢稿绩娴犲鐓熸俊顖濐嚙缁茬粯銇勮箛锝呬簻闁宠棄顦甸獮妯虹暦閸ュ柌鍥ㄧ厸閻忕偟纭堕崑鎾诲箛娴ｅ憡鍊梺纭呭亹鐞涖儵鍩€椤掍礁澧繛鑹板Г娣囧﹪鎮欓鍕ㄥ亾閹达箑纾挎い鏍仜绾惧綊鏌￠崶銉ョ仼闁绘挻锕㈤弻鐔告綇妤ｅ啯顎嶉梺绋匡功閸忔﹢骞冨Δ鈧埥澶娾枎濡厧濮虹紓鍌欑椤戝懎煤椤撶儐娼栨繛宸簻瀹告繂鈹戦悩鍙夊櫣妞ゃ儲绻傞—鍐Χ閸℃浠撮梺纭呮珪閿曘垽宕规ィ鍐╂櫇闁稿本姘ㄩ崐鐐烘偡濠婂喚妯€鐎殿喖鎲￠幆鏃堝Ω閿旀儳骞嶉梻浣告惈椤﹀啿鈻旈弴鐔侯浄婵炴垯鍨洪悡娑樸€掑顒佹悙闁诲骏闄勯幈銊︾節閸屻倗鍚嬮悗瑙勬礃鐢帡锝炲┑瀣垫晞闁芥ê顦竟鏇熶繆閻愬樊鍎忔繛瀵稿厴閹矂宕卞灏栧亾閹烘埈娼╅柨婵嗘噸婢规洘淇婇妶鍥ラ柛瀣洴钘濋柣銏㈩焾閸ㄥ倿鏌涢幘妤€瀚崕杈ㄧ箾鏉堝墽绉い顐㈩樀婵￠潧鈹戠€ｎ偆鍘告繛杈剧悼椤牓寮抽敐鍥ｅ亾鐟欏嫭绀冮悽顖涘浮閿濈偛鈹戠€ｅ灚鏅㈤梺绋挎湰椤ㄥ懏绂嶉悙顑句簻闁规儳宕悘顏堟煃闁垮鐏撮柟顔煎槻閳诲氦绠涢幙鍐х礉闂備礁鎽滈崰搴ｆ崲濮椻偓瀵鈽夐姀鈥充汗閻庤娲栧ù鍌炲汲閿涘嫮纾藉ù锝呭閸庡繑銇勯敂璇茬仸妞ゃ垺锕㈠畷妤呮偂鎼达絿鐛梺璇插嚱缂嶅棝宕滃▎鎾跺祦鐎广儱顦伴埛鎺懨归敐鍥╂憘闁搞倕鍟撮弻娑㈠Ω閵夈儴鍩炲銈庡幖閻忔繆鐏掑┑鐐叉閸嬫挸袙閹扮増鈷掗柛灞捐壘閳ь剛鍏橀幊妤呭礈娴ｇ鐏婂銈嗙墱閸嬫稓绮婚弶搴撴斀闁绘ê纾。鏌ユ煕鐎ｅ墎绡€闁哄苯绉瑰畷顐﹀礋椤掆偓濞咃綁姊洪挊澶婃殶闁哥姵鐗犲濠氭晲婢跺﹥顥濋梺鍦焾鐎涒晠宕曢幘缁樷拺闁告繂瀚烽崕蹇涙煟濡や焦宕岀€殿喛顕ч埥澶娢熷鍕棃鐎规洘锕㈡俊鎼佸Χ閸ャ劌绀嬬紓鍌氬€搁崐鐑芥嚄閼稿灚鍙忛悗闈涙憸缁€濠傗攽閻樻彃浜炴繛鍏肩墵閺屟嗙疀濮樺吋缍堥柣搴㈢瀹€鎼佸蓟閵堝洤鏋堥柛妤冨仜椤偄顪冮妶鍡樼叆闁挎洏鍎抽幑銏犫攽閸″繑鐏侀梺鍓茬厛閸犳鎮樺澶嬧拺闁荤喓澧楅崯鐐测攽閻愯宸ラ柣锝呭槻鐓ゆい蹇撴噹閳ь剛鍏橀弻娑樷攽閸℃浼€濡炪倖鎸诲钘夘潖濞差亜绠伴幖绮规噰閹疯崵绱撴笟鍥ф珮闁搞劏娉涢锝夊蓟閵夈儳鍘搁梺鍛婁緱閸犳帡骞忛悜妯肩闁哄鍨甸幃鎴︽煟閻旀繂娲ょ粈鍡椕归悡搴ｆ憼闁稿濮甸幈銊ノ熼悡搴′粯婵炲瓨绮堥崡鎶藉蓟濞戙垹鐓橀柟顖嗗倸顥氭繝纰夌磿閸嬫垿宕愰弽顐ｆ殰濠电姴瀚惌鍡椕归敐鍫燁仩缂佺姵姊婚幉姝岀疀閺囩噥娼熼梺鍦劋閹歌崵绱為崶顒佺厪濠电偛鐏濋崝銈夋煟閻旂绲婚柍瑙勫灴閹瑩妫冨☉妯圭帛缂傚倷鑳剁划顖濇懌婵烇絽娲ら敃顏堢嵁閺嶃劍濯撮悷娆忓閻濇牠姊绘笟鈧埀顒傚仜閼活垱鏅剁€涙ü绻嗘い鎰╁灩椤忊晜銇勯幘鍐叉倯鐎垫澘瀚埀顒婃€ラ崟顐紪闂傚倸鍊峰ù鍥х暦閻㈢绐楅柟閭﹀墻閻斿棙淇婇娆戠Э闁挎繂妫涚弧鈧┑顔斤供閸橀箖宕㈤悽鍛娾拺闁诡垎鍕洶闂佺顑嗛幑鍥箠閹捐閿ゆ俊銈勮兌閸樿棄鈹戦悙鏉戠仴鐎规洦鍓欓埢宥咁吋閸♀晜顔旈梺缁樺姈閹矂鎮炴禒瀣厵濡炲楠搁埢鍫ユ煙瀹曞洤鈻堟い銏☆殕瀵板嫭绻濋崘鈺傜槣闂傚倸鍊峰ù鍥敋瑜庨〃銉╁传閵壯傜瑝閻庡箍鍎遍ˇ顖滃閸ф鈷戞い鎺嗗亾缂佸顕划濠氼敍閻愭潙鈧敻鏌ㄥ┑鍡欏哺闁稿鎹囬、姗€鎮㈢悰鈩冾潔婵＄偑鍊ら崢褰掑礉閹存繄鏆︽慨妞诲亾闁轰焦鍔欏畷鍗炍熺紒妯煎竼闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍仦閺咁亪姊绘担绛嬪殭缂佺粯鍨甸悾婵堢矙濞嗘儳娈ㄩ梺瑙勫劶濡嫰鎮″☉妯忓綊鏁愰崨顓犻獓闂佸搫鍊甸崑鎾斥攽閿涘嫬浜奸柛濠冪墪铻炲〒姘ｅ亾妞ゃ垺淇洪ˇ鏌ユ煟閿濆洦鏆€规洖宕埢搴ｄ沪閹存帒顥氶梺鑽ゅ枑閻熴儳鈧凹鍘剧划鍫熷緞鐎ｃ劋绨诲銈嗗姂閸╁嫬危閾忓湱纾介柛灞剧⊕瀹曞矂鏌熼钘夊姢闁伙絾绻堥崺鈧い鎺戝閸庢绻涢崱妯诲鞍闁绘挻鐟х槐鎺斺偓锝庝簽娴犮垺銇勯幒瀣伄闁诡噮鍣ｉ弫鎰緞鐎Ｑ勫闂備胶顭堥張顒勬偡瑜旇棟闁挎洖鍊归悡娆戠棯閺夊灝鑸瑰ù婊呭仧缁辨帡顢欓悾灞惧櫗缂備焦顨堥崰鏍春閳ь剚銇勯幒鍡椾壕闂佷紮绲块崗妯绘叏閳ь剟鏌曢崼婵囶棞婵炲牊鍔欏娲礃閸欏鍎撻梺鍝ュ枍閸楁娊骞冮悙鍝勭闁兼祴鏅濋惁鍫ユ⒑闂堟盯鐛滅紒韫矙閹繝骞囬悧鍫㈠幈闂佸搫鍟犻崑鎾绘煟濡ゅ啫鈻堟鐐插暣閸ㄩ箖寮妷锔绘綌婵犳鍠楅敃顐ゅ緤閼恒儳顩查柣鎰靛墻濞堜粙鏌ｉ幇顖氱毢濞寸姰鍨介弻娑㈠籍閳ь剟鎳濋幑鎰簷闂備胶绮…鍫濃枍閺囥垹纾归柟鎵閻撶喐绻涢幋婵嗚埞闁哄鐩幗鍫曞冀椤撶喓鍘卞┑鐐村灥瀹曨剟寮搁妶澶嬬厱婵せ鍋撳ù婊冪埣瀵鏁愰崱妯哄妳濡炪倖鐗楃划搴㈢墡婵犵數鍋涢悺銊у垝瀹ュ洤鍨濋柟鎹愵嚙閺勩儵鏌嶈閸撴岸濡甸崟顖氱闁糕剝銇炴竟鏇熺節閻㈤潧浠滈柣銊у厴閸┾偓妞ゆ帊绀佹晶顖炴煕閵堝棙绀€闁宠鍨块幃鈺佺暦閸ヨ埖娈归梻浣告惈閹冲繘骞冮崒鐐茶摕闁挎繂鎲橀悢鐓庡瀭妞ゆ梻鍋撻妤呮⒒娴ｄ警鐒鹃柨鏇畵瀹曟垿濡堕崪浣圭稁濠电偛妯婃禍婵嬎夐崼鐔虹闁硅揪缍侀崫娲嚃閺嶎厽鈷掑ù锝勮閻掔偓鎱ㄥ鍫㈢暠闁宠绉瑰鎾偐閻㈢數鍔归梻浣告贡閸庛倝骞愰崼鏇炵；闁告稑鐡ㄩ悡鏇㈡煙閼割剙濡介柡澶婄秺閺岀喖鎮块娑变哗缂備浇椴搁幑鍥х暦閹烘垟鏋庨柟瀛樼箓椤姊洪挊澶婃殻濞存粌鐖奸獮鍐ㄎ熺捄銊ф澑闁硅偐琛ラ埀顒€纾妶顕€姊绘担鍛婃儓闁活厼顦辩槐鐐寸瑹閳ь剟鐛崘顔碱潊闁靛牆鎳愰悡鎴炵節閵忥絾纭炬い鎴濇穿閵囨劙宕ㄩ鑽ょ畾闂佺粯鍔︽禍婊堝焵椤戞儳鈧繂鐣烽幋锕€绀嬫い鎾跺枎鎼村﹪姊鸿ぐ鎺戜喊闁哥姵鐗曢锝夊矗婢跺绠氶梺缁樺姦娴滄粓鍩€椤掍焦绀堥柟骞垮灲楠炲洭顢欓崜褏鍘犻梻浣圭湽閸ㄥ鈥﹂崼銉﹀仾濡わ絽鍟悡銉︾節闂堟稒锛嶆俊鎻掔秺閺屽秹鏌ㄧ€ｎ亞浼屽┑顔硷工椤嘲鐣锋總鍛婂亜闁诡垱婢橀幃鍛節閻㈤潧浠﹂柛顭戝灦瀹曞綊鎮烽柇锕€鏅犲┑鐘绘涧濞层垺绂嶅鍫熺厸闁告劑鍔岄埀顒€顭烽獮妤呭磼閻愬鍘遍梺缁樻閺€閬嶅闯瑜版帗鐓冮悷娆忓閻忔挳鏌熼瑙勬珚鐎规洖缍婇、鏇㈡晲閸℃瑦顫栧┑鐘垫暩婵敻顢欓弽顓為棷妞ゆ洍鍋撶€规洩缍佸畷姗€顢欓幆褏銈﹂梻濠庡亜濞诧妇绮欓幋鐘电焼闁告劏鏂傛禍婊堟煛閸愩劍鎼愬ù婊冪秺閺屻劌鈽夊▎鎴犵厐闂佸疇顫夐崹鍧椼€佸▎鎾虫闁靛牆瀚潻鏃堟⒒娴ｅ憡鍟為柟绋款煼閹嫰顢涘☉妤冪畾闂佸壊鍋呭ú锕傚极鐎ｎ喗鐓冪憸婊堝礈濞嗘搫缍栭煫鍥ㄦ礈绾惧吋淇婇婵愬殭妞ゅ孩鎸荤换娑㈠箻閺夋垵姣堥梺鎼炲姂娴滆泛顕ｉ锔绘晬婵﹫绲鹃弬鈧梻浣虹帛閸旀洖顕ｉ崼鏇為棷闁绘垶顭囩粻楣冩煠绾板崬澧柡瀣⊕椤ㄣ儵鎮欓幓鎺撴濡炪倧绠戠紞濠囧蓟閻旂⒈鏁婇悷娆忓閻濇柨顪冮妶鍡樼叆缂佺粯锕㈤妴浣糕枎閹惧磭顦х紒鐐緲瀹曨剟骞冮鍕ㄦ斀闁绘ê鐏氶弳鈺呮煕鐎ｎ偆娲存い銏″哺椤㈡﹢鎮㈢粙鍨紟闂備礁婀遍搹搴ㄥ闯椤曗偓瀵偊宕熼娑氬幍闂佺粯顨呴悧濠勬閺屻儲鐓涢悗锝傛櫇缁愭棃鏌＄仦鍓ф创妤犵偛娲Λ鍐ㄢ槈濞嗘垳鎲鹃梻鍌欒兌缁垶骞愰崫銉﹀床婵せ鍋撶€殿喛顕ч埥澶愬閳哄倹娅囬梻浣瑰缁诲倸煤閵娾晜鍋╅柧蹇撴贡绾捐棄霉閿濆妫戦悹鎰嵆閺屾稓鈧綆浜濋ˉ鐘充繆閸欏濮嶆鐐村笒铻栭柍褜鍓涘☉鐢稿焵椤掑嫭鈷戠紓浣姑慨鍥┾偓娈垮枦濞夋稖顣鹃梺瑙勫婢ф鍩涢幋锔藉€甸柛锔诲幖椤庡本绻涢崗鐓庡闁哄本鐩俊鎼佸Ψ閿曗偓娴犳潙螖閻橀潧浠滈柛鐕佸亰閸┿垺鎯旈妸銉ь吅闂佸搫鍊搁妵妯荤珶閺囩偐鏀介柣鎰綑閻忥附銇勮箛锝勯偗妞ゃ垺妫冨畷濂告偆娴ｈ妫勯梺璇查缁犲秹宕曢柆宓ュ洦瀵奸弶鎴犲幈闂佺懓顕慨椋庡閸忕浜滈柡宥冨妿閳洜绱掗埀顒勫礃閳哄啰顔曢梺鍛婁緱閸樹粙宕甸崶顒佺厸閻忕偛澧藉ú鎾煙椤斿搫鐏茬€规洏鍔嶇换婵嬪礋椤撴稒鐎奸梻鍌氬€峰鎺旀椤旀儳绶ら柛褎顨呯粈鍌涙叏濡炶浜鹃梺缁樹緱閸犳岸鍩€椤掑﹦绉甸柛鐘愁殜瀵彃鈹戠€ｎ偆鍘撻悷婊勭矒瀹曟粌鈽夊顒€鐏婄紓鍌欑劍椤洨寮ч埀顒€鈹戦鏂や緵闁告﹢绠栧畷銏ゆ焼瀹ュ棌鎷洪柣鐔哥懃鐎氼剛绮堥崘顔藉€堕煫鍥ㄦ⒒閹冲洨鈧娲樼换鍌烆敇閸忕厧绶為悗锝庡墮瀵櫕绻濋悽闈涗沪闁搞劌鐖奸垾锕傚炊閳哄啩绗夐梺缁橆殔閻楀嫭绂嶅鍕╀簻闊洦鎸搁鈺呮煛閸☆厾鍒伴柍瑙勫灴閸ㄦ儳鐣烽崶褏鍘介柣搴ゎ潐濞叉牕鐣烽鍐航闂備胶绮崹鎯版懌濡炪倖鏌ㄩ崐鍨潖婵犳艾纾兼繛鍡樺笒閸樷€愁渻閵堝骸骞栭柣妤佹崌閵嗕線寮介鐐靛€炲銈嗗坊閸嬫挾鐥幆褜鐓奸柡灞炬礋瀹曠厧鈹戦崶褎顏ら梻浣告惈濡挳姊介崟顖毼﹂柛鏇ㄥ灠閸愨偓濡炪倖鍔﹀鈧繛宀婁邯濮婅櫣绮欓崠鈥冲闂佺绻戦敃銏狀嚕婵犳碍鏅插璺侯煬濞煎﹪姊洪棃娑氱畾闁告挻绻傝闁告洦鍨遍埛鎴︽煙缁嬫寧鎹ｉ柍顖涙礈缁辨帡顢欓懞銉ョ濡炪値鍋勭换姗€骞栬ぐ鎺戞嵍妞ゆ挾濮烽崢顖炴⒒娴ｅ憡璐℃い顓炵墢閳ь剚绋堥弲鐘荤嵁韫囨稑纭€闁绘劏鏅滈弬鈧俊鐐€栧Λ渚€锝炲Δ鈧…銊╁醇濠靛牜妲烽柣搴″帨閸嬫捇鏌涢弴銊ュ濞寸姴宕—鍐Χ閸℃ê钄奸梺鎼炲妽濡炰粙宕哄☉銏犵闁圭偨鍔岀紞濠囧极閹版澘宸濇い鏃囨閺嬫垿姊绘担鍛婃儓妞ゆ垵鎳樺畷顖烆敍閻愬弬锕傛煕閺囥劌鐏遍柡浣稿暣閺屾洝绠涙繝鍐╃彆闂佸疇顕ч悧鎾诲箖濡ゅ啯鍠嗛柛鏇ㄥ墰椤︺儳绱撻崒姘毙㈤柨鏇樺€濋幃楣冩偪椤栨ü姹楅梺鍦劋缁诲啴寮查埡鍛拺缂備焦锚婵箓鏌涢幘鏉戝摵妞ゃ垺鐟╁鎾閳锯偓閹峰姊虹粙鎸庢拱闁荤啙鍛濞寸厧鐡ㄩ悡鏇㈡煙閹屽殶闁瑰啿鎳愮槐鎺楊敊閼恒儺妫冨Δ鐘靛仦閿曘垽銆佸▎鎾村癄濠㈣泛顦遍弳妤€鈹戦悩鍨毄闁稿鍋ゅ畷褰掝敍閻愭彃鐎┑鐐叉▕娴滄繈宕戦崒鐐寸厸闁搞儯鍎遍悘顏堟煟閹惧鎳囬柡宀€鍠愰幏鍛村礃閳哄啫娑ф繝鐢靛仜閹冲酣骞婃惔銊ョ厴闁硅揪闄勯弲顒勬煕閺囥劌浜滃ù鐘筹耿閺屟呯磼濡厧鈷岄梺鍝勭焿缁绘繂鐣峰鈧俊姝岊槻妞ゃ倐鍋撻梻鍌欑劍婵炲﹪寮ㄦ潏鈺傛殰闁跨喓濮撮拑鐔哥箾閹寸偟鐓繛宀婁邯閺岀喓鎲撮崟顐㈩潓濡炪們鍎茬换鍫濐潖濞差亝鐒婚柣鎰蔼鐎氭澘顭胯閸ㄥ爼寮婚悢纰辨晩闁绘挸绨堕崑鎾诲锤濡も偓閸ㄥ倸螖閿濆懎鏆為柡鍛箞閺屾稓浠︾拠娴嬪亾閺嶎厼鐤鹃柕蹇嬪€栭埛鎴︽煕濞戞﹫鏀诲璺哄閺屾稓鈧綆浜濋ˉ銏ゆ煛娴ｅ摜孝闁宠棄顦垫慨鈧柍閿亾闁归攱妞藉娲川婵犲嫧妲堥梺鎸庢磸閸庢彃顕ラ崟顖氱妞ゆ牗绋撻崢杈ㄧ節閻㈤潧孝闁稿妫濆畷鏇＄疀濞戞瑥浜楅梺闈涚墕濡孩绂嶅鍫㈠彄闁搞儯鍔嶇亸浼存煕閿濆洤鍔嬬紒缁樼洴瀹曘劑顢橀悤浣癸紗婵犳鍠栭敃銉ヮ渻閽樺鏆﹂柕濠忓缁♀偓闂佸憡鍔戦崝搴∥熼崒鐐粹拻濞达絽鎲￠崯鐐层€掑顓ф疁鐎规洝顫夌€佃偐鈧數顭堢粊锕傛⒑缁洖澧茬紒瀣浮閸╂盯骞掑Δ浣哄幈闁诲繒鍋涙晶浠嬪箠閸℃稒鐓曢煫鍥ㄦ尵閻掓悂鏌″畝鈧崰鏍箹瑜版帩鏁冮柨婵嗘噽閿涙挻淇婇悙顏勨偓鎴﹀垂閸濆嫮鏆嗛柟闂撮檷閳ь兛绀侀～婊堝焵椤掑嫬绠栭柕蹇嬪灮閻瑩鏌涢…鎴濇灆缂佽京鍠栧濠氬磼濮橆兘鍋撴搴ｇ焼濞撴埃鍋撻柟顔矫埞鎴犫偓锝呯仛閺呯偤姊洪幖鐐插姶闁告挻鐟╅幃鈥斥攽鐎ｎ偆鍘搁梺鍛婂姂閸斿矂鍩€椤掑倹鏆€规洘鍨块獮姗€鎳￠妶鍛偊闂備礁澹婇悡鍫ュ窗閺嶃劍鍙忛幖绮规濞撳鏌曢崼婵堢缂佸彉鍗抽弻娑樜旀担绯曟灆濡ょ姷鍋涢崯鎾极閹剧粯鍋愰柛娆忓€堕崝鎴﹀蓟閵娾晛妫橀柛顭戝枓閹稿啴姊烘导娆戠暠闁绘鎸搁～蹇旂節濮橆剛锛滃┑顔矫畷顒劼烽埀顒傜磽閸屾瑧顦︽い鎴濇閺侇噣妾辨俊顐犲灲濮婅櫣绱掑Ο鍝勵潔闂佷紮缍嗘禍婵堢矉瀹ュ拋鐓ラ柛顐ゅ枔閸橆亝绻濋姀锝庡殐闁搞劋鍗冲畷顒勵敇閵忕姈銊ф喐韫囨洖顥氬┑鍌滎焾缁狙囨煕椤愶絿鈽夊┑鈥冲悑缁绘盯骞栭鐐寸彎闂佸搫鏈惄顖炲春閿涘嫧鍋撻敐搴″闁哄棎鍊濆铏瑰寲閺囩喐婢掗梺绋款儐閹告悂鈥旈崘顔嘉ч柛鈩冾殘閻熴劑鏌ｆ惔銏犲毈闁告挻绋掔粩鐔煎即閻旇櫣鐦堝┑顔斤供閸橀箖宕㈤悽鍛娾拺闁告稑锕ョ€垫瑩鏌涘☉鍗炲箻妞ゆ劕銈稿缁樻媴閻熸壋鏋欓梺琛″亾閺夊牃鏅滈弳婊堟煥閻斿搫孝闁藉啰鍠愮换娑㈠箣閻愮數鍙濆┑鐐茬焾娴滎亪寮婚悢鐑樺枂闁告洦鍋勯～灞筋渻閵堝啫鍔滅紒璇茬墕椤繐煤椤忓懐鍔甸梺缁樺姌鐏忣亞鈧碍婢橀…鑳檨闁搞劌鐖煎濠氭偄绾拌鲸鏅╅梺缁樻尭缁ㄥ爼宕戦幘璇查敜婵°倕鍟粊锕傛⒑閸涘﹤濮﹂柛娆忛鍗遍柤娴嬫櫇绾捐棄霉閿濆牊顏犻悽顖涚〒缁辨帞鎷犻懠顒€顣洪梺浼欑悼閸忔﹢骞冮姀銏犳瀳閺夊牄鍔嶅▍宥夋⒒娴ｈ櫣甯涢柨鏇樺灩椤洩顦归柣娑卞櫍瀹曞崬鈽夊▎灞惧闂備胶顭堥張顒勬偡閿斿墽鐭堥柣妤€鐗勬禍婊勩亜閹扳晛鐒烘俊顖楀亾闁诲氦顫夊ú妯好洪悢鑲╁祦閹兼番鍔嶉崵宥夋煏婢跺牆鍔欐俊鍙夊姍濮婄粯绗熼埀顒€顭囪閳ワ箓宕奸妷銉э紵濡炪倖娲嶉崑鎾垛偓娈垮枤椤牓顢橀崗鐓庣窞閻庯綆鍓欓獮妤佺節绾版ɑ顫婇柛銊ф暬瀹曟垿骞囬鑺ユ濠电偞鍨崹娲偂閻斿吋鐓欓柟顖嗗拑绱炵紓浣哄Т椤兘寮婚敐澶婄闁告劑鍔嬮崰濠囨倵鐟欏嫭绀€闁绘牕鍚嬫穱濠囧箹娴ｈ娅嗙紓鍌欓檷閸ㄩ缚鈪插┑鐘殿暜缁辨洟宕戦幋锕€纾归柡鍥╁櫏濞堜粙鏌熼梻瀵割槮閻庢艾顦伴妵鍕箳閹存績鍋撻悷鎵殾闁告瑥顦辩粻楣冩煙鐎涙鎳冮柣蹇ｄ邯閺屽秹鏌ㄧ€ｎ亝璇為梺鍝勫閸撴繂顕ラ崟顓涘亾閿濆簼绨藉ù鐘差嚟缁辨挻鎷呮搴ょ獥闂侀潻缍囩徊浠嬶綖韫囨拋娲敂閸曨亞鐐婇梻浣告啞濞诧箓宕滃璺虹闂侇剙绉甸埛鎴︽煟閹存梹娅嗘繛鍛崌閺屾盯濡搁妸鈺佹懙缂備礁鐭佹ご鍝ユ崲濠靛鐐婇柕濞垮劗閸嬫捇鎳￠妶鍥╋紲濠电偞鍨堕敃鈺呭磿閹扮増鐓涢柛娑变簼濞呭﹥鎱ㄦ繝鍛仩缂佽鲸甯掕灒閻犲洩灏欓。鏌ユ⒑鐠囨煡顎楅柣蹇旀皑閺侇噣骞掑鐑╁亾閿曞倸鐐婇柕濞у本绁梺璇插嚱缂嶅棝宕戦埀顒勬煙妞嬪海甯涚紒缁樼⊕濞煎繘宕滆閸嬔囨⒑绾懏鐝柟鐟版喘瀹曟椽濮€閵堝懎宓嗛梺闈涢獜缁辨洟宕㈤幖浣光拺闂侇偆鍋涢懟顖涙櫠椤栨稓绠鹃柣鎾虫捣缁犲鏌涢埡瀣瘈鐎规洘甯掗埥澶娾枎濡儤鏆梻鍌氬€搁崐椋庣矆娴ｉ潻鑰块梺顒€绉寸壕鍧楁煏閸繍妲堕柍褜鍓欓崯鏉戠暦閸楃偐鏋庨柟瀛樼矌閻熸繈姊绘担鍛婅础闁稿簺鍊濋妴鍐幢濞戞鍘遍梺鍦劋閸ゆ俺銇愰幒鎾存珳闂佹悶鍎崝灞解枔鐏炵瓔娓婚柕鍫濇缁€鍐磼椤斿吋鎹ｆ俊鍙夊姍楠炴帡寮埀顒傗偓姘哺閺岀喓绱掑Ο鍝勬綉闂佺顑嗛幑鍥х暦缁嬭鏃堝礃閵娧佸亰婵犵數濮烽弫鍛婃叏閹绢喖绠犻柟鎵閸嬵亪鏌嶈閸撴瑩鍩為幋锔藉€烽柡澶嬪灩娴犵顪冮妶搴″箹婵炲樊鍘奸锝嗙節濮橆剟鍞堕梺闈涱檧閼靛綊骞忛搹鍦＝闁稿本鐟ч崝宥夋煥濮橆兘鏀芥い鏃傗拡濡偓闂佸搫鏈粙鎺楀箚閺傚簱妲堟俊顖氬槻娴滅偓绻濋棃娑卞剰缂佺姵鐗犻弻銊╂偄閸濆嫅銏ゆ煕濡や礁鈻曢柡灞炬礉缁犳盯濡疯閿涚喖姊洪崨濞掕偐鍒掑▎蹇ｆ綎婵炲樊浜滄导鐘绘煕閺囥劌浜愰柛瀣崌瀹曠兘顢樺☉妯瑰缂備焦顨嗙粙鎴澝洪妶鍥╀笉婵鍩栭悡鏇熴亜閹板墎鎮奸悹鎰ㄦ櫇閹叉悂鎮ч崼婵堢懖闂佺顑嗛崝娆撳箖鐟欏嫭濯撮柤鎭掑劤瑜把囨⒑閸濄儱校鐎光偓缁嬫娼栨繛宸簻娴肩娀鏌涢弴銊ヤ航婵¤尙鏁诲娲焻閻愯尪瀚板褜鍠氶惀顏嗙磼閵忕姴绫嶉悗娈垮枟婵炲﹤鐣烽崡鐐╂婵炲棙鍨电敮妤呮煟閻斿摜鐭嬬紒顔芥尭閻ｅ嘲顭ㄩ崼鐔蜂簻婵＄偛顑呯€涒晛鈻撻悙顒傜闁哄鍨甸幃鎴炵箾閸忚偐鎳呯紒顔剧帛缁绘繂顫濋鐐板寲闂備礁鎲＄换鍌溾偓姘煎弮楠炲棝宕奸妷锔惧幗闂婎偄娲﹂幖顐㈩啅閵夆晜鐓冮悷娆忓閻忔挳鏌熼鐣屾噰鐎规洩绲惧鍕熸导娆戠＜闂傚倸鍊风粈浣革耿闁秮鈧箓宕奸妷銉ь啈濠电姴锕ら幊搴ㄥ垂濠靛牏纾藉ù锝咁潠椤忓牜鏁嬮梺顒€绉甸悡娑橆熆鐠轰警鍎忛柣蹇婃櫆閵囧嫰寮埀顒勫礉閺囥垹鐓橀柟杈鹃檮閸婂鏌涢妷銏℃珖閺嶏繝姊绘担鍛婂暈闁圭顭烽幃鐑藉煛閸涱厾鐣哄┑顔姐仜閸嬫捇鏌涢埡瀣瘈鐎规洏鍔戦、娆撳箚瑜嶇粻浼存⒒娴ｇ瓔鍤欓柛鎴犳櫕缁辩偤宕卞☉妯硷紱闂佸憡娲﹂崹閬嶅磹閸洘鐓冮柛婵嗗閺嗙喓鐥幆褋鍋㈢€殿喖鐖煎畷鐓庘槈濡警鐎撮柣搴ゎ潐濞叉牠鎯夋總绋跨劦妞ゆ帒鍠氬鎰箾閸欏鐒介柡渚囧櫍楠炴帒螖閳ь剟鎮″┑瀣婵烇綆鍓欐俊鑲╃磼閻欏懐绉柡灞诲妼閳规垿宕卞Ο铏圭崺闁诲氦顫夊ú鏍偉閻撳寒娼栧┑鐘宠壘绾惧吋绻涢崱妯虹劸婵″樊鍣ｅ铏规兜閸涱厜鎾剁磼椤旇偐效妤犵偛鐗撴俊鎼佸煛閸屾矮缂撻梻浣侯攰閸嬫劙宕戦幇鏉跨；闁规崘顕х粈鍐煃閸濆嫬鏆熼柣锕€鐗撳铏圭矙閼愁垼娼堕梺绋匡攻濞叉牠鍩㈤幘璇参╅柨鏂垮⒔閻﹀牓姊哄Ч鍥х伈婵炰匠鍕ⅰ闂傚倷鑳堕崢褍锕㈤柆宥呯；闁规崘顕х壕鎸庛亜閹板爼妾柍閿嬪笒闇夐柨婵嗘祩閻掗箖鏌￠崱娑楁喚闁哄瞼鍠撻崰濠囧础閻愭澘鏋堥柣搴ゎ潐濞叉﹢宕濆▎蹇曟殾闁靛濡囩弧鈧梺鍛婃礀閻忔氨绮婇鈶╂斀闁绘绮☉褔鏌涙繝鍐╁€愭鐐差樀閺佹捇鎮╅懠顒€骞堥梻浣侯攰閹活亪姊介崟顖氱；闁挎繂顦伴悡娆愩亜閹捐泛鏋庣紒妤佸笒閳规垿鍨鹃悙钘変划闂佸搫鐭夌槐鏇㈠焵椤掑﹦绉甸柛瀣嚇閹繝濡烽埡鍌滃帗闁荤喐鐟ョ€氼剟鎮樼€涙ǜ浜滈柕蹇ョ磿閹冲懘鏌涢悩璇ц含鐎规洩绻濋幃娆撳箹椤撶偞娅冪紓鍌氬€搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т缁愭鏌″搴″箰闁逞屽墾缁犳捇寮婚妸褉鍋撻敐鍌涙珖缂佺姵宀稿铏圭磼濡櫣浼囨繝娈垮枔閸婃繂顕ｉ幓鎺濈叆闁割偅绻勬鍥⒑缂佹ê濮堟繛鍏肩懇钘熼悗锝庡枟閻撶喖鏌嶆潪鎵獢闁告瑥瀚幈銊︾節閸曨厼绗￠梺鐟板槻閹虫ê鐣烽妸锔剧瘈闁告劑鍔屾竟宥夋⒒閸屾瑧顦﹂柟鑺ョ矒瀹曟娊濡烽埡浣猴紱闂佸憡娲﹂崢鐓庮嚕閺屻儲鈷掑〒姘ｅ亾婵炰匠鍥ㄥ亱闁糕剝绋掗崑瀣節婵犲倻澧曟慨瑙勭叀閺屾稑螖閸愩劋姹楅梺琛″亾濞寸姴顑嗛悡銉︾箾閹寸伝顏堫敂閳轰急鐟邦煥閸愶箑浠梺鍝勬湰缁嬫帞鎹㈠┑瀣妞ゅ繐瀚ч崥鍌涗繆閻愵亜鈧倝宕戦崟顓熷床婵せ鍋撴鐐插暣閹粓鎸婃径宀€鏋冨┑鐘垫暩婵挳宕鐐参︽繝闈涱儐閻撴瑦銇勯弬鎸庢儓闁诲浚浜炵槐鎺撱偊閸啩鎾垛偓鍨緲鐎氼噣鍩€椤掑﹦绉甸柛鎾寸洴閸┿垺寰勫畝鈧壕浠嬫煕鐏炴崘澹橀柍褜鍓氶幃鍌氱暦閹扮増鍊婚柤鎭掑劚閳ь剙娼￠弻銊╁即閻愭祴鍋撻悽绋跨劦妞ゆ帒锕﹂悾鐢碘偓瑙勬礀閻栧ジ宕洪埄鍐╁闁规壆鍠愬畝绋款潖濞差亝鐒婚柣鎰蔼鐎氭澘顭胯閹告娊寮婚垾宕囨殕闁逞屽墴瀹曚即寮介鐐电枃闂佸搫绋侀崢濂告偂濞戙垺鐓曢柡鍥╁剳瀹搞儲銇勯敂鐐毈鐎殿喛顕ч濂稿醇椤愶綆鈧洭姊绘担鍛婂暈闁规瓕宕甸幑銏ゅ礋椤掑偆娲哥紓浣割儏缁ㄩ亶寮告惔銊︾厵闁绘劦鍓氱紞鎴︽煕閹垮啫娅嶉柡宀€鍠栧畷妤呮嚃閳哄倹顔冮梻浣规偠閸斿繐鐣烽棃娑卞殨鐟滄棃宕洪埀顒併亜閹烘垵顏柍閿嬪灦閹便劑鎮烽悧鍫熸倷闂佽绻愬鍓佹崲濞戞瑦濯撮柛鎰絻椤忣偅銇勯埡鍐ㄥ幋闁哄苯绉瑰畷顐﹀礋椤愮喎浜鹃柤鍝ユ暩椤╁弶绻濇繝鍌滃闁绘挻鐩弻娑㈠Ψ閵忊剝鐝旈梺鍝勵儐濡啴寮婚敐澶樻晣闁绘劗鏁告导鍥╃磽娴ｄ粙鍝洪悽顖ょ節閵嗕礁鈻庨幋婵囩€抽柡澶婄墐閺呮盯骞冮幋鐐扮箚闁靛牆娲ゅ暩闂佺顑嗛惄顖炪€侀弽銊ョ窞闁归偊鍓涢悾娲⒑閸愬弶鎯堥柟鍐叉捣缁鎮介崨濠勫幍闂佺粯鍨惰摫闁抽攱鍔欓弻锝夊箼閸曨厼鍩岄梺瀹狀潐閸ㄥ潡骞冮埡鍛瀭妞ゆ劧绲鹃惁搴♀攽閻樻剚鍟忛柛鐘冲哺瀹曟螣娓氼垰娈ㄥ銈嗗姧缁犳垵顔忓┑鍡忔斀闁绘ɑ褰冮弳娆戔偓娈垮枛濞尖€愁潖濞差亜鎹舵い鎾墲椤庢姊洪崫銉バｆい銊ワ工椤曪綁骞撻幒鍡樻杸闁诲函缍嗛崑鍡涘储椤忓牊鈷戦柛鎾村絻娴滄繄绱掔拠鑼㈤崡杈╂喐閻楀牆绗氶柣鎾存礋閹鏁愭惔婵囧枤闂佺楠哥换姗€寮诲鍥ㄥ枂闁告洦鍋嗘导宀勬⒑鐠団€虫灀闁哄懐濮撮悾鐑芥晲閸℃绐為柣搴秵閸嬪嫰鍩€椤掑嫷妫戠紒?)
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
      ElMessage.success('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鎮㈤崗灏栨嫽闁诲酣娼ф竟濠偽ｉ鍓х＜闁绘劦鍓欓崝銈嗙節閳ь剟鏌嗗鍛姦濡炪倖甯掗崐褰掑吹閳ь剟鏌ｆ惔銏犲毈闁告瑥鍟悾宄扮暦閸パ屾闁诲函绲婚崝瀣уΔ鍛拺闁革富鍘奸崝瀣煕閵娿儳绉虹€规洘鍔欓幃娆忣啅椤旇棄鐦滈梻渚€娼ч悧鍡椢涘Δ鍐當闁圭儤鎸舵禍婊堟煥閺傝法浠㈢€规挸妫涢埀顒侇問閸犳鎮￠敓鐘偓渚€寮崼婵嬪敹闂佺粯妫佸〒褰掓偨缂佹绡€闁汇垽娼у瓭闂佹寧娲忛崐婵嗙暦椤栫偞鍋嬮柛顐ゅ枑閻濓繝姊婚崒姘偓鐑芥倿閿旈敮鍋撶粭娑樻噺瀹曟煡鏌涢弴銊ョ仩缁惧墽绮换娑㈠箣濞嗗繒浠奸梺缁樻尰閿曘垽寮婚悢琛″亾閻㈡鐒剧悮銉╂⒑缁嬫鍎愰柟鐟版喘瀵偊骞囬鐔峰妳闂佺偨鍎寸亸娆撳礄鐟欏嫮绡€闁汇垽娼ф禒婊堟煙閸愭煡顎楅悡銈嗐亜閹捐泛鍓辨繛鍏肩墵閺屟嗙疀閹剧纭€闂佹椿鍘介悷鈺呭箖瑜版帒绠掗柟鐑樺灥椤姊洪崨濠冾梿妞ゎ偄顦遍幑銏犫攽閸繃鐎冲┑鈽嗗灠閸㈠弶绂嶆ィ鍐╃叄闊浄绲芥禍婊呯磼閹邦厾銆掔紒杈ㄦ尰缁楃喖宕惰閻忓秹姊洪懡銈呮瀭闁告柨娴烽崚鎺旀嫚濞村顫嶉梺闈涚箳婵兘鎯堥崟顖涒拺缂佸瀵у﹢鎵磼椤斿ジ顎楅崡閬嶆煕閵夘喖澧柍閿嬪笒閵嗘帒顫濋敐鍛婵犵數鍋橀崠鐘诲礋閸偒鍟嶉梻濠庡亜濞诧箑煤閺嶎偅顐介柕鍫濇偪瑜版帗鍋愮€瑰壊鍠栭崜閬嶆⒑缁嬫鍎忛柛濠傛健瀵鎮㈤悡搴ｎ吋濡炪倖姊婚埛鍫ュ汲椤撱垺鈷戠紓浣股戠亸鐗堢箾閼碱剙鏋涚€殿喖顭烽弫鎾绘偐閼碱剦妲伴梻浣瑰缁诲倿骞婂鍡欑彾闁哄洢鍨洪埛鎺懨归敐鍫燁仩閻㈩垱绋掗妵鍕Ω閵壯冾杸闂侀€涚┒閸旀垿鐛鈧、娆撴寠婢跺鍋呴梻鍌欒兌缁垶宕归悡骞盯宕熼鐘辩瑝闂佹寧绻傞ˇ浼存偂閵夆晜鐓涢柛銉厛濞堟柨霉濠婂牏鐣洪柡灞剧洴婵＄兘濡疯閹茶偐绱撴担铏瑰笡缂佽鐗婇幈銊╁焵椤掑嫭鐓ユ繝闈涙椤ョ娀鏌曢崱妯哄妞ゎ亜鍟存俊鍫曞幢濡ゅ啩娣繝鐢靛仜濡﹪宕㈡總鍛婂仼闁绘垼妫勯～鍛存煏閸繃鍣芥い鏃€鍔栫换娑欐綇閸撗冨煂闂佸憡蓱缁捇鐛箛鎾佹椽顢旈崨顏呭缂備胶铏庨崢濂稿箠鎼淬垻顩茬憸鐗堝笚閻撴洟鎮楅敐搴′簽婵炴彃顕埀顒冾潐濞叉鎹㈤崒婵堜簷闂備礁鎲℃笟妤呭窗濮樿泛鍌ㄩ柟闂寸劍閳锋垿鏌涘☉姗堟缂佸爼浜堕弻娑㈡偐鐎圭姴顥濋柣鎾卞€濋幃妤呮偨閻㈢偣鈧﹪鏌涚€ｎ偅灏甸柟鍙夋尦瀹曠喖顢楅崒銈喰炵紓鍌氬€风欢锟犲窗濡ゅ懎绠查柛銉戝苯娈ㄦ繝鐢靛У閼归箖鐛姀鈥茬箚闁靛牆鎷戝銉╂煙椤旇棄鐏存慨濠呮閸栨牠寮撮悙娴嬫嫟闂備浇宕甸崰鍡涘磿閻㈠憡鍋樻い鏇楀亾鐎规洖銈告俊鐑芥晜鐟欏嫬顏烘繝鐢靛仦閹稿宕洪崘顔肩；闁规儳顕粻鎯归敐鍛毐婵炶绠撳畷鎴犫偓锝庡枟閻撴洟鏌嶉埡浣告殧濞存粍顨嗙换娑㈠箣閻愬啯宀稿鍛婃償閵婏妇鍘甸柣搴ｆ暩椤牆鏆╅梻浣虹帛鐢帡濡堕幖浣歌摕闁挎繂妫欓崕鐔搞亜閺嶃劎鐭岄弽锟犳⒒娴ｅ憡鎲稿┑顔炬暬閵嗗啯绻濋崶褏鐣洪梺鐐藉劜閺嬬厧危閸喐鍙忔慨妤€鐗忛崚鏉棵瑰鍫㈢暫闁哄本绋栫粻娑㈠箼閸愨敩锔界箾鐎涙鐭掔紒鐘崇墪椤繐煤椤忓懐鍔甸梺缁樺姌鐏忣亞鈧碍婢橀…鑳槻妞ゆ洦鍙冮崺鈧い鎺戝枤濞兼劖绻涢崣澶婄伌鐎规洩绻濆畷妯侯啅椤斿吋顓垮┑鐐差嚟婵挳顢栭幇鏉挎瀬闁搞儺鍓氶悡鐔镐繆椤栨氨浠㈤柣銊︽そ閺屾洟宕奸鍌滄殼濠殿喖锕︾划顖炲箯閸涱喚鐟规い鏍ㄧ⊕閺嗙偤姊绘担绛嬫綈婵＄偞瀵х粋宥夋倷闂堟稑鐏婃繝鐢靛У閼瑰墽绮婚敐澶嬬厽婵☆垰鎼幃浣虹磼濡も偓椤︻垶鍩為幋锔藉€烽柡澶嬪灩娴犳悂姊洪懡銈呮珢缂佹彃澧界划瀣吋閸滀胶鍙嗛梺鍓插亞閸犳捇宕㈤悽鍛娾拺缂備焦锚閻忥箓鏌ㄥ鑸电厽闊洤顑呴崝锕傛煛鐏炵晫啸妞ぱ傜窔閺屾盯骞樼€靛憡鍣板Δ鐘靛仦椤ㄥ懘鈥﹂妸鈺侀唶婵犻潧娲ㄩ埀顒夊墮椤啴濡堕崱妯硷紩闂佺顑嗛幐楣冨焵椤掑喚娼愭繛鍙夌矒閳ワ箓宕奸敐鍥︾胺婵犵數鍋犻幓顏嗗緤娴犲绠规い鎰跺瀹撲焦淇婇妶鍛櫤闁抽攱鍨块弻锝夋偄閸涘﹦鍑￠梺璇″枟閸ㄥ潡寮婚敐澶嬫櫜閹煎瓨绻堥崑妤呮倵鐟欏嫭绀冮柛鏃€鐟︽穱濠囧醇閺囩偞銇濇繛杈剧到閹碱偅鎱ㄥú顏呪拻濞达絽鎽滅粔娲煕鐎ｎ亷韬€规洏鍨藉畷婊嗩槾濞戞挸绉磋灃闁挎繂鎳庨弳鐐烘煟閹惧瓨绀冪紒缁樼洴瀹曞崬螖娴ｄ警娲舵繝纰樺墲瑜板啴骞栭锔光偓锕傛嚄椤栵絾顎囧┑鐐茬摠缁秶鎹㈤崼鐔剁箚闁汇垻顭堢粈瀣亜閺嶃劏澹樼€规挸妫楅—鍐Χ閸涱垳顔囧┑鈽嗗亝缁嬫牠鍩呴悽鍛娾拺閻犲洤寮堕崬澶嬨亜椤愩埄妲搁悡銈夋煛瀹ュ骸骞栭崶瀵哥磽娴ｅ壊鍎愭い鎴炵懇瀹曠敻寮撮姀锛勫幍缂傚倷闄嶉崹褰掑几閻斿吋鐓曞┑鐘插閸樻挳鏌″畝瀣М濠殿喒鍋撻梺缁樏崥鈧紒顕€娼ч埞鎴︽偐椤旇偐浠鹃梺缁橆殘婵挳锝炶箛鏃傜瘈婵﹩鍓涢敍婊冣攽閻愬弶顥為柛銊ョ秺閹即濮€閻橆偅鏂€闂佺粯鍔栧妯间焊閸愵喗鐓曢柕澶樺灣瀹€娑㈡煕鐎ｎ偅宕岄柡浣稿暣瀹曟帒顫濈捄鐑樻毆闂傚倷绶氬褔藝椤撱垹纾块柟鎯板Г閺咁剟鏌ｉ弬璺ㄦ闁衡偓娴犲鐓熼柟閭﹀墮缁狙勩亜閵壯冧槐闁哄瞼鍠撶划娆忊枎閸撗冩倯闁诲氦顫夊ú姗€宕归崹顔炬殾闁绘梻鈷堥弫宥嗙箾閹寸偠澹樻鐐搭殜濮婄粯鎷呴悜妯烘畬濡炪倖娲﹂崢鐣屸偓鐢靛帶閳规垹鈧絽鐏氶弲婊堟⒑閸撴彃浜為柛鐘插缁傛帟顦崇紒缁樼〒閳ь剛鏁搁…鍫㈡暜閸洘鐓熼幒鎶藉礉閹存繄鏆﹂柟鎵閸嬨劑鏌涘☉姗堝姛闁告ü绮欏铏圭磼濡崵鍙嗛梺纭咁嚋缁辨洖鈻庨姀銈呯煑濠㈣泛鐗呯花濠氭⒑闂堟侗妲堕柛搴＄－缁粯绻濆顓犲幐闁诲繒鍋涙晶钘壝洪幘顔界厵妞ゆ棁顫夊▍濠冾殽閻愬弶澶勯柟宄版嚇瀹曠兘顢橀悢鍓插晬闂傚倸鍊搁崐椋庣矆娴ｅ搫顥氭い鎾跺Т閸ㄦ繃銇勯弽顐粶缂佺姳鍗抽弻娑樷攽閸曨偄濮庨悗娈垮枛瀵埖绌辨繝鍥ㄥ€锋い蹇撳閸嬫捇寮撮悩鍐插簥闂佸湱澧楀妯肩不閻樺樊鐔嗛柤鎼佹涧婵洨绱掗悪鈧崹宕囨閹惧瓨濯撮悹鍥风磿閸旈绱撴担鍝勨枅缂佺姵鐗曢锝夊醇閺囩偤鍞跺┑鐘绘涧濡矂骞愰崘顔界厽閹兼番鍔嶅☉褔鏌曢崼鐔稿€愭鐐插暢閵囨劙骞掗幋鐘插Е婵＄偑鍊栫敮鎺斺偓姘煎弮瀵彃鈹戠€ｎ偆鍘遍柣蹇曞仜婢т粙鍩ユ径鎰厓鐟滄粓宕滃▎蹇ｇ劷闁跨喓濮撮拑鐔兼煥濠靛棭妲哥紒鐘崇洴濮婂宕奸悢琛℃濡ょ姷鍋涚粔鐢垫崲濞戞埃鍋撳☉娆樼劷闁活厼顑囩槐鎺楊敊閼恒儱纾抽悗娈垮枛椤兘骞冮姀銏″仒闁炽儱鍘栨竟鏇炩攽閻愭潙鐏﹂柣鐕佸灦閹偤鎮惧畝鈧壕濂告煟濡櫣锛嶅褜鍓熼弻鏇㈠炊瑜嶉顓炩攽閿涘嫬鍘撮柡浣瑰姍瀹曘劑顢涘▎鎴烇紡婵犵绱曢崑鎴﹀磹閹达箑绀夊┑鐘叉搐绾惧潡鏌ｉ姀銏╃劸缂佺姵鐗楃换娑㈠幢濡纰嶇紓浣哄珡閸ャ劎鍘甸柣搴㈢⊕椤洨绮婚妷锔剧闁稿繗鍋愰。鎻捛庨崶褝韬┑鈥崇埣瀹曞爼鈥栭鍝勫姦闁哄本绋撻埀顒婄秵閸撴瑦绂掗柆宥嗙厵妞ゆ柣鍔岄崥姗€寮崼婵嗙獩濡炪倖鎸炬刊顓㈠船閻㈠憡鈷掑ù锝呮啞閸熺偟绱掔€ｎ偄绗掓い顓炴搐閳诲酣骞囬澶婃闂備胶绮…鍥╁垝椤栫偞鍋傞煫鍥ㄦ惄閻斿棝鎮规ウ鎸庮仩濠⒀勬礋閺屾盯寮埀顒€顫濋妸褎顫曢柟鎯х摠婵挳鏌涘▎蹇ｆЧ闁绘繃娲滅槐鎾存媴閾忕懓绗＄紓浣筋嚙閻楁捇鐛崘鈺冾浄閻庯綆鍋掑Λ鍐ㄢ攽閻愬瓨缍戝褍閰ｅ畷鎴﹀Χ婢跺﹨鎽曞┑鐐村灟閸ㄨ鍎柣鐔哥矊缁夊爼寮鈧畷濂稿即閻斿搫甯楃紓鍌氬€烽悞锕佹懌闂佺粯鎸堕崕鐢稿蓟瀹ュ瀵犲鑸瞪戠瑧婵＄偑鍊ら崢褰掑礉閹存繄鏆︽慨妞诲亾闁诡喗鐟╅、妤佹媴閾忓湱鍊抽梻鍌氬€搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮撮姀鈩冩珕缂傚倷鐒﹁摫婵炲懎鐗撳缁樻媴閸涘﹤鏆堟繛鎾寸椤ㄥ﹤鐣疯ぐ鎺戠闁兼亽鍎遍崜褰掓⒑閻熸澘鈷旂紒顕呭灦閹繝鎮㈤崗鑲╁帾闂婎偄娲ら鍛存倿濞差亝鐓熼柟鐑樻尭閸斻倖銇勯埡浣靛仮鐎规洏鍔庨埀顒佺⊕鑿ら柟閿嬫そ濮婃椽宕ㄦ繝鍕ㄦ闂佹寧娲忛崕鎻掝嚗閸曨垰绀嬫い鏍ㄧ〒閸橀亶姊洪棃娑辩叚缂佺姵鍨胯棢閻庯綆鍓涚壕鍏笺亜閺傝法浠㈤柛姘贡缁辨帗娼忛妸銉х懆闁句紮缍侀弻娑㈡晜鐠囨彃绠婚梺浼欑秮缁犳牕顫忕紒妯肩懝闁逞屽墮椤洩顦归柟顔ㄥ洤骞㈡繛鎴烆焽閿涙瑩姊洪崨濠勨槈闁挎洩绠撻妴鍛村箵閹广劍妫冮弫鎰板川椤撶喐顔夐梻浣瑰▕閺€閬嶅垂閸︻厽顫曢柟鐑樻煛閸嬫捇鏁愭惔婵堢泿闂佹椿鐓夌槐鏇㈠焵椤掑喚娼愰柟顔肩埣瀹曟洟寮婚妷銉庯箓鏌涢弴銊ョ伇闁轰礁娲弻锝夊箛椤掆偓缁狙勭濞戞瑤绻嗛柣鎰典簻閳ь剚鐗曠叅闁冲搫鍟扮粈濠傘€掑锝呬壕闂侀潧妫旂欢姘嚕閹绢喖顫呴柍鈺佸暞閻濇牠姊绘笟鈧埀顒傚仜閼活垱鏅剁€电硶鍋撶憴鍕闁挎洏鍨藉畷娲焵椤掍降浜滈柟鍝勬娴滄儳顪冮妶搴濈盎闁哥喎鐡ㄦ穱濠囧醇閺囩偛鑰垮┑掳鍊愰崑鎾淬亜椤愩垺鍠樻慨濠呮缁瑩宕犻埄鍐╂毎婵＄偑鍊戦崝宀勬晝椤忓嫷鍤曟い鎰╁焺閸氬鏌涘☉鍙樼凹闁哄倵鍋撻梻鍌欑劍閹爼宕曢鈧鎻掆攽鐎ｅ灚鏅╅梺鍝勬储閸ㄦ椽鎮″☉姗嗙唵閻犺櫣灏ㄩ崝鐔奉熆瑜庡ú鏍€﹂懗顖ｆЬ闂佸搫鎷嬮崑鍡涘礆閹烘垟鏋庨柟閭﹀枤閻﹀牆鈹戦鏂や緵闁告﹢绠栧畷銏ゆ焼瀹ュ棌鎷洪梻鍌氱墛娓氭鎮￠鐐╂斀闁炽儴娅曞婵堢磼椤旂⒈鐓奸柟顔界懅閸犲﹤螣鏉炴澘顥氶梺鑽ゅ枑閻熴儳鈧凹鍘炬竟鏇㈠箹娴ｅ湱鍘遍柟鑹版彧缁查箖寮抽鍕厪闁糕剝娲滅粣鏃傗偓娈垮枟閹歌櫕鎱ㄩ埀顒勬煃閳轰礁鏆為柣婵囨礋濮婄粯鎷呮搴濊缂備浇寮撶划娆撳箠閻旂⒈鏁嶉柣鎰版涧缁侊箓姊洪崜鎻掍簴闁稿孩鐓￠崺娑㈠箣閿旇棄浠梺鎼炲劘閸斿瞼寰婃繝姘厱闁靛牆鐗呴崥顐ょ磼鏉堛劍灏い鎾炽偢瀹曘劑顢氶崨顕嗙礂闂佽姘﹂～澶娒哄Ο鐓庡灊鐎光偓閸曨偆鍘洪柟鍏肩暘閸斿瞼绮绘繝姘厱闁归偊鍘肩徊缁樼箾閸稑鈧牜鎹㈠┑瀣仺闂傚牊绋愬▽顏堟⒑閸撹尙鍘涢柛銊ㄦ硾閻ｇ兘鎮烽幊濠冩そ椤㈡棃宕ㄩ婵堟殫闂傚倷绀侀幖顐⒚洪姀銈呭瀭婵炲樊浜濋崑鍌炴煕閹伴潧鏋熼柛瀣у墲缁绘盯宕卞Δ鍐唶濡炪倕绻嗛弲鐘诲蓟濞戙垹妫橀悹鍥ㄧゴ閸嬫捇寮撮姀锛勭暢濠电姷鏁告慨鎾晝閵堝绠犻幖娣灮椤╂煡鏌熼锝囦粓閹兼番鍔岄悙濠勬喐濠靛鍙曟い鎺戝閻撴瑦銇勯弮鍌涙珪闁瑰啿娲﹂妵鍕閳╁喚妫冮悗瑙勬礈閸犳牗淇婇幖浣肝ㄩ柕鍫濇媼濡粓姊婚崒娆戭槮闁圭⒈鍋嗙划娆愮瑹閳ь剙鐣烽幋锕€宸濋柡澶嬪灦鏉堝牆鈹戦悩璇у伐闁绘锕幃鈥斥枎閹惧鍘介梺鐟邦嚟閸庢垶绗熷☉娆戠闁割偆鍠愮粈瀣煛瀹€瀣瘈鐎规洏鍔戦、娆撳礈瑜忛弶浠嬫⒒娴ｅ憡鎯堥悶姘煎亰瀹曟繈骞嬪┑鎰濡炪倖甯掔€氼剟宕归崒娑栦簻闁哄啫娴傚鎰版倵閸偆澧垫慨濠勭帛閹峰懐鎲撮崟鈺€鎴烽梻浣告啞鐪夌紒顔界懇閻涱噣骞嬮敃鈧悙濠冦亜閹哄棗浜鹃梺钘夊暟閸犳牠寮婚妸銉㈡斀闁糕檧鏅滅瑧婵＄偑鍊ら崑鍕箠濮椻偓瀵鏁愰崨鍌滃枛瀹曨偊宕熼浣烘И闂傚倷绀侀幖顐⑽涘Δ鍛亱闁圭偓鍓氬鏍煣韫囨挻璐＄痪鎯у悑娣囧﹪顢涘┑鎰闂傚倸顦粔鎾煘閹达附鍊烽悹楦挎濮ｃ垽姊洪崫銉バｉ柣妤佹礋椤㈡岸鏁愰崱娆戠槇濠殿喗锕╅崢钘夆枍濠婂牊鈷戦柛娑橈功閳藉鏌涙繝鍌ょ吋鐎规洑鍗冲浠嬵敇閻愭鍟囬柣鐔哥矌婢ф鏁Δ鍛？鐎光偓閸曨剛鍘卞┑鐘绘涧鐎氼剟宕濋妶鍡愪簻闁挎棁顕ч悘锛勭磼缂佹绠為柟顔荤矙濡啫霉閼哥數娲撮柡宀€鍠庨悾锟犲级閹稿孩顔掗柣搴ゎ潐濞茬喐绂嶇捄渚殨闁圭虎鍠楅崐鐑芥煛婢跺鐏ュ鐟扮Ф缁辨捇宕掑顑藉亾閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞闁靛绲肩划鎾绘⒑閸涘﹦缂氶柛搴㈢叀瀵啿顭ㄩ崼鐔哄弳闂佺粯鏌ㄩ幖顐モ叿闂備線鈧偛鑻崢鍝ョ磼閳ь剚绗熼埀顒勫春閵忊剝鍎熼柕濞垮劤椤旀帡姊洪崫鍕垫Ч闁搞劌鐖奸幃鐐鐎涙ǚ鎷绘繛杈剧到閹芥粓寮搁崘鈺€绻嗘俊鐐靛帶婵″潡鏌熷畡閭﹀剶鐎殿喖顭锋俊鐑藉Ψ瑜忛崢顒佺節閻㈤潧浠滄俊顖氾攻缁傚秴鈹戠€ｎ偄浜楅梺缁樻⒒閸樠呯不鐟欏嫮绠鹃柨婵嗛婢ь噣鏌嶈閸忔瑩宕愰弴鈶┾偓锕傚炊椤掆偓缁犳稒銇勯幘璺盒ユい鏃€娲熷娲川婵犲嫭鍣у銈忕畳妞存悂寮查崼鏇燁棃婵炴垶甯楅弬鈧梻浣哄仺閸庤京澹曢銏犳槬闁挎繂妫▓浠嬫煟閹邦剦鍤熷褜鍓熼弻鐔风暋閻楀牆娈楅悗瑙勬磸閸斿秶鎹㈠┑瀣闁告劏鏅濋。鑼磼缂佹绠撴い鏇樺劦閺屻劎鈧綆鍋嗛崙锟犳⒑闁偛鑻晶顖涚箾閼碱剙鏋涢柣娑卞枟缁绘繈宕橀埡浣稿Τ闂備線娼ч…顓犵不閹寸偟顩叉俊銈傚亾闁宠鍨块幃娆撳级閹寸姳妗撻梻浣哥－椤戞洟宕愬☉銏犖﹂柟鐗堟緲缁犳娊鏌熼幆褏鎽犻柣婵囧▕濮婄粯鎷呴崨濠傛殘婵炴挻纰嶉〃濠傜暦閵忋倕绠ｉ柟鐑樻⒐濡测偓婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌熸潏鍓х暠缁炬儳娼￠弻銈囧枈閸楃偛顫╅梺鍝勵儏閻楀繘鍩€椤掆偓缁犲秹宕曢崡鐐嶆稑鈽夐姀鐘靛幋閻庡箍鍎遍幊澶愬绩娴犲鐓熸俊顖氭惈缁狙囨煙閸忕厧濮嶇€规洖鐖奸獮姗€顢欑憴锝嗗闂備胶顢婇崑鎰板磻濞戙垹绀夐柟缁㈠枟閻撶喖鐓崶銊︹拻缂佺姷鍋涢埞鎴︽晬閸曨偄骞嬮梺绯曟櫔缁绘繂鐣烽幒鎴叆闁告劑鍔庨悿鍕⒒閸屾瑦绁版い鏇嗗洤绀勯柣锝呯灱缁€濠囨煕閳╁啰鈽夌痪鎯ь煼閺屾盯鍩勯崘鐐枍濠电偛妯婃禍婊呯不缂佹ǜ浜滈柡鍐ㄥ€瑰▍鏇㈡煕濮椻偓濞佳団€旈崘顔嘉ч柛鈩兦氶幏濠氭⒑缂佹ɑ鎯勯柛瀣躬閵嗕線寮崼婵嬪敹濠电娀娼ч悧鍡涚嵁鐎ｎ喗鈷掑ù锝囧劋閸も偓濡炪倖娲﹂崢浠嬪箞閵娾晩鏁囬柕蹇曞Х閿涙盯姊洪悷鏉库挃缂侇噮鍨跺鏌ュ蓟閵夈儳顔愰柣搴㈢⊕椤洨绮诲鈧弻鈩冩媴閸︻厼鈪瑰銈庝簻閸熷瓨淇婇幆鎵杸闁规崘鍩栬闂傚倷绀侀幗婊勬叏閻㈠憡鍋嬮柣妯款嚙閺勩儵鏌ｉ幇顒佹儓缂佺媴缍侀弻銊╁籍閸屾粌绗￠梺鍝勬噳閺呯姴顫忓ú顏勪紶闁告洦鍋€閸嬫捇宕奸弴鐐碉紮闂佽宕橀崺鏍敃娴犲鐓熼柕蹇曞У閸熺偤鏌嶉柨瀣伌闁哄本绋戦埥澶娢熷畡閭︽綋婵＄偑鍊曠换鎰板箠韫囨挴鏋嶉柣妯肩帛閻撶喖鏌ㄥ┑鍡樺殌閻庢矮鍗抽弻娑㈠Ω閿斿墽鐣肩紓浣介哺閹稿骞忛崨顕呮闁靛濡囬惌鎺斺偓瑙勬礃閸ㄥ灝鐣烽妸褉鍋撳☉娆樼劷闁告﹢浜跺铏规兜閸涱厾鍔烽梺鍛婃煥缁夋挳鍩㈠澶婂窛閻庢稒顭囬崢鎾绘偡濠婂嫮鐭掔€规洘绮岄埢搴ㄥ箻閺夋垳鍑藉┑鐘绘涧閸婂鈥﹂崼銉﹀珔闁绘柨鍚嬮悡銉︾節闂堟稒锛嶆俊鎻掓憸缁辨帡鎮╁畷鍥ｅ闂侀潧娲ょ€氫即鐛Ο鍏煎磯閺夌偟澧楅崺娑氱磽閸屾瑦顦烽柤鍐茬埣瀹曟螣娓氼垱缍庡┑鐐叉▕娴滄繈鎮炴繝姘厽闁归偊鍨伴拕濂告倵濮橆厽绶叉い顓″劵椤т線鏌涢妸銉у煟鐎殿喖顭烽幃銏㈠枈鏉堛劍娅撻梻浣虹帛閹稿摜鑺遍崼鏇炵；闁规崘顕ч崹鍌涖亜閺冨倸浜炬繛鍫熷劤閳规垿鎮欓崣澶嗘灆婵炲瓨绮嶇划鎾诲箖閻愬搫鍨傛い鎰С缁ㄥ姊洪悷鐗堟儓缂佸鎳撻‖濠傜暋閹冲﹦鎳撻…銊╁礋椤撶姷鍘滈梻浣告惈閻ジ宕伴弽褏鏆︽い鎰剁畱缁€瀣亜閹炬剚妲堕柛搴ｆ暬瀵鈽夊鍛澑闂佽鍎虫晶搴㈠閸モ晝纾藉ù锝勭矙閸濇椽鎮介銈囩瘈妤犵偛鍟撮崺锟犲川椤曞懏顥堟繝鐢靛仦閸ㄥ爼銆冮崼銉ョ闁哄洢鍨洪埛鎺懨归敐鍛喐闁哄鍟妵鍕敃閵忊晜鈻堥悗瑙勬礀缂嶅﹤鐣风粙璇炬棃鍩€椤掑嫬鍙婇柕澶嗘櫆閻撴洟鏌￠崶銉ュ闁诲繒濮风槐鎺楀焵椤掑嫬绀冩い鏃傛櫕閸樻捇鏌℃径灞戒沪濠㈢懓妫濊棟闁挎洖鍊归悡娑㈡煃瑜滈崜鐔笺€佸鈧慨鈧柨娑樺楠炴姊洪悷鏉挎倯闁伙綆浜畷鎰板Χ閸滀胶鍔烽梺褰掑亰閸樺墽绮绘ィ鍐╃厱婵炲棗娴氬Ο鍫ユ煟閹哄秶鐭欓柡灞稿墲缁楃喖宕惰閻濇繂螖閻橀潧浠﹂悽顖涘笩閻忓啴姊洪柅鐐茶嫰婢ф挳鏌熼鍡欑瘈闁搞劑绠栭獮鍥ㄦ媴閸濆嫭鏆╅梻浣藉吹婵儳顩奸妸褎濯伴柨鏇炲€归崑鍌涖亜閹哄秷鍏岀紒鐘荤畺閹绠涢弮鍌氼潷濠电偛鎳庨敃顏堝蓟閿涘嫪娌悹鍥ㄧゴ閸嬫挸鈹戦崱娆愭闂侀潧顭俊鍥╁姬閳ь剟鏌熼懖鈺勊夐柛鎾寸箓閳诲秴鈽夐姀鈾€鎷绘繛鎾村焹閸嬫捇鏌嶈閸撴盯宕戝☉銏″殣妞ゆ牗绋掑▍鐘炽亜閺傚灝鈷旂痪鍓у帶椤法鎹勯悜妯绘嫳闂佹悶鍊愰崑鎾翠繆閻愵亜鈧倝宕戦崟顓熷床闁圭儤姊归～鏇㈡煙閻戞ê娈鹃柣鏃傚劋鐎氭氨鈧懓澹婇崰鎺楀磻閹捐绠荤紓浣骨氶幏娲⒑閸涘﹦鈽夐柨鏇畵閸┿儲寰勯幇顓犲弳闂佸搫娲﹂敋闁逞屽墯缁诲倿顢氶敐澶婄闁芥ê顦甸崬鍫曟⒑闂堟稓绠為柛銊ヮ煼閺佸秴鈹戦崶鈺冾啎闁哄鐗嗘晶浠嬪礆閺夋鐔嗛柣鐔峰簻闊剛鈧娲樺ú鐔肩嵁閸ヮ剚鍋嬮柛顐犲灩楠炲牓姊绘笟鈧褔鈥﹂崼銉ョ？闁哄被鍎辩壕濠氭煏婢诡垪鍋撻柛瀣尭閳绘捇宕归鐣屽蒋闂備胶顭堥鍛存晝閵堝鍋╃€瑰嫰鍋婂銊╂煃瑜滈崜鐔煎Υ娴ｇ硶鏋庨柟鐐綑濞堢喖姊洪棃娑辨濠碘€虫穿閵囨劙宕堕浣叉嫽闂佺鏈悷銊╁礂鐏炰勘浜滄い鎾跺仧婢э妇鈧鍠氶弫濠氥€佸Δ鍛妞ゆ巻鍋撴繛鍫㈠仦娣囧﹪濡惰箛鏇炲煂闂佸摜鍣ラ崑鍡樼珶閺囥垺鍤掗柕鍫濆€告禍鐐殽閻愯尙浠㈤柛鏃€纰嶉妵鍕晜閸喖绁梺绯曟櫆閻╊垶鐛€ｎ喗鍋愰柛鎰级閻庨箖姊绘担铏瑰笡妞ゃ劌鎳橀幃褔宕卞▎鎴犵暥濠殿喗顭堥崺鏍偂閵夛妇绠鹃柟瀵稿仩婢规﹢鏌＄€ｎ偆娲撮柡灞糕偓宕囨殕閻庯綆鍓涜ⅵ婵°倗濮烽崑鐐垫暜閿熺姴绠栨繛鍡樻尰閸嬨劑鏌涢…鎴濅簼妞ゆ梹鎹囧濠氬磼濞嗘帒鍘＄紒缁㈠幖閻栫厧顕ｉ幓鎺濈叆闁割偆鍠庨崜顔碱渻閵堝棛澧遍柛瀣枎閻ｅ灚绗熼埀顒勫箖濡ゅ懏鏅查幖绮瑰墲閻忓秹姊洪崫鍕櫤缂侇喗鎹囧濠氭晲婢跺娅滈梺鍛婄⊕濠㈡﹢顢旈鐐嶆棃鎮╅棃娑楃捕闂佺粯顨嗛幐鎼侊綖韫囨洜纾兼俊顖濐嚙椤庢捇姊洪崨濠勨槈闁挎洏鍔庡☉鐢稿焵椤掑嫭鈷掑ù锝勮閻掔偓銇勯幋婵囶棦妤犵偞鍔欓獮鏍ㄦ媴濞村浜鹃柨鏇炲€搁悙濠勬喐婢舵劕鍑犻幖娣妽閻撴瑩鎮楀☉娆樼劷缂佺姵顭囩槐鎺戔槈濡偐顔掗梺鍝勭焿缂嶄線骞冮埡鍛煑濠㈣泛澶囬弫宥嗕繆閻愵亜鈧垿宕曢崡鐐嶆稑鈹戠€ｎ亞鐣洪梺缁樺灱婵倝鎮炴禒瀣叆闁哄啠鍋撻柛搴″暱椤曪綁骞庨懞銉㈡嫽婵炴挻鍩冮崑鎾绘煃瑜滈崜娑㈠磻濞戙垺鍤愭い鏍ㄧ⊕濞呯姴霉閻撳海鎽犻柣鎾存礋閺岀喖鎮滃Ο璇茬缂備焦顨嗙敮锟犲蓟瀹ュ洦瀚氶柡灞诲劚瀵澘螖閻橀潧浠︽い顓炴喘閸┾偓妞ゆ巻鍋撴繝鈧潏銊﹀弿闁汇垻顭堢粻鐔兼煟濡も偓閻楀繒寮ч埀顒勬⒑濮瑰洤鐏叉繛浣冲嫮顩烽柨鏇炲€归悡鏇㈡煏婵炲灝鍔ら柛鈺嬬悼閳ь剝顫夊ú妯侯渻閽樺鏆︽慨妞诲亾妞ゃ垺鐟╅幊鏍煛鐎ｎ剙鑰块梻鍌氬€烽懗鍫曞箠閹惧瓨娅犻柣锝呰嫰閸ㄦ繃銇勯弽顐粶闁汇倝绠栭弻锛勪沪鐠囨彃濮庣紓浣哄Т缂嶅﹪骞冨Δ鈧埥澶娾枎濡厧濮虹紓鍌欒兌婵敻鏁冮姀銈呰摕闁挎繂顦悡娑樸€掑锝呬壕濡炪倕瀛╅〃鍡涘Φ閸曨垼鏁傞柛鏇ㄥ亝濞堢粯绻濈喊妯峰亾瀹曞洤鐓熼悗瑙勬磸閸旀垿銆佸▎鎴犵＜闁靛骏绱曢崐鐐测攽閻樺灚鏆╅柛瀣洴閹椽濡歌閸ㄦ繈鏌ｅΟ铏癸紞妞も晛寮堕妵鍕疀閹炬剚浼岄梺鎼炲€栧ú鏍煘閹达附鍋愮€规洖娴傞弳锟犳⒑閸濆嫭鍣洪柟顔煎€垮濠氭晲閸涘倻鍠撻幏鐘绘嚑椤掑倶鍋＄紓鍌氬€烽悞锕傚礉閺嶎偆鐭欓柟杈捐吂閳ь剚妫冨畷姗€顢欓崲澹洦鐓曢柍鈺佸幘椤忓牆姹叉俊銈勮兌缁♀偓濠电偛鐗嗛悘婵嬪几閻斿吋鐓欓柛娑橈工閳绘洘顨ラ悙鎻掓殻闁轰焦鎹囬幃鈺呭礃闊厾鐩庨梻鍌欒兌椤牏鎹㈤幇鐗堝剭闁绘垼妫勭粻顖涚箾瀹割喕绨奸柍閿嬪灴閺屻倖鎱ㄩ幇顑藉亾閺囥垹鍑犻柟瀛樼箥閻斿棝鏌ｉ悢鍝勵暭妞ゃ儯鍨介弻鈩冩媴閸濄儛銏°亜閹剧偨鍋㈢€规洏鍔戦、鏃堝川椤旇姤绶梻鍌氬€烽懗鍓佸垝椤栫偛绀夐煫鍥ㄧ☉閻ょ偓绻涢幋鐐垫噮妞も晜鐓￠弻锝夊箛闂堟稑骞愮紓浣筋嚙濡繈寮婚敐澶婄疀闁稿繐鎽滈惄搴ㄦ⒑闁偛鑻晶顖炴煕閵娿儳浠㈤柣锝囧厴閹兘骞婃繝鍐┿仢妞ゃ垺妫冨畷銊╊敇濠靛牏绉块梻鍌氬€烽懗鍓佸垝椤栫偐鈧箓宕奸妷顔芥櫔閻熸粌绻掗崚鎺撶節濮橆剛楠囬柟鐓庣摠閹稿寮埀顒勬⒒娴ｈ櫣甯涢拑杈╂喐閺夊灝鏆ｇ€殿喖鍟块埢搴ㄥ箣閻樼绱查梻浣告啞閹搁绮堟担鍦浄婵犲﹤瀚ㄦ禍婊勩亜閹绢垰澧茬痪顓炵埣閺岀喖鎮烽弶娆句痪缂備焦顨堥崰鏍€佸☉姗嗙叆闁告劑鍔庣粙缁樼節閻㈤潧啸妞わ綀妫勫嵄闁告稒娼欑壕濠氭煕濞戝崬鐏犻柛銊︾箞閺岀喖鎮欓鈧晶顖涚箾閸忚偐澧辩紒杈ㄦ尰閹峰懘鎳栭埄鍐ㄧ仸闁告帒锕獮姗€顢欓悾灞藉籍婵犵妲呴崹顖滄媰閿曗偓鍗遍柟闂寸劍閻撴瑦銇勯弽銊х煀濞寸姾椴搁幈銊︾節閸愨斂浠㈤悗瑙勬处閸嬪﹥淇婇悜钘壩ㄩ柟鏉垮缁夘噣鏌＄仦鍓ф创鐎殿噮鍣ｉ崺鈧い鎺戝閸嬶繝鏌嶉崫鍕櫧鐎规挷绶氶弻娑㈠箛闂堟稒鐏嶉梺绋匡工椤兘寮婚敃鈧灒闁绘艾顕粈鍡涙⒑闂堟丹娑㈠礋椤愶絿鈧儳鈹戦悩顔肩伇闁糕晜鐗犲畷婵嬪即閻樺樊妫滄繝鐢靛У绾板秹鎮″▎鎾寸厽闁逛即娼ф晶顔碱熆瑜滈崹杈╂崲濞戞矮鐒婇柡宥冨妽閻濇岸姊洪崫鍕効缂傚秳绶氶悰顔碱潨閳ь剟鐛惔锝囬┏閻庯急鍐у濠德板€曢崯鎵婵傚憡鐓熸俊顖滃劋閹牓鏌涘顒佽础缂佽鲸甯楀蹇涘Ω閿曗偓闂夊秶绱撴担璇℃畼闁哥姵鐗曢悾鐑藉箚闁附歇闂備浇顕х换鎰版偋閹炬剚娼栭柧蹇撴贡绾惧吋鎱ㄥΔ鈧Λ娆撴偩閻戣姤鈷戦柛锔诲幗閸も偓濠电偛鐪伴崐婵嬪箖閹呮殝闁瑰啿锕ュ浠嬨€侀弮鍫濈妞ゆ挾鍋涜婵犵绱曢崑鎴﹀磹閺嶎偅鏆滃┑鐘叉处閳锋梻鈧箍鍎卞Λ娑€呴崣澶岀瘈濠电姴鍊绘晶娑㈡煟閹惧鎳囬柡宀嬬秮楠炲鎮樺ú璁抽偗闁诡喗锕㈡俊鐑藉煛閸屾粌甯楅柣鐔哥矋缁挸鐣峰鍐ｆ斀闁糕剝鐟﹀▓楣冩⒑閸撹尙鍘涢柛瀣閹敻宕奸弴鐔哄幐闂佹悶鍎崕閬嶆倶椤忓牊鍊甸柣銏ゆ涧瀛濆銈庡弨濞夋洟骞夐幘顔肩妞ゆ挾濮烽弳銈囩磽閸屾艾鈧摜绮旈幘顔芥櫇妞ゅ繐瀚烽崵鏇熴亜閹板墎鐣辩紒鐘崇洴閺屸剝寰勬繝鍐ㄤ淮闂佸摜鍋涢悥鐓庮潖閾忓湱纾兼俊顖濆吹閿涙稑鈹戦敍鍕沪閻㈩垪鈧磭鏆︽い鎰ㄦ嚒閺冨牆宸濇い鏃囶潐鐎氬吋绻濆▓鍨灓闁硅櫕鎸哥叅闁靛牆顦伴崐鎸庣箾瀹割喕绨奸柣鎾存礋閺屾洘绻涢悙顒佺彃闂佽鐓＄粻鏍蓟閻旂⒈鏁嶆慨姗嗗墻娴煎啫顪冮妶鍐ㄧ仾闁烩晩鍨堕獮鍐ㄢ枎閹炬潙娈ゅ銈嗗笒閸婄懓袙閸ャ劎绡€闁汇垽娼ф禒婊勩亜閺囥劌骞楅柟渚垮姂楠炴﹢顢氶崨顔芥珗闂備礁婀辨晶妤€顭垮鈧鍛婃媴鐞涒€充壕妤犵偛鐏濋崝姘繆椤愶絿銆掔€殿啫鍥х劦妞ゆ帊鑳剁弧鈧梺姹囧灲濞佳冪摥闂備胶顭堥敃銉╁箖閸屾凹鍤曢柟鎯版閸楁娊鏌ｉ弬鍨暢缂佺姵宀稿娲川婵犲嫭鍣у銈忓瘜閸ㄩ亶骞堥妸銉悑濠㈣泛顑囬崢?)
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
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">{{ 'Information \u6a21\u677f' }}</span>
              <el-input v-model="titleMatchForm.informationTemplate" :placeholder="'\u53ef\u9009'" />
            </label>
          </div>

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
              <span v-if="matchedTitleMatchPreview.title" class="series-studio__match-text">
                {{ '\u751f\u6210\u6807\u9898\uff1a' }}{{ matchedTitleMatchPreview.title }}
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
        <div class="series-studio__workspace">
          <div class="series-studio__workspace-toolbar">
            <div class="series-studio__workspace-actions">
              <el-button type="primary" plain :loading="isImportingMatchedTorrents" @click="importMatchedTorrents">
                <el-icon><UploadFilled /></el-icon>
                <span>{{ '\u5bfc\u5165 .torrent \u81ea\u52a8\u8bc6\u522b' }}</span>
              </el-button>
            </div>
            <StatusChip v-if="selectedEpisode" tone="info">
              {{ selectedEpisode.episodeTitle || `\u7b2c ${selectedEpisode.episodeLabel} \u96c6` }}
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

          <div v-if="activeVariant" class="series-studio__details-grid">
            <label class="series-studio__field series-studio__field--wide">
              <span class="series-studio__field-label">{{ '.torrent \u6587\u4ef6' }}</span>
              <el-input v-model="form.torrentPath" :placeholder="'\u9009\u62e9\u5f53\u524d\u7248\u672c\u5bf9\u5e94\u7684 .torrent \u6587\u4ef6'">
                <template #append>
                  <el-button @click="pickTorrentFile">
                    <el-icon><UploadFilled /></el-icon>
                  </el-button>
                </template>
              </el-input>
            </label>

            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u53d1\u5e03\u7ec4' }}</span>
              <el-input v-model="form.releaseTeam" :placeholder="'\u53ef\u9009'" />
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u6765\u6e90\u7c7b\u578b' }}</span>
              <el-select v-model="form.sourceType" clearable :placeholder="'\u53ef\u9009'">
                <el-option v-for="option in SOURCE_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u5206\u8fa8\u7387' }}</span>
              <el-select v-model="form.resolution" clearable :placeholder="'\u53ef\u9009'">
                <el-option v-for="option in RESOLUTION_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u89c6\u9891\u7f16\u7801' }}</span>
              <el-select v-model="form.videoCodec" clearable :placeholder="'\u53ef\u9009'">
                <el-option v-for="option in VIDEO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ '\u97f3\u9891\u7f16\u7801' }}</span>
              <el-select v-model="form.audioCodec" clearable :placeholder="'\u53ef\u9009'">
                <el-option v-for="option in AUDIO_CODEC_OPTIONS" :key="option" :label="option" :value="option" />
              </el-select>
            </label>
            <label class="series-studio__field">
              <span class="series-studio__field-label">{{ 'Information \u94fe\u63a5' }}</span>
              <el-input v-model="form.information" :placeholder="'\u53ef\u9009'" />
            </label>
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
      </section>
      <section class="series-studio__section">
        <div class="series-studio__section-head">
          <h3 class="series-studio__section-title">{{ '\u7ad9\u70b9\u5b57\u6bb5' }}</h3>
          <StatusChip tone="info">{{ selectedSiteFieldSections.length }} {{ '\u4e2a\u7ad9\u70b9\u5c55\u5f00' }}</StatusChip>
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
        <div v-else class="series-studio__empty">闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌ｉ幋锝呅撻柛銈呭閺屾盯顢曢敐鍡欙紩闂侀€炲苯澧剧紒鐘虫尭閻ｉ攱绺界粙娆炬綂闂佺偨鍎遍崯璺ㄨ姳閵夆晜鈷掑ù锝囩摂濞兼劕顭块悷鐗堫棡闁哄懓娉涜灃闁告侗鍘鹃敍娑㈡煟鎼搭垳绉靛ù婊勭墵瀵劍绂掔€ｎ偆鍘藉┑鈽嗗灥椤曆呭緤婵犳碍鐓涢柛鈩冪懃娴狅妇绱掔紒妯兼创鐎规洏鍔戦、娑橆潩閿濆棛鈧即姊绘担鍛婃儓閻炴凹鍋婂畷婵嬪箣濠垫劕娈ㄩ梺鍝勵槹閸わ箓寮崼婵堝姦濡炪倖甯婇懗鍫曘€呴弻銉︾厵妞ゆ牕妫楅張顒傗偓闈涚焸濮婃椽妫冨☉姘暫濠碘槅鍋呴悷褏鍒掑杈ㄥ磯闁靛ě鍜冪闯闁诲骸绠嶉崕杈┾偓姘煎枤缁綁寮崒妤€浜鹃悷娆忓缁€鍐╀繆閻愭壆鐭欑€规洘妞介崺鈧い鎺嶉檷娴滄粓鏌熼崫鍕ф俊鎯у槻闇夋繝濠傚閻帡鏌″畝鈧崰鏍х暦椤愶箑绀嬫い鎾愁槶閸庣敻寮诲☉婊呯杸闁规儳澧庨崝顖炴⒑閸濆嫯瀚扮紒澶婂濡叉劙骞掗幊宕囧枎鐓ょ紓浣癸供濡啴姊婚崒娆戭槮闁圭⒈鍋婇幊鐔碱敍濠婂懐鐓嬮梺缁樺灴閹筋亪濡搁敂鍓ф嚌闂侀€炲苯澧寸€殿喛顕ч埥澶愬閻樻鍟嬮梺璇插缁嬫帡鈥﹂崶褉鏋旈柕鍫濇川绾捐棄銆掑顒佹悙闁哄鍠栭弻锝夋偆閸屾粎鏆犲銈嗘磸閸庨潧鐣烽悢纰辨晬婵浜弶鎼佹⒒娴ｇ顥忛柣鎾崇墦瀹曟垿宕ㄩ娑欑€洪梺绯曞墲缁嬫帡鍩涢幒鎳ㄥ綊鏁愰崼鐕佷哗闂侀潧妫楅敃顏堝蓟濞戙垹绠婚悗闈涙憸閻ゅ嫰姊洪棃娑欘棞闁哥喎纾划璇测槈濡攱顫嶅┑鈽嗗灡濡叉帞娆㈤姀鈥茬箚闁绘劦浜滈埀顒佺墵楠炴劙宕奸弴鐐茬€┑鐐叉▕娴滄粓鎮￠弴銏＄厵閺夊牓绠栧顕€鏌ｉ幘瀛樼缂佺粯绻堝Λ鍐ㄢ槈濞嗘ɑ顥ｆ俊鐐€曞ù姘跺磻閸曨垪鈧箓鎳楅锝嗏枌濠电偛鐡ㄧ划宀勬偉閻撳寒鍤曢悹鍥ㄧゴ濡插牓鏌曡箛鏇炐ユい鏃€甯″娲川婵犲孩鐣奸梺绋款儐閻╊垶鍨鹃弽顐熷亾閿濆簼绨撮柡鈧禒瀣厓闁靛鍎遍弳杈╃磼閻欐瑥娲﹂悡鏇㈡煛閸愶絽浜惧┑鐐跺皺閸犳牕鐣峰ú顏呭€烽柛婵嗗椤撴椽姊洪幐搴㈢５闁稿鎸婚〃銉╂倷椤忓嫮浼堥梺鍝勮嫰缁夌懓鐣烽锕€绀嬫い鎰枎娴滃墽鎲搁悧鍫濈瑨鏉╂繈姊洪崨濠傚Е闁哥姵顨婇崺娑㈠箳閹炽劌缍婇弫鎰板炊閵娿儲鐣俊鐐€栧ú妯煎垝鎼达絾顫曢柟鐑樻⒐鐎氭岸鏌熺紒妯哄潑闁稿鎸搁～銏犵暆閳ь剚绂嶆潏銊х瘈闁汇垽娼ф禒婊勪繆椤愶絿鎳囨鐐村姈缁绘繂顫濋鍌︾串闂備礁澹婇悡鍫ュ磻娴ｅ湱顩叉繝濠傜墛閻撴盯鏌涚仦鐐殤濞寸姰鍨介弻宥夋煥鐎ｎ偀鎷婚梺姹囧労娴滎亜鐣烽敐澶娢ㄧ憸蹇涙偂閹剧粯鈷戦柛婵嗗濠€鎵磼鐎ｎ偅灏扮紒鍌涘浮閺佸啴宕掑槌栨Ф闁荤喐绮岄澶愬春閳ь剚銇勯幒宥囶槮缂佹甯楅妵鍕敇閳ュ啿濮峰銈忕畳鐏忔瑩鎯€椤忓棛纾奸柕蹇曞Т缁犺鈹戦垾鍐茬骇闁告梹鐟╅悰顕€骞掑Δ鈧粻濂告煕閺囥劌骞橀柣鎾村灦缁绘繈鎮介棃娑掓瀰濠电偘鍖犻崗鐐洴瀵噣宕煎┑鍫㈠炊濠电姷鏁告慨鏉懨洪敃鍌氱９闁汇垹鎲￠崑鈩冪箾閸℃绠版い蹇ｄ簽缁辨帡鍩€椤掑嫬绀冮柕濞垮灪閺傗偓闂備胶绮崝姗€顢氬鍫濈哗閻犲洨娼挎惔銊ョ倞鐟滄繈鐓渚囨闁绘劕顕晶顒勬煙瀹勭増鍣介柟鍙夋尦瀹曠喖顢楅崒姘辨偧闂傚倸鍊搁崐椋庢濮樿泛鐒垫い鎺戝€告禒婊堟煠濞茶鐏￠柡鍛閳ь剟娼ч幉鈥崇暦婢跺浜滈柡宥庡亜娴狅箓鏌ｉ幘瀛樼缂佺粯鐩獮瀣攽閸℃艾鐓樺┑鐘愁問閸犳牠骞楀鍫濈疅闁归棿鐒﹂崑瀣煕椤愶絿绠橀柣鐔村妿缁辨挻鎷呴幓鎺嶅闂備胶顭堥惉濂稿磻閻愮儤鍋傞柡鍥ュ灮閸欐捇鏌涢妷锝呭濠㈣锚闇夋繝濠傛－濞兼劗绱掔紒妯兼创鐎规洜鍘ч埥澶娢熷畡棰佸濠德板€曢崯顖烇綖閺囥垺鐓欓柟顖嗗苯娈堕梺鑽ゅ枎缂嶅﹪寮诲☉銏犖ㄩ柟瀛樼箓椤忣偆鎲搁悧鍫濈祷闁宠鍨块幃鈺佲枔閹稿孩鐦滈梻渚€鈧偛鑻晶鍙夌箾閸涱喗绀嬬€规洘婢橀～婊堝焵椤掑嫬钃熸繛鎴欏灩閻撴﹢鏌熼鍡楀€搁ˉ姘節绾板纾块柛瀣灴瀹曟劙寮介锝嗘闂佸湱鍎ら〃鍛玻濡や焦鍙忔慨妤€妫楁晶濠氭煟閹哄秶鐭欓柡宀€鍠栭獮宥夘敊绾拌鲸姣夐梻浣虹帛閹哥偓鎱ㄩ悜钘夌疅闁归棿鐒﹂崑瀣煕椤愶絿绠樻い鎴濆€垮鐑樺濞嗘垹袣濠电偛鎷戠紞渚€宕洪埀顒併亜閹烘垵鏋ゆ繛鍏煎姈缁绘盯宕ｆ径宀€鐣甸梺瀹狀嚙缁夊綊寮幇鏉垮耿婵炲棙蓱缁侇偊姊绘担鐟邦嚋婵炲弶鐗犲畷鎰亹閹烘垹锛欓梻浣哥仢椤戝啯绂嶅鍫熺厵閻庣數顭堟禒婊勩亜閺囩喓鐭掗柡灞剧洴閹瑥顔忛鍙呯磽娴ｈ櫣甯涚紒璇茬墦楠炲啯绂掔€ｎ偒妫冨┑鐐村灦椤ㄥ牓骞戦弴鐔虹瘈缁剧増蓱椤﹪鏌涚€ｎ亝鍤囬柕鍡楀暞缁绘繈宕惰閹芥洘绻濋悽闈浶㈡繛璇х畵瀵煡骞撻幒婵堝數闁荤姾娅ｇ亸銊ヮ啅閵夆晜鐓欐い鏍ㄧ矊娴犻亶鏌″畝瀣ɑ闁诡垱妫冮、娑橆煥閸涘拑缍佸娲传閵夈儛锝嗐亜閵娿儻韬鐐插暣閺佹捇鎮╅崘韫盎闂傚倸鍊甸崑鎾绘煙闁箑鏋ら柣锝夌畺濮婄粯绗熼埀顒€顭囪閹囧幢濞戞锛欓梺鍛婄☉閿曪箓銆呴幓鎹ㄦ棃鏁愰崨顓熸闂佹娊鏀遍崹鍦閹惧瓨濯撮柣褔鏅茬欢闈涒攽閻愯尙澧涙俊顐㈠暣瀵濡搁埡浣稿祮濠碘槅鍨甸妴鈧柛瀣尭閳规垹鈧綆浜濋悗?/div>
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

