<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { normalizeLegacyAccountStatus } from '../../../../shared/utils/legacy-account-status'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { taskBridge } from '../../services/bridge/task'
import { siteBridge } from '../../services/bridge/site'
import { getLatestPublishResultMap, getPublishStateLabel, getSiteLabel } from '../../services/project/presentation'
import type { PublishResult, SitePublishDraft } from '../../types/publish'
import type { PublishTorrentEntry } from '../../types/project'
import type { SiteCatalogEntry, SiteId, SitePublishValidationPayload } from '../../types/site'
import { useProjectContext } from '../project-detail/project-context'

interface SharedPublishDraftForm {
  title: string
  description: string
  torrentPath: string
  nfoPath: string
  anonymous: boolean
}

interface SitePublishDraftForm {
  title: string
  description: string
  torrentPath: string
  trackersText: string
  smallDescription: string
  url: string
  technicalInfo: string
  ptGen: string
  mediaInfo: string
  bdInfo: string
  price: string
  tagIds: number[]
  posState: string
  posStateUntil: string
  pickType: string
  anonymous: boolean
  personalRelease: boolean
  internal: boolean
  refundable: boolean
  featured: boolean
  doubleup: boolean
  sticky: boolean
  modQueueOptIn: boolean
  sectionId?: number
  categoryId?: number
  typeId?: number
  resolutionId?: number
  bangumiId?: number
  subtitleGroupId?: number
  publishGroupId?: number
  regionId?: number
  distributorId?: number
  seasonNumber?: number
  episodeNumber?: number
  tmdb?: number
  imdb?: number
  tvdb?: number
  mal?: number
  igdb?: number
  free?: number
  flUntil?: number
  duUntil?: number
  subCategories: Record<string, number | undefined>
  nfoPath: string
}

interface TorrentReviewRow {
  id: string
  name: string
  torrentPath: string
  title: string
  bodySourceLabel: string
  bodyHtml: string
  targetSiteIds: SiteId[]
}

type ReviewSiteStatus = 'ready' | 'published' | 'blocked'
type PublishProgressStatus = 'queued' | 'publishing' | 'published' | 'failed' | 'skipped'

interface ReviewSiteRow {
  siteId: SiteId
  siteName: string
  status: ReviewSiteStatus
  message: string
  issues: string[]
  latestResult?: PublishResult
  validation?: SitePublishValidationPayload
  adapterKind?: string
}

interface PublishProgressRow {
  siteId: SiteId
  siteName: string
  status: PublishProgressStatus
  message: string
  remoteUrl?: string
}

const LEGACY_SITE_IDS = new Set<SiteId>(['bangumi', 'nyaa'])

const props = defineProps<{
  id: number
}>()

const router = useRouter()
const { t } = useI18n()
const { project, refreshProject } = useProjectContext()

const isLoading = ref(false)
const isChecking = ref(false)
const isPublishing = ref(false)
const loadError = ref('')
const publishError = ref('')
const config = ref<Config.PublishConfig | null>(null)
const sites = ref<SiteCatalogEntry[]>([])
const targetSiteIds = ref<SiteId[]>([])
const siteRows = ref<ReviewSiteRow[]>([])
const progressRows = ref<PublishProgressRow[]>([])
const progressCompleted = ref(0)
const progressTotal = ref(0)
const currentProgressLabel = ref('')
const autoReturnTimer = ref<number | null>(null)

const sharedDraft = reactive<SharedPublishDraftForm>({
  title: '',
  description: '',
  torrentPath: '',
  nfoPath: '',
  anonymous: false,
})

