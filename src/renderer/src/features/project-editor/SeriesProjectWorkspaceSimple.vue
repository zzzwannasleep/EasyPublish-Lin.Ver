<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDark } from '@vueuse/core'
import { Download, EditPen, FolderOpened, Plus, Upload } from '@element-plus/icons-vue'
import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import { marked } from 'marked'
import { useRouter } from 'vue-router'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import { formatProjectTimestamp, getSiteLabel } from '../../services/project/presentation'
import type {
  MarkupFormat,
  PublishTorrentEntry,
  PublishProject,
  SaveSeriesPublishProfileInput,
  SeriesProjectWorkspace,
  SeriesPublishProfile,
  SeriesPublishProfileSiteDrafts,
  SeriesPublishProfileSiteFieldDefaults,
} from '../../types/project'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'

const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
const SITE_FORMAT_MAP: Partial<Record<SiteId, MarkupFormat | 'auto'>> = {
  bangumi: 'html',
  miobt: 'html',
  nyaa: 'md',
  mikan: 'bbcode',
  acgrip: 'bbcode',
  dmhy: 'html',
  acgnx_a: 'html',
  acgnx_g: 'html',
}
const LEGACY_BODY_TEMPLATE_TOKEN_PATTERN = /\{\{\s*(title|seriesLabel|episodeLabel|episodeTitle|techLabel|summary|releaseTeam)\s*\}\}/i
const DEFAULT_BODY_TEMPLATE = ''

type HiddenProfileState = {
  isDefault: boolean
  videoProfiles: Array<'1080p' | '2160p'>
  subtitleProfiles: Array<'chs' | 'cht' | 'eng' | 'bilingual'>
  siteDrafts?: SeriesPublishProfileSiteDrafts
  siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
}

type DraftTorrentEntry = {
  id: string
  name: string
  path: string
  enabled: boolean
  titleOverride: string
  bodyOverride: string
}

type PublishProfileSiteFieldValue = string | number | boolean | undefined
type PublishProfileSiteFieldSchema = SiteFieldSchemaEntry
type OptionalSiteFieldCard = {
  siteId: SiteId
  siteName: string
  fields: PublishProfileSiteFieldSchema[]
  entry: Record<string, PublishProfileSiteFieldValue>
}

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const router = useRouter()
const isDark = useDark()
const { t } = useI18n()

const workspace = ref<SeriesProjectWorkspace | null>(null)
const draftConfig = ref<Config.PublishConfig | null>(null)
const availableSites = ref<SiteCatalogEntry[]>([])
const selectedProfileId = ref<number | null>(null)
const loadError = ref('')
const siteError = ref('')
const isLoading = ref(false)
const isSavingOverview = ref(false)
const isSavingProfile = ref(false)
const isImportingProfile = ref(false)
const isExportingProfile = ref(false)
const isPreparingReview = ref(false)
const isCreatingEpisode = ref(false)
const episodeDialogVisible = ref(false)
const bodyTemplateView = ref<'editor' | 'preview'>('editor')
const draftTitle = ref('')
const draftTorrentEntries = ref<DraftTorrentEntry[]>([])
const activeTorrentId = ref('')
const torrentOverrideDialogVisible = ref(false)
const editingTorrentId = ref<string | null>(null)
const bodyTemplateEditorRoot = ref<HTMLElement | null>(null)

let bodyTemplateEditor: InstanceType<typeof Editor> | null = null
let isSyncingBodyTemplateEditor = false

const torrentOverrideForm = reactive({
  bodyOverride: '',
})

const overviewForm = reactive<{
  plannedEpisodeCount?: number
}>({
  plannedEpisodeCount: undefined,
})

const episodeForm = reactive({
  episodeLabel: '',
  episodeTitle: '',
})

const profileForm = reactive({
  name: '',
  targetSites: [] as SiteId[],
  bodyTemplate: DEFAULT_BODY_TEMPLATE,
})

const hiddenProfileState = reactive<HiddenProfileState>(createHiddenProfileState())

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

async function convertHtmlToMarkdown(value: string) {
  const response = await window.globalAPI.html2markdown(JSON.stringify({ content: value } satisfies Message.Global.FileContent))
  return (JSON.parse(response) as Message.Global.FileContent).content.trim()
}

async function normalizeMarkdownSource(value: string | undefined, format?: MarkupFormat) {
  const normalizedValue = readOptionalString(value)
  if (!normalizedValue) {
    return ''
  }

  if (format === 'md') {
    return LEGACY_BODY_TEMPLATE_TOKEN_PATTERN.test(normalizedValue) ? '' : normalizedValue
  }

  if (format === 'html' || (!format && looksLikeHtml(normalizedValue))) {
    const markdown = await convertHtmlToMarkdown(normalizedValue)
    return LEGACY_BODY_TEMPLATE_TOKEN_PATTERN.test(markdown) ? '' : markdown
  }

  return LEGACY_BODY_TEMPLATE_TOKEN_PATTERN.test(normalizedValue) ? '' : normalizedValue
}

async function normalizeDraftConfigForEditor(config?: Config.PublishConfig | null) {
  if (!config) {
    return null
  }

  const nextConfig = deepClone(config)
  const sourceFormat = nextConfig.bodyTemplateFormat
  const bodyTemplate = await normalizeMarkdownSource(nextConfig.bodyTemplate, sourceFormat)
  nextConfig.bodyTemplate = bodyTemplate || undefined
  nextConfig.bodyTemplateFormat = bodyTemplate ? 'md' : undefined

  if (Array.isArray(nextConfig.torrentEntries)) {
    nextConfig.torrentEntries = await Promise.all(
      nextConfig.torrentEntries.map(async entry => ({
        ...entry,
        bodyOverride: (await normalizeMarkdownSource(entry.bodyOverride, sourceFormat)) || undefined,
      })),
    )
  }

  return nextConfig
}

async function normalizeProfileForEditor(profile: SeriesPublishProfile) {
  const bodyTemplate = await normalizeMarkdownSource(profile.bodyTemplate, profile.bodyTemplateFormat)
  return {
    ...profile,
    bodyTemplate: bodyTemplate || undefined,
    bodyTemplateFormat: bodyTemplate ? 'md' : undefined,
  } satisfies SeriesPublishProfile
}

async function normalizeWorkspaceForEditor(value: SeriesProjectWorkspace) {
  return {
    ...value,
    publishProfiles: await Promise.all(value.publishProfiles.map(profile => normalizeProfileForEditor(profile))),
  } satisfies SeriesProjectWorkspace
}

function getFileName(path: string) {
  return path.replace(/^.*[\\/]/, '')
}

