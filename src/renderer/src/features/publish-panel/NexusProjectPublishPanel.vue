<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import { getPublishStateLabel, publishStateTones } from '../../services/project/presentation'
import type { PublishResult, SitePublishDraft } from '../../types/publish'
import type {
  SiteAccountValidationPayload,
  SiteCatalogEntry,
  SiteId,
  SiteMetadataRecord,
  SitePublishValidationPayload,
  SiteSection,
} from '../../types/site'
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
  posterUrl: string
  emuleResource: string
  syncKey: string
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
  disableDownloadSeedFile: boolean
  sectionId?: number
  categoryId?: number
  typeId?: number
  teamId?: number
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

interface BatchTorrentDraftForm {
  id: string
  name: string
  torrentPath: string
  title: string
}

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, refreshProject } = useProjectContext()

const isBootstrapping = ref(false)
const bootstrapError = ref('')
const sites = ref<SiteCatalogEntry[]>([])
const selectedSiteIds = ref<SiteId[]>([])
const advancedSiteIds = ref<string[]>([])
const metadataBySite = ref<Partial<Record<SiteId, SiteMetadataRecord>>>({})
const metadataErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const metadataLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const accountValidationBySite = ref<Partial<Record<SiteId, SiteAccountValidationPayload>>>({})
const accountValidationLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishDrafts = ref<Partial<Record<SiteId, SitePublishDraftForm>>>({})
const publishValidationBySite = ref<Partial<Record<SiteId, SitePublishValidationPayload>>>({})
const publishValidationLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const publishLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishResultBySite = ref<Partial<Record<SiteId, PublishResult>>>({})
const batchTorrentEntries = ref<BatchTorrentDraftForm[]>([])

const sharedDraft = reactive<SharedPublishDraftForm>({
  title: '',
  description: '',
  torrentPath: '',
  nfoPath: '',
  anonymous: false,
})

const selectedSites = computed(() => sites.value.filter(site => selectedSiteIds.value.includes(site.id)))
const isBatchTorrentMode = computed(() => batchTorrentEntries.value.length > 1)

const descriptionPreview = computed(() => {
  if (selectedSiteIds.value.length === 0) {
    return t('nexus.hero.noSiteSelected')
  }

  const total = Object.keys(metadataBySite.value).length
  return total > 0 ? t('nexus.hero.loadedMetadata', { count: total }) : t('nexus.hero.noMetadata')
})

const selectedSummary = computed(() => {
  if (selectedSiteIds.value.length === 0) {
    return t('nexus.selector.emptySummary')
  }

  return t('nexus.selector.selectedSummary', {
    count: selectedSiteIds.value.length,
    total: sites.value.length,
  })
})

function isMetadataLoading(siteId: SiteId) {
  return Boolean(metadataLoadingBySite.value[siteId])
}

function isAccountValidationLoading(siteId: SiteId) {
  return Boolean(accountValidationLoadingBySite.value[siteId])
}

function isPublishValidationLoading(siteId: SiteId) {
  return Boolean(publishValidationLoadingBySite.value[siteId])
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

function getAccountValidation(siteId: SiteId) {
  return accountValidationBySite.value[siteId]
}

function getPublishValidation(siteId: SiteId) {
  return publishValidationBySite.value[siteId]
}

function getPublishError(siteId: SiteId) {
  return publishErrorBySite.value[siteId]
}

function getPublishResult(siteId: SiteId) {
  return publishResultBySite.value[siteId]
}

function getSite(siteId: SiteId) {
  return sites.value.find(site => site.id === siteId)
}

function isUnit3dSite(site: SiteCatalogEntry) {
  return site.adapter === 'unit3d'
}

function isMikanSite(site: SiteCatalogEntry) {
  return site.adapter === 'mikan'
}

function isDmhySite(site: SiteCatalogEntry) {
  return site.adapter === 'dmhy'
}

function supportsMetadata(site: SiteCatalogEntry) {
  return site.capabilitySet.metadata.sections
}

function hasSiteSpecificRequiredFields(site: SiteCatalogEntry) {
  return (site.fieldSchemas ?? []).some(field => field.mode === 'required')
}

function hasOptionalSiteFields(site: SiteCatalogEntry) {
  return supportsMetadata(site) || isUnit3dSite(site) || isMikanSite(site)
}

function isSiteSelected(siteId: SiteId) {
  return selectedSiteIds.value.includes(siteId)
}

function toggleSite(siteId: SiteId) {
  if (isSiteSelected(siteId)) {
    selectedSiteIds.value = selectedSiteIds.value.filter(id => id !== siteId)
    advancedSiteIds.value = advancedSiteIds.value.filter(id => id !== siteId)
    return
  }

  selectedSiteIds.value = [...selectedSiteIds.value, siteId]
}

function getMetadataStateLabel(site: SiteCatalogEntry) {
  if (isMetadataLoading(site.id)) {
    return t('nexus.selector.metadataLoading')
  }

  if (!hasSiteSpecificRequiredFields(site)) {
    return t('nexus.selector.sharedOnly')
  }

  if (!supportsMetadata(site)) {
    return t('nexus.selector.manualEntry')
  }

  return getMetadata(site.id) ? t('nexus.selector.metadataReady') : t('nexus.selector.metadataPending')
}

function getMetadataStateTone(site: SiteCatalogEntry): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (isMetadataLoading(site.id)) {
    return 'info'
  }

  if (!hasSiteSpecificRequiredFields(site)) {
    return 'neutral'
  }

  if (!supportsMetadata(site)) {
    return 'neutral'
  }

  if (getMetadataError(site.id)) {
    return 'danger'
  }

  return getMetadata(site.id) ? 'success' : 'warning'
}