const siteDrafts = ref<Partial<Record<SiteId, SitePublishDraftForm>>>({})

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function joinProjectPath(basePath: string, fileName: string) {
  if (!basePath || !fileName) {
    return ''
  }

  const separator = basePath.includes('\\') ? '\\' : '/'
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${fileName.replace(/^[\\/]+/, '')}`
}

function getFileName(path: string) {
  return path.replace(/^.*[\\/]/, '')
}

function normalizePublishTorrentEntry(value: unknown, index: number): PublishTorrentEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const path = readOptionalString(raw.path)
  if (!path) {
    return null
  }

  return {
    id: readOptionalString(raw.id) ?? `torrent-${index + 1}`,
    name: readOptionalString(raw.name) ?? getFileName(path),
    path,
    enabled: raw.enabled !== false,
    titleOverride: typeof raw.titleOverride === 'string' ? raw.titleOverride : undefined,
    bodyOverride: typeof raw.bodyOverride === 'string' ? raw.bodyOverride : undefined,
  }
}

function buildFallbackPublishTorrentEntry(currentConfig: Config.PublishConfig): PublishTorrentEntry | null {
  const path = readOptionalString(currentConfig.torrentPath)
  if (!path) {
    return null
  }

  return {
    id: currentConfig.activeTorrentId?.trim() || 'torrent-default',
    name: readOptionalString(currentConfig.torrentName) ?? getFileName(path),
    path,
    enabled: true,
  }
}

function getPublishTorrentEntries(currentConfig: Config.PublishConfig) {
  const entries = Array.isArray(currentConfig.torrentEntries)
    ? currentConfig.torrentEntries
        .map((entry, index) => normalizePublishTorrentEntry(entry, index))
        .filter((entry): entry is PublishTorrentEntry => Boolean(entry))
    : []

  if (entries.length > 0) {
    return entries
  }

  const fallback = buildFallbackPublishTorrentEntry(currentConfig)
  return fallback ? [fallback] : []
}

function getActivePublishTorrentEntry(currentConfig: Config.PublishConfig) {
  const entries = getPublishTorrentEntries(currentConfig)
  if (entries.length === 0) {
    return null
  }

  return (
    entries.find(entry => entry.id === currentConfig.activeTorrentId) ??
    entries.find(entry => entry.enabled !== false) ??
    entries[0]
  )
}

function getSelectedPublishTorrentEntries(currentConfig: Config.PublishConfig) {
  const entries = getPublishTorrentEntries(currentConfig)
  const selectedEntries = entries.filter(entry => entry.enabled !== false)
  if (selectedEntries.length > 0) {
    return selectedEntries
  }

  const activeEntry = getActivePublishTorrentEntry(currentConfig)
  return activeEntry ? [activeEntry] : []
}

function resolveConfiguredTargetSites(currentConfig: Config.PublishConfig) {
  const configuredTargetSites = Array.isArray(currentConfig.targetSites) ? currentConfig.targetSites : []
  if (configuredTargetSites.length > 0) {
    return configuredTargetSites
  }

  const content = currentConfig.content
  if (content && typeof content === 'object' && !Array.isArray(content) && 'targetSites' in content) {
    return Array.isArray(content.targetSites) ? content.targetSites : []
  }

  return project.value?.targetSites ?? []
}

function resolveTorrentTitle(currentConfig: Config.PublishConfig, entry: PublishTorrentEntry) {
  const titleOverride = entry.titleOverride?.trim()
  if (titleOverride) {
    return titleOverride
  }

  return entry.id === currentConfig.activeTorrentId ? currentConfig.title?.trim() ?? '' : ''
}

function getEpisodeContent(currentConfig: Config.PublishConfig) {
  const content = currentConfig.content
  if (!content || typeof content !== 'object' || Array.isArray(content) || !('episodeLabel' in content)) {
    return null
  }

  return content as Config.Content_episode
}

function buildAutoBodyMetaLine(labelKey: string, value?: string) {
  return value ? `- ${t(labelKey)}: ${value}` : ''
}

function buildAutoBodyMarkdown(currentConfig: Config.PublishConfig, title: string) {
  const content = getEpisodeContent(currentConfig)
  if (!content) {
    return title ? `# ${title}` : t('stage.review.confirm.body.autoFallback')
  }

  const seriesTitles = [content.seriesTitleCN, content.seriesTitleEN, content.seriesTitleJP].filter(Boolean).join(' / ')
  const metaRows = [
    buildAutoBodyMetaLine('stage.review.confirm.body.meta.title', seriesTitles),
    buildAutoBodyMetaLine('stage.review.confirm.body.meta.season', content.seasonLabel),
    buildAutoBodyMetaLine('stage.review.confirm.body.meta.episode', content.episodeLabel),
    buildAutoBodyMetaLine('stage.review.confirm.body.meta.episodeTitle', content.episodeTitle),
  ].filter(Boolean)

  const summary = content.summary?.trim() || t('stage.review.confirm.body.noSummary')

  return [`# ${title || currentConfig.title?.trim() || content.episodeLabel}`, '', ...metaRows, '', summary].join('\n')
}

function buildTorrentBody(currentConfig: Config.PublishConfig, entry: PublishTorrentEntry) {
  const bodyOverride = entry.bodyOverride?.trim()
  if (bodyOverride) {
    return {
      label: t('stage.review.confirm.body.source.override'),
      markdown: bodyOverride,
    }
  }

  const bodyTemplate = currentConfig.bodyTemplate?.trim()
  if (bodyTemplate) {
    return {
      label: t('stage.review.confirm.body.source.shared'),
      markdown: bodyTemplate,
    }
  }

  return {
    label: t('stage.review.confirm.body.source.generated'),
    markdown: buildAutoBodyMarkdown(currentConfig, resolveTorrentTitle(currentConfig, entry)),
  }
}

function parseTrackerText(value: string) {
  return [
    ...new Set(
      value
        .split(/[\r\n,]+/)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
}

function createEmptyDraft(): SitePublishDraftForm {
  return {
    title: '',
    description: '',
    torrentPath: '',
    trackersText: '',
    smallDescription: '',
    url: '',
    technicalInfo: '',
    ptGen: '',
    mediaInfo: '',
    bdInfo: '',
    price: '',
    tagIds: [],
    posState: 'normal',
    posStateUntil: '',
    pickType: 'normal',
    anonymous: false,
    personalRelease: false,
    internal: false,
    refundable: false,
    featured: false,
    doubleup: false,
    sticky: false,
    modQueueOptIn: false,
    sectionId: undefined,
    categoryId: undefined,
    typeId: undefined,
    resolutionId: undefined,
    bangumiId: undefined,
    subtitleGroupId: undefined,
    publishGroupId: undefined,
    regionId: undefined,
    distributorId: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
    tmdb: undefined,
    imdb: undefined,
    tvdb: undefined,
    mal: undefined,
    igdb: undefined,
    free: undefined,
    flUntil: undefined,
    duUntil: undefined,
    subCategories: {},
    nfoPath: '',
  }
}

function normalizeStoredSiteFieldDefaults(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return Object.entries(value as Record<string, unknown>).reduce<Partial<Record<SiteId, Record<string, unknown>>>>(
    (accumulator, [siteId, fieldDefaults]) => {
      if (!fieldDefaults || typeof fieldDefaults !== 'object' || Array.isArray(fieldDefaults)) {
        return accumulator
      }

      accumulator[siteId] = { ...(fieldDefaults as Record<string, unknown>) }
      return accumulator
    },
    {},
  )
}

function readStoredString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readStoredNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : undefined
}

function readStoredBoolean(value: unknown) {
  return value === true
}

function readStoredNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : []
}

function readStoredTrackersText(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('\n')
  }

  return readStoredString(value)
}

function readStoredNumberRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((accumulator, [key, raw]) => {
    const nextValue = readStoredNumber(raw)
    if (typeof nextValue === 'number' && nextValue > 0) {
      accumulator[key] = nextValue
    }
    return accumulator
  }, {})
}

function applyStoredSiteFieldDefaults(draft: SitePublishDraftForm, siteFieldDefaults?: Record<string, unknown>) {
  if (!siteFieldDefaults) {
    return draft
  }

  draft.smallDescription = readStoredString(siteFieldDefaults.smallDescription)
  draft.url = readStoredString(siteFieldDefaults.url)
  draft.technicalInfo = readStoredString(siteFieldDefaults.technicalInfo)
  draft.ptGen = readStoredString(siteFieldDefaults.ptGen)
  draft.mediaInfo = readStoredString(siteFieldDefaults.mediaInfo)
  draft.bdInfo = readStoredString(siteFieldDefaults.bdInfo)
  draft.price =
    typeof siteFieldDefaults.price === 'number' && Number.isFinite(siteFieldDefaults.price)
      ? `${siteFieldDefaults.price}`
      : readStoredString(siteFieldDefaults.price)
  draft.posState = readStoredString(siteFieldDefaults.posState) || draft.posState
  draft.posStateUntil = readStoredString(siteFieldDefaults.posStateUntil)
  draft.pickType = readStoredString(siteFieldDefaults.pickType) || draft.pickType
  draft.tagIds = readStoredNumberArray(siteFieldDefaults.tagIds)
  draft.subCategories = readStoredNumberRecord(siteFieldDefaults.subCategories)
  draft.sectionId = readStoredNumber(siteFieldDefaults.sectionId)
  draft.categoryId = readStoredNumber(siteFieldDefaults.categoryId)
  draft.typeId = readStoredNumber(siteFieldDefaults.typeId)
  draft.resolutionId = readStoredNumber(siteFieldDefaults.resolutionId)
  draft.trackersText = readStoredTrackersText(siteFieldDefaults.trackers ?? siteFieldDefaults.trackersText)
  draft.bangumiId = readStoredNumber(siteFieldDefaults.bangumiId)
  draft.subtitleGroupId = readStoredNumber(siteFieldDefaults.subtitleGroupId)
  draft.publishGroupId = readStoredNumber(siteFieldDefaults.publishGroupId)
  draft.regionId = readStoredNumber(siteFieldDefaults.regionId)
  draft.distributorId = readStoredNumber(siteFieldDefaults.distributorId)
  draft.seasonNumber = readStoredNumber(siteFieldDefaults.seasonNumber)
  draft.episodeNumber = readStoredNumber(siteFieldDefaults.episodeNumber)
  draft.tmdb = readStoredNumber(siteFieldDefaults.tmdb)
  draft.imdb = readStoredNumber(siteFieldDefaults.imdb)
  draft.tvdb = readStoredNumber(siteFieldDefaults.tvdb)
  draft.mal = readStoredNumber(siteFieldDefaults.mal)
  draft.igdb = readStoredNumber(siteFieldDefaults.igdb)
  draft.free = readStoredNumber(siteFieldDefaults.free)
  draft.flUntil = readStoredNumber(siteFieldDefaults.flUntil)
  draft.duUntil = readStoredNumber(siteFieldDefaults.duUntil)
  draft.personalRelease = readStoredBoolean(siteFieldDefaults.personalRelease)
  draft.internal = readStoredBoolean(siteFieldDefaults.internal)
  draft.refundable = readStoredBoolean(siteFieldDefaults.refundable)
  draft.featured = readStoredBoolean(siteFieldDefaults.featured)
  draft.doubleup = readStoredBoolean(siteFieldDefaults.doubleup)
  draft.sticky = readStoredBoolean(siteFieldDefaults.sticky)
  draft.modQueueOptIn = readStoredBoolean(siteFieldDefaults.modQueueOptIn)

  return draft
}

function applySharedDraft(currentConfig: Config.PublishConfig, content: Message.Task.TaskContents) {
  sharedDraft.title = currentConfig.title ?? content.title ?? ''
  sharedDraft.description = content.html ?? ''
  sharedDraft.torrentPath =
    currentConfig.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, currentConfig.torrentName)
      : currentConfig.torrentPath ?? ''
  sharedDraft.nfoPath = ''
  sharedDraft.anonymous = false
}

function createInitialDraft(currentConfig: Config.PublishConfig, content: Message.Task.TaskContents, siteId: SiteId) {
  const draft = createEmptyDraft()
  draft.title = currentConfig.title ?? content.title ?? ''
  draft.description = content.html ?? ''
  draft.url = currentConfig.information ?? ''
  draft.torrentPath =
    currentConfig.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, currentConfig.torrentName)
      : currentConfig.torrentPath ?? ''
  const storedFieldDefaults = normalizeStoredSiteFieldDefaults(currentConfig.siteFieldDefaults)?.[siteId]
  return applyStoredSiteFieldDefaults(draft, storedFieldDefaults)
}

function ensureDraft(siteId: SiteId) {
  if (!siteDrafts.value[siteId]) {
    siteDrafts.value[siteId] = createEmptyDraft()
  }

  return siteDrafts.value[siteId] as SitePublishDraftForm
}

const selectedSiteLabels = computed(() =>
  targetSiteIds.value.map(siteId => sites.value.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId)),
)
const currentTargetSitesText = computed(() =>
  t('stage.review.confirm.sections.siteChecks.targets', {
    sites: selectedSiteLabels.value.length > 0 ? selectedSiteLabels.value.join(' / ') : t('common.none'),
  }),
)
const torrentRows = computed<TorrentReviewRow[]>(() => (config.value ? createTorrentRows(config.value) : []))

