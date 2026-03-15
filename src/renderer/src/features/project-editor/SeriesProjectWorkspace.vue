<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EpisodeEdit from '../../components/EpisodeEdit.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import {
  formatProjectTimestamp,
  summarizeTargetSiteProgress,
  getMissingTargetSiteIds,
  getPublishedSiteIds,
  getSiteLabel,
  type TargetSiteProgressSummary,
} from '../../services/project/presentation'
import type {
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  PublishProject,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesPublishProfileSiteDrafts,
  SeriesPublishProfileSiteFieldDefaults,
  SeriesProjectWorkspace,
  SeriesPublishProfile,
  SeriesPublishProfileSubtitleProfile,
  SeriesPublishProfileVideoProfile,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
} from '../../types/project'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteFieldSchemaMode, SiteId } from '../../types/site'

const PROFILE_VIDEO_ORDER: SeriesPublishProfileVideoProfile[] = ['1080p', '2160p']
const PROFILE_SUBTITLE_ORDER: SeriesPublishProfileSubtitleProfile[] = ['chs', 'cht', 'eng', 'bilingual']
const TARGET_SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
/*
const BANGUMI_CATEGORY_OPTIONS = [
  { label: '合集', value: '54967e14ff43b99e284d0bf7' },
  { label: '剧场版', value: '549cc9369310bc7d04cddf9f' },
  { label: '动画', value: '549ef207fe682f7549f1ea90' },
  { label: '其他', value: '549ef250fe682f7549f1ea91' },
]
const NYAA_CATEGORY_OPTIONS = [
  { label: 'Anime - English-translated', value: '1_2' },
  { label: 'Anime - Non-English-translated', value: '1_3' },
  { label: 'Anime - Raw', value: '1_4' },
  { label: 'Live Action - English-translated', value: '4_1' },
  { label: 'Live Action - Non-English-translated', value: '4_3' },
  { label: 'Live Action - Raw', value: '4_4' },
]
*/
const TEMPLATE_TOKENS = [
  '{{title}}',
  '{{summary}}',
  '{{releaseTeam}}',
  '{{seriesLabel}}',
  '{{seriesTitleCN}}',
  '{{seriesTitleEN}}',
  '{{seriesTitleJP}}',
  '{{seasonLabel}}',
  '{{episodeLabel}}',
  '{{episodeTitle}}',
  '{{techLabel}}',
  '{{resolution}}',
  '{{videoCodec}}',
  '{{audioCodec}}',
  '{{variantName}}',
  '{{videoProfile}}',
  '{{subtitleProfile}}',
  '{{subtitleProfileLabel}}',
]

type PublishProfileSiteFieldValue = string | number | boolean | undefined
type PublishProfileSiteFieldForm = Partial<Record<SiteId, Record<string, PublishProfileSiteFieldValue>>>

type PublishProfileSiteFieldMode = SiteFieldSchemaMode
type PublishProfileSiteFieldSchema = SiteFieldSchemaEntry
type PublishProfileSiteFieldSource = 'profile' | 'project' | 'unset'

type TargetSiteAvailabilityState = 'ready' | 'blocked' | 'setup'

type PublishProfileSiteDraftFormEntry = {
  useGlobalTitle: boolean
  titleTemplate: string
  summaryTemplate: string
  note: string
}

type PublishProfileSiteDraftForm = Partial<Record<SiteId, PublishProfileSiteDraftFormEntry>>

type EpisodeDifferenceField = {
  key: string
  label: string
  value: string
}

type EpisodeSiteOverrideSummary = {
  key: string
  label: string
  value: string
  sourceLabel: string
}

type TemplatePreviewResult = {
  text: string
  missingTokens: string[]
}

type EpisodeExecutionSourceGroupTone = 'success' | 'warning' | 'danger'
type RecentEpisodeGuideAction = 'default' | 'inherit' | 'blank'

type EpisodeExecutionSourceEntry = {
  key: string
  label: string
  value: string
}

type EpisodeExecutionSourceGroup = {
  key: string
  title: string
  tone: EpisodeExecutionSourceGroupTone
  emptyText: string
  entries: EpisodeExecutionSourceEntry[]
}

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const workspace = ref<SeriesProjectWorkspace | null>(null)
const selectedEpisodeId = ref<number | null>(null)
const selectedPublishProfileId = ref<number | null>(null)
const hasInitializedProfileEditor = ref(false)
const profileBaseline = ref('')

const isWorkspaceLoading = ref(false)
const isCreatingEpisode = ref(false)
const isSavingProfile = ref(false)
const isApplyingProfile = ref(false)
const isCreatingVariant = ref(false)
const isInheritingVariants = ref(false)
const activatingVariantId = ref<number | null>(null)
const syncingVariantId = ref<number | null>(null)
const duplicatingVariantId = ref<number | null>(null)
const removingVariantId = ref<number | null>(null)
const removingProfileId = ref<number | null>(null)
const workspaceError = ref('')
const siteCatalogError = ref('')
const profileSaveError = ref('')

const episodeDialogVisible = ref(false)
const episodeGuideVisible = ref(false)
const guideEpisodeId = ref<number | null>(null)
const dirtySwitchDialogVisible = ref(false)
const pendingProfileSelectionId = ref<number | null>(null)
const saveAsDialogVisible = ref(false)
const saveAsMode = ref<'saveAs' | 'copy'>('saveAs')
const saveAsName = ref('')
const draftConfig = ref<Config.PublishConfig | null>(null)
const siteCatalog = ref<SiteCatalogEntry[]>([])
const hasLoadedSiteCatalog = ref(false)
const refillVariantId = ref<number | null>(null)
const recentEpisodeGuideAction = ref<RecentEpisodeGuideAction | null>(null)

const episodeForm = reactive({
  episodeLabel: '',
  episodeTitle: '',
})

const variantForm = reactive<{
  videoProfile: SeriesVariantVideoProfile
  subtitleProfile: SeriesVariantSubtitleProfile
  nameOverride: string
  useSelectedProfile: boolean
}>({
  videoProfile: '1080p',
  subtitleProfile: 'chs',
  nameOverride: '',
  useSelectedProfile: true,
})