function createDraftTorrentEntry(path: string, seed?: Partial<PublishTorrentEntry>): DraftTorrentEntry {
  const normalizedPath = path.trim()
  return {
    id: seed?.id?.trim() || `torrent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: seed?.name?.trim() || getFileName(normalizedPath),
    path: normalizedPath,
    enabled: seed?.enabled !== false,
    titleOverride: typeof seed?.titleOverride === 'string' ? seed.titleOverride : '',
    bodyOverride: typeof seed?.bodyOverride === 'string' ? seed.bodyOverride : '',
  }
}

function normalizeDraftTorrentEntries(config?: Config.PublishConfig | null) {
  if (!config) {
    return [] as DraftTorrentEntry[]
  }

  const entries = Array.isArray(config.torrentEntries)
    ? config.torrentEntries
        .map(entry => {
          const path = readOptionalString(entry?.path)
          return path ? createDraftTorrentEntry(path, entry) : null
        })
        .filter((entry): entry is DraftTorrentEntry => Boolean(entry))
    : []

  if (entries.length > 0) {
    return entries
  }

  const legacyPath = readOptionalString(config.torrentPath)
  if (!legacyPath) {
    return []
  }

  return [
    createDraftTorrentEntry(legacyPath, {
      id: config.activeTorrentId?.trim() || 'torrent-default',
      name: config.torrentName?.trim() || getFileName(legacyPath),
      enabled: true,
    }),
  ]
}

function createHiddenProfileState(seed?: Partial<HiddenProfileState>): HiddenProfileState {
  return {
    isDefault: Boolean(seed?.isDefault),
    videoProfiles: seed?.videoProfiles?.length ? [...seed.videoProfiles] : ['1080p'],
    subtitleProfiles: seed?.subtitleProfiles?.length ? [...seed.subtitleProfiles] : ['chs'],
    siteDrafts: deepClone(seed?.siteDrafts),
    siteFieldDefaults: deepClone(seed?.siteFieldDefaults),
  }
}

function normalizeSiteFieldString(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }

  return ''
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

function normalizeSiteFieldBoolean(value: unknown) {
  if (value === true || value === false) {
    return value
  }

  return undefined
}

function getSiteFieldDefaultValue(field: PublishProfileSiteFieldSchema): PublishProfileSiteFieldValue {
  switch (field.control) {
    case 'checkbox':
      return undefined
    case 'number':
      return undefined
    case 'text':
    case 'select':
    default:
      return ''
  }
}

function normalizeSiteFieldFormValue(value: unknown, field: PublishProfileSiteFieldSchema): PublishProfileSiteFieldValue {
  switch (field.control) {
    case 'checkbox':
      return normalizeSiteFieldBoolean(value)
    case 'number':
      return normalizeSiteFieldNumber(value)
    case 'text':
    case 'select':
    default:
      return normalizeSiteFieldString(value)
  }
}

function serializeSiteFieldValue(field: PublishProfileSiteFieldSchema, value: unknown) {
  switch (field.control) {
    case 'checkbox':
      return normalizeSiteFieldBoolean(value)
    case 'number':
      return normalizeSiteFieldNumber(value)
    case 'text':
    case 'select':
    default:
      return normalizeSiteFieldString(value) || undefined
  }
}

function sortSiteIds(siteIds: SiteId[]) {
  const uniqueSiteIds = [...new Set(siteIds.filter(Boolean))]
  return uniqueSiteIds.sort((left, right) => {
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

function getDraftTargetSites() {
  const config = draftConfig.value
  if (!config) {
    return []
  }

  if (Array.isArray(config.targetSites) && config.targetSites.length > 0) {
    return sortSiteIds(config.targetSites)
  }

  if (config.content && typeof config.content === 'object' && 'targetSites' in config.content) {
    const targetSites = config.content.targetSites
    if (Array.isArray(targetSites)) {
      return sortSiteIds(targetSites)
    }
  }

  return []
}

function getProfileById(profileId: number | null) {
  return workspace.value?.publishProfiles.find(profile => profile.id === profileId) ?? null
}

function getSiteName(siteId: SiteId) {
  return availableSites.value.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId)
}

function getSiteFormat(siteId: SiteId) {
  return SITE_FORMAT_MAP[siteId] ?? 'html'
}

function getSiteFormatLabel(siteId: SiteId) {
  const format = getSiteFormat(siteId)
  if (format === 'md') {
    return 'Markdown'
  }
  if (format === 'bbcode') {
    return 'BBCode'
  }
  if (format === 'auto') {
    return 'Auto'
  }
  return 'HTML'
}

function getSiteFieldSchemas(siteId: SiteId): PublishProfileSiteFieldSchema[] {
  return availableSites.value.find(site => site.id === siteId)?.fieldSchemas ?? []
}

function getOptionalSiteFieldSchemas(siteId: SiteId): PublishProfileSiteFieldSchema[] {
  return getSiteFieldSchemas(siteId).filter(field => field.mode === 'optional')
}

function ensureOptionalSiteFieldDefaults(siteIds: SiteId[] = profileForm.targetSites) {
  const nextSiteFieldDefaults = hiddenProfileState.siteFieldDefaults ?? {}
  if (!hiddenProfileState.siteFieldDefaults) {
    hiddenProfileState.siteFieldDefaults = nextSiteFieldDefaults
  }

  sortSiteIds([...siteIds, ...(Object.keys(nextSiteFieldDefaults) as SiteId[])]).forEach(siteId => {
    const fields = getOptionalSiteFieldSchemas(siteId)
    if (!fields.length) {
      return
    }

    const currentEntry = nextSiteFieldDefaults[siteId]
    const nextEntry =
      currentEntry && typeof currentEntry === 'object' && !Array.isArray(currentEntry)
        ? ({ ...(currentEntry as Record<string, unknown>) } as Record<string, PublishProfileSiteFieldValue>)
        : ({} as Record<string, PublishProfileSiteFieldValue>)

    fields.forEach(field => {
      const normalizedValue = normalizeSiteFieldFormValue(nextEntry[field.key], field)
      nextEntry[field.key] = normalizedValue === undefined ? getSiteFieldDefaultValue(field) : normalizedValue
    })

    nextSiteFieldDefaults[siteId] = nextEntry
  })
}

function buildSiteFieldDefaultsPayload() {
  const source = hiddenProfileState.siteFieldDefaults
  if (!source) {
    return undefined
  }

  const nextFieldDefaults: SeriesPublishProfileSiteFieldDefaults = {}
  sortSiteIds([...profileForm.targetSites, ...(Object.keys(source) as SiteId[])]).forEach(siteId => {
    const sourceEntry = source[siteId]
    if (!sourceEntry || typeof sourceEntry !== 'object' || Array.isArray(sourceEntry)) {
      return
    }

    const nextEntry: Record<string, unknown> = { ...(sourceEntry as Record<string, unknown>) }
    getOptionalSiteFieldSchemas(siteId).forEach(field => {
      const serializedValue = serializeSiteFieldValue(field, nextEntry[field.key])
      if (serializedValue === undefined) {
        delete nextEntry[field.key]
        return
      }

      nextEntry[field.key] = serializedValue
    })

    if (Object.keys(nextEntry).length > 0) {
      nextFieldDefaults[siteId] = nextEntry
    }
  })

  return Object.keys(nextFieldDefaults).length > 0 ? nextFieldDefaults : undefined
}

function loadDraftState(config?: Config.PublishConfig | null) {
  draftTorrentEntries.value = normalizeDraftTorrentEntries(config)

  const preferredActiveId = config?.activeTorrentId?.trim()
  const activeEntry =
    draftTorrentEntries.value.find(entry => entry.id === preferredActiveId) ??
    draftTorrentEntries.value.find(entry => entry.enabled) ??
    draftTorrentEntries.value[0]

  activeTorrentId.value = activeEntry?.id ?? ''
  draftTitle.value = activeEntry?.titleOverride.trim() || (config?.title ?? '')
}

function serializeDraftTorrentEntries() {
  return draftTorrentEntries.value.map(entry => ({
    id: entry.id,
    name: entry.name,
    path: entry.path,
    enabled: entry.enabled,
    titleOverride: entry.titleOverride.trim() || undefined,
    bodyOverride: entry.bodyOverride || undefined,
  }))
}

function buildDraftConfigSnapshot(seed?: Config.PublishConfig | null) {
  const baseConfig = deepClone(seed ?? draftConfig.value)
  if (!baseConfig) {
    return null
  }

  const nextConfig = deepClone(baseConfig)
  const serializedEntries = serializeDraftTorrentEntries()
  const activeEntry =
    draftTorrentEntries.value.find(entry => entry.id === activeTorrentId.value) ??
    draftTorrentEntries.value.find(entry => entry.enabled) ??
    draftTorrentEntries.value[0]
  const nextTargetSites = sortSiteIds([...profileForm.targetSites])
  const nextBodyTemplate = profileForm.bodyTemplate.trim()
  const nextSiteFieldDefaults = buildSiteFieldDefaultsPayload()

  nextConfig.title = activeEntry?.titleOverride.trim() || draftTitle.value.trim()
  nextConfig.torrentEntries = serializedEntries.length > 0 ? serializedEntries : undefined
  nextConfig.activeTorrentId = activeEntry?.id
  nextConfig.torrentPath = activeEntry?.path ?? ''
  nextConfig.torrentName = activeEntry?.name ?? ''
  nextConfig.targetSites = nextTargetSites

  if (nextConfig.content && typeof nextConfig.content === 'object' && 'targetSites' in nextConfig.content) {
    nextConfig.content.targetSites = [...nextTargetSites]
  }

  if (nextBodyTemplate) {
    nextConfig.bodyTemplate = nextBodyTemplate
    nextConfig.bodyTemplateFormat = 'md'
  } else {
    delete nextConfig.bodyTemplate
    delete nextConfig.bodyTemplateFormat
  }

  if (nextSiteFieldDefaults && Object.keys(nextSiteFieldDefaults).length > 0) {
    nextConfig.siteFieldDefaults = nextSiteFieldDefaults
    const bangumiCategory = nextSiteFieldDefaults.bangumi?.category_bangumi
    const nyaaCategory = nextSiteFieldDefaults.nyaa?.category_nyaa
    if (typeof bangumiCategory === 'string' && bangumiCategory.trim()) {
      nextConfig.category_bangumi = bangumiCategory
    }
    if (typeof nyaaCategory === 'string' && nyaaCategory.trim()) {
      nextConfig.category_nyaa = nyaaCategory
    }
  } else {
    delete nextConfig.siteFieldDefaults
  }

  return nextConfig
}

async function persistDraftSnapshot(nextConfig: Config.PublishConfig, options?: { materialize?: boolean }) {
  await window.taskAPI.saveConfig(
    JSON.stringify({
      id: props.id,
      config: nextConfig,
    } satisfies Message.Task.ModifiedConfig),
  )

  draftConfig.value = nextConfig
  loadDraftState(nextConfig)

  if (options?.materialize !== false && nextConfig.torrentPath.trim()) {
    const { result }: Message.Task.Result = JSON.parse(
      await window.taskAPI.createConfig(
        JSON.stringify({
          id: props.id,
          type: 'episode',
          config: nextConfig,
        } satisfies Message.Task.ModifiedConfig),
      ),
    )

    if (result !== 'success') {
      throw new Error(result)
    }
  }
}

async function syncDraftState(options?: { materialize?: boolean; successMessage?: string }) {
  const nextConfig = buildDraftConfigSnapshot()
  if (!nextConfig) {
    return
  }

  await persistDraftSnapshot(nextConfig, options)
  if (options?.successMessage) {
    ElMessage.success(options.successMessage)
  }
}

const activeTorrentEntry = computed(() =>
  draftTorrentEntries.value.find(entry => entry.id === activeTorrentId.value) ??
  draftTorrentEntries.value.find(entry => entry.enabled) ??
  draftTorrentEntries.value[0] ??
  null,
)

const selectedTorrentEntries = computed(() => draftTorrentEntries.value.filter(entry => entry.enabled))
const selectedTorrentCount = computed(() => selectedTorrentEntries.value.length)
const effectiveBodyTemplate = computed(() => activeTorrentEntry.value?.bodyOverride.trim() || profileForm.bodyTemplate.trim() || '')

const authenticatedSites = computed(() =>
  sortSiteIds(
    availableSites.value
      .filter(site => site.enabled && site.capabilitySet.publish.torrent && site.accountStatus === 'authenticated')
      .map(site => site.id),
  ).map(siteId => availableSites.value.find(site => site.id === siteId)!)
)

const publishProfiles = computed(() => workspace.value?.publishProfiles ?? [])
const builtEpisodeCount = computed(() => workspace.value?.episodes.length ?? 0)
const selectedSiteNames = computed(() => profileForm.targetSites.map(siteId => getSiteName(siteId)))
const optionalSiteFieldCards = computed<OptionalSiteFieldCard[]>(() =>
  profileForm.targetSites.flatMap(siteId => {
    const fields = getOptionalSiteFieldSchemas(siteId)
    if (fields.length === 0) {
      return []
    }

    const entry = (hiddenProfileState.siteFieldDefaults?.[siteId] ?? {}) as Record<string, PublishProfileSiteFieldValue>
    return [
      {
        siteId,
        siteName: getSiteName(siteId),
        fields,
        entry,
      },
    ]
  }),
)
const overviewEpisodeText = computed(() => {
  if (!overviewForm.plannedEpisodeCount) {
    return `${builtEpisodeCount.value} 集已建立`
  }

  return `${builtEpisodeCount.value} / ${overviewForm.plannedEpisodeCount} 集`
})
const selectedProfileDisplayName = computed(() => {
  const profile = getProfileById(selectedProfileId.value)
  if (profile) {
    return profile.name
  }

  return profileForm.name.trim() || '\u672a\u547d\u540d\u65b0\u914d\u7f6e'
})
const selectedProfileSummary = computed(() => {
  const profile = getProfileById(selectedProfileId.value)
  if (!profile) {
    return '\u5f53\u524d\u6b63\u5728\u7f16\u8f91\u4e00\u5957\u65b0\u914d\u7f6e\uff0c\u4fdd\u5b58\u540e\u4f1a\u52a0\u5165\u4e0a\u9762\u7684\u914d\u7f6e\u9879\u3002'
  }

  return `${(profile.targetSites ?? []).length} \u4e2a\u7ad9\u70b9 \u00b7 \u6700\u8fd1\u66f4\u65b0 ${formatProjectTimestamp(profile.updatedAt)}`
})
const renderedMarkdownPreview = computed(() => effectiveBodyTemplate.value.trim())
const renderedHtmlPreview = computed(() => {
  const markdownSource = renderedMarkdownPreview.value.trim()
  if (!markdownSource) {
    return ''
  }

  return marked.parse(markdownSource, { async: false }) as string
})

function normalizeMarkdownEditorValue(value: string | undefined) {
  return (value ?? '').replace(/\r\n/g, '\n')
}

function destroyBodyTemplateEditor() {
  bodyTemplateEditor?.destroy()
  bodyTemplateEditor = null
}

function syncBodyTemplateEditorFromState(options?: { force?: boolean }) {
  if (!bodyTemplateEditor) {
    return
  }

  const nextValue = normalizeMarkdownEditorValue(profileForm.bodyTemplate)
  const currentValue = normalizeMarkdownEditorValue(bodyTemplateEditor.getMarkdown())
  if (!options?.force && currentValue === nextValue) {
    return
  }

  isSyncingBodyTemplateEditor = true
  bodyTemplateEditor.setMarkdown(nextValue, false)
  bodyTemplateEditor.changeMode('wysiwyg', true)
  isSyncingBodyTemplateEditor = false
}

async function ensureBodyTemplateEditor() {
  if (bodyTemplateEditor || !bodyTemplateEditorRoot.value) {
    return
  }

  await nextTick()
  if (!bodyTemplateEditorRoot.value) {
    return
  }

  bodyTemplateEditor = new Editor({
    el: bodyTemplateEditorRoot.value,
    height: '540px',
    minHeight: '540px',
    initialValue: normalizeMarkdownEditorValue(profileForm.bodyTemplate),
    initialEditType: 'wysiwyg',
    previewStyle: 'tab',
    hideModeSwitch: true,
    usageStatistics: false,
    autofocus: false,
    placeholder: '在这里编写全站通用的 Markdown 正文模板。',
    theme: isDark.value ? 'dark' : undefined,
    events: {
      change: () => {
        if (!bodyTemplateEditor || isSyncingBodyTemplateEditor) {
          return
        }

        profileForm.bodyTemplate = normalizeMarkdownEditorValue(bodyTemplateEditor.getMarkdown())
      },
    },
  })

  syncBodyTemplateEditorFromState({ force: true })
}

function fillProfileForm(profile: SeriesPublishProfile | null) {
  const fallbackTargetSites = getDraftTargetSites().filter(siteId =>
    authenticatedSites.value.some(site => site.id === siteId),
  )
  const allowedSiteIds = new Set(authenticatedSites.value.map(site => site.id))
  const nextTargetSites = sortSiteIds((profile?.targetSites ?? fallbackTargetSites).filter(siteId => allowedSiteIds.has(siteId)))

  Object.assign(
    hiddenProfileState,
    createHiddenProfileState({
      isDefault: profile?.isDefault,
      videoProfiles: profile?.videoProfiles,
      subtitleProfiles: profile?.subtitleProfiles,
      siteDrafts: profile?.siteDrafts,
      siteFieldDefaults: profile?.siteFieldDefaults,
    }),
  )

  profileForm.name = profile?.name ?? ''
  profileForm.targetSites = nextTargetSites
  profileForm.bodyTemplate = profile?.bodyTemplate?.trim() || draftConfig.value?.bodyTemplate?.trim() || DEFAULT_BODY_TEMPLATE
  ensureOptionalSiteFieldDefaults(nextTargetSites)
}

async function syncDraftConfigFromProfile(profile: SeriesPublishProfile | null) {
  if (!profile) {
    return
  }

  const currentDraft = draftConfig.value ?? (await normalizeDraftConfigForEditor(await taskBridge.getPublishConfig(props.id)))
  if (!currentDraft) {
    return
  }

  const nextDraft = deepClone(currentDraft)

  nextDraft.targetSites = [...(profile.targetSites ?? [])]
  if (nextDraft.content && typeof nextDraft.content === 'object' && 'targetSites' in nextDraft.content) {
    nextDraft.content.targetSites = [...(profile.targetSites ?? [])]
  }

  if (profile.siteFieldDefaults) {
    nextDraft.siteFieldDefaults = deepClone(profile.siteFieldDefaults)
    const bangumiCategory = profile.siteFieldDefaults.bangumi?.category_bangumi
    const nyaaCategory = profile.siteFieldDefaults.nyaa?.category_nyaa
    if (typeof bangumiCategory === 'string' && bangumiCategory.trim()) {
      nextDraft.category_bangumi = bangumiCategory
    }
    if (typeof nyaaCategory === 'string' && nyaaCategory.trim()) {
      nextDraft.category_nyaa = nyaaCategory
    }
  }

  if (profile.bodyTemplate?.trim()) {
    nextDraft.bodyTemplate = profile.bodyTemplate.trim()
    nextDraft.bodyTemplateFormat = profile.bodyTemplateFormat ?? 'md'
  } else {
    delete nextDraft.bodyTemplate
    delete nextDraft.bodyTemplateFormat
  }

  const mergedDraft = buildDraftConfigSnapshot(nextDraft)
  if (!mergedDraft) {
    return
  }

  await persistDraftSnapshot(mergedDraft)
}

async function applyProfile(profileId: number | null, syncDraft = true) {
  selectedProfileId.value = profileId
  const profile = getProfileById(profileId)
  fillProfileForm(profile)
  if (syncDraft && profile) {
    await syncDraftConfigFromProfile(profile)
  }
}

async function loadWorkspace(preferredProfileId?: number | null) {
  isLoading.value = true
  loadError.value = ''
  siteError.value = ''
  try {
    const [workspaceResult, siteResult, currentDraft] = await Promise.all([
      projectBridge.getSeriesWorkspace(props.project.id),
      siteBridge.listSites(),
      taskBridge.getPublishConfig(props.id),
    ])

    const normalizedDraft = await normalizeDraftConfigForEditor(currentDraft)
    draftConfig.value = normalizedDraft
    loadDraftState(normalizedDraft)

    if (!workspaceResult.ok) {
      workspace.value = null
      loadError.value = workspaceResult.error.message
      return
    }

    workspace.value = await normalizeWorkspaceForEditor(workspaceResult.data.workspace)
    overviewForm.plannedEpisodeCount = workspace.value.plannedEpisodeCount

    if (!siteResult.ok) {
      availableSites.value = []
      siteError.value = siteResult.error.message
    } else {
      availableSites.value = siteResult.data.sites.filter(site => site.capabilitySet.publish.torrent)
    }

    const targetProfileId =
      preferredProfileId !== undefined
        ? preferredProfileId
        : selectedProfileId.value ?? workspace.value.publishProfiles[0]?.id ?? null

    await applyProfile(targetProfileId, false)
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

function beginCreateProfile() {
  selectedProfileId.value = null
  Object.assign(hiddenProfileState, createHiddenProfileState())
  profileForm.name = ''
  profileForm.bodyTemplate = draftConfig.value?.bodyTemplate?.trim() || profileForm.bodyTemplate || DEFAULT_BODY_TEMPLATE
  profileForm.targetSites = getDraftTargetSites().filter(siteId => authenticatedSites.value.some(site => site.id === siteId))
  ensureOptionalSiteFieldDefaults(profileForm.targetSites)
}

async function saveTorrentTitle(entryId: string) {
  const entry = draftTorrentEntries.value.find(item => item.id === entryId)
  if (!entry) {
    return
  }

  if (activeTorrentId.value === entryId && entry.titleOverride.trim()) {
    draftTitle.value = entry.titleOverride.trim()
  }

  await syncDraftState()
}

async function appendTorrentEntries(paths: string[]) {
  const normalizedPaths = [...new Set(paths.map(readOptionalString).filter(Boolean))]
  if (normalizedPaths.length === 0) {
    return
  }

  const existingEntriesByPath = new Map(draftTorrentEntries.value.map(entry => [entry.path, entry] as const))
  const addedEntries: DraftTorrentEntry[] = []
  let lastMatchedEntry: DraftTorrentEntry | null = null

  for (const path of normalizedPaths) {
    const existingEntry = existingEntriesByPath.get(path)
    if (existingEntry) {
      lastMatchedEntry = existingEntry
      continue
    }

    const nextEntry = createDraftTorrentEntry(path)
    existingEntriesByPath.set(path, nextEntry)
    addedEntries.push(nextEntry)
  }

  if (addedEntries.length === 0) {
    if (lastMatchedEntry) {
      activeTorrentId.value = lastMatchedEntry.id
      await syncDraftState({ successMessage: `所选种子已存在，已切换到：${lastMatchedEntry.name}` })
    }
    return
  }

  draftTorrentEntries.value = [...draftTorrentEntries.value, ...addedEntries]
  activeTorrentId.value = addedEntries[addedEntries.length - 1].id

  const skippedCount = normalizedPaths.length - addedEntries.length
  const successMessage =
    addedEntries.length === 1 && skippedCount === 0
      ? `已添加种子：${addedEntries[0].name}`
      : `已添加 ${addedEntries.length} 个种子${skippedCount > 0 ? `，跳过 ${skippedCount} 个重复项` : ''}`

  await syncDraftState({ successMessage })
}

async function addTorrentEntry() {
  const { paths }: Message.Global.Paths = JSON.parse(
    await window.globalAPI.getFilePaths(JSON.stringify({ type: 'torrent' } satisfies Message.Global.FileType)),
  )
  await appendTorrentEntries(paths)
}

async function setActiveTorrent(entryId: string) {
  if (activeTorrentId.value === entryId) {
    return
  }

  const entry = draftTorrentEntries.value.find(item => item.id === entryId)
  activeTorrentId.value = entryId
  if (entry?.titleOverride.trim()) {
    draftTitle.value = entry.titleOverride.trim()
  }
  await syncDraftState({ successMessage: '已切换当前发布种子' })
}

async function toggleTorrentSelection(entryId: string) {
  const entry = draftTorrentEntries.value.find(item => item.id === entryId)
  if (!entry) {
    return
  }

  entry.enabled = !entry.enabled
  if (!draftTorrentEntries.value.some(item => item.enabled)) {
    entry.enabled = true
    ElMessage.warning('至少保留一个已选中的种子')
    return
  }

  if (!draftTorrentEntries.value.some(item => item.id === activeTorrentId.value && item.enabled)) {
    activeTorrentId.value =
      draftTorrentEntries.value.find(item => item.enabled)?.id ?? draftTorrentEntries.value[0]?.id ?? ''
  }

  await syncDraftState()
}

async function removeTorrentEntry(entryId: string) {
  const entry = draftTorrentEntries.value.find(item => item.id === entryId)
  if (!entry) {
    return
  }

  try {
    await ElMessageBox.confirm(`移除种子“${entry.name}”？`, '移除种子', {
      confirmButtonText: '移除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  draftTorrentEntries.value = draftTorrentEntries.value.filter(item => item.id !== entryId)
  if (activeTorrentId.value === entryId) {
    activeTorrentId.value =
      draftTorrentEntries.value.find(item => item.enabled)?.id ?? draftTorrentEntries.value[0]?.id ?? ''
  }

  await syncDraftState({ successMessage: `已移除种子：${entry.name}` })
}

function openTorrentOverrideDialog(entryId: string) {
  const entry = draftTorrentEntries.value.find(item => item.id === entryId)
  if (!entry) {
    return
  }

  editingTorrentId.value = entry.id
  torrentOverrideForm.bodyOverride = entry.bodyOverride
  torrentOverrideDialogVisible.value = true
}

async function saveTorrentOverride() {
  const entry = draftTorrentEntries.value.find(item => item.id === editingTorrentId.value)
  if (!entry) {
    torrentOverrideDialogVisible.value = false
    return
  }

  entry.bodyOverride = torrentOverrideForm.bodyOverride
  torrentOverrideDialogVisible.value = false
  await syncDraftState({ successMessage: `已更新种子内容：${entry.name}` })
}

async function clearTorrentOverride() {
  torrentOverrideForm.bodyOverride = ''
  await saveTorrentOverride()
}

function isSiteSelected(siteId: SiteId) {
  return profileForm.targetSites.includes(siteId)
}

function toggleSite(siteId: SiteId) {
  profileForm.targetSites = isSiteSelected(siteId)
    ? profileForm.targetSites.filter(current => current !== siteId)
    : sortSiteIds([...profileForm.targetSites, siteId])
  ensureOptionalSiteFieldDefaults(profileForm.targetSites)
}

async function goToConfirmStage() {
  if (selectedTorrentEntries.value.length === 0) {
    ElMessage.warning('请先至少保留一个已选中的种子')
    return
  }

  if (profileForm.targetSites.length === 0) {
    ElMessage.warning('请先选择至少一个发布站点')
    return
  }

  const missingTitleEntries = selectedTorrentEntries.value.filter(entry => {
    const resolvedTitle = entry.titleOverride.trim() || (entry.id === activeTorrentId.value ? draftTitle.value.trim() : '')
    return !resolvedTitle
  })

  if (missingTitleEntries.length > 0) {
    ElMessage.warning(`还有 ${missingTitleEntries.length} 个种子没有填写发布标题`)
    return
  }

  isPreparingReview.value = true
  try {
    await syncDraftState()
    await router.push({
      name: 'check',
      params: { id: props.id },
    })
  } finally {
    isPreparingReview.value = false
  }
}

async function saveOverview() {
  isSavingOverview.value = true
  try {
    const result = await projectBridge.saveSeriesWorkspaceSettings({
      projectId: props.project.id,
      plannedEpisodeCount: overviewForm.plannedEpisodeCount,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    ElMessage.success('总集数已保存')
  } finally {
    isSavingOverview.value = false
  }
}

function buildProfilePayload(): SaveSeriesPublishProfileInput {
  return {
    projectId: props.project.id,
    profileId: selectedProfileId.value ?? undefined,
    name: profileForm.name.trim(),
    isDefault: hiddenProfileState.isDefault,
    videoProfiles: [...hiddenProfileState.videoProfiles],
    subtitleProfiles: [...hiddenProfileState.subtitleProfiles],
    targetSites: [...profileForm.targetSites],
    bodyTemplate: profileForm.bodyTemplate.trim() || undefined,
    bodyTemplateFormat: 'md',
    siteDrafts: deepClone(hiddenProfileState.siteDrafts),
    siteFieldDefaults: buildSiteFieldDefaultsPayload(),
  }
}

function buildSavedProfilePayload(profile: SeriesPublishProfile, name: string): SaveSeriesPublishProfileInput {
  return {
    projectId: props.project.id,
    profileId: profile.id,
    name,
    isDefault: profile.isDefault,
    videoProfiles: [...(profile.videoProfiles ?? [])],
    subtitleProfiles: [...(profile.subtitleProfiles ?? [])],
    targetSites: [...(profile.targetSites ?? [])],
    bodyTemplate: profile.bodyTemplate?.trim() || undefined,
    bodyTemplateFormat: profile.bodyTemplateFormat ?? 'md',
    siteDrafts: deepClone(profile.siteDrafts),
    siteFieldDefaults: deepClone(profile.siteFieldDefaults),
  }
}

async function promptProfileName(initialValue = '', title = '\u91cd\u547d\u540d\u53d1\u5e03\u914d\u7f6e') {
  try {
    const response = await ElMessageBox.prompt('\u8f93\u5165\u4e00\u4e2a\u4fbf\u4e8e\u8bc6\u522b\u7684\u914d\u7f6e\u540d\u79f0', title, {
      inputValue: initialValue,
      inputPlaceholder:
        '\u4f8b\u5982\uff1a\u5e38\u89c4\u53d1\u5e03 / \u6d77\u5916\u540c\u6b65 / \u6e2f\u6fb3\u53f0\u7248',
      confirmButtonText: '\u786e\u5b9a',
      cancelButtonText: '\u53d6\u6d88',
      inputValidator: value => (value.trim() ? true : '\u8bf7\u8f93\u5165\u914d\u7f6e\u540d\u79f0'),
    })

    return (typeof response === 'object' && response && 'value' in response ? String(response.value) : '').trim()
  } catch {
    return null
  }
}

async function renameDraftProfile() {
  const nextName = await promptProfileName(profileForm.name, '\u8bbe\u7f6e\u914d\u7f6e\u540d\u79f0')
  if (!nextName) {
    return
  }

  profileForm.name = nextName
}

async function renameProfile(profile: SeriesPublishProfile) {
  const nextName = await promptProfileName(profile.name, `\u91cd\u547d\u540d\u300c${profile.name}\u300d`)
  if (!nextName || nextName === profile.name) {
    return
  }

  const result = await projectBridge.saveSeriesPublishProfile(buildSavedProfilePayload(profile, nextName))
  if (!result.ok) {
    ElMessage.error(result.error.message)
    return
  }

  workspace.value = result.data.workspace
  overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
  if (selectedProfileId.value === profile.id) {
    profileForm.name = nextName
  }
  ElMessage.success(`\u5df2\u91cd\u547d\u540d\u914d\u7f6e\uff1a${nextName}`)
}

async function saveProfile() {
  if (!profileForm.name.trim()) {
    const nextName = await promptProfileName(
      '',
      selectedProfileId.value ? '\u91cd\u547d\u540d\u53d1\u5e03\u914d\u7f6e' : '\u4fdd\u5b58\u53d1\u5e03\u914d\u7f6e',
    )
    if (!nextName) {
      return
    }

    profileForm.name = nextName
  }

  if (!profileForm.name.trim()) {
    ElMessage.error('\u8bf7\u5148\u586b\u5199\u914d\u7f6e\u540d\u79f0')
    return
  }

  isSavingProfile.value = true
  try {
    const result = await projectBridge.saveSeriesPublishProfile(buildProfilePayload())
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    await applyProfile(result.data.profile.id, false)
    await syncDraftConfigFromProfile(result.data.profile)
    ElMessage.success(`\u5df2\u4fdd\u5b58\u914d\u7f6e\uff1a${result.data.profile.name}`)
  } finally {
    isSavingProfile.value = false
  }
}

async function importProfile() {
  isImportingProfile.value = true
  try {
    const result = await projectBridge.importSeriesPublishProfile({
      projectId: props.project.id,
    })

    if (!result.ok) {
      if (result.error.code !== 'SERIES_PUBLISH_PROFILE_IMPORT_CANCELLED') {
        ElMessage.error(result.error.message)
      }
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    await applyProfile(result.data.profile.id, false)
    await syncDraftConfigFromProfile(result.data.profile)
    ElMessage.success(`已导入配置：${result.data.profile.name}`)
  } finally {
    isImportingProfile.value = false
  }
}

async function exportProfile() {
  if (!selectedProfileId.value) {
    ElMessage.warning('请先选择一个配置项')
    return
  }

  isExportingProfile.value = true
  try {
    const result = await projectBridge.exportSeriesPublishProfile({
      projectId: props.project.id,
      profileId: selectedProfileId.value,
    })

    if (!result.ok) {
      if (result.error.code !== 'SERIES_PUBLISH_PROFILE_EXPORT_CANCELLED') {
        ElMessage.error(result.error.message)
      }
      return
    }

    ElMessage.success(result.data.path ? `已导出到 ${result.data.path}` : '配置已导出')
  } finally {
    isExportingProfile.value = false
  }
}

async function createEpisode() {
  if (!episodeForm.episodeLabel.trim()) {
    ElMessage.error('请先填写集数')
    return
  }

  isCreatingEpisode.value = true
  try {
    const result = await projectBridge.createSeriesEpisode({
      projectId: props.project.id,
      episodeLabel: episodeForm.episodeLabel.trim(),
      episodeTitle: episodeForm.episodeTitle.trim() || undefined,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    episodeDialogVisible.value = false
    episodeForm.episodeLabel = ''
    episodeForm.episodeTitle = ''
    ElMessage.success(`已建立剧集：${result.data.episode.episodeLabel}`)
  } finally {
    isCreatingEpisode.value = false
  }
}

function openProjectFolder() {
  window.globalAPI.openFolder(JSON.stringify({ path: props.project.workingDirectory } satisfies Message.Global.Path))
}

function openAccountsPage() {
  void router.push({ name: 'account' })
}

watch(
  () => profileForm.bodyTemplate,
  () => {
    syncBodyTemplateEditorFromState()
  },
)

watch(bodyTemplateView, async view => {
  if (view !== 'editor') {
    return
  }

  await ensureBodyTemplateEditor()
  syncBodyTemplateEditorFromState({ force: true })
})

watch(isDark, async () => {
  const currentMarkdown = bodyTemplateEditor
    ? normalizeMarkdownEditorValue(bodyTemplateEditor.getMarkdown())
    : normalizeMarkdownEditorValue(profileForm.bodyTemplate)

  destroyBodyTemplateEditor()
  await ensureBodyTemplateEditor()

  if (currentMarkdown !== normalizeMarkdownEditorValue(profileForm.bodyTemplate)) {
    profileForm.bodyTemplate = currentMarkdown
  }
  syncBodyTemplateEditorFromState({ force: true })
})

onMounted(async () => {
  await ensureBodyTemplateEditor()
  await loadWorkspace()
  syncBodyTemplateEditorFromState({ force: true })
})

onBeforeUnmount(() => {
  destroyBodyTemplateEditor()
})
</script>

<template>
  <div class="series-editor">
    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" />

    <template v-else>
      <section class="series-editor__overview" v-loading="isLoading">
        <div class="series-editor__overview-main">
          <div class="series-editor__overview-item">
            <div class="series-editor__label">当前项目</div>
            <div class="series-editor__value">{{ props.project.name }}</div>
            <button class="series-editor__link" type="button" @click="openProjectFolder">
              <el-icon><FolderOpened /></el-icon>
              <span>打开项目目录</span>
            </button>
          </div>

          <div class="series-editor__overview-item">
            <div class="series-editor__label">已建集数 / 总集数</div>
            <div class="series-editor__value">{{ overviewEpisodeText }}</div>
            <div class="series-editor__inline-form">
              <el-input-number
                v-model="overviewForm.plannedEpisodeCount"
                :min="1"
                :step="1"
                controls-position="right"
                placeholder="总集数"
              />
              <el-button :loading="isSavingOverview" @click="saveOverview">保存总集数</el-button>
              <el-button plain @click="episodeDialogVisible = true">新增剧集</el-button>
            </div>
          </div>

          <div class="series-editor__overview-item">
            <div class="series-editor__label">同步站点</div>
            <div class="series-editor__value">{{ profileForm.targetSites.length }} 个站点</div>
            <div class="series-editor__chip-row">
              <el-tag v-for="siteName in selectedSiteNames" :key="siteName" effect="plain" type="info">
                {{ siteName }}
              </el-tag>
              <span v-if="selectedSiteNames.length === 0" class="series-editor__muted">还没有选择发布站点</span>
            </div>
          </div>
        </div>

        <div class="series-editor__overview-side">
          <div class="series-editor__meta-line">
            项目更新时间：{{ formatProjectTimestamp(workspace?.updatedAt ?? props.project.updatedAt) }}
          </div>
          <div class="series-editor__meta-line">已保存配置：{{ publishProfiles.length }}</div>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">发布配置</h3>
            <p class="series-editor__text">选择或新建一套发布配置，然后继续调整正文模板和发布站点。</p>
          </div>
          <div class="series-editor__actions">
            <el-button plain :icon="Upload" :loading="isImportingProfile" @click="importProfile">导入配置</el-button>
            <el-button plain :icon="Download" :loading="isExportingProfile" @click="exportProfile">导出配置</el-button>
            <el-button type="primary" :icon="Plus" @click="beginCreateProfile">新建配置</el-button>
          </div>
        </div>

        <div class="series-editor__profile-strip">
          <div
            v-if="selectedProfileId === null"
            class="series-editor__profile-option"
            :class="{ 'is-active': true, 'is-draft': true }"
          >
            <button type="button" class="series-editor__profile-option-main" @click="selectedProfileId = null">
              <span class="series-editor__profile-option-name">{{ profileForm.name.trim() || '未命名新配置' }}</span>
              <span class="series-editor__profile-option-badge">新建</span>
            </button>
            <button
              type="button"
              class="series-editor__profile-option-icon"
              aria-label="重命名当前新配置"
              @click.stop="renameDraftProfile"
            >
              <el-icon><EditPen /></el-icon>
            </button>
          </div>

          <div
            v-for="profile in publishProfiles"
            :key="`compact-${profile.id}`"
            class="series-editor__profile-option"
            :class="{ 'is-active': selectedProfileId === profile.id }"
          >
            <button type="button" class="series-editor__profile-option-main" @click="applyProfile(profile.id)">
              <span class="series-editor__profile-option-name">{{ profile.name }}</span>
            </button>
            <button
              type="button"
              class="series-editor__profile-option-icon"
              :aria-label="`重命名配置 ${profile.name}`"
              @click.stop="renameProfile(profile)"
            >
              <el-icon><EditPen /></el-icon>
            </button>
          </div>

          <div v-if="publishProfiles.length === 0" class="series-editor__empty-card">
            当前还没有发布配置，先新建一套即可。
          </div>
        </div>

        <div class="series-editor__profile-footer">
          <div class="series-editor__profile-selection">
            <span class="series-editor__profile-selection-name">{{ selectedProfileDisplayName }}</span>
            <span class="series-editor__profile-selection-meta">{{ selectedProfileSummary }}</span>
          </div>
          <div class="series-editor__profile-footer-actions">
            <el-button type="primary" :loading="isSavingProfile" @click="saveProfile">保存当前配置</el-button>
          </div>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">发布站点</h3>
            <p class="series-editor__text">后续会按已选站点展开各自的可选字段，所以先在这里勾选本次配置要覆盖的目标站点。</p>
          </div>
          <div class="series-editor__actions">
            <el-button plain @click="openAccountsPage">去账号页检查登录状态</el-button>
          </div>
        </div>

        <el-alert v-if="siteError" type="warning" :closable="false" show-icon :title="siteError" />

        <div v-if="authenticatedSites.length" class="series-editor__site-button-grid">
          <button
            v-for="site in authenticatedSites"
            :key="`site-button-${site.id}`"
            type="button"
            class="series-editor__site-button"
            :class="{ 'is-active': isSiteSelected(site.id) }"
            @click="toggleSite(site.id)"
          >
            <span class="series-editor__site-button-name">{{ site.name }}</span>
            <span class="series-editor__site-button-meta">{{ getSiteFormatLabel(site.id) }}</span>
          </button>
        </div>

        <div v-if="authenticatedSites.length" class="series-editor__muted">
          当前已选站点：{{ selectedSiteNames.length > 0 ? selectedSiteNames.join(' / ') : '还没有选择发布站点' }}
        </div>
        <div v-else class="series-editor__empty-card">当前没有已登录且有效的站点，请先去账号页面完成登录校验。</div>
      </section>

      <section v-if="optionalSiteFieldCards.length" class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">站点选填项</h3>
            <p class="series-editor__text">这一栏固定放在正文模板上方，只会在当前配置选中了带选填字段的站点时显示，并且只展示这些站点各自已接入的选填项。</p>
          </div>
        </div>

        <div class="series-editor__site-grid series-editor__site-grid--fields">
          <article v-for="card in optionalSiteFieldCards" :key="`site-field-${card.siteId}`" class="series-editor__site-card">
            <div class="series-editor__site-card-head">
              <div class="series-editor__site-name">{{ card.siteName }}</div>
              <el-tag effect="plain" size="small">{{ card.fields.length }} 项选填</el-tag>
            </div>
            <div class="series-editor__site-card-text">这里写的是 {{ card.siteName }} 的默认选填值，后续进入发布确认页时会自动带出。</div>

            <div v-for="field in card.fields" :key="field.key" class="series-editor__field">
              <div class="series-editor__field-head">
                <span class="series-editor__label">{{ t(field.labelKey) }}</span>
              </div>

              <el-select v-if="field.control === 'select'" v-model="card.entry[field.key]" clearable>
                <el-option
                  v-for="option in field.options ?? []"
                  :key="option.value"
                  :label="option.labelKey ? t(option.labelKey) : option.label"
                  :value="option.value"
                />
              </el-select>

              <el-switch v-else-if="field.control === 'checkbox'" v-model="card.entry[field.key]" />

              <el-input-number
                v-else-if="field.control === 'number'"
                v-model="card.entry[field.key]"
                :controls="false"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
              />

              <el-input
                v-else-if="field.key === 'trackersText'"
                v-model="card.entry[field.key]"
                type="textarea"
                :rows="4"
                resize="vertical"
                :placeholder="field.placeholderKey ? t(field.placeholderKey) : undefined"
              />

              <el-input
                v-else
                v-model="card.entry[field.key]"
                clearable
                :placeholder="field.placeholderKey ? t(field.placeholderKey) : undefined"
              />

              <span class="series-editor__field-help">{{ t(field.helpKey) }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">正文模板</h3>
            <p class="series-editor__text">源稿模式直接使用富文本 Markdown 编辑器，保存后仍会按原链路转换为 HTML 和 BBCode。</p>
          </div>
          <div class="series-editor__actions">
            <el-button plain @click="addTorrentEntry">批量添加种子</el-button>
          </div>
        </div>

        <div class="series-editor__field-grid">
          <div class="series-editor__field series-editor__field--summary">
            <span class="series-editor__label">种子列表</span>
            <div class="series-editor__muted">
              已导入 {{ draftTorrentEntries.length }} 个，已选 {{ selectedTorrentCount }} 个。支持一次选择多个 `.torrent` 文件；左键切换当前种子，可直接在卡片顶部编辑标题，右键继续编辑单个种子的正文。
            </div>
            <div class="series-editor__torrent-strip">
              <div
                v-for="torrent in draftTorrentEntries"
                :key="torrent.id"
                class="series-editor__torrent-chip"
                :class="{
                  'is-active': activeTorrentId === torrent.id,
                  'is-disabled': !torrent.enabled,
                  'has-override': Boolean(torrent.bodyOverride.trim()),
                }"
                @click="void setActiveTorrent(torrent.id)"
                @contextmenu.prevent="openTorrentOverrideDialog(torrent.id)"
              >
                <span class="series-editor__torrent-check" @click.stop>
                  <el-checkbox
                    :model-value="torrent.enabled"
                    @update:model-value="() => void toggleTorrentSelection(torrent.id)"
                  />
                </span>
                <div class="series-editor__torrent-copy">
                  <el-input
                    v-model="torrent.titleOverride"
                    class="series-editor__torrent-title-input"
                    type="textarea"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    resize="none"
                    :placeholder="torrent.name"
                    @blur="void saveTorrentTitle(torrent.id)"
                  />
                  <div class="series-editor__torrent-path">{{ torrent.path }}</div>
                </div>
                <div class="series-editor__torrent-tags">
                  <el-tag v-if="activeTorrentId === torrent.id" effect="plain" type="success" size="small">当前</el-tag>
                  <el-tag v-if="torrent.bodyOverride.trim()" effect="plain" size="small">
                    正文覆盖
                  </el-tag>
                </div>
                <el-button link type="danger" @click.stop="void removeTorrentEntry(torrent.id)">移除</el-button>
              </div>

              <div v-if="draftTorrentEntries.length === 0" class="series-editor__empty-inline">
                还没有导入种子，先批量选择一个或多个 `.torrent` 文件。
              </div>
            </div>
          </div>
        </div>

        <div class="series-editor__template-panel">
          <div class="series-editor__template-head">
            <div class="series-editor__template-toolbar">
              <div class="series-editor__label">{{ bodyTemplateView === 'editor' ? 'Markdown 正文模板' : '渲染预览' }}</div>
              <el-button-group>
                <el-button :type="bodyTemplateView === 'editor' ? 'primary' : 'default'" @click="bodyTemplateView = 'editor'">
                  源稿
                </el-button>
                <el-button
                  :type="bodyTemplateView === 'preview' ? 'primary' : 'default'"
                  @click="bodyTemplateView = 'preview'"
                >
                  预览
                </el-button>
              </el-button-group>
            </div>
            <div class="series-editor__editor-hint">
              {{
                bodyTemplateView === 'editor'
                  ? '这里直接编辑 Markdown 源稿，但输入体验改成富文本；底层仍会回写 Markdown。'
                  : '这里展示 Markdown 渲染后的完整效果。实际发布时会按站点要求继续转换格式。'
              }}
            </div>
          </div>

          <div v-show="bodyTemplateView === 'editor'" class="series-editor__template-body">
            <div ref="bodyTemplateEditorRoot" class="series-editor__wysiwyg-host"></div>
          </div>

          <article v-show="bodyTemplateView === 'preview'" class="series-editor__template-body">
            <div v-if="renderedHtmlPreview" class="series-editor__html-preview series-editor__html-preview--expanded" v-html="renderedHtmlPreview"></div>
            <div v-else class="series-editor__muted">模板为空时，这里不会生成预览。</div>
          </article>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">确认发布</h3>
            <p class="series-editor__text">进入确认页前会先保存当前草稿，再统一检查标题、正文和目标站点。</p>
          </div>
          <div class="series-editor__actions">
            <el-button type="primary" :loading="isPreparingReview" @click="goToConfirmStage">确认并检查</el-button>
          </div>
        </div>
      </section>
    </template>

    <el-dialog v-model="episodeDialogVisible" title="新增剧集" width="420px">
      <div class="series-editor__dialog-grid">
        <label class="series-editor__field">
          <span class="series-editor__label">集数</span>
          <el-input v-model="episodeForm.episodeLabel" placeholder="例如 01 / 02 / SP1" />
        </label>
        <label class="series-editor__field">
          <span class="series-editor__label">分集标题</span>
          <el-input v-model="episodeForm.episodeTitle" placeholder="可选" />
        </label>
      </div>
      <template #footer>
        <el-button @click="episodeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="isCreatingEpisode" @click="createEpisode">建立剧集</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="torrentOverrideDialogVisible" title="单个种子正文覆盖" width="820px">
      <div class="series-editor__dialog-grid">
        <label class="series-editor__field">
          <span class="series-editor__label">正文覆盖（Markdown）</span>
          <el-input
            v-model="torrentOverrideForm.bodyOverride"
            type="textarea"
            :rows="16"
            resize="none"
            placeholder="留空则沿用当前配置模板的 Markdown 正文。"
          />
        </label>
      </div>
      <template #footer>
        <el-button @click="torrentOverrideDialogVisible = false">取消</el-button>
        <el-button plain @click="clearTorrentOverride">清空单独覆盖</el-button>
        <el-button type="primary" @click="saveTorrentOverride">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template><style scoped>
.series-editor {
  display: grid;
  gap: 18px;
}

.series-editor__overview,
.series-editor__section,
.series-editor__template-panel,
.series-editor__site-preview,
.series-editor__site-card,
.series-editor__profile-card,
.series-editor__empty-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}

.series-editor__overview,
.series-editor__section {
  padding: 18px;
}

.series-editor__overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
}

.series-editor__overview-main {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.series-editor__overview-item,
.series-editor__field-grid,
.series-editor__preview-stack,
.series-editor__dialog-grid,
.series-editor__field,
.series-editor__site-preview-list,
.series-editor__torrent-copy {
  display: grid;
  gap: 10px;
}

.series-editor__overview-item {
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 92%, #eff3f8);
}

.series-editor__overview-side {
  display: grid;
  gap: 8px;
  min-width: 220px;
}

.series-editor__meta-line,
.series-editor__text,
.series-editor__site-card-text,
.series-editor__site-note,
.series-editor__muted,
.series-editor__profile-meta,
.series-editor__field-help {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.series-editor__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: -0.03em;
}

.series-editor__label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.series-editor__value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.series-editor__link {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.series-editor__inline-form,
.series-editor__actions,
.series-editor__profile-footer,
.series-editor__profile-footer-actions,
.series-editor__config-bar,
.series-editor__config-bar-actions,
.series-editor__chip-row,
.series-editor__site-card-head,
.series-editor__field-head,
.series-editor__site-foot,
.series-editor__section-head,
.series-editor__site-preview-head,
.series-editor__preview-head,
.series-editor__torrent-tags {
  display: flex;
  gap: 10px;
  align-items: center;
}

.series-editor__inline-form,
.series-editor__profile-footer,
.series-editor__config-bar {
  flex-wrap: wrap;
}

.series-editor__chip-row {
  flex-wrap: wrap;
}

.series-editor__section {
  display: grid;
  gap: 16px;
}

.series-editor__section-head {
  justify-content: space-between;
  align-items: flex-start;
}

.series-editor__profile-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-editor__profile-card {
  display: none;
  min-width: 220px;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, transform 160ms ease;
}

.series-editor__profile-strip > .series-editor__empty-card {
  display: none;
}

.series-editor__profile-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  transform: translateY(-1px);
}

.series-editor__profile-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 92%, #eef2f7);
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.series-editor__profile-option.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  transform: translateY(-1px);
}

.series-editor__profile-option-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.series-editor__profile-option-name,
.series-editor__profile-selection-name,
.series-editor__profile-name,
.series-editor__site-name {
  font-size: 16px;
  font-weight: 700;
}

.series-editor__profile-option-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-editor__profile-option-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-panel));
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.series-editor__profile-option-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.series-editor__profile-option-icon:hover {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  color: var(--accent);
}

.series-editor__profile-meta {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
}

.series-editor__profile-footer {
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 92%, #eef2f7);
}

.series-editor__profile-selection {
  display: grid;
  gap: 4px;
}

.series-editor__profile-selection-meta {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.series-editor__config-bar {
  display: none;
  justify-content: space-between;
}

.series-editor__config-bar .series-editor__field {
  flex: 1 1 320px;
}

.series-editor__field-grid {
  grid-template-columns: minmax(0, 1fr);
}

.series-editor__template-panel,
.series-editor__site-card,
.series-editor__site-preview,
.series-editor__empty-card {
  padding: 16px;
}

.series-editor__template-panel,
.series-editor__template-head,
.series-editor__template-body {
  display: grid;
  gap: 12px;
}

.series-editor__template-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.series-editor__editor-hint {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.series-editor__torrent-strip {
  display: grid;
  gap: 8px;
}

.series-editor__torrent-chip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-panel) 94%, #eef2f7);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.series-editor__torrent-chip:hover {
  transform: translateY(-1px);
}

.series-editor__torrent-chip.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
}

.series-editor__torrent-chip.has-override {
  border-style: dashed;
}

.series-editor__torrent-chip.is-disabled {
  opacity: 0.62;
}

.series-editor__torrent-check {
  padding-top: 2px;
}

.series-editor__torrent-copy {
  gap: 6px;
  min-width: 0;
}

.series-editor__torrent-title-input :deep(.el-textarea__inner) {
  min-height: 0 !important;
  padding: 8px 10px;
  font-size: 14px;
  line-height: 1.45;
  resize: none;
}

.series-editor__torrent-path {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.series-editor__torrent-tags {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.series-editor__empty-inline {
  padding: 14px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}

.series-editor__wysiwyg-host {
  min-height: 540px;
}

.series-editor__template-body :deep(.toastui-editor-defaultUI) {
  border-color: var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.series-editor__template-body :deep(.toastui-editor-defaultUI-toolbar) {
  background: color-mix(in srgb, var(--bg-panel) 94%, #eef2f7);
  border-bottom-color: var(--border-soft);
}

.series-editor__template-body :deep(.toastui-editor-toolbar-icons) {
  opacity: 0.88;
}

.series-editor__template-body :deep(.toastui-editor-main) {
  min-height: 540px;
}

.series-editor__template-body :deep(.toastui-editor-md-container),
.series-editor__template-body :deep(.toastui-editor-ww-container) {
  background: var(--bg-panel);
}

.series-editor__template-body :deep(.toastui-editor-contents),
.series-editor__template-body :deep(.ProseMirror) {
  font-size: 14px;
  line-height: 1.8;
}

.series-editor__template-body :deep(.toastui-editor-contents p),
.series-editor__template-body :deep(.ProseMirror p) {
  margin: 0 0 0.9em;
}

.series-editor__template-body :deep(.toastui-editor-md-preview),
.series-editor__template-body :deep(.toastui-editor-md-mode),
.series-editor__template-body :deep(.toastui-editor-ww-mode) {
  border-color: var(--border-soft);
}

.series-editor__html-preview {
  min-height: 320px;
  max-height: 320px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 90%, #eef2f7);
  overflow: auto;
}

.series-editor__html-preview--expanded {
  min-height: 540px;
  max-height: 640px;
}

.series-editor__preview-status {
  min-height: 20px;
}

.series-editor__site-code {
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 88%, #eef2f7);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.series-editor__site-preview-list {
  max-height: 320px;
  overflow: auto;
  padding-right: 4px;
}

.series-editor__site-button-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.series-editor__site-button {
  display: grid;
  gap: 6px;
  justify-items: center;
  min-height: 88px;
  padding: 14px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 94%, #eef2f7);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.series-editor__site-button:hover {
  transform: translateY(-1px);
}

.series-editor__site-button.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
}

.series-editor__site-button-name {
  font-size: 15px;
  font-weight: 700;
}

.series-editor__site-button-meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.series-editor__site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.series-editor__site-grid--fields {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.series-editor__site-card {
  display: grid;
  gap: 12px;
}

.series-editor__field-head {
  justify-content: space-between;
}

.series-editor__field :deep(.el-input-number) {
  width: 100%;
}

.series-editor__site-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
}

.series-editor__site-card-head {
  justify-content: space-between;
  align-items: flex-start;
}

.series-editor__site-foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.series-editor__empty-card {
  color: var(--text-secondary);
}

@media (max-width: 1120px) {
  .series-editor__overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-editor__overview-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-editor__field-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .series-editor__section-head,
  .series-editor__actions,
  .series-editor__profile-footer,
  .series-editor__config-bar,
  .series-editor__inline-form,
  .series-editor__template-toolbar,
  .series-editor__site-card-head,
  .series-editor__field-head,
  .series-editor__site-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .series-editor__torrent-chip {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .series-editor__torrent-tags {
    justify-content: flex-start;
  }
}
</style>