const titleIssues = computed(() =>
  torrentRows.value
    .filter(row => !row.title.trim())
    .map(row => t('stage.review.confirm.validation.titleMissing', { name: row.name })),
)

const readySiteRows = computed(() => siteRows.value.filter(row => row.status === 'ready'))
const blockedSiteRows = computed(() => siteRows.value.filter(row => row.status === 'blocked'))
const publishedSiteRows = computed(() => siteRows.value.filter(row => row.status === 'published'))

const progressVisible = computed(() => isPublishing.value || progressRows.value.length > 0)
const progressPercentage = computed(() => {
  if (progressTotal.value <= 0) {
    return 100
  }

  return Math.min(100, Math.round((progressCompleted.value / progressTotal.value) * 100))
})

const canPublish = computed(
  () =>
    !isLoading.value &&
    !isChecking.value &&
    !isPublishing.value &&
    titleIssues.value.length === 0 &&
    blockedSiteRows.value.length === 0 &&
    readySiteRows.value.length > 0,
)

function getReviewTone(status: ReviewSiteStatus) {
  switch (status) {
    case 'ready':
      return 'success' as const
    case 'published':
      return 'info' as const
    case 'blocked':
    default:
      return 'danger' as const
  }
}

function getReviewLabel(status: ReviewSiteStatus) {
  switch (status) {
    case 'ready':
      return t('stage.review.confirm.reviewStatus.ready')
    case 'published':
      return t('stage.review.confirm.reviewStatus.published')
    case 'blocked':
    default:
      return t('stage.review.confirm.reviewStatus.blocked')
  }
}

function getProgressTone(status: PublishProgressStatus) {
  switch (status) {
    case 'published':
      return 'success' as const
    case 'failed':
      return 'danger' as const
    case 'publishing':
      return 'warning' as const
    case 'skipped':
      return 'info' as const
    case 'queued':
    default:
      return 'neutral' as const
  }
}

function getProgressLabel(status: PublishProgressStatus) {
  switch (status) {
    case 'queued':
      return t('stage.review.confirm.progressStatus.queued')
    case 'publishing':
      return t('stage.review.confirm.progressStatus.publishing')
    case 'published':
      return t('stage.review.confirm.progressStatus.published')
    case 'failed':
      return t('stage.review.confirm.progressStatus.failed')
    case 'skipped':
      return t('stage.review.confirm.progressStatus.skipped')
    default:
      return t('stage.review.confirm.progressStatus.queued')
  }
}

function createTorrentRows(currentConfig: Config.PublishConfig) {
  const selectedEntries = getSelectedPublishTorrentEntries(currentConfig)
  return selectedEntries.map(entry => {
    const title = resolveTorrentTitle(currentConfig, entry)
    const body = buildTorrentBody(currentConfig, entry)
    return {
      id: entry.id,
      name: entry.name,
      torrentPath: entry.path,
      title,
      bodySourceLabel: body.label,
      bodyHtml: marked.parse(body.markdown, { async: false }) as string,
      targetSiteIds: [...targetSiteIds.value],
    } satisfies TorrentReviewRow
  })
}

function buildPublishInput(siteId: SiteId): SitePublishDraft {
  const draft = ensureDraft(siteId)
  const site = sites.value.find(item => item.id === siteId)
  const primaryTorrent = torrentRows.value[0]
  const isBatchTorrentMode = torrentRows.value.length > 1
  const resolvedTitle = isBatchTorrentMode ? primaryTorrent?.title.trim() ?? '' : sharedDraft.title.trim()
  const resolvedTorrentPath = isBatchTorrentMode ? primaryTorrent?.torrentPath.trim() ?? '' : sharedDraft.torrentPath.trim()

  const baseInput: SitePublishDraft = {
    projectId: props.id,
    siteId,
    typeId: draft.typeId ?? 0,
    title: resolvedTitle,
    description: sharedDraft.description.trim(),
    torrentPath: resolvedTorrentPath,
    batchEntries: isBatchTorrentMode
      ? torrentRows.value.map(row => ({
          id: row.id,
          name: row.name,
          torrentPath: row.torrentPath.trim(),
          title: row.title,
        }))
      : undefined,
    anonymous: sharedDraft.anonymous,
    subCategories: Object.entries(draft.subCategories).reduce<Record<string, number>>((accumulator, [field, value]) => {
      if (typeof value === 'number' && value > 0) {
        accumulator[field] = value
      }
      return accumulator
    }, {}),
    nfoPath: sharedDraft.nfoPath.trim() || undefined,
  }

  if (site?.adapter === 'unit3d') {
    return {
      ...baseInput,
      categoryId: draft.categoryId,
      resolutionId: draft.resolutionId,
      mediaInfo: draft.mediaInfo.trim() || undefined,
      bdInfo: draft.bdInfo.trim() || undefined,
      regionId: draft.regionId,
      distributorId: draft.distributorId,
      seasonNumber: draft.seasonNumber,
      episodeNumber: draft.episodeNumber,
      tmdb: draft.tmdb,
      imdb: draft.imdb,
      tvdb: draft.tvdb,
      mal: draft.mal,
      igdb: draft.igdb,
      personalRelease: draft.personalRelease,
      internal: draft.internal,
      refundable: draft.refundable,
      featured: draft.featured,
      free: draft.free,
      flUntil: draft.flUntil,
      doubleup: draft.doubleup,
      duUntil: draft.duUntil,
      sticky: draft.sticky,
      modQueueOptIn: draft.modQueueOptIn,
    }
  }

  if (site?.adapter === 'mikan') {
    const trackers = parseTrackerText(draft.trackersText)
    return {
      ...baseInput,
      trackers: trackers.length > 0 ? trackers : undefined,
      bangumiId: draft.bangumiId,
      subtitleGroupId: draft.subtitleGroupId,
      publishGroupId: draft.publishGroupId,
    }
  }

  return {
    ...baseInput,
    smallDescription: draft.smallDescription.trim() || undefined,
    url: draft.url.trim() || undefined,
    technicalInfo: draft.technicalInfo.trim() || undefined,
    ptGen: draft.ptGen.trim() || undefined,
    price: draft.price.trim() ? Number(draft.price.trim()) : undefined,
    tagIds: draft.tagIds.length > 0 ? [...draft.tagIds] : undefined,
    posState: draft.posState,
    posStateUntil: draft.posStateUntil.trim() || undefined,
    pickType: draft.pickType,
  }
}