function createEmptySiteFieldForm(): PublishProfileSiteFieldForm {
  return {}
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

function hasSiteFieldValue(field: PublishProfileSiteFieldSchema, value: unknown) {
  switch (field.control) {
    case 'checkbox':
      return typeof normalizeSiteFieldBoolean(value) === 'boolean'
    case 'number':
      return typeof normalizeSiteFieldNumber(value) === 'number'
    case 'text':
    case 'select':
    default:
      return Boolean(normalizeSiteFieldString(value))
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

function createEmptySiteDraftFormEntry(): PublishProfileSiteDraftFormEntry {
  return {
    useGlobalTitle: true,
    titleTemplate: '',
    summaryTemplate: '',
    note: '',
  }
}

function createEmptySiteDraftForm(siteIds: SiteId[] = TARGET_SITE_ORDER): PublishProfileSiteDraftForm {
  return siteIds.reduce<PublishProfileSiteDraftForm>((drafts, siteId) => {
    drafts[siteId] = createEmptySiteDraftFormEntry()
    return drafts
  }, {})
}

const profileForm = reactive<{
  name: string
  isDefault: boolean
  videoProfiles: SeriesPublishProfileVideoProfile[]
  subtitleProfiles: SeriesPublishProfileSubtitleProfile[]
  targetSites: SiteId[]
  titleTemplate: string
  siteDrafts: PublishProfileSiteDraftForm
  siteFieldDefaults: PublishProfileSiteFieldForm
}>({
  name: '',
  isDefault: false,
  videoProfiles: ['1080p'],
  subtitleProfiles: ['chs'],
  targetSites: [],
  titleTemplate: '',
  siteDrafts: createEmptySiteDraftForm(),
  siteFieldDefaults: createEmptySiteFieldForm(),
})

const editorVisible = computed(() => {
  const value = route.query.editor
  if (Array.isArray(value)) {
    return value.includes('1')
  }

  return value === '1'
})

const editorKey = computed(() => {
  const activeEpisodeId = workspace.value?.activeEpisodeId ?? 'draft'
  const activeVariantId = workspace.value?.activeVariantId ?? 'root'
  return `${props.id}:${activeEpisodeId}:${activeVariantId}`
})

const episodes = computed(() => workspace.value?.episodes ?? [])
const publishProfiles = computed(() => workspace.value?.publishProfiles ?? [])

const defaultPublishProfile = computed(() => publishProfiles.value.find(profile => profile.isDefault) ?? publishProfiles.value[0] ?? null)

const selectedEpisode = computed(() => {
  if (selectedEpisodeId.value === null) {
    return null
  }

  return episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null
})

const guideEpisode = computed(() => {
  if (guideEpisodeId.value === null) {
    return null
  }

  return episodes.value.find(episode => episode.id === guideEpisodeId.value) ?? null
})

const activeEpisode = computed(() => {
  const activeEpisodeId = workspace.value?.activeEpisodeId
  if (!activeEpisodeId) {
    return null
  }

  return episodes.value.find(episode => episode.id === activeEpisodeId) ?? null
})

const activeVariant = computed(() => {
  const episode = activeEpisode.value
  const activeVariantId = workspace.value?.activeVariantId
  if (!episode || !activeVariantId) {
    return null
  }

  return episode.variants.find(variant => variant.id === activeVariantId) ?? null
})

const selectedEpisodeUsesActiveDraft = computed(
  () => Boolean(selectedEpisode.value && activeEpisode.value && selectedEpisode.value.id === activeEpisode.value.id && activeVariant.value),
)

const draftEpisodeContent = computed<Partial<Config.Content_episode> | null>(() => {
  if (!draftConfig.value || typeof draftConfig.value.content !== 'object' || Array.isArray(draftConfig.value.content)) {
    return null
  }

  return draftConfig.value.content as Partial<Config.Content_episode>
})

const selectedSavedProfile = computed(() => {
  if (selectedPublishProfileId.value === null) {
    return null
  }

  return publishProfiles.value.find(profile => profile.id === selectedPublishProfileId.value) ?? null
})

const videoProfileOptions = computed(() => [
  { value: '1080p' as const, label: t('seriesWorkspace.variants.profile.video.1080p') },
  { value: '2160p' as const, label: t('seriesWorkspace.variants.profile.video.2160p') },
  { value: 'custom' as const, label: t('seriesWorkspace.variants.profile.video.custom') },
])

const subtitleProfileOptions = computed(() => [
  { value: 'chs' as const, label: t('seriesWorkspace.variants.profile.subtitle.chs') },
  { value: 'cht' as const, label: t('seriesWorkspace.variants.profile.subtitle.cht') },
  { value: 'eng' as const, label: t('seriesWorkspace.variants.profile.subtitle.eng') },
  { value: 'bilingual' as const, label: t('seriesWorkspace.variants.profile.subtitle.bilingual') },
  { value: 'custom' as const, label: t('seriesWorkspace.variants.profile.subtitle.custom') },
])

const publishProfileVideoOptions = computed(() =>
  videoProfileOptions.value.filter(
    (option): option is { value: SeriesPublishProfileVideoProfile; label: string } => option.value !== 'custom',
  ),
)

const publishProfileSubtitleOptions = computed(() =>
  subtitleProfileOptions.value.filter(
    (option): option is { value: SeriesPublishProfileSubtitleProfile; label: string } => option.value !== 'custom',
  ),
)

const siteCatalogById = computed(() => new Map(siteCatalog.value.map(site => [site.id, site])))

const targetSiteCards = computed(() => {
  const siteIds = orderSiteIds([
    ...TARGET_SITE_ORDER,
    ...props.project.targetSites,
    ...publishProfiles.value.flatMap(profile => profile.targetSites ?? []),
    ...profileForm.targetSites,
    ...(hasLoadedSiteCatalog.value ? siteCatalog.value.map(site => site.id) : []),
  ])

  return siteIds.map(siteId => {
    const site = siteCatalogById.value.get(siteId)
    const state = resolveTargetSiteAvailability(site)
    return {
      siteId,
      label: getDisplaySiteLabel(siteId),
      enabled: profileForm.targetSites.includes(siteId),
      state,
      selectable: state === 'ready',
      tone: getTargetSiteStateTone(state),
      stateLabel: t(`seriesWorkspace.profileEditor.defaultSites.state.${state}`),
      text: getTargetSiteStateText(site, state),
    }
  })
})

const availableSiteIds = computed(() => targetSiteCards.value.map(card => card.siteId))

const currentSiteDrafts = computed(() => buildSiteDraftsPayload(profileForm.targetSites, profileForm.siteDrafts))

const currentSiteFieldDefaults = computed(() => buildSiteFieldDefaultsPayload(profileForm.siteFieldDefaults))

const projectSiteFieldDefaults = computed(() => workspace.value?.projectSiteFieldDefaults)

const publishableTargetSiteIds = computed(() => filterPublishableSiteIds(profileForm.targetSites))

const hiddenSiteFieldDetails = computed(() =>
  targetSiteCards.value
    .filter(card => card.enabled && !card.selectable)
    .map(card => ({
      siteId: card.siteId,
      label: card.label,
      reason: card.text,
    })),
)

const hiddenSiteFieldLabels = computed(() => hiddenSiteFieldDetails.value.map(detail => detail.label))

const hiddenSiteFieldDescription = computed(() =>
  hiddenSiteFieldDetails.value
    .map(detail =>
      t('seriesWorkspace.profileEditor.siteFields.hiddenReason', {
        site: detail.label,
        reason: detail.reason,
      }),
    )
    .join('\n'),
)

const siteDraftCards = computed(() =>
  availableSiteIds.value.map(siteId => {
    const entry = profileForm.siteDrafts[siteId] ?? createEmptySiteDraftFormEntry()
    const enabled = profileForm.targetSites.includes(siteId)
    return {
      siteId,
      enabled,
      entry,
      titlePreview: resolveSiteDraftTitlePreview(siteId),
      summaryPreview: renderTemplate(entry.summaryTemplate.trim()) || t('seriesWorkspace.profileEditor.summaryPreviewEmpty'),
      note: entry.note.trim(),
    }
  }),
)

const siteFieldCards = computed(() =>
  publishableTargetSiteIds.value.map(siteId => {
    const entry = profileForm.siteFieldDefaults[siteId] ?? {}
    const fields = getSiteFieldSchemas(siteId).map(field => {
      const explicitValue = getSiteFieldValue(profileForm.siteFieldDefaults, siteId, field)
      const inheritedValue = getSiteFieldValue(projectSiteFieldDefaults.value, siteId, field)
      const resolvedValue = hasSiteFieldValue(field, explicitValue) ? explicitValue : inheritedValue
      return {
        ...field,
        source: (hasSiteFieldValue(field, explicitValue) ? 'profile' : hasSiteFieldValue(field, inheritedValue) ? 'project' : 'unset') as PublishProfileSiteFieldSource,
        inheritedValue,
        inheritedLabel: hasSiteFieldValue(field, inheritedValue) ? getSiteFieldValueLabel(field, inheritedValue) : '',
        resolvedLabel: hasSiteFieldValue(field, resolvedValue) ? getSiteFieldValueLabel(field, resolvedValue) : '',
        missing:
          field.mode === 'required' &&
          !hasSiteFieldValue(field, explicitValue) &&
          !hasSiteFieldValue(field, inheritedValue),
      }
    })

    return {
      siteId,
      entry,
      fields,
      hasSchema: fields.length > 0,
      required: fields.some(field => field.mode === 'required'),
      missing: fields.some(field => field.missing),
    }
  }),
)

const templateTokens = computed(() => TEMPLATE_TOKENS)

const totalVariantCount = computed(() =>
  episodes.value.reduce((count, episode) => count + episode.variants.length, 0),
)

const currentDraftText = computed(() => {
  if (!activeEpisode.value || !activeVariant.value) {
    return t('seriesWorkspace.currentDraft.text')
  }

  return t('seriesWorkspace.currentDraft.active', {
    episode: activeEpisode.value.episodeLabel,
    variant: activeVariant.value.name,
  })
})

const overviewItems = computed(() => [
  {
    label: t('seriesWorkspace.stat.episodes'),
    value: episodes.value.length,
    text:
      episodes.value.length > 0
        ? episodes.value.map(episode => episode.episodeLabel).join(', ')
        : t('seriesWorkspace.empty.episodes'),
  },
  {
    label: t('seriesWorkspace.stat.variants'),
    value: totalVariantCount.value,
    text:
      totalVariantCount.value > 0
        ? t('seriesWorkspace.hero.variantHint', { count: totalVariantCount.value })
        : t('seriesWorkspace.empty.variants'),
  },
  {
    label: t('seriesWorkspace.stat.pendingSites'),
    value: getMissingTargetSiteIds(props.project).length,
    text:
      getMissingTargetSiteIds(props.project).length > 0
        ? getMissingTargetSiteIds(props.project)
            .map(siteId => getSiteLabel(siteId))
            .join(', ')
        : t('seriesWorkspace.empty.pending'),
  },
  {
    label: t('seriesWorkspace.stat.updatedAt'),
    value: formatProjectTimestamp(workspace.value?.updatedAt ?? props.project.updatedAt),
    text: t('seriesWorkspace.stat.updatedHint'),
  },
])

const selectedEpisodeProfileNames = computed(() => {
  if (!selectedEpisode.value) {
    return []
  }

  return Array.from(
    new Set(
      selectedEpisode.value.variants
        .map(variant => variant.publishProfileName)
        .filter((value): value is string => Boolean(value)),
    ),
  )
})

const selectedEpisodeProfileSummary = computed(() => {
  if (!selectedEpisode.value || selectedEpisode.value.variants.length === 0) {
    return t('seriesWorkspace.execution.profile.empty')
  }

  if (selectedEpisodeProfileNames.value.length === 1) {
    return selectedEpisodeProfileNames.value[0]
  }

  if (selectedEpisodeProfileNames.value.length > 1) {
    return t('seriesWorkspace.execution.profile.mixed', {
      name: selectedEpisodeProfileNames.value[0],
      count: selectedEpisodeProfileNames.value.length - 1,
    })
  }

  return t('seriesWorkspace.execution.profile.unlinked')
})

const selectedEpisodeDifferenceFields = computed<EpisodeDifferenceField[]>(() => {
  if (!selectedEpisode.value) {
    return []
  }

  const episodeLabel =
    (selectedEpisodeUsesActiveDraft.value ? draftEpisodeContent.value?.episodeLabel : '')?.trim() ||
    selectedEpisode.value.episodeLabel
  const episodeTitle =
    (selectedEpisodeUsesActiveDraft.value ? draftEpisodeContent.value?.episodeTitle : '')?.trim() ||
    selectedEpisode.value.episodeTitle ||
    t('seriesWorkspace.execution.differences.titleFallback')
  const torrentPath =
    selectedEpisodeUsesActiveDraft.value && draftConfig.value?.torrentPath?.trim()
      ? draftConfig.value.torrentPath.trim()
      : selectedEpisodeUsesActiveDraft.value
        ? t('seriesWorkspace.execution.differences.unsetValue')
        : t('seriesWorkspace.execution.differences.inactiveValue')
  const targetSites = selectedEpisodeUsesActiveDraft.value
    ? formatSiteLabels(getEpisodeDraftTargetSites(draftConfig.value))
    : t('seriesWorkspace.execution.differences.inactiveValue')

  return [
    {
      key: 'episodeLabel',
      label: t('seriesWorkspace.execution.differences.episodeLabel'),
      value: episodeLabel,
    },
    {
      key: 'episodeTitle',
      label: t('seriesWorkspace.execution.differences.episodeTitle'),
      value: episodeTitle,
    },
    {
      key: 'torrentPath',
      label: t('seriesWorkspace.execution.differences.torrentPath'),
      value: torrentPath,
    },
    {
      key: 'targetSites',
      label: t('seriesWorkspace.execution.differences.targetSites'),
      value: targetSites,
    },
  ]
})

const selectedEpisodeSiteOverrides = computed<EpisodeSiteOverrideSummary[]>(() => {
  if (!selectedEpisodeUsesActiveDraft.value || !draftConfig.value || !activeVariant.value) {
    return []
  }

  const snapshotFieldDefaults = activeVariant.value.publishProfileSnapshot?.siteFieldDefaults
  const projectFieldDefaults = workspace.value?.projectSiteFieldDefaults
  const siteIds = orderSiteIds([
    ...Object.keys(snapshotFieldDefaults ?? {}),
    ...Object.keys(projectFieldDefaults ?? {}),
  ] as SiteId[])

  return siteIds.flatMap(siteId => {
    return getSiteFieldSchemas(siteId).flatMap(field => {
      const currentValue = readEpisodeDraftSiteFieldValue(draftConfig.value, siteId, field.key)
      if (!hasSiteFieldValue(field, currentValue)) {
        return []
      }

      const profileValue = getSiteFieldValue(snapshotFieldDefaults, siteId, field)
      const projectValue = getSiteFieldValue(projectFieldDefaults, siteId, field)
      const baselineValue = hasSiteFieldValue(field, profileValue) ? profileValue : projectValue
      const baselineLabel = hasSiteFieldValue(field, baselineValue) ? getSiteFieldValueLabel(field, baselineValue) : ''
      const currentLabel = getSiteFieldValueLabel(field, currentValue)

      if (baselineLabel && baselineLabel === currentLabel) {
        return []
      }

      return [
        {
          key: `${siteId}:${field.key}`,
          label: `${getDisplaySiteLabel(siteId)} · ${t(field.labelKey)}`,
          value: currentLabel,
          sourceLabel: hasSiteFieldValue(field, profileValue)
            ? t('seriesWorkspace.execution.differences.overrideFromProfile')
            : hasSiteFieldValue(field, projectValue)
              ? t('seriesWorkspace.execution.differences.overrideFromProject')
              : t('seriesWorkspace.execution.differences.overrideStandalone'),
        },
      ]
    })
  })
})

const selectedEpisodeExecutionSourceGroups = computed<EpisodeExecutionSourceGroup[]>(() => {
  const profileEntries: EpisodeExecutionSourceEntry[] = []
  const episodeEntries: EpisodeExecutionSourceEntry[] = []
  const variantEntries: EpisodeExecutionSourceEntry[] = []

  if (!selectedEpisode.value) {
    return []
  }

  if (!selectedEpisodeUsesActiveDraft.value || !draftConfig.value || !activeVariant.value) {
    return [
      {
        key: 'profile',
        title: t('seriesWorkspace.execution.sources.profile.title'),
        tone: 'success',
        emptyText: t('seriesWorkspace.execution.sources.inactive'),
        entries: [],
      },
      {
        key: 'episode',
        title: t('seriesWorkspace.execution.sources.episode.title'),
        tone: 'warning',
        emptyText: t('seriesWorkspace.execution.sources.inactive'),
        entries: [],
      },
      {
        key: 'variant',
        title: t('seriesWorkspace.execution.sources.variant.title'),
        tone: 'danger',
        emptyText: t('seriesWorkspace.execution.sources.inactive'),
        entries: [],
      },
    ]
  }

  const draftTitle = draftConfig.value.title?.trim() || ''
  const draftTargetSites = getEpisodeDraftTargetSites(draftConfig.value)
  const snapshot = activeVariant.value.publishProfileSnapshot
  const snapshotTargetSites = normalizeTargetSites(snapshot?.targetSites ?? [])
  const snapshotTitle = snapshot?.titleTemplate?.trim()
    ? renderDraftTemplate(snapshot.titleTemplate, draftConfig.value, activeVariant.value)
    : ''

  const linkedProfileName = getVariantPublishProfileLabel(activeVariant.value)
  if (linkedProfileName) {
    profileEntries.push({
      key: 'profileName',
      label: t('seriesWorkspace.execution.sources.profile.profileName'),
      value: linkedProfileName,
    })
  }

  if (snapshotTargetSites.length && JSON.stringify([...draftTargetSites].sort()) === JSON.stringify([...snapshotTargetSites].sort())) {
    profileEntries.push({
      key: 'profileTargetSites',
      label: t('seriesWorkspace.execution.differences.targetSites'),
      value: formatSiteLabels(draftTargetSites),
    })
  } else if (draftTargetSites.length) {
    variantEntries.push({
      key: 'variantTargetSites',
      label: t('seriesWorkspace.execution.differences.targetSites'),
      value: formatSiteLabels(draftTargetSites),
    })
  }

  if (draftTitle) {
    if (snapshotTitle && draftTitle === snapshotTitle) {
      profileEntries.push({
        key: 'profileTitle',
        label: t('seriesWorkspace.execution.sources.variant.titleValue'),
        value: draftTitle,
      })
    } else {
      variantEntries.push({
        key: 'variantTitle',
        label: t('seriesWorkspace.execution.sources.variant.titleValue'),
        value: draftTitle,
      })
    }
  }

  const snapshotFieldDefaults = snapshot?.siteFieldDefaults
  const inheritedProfileFieldLabels = orderSiteIds(Object.keys(snapshotFieldDefaults ?? {}) as SiteId[]).flatMap(siteId =>
    getSiteFieldSchemas(siteId).flatMap(field => {
      const currentValue = readEpisodeDraftSiteFieldValue(draftConfig.value, siteId, field.key)
      const profileValue = getSiteFieldValue(snapshotFieldDefaults, siteId, field)
      if (!hasSiteFieldValue(field, currentValue) || !hasSiteFieldValue(field, profileValue)) {
        return []
      }

      const currentLabel = getSiteFieldValueLabel(field, currentValue)
      const profileLabel = getSiteFieldValueLabel(field, profileValue)
      if (!currentLabel || currentLabel !== profileLabel) {
        return []
      }

      return [`${getDisplaySiteLabel(siteId)} · ${t(field.labelKey)}`]
    }),
  )

  if (inheritedProfileFieldLabels.length) {
    profileEntries.push({
      key: 'profileSiteDefaults',
      label: t('seriesWorkspace.execution.sources.profile.siteDefaults'),
      value: summarizeExecutionSourceValues(inheritedProfileFieldLabels),
    })
  }

  episodeEntries.push({
    key: 'episodeLabel',
    label: t('seriesWorkspace.execution.differences.episodeLabel'),
    value: draftEpisodeContent.value?.episodeLabel?.trim() || selectedEpisode.value.episodeLabel,
  })
  episodeEntries.push({
    key: 'episodeTitle',
    label: t('seriesWorkspace.execution.differences.episodeTitle'),
    value:
      draftEpisodeContent.value?.episodeTitle?.trim() ||
      selectedEpisode.value.episodeTitle ||
      t('seriesWorkspace.execution.differences.titleFallback'),
  })
  episodeEntries.push({
    key: 'torrentPath',
    label: t('seriesWorkspace.execution.differences.torrentPath'),
    value: draftConfig.value.torrentPath?.trim() || t('seriesWorkspace.execution.differences.unsetValue'),
  })

  if (selectedEpisodeSiteOverrides.value.length) {
    variantEntries.push({
      key: 'variantSiteOverrides',
      label: t('seriesWorkspace.execution.sources.variant.siteOverrides'),
      value: summarizeExecutionSourceValues(selectedEpisodeSiteOverrides.value.map(entry => entry.label)),
    })
  }

  return [
    {
      key: 'profile',
      title: t('seriesWorkspace.execution.sources.profile.title'),
      tone: 'success',
      emptyText: linkedProfileName
        ? t('seriesWorkspace.execution.sources.profile.empty')
        : t('seriesWorkspace.execution.sources.profile.unlinked'),
      entries: profileEntries,
    },
    {
      key: 'episode',
      title: t('seriesWorkspace.execution.sources.episode.title'),
      tone: 'warning',
      emptyText: t('seriesWorkspace.execution.sources.episode.empty'),
      entries: episodeEntries,
    },
    {
      key: 'variant',
      title: t('seriesWorkspace.execution.sources.variant.title'),
      tone: 'danger',
      emptyText: t('seriesWorkspace.execution.sources.variant.empty'),
      entries: variantEntries,
    },
  ]
})

const currentProfileCombinationNames = computed(() =>
  getProfileCombinationNames(profileForm.videoProfiles, profileForm.subtitleProfiles),
)

const currentProfileCombinationCount = computed(() => currentProfileCombinationNames.value.length)

const currentProfileCombinationPreview = computed(() =>
  currentProfileCombinationNames.value.slice(0, 4).join(', ') || t('seriesWorkspace.profileEditor.combinationEmpty'),
)

const defaultTitlePreview = computed(() => {
  const episodeLabel = selectedEpisode.value?.episodeLabel ?? guideEpisode.value?.episodeLabel ?? '05'
  const videoLabel = getVideoProfileLabel(profileForm.videoProfiles[0])
  const subtitleLabel = getSubtitleProfileLabel(profileForm.subtitleProfiles[0])
  const tags = [videoLabel, subtitleLabel].filter(Boolean).map(label => `[${label}]`).join('')
  return `${props.project.name} - ${episodeLabel}${tags ? ` ${tags}` : ''}`
})

const titlePreviewState = computed(() => renderTemplatePreview(profileForm.titleTemplate.trim()))

const titlePreview = computed(() => titlePreviewState.value.text || defaultTitlePreview.value)

const titlePreviewMissingTokens = computed(() => titlePreviewState.value.missingTokens)

const currentProfileMissingSiteFields = computed(() =>
  getMissingSiteFieldLabels(publishableTargetSiteIds.value, currentSiteFieldDefaults.value, projectSiteFieldDefaults.value),
)

const selectedProfileMissingSiteFields = computed(() =>
  selectedSavedProfile.value
    ? getMissingSiteFieldLabels(
        filterPublishableSiteIds(resolveProfileTargetSites(selectedSavedProfile.value)),
        selectedSavedProfile.value.siteFieldDefaults,
        projectSiteFieldDefaults.value,
      )
    : [],
)

const profileDirty = computed(() => serializeProfileForm(profileForm) !== profileBaseline.value)

const canApplySavedSelectedProfile = computed(
  () => Boolean(selectedEpisode.value && selectedSavedProfile.value && !profileDirty.value),
)

const canApplyDefaultProfile = computed(() => Boolean(selectedEpisode.value && defaultPublishProfile.value))

const canUseSelectedProfileDefaults = computed(() => Boolean(selectedSavedProfile.value && !profileDirty.value))

const requiresVariantNameOverride = computed(
  () => variantForm.videoProfile === 'custom' || variantForm.subtitleProfile === 'custom',
)

const presetVariantName = computed(() => {
  if (requiresVariantNameOverride.value) {
    return ''
  }

  return `${getVideoProfileLabel(variantForm.videoProfile)}-${getSubtitleProfileLabel(variantForm.subtitleProfile)}`
})

const variantName = computed(() => variantForm.nameOverride.trim() || presetVariantName.value)

const manualVariantProfile = computed(() =>
  variantForm.useSelectedProfile && canUseSelectedProfileDefaults.value ? selectedSavedProfile.value : null,
)

const manualVariantTargetSitesPreview = computed(() =>
  manualVariantProfile.value
    ? formatSiteLabels(resolveProfileTargetSites(manualVariantProfile.value))
    : t('seriesWorkspace.variants.create.noProfileDefaults'),
)

const manualVariantTitlePreview = computed(() => {
  if (!manualVariantProfile.value) {
    return t('seriesWorkspace.variants.create.noProfileDefaults')
  }

  return manualVariantProfile.value.titleTemplate?.trim() || t('seriesWorkspace.profileEditor.titlePreviewFallback')
})

const manualVariantSummaryPreview = computed(() => {
  if (!manualVariantProfile.value) {
    return t('seriesWorkspace.variants.create.noProfileDefaults')
  }

  return (
    resolvePrimarySiteDraftSummaryTemplate(
      manualVariantProfile.value.siteDrafts,
      resolveProfileTargetSites(manualVariantProfile.value),
      manualVariantProfile.value.summaryTemplate,
    ) || t('seriesWorkspace.profileEditor.summaryPreviewEmpty')
  )
})

const applyProfileHint = computed(() => {
  if (!selectedEpisode.value) {
    return t('seriesWorkspace.execution.applyHintEpisodeRequired')
  }

  if (!selectedSavedProfile.value) {
    return t('seriesWorkspace.execution.applyHintProfileRequired')
  }

  if (profileDirty.value) {
    return t('seriesWorkspace.execution.applyHintSaveFirst')
  }

  if (selectedProfileMissingSiteFields.value.length > 0) {
    return t('seriesWorkspace.profileEditor.siteFields.applyHintMissing', {
      sites: selectedProfileMissingSiteFields.value.join(' / '),
    })
  }

  return t('seriesWorkspace.execution.applyHintReady', {
    episode: selectedEpisode.value.episodeLabel,
    profile: selectedSavedProfile.value.name,
  })
})

const currentProfileSelectionLabel = computed(() => {
  if (selectedSavedProfile.value?.name?.trim()) {
    return selectedSavedProfile.value.name.trim()
  }

  return profileForm.name.trim() || t('seriesWorkspace.profileEditor.newProfileName')
})

const pendingProfileSelectionLabel = computed(() => {
  if (pendingProfileSelectionId.value === null) {
    return t('seriesWorkspace.profileEditor.newProfileName')
  }

  return (
    publishProfiles.value.find(profile => profile.id === pendingProfileSelectionId.value)?.name ??
    t('seriesWorkspace.profileEditor.newProfileName')
  )
})

const dirtySwitchDialogText = computed(() =>
  t('seriesWorkspace.profileSwitch.textDetailed', {
    current: currentProfileSelectionLabel.value,
    next: pendingProfileSelectionLabel.value,
  }),
)

const recentEpisodeGuideActionLabel = computed(() => {
  if (!recentEpisodeGuideAction.value) {
    return ''
  }

  return t(`seriesWorkspace.episodes.recent.${recentEpisodeGuideAction.value}`)
})

const canRunRecentEpisodeGuideAction = computed(() => {
  if (!recentEpisodeGuideAction.value) {
    return false
  }

  switch (recentEpisodeGuideAction.value) {
    case 'default':
      return Boolean(defaultPublishProfile.value)
    case 'inherit':
      return episodes.value.length > 0
    case 'blank':
      return true
  }
})

const recentEpisodeGuideActionHelp = computed(() => {
  if (!recentEpisodeGuideAction.value) {
    return ''
  }

  if (!canRunRecentEpisodeGuideAction.value) {
    return t('seriesWorkspace.episodes.dialog.recentUnavailable')
  }

  return t('seriesWorkspace.episodes.dialog.recentAvailable', {
    action: recentEpisodeGuideActionLabel.value,
  })
})

const defaultApplyHint = computed(() => {
  if (!selectedEpisode.value) {
    return t('seriesWorkspace.execution.applyHintEpisodeRequired')
  }

  if (!defaultPublishProfile.value) {
    return t('seriesWorkspace.execution.applyHintDefaultRequired')
  }

  const missingSiteLabels = getMissingSiteFieldLabels(
    filterPublishableSiteIds(resolveProfileTargetSites(defaultPublishProfile.value)),
    defaultPublishProfile.value.siteFieldDefaults,
    projectSiteFieldDefaults.value,
  )
  if (missingSiteLabels.length > 0) {
    return t('seriesWorkspace.profileEditor.siteFields.applyHintMissing', {
      sites: missingSiteLabels.join(' / '),
    })
  }

  return t('seriesWorkspace.execution.applyHintDefaultReady', {
    episode: selectedEpisode.value.episodeLabel,
    profile: defaultPublishProfile.value.name,
  })
})

const saveAsDialogTitle = computed(() =>
  t(
    saveAsMode.value === 'copy'
      ? 'seriesWorkspace.profileEditor.copyDialog.title'
      : 'seriesWorkspace.profileEditor.saveAsDialog.title',
  ),
)

const saveAsDialogText = computed(() =>
  t(
    saveAsMode.value === 'copy'
      ? 'seriesWorkspace.profileEditor.copyDialog.text'
      : 'seriesWorkspace.profileEditor.saveAsDialog.text',
  ),
)

function normalizeOrderedValues<T extends string>(values: T[], order: readonly T[]) {
  const valueSet = new Set(values)
  return order.filter(value => valueSet.has(value))
}

function normalizeTargetSites(siteIds: SiteId[]) {
  return Array.from(new Set(siteIds.filter(Boolean)))
}

function orderSiteIds(siteIds: SiteId[]) {
  const normalizedSiteIds = normalizeTargetSites(siteIds)
  const orderedKnownSiteIds = TARGET_SITE_ORDER.filter(siteId => normalizedSiteIds.includes(siteId))
  const remainingSiteIds = normalizedSiteIds
    .filter(siteId => !TARGET_SITE_ORDER.includes(siteId))
    .sort((left, right) => getDisplaySiteLabel(left).localeCompare(getDisplaySiteLabel(right)))

  return [...orderedKnownSiteIds, ...remainingSiteIds]
}

function getDisplaySiteLabel(siteId: SiteId) {
  return siteCatalog.value.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId)
}

function getSiteFieldSchemas(siteId: SiteId): PublishProfileSiteFieldSchema[] {
  return siteCatalogById.value.get(siteId)?.fieldSchemas ?? []
}

function getSiteFieldValue(
  fieldDefaults: SeriesPublishProfileSiteFieldDefaults | PublishProfileSiteFieldForm | undefined,
  siteId: SiteId,
  field: PublishProfileSiteFieldSchema,
) {
  return normalizeSiteFieldFormValue(fieldDefaults?.[siteId]?.[field.key], field)
}

function getSiteFieldValueLabel(field: PublishProfileSiteFieldSchema, value: unknown) {
  if (field.control === 'select') {
    const normalizedValue = normalizeSiteFieldString(value)
    if (!normalizedValue) {
      return ''
    }

    const option = field.options?.find(option => option.value === normalizedValue)
    return option ? (option.labelKey ? t(option.labelKey) : option.label) : normalizedValue
  }

  if (field.control === 'number') {
    const normalizedValue = normalizeSiteFieldNumber(value)
    return normalizedValue !== undefined ? `${normalizedValue}` : ''
  }

  if (field.control === 'checkbox') {
    const normalizedValue = normalizeSiteFieldBoolean(value)
    if (normalizedValue === undefined) {
      return ''
    }

    return normalizedValue
      ? t('seriesWorkspace.profileEditor.siteFields.boolean.true')
      : t('seriesWorkspace.profileEditor.siteFields.boolean.false')
  }

  return normalizeSiteFieldString(value)
}

function resolveTargetSiteAvailability(site?: SiteCatalogEntry): TargetSiteAvailabilityState {
  if (!hasLoadedSiteCatalog.value) {
    return 'ready'
  }

  if (!site || !site.capabilitySet.publish.torrent) {
    return 'setup'
  }

  if (!site.enabled) {
    return 'blocked'
  }

  if (site.accountStatus === 'authenticated') {
    return 'ready'
  }

  if (site.accountConfigured || site.accountStatus === 'blocked' || site.accountStatus === 'error') {
    return 'blocked'
  }

  return 'setup'
}

function getTargetSiteStateTone(state: TargetSiteAvailabilityState): 'success' | 'warning' | 'info' {
  switch (state) {
    case 'ready':
      return 'success'
    case 'blocked':
      return 'warning'
    default:
      return 'info'
  }
}

function getTargetSiteStateText(site: SiteCatalogEntry | undefined, state: TargetSiteAvailabilityState) {
  if (state === 'ready') {
    return site?.accountMessage || t('seriesWorkspace.profileEditor.defaultSites.readyText')
  }

  if (state === 'blocked') {
    return site?.accountMessage || t('seriesWorkspace.profileEditor.defaultSites.blockedText')
  }

  return t('seriesWorkspace.profileEditor.defaultSites.setupText')
}

function isSitePublishable(siteId: SiteId) {
  return resolveTargetSiteAvailability(siteCatalogById.value.get(siteId)) === 'ready'
}

function filterPublishableSiteIds(siteIds: SiteId[]) {
  return normalizeTargetSites(siteIds).filter(siteId => isSitePublishable(siteId))
}

function normalizeSiteDraftSiteIds(siteIds: SiteId[], siteDrafts?: Partial<Record<SiteId, unknown>>) {
  return orderSiteIds([...TARGET_SITE_ORDER, ...siteIds, ...((Object.keys(siteDrafts ?? {}) as SiteId[]) ?? [])])
}

function normalizeSiteFieldSiteIds(siteIds: SiteId[], fieldDefaults?: Partial<Record<SiteId, unknown>>) {
  return orderSiteIds([
    ...TARGET_SITE_ORDER,
    ...siteIds,
    ...((Object.keys(fieldDefaults ?? {}) as SiteId[]) ?? []),
  ])
}

function ensureSiteDraftFormEntries(siteIds: SiteId[]) {
  normalizeSiteDraftSiteIds(siteIds).forEach(siteId => {
    if (!profileForm.siteDrafts[siteId]) {
      profileForm.siteDrafts[siteId] = createEmptySiteDraftFormEntry()
    }
  })
}

function resetSiteDraftsForm(siteIds: SiteId[] = availableSiteIds.value) {
  ensureSiteDraftFormEntries(siteIds)
  normalizeSiteDraftSiteIds(siteIds).forEach(siteId => {
    Object.assign(profileForm.siteDrafts[siteId]!, createEmptySiteDraftFormEntry())
  })
}

function applySiteDraftsToForm(
  siteDrafts?: SeriesPublishProfileSiteDrafts,
  options?: {
    targetSites?: SiteId[]
    fallbackSummaryTemplate?: string
  },
) {
  const targetSites = normalizeTargetSites(options?.targetSites ?? [])
  const nextSiteIds = normalizeSiteDraftSiteIds([...availableSiteIds.value, ...targetSites], siteDrafts)
  const fallbackSummaryTemplate = options?.fallbackSummaryTemplate?.trim() ?? ''

  resetSiteDraftsForm(nextSiteIds)
  nextSiteIds.forEach(siteId => {
    const entry = profileForm.siteDrafts[siteId]!
    const siteDraft = siteDrafts?.[siteId]
    entry.useGlobalTitle = siteDraft?.useGlobalTitle !== false
    entry.titleTemplate = typeof siteDraft?.titleTemplate === 'string' ? siteDraft.titleTemplate.trim() : ''
    entry.summaryTemplate =
      typeof siteDraft?.summaryTemplate === 'string'
        ? siteDraft.summaryTemplate.trim()
        : targetSites.includes(siteId)
          ? fallbackSummaryTemplate
          : ''
    entry.note = typeof siteDraft?.note === 'string' ? siteDraft.note.trim() : ''
  })
}

function buildSiteDraftsPayload(
  targetSites: SiteId[],
  source: PublishProfileSiteDraftForm,
): SeriesPublishProfileSiteDrafts | undefined {
  const normalizedTargetSites = normalizeTargetSites(targetSites)
  const nextSiteDrafts: SeriesPublishProfileSiteDrafts = {}

  normalizeSiteDraftSiteIds([...availableSiteIds.value, ...normalizedTargetSites], source).forEach(siteId => {
    const sourceEntry = source[siteId]
    const entry = sourceEntry ?? createEmptySiteDraftFormEntry()
    const enabled = normalizedTargetSites.includes(siteId)
    const useGlobalTitle = sourceEntry?.useGlobalTitle !== false
    const titleTemplate = entry.titleTemplate.trim()
    const summaryTemplate = entry.summaryTemplate.trim()
    const note = entry.note.trim()

    if (!enabled && useGlobalTitle && !titleTemplate && !summaryTemplate && !note) {
      return
    }

    nextSiteDrafts[siteId] = {
      enabled,
      useGlobalTitle,
      titleTemplate: titleTemplate || undefined,
      summaryTemplate: summaryTemplate || undefined,
      note: note || undefined,
    }
  })

  return Object.keys(nextSiteDrafts).length > 0 ? nextSiteDrafts : undefined
}

function resolvePrimarySiteDraftSummaryTemplate(
  siteDrafts?: SeriesPublishProfileSiteDrafts,
  targetSites: SiteId[] = [],
  fallbackSummaryTemplate?: string,
) {
  const orderedSiteIds = targetSites.length ? targetSites : (Object.keys(siteDrafts ?? {}) as SiteId[])
  for (const siteId of orderedSiteIds) {
    const summaryTemplate = siteDrafts?.[siteId]?.summaryTemplate?.trim()
    if (summaryTemplate) {
      return summaryTemplate
    }
  }

  return fallbackSummaryTemplate?.trim() || ''
}

function resolveSiteDraftTitlePreview(siteId: SiteId) {
  const entry = profileForm.siteDrafts[siteId]
  if (!entry || entry.useGlobalTitle) {
    return titlePreview.value
  }

  return renderTemplate(entry.titleTemplate.trim()) || titlePreview.value
}

function buildSiteFieldDefaultsPayload(source: PublishProfileSiteFieldForm): SeriesPublishProfileSiteFieldDefaults | undefined {
  const nextFieldDefaults: SeriesPublishProfileSiteFieldDefaults = {}

  normalizeSiteFieldSiteIds([...availableSiteIds.value, ...profileForm.targetSites], source).forEach(siteId => {
    const sourceEntry = source[siteId]
    const fields = getSiteFieldSchemas(siteId)
    if (!sourceEntry || !fields.length) {
      return
    }

    const nextEntry: Record<string, unknown> = {}
    fields.forEach(field => {
      const value = serializeSiteFieldValue(field, sourceEntry[field.key])
      if (value !== undefined) {
        nextEntry[field.key] = value
      }
    })

    if (Object.keys(nextEntry).length > 0) {
      nextFieldDefaults[siteId] = nextEntry
    }
  })

  return Object.keys(nextFieldDefaults).length > 0 ? nextFieldDefaults : undefined
}

function ensureSiteFieldFormEntries(siteIds: SiteId[]) {
  normalizeSiteFieldSiteIds(siteIds).forEach(siteId => {
    const entry = profileForm.siteFieldDefaults[siteId] ?? {}
    getSiteFieldSchemas(siteId).forEach(field => {
      if (!(field.key in entry)) {
        entry[field.key] = getSiteFieldDefaultValue(field)
      }
    })
    profileForm.siteFieldDefaults[siteId] = entry
  })
}

function resetSiteFieldDefaultsForm(siteIds: SiteId[] = availableSiteIds.value) {
  normalizeSiteFieldSiteIds(siteIds).forEach(siteId => {
    profileForm.siteFieldDefaults[siteId] = Object.fromEntries(
      getSiteFieldSchemas(siteId).map(field => [field.key, getSiteFieldDefaultValue(field)]),
    )
  })
}

function applySiteFieldDefaultsToForm(fieldDefaults?: SeriesPublishProfileSiteFieldDefaults) {
  const nextSiteIds = normalizeSiteFieldSiteIds([...availableSiteIds.value, ...profileForm.targetSites], fieldDefaults)
  resetSiteFieldDefaultsForm(nextSiteIds)
  nextSiteIds.forEach(siteId => {
    const entry = profileForm.siteFieldDefaults[siteId] ?? {}
    getSiteFieldSchemas(siteId).forEach(field => {
      entry[field.key] = normalizeSiteFieldFormValue(fieldDefaults?.[siteId]?.[field.key], field)
    })
    profileForm.siteFieldDefaults[siteId] = entry
  })
}

function getMissingSiteFieldLabels(
  targetSites: SiteId[],
  fieldDefaults?: SeriesPublishProfileSiteFieldDefaults,
  fallbackFieldDefaults?: SeriesPublishProfileSiteFieldDefaults,
) {
  const missingLabels: string[] = []
  filterPublishableSiteIds(targetSites).forEach(siteId => {
    const isMissingRequiredField = getSiteFieldSchemas(siteId).some(field => {
      if (field.mode !== 'required') {
        return false
      }

      const explicitValue = getSiteFieldValue(fieldDefaults, siteId, field)
      const fallbackValue = getSiteFieldValue(fallbackFieldDefaults, siteId, field)
      return !hasSiteFieldValue(field, explicitValue) && !hasSiteFieldValue(field, fallbackValue)
    })

    if (isMissingRequiredField) {
      missingLabels.push(getDisplaySiteLabel(siteId))
    }
  })

  return missingLabels
}

function getSiteFieldModeTagType(mode: PublishProfileSiteFieldMode): 'warning' | 'info' {
  return mode === 'required' ? 'warning' : 'info'
}

function serializeProfileForm(source: typeof profileForm) {
  const targetSites = normalizeTargetSites(source.targetSites)
  const siteDrafts = buildSiteDraftsPayload(targetSites, source.siteDrafts)
  return JSON.stringify({
    name: source.name.trim(),
    isDefault: source.isDefault,
    videoProfiles: normalizeOrderedValues(source.videoProfiles, PROFILE_VIDEO_ORDER),
    subtitleProfiles: normalizeOrderedValues(source.subtitleProfiles, PROFILE_SUBTITLE_ORDER),
    targetSites: targetSites.sort(),
    titleTemplate: source.titleTemplate.trim(),
    summaryTemplate: resolvePrimarySiteDraftSummaryTemplate(siteDrafts, targetSites),
    siteDrafts: siteDrafts ?? {},
    siteFieldDefaults: buildSiteFieldDefaultsPayload(source.siteFieldDefaults) ?? {},
  })
}

function getVideoProfileLabel(profile?: SeriesVariantVideoProfile | SeriesPublishProfileVideoProfile) {
  if (!profile) {
    return ''
  }

  return t(`seriesWorkspace.variants.profile.video.${profile}`)
}

function getSubtitleProfileLabel(profile?: SeriesVariantSubtitleProfile | SeriesPublishProfileSubtitleProfile) {
  if (!profile) {
    return ''
  }

  return t(`seriesWorkspace.variants.profile.subtitle.${profile}`)
}

function resolveProfileTargetSites(profile?: SeriesPublishProfile | null) {
  return normalizeTargetSites(profile?.targetSites ?? [])
}

function formatSiteLabels(siteIds?: SiteId[]) {
  if (!siteIds?.length) {
    return t('seriesWorkspace.profileEditor.targetSitesFallback')
  }

  return siteIds.map(siteId => getDisplaySiteLabel(siteId)).join(', ')
}

function getVariantPublishProfileLabel(variant: SeriesProjectVariant) {
  return variant.publishProfileName?.trim() || variant.publishProfileSnapshot?.name?.trim() || ''
}

function isVariantLinkedToPublishProfile(variant: SeriesProjectVariant) {
  return Boolean(variant.publishProfileId || getVariantPublishProfileLabel(variant))
}

function getEpisodeDraftTargetSites(config?: Config.PublishConfig | null) {
  if (!config) {
    return []
  }

  const content =
    typeof config.content === 'object' && config.content && !Array.isArray(config.content)
      ? (config.content as Partial<Config.Content_episode>)
      : undefined

  return normalizeTargetSites(config.targetSites ?? content?.targetSites ?? [])
}

function getEpisodeDraftContent(config?: Config.PublishConfig | null) {
  if (!config || typeof config.content !== 'object' || !config.content || Array.isArray(config.content)) {
    return undefined
  }

  return config.content as Partial<Config.Content_episode>
}

function renderTemplateWithVariables(
  value: string,
  variables: Record<string, string | undefined>,
  missingTokens?: Set<string>,
) {
  return value.replace(/\{\{(.*?)\}\}/g, (_, token: string) => {
    const normalizedToken = token.trim()
    const resolvedValue = variables[normalizedToken]
    if (typeof resolvedValue === 'string' && resolvedValue.trim()) {
      return resolvedValue
    }

    const placeholder = `{{${normalizedToken}}}`
    missingTokens?.add(placeholder)
    return placeholder
  })
}

function buildDraftTemplateVariables(
  config: Config.PublishConfig | null | undefined,
  variant?: SeriesProjectVariant | null,
): Record<string, string | undefined> {
  const content = getEpisodeDraftContent(config)
  const titles = [content?.seriesTitleCN, content?.seriesTitleEN, content?.seriesTitleJP]
    .map(value => value?.trim())
    .filter(Boolean)
  const techParts = [content?.sourceType, content?.resolution, content?.videoCodec, content?.audioCodec]
    .map(value => value?.trim())
    .filter(Boolean)

  return {
    title: props.project.name,
    summary: content?.summary?.trim() || t('seriesWorkspace.profileEditor.preview.summarySample'),
    releaseTeam: content?.releaseTeam?.trim() || 'VCB-Studio',
    seriesLabel: titles.join(' / ') || props.project.name,
    seriesTitleCN: content?.seriesTitleCN?.trim() || props.project.name,
    seriesTitleEN: content?.seriesTitleEN?.trim() || props.project.name,
    seriesTitleJP: content?.seriesTitleJP?.trim() || props.project.name,
    seasonLabel: content?.seasonLabel?.trim() || undefined,
    episodeLabel: content?.episodeLabel?.trim() || undefined,
    episodeTitle: content?.episodeTitle?.trim() || undefined,
    techLabel: techParts.join(' ') || undefined,
    resolution: content?.resolution?.trim() || undefined,
    videoCodec: content?.videoCodec?.trim() || undefined,
    audioCodec: content?.audioCodec?.trim() || undefined,
    variantName: variant?.name?.trim() || undefined,
    videoProfile: getVideoProfileLabel(variant?.videoProfile),
    subtitleProfile: variant?.subtitleProfile ?? undefined,
    subtitleProfileLabel: getSubtitleProfileLabel(variant?.subtitleProfile),
  }
}

function renderDraftTemplate(value: string, config: Config.PublishConfig | null | undefined, variant?: SeriesProjectVariant | null) {
  if (!value.trim()) {
    return ''
  }

  return renderTemplateWithVariables(value, buildDraftTemplateVariables(config, variant))
}

function summarizeExecutionSourceValues(values: string[]) {
  const normalizedValues = values.map(value => value.trim()).filter(Boolean)
  if (normalizedValues.length <= 2) {
    return normalizedValues.join(' / ')
  }

  return `${normalizedValues.slice(0, 2).join(' / ')} +${normalizedValues.length - 2}`
}

function getVariantProgressSummary(variant: SeriesProjectVariant): TargetSiteProgressSummary {
  return summarizeTargetSiteProgress(normalizeTargetSites(variant.targetSites ?? []), variant.publishResults)
}

function readEpisodeDraftSiteFieldValue(
  config: Config.PublishConfig | null,
  siteId: SiteId,
  fieldKey: string,
): string | number | boolean | undefined {
  if (!config) {
    return undefined
  }

  switch (`${siteId}:${fieldKey}`) {
    case 'bangumi:category_bangumi':
      return config.category_bangumi
    case 'nyaa:category_nyaa':
      return config.category_nyaa
    default:
      return undefined
  }
}

async function loadDraftConfig() {
  try {
    draftConfig.value = await taskBridge.getPublishConfig(props.id)
  } catch {
    draftConfig.value = null
  }
}

function getProfileCombinationNames(
  videoProfiles: SeriesPublishProfileVideoProfile[],
  subtitleProfiles: SeriesPublishProfileSubtitleProfile[],
) {
  return videoProfiles.flatMap(videoProfile =>
    subtitleProfiles.map(
      subtitleProfile => `${getVideoProfileLabel(videoProfile)}-${getSubtitleProfileLabel(subtitleProfile)}`,
    ),
  )
}

function getProfileSummary(profile: SeriesPublishProfile) {
  const siteCount = resolveProfileTargetSites(profile).length
  const siteLabel = t('seriesWorkspace.profileCard.siteCount', { count: siteCount })
  const comboLabel =
    getProfileCombinationNames(profile.videoProfiles, profile.subtitleProfiles)[0] ??
    t('seriesWorkspace.profileEditor.combinationEmpty')
  return `${siteLabel} · ${comboLabel}`
}

function getPreviousEpisode(targetEpisodeId: number | null) {
  if (targetEpisodeId === null) {
    return null
  }

  const sortedEpisodes = [...episodes.value].sort((left, right) => left.sortIndex - right.sortIndex)
  const index = sortedEpisodes.findIndex(episode => episode.id === targetEpisodeId)
  if (index <= 0) {
    return null
  }

  return sortedEpisodes[index - 1] ?? null
}

function buildPreviewVariables() {
  const previewEpisode = selectedEpisode.value ?? guideEpisode.value
  const primaryVideo = profileForm.videoProfiles[0]
  const primarySubtitle = profileForm.subtitleProfiles[0]
  const variantPreviewName =
    getProfileCombinationNames(
      primaryVideo ? [primaryVideo] : [],
      primarySubtitle ? [primarySubtitle] : [],
    )[0] ?? '1080p-CHS'

  return {
    title: props.project.name,
    summary: t('seriesWorkspace.profileEditor.preview.summarySample'),
    releaseTeam: 'VCB-Studio',
    seriesLabel: props.project.name,
    seriesTitleCN: props.project.name,
    seriesTitleEN: props.project.name,
    seriesTitleJP: props.project.name,
    seasonLabel: undefined,
    episodeLabel: previewEpisode?.episodeLabel?.trim() || undefined,
    episodeTitle: previewEpisode?.episodeTitle?.trim() || undefined,
    techLabel: [getVideoProfileLabel(primaryVideo), getSubtitleProfileLabel(primarySubtitle)].filter(Boolean).join(' / '),
    resolution: getVideoProfileLabel(primaryVideo),
    videoCodec: 'AVC',
    audioCodec: 'AAC',
    variantName: variantPreviewName,
    videoProfile: getVideoProfileLabel(primaryVideo),
    subtitleProfile: primarySubtitle ?? '',
    subtitleProfileLabel: getSubtitleProfileLabel(primarySubtitle),
  }
}

function renderTemplatePreview(value: string): TemplatePreviewResult {
  if (!value.trim()) {
    return {
      text: '',
      missingTokens: [],
    }
  }

  const missingTokens = new Set<string>()
  const text = renderTemplateWithVariables(value, buildPreviewVariables(), missingTokens)

  return {
    text,
    missingTokens: [...missingTokens],
  }
}

function renderTemplate(value: string) {
  return renderTemplatePreview(value).text
}

function applyProfileSelectionInternal(profileId: number | null) {
  const profile = profileId === null ? null : publishProfiles.value.find(item => item.id === profileId) ?? null
  selectedPublishProfileId.value = profile?.id ?? null
  profileSaveError.value = ''
  profileForm.name = profile?.name ?? ''
  profileForm.isDefault = Boolean(profile?.isDefault)
  profileForm.videoProfiles = normalizeOrderedValues(profile?.videoProfiles ?? ['1080p'], PROFILE_VIDEO_ORDER)
  profileForm.subtitleProfiles = normalizeOrderedValues(profile?.subtitleProfiles ?? ['chs'], PROFILE_SUBTITLE_ORDER)
  profileForm.targetSites = normalizeTargetSites(profile?.targetSites ?? props.project.targetSites)
  profileForm.titleTemplate = profile?.titleTemplate ?? ''
  applySiteDraftsToForm(profile?.siteDrafts, {
    targetSites: profileForm.targetSites,
    fallbackSummaryTemplate: profile?.summaryTemplate,
  })
  applySiteFieldDefaultsToForm(profile?.siteFieldDefaults)
  profileBaseline.value = serializeProfileForm(profileForm)
  hasInitializedProfileEditor.value = true
}

function initializeProfileEditor(preferredProfileId?: number | null) {
  if (preferredProfileId !== undefined) {
    applyProfileSelectionInternal(preferredProfileId)
    return
  }

  if (!hasInitializedProfileEditor.value) {
    applyProfileSelectionInternal(defaultPublishProfile.value?.id ?? null)
    return
  }

  if (
    selectedPublishProfileId.value !== null &&
    !publishProfiles.value.some(profile => profile.id === selectedPublishProfileId.value)
  ) {
    applyProfileSelectionInternal(defaultPublishProfile.value?.id ?? null)
  }
}

function syncSelectedEpisode(preferredEpisodeId?: number) {
  const nextEpisodes = workspace.value?.episodes ?? []
  if (!nextEpisodes.length) {
    selectedEpisodeId.value = null
    return
  }

  if (preferredEpisodeId && nextEpisodes.some(episode => episode.id === preferredEpisodeId)) {
    selectedEpisodeId.value = preferredEpisodeId
    return
  }

  if (selectedEpisodeId.value && nextEpisodes.some(episode => episode.id === selectedEpisodeId.value)) {
    return
  }

  const activeEpisodeId = workspace.value?.activeEpisodeId
  if (activeEpisodeId && nextEpisodes.some(episode => episode.id === activeEpisodeId)) {
    selectedEpisodeId.value = activeEpisodeId
    return
  }

  selectedEpisodeId.value = nextEpisodes[0].id
}

async function loadWorkspace(preferredEpisodeId?: number, preferredProfileId?: number | null) {
  isWorkspaceLoading.value = true
  workspaceError.value = ''
  siteCatalogError.value = ''
  profileSaveError.value = ''
  try {
    const [workspaceResult, siteResult] = await Promise.all([
      projectBridge.getSeriesWorkspace(props.project.id),
      siteBridge.listSites(),
    ])

    if (siteResult.ok) {
      hasLoadedSiteCatalog.value = true
      siteCatalog.value = siteResult.data.sites.filter(site => site.capabilitySet.publish.torrent)
      siteCatalogError.value = ''
    } else {
      hasLoadedSiteCatalog.value = false
      siteCatalog.value = []
      siteCatalogError.value = siteResult.error.message
    }

    if (!workspaceResult.ok) {
      workspace.value = null
      draftConfig.value = null
      selectedEpisodeId.value = null
      workspaceError.value = workspaceResult.error.message
      return
    }

    workspace.value = workspaceResult.data.workspace
    syncSelectedEpisode(preferredEpisodeId)
    initializeProfileEditor(preferredProfileId)
    await loadDraftConfig()
  } finally {
    isWorkspaceLoading.value = false
  }
}

function requestProfileSelection(profileId: number | null) {
  if (profileId === selectedPublishProfileId.value) {
    return
  }

  if (profileDirty.value) {
    pendingProfileSelectionId.value = profileId
    dirtySwitchDialogVisible.value = true
    return
  }

  applyProfileSelectionInternal(profileId)
}

function toggleTargetSite(siteId: SiteId) {
  const siteCard = targetSiteCards.value.find(card => card.siteId === siteId)
  if (!siteCard?.selectable) {
    return
  }

  profileForm.targetSites = profileForm.targetSites.includes(siteId)
    ? profileForm.targetSites.filter(value => value !== siteId)
    : normalizeTargetSites([...profileForm.targetSites, siteId])
}

function openAccountsPage() {
  void router.push({ name: 'account' })
}

function beginNewPublishProfile() {
  requestProfileSelection(null)
}

function closeDirtySwitchDialog() {
  dirtySwitchDialogVisible.value = false
  pendingProfileSelectionId.value = null
}

function discardAndSwitchProfile() {
  const nextProfileId = pendingProfileSelectionId.value
  dirtySwitchDialogVisible.value = false
  pendingProfileSelectionId.value = null
  applyProfileSelectionInternal(nextProfileId)
}

async function persistPublishProfile(options?: {
  profileId?: number
  name?: string
  isDefault?: boolean
}) {
  const name = (options?.name ?? profileForm.name).trim()
  const videoProfiles = normalizeOrderedValues(profileForm.videoProfiles, PROFILE_VIDEO_ORDER)
  const subtitleProfiles = normalizeOrderedValues(profileForm.subtitleProfiles, PROFILE_SUBTITLE_ORDER)

  if (!name) {
    ElMessage.error(t('seriesWorkspace.profileEditor.validation.nameRequired'))
    return false
  }

  if (!videoProfiles.length || !subtitleProfiles.length) {
    ElMessage.error(t('seriesWorkspace.profileEditor.validation.combinationRequired'))
    return false
  }

  profileSaveError.value = ''
  isSavingProfile.value = true
  try {
    const result = await projectBridge.saveSeriesPublishProfile({
      projectId: props.project.id,
      profileId: options?.profileId,
      name,
      isDefault: options?.isDefault ?? profileForm.isDefault,
      videoProfiles,
      subtitleProfiles,
      targetSites: normalizeTargetSites(profileForm.targetSites),
      titleTemplate: profileForm.titleTemplate.trim() || undefined,
      summaryTemplate:
        resolvePrimarySiteDraftSummaryTemplate(currentSiteDrafts.value, normalizeTargetSites(profileForm.targetSites)) ||
        undefined,
      siteDrafts: currentSiteDrafts.value,
      siteFieldDefaults: currentSiteFieldDefaults.value,
    })
    if (!result.ok) {
      profileSaveError.value = result.error.message
      ElMessage.error(result.error.message)
      return false
    }

    profileSaveError.value = ''
    workspace.value = result.data.workspace
    syncSelectedEpisode()
    applyProfileSelectionInternal(result.data.profile.id)
    ElMessage.success(
      t(
        options?.profileId !== undefined
          ? 'seriesWorkspace.profileEditor.saveSuccess'
          : 'seriesWorkspace.profileEditor.createSuccess',
        { name: result.data.profile.name },
      ),
    )
    return true
  } finally {
    isSavingProfile.value = false
  }
}

async function saveCurrentProfile() {
  return await persistPublishProfile({
    profileId: selectedPublishProfileId.value ?? undefined,
  })
}

async function saveAndSwitchProfile() {
  const saved = await persistPublishProfile({
    profileId: selectedPublishProfileId.value ?? undefined,
  })
  if (!saved) {
    return
  }

  discardAndSwitchProfile()
}

function openSaveAsDialog(mode: 'saveAs' | 'copy') {
  saveAsMode.value = mode
  const fallbackName = t('seriesWorkspace.profileEditor.newProfileName')
  saveAsName.value =
    mode === 'copy'
      ? t('seriesWorkspace.profileEditor.copyDialog.defaultName', {
          name: profileForm.name.trim() || fallbackName,
        })
      : profileForm.name.trim() || fallbackName
  saveAsDialogVisible.value = true
}

async function confirmSaveAs() {
  const saved = await persistPublishProfile({
    name: saveAsName.value,
    isDefault: false,
  })
  if (saved) {
    saveAsDialogVisible.value = false
  }
}

async function removeCurrentProfile() {
  const profile = selectedSavedProfile.value
  if (!profile) {
    return
  }

  try {
    await ElMessageBox.confirm(
      t('seriesWorkspace.profileEditor.removeConfirm', { name: profile.name }),
      t('seriesWorkspace.profileEditor.removeTitle'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  removingProfileId.value = profile.id
  try {
    const result = await projectBridge.removeSeriesPublishProfile({
      projectId: props.project.id,
      profileId: profile.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode()
    applyProfileSelectionInternal(
      result.data.workspace.publishProfiles.find(item => item.isDefault)?.id ??
        result.data.workspace.publishProfiles[0]?.id ??
        null,
    )
    ElMessage.success(t('seriesWorkspace.profileEditor.removeSuccess', { name: profile.name }))
  } finally {
    removingProfileId.value = null
  }
}

async function createEpisode(options?: { followupAction?: RecentEpisodeGuideAction }) {
  const episodeLabel = episodeForm.episodeLabel.trim()
  const episodeTitle = episodeForm.episodeTitle.trim()

  if (!episodeLabel) {
    ElMessage.error(t('seriesWorkspace.episodes.validation.labelRequired'))
    return
  }

  isCreatingEpisode.value = true
  try {
    const input: CreateSeriesEpisodeInput = {
      projectId: props.project.id,
      episodeLabel,
      episodeTitle: episodeTitle || undefined,
    }
    const result = await projectBridge.createSeriesEpisode(input)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    const createdEpisode = result.data.episode
    const followupAction = options?.followupAction

    workspace.value = result.data.workspace
    syncSelectedEpisode(createdEpisode.id)
    initializeProfileEditor()
    episodeDialogVisible.value = false
    episodeForm.episodeLabel = ''
    episodeForm.episodeTitle = ''
    guideEpisodeId.value = createdEpisode.id
    ElMessage.success(t('seriesWorkspace.episodes.createSuccess', { episode: createdEpisode.episodeLabel }))

    if (followupAction === 'default' && defaultPublishProfile.value) {
      const applied = await applyPublishProfileToEpisode(createdEpisode, defaultPublishProfile.value, { closeGuide: true })
      if (applied) {
        persistRecentEpisodeGuideAction('default')
        return
      }
    } else if (followupAction === 'inherit') {
      const inherited = await inheritVariantsForEpisode(createdEpisode, true)
      if (inherited) {
        persistRecentEpisodeGuideAction('inherit')
        return
      }
    } else if (followupAction === 'blank') {
      persistRecentEpisodeGuideAction('blank')
      ElMessage.success(t('seriesWorkspace.episodeGuide.blankSuccess', { episode: createdEpisode.episodeLabel }))
      return
    }

    episodeGuideVisible.value = true
  } finally {
    isCreatingEpisode.value = false
  }
}

async function confirmProfileSiteFieldDefaults(profile: SeriesPublishProfile) {
  const missingSiteLabels = getMissingSiteFieldLabels(
    resolveProfileTargetSites(profile),
    profile.siteFieldDefaults,
    projectSiteFieldDefaults.value,
  )
  if (!missingSiteLabels.length) {
    return true
  }

  try {
    await ElMessageBox.confirm(
      t('seriesWorkspace.profileEditor.siteFields.applyConfirmText', {
        sites: missingSiteLabels.join(' / '),
      }),
      t('seriesWorkspace.profileEditor.siteFields.applyConfirmTitle'),
      {
        confirmButtonText: t('common.continue'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
    return true
  } catch {
    return false
  }
}

async function applyPublishProfileToEpisode(
  episode: SeriesProjectEpisode,
  profile: SeriesPublishProfile,
  options?: { closeGuide?: boolean },
) {
  const confirmed = await confirmProfileSiteFieldDefaults(profile)
  if (!confirmed) {
    return false
  }

  isApplyingProfile.value = true
  try {
    const result = await projectBridge.batchCreateSeriesVariants({
      projectId: props.project.id,
      episodeId: episode.id,
      publishProfileId: profile.id,
      videoProfiles: [...profile.videoProfiles],
      subtitleProfiles: [...profile.subtitleProfiles],
      targetSites: resolveProfileTargetSites(profile),
      titleTemplate: profile.titleTemplate?.trim() || undefined,
      summaryTemplate: profile.summaryTemplate?.trim() || undefined,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return false
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()
    if (options?.closeGuide) {
      episodeGuideVisible.value = false
    }
    ElMessage.success(
      t('seriesWorkspace.execution.applySuccess', {
        episode: result.data.episode.episodeLabel,
        profile: profile.name,
        created: result.data.createdCount,
        skipped: result.data.skippedCount,
      }),
    )
    return true
  } finally {
    isApplyingProfile.value = false
  }
}

async function applySelectedProfileToCurrentEpisode() {
  if (!selectedEpisode.value || !selectedSavedProfile.value) {
    ElMessage.error(t('seriesWorkspace.execution.applyHintProfileRequired'))
    return
  }

  if (profileDirty.value) {
    ElMessage.error(t('seriesWorkspace.execution.applyHintSaveFirst'))
    return
  }

  await applyPublishProfileToEpisode(selectedEpisode.value, selectedSavedProfile.value)
}

async function applyDefaultProfileToSelectedEpisode() {
  if (!selectedEpisode.value || !defaultPublishProfile.value) {
    ElMessage.error(t('seriesWorkspace.execution.applyHintDefaultRequired'))
    return
  }

  await applyPublishProfileToEpisode(selectedEpisode.value, defaultPublishProfile.value)
}

async function applyDefaultProfileToGuideEpisode() {
  if (!guideEpisode.value || !defaultPublishProfile.value) {
    ElMessage.error(t('seriesWorkspace.execution.applyHintDefaultRequired'))
    return
  }

  const applied = await applyPublishProfileToEpisode(guideEpisode.value, defaultPublishProfile.value, { closeGuide: true })
  if (applied) {
    persistRecentEpisodeGuideAction('default')
  }
}

async function inheritVariantsForEpisode(episode: SeriesProjectEpisode, closeGuide = false) {
  const sourceEpisode = getPreviousEpisode(episode.id)
  if (!sourceEpisode) {
    ElMessage.error(t('seriesWorkspace.variants.inheritDisabled'))
    return false
  }

  isInheritingVariants.value = true
  try {
    const result = await projectBridge.inheritSeriesEpisodeVariants({
      projectId: props.project.id,
      episodeId: episode.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return false
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()
    if (closeGuide) {
      episodeGuideVisible.value = false
    }
    ElMessage.success(
      t('seriesWorkspace.variants.inheritSuccess', {
        episode: sourceEpisode.episodeLabel,
        count: result.data.copiedCount,
      }),
    )
    return true
  } finally {
    isInheritingVariants.value = false
  }
}

async function inheritVariantsFromSelectedEpisode() {
  if (!selectedEpisode.value) {
    ElMessage.error(t('seriesWorkspace.variants.validation.episodeRequired'))
    return
  }

  await inheritVariantsForEpisode(selectedEpisode.value)
}

async function inheritVariantsFromGuideEpisode() {
  if (!guideEpisode.value) {
    ElMessage.error(t('seriesWorkspace.variants.validation.episodeRequired'))
    return
  }

  const inherited = await inheritVariantsForEpisode(guideEpisode.value, true)
  if (inherited) {
    persistRecentEpisodeGuideAction('inherit')
  }
}

function keepGuideEpisodeBlank() {
  if (!guideEpisode.value) {
    episodeGuideVisible.value = false
    return
  }

  episodeGuideVisible.value = false
  persistRecentEpisodeGuideAction('blank')
  ElMessage.success(t('seriesWorkspace.episodeGuide.blankSuccess', { episode: guideEpisode.value.episodeLabel }))
}

async function createVariant() {
  const episode = selectedEpisode.value
  if (!episode) {
    ElMessage.error(t('seriesWorkspace.variants.validation.episodeRequired'))
    return
  }

  if (!variantName.value) {
    ElMessage.error(t('seriesWorkspace.variants.validation.customNameRequired'))
    return
  }

  if (variantForm.useSelectedProfile && !selectedSavedProfile.value) {
    ElMessage.error(t('seriesWorkspace.variants.create.profileRequired'))
    return
  }

  if (variantForm.useSelectedProfile && profileDirty.value) {
    ElMessage.error(t('seriesWorkspace.variants.create.saveProfileFirst'))
    return
  }

  if (manualVariantProfile.value) {
    const confirmed = await confirmProfileSiteFieldDefaults(manualVariantProfile.value)
    if (!confirmed) {
      return
    }
  }

  isCreatingVariant.value = true
  try {
    const profile = manualVariantProfile.value
    const input: CreateSeriesVariantInput = {
      projectId: props.project.id,
      episodeId: episode.id,
      name: variantName.value,
      videoProfile: variantForm.videoProfile,
      subtitleProfile: variantForm.subtitleProfile,
      publishProfileId: profile?.id,
      targetSites: profile ? resolveProfileTargetSites(profile) : undefined,
      titleTemplate: profile?.titleTemplate?.trim() || undefined,
      summaryTemplate: profile?.summaryTemplate?.trim() || undefined,
    }
    const result = await projectBridge.createSeriesVariant(input)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()
    variantForm.nameOverride = ''
    ElMessage.success(t('seriesWorkspace.variants.createSuccess', { variant: result.data.variant.name }))
  } finally {
    isCreatingVariant.value = false
  }
}

async function loadVariantIntoDraft(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const result = await projectBridge.activateSeriesVariant({
    projectId: props.project.id,
    episodeId: episode.id,
    variantId: variant.id,
  })
  if (!result.ok) {
    ElMessage.error(result.error.message)
    return null
  }

  workspace.value = result.data.workspace
  syncSelectedEpisode(result.data.episode.id)
  initializeProfileEditor()
  await loadDraftConfig()

  return result.data
}

async function activateVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  activatingVariantId.value = variant.id
  try {
    const result = await loadVariantIntoDraft(episode, variant)
    if (!result) {
      return
    }

    setEditorVisible(true)
    ElMessage.success(
      t('seriesWorkspace.variants.activateSuccess', {
        episode: result.episode.episodeLabel,
        variant: result.variant.name,
      }),
    )
  } finally {
    activatingVariantId.value = null
  }
}

async function refillVariantPublishTargets(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const progressSummary = getVariantProgressSummary(variant)
  if (!progressSummary.pendingSiteIds.length && !progressSummary.failedSiteIds.length) {
    return
  }

  refillVariantId.value = variant.id
  try {
    if (!isActiveVariant(episode.id, variant.id)) {
      const result = await loadVariantIntoDraft(episode, variant)
      if (!result) {
        return
      }
    }

    const focusSiteIds = [...progressSummary.failedSiteIds, ...progressSummary.pendingSiteIds]
    ElMessage.success(
      t('seriesWorkspace.variants.card.refillReady', {
        variant: variant.name,
        sites: formatSiteLabels(focusSiteIds),
      }),
    )
    navigateToStage('bt_publish')
  } finally {
    refillVariantId.value = null
  }
}

async function syncVariantFromDraft(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  syncingVariantId.value = variant.id
  try {
    const result = await projectBridge.syncSeriesVariantFromDraft({
      projectId: props.project.id,
      episodeId: episode.id,
      variantId: variant.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()
    await loadDraftConfig()
    ElMessage.success(t('seriesWorkspace.variants.syncSuccess', { variant: result.data.variant.name }))
  } finally {
    syncingVariantId.value = null
  }
}

async function duplicateVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  duplicatingVariantId.value = variant.id
  try {
    const result = await projectBridge.duplicateSeriesVariant({
      projectId: props.project.id,
      episodeId: episode.id,
      variantId: variant.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()
    ElMessage.success(
      t('seriesWorkspace.variants.card.duplicateSuccess', {
        source: variant.name,
        variant: result.data.variant.name,
      }),
    )
  } finally {
    duplicatingVariantId.value = null
  }
}

async function removeVariant(episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
  const wasActive = isActiveVariant(episode.id, variant.id)

  try {
    await ElMessageBox.confirm(
      t('seriesWorkspace.variants.card.removeConfirm', { variant: variant.name }),
      t('seriesWorkspace.variants.card.removeTitle'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  removingVariantId.value = variant.id
  try {
    const result = await projectBridge.removeSeriesVariant({
      projectId: props.project.id,
      episodeId: episode.id,
      variantId: variant.id,
    })
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    syncSelectedEpisode(result.data.episode.id)
    initializeProfileEditor()

    if (wasActive) {
      draftConfig.value = null
      setEditorVisible(false)
    }

    ElMessage.success(
      t(
        wasActive
          ? 'seriesWorkspace.variants.card.removeActiveSuccess'
          : 'seriesWorkspace.variants.card.removeSuccess',
        { variant: variant.name },
      ),
    )
  } finally {
    removingVariantId.value = null
  }
}

function isActiveVariant(episodeId: number, variantId: number) {
  return workspace.value?.activeEpisodeId === episodeId && workspace.value.activeVariantId === variantId
}

function selectEpisode(episodeId: number) {
  selectedEpisodeId.value = episodeId
}

function setEditorVisible(visible: boolean) {
  const nextQuery = { ...route.query }
  if (visible) {
    nextQuery.editor = '1'
  } else {
    delete nextQuery.editor
  }

  void router.replace({
    name: typeof route.name === 'string' ? route.name : 'edit',
    params: route.params,
    query: nextQuery,
  })
}

function navigateToStage(name: 'check' | 'bt_publish') {
  void router.push({
    name,
    params: {
      id: props.id,
    },
  })
}

function openProjectFolder() {
  const message: Message.Global.Path = { path: props.project.workingDirectory }
  window.globalAPI.openFolder(JSON.stringify(message))
}

function getRecentEpisodeGuideActionStorageKey(projectId: number) {
  return `series-workspace-recent-episode-action:${projectId}`
}

function loadRecentEpisodeGuideAction() {
  try {
    const raw = window.localStorage.getItem(getRecentEpisodeGuideActionStorageKey(props.project.id))
    recentEpisodeGuideAction.value =
      raw === 'default' || raw === 'inherit' || raw === 'blank' ? raw : null
  } catch {
    recentEpisodeGuideAction.value = null
  }
}

function persistRecentEpisodeGuideAction(action: RecentEpisodeGuideAction) {
  recentEpisodeGuideAction.value = action
  try {
    window.localStorage.setItem(getRecentEpisodeGuideActionStorageKey(props.project.id), action)
  } catch {
    // Ignore storage write failures and keep the in-memory hint.
  }
}

onMounted(() => {
  loadRecentEpisodeGuideAction()
  void loadWorkspace()
  window.projectAPI.refreshProjectData(() => {
    void loadWorkspace()
  })
})

watch(
  availableSiteIds,
  siteIds => {
    ensureSiteDraftFormEntries(siteIds)
    ensureSiteFieldFormEntries(siteIds)
  },
  {
    immediate: true,
  },
)

watch(
  () => props.project.id,
  () => {
    workspace.value = null
    draftConfig.value = null
    selectedEpisodeId.value = null
    selectedPublishProfileId.value = null
    hasInitializedProfileEditor.value = false
    profileBaseline.value = ''
    guideEpisodeId.value = null
    episodeDialogVisible.value = false
    episodeGuideVisible.value = false
    dirtySwitchDialogVisible.value = false
    saveAsDialogVisible.value = false
    refillVariantId.value = null
    loadRecentEpisodeGuideAction()
    void loadWorkspace()
  },
)
</script>

<template>
  <div class="series-workspace">
    <template v-if="!workspace && isWorkspaceLoading">
      <section class="series-workspace__skeleton">
        <el-skeleton animated :rows="10" />
      </section>
    </template>

    <el-alert
      v-else-if="workspaceError"
      type="error"
      :title="t('seriesWorkspace.status.loadFailed')"
      :description="workspaceError"
      show-icon
      :closable="false"
    />

    <template v-else>
      <section class="series-workspace__hero">
        <div class="series-workspace__hero-main">
          <div class="series-workspace__eyebrow">{{ t('seriesWorkspace.hero.eyebrow') }}</div>
          <h2 class="series-workspace__hero-title">{{ props.project.name }}</h2>
          <p class="series-workspace__hero-text">{{ currentDraftText }}</p>
          <div class="series-workspace__hero-meta">
            <span>
              {{
                t('seriesWorkspace.hero.defaultProfile', {
                  name: defaultPublishProfile?.name ?? t('seriesWorkspace.hero.noDefaultProfile'),
                })
              }}
            </span>
            <span>
              {{
                t('seriesWorkspace.hero.publishedSites', {
                  count: getPublishedSiteIds(props.project).length,
                })
              }}
            </span>
            <span>{{ t('seriesWorkspace.hero.projectPath', { path: props.project.workingDirectory }) }}</span>
          </div>
        </div>

        <div class="series-workspace__hero-actions">
          <el-button plain @click="beginNewPublishProfile">
            {{ t('seriesWorkspace.hero.actions.newProfile') }}
          </el-button>
          <el-button plain @click="episodeDialogVisible = true">
            {{ t('seriesWorkspace.hero.actions.newEpisode') }}
          </el-button>
          <el-button plain @click="openProjectFolder">
            {{ t('seriesWorkspace.openFolder') }}
          </el-button>
        </div>

        <div class="series-workspace__hero-stats">
          <article v-for="item in overviewItems" :key="item.label" class="series-workspace__metric">
            <div class="series-workspace__metric-label">{{ item.label }}</div>
            <div class="series-workspace__metric-value">{{ item.value }}</div>
            <div class="series-workspace__metric-text">{{ item.text }}</div>
          </article>
        </div>

        <div class="series-workspace__hero-workbench">
          <article class="series-workspace__hero-band">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.episodes.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.episodes.text') }}</div>

            <div v-if="episodes.length" class="series-workspace__episode-strip">
              <button
                v-for="episode in episodes"
                :key="episode.id"
                class="series-workspace__episode-chip"
                :class="{ 'series-workspace__episode-chip--active': selectedEpisodeId === episode.id }"
                type="button"
                @click="selectEpisode(episode.id)"
              >
                <span class="series-workspace__episode-chip-label">{{ episode.episodeLabel }}</span>
                <span class="series-workspace__episode-chip-meta">{{ episode.variantCount }}</span>
              </button>
            </div>
            <div v-else class="series-workspace__empty">
              {{ t('seriesWorkspace.episodes.empty') }}
            </div>
          </article>

          <article class="series-workspace__hero-band">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.execution.currentEpisode.title') }}</div>

            <template v-if="selectedEpisode">
              <div class="series-workspace__episode-summary-title">
                {{ t('seriesWorkspace.execution.currentEpisode.label', { episode: selectedEpisode.episodeLabel }) }}
              </div>
              <div class="series-workspace__episode-summary-text">
                {{ selectedEpisode.episodeTitle || t('seriesWorkspace.episodes.card.titleFallback') }}
              </div>
              <div class="series-workspace__meta-list">
                <span>{{ t('seriesWorkspace.execution.currentEpisode.profile', { name: selectedEpisodeProfileSummary }) }}</span>
                <span>{{ t('seriesWorkspace.execution.currentEpisode.variantCount', { count: selectedEpisode.variantCount }) }}</span>
                <span>
                  {{
                    t('seriesWorkspace.execution.currentEpisode.directory', {
                      directory: selectedEpisode.directoryName,
                    })
                  }}
                </span>
              </div>
            </template>

            <div v-else class="series-workspace__empty">
              {{ t('seriesWorkspace.execution.currentEpisode.empty') }}
            </div>
          </article>

          <article class="series-workspace__hero-band series-workspace__hero-band--actions">
            <div class="series-workspace__section-head">
              <div>
                <div class="series-workspace__card-title">{{ t('seriesWorkspace.execution.actions.title') }}</div>
                <p class="series-workspace__card-text">{{ defaultApplyHint }}</p>
              </div>
              <el-tag v-if="profileDirty" effect="plain" type="warning">
                {{ t('seriesWorkspace.profileEditor.unsaved') }}
              </el-tag>
            </div>

            <div class="series-workspace__hero-action-row">
              <el-button
                type="primary"
                :disabled="!canApplyDefaultProfile"
                :loading="isApplyingProfile"
                @click="applyDefaultProfileToSelectedEpisode"
              >
                {{ t('seriesWorkspace.execution.actions.applyDefault') }}
              </el-button>
              <el-button
                plain
                :disabled="!canApplySavedSelectedProfile"
                :loading="isApplyingProfile"
                @click="applySelectedProfileToCurrentEpisode"
              >
                {{ t('seriesWorkspace.execution.actions.applySelected') }}
              </el-button>
              <el-button
                plain
                :disabled="!selectedEpisode || !getPreviousEpisode(selectedEpisode.id)"
                :loading="isInheritingVariants"
                @click="inheritVariantsFromSelectedEpisode"
              >
                {{ t('seriesWorkspace.execution.actions.inherit') }}
              </el-button>
              <el-button type="primary" plain @click="setEditorVisible(!editorVisible)">
                {{ editorVisible ? t('seriesWorkspace.closeEditor') : t('seriesWorkspace.openEditor') }}
              </el-button>
              <el-button plain @click="navigateToStage('check')">
                {{ t('seriesWorkspace.execution.actions.check') }}
              </el-button>
              <el-button plain @click="navigateToStage('bt_publish')">
                {{ t('seriesWorkspace.execution.actions.publish') }}
              </el-button>
            </div>

            <div class="series-workspace__meta-list">
              <span>{{ applyProfileHint }}</span>
              <span>{{ currentDraftText }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="series-workspace__profiles">
        <div class="series-workspace__section-head">
          <div>
            <div class="series-workspace__section-title">{{ t('seriesWorkspace.profileStrip.title') }}</div>
            <p class="series-workspace__section-text">{{ t('seriesWorkspace.profileStrip.text') }}</p>
          </div>
          <el-tag v-if="profileDirty" effect="plain" type="warning">
            {{ t('seriesWorkspace.profileEditor.unsaved') }}
          </el-tag>
        </div>

        <div class="series-workspace__profile-strip">
          <button
            v-for="profile in publishProfiles"
            :key="profile.id"
            class="series-workspace__profile-card"
            :class="{ 'series-workspace__profile-card--active': selectedPublishProfileId === profile.id }"
            type="button"
            @click="requestProfileSelection(profile.id)"
          >
            <div class="series-workspace__profile-card-head">
              <div class="series-workspace__profile-card-name">{{ profile.name }}</div>
              <el-tag v-if="profile.isDefault" effect="plain" size="small" type="success">
                {{ t('seriesWorkspace.profileCard.defaultTag') }}
              </el-tag>
            </div>
            <div class="series-workspace__profile-card-summary">{{ getProfileSummary(profile) }}</div>
            <div class="series-workspace__profile-card-combos">
              {{ getProfileCombinationNames(profile.videoProfiles, profile.subtitleProfiles).slice(0, 3).join(', ') }}
            </div>
            <div class="series-workspace__profile-card-time">
              {{ t('seriesWorkspace.common.updatedAt', { time: formatProjectTimestamp(profile.updatedAt) }) }}
            </div>
          </button>

          <button
            class="series-workspace__profile-card series-workspace__profile-card--create"
            :class="{ 'series-workspace__profile-card--active': selectedPublishProfileId === null }"
            type="button"
            @click="beginNewPublishProfile"
          >
            <div class="series-workspace__profile-card-name">{{ t('seriesWorkspace.profileStrip.newCard.title') }}</div>
            <div class="series-workspace__profile-card-summary">{{ t('seriesWorkspace.profileStrip.newCard.text') }}</div>
          </button>
        </div>
      </section>

      <section class="series-workspace__content">
        <article class="series-workspace__editor-panel" v-loading="isSavingProfile">
          <div class="series-workspace__section-head">
            <div>
              <div class="series-workspace__section-title">{{ t('seriesWorkspace.profileEditor.title') }}</div>
              <p class="series-workspace__section-text">
                {{
                  selectedSavedProfile
                    ? t('seriesWorkspace.profileEditor.text', { name: selectedSavedProfile.name })
                    : t('seriesWorkspace.profileEditor.newText')
                }}
              </p>
            </div>
            <div class="series-workspace__section-actions">
              <el-button plain @click="beginNewPublishProfile">
                {{ t('seriesWorkspace.profileEditor.actions.new') }}
              </el-button>
              <el-button plain @click="openSaveAsDialog('copy')">
                {{ t('seriesWorkspace.profileEditor.actions.copy') }}
              </el-button>
            </div>
          </div>

          <section class="series-workspace__stack-card">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.profileEditor.basic.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.profileEditor.basic.text') }}</div>

            <div class="series-workspace__form-grid">
              <label class="series-workspace__field">
                <span class="series-workspace__field-label">{{ t('seriesWorkspace.profileEditor.fields.name') }}</span>
                <el-input
                  v-model="profileForm.name"
                  :placeholder="t('seriesWorkspace.profileEditor.fields.namePlaceholder')"
                />
              </label>

              <label class="series-workspace__field series-workspace__field--switch">
                <span class="series-workspace__field-label">
                  {{ t('seriesWorkspace.profileEditor.fields.defaultProfile') }}
                </span>
                <div class="series-workspace__switch-row">
                  <el-switch v-model="profileForm.isDefault" />
                  <span class="series-workspace__field-help">
                    {{ t('seriesWorkspace.profileEditor.fields.defaultProfileHelp') }}
                  </span>
                </div>
              </label>
            </div>

            <div class="series-workspace__form-grid">
              <div class="series-workspace__field">
                <span class="series-workspace__field-label">{{ t('seriesWorkspace.profileEditor.fields.videoProfiles') }}</span>
                <el-checkbox-group v-model="profileForm.videoProfiles" class="series-workspace__checkbox-row">
                  <el-checkbox-button
                    v-for="option in publishProfileVideoOptions"
                    :key="option.value"
                    :label="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </el-checkbox-button>
                </el-checkbox-group>
              </div>

              <div class="series-workspace__field">
                <span class="series-workspace__field-label">
                  {{ t('seriesWorkspace.profileEditor.fields.subtitleProfiles') }}
                </span>
                <el-checkbox-group v-model="profileForm.subtitleProfiles" class="series-workspace__checkbox-row">
                  <el-checkbox-button
                    v-for="option in publishProfileSubtitleOptions"
                    :key="option.value"
                    :label="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </el-checkbox-button>
                </el-checkbox-group>
              </div>
            </div>

            <div class="series-workspace__field-help">
              {{
                t('seriesWorkspace.profileEditor.combinationSummary', {
                  count: currentProfileCombinationCount,
                  names: currentProfileCombinationPreview,
                })
              }}
            </div>
          </section>

          <section class="series-workspace__stack-card">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.profileEditor.titlePreset.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.profileEditor.titlePreset.text') }}</div>

            <label class="series-workspace__field">
              <span class="series-workspace__field-label">{{ t('seriesWorkspace.profileEditor.fields.titleTemplate') }}</span>
              <el-input
                v-model="profileForm.titleTemplate"
                type="textarea"
                :rows="3"
                :placeholder="t('seriesWorkspace.profileEditor.fields.titleTemplatePlaceholder')"
              />
            </label>

            <div class="series-workspace__token-list">
              <span v-for="token in templateTokens" :key="token" class="series-workspace__token-chip">{{ token }}</span>
            </div>

            <div class="series-workspace__preview-card">
              <div class="series-workspace__preview-label">{{ t('seriesWorkspace.profileEditor.preview.title') }}</div>
              <div class="series-workspace__preview-value">{{ titlePreview }}</div>
            </div>

            <el-alert
              v-if="titlePreviewMissingTokens.length"
              type="info"
              :title="t('seriesWorkspace.profileEditor.preview.placeholderTitle')"
              :description="
                t('seriesWorkspace.profileEditor.preview.placeholderText', {
                  tokens: titlePreviewMissingTokens.join(' / '),
                })
              "
              :closable="false"
              show-icon
            />
          </section>

          <section class="series-workspace__stack-card">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.profileEditor.siteDrafts.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.profileEditor.siteDrafts.text') }}</div>

            <div class="series-workspace__site-grid series-workspace__site-grid--drafts">
              <article
                v-for="card in siteDraftCards"
                :key="card.siteId"
                class="series-workspace__site-card"
                :class="{ 'series-workspace__site-card--muted': !card.enabled }"
              >
                <div class="series-workspace__site-card-head">
                  <div class="series-workspace__site-card-title">{{ getDisplaySiteLabel(card.siteId) }}</div>
                  <div class="series-workspace__site-card-tags">
                    <el-tag :type="card.enabled ? 'success' : 'info'" effect="plain" size="small">
                      {{
                        card.enabled
                          ? t('seriesWorkspace.profileEditor.siteDrafts.enabledTag')
                          : t('seriesWorkspace.profileEditor.siteDrafts.disabledTag')
                      }}
                    </el-tag>
                    <el-tag v-if="card.entry.useGlobalTitle" effect="plain" size="small">
                      {{ t('seriesWorkspace.profileEditor.siteDrafts.useGlobalTitleTag') }}
                    </el-tag>
                  </div>
                </div>

                <div class="series-workspace__site-card-text">
                  {{
                    card.enabled
                      ? t('seriesWorkspace.profileEditor.siteDrafts.enabledText')
                      : t('seriesWorkspace.profileEditor.siteDrafts.disabledText')
                  }}
                </div>

                <label class="series-workspace__field series-workspace__field--switch">
                  <span class="series-workspace__field-label">
                    {{ t('seriesWorkspace.profileEditor.siteDrafts.useGlobalTitle') }}
                  </span>
                  <div class="series-workspace__switch-row">
                    <el-switch v-model="card.entry.useGlobalTitle" />
                    <span class="series-workspace__field-help">
                      {{
                        card.entry.useGlobalTitle
                          ? t('seriesWorkspace.profileEditor.siteDrafts.useGlobalTitleEnabled')
                          : t('seriesWorkspace.profileEditor.siteDrafts.useGlobalTitleDisabled')
                      }}
                    </span>
                  </div>
                </label>

                <label v-if="!card.entry.useGlobalTitle" class="series-workspace__field">
                  <span class="series-workspace__field-label">
                    {{ t('seriesWorkspace.profileEditor.siteDrafts.titleOverride') }}
                  </span>
                  <el-input
                    v-model="card.entry.titleTemplate"
                    type="textarea"
                    :rows="2"
                    :placeholder="t('seriesWorkspace.profileEditor.siteDrafts.titleOverridePlaceholder')"
                  />
                </label>

                <label class="series-workspace__field">
                  <span class="series-workspace__field-label">
                    {{ t('seriesWorkspace.profileEditor.siteDrafts.summaryTemplate') }}
                  </span>
                  <el-input
                    v-model="card.entry.summaryTemplate"
                    type="textarea"
                    :rows="4"
                    :placeholder="t('seriesWorkspace.profileEditor.fields.summaryTemplatePlaceholder')"
                  />
                </label>

                <label class="series-workspace__field">
                  <span class="series-workspace__field-label">
                    {{ t('seriesWorkspace.profileEditor.siteDrafts.note') }}
                  </span>
                  <el-input
                    v-model="card.entry.note"
                    type="textarea"
                    :rows="2"
                    :placeholder="t('seriesWorkspace.profileEditor.siteDrafts.notePlaceholder')"
                  />
                </label>

                <div class="series-workspace__site-preview-grid">
                  <div class="series-workspace__preview-card">
                    <div class="series-workspace__preview-label">{{ t('seriesWorkspace.profileEditor.preview.title') }}</div>
                    <div class="series-workspace__preview-copy">{{ card.titlePreview }}</div>
                  </div>
                  <div class="series-workspace__preview-card series-workspace__preview-card--multiline">
                    <div class="series-workspace__preview-label">
                      {{ t('seriesWorkspace.profileEditor.preview.summary') }}
                    </div>
                    <div class="series-workspace__preview-copy">{{ card.summaryPreview }}</div>
                  </div>
                </div>
              </article>
            </div>

            <div class="series-workspace__field-help">
              {{
                t('seriesWorkspace.profileEditor.siteDrafts.scope', {
                  sites: formatSiteLabels(profileForm.targetSites),
                })
              }}
            </div>
          </section>

          <section class="series-workspace__stack-card">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.profileEditor.defaultSites.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.profileEditor.defaultSites.text') }}</div>

            <div class="series-workspace__site-grid series-workspace__site-grid--targets">
              <article
                v-for="card in targetSiteCards"
                :key="card.siteId"
                class="series-workspace__site-card series-workspace__site-card--selectable"
                :class="{
                  'series-workspace__site-card--active': card.enabled,
                  'series-workspace__site-card--disabled': !card.selectable,
                }"
                :tabindex="card.selectable ? 0 : -1"
                role="button"
                @click="toggleTargetSite(card.siteId)"
                @keydown.enter.prevent="toggleTargetSite(card.siteId)"
                @keydown.space.prevent="toggleTargetSite(card.siteId)"
              >
                <div class="series-workspace__site-card-head">
                  <div class="series-workspace__site-card-title">{{ card.label }}</div>
                  <div class="series-workspace__site-card-tags">
                    <el-tag :type="card.tone" effect="plain" size="small">
                      {{ card.stateLabel }}
                    </el-tag>
                    <el-tag v-if="card.enabled" type="success" effect="plain" size="small">
                      {{ t('seriesWorkspace.profileEditor.defaultSites.selectedTag') }}
                    </el-tag>
                  </div>
                </div>
                <div class="series-workspace__site-card-text">{{ card.text }}</div>
                <div v-if="!card.selectable" class="series-workspace__site-card-actions">
                  <el-button link type="primary" @click.stop="openAccountsPage">
                    {{ t('seriesWorkspace.profileEditor.defaultSites.configureAction') }}
                  </el-button>
                </div>
              </article>
            </div>

            <div class="series-workspace__field-help">
              {{
                t('seriesWorkspace.profileEditor.defaultSites.summary', {
                  sites: formatSiteLabels(profileForm.targetSites),
                })
              }}
            </div>
          </section>

          <section class="series-workspace__stack-card">
            <div class="series-workspace__card-title">{{ t('seriesWorkspace.profileEditor.siteFields.title') }}</div>
            <div class="series-workspace__card-text">{{ t('seriesWorkspace.profileEditor.siteFields.text') }}</div>
            <el-alert
              v-if="siteCatalogError"
              type="error"
              :title="t('seriesWorkspace.profileEditor.siteFields.loadErrorTitle')"
              :description="siteCatalogError"
              :closable="false"
              show-icon
            />

            <template v-if="profileForm.targetSites.length">
              <div v-if="siteFieldCards.length && !siteCatalogError" class="series-workspace__site-grid series-workspace__site-grid--fields">
                <article v-for="card in siteFieldCards" :key="card.siteId" class="series-workspace__site-card">
                  <div class="series-workspace__site-card-head">
                    <div class="series-workspace__site-card-title">{{ getDisplaySiteLabel(card.siteId) }}</div>
                    <el-tag
                      v-if="card.required"
                      :type="card.missing ? 'warning' : 'success'"
                      effect="plain"
                      size="small"
                    >
                      {{
                        card.missing
                          ? t('seriesWorkspace.profileEditor.siteFields.requiredMissing')
                          : t('seriesWorkspace.profileEditor.siteFields.requiredReady')
                      }}
                    </el-tag>
                    <el-tag v-else effect="plain" size="small">
                      {{ t('seriesWorkspace.profileEditor.siteFields.noExtraFieldsTag') }}
                    </el-tag>
                  </div>
                  <div class="series-workspace__site-card-text">
                    {{
                      card.hasSchema
                        ? t('seriesWorkspace.profileEditor.siteFields.schemaText')
                        : t('seriesWorkspace.profileEditor.siteFields.noExtraFieldsText')
                    }}
                  </div>

                  <label v-for="field in card.fields" :key="field.key" class="series-workspace__field">
                    <div class="series-workspace__field-head">
                      <span class="series-workspace__field-label">
                        {{ t(field.labelKey) }}
                      </span>
                      <div class="series-workspace__site-card-tags">
                        <el-tag :type="getSiteFieldModeTagType(field.mode)" effect="plain" size="small">
                          {{ t(`seriesWorkspace.profileEditor.siteFields.mode.${field.mode}`) }}
                        </el-tag>
                        <el-tag
                          v-if="field.source !== 'unset'"
                          :type="field.source === 'project' ? 'info' : 'success'"
                          effect="plain"
                          size="small"
                        >
                          {{ t(`seriesWorkspace.profileEditor.siteFields.source.${field.source}`) }}
                        </el-tag>
                      </div>
                    </div>
                    <el-input
                      v-if="field.mode === 'readonly'"
                      :model-value="field.resolvedLabel"
                      readonly
                      :placeholder="t('seriesWorkspace.profileEditor.siteFields.readonlyEmpty')"
                    />
                    <el-select
                      v-else-if="field.control === 'select'"
                      v-model="card.entry[field.key]"
                      clearable
                    >
                      <el-option
                        v-for="option in field.options ?? []"
                        :key="option.value"
                        :label="option.labelKey ? t(option.labelKey) : option.label"
                        :value="option.value"
                      />
                    </el-select>
                    <el-switch
                      v-else-if="field.control === 'checkbox'"
                      v-model="card.entry[field.key]"
                    />
                    <el-input
                      v-else-if="field.control === 'text'"
                      v-model="card.entry[field.key]"
                      clearable
                      :placeholder="field.placeholderKey ? t(field.placeholderKey) : undefined"
                    />
                    <el-input-number
                      v-else-if="field.control === 'number'"
                      v-model="card.entry[field.key]"
                      :controls="false"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step ?? 1"
                    />
                    <span class="series-workspace__field-help">
                      {{ t(field.helpKey) }}
                    </span>
                    <span
                      v-if="field.mode === 'readonly' && !field.resolvedLabel"
                      class="series-workspace__field-help"
                    >
                      {{ t('seriesWorkspace.profileEditor.siteFields.readonlyEmpty') }}
                    </span>
                    <span
                      v-else-if="field.source === 'project' && field.inheritedLabel"
                      class="series-workspace__field-help"
                    >
                      {{
                        t('seriesWorkspace.profileEditor.siteFields.inheritedValue', {
                          value: field.inheritedLabel,
                        })
                      }}
                    </span>
                  </label>
                </article>
              </div>
              <div v-else class="series-workspace__empty">
                {{ t('seriesWorkspace.profileEditor.siteFields.unavailable') }}
              </div>
              <el-alert
                v-if="hiddenSiteFieldLabels.length"
                class="series-workspace__alert--preline"
                :title="
                  t('seriesWorkspace.profileEditor.siteFields.hiddenAlert', {
                    sites: hiddenSiteFieldLabels.join(' / '),
                  })
                "
                :description="hiddenSiteFieldDescription"
                type="info"
                :closable="false"
                show-icon
              />
              <el-alert
                v-if="currentProfileMissingSiteFields.length"
                :title="
                  t('seriesWorkspace.profileEditor.siteFields.missingAlert', {
                    sites: currentProfileMissingSiteFields.join(' / '),
                  })
                "
                type="warning"
                :closable="false"
                show-icon
              />
            </template>
            <div v-else class="series-workspace__empty">
              {{ t('seriesWorkspace.profileEditor.siteFields.empty') }}
            </div>
          </section>

          <el-alert
            v-if="profileSaveError"
            type="error"
            :title="t('seriesWorkspace.profileEditor.saveErrorTitle')"
            :description="profileSaveError"
            :closable="false"
            show-icon
          />

          <footer class="series-workspace__savebar">
            <div class="series-workspace__savebar-copy">
              <div class="series-workspace__savebar-title">
                {{
                  profileDirty
                    ? t('seriesWorkspace.profileEditor.unsaved')
                    : t('seriesWorkspace.profileEditor.savedState')
                }}
              </div>
              <div class="series-workspace__savebar-text">{{ applyProfileHint }}</div>
            </div>
            <div class="series-workspace__savebar-actions">
              <el-button type="primary" :loading="isSavingProfile" @click="saveCurrentProfile">
                {{ t('common.save') }}
              </el-button>
              <el-button plain @click="openSaveAsDialog('saveAs')">
                {{ t('seriesWorkspace.profileEditor.actions.saveAs') }}
              </el-button>
              <el-button plain @click="openSaveAsDialog('copy')">
                {{ t('seriesWorkspace.profileEditor.actions.copy') }}
              </el-button>
              <el-button
                plain
                :disabled="!canApplySavedSelectedProfile"
                :loading="isApplyingProfile"
                @click="applySelectedProfileToCurrentEpisode"
              >
                {{ t('seriesWorkspace.profileEditor.actions.applyToEpisode') }}
              </el-button>
              <el-button
                plain
                type="danger"
                :disabled="!selectedSavedProfile"
                :loading="removingProfileId === selectedPublishProfileId"
                @click="removeCurrentProfile"
              >
                {{ t('common.delete') }}
              </el-button>
            </div>
          </footer>
        </article>
      </section>

      <section class="series-workspace__execution-grid">
        <article class="series-workspace__side-card">
          <div class="series-workspace__section-title">{{ t('seriesWorkspace.variants.title') }}</div>
          <p class="series-workspace__section-text">
            {{
              selectedEpisode
                ? t('seriesWorkspace.variants.text', { episode: selectedEpisode.episodeLabel })
                : t('seriesWorkspace.variants.selectEpisodeFirst')
            }}
          </p>

          <div v-if="selectedEpisode?.variants.length" class="series-workspace__variant-list">
            <article
              v-for="variant in selectedEpisode.variants"
              :key="variant.id"
              class="series-workspace__variant-card"
              :class="{ 'series-workspace__variant-card--active': isActiveVariant(selectedEpisode.id, variant.id) }"
            >
              <div class="series-workspace__variant-head">
                <div>
                  <div class="series-workspace__variant-name">{{ variant.name }}</div>
                  <div class="series-workspace__variant-profile">
                    {{
                      t('seriesWorkspace.variants.card.profile', {
                        name: getVariantPublishProfileLabel(variant) || t('seriesWorkspace.execution.profile.unlinked'),
                      })
                    }}
                  </div>
                </div>
                <div class="series-workspace__site-card-tags">
                  <el-tag
                    v-if="isVariantLinkedToPublishProfile(variant)"
                    effect="plain"
                    size="small"
                    type="success"
                  >
                    {{ t('seriesWorkspace.variants.card.linked') }}
                  </el-tag>
                  <el-tag v-else effect="plain" size="small" type="info">
                    {{ t('seriesWorkspace.variants.card.unlinked') }}
                  </el-tag>
                  <el-tag
                    v-if="isActiveVariant(selectedEpisode.id, variant.id)"
                    effect="plain"
                    size="small"
                    type="success"
                  >
                    {{ t('seriesWorkspace.variants.card.active') }}
                  </el-tag>
                </div>
              </div>

              <div v-if="variant.videoProfile || variant.subtitleProfile" class="series-workspace__variant-tags">
                <el-tag v-if="variant.videoProfile" effect="plain" size="small">
                  {{ getVideoProfileLabel(variant.videoProfile) }}
                </el-tag>
                <el-tag v-if="variant.subtitleProfile" effect="plain" size="small" type="info">
                  {{ getSubtitleProfileLabel(variant.subtitleProfile) }}
                </el-tag>
              </div>

              <div class="series-workspace__variant-title">
                {{ variant.title || t('seriesWorkspace.variants.card.titleEmpty') }}
              </div>

              <div class="series-workspace__variant-progress">
                <el-tag effect="plain" size="small" type="success">
                  {{
                    t('seriesWorkspace.variants.card.progress.published', {
                      count: getVariantProgressSummary(variant).publishedSiteIds.length,
                    })
                  }}
                </el-tag>
                <el-tag effect="plain" size="small" type="warning">
                  {{
                    t('seriesWorkspace.variants.card.progress.pending', {
                      count: getVariantProgressSummary(variant).pendingSiteIds.length,
                    })
                  }}
                </el-tag>
                <el-tag
                  v-if="getVariantProgressSummary(variant).failedSiteIds.length"
                  effect="plain"
                  size="small"
                  type="danger"
                >
                  {{
                    t('seriesWorkspace.variants.card.progress.failed', {
                      count: getVariantProgressSummary(variant).failedSiteIds.length,
                    })
                  }}
                </el-tag>
              </div>

              <div class="series-workspace__meta-list">
                <span>
                  {{
                    t('seriesWorkspace.variants.card.targetSites', {
                      count: variant.targetSites?.length ?? 0,
                    })
                  }}
                </span>
                <span>{{ t('seriesWorkspace.variants.card.directory') }}: {{ variant.directoryName }}</span>
                <span>{{ t('seriesWorkspace.variants.card.updatedAt', { time: formatProjectTimestamp(variant.updatedAt) }) }}</span>
              </div>

              <div class="series-workspace__variant-actions">
                <el-button
                  size="small"
                  type="primary"
                  :loading="activatingVariantId === variant.id"
                  @click="activateVariant(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.activate') }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  :loading="syncingVariantId === variant.id"
                  @click="syncVariantFromDraft(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.sync') }}
                </el-button>
                <el-button
                  v-if="
                    getVariantProgressSummary(variant).pendingSiteIds.length ||
                    getVariantProgressSummary(variant).failedSiteIds.length
                  "
                  size="small"
                  plain
                  type="warning"
                  :loading="refillVariantId === variant.id"
                  @click="refillVariantPublishTargets(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.refill') }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  :loading="duplicatingVariantId === variant.id"
                  @click="duplicateVariant(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.duplicate') }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :loading="removingVariantId === variant.id"
                  @click="removeVariant(selectedEpisode, variant)"
                >
                  {{ t('seriesWorkspace.variants.card.remove') }}
                </el-button>
              </div>
            </article>
          </div>

          <div v-else class="series-workspace__empty">
            {{ t('seriesWorkspace.variants.empty') }}
          </div>
        </article>

        <div class="series-workspace__side-stack">
          <article class="series-workspace__side-card">
            <div class="series-workspace__section-title">{{ t('seriesWorkspace.execution.differences.title') }}</div>
            <p class="series-workspace__section-text">{{ t('seriesWorkspace.execution.differences.text') }}</p>

            <template v-if="selectedEpisode">
              <div class="series-workspace__difference-list">
                <article
                  v-for="item in selectedEpisodeDifferenceFields"
                  :key="item.key"
                  class="series-workspace__difference-item"
                >
                  <div class="series-workspace__field-label">{{ item.label }}</div>
                  <div class="series-workspace__difference-value">{{ item.value }}</div>
                </article>
              </div>

              <el-alert
                v-if="!selectedEpisodeUsesActiveDraft"
                type="info"
                :title="t('seriesWorkspace.execution.differences.inactiveNotice')"
                :description="t('seriesWorkspace.execution.differences.inactiveHelp')"
                :closable="false"
                show-icon
              />

              <div class="series-workspace__preview-card series-workspace__preview-card--multiline">
                <div class="series-workspace__preview-label">
                  {{ t('seriesWorkspace.execution.sources.title') }}
                </div>
                <div class="series-workspace__card-text">
                  {{ t('seriesWorkspace.execution.sources.text') }}
                </div>

                <div class="series-workspace__source-groups">
                  <article
                    v-for="group in selectedEpisodeExecutionSourceGroups"
                    :key="group.key"
                    class="series-workspace__source-group"
                  >
                    <div class="series-workspace__site-card-head">
                      <div class="series-workspace__difference-value">{{ group.title }}</div>
                      <el-tag :type="group.tone" effect="plain" size="small">{{ group.entries.length }}</el-tag>
                    </div>

                    <div v-if="group.entries.length" class="series-workspace__difference-list">
                      <article
                        v-for="entry in group.entries"
                        :key="entry.key"
                        class="series-workspace__difference-item"
                      >
                        <div class="series-workspace__field-label">{{ entry.label }}</div>
                        <div class="series-workspace__difference-value">{{ entry.value }}</div>
                      </article>
                    </div>

                    <div v-else class="series-workspace__empty">
                      {{ group.emptyText }}
                    </div>
                  </article>
                </div>
              </div>

              <div class="series-workspace__preview-card series-workspace__preview-card--multiline">
                <div class="series-workspace__preview-label">
                  {{ t('seriesWorkspace.execution.differences.siteOverrides') }}
                </div>

                <div v-if="selectedEpisodeSiteOverrides.length" class="series-workspace__difference-overrides">
                  <article
                    v-for="entry in selectedEpisodeSiteOverrides"
                    :key="entry.key"
                    class="series-workspace__difference-override"
                  >
                    <div class="series-workspace__difference-value">{{ entry.label }}</div>
                    <div class="series-workspace__card-text">{{ entry.value }}</div>
                    <el-tag effect="plain" size="small" type="warning">{{ entry.sourceLabel }}</el-tag>
                  </article>
                </div>

                <div v-else class="series-workspace__empty">
                  {{ t('seriesWorkspace.execution.differences.siteOverridesEmpty') }}
                </div>
              </div>
            </template>

            <div v-else class="series-workspace__empty">
              {{ t('seriesWorkspace.execution.differences.empty') }}
            </div>
          </article>

          <article class="series-workspace__side-card">
            <div class="series-workspace__section-title">{{ t('seriesWorkspace.variants.create.title') }}</div>
            <p class="series-workspace__section-text">{{ t('seriesWorkspace.variants.create.text') }}</p>

            <div class="series-workspace__compact-grid">
              <label class="series-workspace__field">
                <span class="series-workspace__field-label">{{ t('seriesWorkspace.profileEditor.fields.videoProfiles') }}</span>
                <el-select v-model="variantForm.videoProfile">
                  <el-option
                    v-for="option in videoProfileOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </label>

              <label class="series-workspace__field">
                <span class="series-workspace__field-label">
                  {{ t('seriesWorkspace.profileEditor.fields.subtitleProfiles') }}
                </span>
                <el-select v-model="variantForm.subtitleProfile">
                  <el-option
                    v-for="option in subtitleProfileOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
              </label>
            </div>

            <label class="series-workspace__field">
              <span class="series-workspace__field-label">{{ t('seriesWorkspace.variants.form.namePlaceholder') }}</span>
              <el-input
                v-model="variantForm.nameOverride"
                :placeholder="
                  requiresVariantNameOverride
                    ? t('seriesWorkspace.variants.form.nameCustomPlaceholder')
                    : t('seriesWorkspace.variants.form.nameOverridePlaceholder')
                "
              />
            </label>

            <div class="series-workspace__preview-card">
              <div class="series-workspace__preview-label">{{ t('seriesWorkspace.variants.form.previewLabel') }}</div>
              <div class="series-workspace__preview-value">
                {{ variantName || t('seriesWorkspace.variants.form.previewEmpty') }}
              </div>
            </div>

            <el-checkbox v-model="variantForm.useSelectedProfile">
              {{ t('seriesWorkspace.variants.create.useSelectedProfile') }}
            </el-checkbox>

            <div class="series-workspace__meta-list">
              <span>{{ t('seriesWorkspace.variants.single.targetSites', { sites: manualVariantTargetSitesPreview }) }}</span>
              <span>{{ t('seriesWorkspace.variants.single.titleTemplate', { template: manualVariantTitlePreview }) }}</span>
              <span>{{ t('seriesWorkspace.variants.single.summaryTemplate', { template: manualVariantSummaryPreview }) }}</span>
            </div>

            <el-button type="primary" :disabled="!selectedEpisode" :loading="isCreatingVariant" @click="createVariant">
              {{ t('seriesWorkspace.variants.form.submit') }}
            </el-button>
          </article>
        </div>
      </section>

      <section v-if="editorVisible" class="series-workspace__editor">
        <EpisodeEdit
          :id="props.id"
          :key="editorKey"
          :project="props.project"
          :project-site-field-defaults="workspace?.projectSiteFieldDefaults"
          :active-episode="activeEpisode"
          :active-variant="activeVariant"
        />
      </section>
    </template>

    <el-dialog
      v-model="episodeDialogVisible"
      :title="t('seriesWorkspace.episodes.dialog.title')"
      width="32rem"
      destroy-on-close
    >
      <div class="series-workspace__dialog-copy">{{ t('seriesWorkspace.episodes.dialog.text') }}</div>

      <el-alert
        v-if="recentEpisodeGuideActionLabel"
        :type="canRunRecentEpisodeGuideAction ? 'info' : 'warning'"
        :title="t('seriesWorkspace.episodes.dialog.recentTitle', { action: recentEpisodeGuideActionLabel })"
        :description="recentEpisodeGuideActionHelp"
        :closable="false"
        show-icon
      />

      <div class="series-workspace__dialog-grid">
        <label class="series-workspace__field">
          <span class="series-workspace__field-label">{{ t('seriesWorkspace.episodes.form.labelPlaceholder') }}</span>
          <el-input v-model="episodeForm.episodeLabel" :placeholder="t('seriesWorkspace.episodes.form.labelPlaceholder')" />
        </label>

        <label class="series-workspace__field">
          <span class="series-workspace__field-label">{{ t('seriesWorkspace.episodes.form.titlePlaceholder') }}</span>
          <el-input v-model="episodeForm.episodeTitle" :placeholder="t('seriesWorkspace.episodes.form.titlePlaceholder')" />
        </label>
      </div>

      <template #footer>
        <el-button @click="episodeDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button
          plain
          :disabled="!defaultPublishProfile"
          :loading="isCreatingEpisode || isApplyingProfile"
          @click="createEpisode({ followupAction: 'default' })"
        >
          {{ t('seriesWorkspace.episodes.form.submitWithDefault') }}
        </el-button>
        <el-button
          v-if="recentEpisodeGuideActionLabel"
          plain
          :disabled="!canRunRecentEpisodeGuideAction"
          :loading="isCreatingEpisode || isApplyingProfile || isInheritingVariants"
          @click="createEpisode({ followupAction: recentEpisodeGuideAction ?? undefined })"
        >
          {{ t('seriesWorkspace.episodes.form.submitWithRecent') }}
        </el-button>
        <el-button type="primary" :loading="isCreatingEpisode" @click="createEpisode()">
          {{ t('seriesWorkspace.episodes.form.submit') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="episodeGuideVisible"
      :title="t('seriesWorkspace.episodeGuide.title', { episode: guideEpisode?.episodeLabel ?? '' })"
      width="44rem"
      destroy-on-close
    >
      <div class="series-workspace__dialog-copy">{{ t('seriesWorkspace.episodeGuide.text') }}</div>

      <div class="series-workspace__guide-grid">
        <article class="series-workspace__guide-card series-workspace__guide-card--recommended">
          <div class="series-workspace__guide-badge">{{ t('seriesWorkspace.episodeGuide.recommended') }}</div>
          <div class="series-workspace__guide-title">{{ t('seriesWorkspace.episodeGuide.default.title') }}</div>
          <div class="series-workspace__guide-text">
            {{
              defaultPublishProfile
                ? t('seriesWorkspace.episodeGuide.default.text', { profile: defaultPublishProfile.name })
                : t('seriesWorkspace.episodeGuide.default.disabled')
            }}
          </div>
          <el-button
            type="primary"
            :disabled="!guideEpisode || !defaultPublishProfile"
            :loading="isApplyingProfile"
            @click="applyDefaultProfileToGuideEpisode"
          >
            {{ t('seriesWorkspace.episodeGuide.default.action') }}
          </el-button>
        </article>

        <article class="series-workspace__guide-card">
          <div class="series-workspace__guide-title">{{ t('seriesWorkspace.episodeGuide.inherit.title') }}</div>
          <div class="series-workspace__guide-text">
            {{
              guideEpisode && getPreviousEpisode(guideEpisode.id)
                ? t('seriesWorkspace.episodeGuide.inherit.text', {
                    episode: getPreviousEpisode(guideEpisode.id)?.episodeLabel,
                  })
                : t('seriesWorkspace.episodeGuide.inherit.disabled')
            }}
          </div>
          <el-button
            plain
            :disabled="!guideEpisode || !getPreviousEpisode(guideEpisode.id)"
            :loading="isInheritingVariants"
            @click="inheritVariantsFromGuideEpisode"
          >
            {{ t('seriesWorkspace.episodeGuide.inherit.action') }}
          </el-button>
        </article>

        <article class="series-workspace__guide-card">
          <div class="series-workspace__guide-title">{{ t('seriesWorkspace.episodeGuide.blank.title') }}</div>
          <div class="series-workspace__guide-text">{{ t('seriesWorkspace.episodeGuide.blank.text') }}</div>
          <el-button plain @click="keepGuideEpisodeBlank">
            {{ t('seriesWorkspace.episodeGuide.blank.action') }}
          </el-button>
        </article>
      </div>
    </el-dialog>

    <el-dialog
      v-model="dirtySwitchDialogVisible"
      :title="t('seriesWorkspace.profileSwitch.title')"
      width="30rem"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      destroy-on-close
    >
      <div class="series-workspace__dialog-copy">{{ dirtySwitchDialogText }}</div>

      <template #footer>
        <el-button @click="closeDirtySwitchDialog">{{ t('common.cancel') }}</el-button>
        <el-button plain @click="discardAndSwitchProfile">
          {{ t('seriesWorkspace.profileSwitch.discard') }}
        </el-button>
        <el-button type="primary" :loading="isSavingProfile" @click="saveAndSwitchProfile">
          {{ t('seriesWorkspace.profileSwitch.save') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="saveAsDialogVisible" :title="saveAsDialogTitle" width="30rem" destroy-on-close>
      <div class="series-workspace__dialog-copy">{{ saveAsDialogText }}</div>

      <label class="series-workspace__field">
        <span class="series-workspace__field-label">{{ t('seriesWorkspace.profileEditor.fields.name') }}</span>
        <el-input v-model="saveAsName" :placeholder="t('seriesWorkspace.profileEditor.fields.namePlaceholder')" />
      </label>

      <template #footer>
        <el-button @click="saveAsDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="isSavingProfile" @click="confirmSaveAs">
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.series-workspace {
  display: grid;
  gap: 16px;
}

.series-workspace__skeleton,
.series-workspace__hero,
.series-workspace__profiles,
.series-workspace__editor-panel,
.series-workspace__side-card,
.series-workspace__metric {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 42%),
    color-mix(in srgb, var(--bg-panel) 92%, #09111c);
}

.series-workspace__skeleton,
.series-workspace__hero,
.series-workspace__profiles,
.series-workspace__editor-panel,
.series-workspace__side-card {
  padding: 18px;
}

.series-workspace__hero,
.series-workspace__profiles,
.series-workspace__editor-panel,
.series-workspace__side-card,
.series-workspace__metric,
.series-workspace__stack-card,
.series-workspace__variant-card,
.series-workspace__site-card,
.series-workspace__guide-card {
  display: grid;
  gap: 12px;
}

.series-workspace__hero {
  gap: 18px;
}

.series-workspace__hero-main {
  display: grid;
  gap: 10px;
}

.series-workspace__hero-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(28px, 3vw, 38px);
  letter-spacing: -0.05em;
  color: var(--text-primary);
}

.series-workspace__hero-text,
.series-workspace__hero-meta,
.series-workspace__section-text,
.series-workspace__card-text,
.series-workspace__metric-text,
.series-workspace__field-help,
.series-workspace__profile-card-summary,
.series-workspace__profile-card-combos,
.series-workspace__profile-card-time,
.series-workspace__variant-profile,
.series-workspace__episode-summary-text,
.series-workspace__guide-text,
.series-workspace__dialog-copy,
.series-workspace__empty,
.series-workspace__meta-list,
.series-workspace__savebar-text,
.series-workspace__site-card-text {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.series-workspace__hero-meta,
.series-workspace__meta-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.series-workspace__hero-actions,
.series-workspace__section-actions,
.series-workspace__savebar-actions,
.series-workspace__variant-actions,
.series-workspace__hero-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-workspace__hero-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.series-workspace__metric {
  padding: 16px;
}

.series-workspace__hero-workbench,
.series-workspace__execution-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.series-workspace__execution-grid {
  grid-template-columns: minmax(0, 1.2fr) minmax(20rem, 0.85fr);
  align-items: start;
}

.series-workspace__hero-band {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 86%, #0b1520);
}

.series-workspace__hero-band--actions {
  background:
    linear-gradient(180deg, rgba(198, 132, 72, 0.12), transparent 48%),
    color-mix(in srgb, var(--bg-panel) 86%, #0b1520);
}

.series-workspace__metric-label,
.series-workspace__section-title,
.series-workspace__card-title,
.series-workspace__preview-label,
.series-workspace__field-label,
.series-workspace__eyebrow,
.series-workspace__savebar-title {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.series-workspace__metric-value {
  font-family: var(--font-display);
  font-size: clamp(24px, 2.4vw, 32px);
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.series-workspace__section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.series-workspace__profiles {
  gap: 14px;
}

.series-workspace__profile-strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(16rem, 18rem);
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.series-workspace__profile-card,
.series-workspace__episode-chip {
  appearance: none;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 88%, #0a121d);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.series-workspace__profile-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  align-content: start;
}

.series-workspace__profile-card:hover,
.series-workspace__episode-chip:hover,
.series-workspace__variant-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 46%, var(--border-soft));
}

.series-workspace__profile-card--active,
.series-workspace__episode-chip--active,
.series-workspace__variant-card--active {
  border-color: color-mix(in srgb, var(--accent) 54%, var(--border-soft));
  box-shadow: 0 18px 36px rgba(3, 10, 19, 0.24);
}

.series-workspace__profile-card--create {
  border-style: dashed;
  place-content: center;
  min-height: 7.5rem;
}

.series-workspace__profile-card-head,
.series-workspace__variant-head,
.series-workspace__site-card-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.series-workspace__profile-card-name,
.series-workspace__variant-name,
.series-workspace__site-card-title,
.series-workspace__guide-title,
.series-workspace__episode-summary-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.series-workspace__content {
  display: grid;
  gap: 16px;
}

.series-workspace__editor-panel,
.series-workspace__execution-grid {
  align-self: start;
}

.series-workspace__stack-card {
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 84%, #0c1520);
}

.series-workspace__alert--preline :deep(.el-alert__description) {
  white-space: pre-line;
}

.series-workspace__form-grid,
.series-workspace__compact-grid,
.series-workspace__dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.series-workspace__site-grid {
  display: grid;
  gap: 12px;
}

.series-workspace__site-grid--targets {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.series-workspace__site-grid--drafts,
.series-workspace__site-grid--fields {
  grid-template-columns: minmax(0, 1fr);
}

.series-workspace__field {
  display: grid;
  gap: 8px;
}

.series-workspace__field-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.series-workspace__field--switch {
  align-content: start;
}

.series-workspace__switch-row {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 40px;
}

.series-workspace__checkbox-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-workspace__token-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-workspace__token-chip {
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border-soft));
  border-radius: 999px;
  background: rgba(198, 132, 72, 0.08);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.series-workspace__preview-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 90%, black);
}

.series-workspace__preview-card--multiline {
  min-height: 8rem;
}

.series-workspace__preview-value {
  font-family: var(--font-display);
  font-size: 20px;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.series-workspace__preview-copy,
.series-workspace__variant-title {
  white-space: pre-line;
  word-break: break-word;
  color: var(--text-primary);
  line-height: 1.7;
}

.series-workspace__site-card-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.series-workspace__site-grid,
.series-workspace__variant-list {
  gap: 12px;
}

.series-workspace__site-card,
.series-workspace__variant-card,
.series-workspace__guide-card {
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 86%, #09111b);
}

.series-workspace__site-card--selectable {
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.series-workspace__site-card--selectable:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-soft));
}

.series-workspace__site-card--muted {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 42%),
    color-mix(in srgb, var(--bg-panel) 88%, #0a121d);
  border-style: dashed;
}

.series-workspace__site-card--disabled {
  cursor: default;
  border-style: dashed;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 42%),
    color-mix(in srgb, var(--bg-panel) 88%, #0a121d);
}

.series-workspace__site-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.series-workspace__site-card-actions {
  display: flex;
  justify-content: flex-end;
}

.series-workspace__savebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  position: sticky;
  bottom: 0;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-soft));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 92%, #0a111b);
}

.series-workspace__episode-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-workspace__episode-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.series-workspace__episode-chip-label {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.series-workspace__episode-chip-meta {
  min-width: 1.6rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.series-workspace__variant-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-workspace__variant-progress {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-workspace__difference-overrides {
  display: grid;
  gap: 8px;
}

.series-workspace__source-groups {
  display: grid;
  gap: 12px;
}

.series-workspace__source-group {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 88%, #0a121d);
}

.series-workspace__side-stack {
  display: grid;
  gap: 16px;
  align-self: start;
}

.series-workspace__difference-list {
  display: grid;
  gap: 10px;
}

.series-workspace__difference-item,
.series-workspace__difference-override {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 88%, #0a121d);
}

.series-workspace__difference-value {
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
}

.series-workspace__variant-actions {
  justify-content: flex-end;
}

.series-workspace__guide-grid {
  display: grid;
  gap: 12px;
}

.series-workspace__guide-card--recommended {
  border-color: color-mix(in srgb, var(--accent) 46%, var(--border-soft));
  background:
    linear-gradient(180deg, rgba(198, 132, 72, 0.1), transparent 48%),
    color-mix(in srgb, var(--bg-panel) 86%, #09111b);
}

.series-workspace__guide-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(198, 132, 72, 0.14);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.series-workspace__editor {
  display: grid;
}

@media (max-width: 1180px) {
  .series-workspace__hero-workbench,
  .series-workspace__execution-grid,
  .series-workspace__hero-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 820px) {
  .series-workspace__hero-stats,
  .series-workspace__form-grid,
  .series-workspace__compact-grid,
  .series-workspace__dialog-grid,
  .series-workspace__site-grid,
  .series-workspace__site-preview-grid,
  .series-workspace__savebar {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-workspace__section-head,
  .series-workspace__savebar-actions,
  .series-workspace__hero-actions,
  .series-workspace__variant-actions,
  .series-workspace__hero-action-row {
    align-items: stretch;
  }

  .series-workspace__section-actions,
  .series-workspace__hero-actions,
  .series-workspace__savebar-actions,
  .series-workspace__variant-actions,
  .series-workspace__hero-action-row {
    flex-direction: column;
  }

  .series-workspace__section-actions :deep(.el-button),
  .series-workspace__hero-actions :deep(.el-button),
  .series-workspace__savebar-actions :deep(.el-button),
  .series-workspace__variant-actions :deep(.el-button),
  .series-workspace__hero-action-row :deep(.el-button) {
    width: 100%;
  }
}
</style>
