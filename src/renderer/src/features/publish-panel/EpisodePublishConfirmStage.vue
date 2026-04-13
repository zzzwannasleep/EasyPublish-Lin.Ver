<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import {
  projectBridge,
  type SeriesEpisodeReviewPayload,
  type SeriesEpisodeReviewVariantPayload,
} from '../../services/bridge/project'
import { siteBridge } from '../../services/bridge/site'
import { getLatestPublishResultMap, getPublishStateLabel, getSiteLabel } from '../../services/project/presentation'
import type { PublishResult, SitePublishDraft } from '../../types/publish'
import type { PublishTorrentEntry } from '../../types/project'
import type { SiteCatalogEntry, SiteId, SitePublishValidationPayload } from '../../types/site'
import { useProjectContext } from '../project-detail/project-context'

interface SitePublishDraftForm {
  title: string
  description: string
  torrentPath: string
  categoryBangumi: string
  categoryCode: string
  publishIdentity: string
  btSyncKey: string
  teamSync: boolean
  bangumiTagIds: string[]
  trackersText: string
  episodeKey: string
  resolution: string
  languageText: string
  subtitle: string
  format: string
  version: string
  notes: string
  posterUrl: string
  emuleResource: string
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
  complete: boolean
  remake: boolean
  anonymous: boolean
  anonymousPost: boolean
  personalRelease: boolean
  internal: boolean
  refundable: boolean
  featured: boolean
  doubleup: boolean
  sticky: boolean
  modQueueOptIn: boolean
  teamPost: boolean
  sectionId?: number
  categoryId?: number
  typeId?: number
  teamId?: number
  resolutionId?: number
  bangumiId?: number
  subtitleGroupId?: number
  publishGroupId?: number
  fileSize?: number
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

interface ReviewVariantState {
  variantId: number
  variantName: string
  isActive: boolean
  config: Config.PublishConfig
  savedTitle?: string
  publishResults: PublishResult[]
  targetSiteIds: SiteId[]
  siteDrafts: Partial<Record<SiteId, SitePublishDraftForm>>
}

interface TorrentReviewRow {
  key: string
  variantId: number
  variantName: string
  isActive: boolean
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
  key: string
  variantId: number
  variantName: string
  isActive: boolean
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
  key: string
  variantId: number
  variantName: string
  siteId: SiteId
  siteName: string
  status: PublishProgressStatus
  message: string
  remoteUrl?: string
}

type CachedAccountValidation = {
  status: 'authenticated' | 'unauthenticated' | 'error'
  message?: string
}

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
const reviewBundle = ref<SeriesEpisodeReviewPayload | null>(null)
const reviewVariants = ref<ReviewVariantState[]>([])
const sites = ref<SiteCatalogEntry[]>([])
const siteRows = ref<ReviewSiteRow[]>([])
const progressRows = ref<PublishProgressRow[]>([])
const progressCompleted = ref(0)
const progressTotal = ref(0)
const currentProgressLabel = ref('')
const autoReturnTimer = ref<number | null>(null)
const accountValidationCache = new Map<SiteId, CachedAccountValidation>()

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

function resolveConfiguredTorrentTitle(currentConfig: Config.PublishConfig, entry: PublishTorrentEntry) {
  const titleOverride = entry.titleOverride?.trim()
  if (titleOverride) {
    return titleOverride
  }

  const activeEntry = getActivePublishTorrentEntry(currentConfig)
  if (activeEntry && entry.id === activeEntry.id) {
    return currentConfig.title?.trim() ?? ''
  }

  return ''
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

function renderBodyContent(content: string, format?: Config.PublishConfig['bodyTemplateFormat']) {
  if (!content.trim()) {
    return ''
  }

  if (format === 'html') {
    return content
  }

  return marked.parse(content, { async: false }) as string
}

function buildTorrentBody(currentConfig: Config.PublishConfig, entry: PublishTorrentEntry, title: string) {
  const bodyOverride = entry.bodyOverride?.trim()
  if (bodyOverride) {
    return {
      label: t('stage.review.confirm.body.source.override'),
      html: renderBodyContent(bodyOverride, currentConfig.bodyTemplateFormat),
    }
  }

  const bodyTemplate = currentConfig.bodyTemplate?.trim()
  if (bodyTemplate) {
    return {
      label: t('stage.review.confirm.body.source.shared'),
      html: renderBodyContent(bodyTemplate, currentConfig.bodyTemplateFormat),
    }
  }

  return {
    label: t('stage.review.confirm.body.source.generated'),
    html: renderBodyContent(buildAutoBodyMarkdown(currentConfig, title), 'md'),
  }
}

function parseTextList(value: string) {
  return [
    ...new Set(
      value
        .split(/[\r\n,]+/)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
}

function parseTrackerText(value: string) {
  return parseTextList(value)
}

function createEmptyDraft(): SitePublishDraftForm {
  return {
    title: '',
    description: '',
    torrentPath: '',
    categoryBangumi: '',
    categoryCode: '',
    publishIdentity: 'personal',
    btSyncKey: '',
    teamSync: false,
    bangumiTagIds: [],
    trackersText: '',
    episodeKey: '',
    resolution: '',
    languageText: '',
    subtitle: '',
    format: '',
    version: '',
    notes: '',
    posterUrl: '',
    emuleResource: '',
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
    complete: false,
    remake: false,
    anonymous: false,
    anonymousPost: false,
    personalRelease: false,
    internal: false,
    refundable: false,
    featured: false,
    doubleup: false,
    sticky: false,
    modQueueOptIn: false,
    teamPost: false,
    sectionId: undefined,
    categoryId: undefined,
    typeId: undefined,
    teamId: undefined,
    resolutionId: undefined,
    bangumiId: undefined,
    subtitleGroupId: undefined,
    publishGroupId: undefined,
    fileSize: undefined,
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
  return value === true || value === 'true' || value === '1'
}

function readStoredNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : []
}

function readStoredBangumiTagIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return [
    ...new Set(
      value
        .map(item => {
          if (typeof item === 'string') {
            return item.trim()
          }

          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return ''
          }

          const raw = item as Record<string, unknown>
          return readOptionalString(raw.value) ?? readOptionalString(raw._id) ?? ''
        })
        .filter(Boolean),
    ),
  ]
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

  draft.categoryBangumi = readStoredString(siteFieldDefaults.categoryBangumi ?? siteFieldDefaults.category_bangumi)
  draft.smallDescription = readStoredString(siteFieldDefaults.smallDescription)
  draft.categoryCode = readStoredString(siteFieldDefaults.categoryCode ?? siteFieldDefaults.category_nyaa)
  draft.publishIdentity = readStoredString(siteFieldDefaults.publishIdentity) || draft.publishIdentity
  draft.btSyncKey = readStoredString(siteFieldDefaults.btSyncKey ?? siteFieldDefaults.btskey ?? siteFieldDefaults.syncKey)
  draft.teamSync = readStoredBoolean(siteFieldDefaults.teamSync ?? siteFieldDefaults.teamsync)
  draft.bangumiTagIds = readStoredBangumiTagIds(siteFieldDefaults.bangumiTagIds ?? siteFieldDefaults.tags)
  draft.url = readStoredString(siteFieldDefaults.information ?? siteFieldDefaults.url)
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
  draft.teamId = readStoredNumber(siteFieldDefaults.teamId)
  draft.resolutionId = readStoredNumber(siteFieldDefaults.resolutionId)
  draft.episodeKey = readStoredString(siteFieldDefaults.episodeKey)
  draft.resolution = readStoredString(siteFieldDefaults.resolution)
  draft.languageText = readStoredTrackersText(siteFieldDefaults.language ?? siteFieldDefaults.languageText)
  draft.subtitle = readStoredString(siteFieldDefaults.subtitle)
  draft.format = readStoredString(siteFieldDefaults.format)
  draft.version = readStoredString(siteFieldDefaults.version)
  draft.notes = readStoredString(siteFieldDefaults.notes)
  draft.fileSize = readStoredNumber(siteFieldDefaults.fileSize)
  draft.trackersText = readStoredTrackersText(siteFieldDefaults.trackers ?? siteFieldDefaults.trackersText)
  draft.posterUrl = readStoredString(siteFieldDefaults.posterUrl)
  draft.emuleResource = readStoredString(siteFieldDefaults.emuleResource)
  draft.complete = readStoredBoolean(siteFieldDefaults.complete ?? siteFieldDefaults.completed)
  draft.remake = readStoredBoolean(siteFieldDefaults.remake)
  draft.anonymousPost = readStoredBoolean(siteFieldDefaults.anonymousPost ?? siteFieldDefaults.Anonymous_Post)
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
  draft.teamPost = readStoredBoolean(siteFieldDefaults.teamPost ?? siteFieldDefaults.Team_Post)

  return draft
}

function createInitialDraft(currentConfig: Config.PublishConfig, siteId: SiteId) {
  const draft = createEmptyDraft()
  draft.title = currentConfig.title ?? ''
  draft.categoryBangumi = currentConfig.category_bangumi ?? ''
  draft.categoryCode = currentConfig.category_nyaa ?? ''
  draft.url = currentConfig.information ?? ''
  draft.complete = currentConfig.completed === true
  draft.remake = currentConfig.remake === true
  draft.torrentPath =
    currentConfig.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, currentConfig.torrentName)
      : currentConfig.torrentPath ?? ''
  const storedFieldDefaults = normalizeStoredSiteFieldDefaults(currentConfig.siteFieldDefaults)?.[siteId]
  applyStoredSiteFieldDefaults(draft, storedFieldDefaults)
  if (siteId === 'bangumi' && draft.bangumiTagIds.length === 0) {
    draft.bangumiTagIds = readStoredBangumiTagIds(currentConfig.tags)
  }
  return draft
}

function createReviewVariantState(
  payload: SeriesEpisodeReviewVariantPayload,
  sharedTargetSiteIds?: SiteId[],
) {
  const targetSiteIds = [...new Set((sharedTargetSiteIds?.length ? sharedTargetSiteIds : resolveConfiguredTargetSites(payload.config)))]
  const siteDrafts = targetSiteIds.reduce<Partial<Record<SiteId, SitePublishDraftForm>>>((accumulator, siteId) => {
    accumulator[siteId] = createInitialDraft(payload.config, siteId)
    return accumulator
  }, {})

  return {
    variantId: payload.variant.id,
    variantName: payload.variant.name || payload.config.torrentName || `Variant ${payload.variant.id}`,
    isActive: payload.isActive,
    config: payload.config,
    savedTitle: payload.variant.title?.trim() || undefined,
    publishResults: [...(payload.variant.publishResults ?? [])],
    targetSiteIds,
    siteDrafts,
  }
}

function resolveTorrentTitle(reviewVariant: ReviewVariantState, entry: PublishTorrentEntry) {
  const configuredTitle = resolveConfiguredTorrentTitle(reviewVariant.config, entry)
  if (configuredTitle) {
    return configuredTitle
  }

  const selectedEntries = getSelectedPublishTorrentEntries(reviewVariant.config)
  if (selectedEntries.length <= 1) {
    return reviewVariant.savedTitle?.trim() ?? ''
  }

  return ''
}

function findVariantState(variantId: number) {
  return reviewVariants.value.find(variant => variant.variantId === variantId)
}

function ensureVariantDraft(reviewVariant: ReviewVariantState, siteId: SiteId) {
  if (!reviewVariant.siteDrafts[siteId]) {
    reviewVariant.siteDrafts[siteId] = createInitialDraft(reviewVariant.config, siteId)
  }

  return reviewVariant.siteDrafts[siteId] as SitePublishDraftForm
}

function createTorrentRowsForVariant(reviewVariant: ReviewVariantState) {
  return getSelectedPublishTorrentEntries(reviewVariant.config).map(entry => {
    const title = resolveTorrentTitle(reviewVariant, entry)
    const body = buildTorrentBody(reviewVariant.config, entry, title)
    return {
      key: `${reviewVariant.variantId}:${entry.id}`,
      variantId: reviewVariant.variantId,
      variantName: reviewVariant.variantName,
      isActive: reviewVariant.isActive,
      id: entry.id,
      name: entry.name,
      torrentPath: entry.path,
      title,
      bodySourceLabel: body.label,
      bodyHtml: body.html,
      targetSiteIds: [...reviewVariant.targetSiteIds],
    } satisfies TorrentReviewRow
  })
}

const episodeDisplayLabel = computed(() => {
  const episode = reviewBundle.value?.episode
  if (!episode) {
    return ''
  }

  return episode.episodeTitle ? `${episode.episodeLabel} / ${episode.episodeTitle}` : episode.episodeLabel
})

const targetSiteIds = computed(() => [...new Set(reviewVariants.value.flatMap(variant => variant.targetSiteIds))])
const configuredSiteLabels = computed(() =>
  targetSiteIds.value.map(siteId => sites.value.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId)),
)
const configuredTargetSitesText = computed(() =>
  t('stage.review.confirm.sections.siteChecks.targets', {
    sites: configuredSiteLabels.value.length > 0 ? configuredSiteLabels.value.join(' / ') : t('common.none'),
  }),
)
const torrentRows = computed<TorrentReviewRow[]>(() => reviewVariants.value.flatMap(createTorrentRowsForVariant))