async function buildLegacyReviewSite(site: SiteCatalogEntry, latestResult?: PublishResult) {
  const issues: string[] = []
  const currentConfig = config.value
  if (!currentConfig) {
    issues.push(t('stage.review.confirm.legacy.configLoading'))
  } else {
    if (site.id === 'bangumi' && !currentConfig.category_bangumi?.trim()) {
      issues.push(t('stage.review.confirm.legacy.bangumiCategoryMissing'))
    }
    if (site.id === 'nyaa' && !currentConfig.category_nyaa?.trim()) {
      issues.push(t('stage.review.confirm.legacy.nyaaCategoryMissing'))
    }
  }

  let statusText = ''
  try {
    const response: Message.BT.LoginStatus = JSON.parse(
      await window.BTAPI.checkLoginStatus(JSON.stringify({ type: site.id } satisfies Message.BT.AccountType)),
    )
    statusText = response.status?.trim() ?? ''
  } catch (error) {
    issues.push((error as Error).message)
  }

  const normalizedStatus = normalizeLegacyAccountStatus(statusText || undefined, true)
  if (normalizedStatus !== 'loggedIn') {
    issues.push(statusText || t('stage.review.confirm.legacy.accountUnknown'))
  }

  return {
    siteId: site.id,
    siteName: site.name,
    status: issues.length === 0 ? 'ready' : 'blocked',
    message: issues.length === 0 ? t('stage.review.confirm.legacy.checksPassed') : issues[0],
    issues,
    latestResult,
    adapterKind: site.adapter,
  } satisfies ReviewSiteRow
}

async function buildAdapterReviewSite(site: SiteCatalogEntry, latestResult?: PublishResult) {
  if (site.accountStatus !== 'authenticated') {
    const accountMessage = site.accountMessage?.trim() || t('stage.review.confirm.adapter.accountUnauthenticated')
    return {
      siteId: site.id,
      siteName: site.name,
      status: 'blocked',
      message: accountMessage,
      issues: [accountMessage],
      latestResult,
      adapterKind: site.adapter,
    } satisfies ReviewSiteRow
  }

  const result = await siteBridge.validatePublish(buildPublishInput(site.id))
  if (!result.ok) {
    return {
      siteId: site.id,
      siteName: site.name,
      status: 'blocked',
      message: result.error.message,
      issues: [result.error.message],
      latestResult,
      adapterKind: site.adapter,
    } satisfies ReviewSiteRow
  }

  const issues = result.data.issues.map(issue => `${issue.field}: ${issue.message}`)
  return {
    siteId: site.id,
    siteName: site.name,
    status: result.data.valid ? 'ready' : 'blocked',
    message: result.data.valid
      ? t('stage.review.confirm.adapter.validationPassed')
      : t('stage.review.confirm.adapter.validationFailed'),
    issues,
    validation: result.data,
    latestResult,
    adapterKind: site.adapter,
  } satisfies ReviewSiteRow
}

async function refreshChecks() {
  if (!config.value) {
    siteRows.value = []
    return
  }

  isChecking.value = true
  publishError.value = ''

  try {
    const latestResultMap = getLatestPublishResultMap(project.value?.publishResults ?? [])
    const nextRows: ReviewSiteRow[] = []

    for (const siteId of targetSiteIds.value) {
      const site = sites.value.find(item => item.id === siteId)
      const latestResult = latestResultMap.get(siteId)

      if (latestResult?.status === 'published') {
        nextRows.push({
          siteId,
          siteName: site?.name ?? getSiteLabel(siteId),
          status: 'published',
          message: latestResult.message ?? t('stage.review.confirm.site.alreadyPublished'),
          issues: [],
          latestResult,
          adapterKind: site?.adapter,
        })
        continue
      }

      if (!site) {
        nextRows.push({
          siteId,
          siteName: getSiteLabel(siteId),
          status: 'blocked',
          message: t('stage.review.confirm.site.missingFromCatalog'),
          issues: [t('stage.review.confirm.site.missingFromCatalog')],
        })
        continue
      }

      nextRows.push(
        LEGACY_SITE_IDS.has(siteId)
          ? await buildLegacyReviewSite(site, latestResult)
          : await buildAdapterReviewSite(site, latestResult),
      )
    }

    siteRows.value = nextRows
  } finally {
    isChecking.value = false
  }
}

function initializeProgressRows() {
  progressTotal.value = readySiteRows.value.length
  progressCompleted.value = 0
  currentProgressLabel.value =
    progressTotal.value > 0
      ? t('stage.review.confirm.progress.preparingQueue')
      : t('stage.review.confirm.progress.noPendingSites')
  progressRows.value = siteRows.value.map(row => ({
    siteId: row.siteId,
    siteName: row.siteName,
    status: row.status === 'published' ? 'skipped' : 'queued',
    message:
      row.status === 'published'
        ? t('stage.review.confirm.progress.alreadyPublishedSkipped')
        : t('stage.review.confirm.progress.waiting'),
    remoteUrl: row.latestResult?.remoteUrl,
  }))
}