function getAccountStatusLabel(siteId: SiteId) {
  const status = getAccountValidation(siteId)?.status
  if (status === 'authenticated') {
    return t('nexus.account.authenticated')
  }
  if (status === 'unauthenticated') {
    return t('nexus.account.unauthenticated')
  }
  return t('nexus.account.error')
}

function getSharedFieldText(site: SiteCatalogEntry) {
  if (isMikanSite(site)) {
    return t('nexus.site.sharedFieldsMikan')
  }

  if (isDmhySite(site)) {
    return t('nexus.site.sharedFieldsDmhy')
  }

  return t('nexus.site.sharedFields')
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

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function createBatchTorrentEntries(config: Config.PublishConfig) {
  const rawContent = config.content
  if (!rawContent || typeof rawContent !== 'object' || !('episodeLabel' in rawContent)) {
    return [] as BatchTorrentDraftForm[]
  }

  const rawEntries = Array.isArray(config.torrentEntries) ? config.torrentEntries : []
  const activeTorrentId = readOptionalString(config.activeTorrentId)
  const fallbackTitle = typeof config.title === 'string' ? config.title : ''
  const selectedEntries = rawEntries.reduce<Array<BatchTorrentDraftForm & { enabled: boolean }>>((entries, raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return entries
    }

    const path = readOptionalString((raw as Record<string, unknown>).path)
    if (!path) {
      return entries
    }

    const id = readOptionalString((raw as Record<string, unknown>).id) ?? `torrent-${index + 1}`
    entries.push({
      id,
      name: readOptionalString((raw as Record<string, unknown>).name) ?? getFileName(path),
      torrentPath: path,
      title:
        typeof (raw as Record<string, unknown>).titleOverride === 'string'
          ? ((raw as Record<string, unknown>).titleOverride as string)
          : id === activeTorrentId
            ? fallbackTitle
            : '',
      enabled: (raw as Record<string, unknown>).enabled !== false,
    })
    return entries
  }, [])

  const batchEntries = selectedEntries.filter(entry => entry.enabled)
  if (batchEntries.length <= 1) {
    return [] as BatchTorrentDraftForm[]
  }

  return batchEntries.map(({ enabled, ...entry }) => {
    void enabled
    return entry
  })
}

function createEmptyDraft(): SitePublishDraftForm {
  return {
    title: '',
    description: '',
    torrentPath: '',
    trackersText: '',
    posterUrl: '',
    emuleResource: '',
    syncKey: '',
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
    disableDownloadSeedFile: false,
    sectionId: undefined,
    categoryId: undefined,
    typeId: undefined,
    teamId: undefined,
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
    const value = readStoredNumber(raw)
    if (typeof value === 'number' && value > 0) {
      accumulator[key] = value
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
  draft.teamId = readStoredNumber(siteFieldDefaults.teamId)
  draft.resolutionId = readStoredNumber(siteFieldDefaults.resolutionId)
  draft.trackersText = readStoredTrackersText(siteFieldDefaults.trackers ?? siteFieldDefaults.trackersText)
  draft.posterUrl = readStoredString(siteFieldDefaults.posterUrl)
  draft.emuleResource = readStoredString(siteFieldDefaults.emuleResource)
  draft.syncKey = readStoredString(siteFieldDefaults.syncKey)
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
  draft.disableDownloadSeedFile = readStoredBoolean(siteFieldDefaults.disableDownloadSeedFile)

  return draft
}

function applySharedDraft(config: Config.PublishConfig, content: Message.Task.TaskContents) {
  sharedDraft.title = config.title ?? content.title ?? ''
  sharedDraft.description = content.html ?? ''
  sharedDraft.torrentPath =
    config.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, config.torrentName)
      : config.torrentPath ?? ''
  sharedDraft.nfoPath = ''
  sharedDraft.anonymous = false
}

function createInitialDraft(config: Config.PublishConfig, content: Message.Task.TaskContents, siteId: SiteId): SitePublishDraftForm {
  const draft = createEmptyDraft()
  draft.title = config.title ?? content.title ?? ''
  draft.description = content.html ?? ''
  draft.url = config.information ?? ''
  draft.torrentPath =
    config.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, config.torrentName)
      : config.torrentPath ?? ''
  const storedFieldDefaults = normalizeStoredSiteFieldDefaults(config.siteFieldDefaults)?.[siteId]
  return applyStoredSiteFieldDefaults(draft, storedFieldDefaults)
}

function ensureDraft(siteId: SiteId): SitePublishDraftForm {
  if (!publishDrafts.value[siteId]) {
    publishDrafts.value[siteId] = createEmptyDraft()
  }

  return publishDrafts.value[siteId] as SitePublishDraftForm
}