const titleIssues = computed(() =>
  torrentRows.value
    .filter(row => !row.title.trim())
    .map(row => t('stage.review.confirm.validation.titleMissing', { name: `${row.variantName} / ${row.name}` })),
)

const visibleSiteRows = computed(() => siteRows.value)
const readySiteRows = computed(() => visibleSiteRows.value.filter(row => row.status === 'ready'))
const blockedSiteRows = computed(() => visibleSiteRows.value.filter(row => row.status === 'blocked'))
const publishedSiteRows = computed(() => visibleSiteRows.value.filter(row => row.status === 'published'))

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

function buildPublishInput(row: ReviewSiteRow): SitePublishDraft {
  const reviewVariant = findVariantState(row.variantId)
  if (!reviewVariant) {
    throw new Error(`Variant ${row.variantId} is not loaded`)
  }

  const draft = ensureVariantDraft(reviewVariant, row.siteId)
  const site = sites.value.find(item => item.id === row.siteId)
  const selectedTorrents = getSelectedPublishTorrentEntries(reviewVariant.config)
  const primaryTorrent = selectedTorrents[0] ?? getActivePublishTorrentEntry(reviewVariant.config)
  const primaryTitle = primaryTorrent ? resolveTorrentTitle(reviewVariant, primaryTorrent).trim() : reviewVariant.savedTitle?.trim() ?? ''
  const primaryBody = primaryTorrent ? buildTorrentBody(reviewVariant.config, primaryTorrent, primaryTitle) : { html: '' }

  const baseInput: SitePublishDraft = {
    siteId: row.siteId,
    typeId: draft.typeId ?? 0,
    title: primaryTitle,
    description: primaryBody.html.trim(),
    torrentPath: primaryTorrent?.path.trim() || reviewVariant.config.torrentPath?.trim() || '',
    batchEntries:
      selectedTorrents.length > 1
        ? selectedTorrents.map(entry => ({
            id: entry.id,
            name: entry.name,
            torrentPath: entry.path.trim(),
            title: resolveTorrentTitle(reviewVariant, entry),
          }))
        : undefined,
    anonymous: draft.anonymous,
    subCategories: Object.entries(draft.subCategories).reduce<Record<string, number>>((accumulator, [field, value]) => {
      if (typeof value === 'number' && value > 0) {
        accumulator[field] = value
      }
      return accumulator
    }, {}),
    nfoPath: draft.nfoPath.trim() || undefined,
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

  if (site?.adapter === 'anibt') {
    const trackers = parseTrackerText(draft.trackersText)
    const language = parseTextList(draft.languageText)
    return {
      ...baseInput,
      notes: readOptionalString(draft.notes),
      trackers: trackers.length > 0 ? trackers : undefined,
      bangumiId: draft.bangumiId,
      episodeKey: readOptionalString(draft.episodeKey),
      resolution: readOptionalString(draft.resolution),
      language: language.length > 0 ? language : undefined,
      subtitle: readOptionalString(draft.subtitle),
      format: readOptionalString(draft.format),
      version: readOptionalString(draft.version),
      fileSize: draft.fileSize,
    }
  }

  if (site?.adapter === 'bangumi') {
    return {
      ...baseInput,
      categoryBangumi: draft.categoryBangumi.trim() || undefined,
      publishIdentity: draft.publishIdentity || 'personal',
      bangumiTagIds: draft.bangumiTagIds.length > 0 ? [...draft.bangumiTagIds] : undefined,
      btSyncKey: draft.btSyncKey.trim() || undefined,
      teamSync: draft.teamSync && draft.publishIdentity !== 'personal',
    }
  }

  if (site?.adapter === 'acgrip') {
    return baseInput
  }

  if (site?.adapter === 'nyaa') {
    return {
      ...baseInput,
      categoryCode: draft.categoryCode.trim() || undefined,
      url: draft.url.trim() || undefined,
      complete: draft.complete,
      remake: draft.remake,
    }
  }

  if (site?.adapter === 'dmhy') {
    const trackers = parseTrackerText(draft.trackersText)
    return {
      ...baseInput,
      teamId: draft.teamId,
      posterUrl: draft.posterUrl.trim() || undefined,
      trackers: trackers.length > 0 ? trackers : undefined,
      emuleResource: draft.emuleResource.trim() || undefined,
    }
  }

  if (site?.adapter === 'acgnx') {
    return {
      ...baseInput,
      anonymousPost: row.siteId === 'acgnx_a' ? draft.anonymousPost : undefined,
      categoryBangumi: draft.categoryBangumi.trim() || undefined,
      categoryCode: draft.categoryCode.trim() || undefined,
      teamPost: row.siteId === 'acgnx_a' ? draft.teamPost : undefined,
      url: draft.url.trim() || undefined,
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

async function resolveAccountValidation(site: SiteCatalogEntry) {
  const cached = accountValidationCache.get(site.id)
  if (cached) {
    return cached
  }

  const value: CachedAccountValidation =
    site.accountStatus === 'authenticated'
      ? {
          status: 'authenticated',
          message: site.accountMessage,
        }
      : await siteBridge
          .validateAccount(site.id)
          .then(result =>
            result.ok
              ? {
                  status: result.data.status,
                  message: result.data.message,
                }
              : {
                  status: 'error' as const,
                  message: result.error.message,
                },
          )
          .catch(error => ({
            status: 'error' as const,
            message: (error as Error).message,
          }))

  accountValidationCache.set(site.id, value)
  return value
}

function createSiteRowBase(reviewVariant: ReviewVariantState, site: SiteCatalogEntry) {
  return {
    key: `${reviewVariant.variantId}:${site.id}`,
    variantId: reviewVariant.variantId,
    variantName: reviewVariant.variantName,
    isActive: reviewVariant.isActive,
    siteId: site.id,
    siteName: site.name,
    adapterKind: site.adapter,
  }
}

async function buildAdapterReviewSite(
  reviewVariant: ReviewVariantState,
  site: SiteCatalogEntry,
  latestResult?: PublishResult,
) {
  const rowBase = createSiteRowBase(reviewVariant, site)
  const accountValidation = await resolveAccountValidation(site)

  if (accountValidation.status !== 'authenticated') {
    const accountMessage = accountValidation.message?.trim() || t('stage.review.confirm.adapter.accountUnauthenticated')
    return {
      ...rowBase,
      status: 'blocked',
      message: accountMessage,
      issues: [accountMessage],
      latestResult,
    } satisfies ReviewSiteRow
  }

  const result = await siteBridge.validatePublish({
    ...buildPublishInput({
      ...rowBase,
      status: 'ready',
      message: '',
      issues: [],
    }),
  })

  if (!result.ok) {
    return {
      ...rowBase,
      status: 'blocked',
      message: result.error.message,
      issues: [result.error.message],
      latestResult,
    } satisfies ReviewSiteRow
  }

  const issues = result.data.issues.map(issue => `${issue.field}: ${issue.message}`)
  return {
    ...rowBase,
    status: result.data.valid ? 'ready' : 'blocked',
    message: result.data.valid
      ? t('stage.review.confirm.adapter.validationPassed')
      : t('stage.review.confirm.adapter.validationFailed'),
    issues,
    validation: result.data,
    latestResult,
  } satisfies ReviewSiteRow
}

async function refreshChecks() {
  if (!reviewVariants.value.length) {
    siteRows.value = []
    return
  }

  isChecking.value = true
  publishError.value = ''
  accountValidationCache.clear()

  try {
    const nextRows: ReviewSiteRow[] = []

    for (const reviewVariant of reviewVariants.value) {
      const latestResultMap = getLatestPublishResultMap(reviewVariant.publishResults)

      for (const siteId of reviewVariant.targetSiteIds) {
        const site = sites.value.find(item => item.id === siteId)
        const latestResult = latestResultMap.get(siteId)

        if (latestResult?.status === 'published') {
          nextRows.push({
            key: `${reviewVariant.variantId}:${siteId}`,
            variantId: reviewVariant.variantId,
            variantName: reviewVariant.variantName,
            isActive: reviewVariant.isActive,
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
            key: `${reviewVariant.variantId}:${siteId}`,
            variantId: reviewVariant.variantId,
            variantName: reviewVariant.variantName,
            isActive: reviewVariant.isActive,
            siteId,
            siteName: getSiteLabel(siteId),
            status: 'blocked',
            message: t('stage.review.confirm.site.missingFromCatalog'),
            issues: [t('stage.review.confirm.site.missingFromCatalog')],
          })
          continue
        }

        nextRows.push(await buildAdapterReviewSite(reviewVariant, site, latestResult))
      }
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
  progressRows.value = visibleSiteRows.value.map(row => ({
    key: row.key,
    variantId: row.variantId,
    variantName: row.variantName,
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

function updateProgress(key: string, patch: Partial<PublishProgressRow>) {
  const row = progressRows.value.find(item => item.key === key)
  if (!row) {
    return
  }

  Object.assign(row, patch)
}

function appendVariantPublishResult(variantId: number, result: PublishResult) {
  reviewVariants.value = reviewVariants.value.map(variant =>
    variant.variantId === variantId
      ? {
          ...variant,
          publishResults: [...variant.publishResults, result],
        }
      : variant,
  )
}

async function publishAdapterSite(row: ReviewSiteRow) {
  const publishResult = await siteBridge.publish(buildPublishInput(row))
  const normalizedResult: PublishResult = publishResult.ok
    ? {
        ...publishResult.data.result,
        timestamp: publishResult.data.result.timestamp ?? new Date().toISOString(),
      }
    : {
        siteId: row.siteId,
        status: 'failed',
        message: publishResult.error.message,
        timestamp: new Date().toISOString(),
      }

  const recordResult = await projectBridge.recordSeriesVariantPublishResult({
    projectId: props.id,
    episodeId: reviewBundle.value?.episode.id ?? 0,
    variantId: row.variantId,
    result: normalizedResult,
    syncTaskState: row.isActive,
  })

  if (!recordResult.ok) {
    return {
      status: 'failed' as const,
      message: recordResult.error.message,
      result: normalizedResult,
    }
  }

  appendVariantPublishResult(row.variantId, normalizedResult)

  return {
    status: normalizedResult.status === 'published' ? ('published' as const) : ('failed' as const),
    message: normalizedResult.message ?? getPublishStateLabel(normalizedResult.status),
    result: normalizedResult,
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
      currentProgressLabel.value = t('stage.review.confirm.progress.publishingSite', {
        site: `${row.variantName} / ${row.siteName}`,
      })
      updateProgress(row.key, {
        status: 'publishing',
        message: t('stage.review.confirm.progress.runningAdapter'),
      })

      const publishResult = await publishAdapterSite(row)
      updateProgress(row.key, {
        status: publishResult.status,
        message: publishResult.message,
        remoteUrl: publishResult.result?.remoteUrl,
      })
      progressCompleted.value += 1
    }

    await refreshChecks()
    await refreshProject()

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
    const [siteResult, reviewResult] = await Promise.all([
      siteBridge.listSites(),
      projectBridge.getSeriesEpisodeReviewBundle(props.id),
    ])

    if (!siteResult.ok) {
      throw new Error(siteResult.error.message)
    }

    if (!reviewResult.ok) {
      throw new Error(reviewResult.error.message)
    }

    sites.value = siteResult.data.sites.filter(site => site.capabilitySet.publish.torrent)
    const sharedTargetSiteIds = (() => {
      const activeVariant = reviewResult.data.variants.find(variant => variant.isActive)
      const baseVariant = activeVariant ?? reviewResult.data.variants[0]
      return baseVariant ? [...new Set(resolveConfiguredTargetSites(baseVariant.config))] : []
    })()

    reviewBundle.value = reviewResult.data
    reviewVariants.value = reviewResult.data.variants.map(variant =>
      createReviewVariantState(variant, sharedTargetSiteIds),
    )
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
          <p v-if="episodeDisplayLabel" class="episode-confirm__section-text">
            当前集：{{ episodeDisplayLabel }}，共 {{ reviewVariants.length }} 个版本。
          </p>
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
            <p class="episode-confirm__section-text">{{ configuredTargetSitesText }}</p>
          </div>
          <el-button plain :loading="isChecking" @click="refreshChecks">
            {{ t('stage.review.confirm.actions.recheck') }}
          </el-button>
        </div>

        <div v-if="visibleSiteRows.length === 0" class="episode-confirm__empty">
          {{ t('stage.review.confirm.sections.siteChecks.empty') }}
        </div>

        <div v-else class="episode-confirm__site-grid">
          <article v-for="row in visibleSiteRows" :key="row.key" class="episode-confirm__site-card">
            <div class="episode-confirm__site-head">
              <div>
                <div class="episode-confirm__site-name">{{ row.siteName }}</div>
                <div class="episode-confirm__site-meta">
                  {{ row.variantName }}{{ row.isActive ? ' / 当前版本' : '' }} · {{ row.adapterKind || row.siteId }}
                </div>
              </div>
              <StatusChip :tone="getReviewTone(row.status)">
                {{ getReviewLabel(row.status) }}
              </StatusChip>
            </div>

            <div class="episode-confirm__site-message">{{ row.message }}</div>

            <ul v-if="row.issues.length > 0" class="episode-confirm__issue-list">
              <li v-for="issue in row.issues" :key="`${row.key}-${issue}`">
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
          <article v-for="torrent in torrentRows" :key="torrent.key" class="episode-confirm__torrent-card">
            <div class="episode-confirm__torrent-head">
              <div>
                <div class="episode-confirm__torrent-name">
                  {{ torrent.variantName }}{{ torrent.isActive ? ' / 当前版本' : '' }}
                </div>
                <div class="episode-confirm__torrent-path">{{ torrent.name }}</div>
                <div class="episode-confirm__torrent-path">{{ torrent.torrentPath }}</div>
              </div>
              <StatusChip :tone="torrent.title.trim() ? 'success' : 'danger'">
                {{
                  torrent.title.trim()
                    ? t('stage.review.confirm.torrent.titleReady')
                    : t('stage.review.confirm.torrent.titleMissing')
                }}
              </StatusChip>
            </div>

            <div class="episode-confirm__field">
              <div class="episode-confirm__field-label">{{ t('stage.review.confirm.torrent.publishTitle') }}</div>
              <div class="episode-confirm__field-value">
                {{ torrent.title.trim() || t('stage.review.confirm.torrent.titleValueMissing') }}
              </div>
            </div>

            <div class="episode-confirm__field">
              <div class="episode-confirm__field-label">{{ t('stage.review.confirm.torrent.targetSites') }}</div>
              <div class="episode-confirm__tag-row">
                <el-tag
                  v-for="siteId in torrent.targetSiteIds"
                  :key="`${torrent.key}-${siteId}`"
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
          <article v-for="row in progressRows" :key="`progress-${row.key}`" class="episode-confirm__progress-row">
            <div class="episode-confirm__progress-head">
              <div>
                <div class="episode-confirm__site-name">{{ row.siteName }}</div>
                <div class="episode-confirm__site-meta">{{ row.variantName }}</div>
              </div>
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