function updateProgress(siteId: SiteId, patch: Partial<PublishProgressRow>) {
  const row = progressRows.value.find(item => item.siteId === siteId)
  if (!row) {
    return
  }

  Object.assign(row, patch)
}

function getLegacyPublishType(siteId: SiteId) {
  switch (siteId) {
    case 'bangumi':
      return 'bangumi'
    case 'nyaa':
      return 'nyaa'
    default:
      return null
  }
}

async function publishLegacySite(siteId: SiteId) {
  const publishType = getLegacyPublishType(siteId)
  if (!publishType) {
    return {
      status: 'failed' as const,
      message: t('stage.review.confirm.legacy.siteUnsupported'),
      result: undefined,
    }
  }

  let finalResult = 'failed'
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response: Message.Task.Result = JSON.parse(
      await window.BTAPI.publish(JSON.stringify({ id: props.id, type: publishType } satisfies Message.Task.ContentType)),
    )
    finalResult = response.result
    if (['success', 'exist', 'unauthorized'].includes(response.result)) {
      break
    }
  }

  await refreshProject()
  const latestResult = getLatestPublishResultMap(project.value?.publishResults ?? []).get(siteId)

  if (latestResult?.status === 'published') {
    return {
      status: 'published' as const,
      message: latestResult.message ?? t('stage.review.confirm.legacy.published'),
      result: latestResult,
    }
  }

  if (finalResult === 'unauthorized') {
    return {
      status: 'failed' as const,
      message: latestResult?.message ?? t('stage.review.confirm.legacy.unauthorized'),
      result: latestResult,
    }
  }

  return {
    status: 'failed' as const,
    message: latestResult?.message ?? t('stage.review.confirm.legacy.publishFailed'),
    result: latestResult,
  }
}

async function publishAdapterSite(siteId: SiteId) {
  const result = await siteBridge.publish(buildPublishInput(siteId))
  await refreshProject()

  if (!result.ok) {
    return {
      status: 'failed' as const,
      message: result.error.message,
      result: undefined,
    }
  }

  return {
    status: result.data.result.status === 'published' ? ('published' as const) : ('failed' as const),
    message: result.data.result.message ?? getPublishStateLabel(result.data.result.status),
    result: result.data.result,
  }
}

async function goBackToEditor() {
  await router.push({
    name: 'edit',
    params: { id: props.id },
  })
}

async function confirmPublish() {
  publishError.value = ''

  if (titleIssues.value.length > 0) {
    publishError.value = titleIssues.value[0]
    return
  }

  await refreshChecks()

  if (blockedSiteRows.value.length > 0) {
    publishError.value = t('stage.review.confirm.errors.fixBlockedSites')
    return
  }

  if (readySiteRows.value.length === 0) {
    if (publishedSiteRows.value.length > 0) {
      const statusMessage: Message.Task.TaskStatus = { id: props.id, step: 'finish' }
      window.taskAPI.setTaskProcess(JSON.stringify(statusMessage))
      ElMessage.success(t('stage.review.confirm.success.allTargetsPublished'))
      await goBackToEditor()
      return
    }

    publishError.value = t('stage.review.confirm.errors.noPublishableSites')
    return
  }

  initializeProgressRows()
  isPublishing.value = true
  const publishStatusMessage: Message.Task.TaskStatus = { id: props.id, step: 'bt_publish' }
  window.taskAPI.setTaskProcess(JSON.stringify(publishStatusMessage))

  try {
    for (const row of readySiteRows.value) {
      currentProgressLabel.value = t('stage.review.confirm.progress.publishingSite', { site: row.siteName })
      updateProgress(row.siteId, {
        status: 'publishing',
        message: LEGACY_SITE_IDS.has(row.siteId)
          ? t('stage.review.confirm.progress.runningLegacy')
          : t('stage.review.confirm.progress.runningAdapter'),
      })

      const publishResult = LEGACY_SITE_IDS.has(row.siteId)
        ? await publishLegacySite(row.siteId)
        : await publishAdapterSite(row.siteId)

      updateProgress(row.siteId, {
        status: publishResult.status,
        message: publishResult.message,
        remoteUrl: publishResult.result?.remoteUrl,
      })
      progressCompleted.value += 1
    }

    await refreshChecks()

    const failedCount = progressRows.value.filter(row => row.status === 'failed').length
    if (failedCount > 0) {
      publishError.value = t('stage.review.confirm.errors.failedSitesSummary', { count: failedCount })
      currentProgressLabel.value = publishError.value
      const checkStatusMessage: Message.Task.TaskStatus = { id: props.id, step: 'check' }
      window.taskAPI.setTaskProcess(JSON.stringify(checkStatusMessage))
      return
    }

    currentProgressLabel.value = t('stage.review.confirm.progress.completedReturning')
    const finishStatusMessage: Message.Task.TaskStatus = { id: props.id, step: 'finish' }
    window.taskAPI.setTaskProcess(JSON.stringify(finishStatusMessage))
    ElMessage.success(t('stage.review.confirm.success.publishCompleted'))
    autoReturnTimer.value = window.setTimeout(() => {
      void goBackToEditor()
    }, 900)
  } finally {
    isPublishing.value = false
  }
}