function resetSectionDependentFields(siteId: SiteId, section?: SiteSection) {
  const draft = ensureDraft(siteId)
  draft.typeId = section?.categories[0]?.id
  draft.tagIds = []
  draft.subCategories = Object.fromEntries(
    (section?.subCategories ?? []).map(subCategory => [subCategory.field, undefined]),
  )
}

function resolveMetadataSectionForDraft(siteId: SiteId, metadata: SiteMetadataRecord) {
  const draft = ensureDraft(siteId)
  if (draft.sectionId) {
    const matchedBySection = metadata.sections.find(section => section.id === draft.sectionId)
    if (matchedBySection) {
      return matchedBySection
    }
  }

  if (draft.typeId) {
    const matchedByType = metadata.sections.find(section =>
      section.categories.some(category => category.id === draft.typeId),
    )
    if (matchedByType) {
      return matchedByType
    }
  }

  return metadata.sections[0]
}

function applyMetadataDefaults(siteId: SiteId, metadata: SiteMetadataRecord) {
  const draft = ensureDraft(siteId)
  const section = resolveMetadataSectionForDraft(siteId, metadata)
  draft.sectionId = section?.id
  if (!draft.typeId || !section?.categories.some(category => category.id === draft.typeId)) {
    draft.typeId = section?.categories[0]?.id
  }
  const teamField = section?.subCategories.find(subCategory => subCategory.field === 'teamId')
  if (teamField && (!draft.teamId || !teamField.data.some(option => option.id === draft.teamId))) {
    draft.teamId = teamField.data[0]?.id
  }
  draft.subCategories = Object.fromEntries(
    (section?.subCategories ?? []).map(subCategory => [subCategory.field, draft.subCategories[subCategory.field]]),
  )
}

function getSelectedSection(siteId: SiteId) {
  const metadata = getMetadata(siteId)
  const draft = ensureDraft(siteId)
  return metadata?.sections.find(section => section.id === draft.sectionId) ?? metadata?.sections[0]
}

function getDmhyMetadataSection(siteId: SiteId) {
  return getMetadata(siteId)?.sections[0]
}

function getDmhyTeamOptions(siteId: SiteId) {
  return getDmhyMetadataSection(siteId)?.subCategories.find(subCategory => subCategory.field === 'teamId')?.data ?? []
}

function onSectionChange(siteId: SiteId) {
  resetSectionDependentFields(siteId, getSelectedSection(siteId))
}