async function loadReview() {
  isLoading.value = true
  loadError.value = ''
  publishError.value = ''

  try {
    const [siteResult, content, currentConfig] = await Promise.all([
      siteBridge.listSites(),
      taskBridge.getContent(props.id),
      taskBridge.getPublishConfig(props.id),
    ])

    if (!siteResult.ok) {
      throw new Error(siteResult.error.message)
    }

    config.value = currentConfig
    sites.value = siteResult.data.sites.filter(site => site.capabilitySet.publish.torrent)
    targetSiteIds.value = [...new Set(resolveConfiguredTargetSites(currentConfig))].filter(siteId =>
      sites.value.some(site => site.id === siteId),
    )

    applySharedDraft(currentConfig, content)

    siteDrafts.value = targetSiteIds.value.reduce<Partial<Record<SiteId, SitePublishDraftForm>>>((accumulator, siteId) => {
      accumulator[siteId] = createInitialDraft(currentConfig, content, siteId)
      return accumulator
    }, {})

    await refreshChecks()
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  const statusMessage: Message.Task.TaskStatus = { id: props.id, step: 'check' }
  window.taskAPI.setTaskProcess(JSON.stringify(statusMessage))
  await loadReview()
})

onBeforeUnmount(() => {
  if (autoReturnTimer.value !== null) {
    window.clearTimeout(autoReturnTimer.value)
  }
})
</script>

<template>
  <div class="episode-confirm">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />

    <template v-else>
      <section class="episode-confirm__hero">
        <div>
          <div class="episode-confirm__eyebrow">{{ t('stage.review.confirm.hero.eyebrow') }}</div>
          <h3 class="episode-confirm__title">{{ t('stage.review.confirm.hero.title') }}</h3>
          <p class="episode-confirm__description">{{ t('stage.review.confirm.hero.description') }}</p>
        </div>

        <div class="episode-confirm__chips">
          <StatusChip tone="info">{{ t('stage.review.confirm.hero.torrents', { count: torrentRows.length }) }}</StatusChip>
          <StatusChip tone="warning">{{ t('stage.review.confirm.hero.targetSites', { count: targetSiteIds.length }) }}</StatusChip>
          <StatusChip tone="success">{{ t('stage.review.confirm.hero.published', { count: publishedSiteRows.length }) }}</StatusChip>
        </div>
      </section>

      <el-alert
        v-if="titleIssues.length > 0"
        type="warning"
        :closable="false"
        show-icon
        :title="t('stage.review.confirm.alerts.titleMissing')"
      >
        <template #default>
          <div v-for="issue in titleIssues" :key="issue" class="episode-confirm__alert-line">
            {{ issue }}
          </div>
        </template>
      </el-alert>

      <el-alert v-if="publishError" type="error" :closable="false" show-icon :title="publishError" />

      <section class="episode-confirm__section">
        <div class="episode-confirm__section-head">
          <div>
            <h4 class="episode-confirm__section-title">{{ t('stage.review.confirm.sections.siteChecks.title') }}</h4>
            <p class="episode-confirm__section-text">{{ currentTargetSitesText }}</p>
          </div>
          <el-button plain :loading="isChecking" @click="refreshChecks">
            {{ t('stage.review.confirm.actions.recheck') }}
          </el-button>
        </div>

        <div v-if="siteRows.length === 0" class="episode-confirm__empty">
          {{ t('stage.review.confirm.sections.siteChecks.empty') }}
        </div>

        <div v-else class="episode-confirm__site-grid">
          <article v-for="row in siteRows" :key="row.siteId" class="episode-confirm__site-card">
            <div class="episode-confirm__site-head">
              <div>
                <div class="episode-confirm__site-name">{{ row.siteName }}</div>
                <div class="episode-confirm__site-meta">{{ row.adapterKind || row.siteId }}</div>
              </div>
              <StatusChip :tone="getReviewTone(row.status)">
                {{ getReviewLabel(row.status) }}
              </StatusChip>
            </div>

            <div class="episode-confirm__site-message">{{ row.message }}</div>

            <ul v-if="row.issues.length > 0" class="episode-confirm__issue-list">
              <li v-for="issue in row.issues" :key="`${row.siteId}-${issue}`">
                {{ issue }}
              </li>
            </ul>

            <a
              v-if="row.latestResult?.remoteUrl"
              :href="row.latestResult.remoteUrl"
              target="_blank"
              rel="noreferrer"
              class="episode-confirm__site-link"
            >
              {{ row.latestResult.remoteUrl }}
            </a>
          </article>
        </div>
      </section>

      <section class="episode-confirm__section">
        <div class="episode-confirm__section-head">
          <div>
            <h4 class="episode-confirm__section-title">{{ t('stage.review.confirm.sections.torrentReview.title') }}</h4>
            <p class="episode-confirm__section-text">{{ t('stage.review.confirm.sections.torrentReview.description') }}</p>
          </div>
        </div>

        <div v-if="torrentRows.length === 0" class="episode-confirm__empty">
          {{ t('stage.review.confirm.sections.torrentReview.empty') }}
        </div>

        <div v-else class="episode-confirm__torrent-stack">
          <article v-for="torrent in torrentRows" :key="torrent.id" class="episode-confirm__torrent-card">
            <div class="episode-confirm__torrent-head">
              <div>
                <div class="episode-confirm__torrent-name">{{ torrent.name }}</div>
                <div class="episode-confirm__torrent-path">{{ torrent.torrentPath }}</div>
              </div>
              <StatusChip :tone="torrent.title.trim() ? 'success' : 'danger'">
                {{ torrent.title.trim() ? t('stage.review.confirm.torrent.titleReady') : t('stage.review.confirm.torrent.titleMissing') }}
              </StatusChip>
            </div>

            <div class="episode-confirm__field">
              <div class="episode-confirm__field-label">{{ t('stage.review.confirm.torrent.publishTitle') }}</div>
              <div class="episode-confirm__field-value">{{ torrent.title.trim() || t('stage.review.confirm.torrent.titleValueMissing') }}</div>
            </div>

            <div class="episode-confirm__field">
              <div class="episode-confirm__field-label">{{ t('stage.review.confirm.torrent.targetSites') }}</div>
              <div class="episode-confirm__tag-row">
                <el-tag
                  v-for="siteId in torrent.targetSiteIds"
                  :key="`${torrent.id}-${siteId}`"
                  size="small"
                  effect="plain"
                  type="info"
                >
                  {{ sites.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId) }}
                </el-tag>
                <span v-if="torrent.targetSiteIds.length === 0" class="episode-confirm__muted">{{ t('common.none') }}</span>
              </div>
            </div>

            <div class="episode-confirm__field">
              <div class="episode-confirm__field-label">{{ torrent.bodySourceLabel }}</div>
              <div class="episode-confirm__body-preview" v-html="torrent.bodyHtml"></div>
            </div>
          </article>
        </div>
      </section>

      <section v-if="progressVisible" class="episode-confirm__section">
        <div class="episode-confirm__section-head">
          <div>
            <h4 class="episode-confirm__section-title">{{ t('stage.review.confirm.sections.publishProgress.title') }}</h4>
            <p class="episode-confirm__section-text">{{ currentProgressLabel }}</p>
          </div>
          <StatusChip :tone="progressPercentage === 100 ? 'success' : 'warning'">
            {{ progressCompleted }} / {{ progressTotal || readySiteRows.length }}
          </StatusChip>
        </div>

        <el-progress
          :percentage="progressPercentage"
          :status="progressRows.some(row => row.status === 'failed') ? 'exception' : progressPercentage === 100 ? 'success' : undefined"
          :stroke-width="18"
        />

        <div class="episode-confirm__progress-list">
          <article v-for="row in progressRows" :key="`progress-${row.siteId}`" class="episode-confirm__progress-row">
            <div class="episode-confirm__progress-head">
              <div class="episode-confirm__site-name">{{ row.siteName }}</div>
              <StatusChip :tone="getProgressTone(row.status)">
                {{ getProgressLabel(row.status) }}
              </StatusChip>
            </div>
            <div class="episode-confirm__site-message">{{ row.message }}</div>
            <a
              v-if="row.remoteUrl"
              :href="row.remoteUrl"
              target="_blank"
              rel="noreferrer"
              class="episode-confirm__site-link"
            >
              {{ row.remoteUrl }}
            </a>
          </article>
        </div>
      </section>

      <footer class="episode-confirm__footer">
        <el-button plain :disabled="isPublishing" @click="goBackToEditor">
          {{ t('stage.review.confirm.actions.backToEditor') }}
        </el-button>
        <el-button type="primary" :loading="isPublishing" :disabled="!canPublish" @click="confirmPublish">
          {{ t('stage.review.confirm.actions.confirmPublish') }}
        </el-button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.episode-confirm,
.episode-confirm__section,
.episode-confirm__torrent-stack,
.episode-confirm__site-grid,
.episode-confirm__progress-list,
.episode-confirm__issue-list {
  display: grid;
  gap: 16px;
}

.episode-confirm {
  gap: 18px;
}

.episode-confirm__hero,
.episode-confirm__section,
.episode-confirm__site-card,
.episode-confirm__torrent-card,
.episode-confirm__progress-row {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}

.episode-confirm__hero,
.episode-confirm__section {
  padding: 18px;
}

.episode-confirm__hero,
.episode-confirm__section-head,
.episode-confirm__site-head,
.episode-confirm__torrent-head,
.episode-confirm__progress-head,
.episode-confirm__footer,
.episode-confirm__chips,
.episode-confirm__tag-row {
  display: flex;
  gap: 12px;
}

.episode-confirm__hero,
.episode-confirm__section-head,
.episode-confirm__site-head,
.episode-confirm__torrent-head,
.episode-confirm__progress-head,
.episode-confirm__footer {
  justify-content: space-between;
  align-items: flex-start;
}

.episode-confirm__chips,
.episode-confirm__tag-row {
  flex-wrap: wrap;
  align-items: center;
}

.episode-confirm__eyebrow,
.episode-confirm__field-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.episode-confirm__title,
.episode-confirm__section-title,
.episode-confirm__site-name,
.episode-confirm__torrent-name {
  margin: 0;
  font-family: var(--font-display);
  letter-spacing: -0.03em;
}

.episode-confirm__title {
  font-size: 28px;
}

.episode-confirm__section-title,
.episode-confirm__site-name,
.episode-confirm__torrent-name {
  font-size: 18px;
}

.episode-confirm__description,
.episode-confirm__section-text,
.episode-confirm__site-meta,
.episode-confirm__site-message,
.episode-confirm__torrent-path,
.episode-confirm__muted,
.episode-confirm__field-value,
.episode-confirm__alert-line {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.episode-confirm__site-card,
.episode-confirm__torrent-card,
.episode-confirm__progress-row {
  padding: 16px;
}

.episode-confirm__field {
  display: grid;
  gap: 8px;
}

.episode-confirm__body-preview {
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 90%, #eef2f6);
  color: var(--text-primary);
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.episode-confirm__body-preview :deep(h1),
.episode-confirm__body-preview :deep(h2),
.episode-confirm__body-preview :deep(h3),
.episode-confirm__body-preview :deep(p),
.episode-confirm__body-preview :deep(ul) {
  margin-top: 0;
}

.episode-confirm__issue-list {
  margin: 0;
  padding-left: 18px;
  color: var(--danger);
}

.episode-confirm__site-link {
  color: var(--accent);
  overflow-wrap: anywhere;
}

.episode-confirm__empty {
  padding: 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
}

@media (max-width: 1180px) {
  .episode-confirm__hero,
  .episode-confirm__section-head,
  .episode-confirm__site-head,
  .episode-confirm__torrent-head,
  .episode-confirm__progress-head,
  .episode-confirm__footer {
    flex-direction: column;
  }
}
</style>