function buildPublishInput(siteId: SiteId): SitePublishDraft {
  const draft = ensureDraft(siteId)
  const site = getSite(siteId)
  const primaryBatchEntry = batchTorrentEntries.value[0]
  const resolvedTitle = isBatchTorrentMode.value ? primaryBatchEntry?.title.trim() ?? '' : sharedDraft.title.trim()
  const resolvedTorrentPath = isBatchTorrentMode.value
    ? primaryBatchEntry?.torrentPath.trim() ?? ''
    : sharedDraft.torrentPath.trim()

  const baseInput: SitePublishDraft = {
    projectId: props.id,
    siteId,
    typeId: draft.typeId ?? 0,
    title: resolvedTitle,
    description: sharedDraft.description.trim(),
    torrentPath: resolvedTorrentPath,
    batchEntries: isBatchTorrentMode.value
      ? batchTorrentEntries.value.map(entry => ({
          id: entry.id,
          name: entry.name,
          torrentPath: entry.torrentPath.trim(),
          title: entry.title,
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

  if (site?.adapter === 'dmhy') {
    const trackers = parseTrackerText(draft.trackersText)
    return {
      ...baseInput,
      teamId: draft.teamId,
      posterUrl: draft.posterUrl.trim() || undefined,
      trackers: trackers.length > 0 ? trackers : undefined,
      disableDownloadSeedFile: draft.disableDownloadSeedFile,
      emuleResource: draft.emuleResource.trim() || undefined,
      syncKey: draft.syncKey.trim() || undefined,
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

async function chooseCommonFile(field: 'torrentPath' | 'nfoPath', extension: string) {
  const message: Message.Global.FileType = { type: extension }
  const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFilePath(JSON.stringify(message)))
  if (path) {
    sharedDraft[field] = path
  }
}

async function validateAccount(siteId: SiteId) {
  accountValidationLoadingBySite.value[siteId] = true

  try {
    const result = await siteBridge.validateAccount(siteId)
    if (!result.ok) {
      accountValidationBySite.value[siteId] = {
        siteId,
        status: 'error',
        message: result.error.message,
      }
      return
    }

    accountValidationBySite.value[siteId] = result.data
  } catch (error) {
    accountValidationBySite.value[siteId] = {
      siteId,
      status: 'error',
      message: (error as Error).message,
    }
  } finally {
    accountValidationLoadingBySite.value[siteId] = false
  }
}

async function loadMetadata(siteId: SiteId) {
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

async function validatePublish(siteId: SiteId) {
  publishValidationLoadingBySite.value[siteId] = true
  publishErrorBySite.value[siteId] = ''

  try {
    const result = await siteBridge.validatePublish(buildPublishInput(siteId))
    if (!result.ok) {
      publishValidationBySite.value[siteId] = {
        siteId,
        valid: false,
        issues: [
          {
            field: 'publish',
            message: result.error.message,
            severity: 'error',
          },
        ],
      }
      return false
    }

    publishValidationBySite.value[siteId] = result.data
    return result.data.valid
  } catch (error) {
    publishValidationBySite.value[siteId] = {
      siteId,
      valid: false,
      issues: [
        {
          field: 'publish',
          message: (error as Error).message,
          severity: 'error',
        },
      ],
    }
    return false
  } finally {
    publishValidationLoadingBySite.value[siteId] = false
  }
}

async function publishSite(siteId: SiteId) {
  publishLoadingBySite.value[siteId] = true
  publishErrorBySite.value[siteId] = ''

  try {
    const isValid = await validatePublish(siteId)
    if (!isValid) {
      publishResultBySite.value[siteId] = undefined
      publishErrorBySite.value[siteId] = t('nexus.validation.fixIssues')
      return
    }

    const result = await siteBridge.publish(buildPublishInput(siteId))
    if (!result.ok) {
      publishResultBySite.value[siteId] = undefined
      publishErrorBySite.value[siteId] = result.error.message
      return
    }

    publishResultBySite.value[siteId] = result.data.result
    await refreshProject()
  } catch (error) {
    publishResultBySite.value[siteId] = undefined
    publishErrorBySite.value[siteId] = (error as Error).message
  } finally {
    publishLoadingBySite.value[siteId] = false
  }
}

function formatRawResponse(rawResponse: unknown) {
  if (rawResponse === undefined) {
    return ''
  }

  return JSON.stringify(rawResponse, null, 2)
}

async function bootstrap() {
  isBootstrapping.value = true
  bootstrapError.value = ''

  try {
    const [siteResult, content, config] = await Promise.all([
      siteBridge.listSites(),
      taskBridge.getContent(props.id),
      taskBridge.getPublishConfig(props.id),
    ])

    if (!siteResult.ok) {
      bootstrapError.value = siteResult.error.message
      sites.value = []
      return
    }

    sites.value = siteResult.data.sites.filter(
      site => site.adapter === 'mikan' || site.adapter === 'nexusphp' || site.adapter === 'unit3d',
    )
    applySharedDraft(config, content)
    batchTorrentEntries.value = createBatchTorrentEntries(config)
    sites.value.forEach(site => {
      publishDrafts.value[site.id] = createInitialDraft(config, content, site.id)
      publishErrorBySite.value[site.id] = ''
      publishResultBySite.value[site.id] = undefined
      publishValidationBySite.value[site.id] = undefined
      accountValidationBySite.value[site.id] = undefined
    })

    const targetSiteIds = (project.value?.targetSites ?? []).filter(siteId =>
      sites.value.some(site => site.id === siteId),
    )
    selectedSiteIds.value = targetSiteIds.length > 0 ? [...targetSiteIds] : sites.value.length === 1 ? [sites.value[0].id] : []
  } catch (error) {
    bootstrapError.value = (error as Error).message
  } finally {
    isBootstrapping.value = false
  }
}

watch(selectedSiteIds, siteIds => {
  siteIds.forEach(siteId => {
    const site = getSite(siteId)
    if (site && supportsMetadata(site) && !getMetadata(siteId) && !isMetadataLoading(siteId)) {
      void loadMetadata(siteId)
    }
  })
})

onMounted(() => {
  void bootstrap()
})
</script>

<template>
  <section class="nexus-panel">
    <header class="nexus-panel__header">
      <div>
        <div class="nexus-panel__eyebrow">{{ t('nexus.hero.eyebrow') }}</div>
        <h3 class="nexus-panel__title">{{ t('sites.publish.title') }}</h3>
        <p class="nexus-panel__description">
          {{ t('nexus.hero.descriptionPrefix', { summary: descriptionPreview }) }}
        </p>
      </div>
      <StatusChip tone="success">{{ t('nexus.hero.count', { count: sites.length }) }}</StatusChip>
    </header>

    <div v-if="isBootstrapping" class="nexus-panel__empty">{{ t('nexus.empty.loading') }}</div>
    <div v-else-if="bootstrapError" class="nexus-panel__empty nexus-panel__empty--danger">
      {{ bootstrapError }}
    </div>
    <div v-else class="nexus-panel__stack">
      <article class="nexus-block">
        <header class="nexus-block__header">
          <div>
            <h4 class="nexus-block__title">{{ t('nexus.common.title') }}</h4>
            <p class="nexus-block__description">{{ t('nexus.common.description') }}</p>
          </div>
          <StatusChip tone="info">{{ t('nexus.common.hint') }}</StatusChip>
        </header>

        <div v-if="isBatchTorrentMode" class="nexus-batch">
          <div class="nexus-batch__intro">
            <StatusChip tone="warning">{{ batchTorrentEntries.length }} Torrent Titles</StatusChip>
            <span class="nexus-batch__intro-text">
              Batch mode is active. Each torrent uses its own publish title.
            </span>
          </div>

          <article v-for="(entry, index) in batchTorrentEntries" :key="entry.id" class="nexus-batch__entry">
            <div class="nexus-batch__entry-head">
              <div>
                <div class="nexus-batch__entry-label">Torrent {{ index + 1 }}</div>
                <div class="nexus-batch__entry-name">{{ entry.name }}</div>
              </div>
              <StatusChip :tone="entry.title.trim() ? 'success' : 'warning'">
                {{ entry.title.trim() ? 'Title ready' : 'Title required' }}
              </StatusChip>
            </div>

            <el-form-item :label="`${t('sites.form.title')} · ${entry.name}`">
              <el-input v-model="entry.title" :placeholder="`Used when uploading ${entry.name}`" />
            </el-form-item>

            <div class="nexus-batch__entry-hint">
              This title field belongs to <strong>{{ entry.name }}</strong>.
            </div>

            <el-form-item :label="t('sites.form.torrentFile')">
              <el-input :model-value="entry.torrentPath" readonly />
            </el-form-item>
          </article>
        </div>

        <div v-else class="nexus-form__grid">
          <el-form-item :label="t('sites.form.title')">
            <el-input v-model="sharedDraft.title" />
          </el-form-item>
          <el-form-item :label="t('sites.form.torrentFile')">
            <div class="file-picker">
              <el-input v-model="sharedDraft.torrentPath" />
              <el-button plain @click="chooseCommonFile('torrentPath', 'torrent')">
                {{ t('sites.actions.pickTorrent') }}
              </el-button>
            </div>
          </el-form-item>
        </div>

        <el-form-item :label="t('sites.form.description')">
          <el-input v-model="sharedDraft.description" type="textarea" :rows="6" />
        </el-form-item>

        <div class="nexus-form__grid">
          <el-form-item :label="t('sites.form.nfoFile')">
            <div class="file-picker">
              <el-input v-model="sharedDraft.nfoPath" />
              <el-button plain @click="chooseCommonFile('nfoPath', 'nfo')">{{ t('sites.actions.pickNfo') }}</el-button>
            </div>
          </el-form-item>
          <div class="nexus-common__flags">
            <el-checkbox v-model="sharedDraft.anonymous">{{ t('sites.flags.anonymous') }}</el-checkbox>
          </div>
        </div>
      </article>

      <article class="nexus-block">
        <header class="nexus-block__header">
          <div>
            <h4 class="nexus-block__title">{{ t('nexus.selector.title') }}</h4>
            <p class="nexus-block__description">{{ t('nexus.selector.description') }}</p>
          </div>
          <StatusChip tone="warning">{{ selectedSummary }}</StatusChip>
        </header>

        <div class="nexus-selector">
          <button
            v-for="site in sites"
            :key="site.id"
            type="button"
            class="nexus-selector__card"
            :class="{ 'nexus-selector__card--active': isSiteSelected(site.id) }"
            @click="toggleSite(site.id)"
          >
            <div class="nexus-selector__card-head">
              <div>
                <div class="nexus-selector__name">{{ site.name }}</div>
                <div class="nexus-selector__endpoint">{{ site.apiBaseUrl || site.normalizedBaseUrl }}</div>
              </div>
              <StatusChip :tone="isSiteSelected(site.id) ? 'success' : 'neutral'">
                {{ isSiteSelected(site.id) ? t('nexus.selector.selected') : t('nexus.selector.unselected') }}
              </StatusChip>
            </div>
            <div class="nexus-selector__meta">
              <StatusChip :tone="getMetadataStateTone(site)">
                {{ getMetadataStateLabel(site) }}
              </StatusChip>
              <StatusChip v-if="getPublishResult(site.id)" :tone="publishStateTones[getPublishResult(site.id)!.status]">
                {{ getPublishStateLabel(getPublishResult(site.id)!.status) }}
              </StatusChip>
            </div>
          </button>
        </div>
      </article>

      <div v-if="selectedSites.length === 0" class="nexus-panel__empty">
        {{ t('nexus.site.noSitesSelected') }}
      </div>

      <article v-for="site in selectedSites" :key="site.id" class="nexus-site-card">
        <header class="nexus-site-card__header">
          <div>
            <div class="nexus-site-card__name">{{ site.name }}</div>
            <div class="nexus-site-card__endpoint">{{ site.apiBaseUrl || site.normalizedBaseUrl }}</div>
            <p class="nexus-site-card__shared-text">{{ getSharedFieldText(site) }}</p>
          </div>
          <div class="nexus-site-card__header-actions">
            <el-button
              :loading="isAccountValidationLoading(site.id)"
              type="primary"
              plain
              @click="validateAccount(site.id)"
            >
              {{ t('nexus.actions.validateAccount') }}
            </el-button>
            <el-button
              v-if="supportsMetadata(site)"
              :loading="isMetadataLoading(site.id)"
              type="primary"
              plain
              @click="loadMetadata(site.id)"
            >
              {{ getMetadata(site.id) ? t('nexus.actions.reloadMetadata') : t('nexus.actions.loadMetadata') }}
            </el-button>
          </div>
        </header>

        <div v-if="getAccountValidation(site.id)" class="nexus-site-card__account-status">
          <StatusChip
            :tone="
              getAccountValidation(site.id)?.status === 'authenticated'
                ? 'success'
                : getAccountValidation(site.id)?.status === 'unauthenticated'
                  ? 'warning'
                  : 'danger'
            "
          >
            {{ getAccountStatusLabel(site.id) }}
          </StatusChip>
          <span class="nexus-site-card__account-text">{{ getAccountValidation(site.id)?.message }}</span>
        </div>

        <div v-if="site.notes.length > 0" class="nexus-site-card__notes">
          <span v-for="note in site.notes" :key="note" class="nexus-site-card__note">{{ note }}</span>
        </div>

        <section class="nexus-site-card__body">
          <div class="nexus-site-card__section-title">{{ t('nexus.site.requiredSection') }}</div>

          <div v-if="site.adapter === 'nexusphp' && supportsMetadata(site) && getMetadata(site.id)" class="nexus-form__grid">
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

          <div v-else-if="isDmhySite(site) && getMetadata(site.id)" class="nexus-form__grid">
            <el-form-item :label="t('sites.form.category')">
              <el-select v-model="ensureDraft(site.id).typeId">
                <el-option
                  v-for="category in getDmhyMetadataSection(site.id)?.categories ?? []"
                  :key="category.id"
                  :label="`${category.name} (${category.id})`"
                  :value="category.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="t('sites.form.teamId')">
              <el-select v-model="ensureDraft(site.id).teamId">
                <el-option
                  v-for="team in getDmhyTeamOptions(site.id)"
                  :key="team.id"
                  :label="`${team.name} (${team.id})`"
                  :value="team.id"
                />
              </el-select>
            </el-form-item>
          </div>

          <div v-else-if="site.adapter === 'nexusphp'" class="nexus-site-card__manual">
            <div class="nexus-site-card__hint">
              {{ getMetadataError(site.id) || t('nexus.site.manualTypeHint') }}
            </div>
            <div class="nexus-form__grid">
              <el-form-item :label="t('nexus.site.manualTypeId')">
                <el-input-number v-model="ensureDraft(site.id).typeId" :controls="false" :min="1" />
              </el-form-item>
            </div>
          </div>

          <div v-else-if="isDmhySite(site)" class="nexus-site-card__manual">
            <div class="nexus-site-card__hint">
              {{ getMetadataError(site.id) || t('nexus.site.dmhyManualHint') }}
            </div>
            <div class="nexus-form__grid">
              <el-form-item :label="t('sites.form.category')">
                <el-input-number v-model="ensureDraft(site.id).typeId" :controls="false" :min="1" />
              </el-form-item>
              <el-form-item :label="t('sites.form.teamId')">
                <el-input-number v-model="ensureDraft(site.id).teamId" :controls="false" :min="0" />
              </el-form-item>
            </div>
          </div>

          <div v-else-if="site.adapter === 'unit3d'" class="nexus-form__grid nexus-form__grid--meta">
            <el-form-item :label="t('nexus.site.manualCategoryId')">
              <el-input-number v-model="ensureDraft(site.id).categoryId" :controls="false" :min="1" />
            </el-form-item>
            <el-form-item :label="t('nexus.site.manualTypeId')">
              <el-input-number v-model="ensureDraft(site.id).typeId" :controls="false" :min="1" />
            </el-form-item>
            <el-form-item :label="t('nexus.site.manualResolutionId')">
              <el-input-number v-model="ensureDraft(site.id).resolutionId" :controls="false" :min="1" />
            </el-form-item>
          </div>

          <div v-else class="nexus-site-card__manual">
            <div class="nexus-site-card__hint">
              {{ t('nexus.site.noRequiredFields') }}
            </div>
          </div>

          <el-collapse v-if="hasOptionalSiteFields(site)" v-model="advancedSiteIds" class="nexus-site-card__collapse">
            <el-collapse-item :name="site.id" :title="t('nexus.site.optionalSection')">
              <div v-if="site.adapter === 'nexusphp' && supportsMetadata(site)" class="nexus-site-card__optional-stack">
                <div class="nexus-form__grid">
                  <el-form-item :label="t('sites.form.smallDescription')">
                    <el-input v-model="ensureDraft(site.id).smallDescription" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.referenceUrl')">
                    <el-input v-model="ensureDraft(site.id).url" />
                  </el-form-item>
                </div>

                <div class="nexus-form__grid nexus-form__grid--meta">
                  <el-form-item :label="t('sites.form.ptgen')">
                    <el-input v-model="ensureDraft(site.id).ptGen" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.technicalInfo')">
                    <el-input v-model="ensureDraft(site.id).technicalInfo" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.price')">
                    <el-input v-model="ensureDraft(site.id).price" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.positionUntil')">
                    <el-input v-model="ensureDraft(site.id).posStateUntil" placeholder="YYYY-MM-DD HH:mm:ss" />
                  </el-form-item>
                </div>

                <div class="nexus-form__grid nexus-form__grid--meta">
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
                </div>

                <div
                  v-if="(getSelectedSection(site.id)?.subCategories?.length ?? 0) > 0"
                  class="nexus-form__grid"
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
              </div>

              <div v-if="isDmhySite(site)" class="nexus-site-card__optional-stack">
                <div class="nexus-site-card__hint">
                  {{ t('nexus.site.dmhyOptionalHint') }}
                </div>

                <div class="nexus-form__grid">
                  <el-form-item :label="t('sites.form.posterUrl')">
                    <el-input v-model="ensureDraft(site.id).posterUrl" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.syncKey')">
                    <el-input v-model="ensureDraft(site.id).syncKey" />
                  </el-form-item>
                </div>

                <el-form-item :label="t('sites.form.trackers')">
                  <el-input
                    v-model="ensureDraft(site.id).trackersText"
                    type="textarea"
                    :rows="4"
                    :placeholder="t('sites.form.trackersPlaceholder')"
                  />
                </el-form-item>

                <el-form-item :label="t('sites.form.emuleResource')">
                  <el-input v-model="ensureDraft(site.id).emuleResource" type="textarea" :rows="4" />
                </el-form-item>

                <div class="nexus-site-card__flags">
                  <el-checkbox v-model="ensureDraft(site.id).disableDownloadSeedFile">
                    {{ t('sites.form.disableDownloadSeedFile') }}
                  </el-checkbox>
                </div>
              </div>

              <div v-if="isMikanSite(site)" class="nexus-site-card__optional-stack">
                <div class="nexus-site-card__hint">
                  {{ t('nexus.site.mikanOptionalHint') }}
                </div>

                <div class="nexus-form__grid">
                  <el-form-item :label="t('sites.form.bangumiId')">
                    <el-input-number v-model="ensureDraft(site.id).bangumiId" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item :label="t('sites.form.subtitleGroupId')">
                    <el-input-number v-model="ensureDraft(site.id).subtitleGroupId" :controls="false" :min="1" />
                  </el-form-item>
                </div>

                <div class="nexus-form__grid">
                  <el-form-item :label="t('sites.form.publishGroupId')">
                    <el-input-number v-model="ensureDraft(site.id).publishGroupId" :controls="false" :min="1" />
                  </el-form-item>
                  <div />
                </div>

                <el-form-item :label="t('sites.form.trackers')">
                  <el-input
                    v-model="ensureDraft(site.id).trackersText"
                    type="textarea"
                    :rows="4"
                    :placeholder="t('sites.form.trackersPlaceholder')"
                  />
                </el-form-item>
              </div>

              <div v-if="isUnit3dSite(site)" class="nexus-site-card__optional-stack">
                <div class="nexus-form__grid">
                  <el-form-item label="MediaInfo">
                    <el-input v-model="ensureDraft(site.id).mediaInfo" type="textarea" :rows="5" />
                  </el-form-item>
                  <el-form-item label="BDInfo">
                    <el-input v-model="ensureDraft(site.id).bdInfo" type="textarea" :rows="5" />
                  </el-form-item>
                </div>

                <div class="nexus-form__grid nexus-form__grid--meta">
                  <el-form-item label="Region ID">
                    <el-input-number v-model="ensureDraft(site.id).regionId" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="Distributor ID">
                    <el-input-number v-model="ensureDraft(site.id).distributorId" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="TMDB">
                    <el-input-number v-model="ensureDraft(site.id).tmdb" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="IMDB">
                    <el-input-number v-model="ensureDraft(site.id).imdb" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="TVDB">
                    <el-input-number v-model="ensureDraft(site.id).tvdb" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="MAL">
                    <el-input-number v-model="ensureDraft(site.id).mal" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="IGDB">
                    <el-input-number v-model="ensureDraft(site.id).igdb" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="Season">
                    <el-input-number v-model="ensureDraft(site.id).seasonNumber" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="Episode">
                    <el-input-number v-model="ensureDraft(site.id).episodeNumber" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="Free %">
                    <el-input-number v-model="ensureDraft(site.id).free" :controls="false" :min="0" :max="100" />
                  </el-form-item>
                  <el-form-item label="Freeleech Days">
                    <el-input-number v-model="ensureDraft(site.id).flUntil" :controls="false" :min="1" />
                  </el-form-item>
                  <el-form-item label="Double Upload Days">
                    <el-input-number v-model="ensureDraft(site.id).duUntil" :controls="false" :min="1" />
                  </el-form-item>
                </div>

                <div class="nexus-site-card__flags">
                  <el-checkbox v-model="ensureDraft(site.id).personalRelease">Personal Release</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).internal">Internal</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).refundable">Refundable</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).featured">Featured</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).doubleup">Double Upload</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).sticky">Sticky</el-checkbox>
                  <el-checkbox v-model="ensureDraft(site.id).modQueueOptIn">Mod Queue Opt-In</el-checkbox>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>

          <div class="nexus-site-card__actions">
            <div class="nexus-site-card__action-buttons">
              <el-button :loading="isPublishValidationLoading(site.id)" plain type="primary" @click="validatePublish(site.id)">
                {{ t('nexus.actions.runChecks') }}
              </el-button>
              <el-button :loading="isPublishLoading(site.id)" type="primary" @click="publishSite(site.id)">
                {{ t('sites.actions.publishViaAdapter') }}
              </el-button>
            </div>
          </div>

          <div v-if="getPublishValidation(site.id)" class="nexus-site-card__validation">
            <StatusChip :tone="getPublishValidation(site.id)?.valid ? 'success' : 'warning'">
              {{ getPublishValidation(site.id)?.valid ? t('nexus.validation.passed') : t('nexus.validation.found') }}
            </StatusChip>
            <ul v-if="(getPublishValidation(site.id)?.issues.length ?? 0) > 0" class="nexus-site-card__issues">
              <li v-for="issue in getPublishValidation(site.id)?.issues ?? []" :key="`${issue.field}-${issue.message}`">
                <strong>{{ issue.field }}</strong>: {{ issue.message }}
              </li>
            </ul>
          </div>

          <div v-if="getPublishError(site.id)" class="nexus-site-card__error">
            {{ getPublishError(site.id) }}
          </div>

          <div v-if="getPublishResult(site.id)" class="nexus-site-card__result">
            <StatusChip :tone="publishStateTones[getPublishResult(site.id)!.status]">
              {{ getPublishStateLabel(getPublishResult(site.id)!.status) }}
            </StatusChip>
            <a
              v-if="getPublishResult(site.id)?.remoteUrl"
              :href="getPublishResult(site.id)?.remoteUrl"
              class="nexus-site-card__result-link"
              target="_blank"
            >
              {{ getPublishResult(site.id)?.remoteUrl }}
            </a>
            <pre class="nexus-site-card__raw">{{ formatRawResponse(getPublishResult(site.id)?.rawResponse) }}</pre>
          </div>
        </section>
      </article>
    </div>
  </section>
</template>

<style scoped>
.nexus-panel,
.nexus-panel__stack,
.nexus-site-card__body,
.nexus-site-card__validation,
.nexus-site-card__result,
.nexus-site-card__optional-stack,
.nexus-batch,
.nexus-batch__entry {
  display: grid;
  gap: 16px;
}

.nexus-panel__header,
.nexus-block__header,
.nexus-site-card__header,
.nexus-site-card__header-actions,
.nexus-site-card__account-status,
.nexus-site-card__actions,
.nexus-site-card__action-buttons,
.nexus-site-card__notes,
.nexus-site-card__flags,
.file-picker,
.nexus-common__flags,
.nexus-selector__card-head,
.nexus-selector__meta,
.nexus-batch__intro,
.nexus-batch__entry-head {
  display: flex;
}

.nexus-panel {
  flex-direction: column;
  gap: 18px;
}

.nexus-panel__header,
.nexus-block__header,
.nexus-site-card__header,
.nexus-site-card__actions,
.nexus-selector__card-head,
.nexus-batch__intro,
.nexus-batch__entry-head {
  justify-content: space-between;
  gap: 14px;
}

.nexus-site-card__header-actions,
.nexus-site-card__action-buttons,
.nexus-site-card__account-status,
.nexus-site-card__notes,
.nexus-site-card__flags,
.nexus-selector__meta {
  gap: 10px;
}

.nexus-site-card__account-status,
.nexus-common__flags {
  align-items: center;
}

.nexus-panel__eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.nexus-panel__title,
.nexus-block__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  letter-spacing: -0.04em;
}

.nexus-panel__title {
  font-size: 24px;
}

.nexus-block__title {
  font-size: 20px;
}

.nexus-panel__description,
.nexus-block__description,
.nexus-selector__endpoint,
.nexus-site-card__endpoint,
.nexus-site-card__account-text,
.nexus-site-card__error,
.nexus-site-card__hint,
.nexus-site-card__result-link,
.nexus-site-card__shared-text,
.nexus-batch__intro-text,
.nexus-batch__entry-hint {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.nexus-panel__description,
.nexus-block__description,
.nexus-site-card__shared-text {
  margin: 12px 0 0;
}

.nexus-panel__empty {
  padding: 32px 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  text-align: center;
}

.nexus-panel__empty--danger,
.nexus-site-card__error {
  color: var(--danger);
}

.nexus-block,
.nexus-site-card,
.nexus-selector__card,
.nexus-batch__entry {
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.nexus-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 12px;
}

.nexus-selector__card {
  display: grid;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.nexus-selector__card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.nexus-selector__card--active {
  border-color: rgba(230, 156, 28, 0.48);
  box-shadow: 0 18px 38px rgba(230, 156, 28, 0.12);
}

.nexus-selector__name,
.nexus-site-card__name {
  font-weight: 700;
}

.nexus-selector__meta,
.nexus-site-card__notes,
.nexus-site-card__flags {
  flex-wrap: wrap;
}

.nexus-site-card__section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nexus-site-card__note {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(12, 24, 45, 0.06);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.nexus-batch__intro,
.nexus-batch__entry-head {
  align-items: flex-start;
}

.nexus-batch__entry {
  gap: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.nexus-batch__entry-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.nexus-batch__entry-name {
  margin-top: 6px;
  font-weight: 700;
  word-break: break-word;
}

.nexus-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.nexus-form__grid--meta {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.file-picker {
  gap: 10px;
}

.file-picker :deep(.el-input) {
  flex: 1;
}

.nexus-form__grid :deep(.el-input-number) {
  width: 100%;
}

.nexus-site-card__issues {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.nexus-site-card__raw {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1180px) {
  .nexus-panel__header,
  .nexus-block__header,
  .nexus-site-card__header,
  .nexus-site-card__header-actions,
  .nexus-site-card__account-status,
  .nexus-site-card__actions,
  .nexus-site-card__action-buttons,
  .file-picker,
  .nexus-selector__card-head,
  .nexus-batch__intro,
  .nexus-batch__entry-head {
    flex-direction: column;
    align-items: stretch;
  }

  .nexus-form__grid,
  .nexus-form__grid--meta {
    grid-template-columns: 1fr;
  }
}
</style>
