import { app, dialog } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { PublishResult, PublishState } from '../../shared/types/publish'
import type {
  BatchCreateSeriesVariantsInput,
  CreateProjectInput,
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  InheritSeriesEpisodeVariantsInput,
  LegacyProjectType,
  ProjectMode,
  ProjectSourceKind,
  RemoveSeriesPublishProfileInput,
  SaveSeriesPublishProfileInput,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesPublishProfile,
  SeriesPublishProfileSnapshot,
  SeriesPublishProfileSiteDraft,
  SeriesPublishProfileSiteDrafts,
  SeriesPublishProfileSiteFieldDefaults,
  SeriesPublishProfileTemplateContext,
  SeriesVariantTemplateSubtitleProfile,
  SeriesVariantTemplateVideoProfile,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
  SeriesProjectWorkspace,
  SeriesVariantDraftInput,
} from '../../shared/types/project'
import type { SiteId } from '../../shared/types/site'
import { getNowFormatDate } from '../core/utils'
import { createProjectStore } from '../storage/project-store'

type ProjectChangeHandler = () => void

const PUBLISH_PROFILE_TEMPLATE_CONTEXT_KEYS = [
  'title',
  'summary',
  'releaseTeam',
  'seriesLabel',
  'seriesTitleCN',
  'seriesTitleEN',
  'seriesTitleJP',
  'seasonLabel',
  'techLabel',
  'sourceType',
  'resolution',
  'videoCodec',
  'audioCodec',
  'variantName',
  'videoProfile',
  'subtitleProfile',
  'subtitleProfileLabel',
] as const

const PUBLISH_PROFILE_TEMPLATE_CONTENT_KEYS = [
  'releaseTeam',
  'seriesTitleCN',
  'seriesTitleEN',
  'seriesTitleJP',
  'seasonLabel',
  'sourceType',
  'resolution',
  'videoCodec',
  'audioCodec',
] as const

interface CreateProjectServiceOptions {
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged: ProjectChangeHandler
}

export function createProjectService(options: CreateProjectServiceOptions) {
  const { projectStore, notifyProjectDataChanged } = options
  const defaultEpisodeSites: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa']
  const trackedLegacyTorrentSites = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g'] as const
  const supportedVideoProfiles: SeriesVariantVideoProfile[] = ['1080p', '2160p', 'custom']
  const supportedSubtitleProfiles: SeriesVariantSubtitleProfile[] = ['chs', 'cht', 'eng', 'bilingual', 'custom']
  const supportedPublishStates: PublishState[] = ['idle', 'pending', 'published', 'failed']
  const seriesWorkspaceFileName = 'series-workspace.json'
  const episodesDirectoryName = 'episodes'
  const variantsDirectoryName = 'variants'

  function getSeriesWorkspacePath(projectPath: string) {
    return join(projectPath, seriesWorkspaceFileName)
  }

  function createDefaultSeriesWorkspace(projectId: number): SeriesProjectWorkspace {
    const timestamp = new Date(projectId).toISOString()
    return {
      projectId,
      episodes: [],
      publishProfiles: [],
      activeEpisodeId: undefined,
      activeVariantId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  function readWorkspacePublishProfiles(workspace: Partial<SeriesProjectWorkspace>) {
    const rawPublishProfiles = Array.isArray(workspace.publishProfiles)
      ? workspace.publishProfiles
      : Array.isArray(workspace.variantTemplates)
        ? workspace.variantTemplates
        : []

    return normalizePublishProfiles(
      rawPublishProfiles
        .filter((profile): profile is SeriesPublishProfile => {
          return typeof profile === 'object' && profile !== null && typeof profile.id === 'number'
        })
        .map(profile => {
          const titleTemplate = normalizeTitleTemplate(profile.titleTemplate)
          const legacySummaryTemplate = normalizeSummaryTemplate(profile.summaryTemplate)
          const siteDrafts = normalizeSiteDrafts(profile.siteDrafts, {
            targetSites: normalizeSiteIds(profile.targetSites),
            summaryTemplate: legacySummaryTemplate,
          })
          const targetSites = normalizeSiteIds([
            ...normalizeSiteIds(profile.targetSites),
            ...getEnabledSiteIdsFromSiteDrafts(siteDrafts),
          ])
          return {
            id: profile.id,
            name: profile.name ?? '',
            isDefault: Boolean(profile.isDefault),
            videoProfiles: Array.isArray(profile.videoProfiles)
              ? profile.videoProfiles.filter(
                  (item): item is SeriesVariantTemplateVideoProfile => isSeriesVariantTemplateVideoProfile(item),
                )
              : [],
            subtitleProfiles: Array.isArray(profile.subtitleProfiles)
              ? profile.subtitleProfiles.filter(
                  (item): item is SeriesVariantTemplateSubtitleProfile =>
                    isSeriesVariantTemplateSubtitleProfile(item),
                )
              : [],
            templateContext: normalizePublishProfileTemplateContext(profile.templateContext),
            targetSites,
            titleTemplate,
            summaryTemplate: resolvePrimarySiteDraftSummaryTemplate(siteDrafts, targetSites, legacySummaryTemplate),
            siteDrafts,
            siteFieldDefaults: normalizeSiteFieldDefaults(profile.siteFieldDefaults),
            createdAt: profile.createdAt ?? new Date(profile.id).toISOString(),
            updatedAt: profile.updatedAt ?? new Date(profile.id).toISOString(),
          }
        })
        .filter(profile => profile.name && profile.videoProfiles.length && profile.subtitleProfiles.length),
    )
  }

  function serializeSeriesWorkspace(workspace: SeriesProjectWorkspace) {
    const {
      projectSiteFieldDefaults: _projectSiteFieldDefaults,
      variantTemplates: _legacyVariantTemplates,
      ...persistedWorkspace
    } = workspace
    const publishProfiles = normalizePublishProfiles(workspace.publishProfiles)

    return {
      ...persistedWorkspace,
      publishProfiles,
      variantTemplates: publishProfiles,
    }
  }

  function readSeriesWorkspace(projectId: number, projectPath: string): SeriesProjectWorkspace {
    const workspacePath = getSeriesWorkspacePath(projectPath)
    try {
      if (!fs.existsSync(workspacePath)) {
        return hydrateSeriesWorkspace(projectPath, createDefaultSeriesWorkspace(projectId))
      }

      const parsed = JSON.parse(fs.readFileSync(workspacePath, { encoding: 'utf-8' })) as Partial<SeriesProjectWorkspace>
      const publishProfiles = readWorkspacePublishProfiles(parsed)
      const episodes = Array.isArray(parsed.episodes)
        ? parsed.episodes
            .filter((episode): episode is SeriesProjectEpisode => {
              return typeof episode === 'object' && episode !== null && typeof episode.id === 'number'
            })
            .map(episode => {
              const nextEpisode: SeriesProjectEpisode = {
                id: episode.id,
                episodeLabel: episode.episodeLabel ?? '',
                episodeTitle: episode.episodeTitle || undefined,
                sortIndex: Number.isFinite(episode.sortIndex) ? episode.sortIndex : 0,
                directoryName: episode.directoryName ?? '',
                variantCount: Number.isFinite(episode.variantCount)
                  ? episode.variantCount
                  : Array.isArray(episode.variants)
                    ? episode.variants.length
                    : 0,
                variants: [],
                createdAt: episode.createdAt ?? new Date(episode.id).toISOString(),
                updatedAt: episode.updatedAt ?? new Date(episode.id).toISOString(),
              }

              nextEpisode.variants = Array.isArray(episode.variants)
                ? episode.variants
                    .filter((variant): variant is SeriesProjectVariant => {
                      return typeof variant === 'object' && variant !== null && typeof variant.id === 'number'
                    })
                    .map(variant => {
                      const matchedProfile =
                        typeof variant.publishProfileId === 'number'
                          ? publishProfiles.find(profile => profile.id === variant.publishProfileId)
                          : undefined
                      const videoProfile = isSeriesVariantVideoProfile(variant.videoProfile)
                        ? variant.videoProfile
                        : undefined
                      const subtitleProfile = isSeriesVariantSubtitleProfile(variant.subtitleProfile)
                        ? variant.subtitleProfile
                        : undefined
                      const publishProfileSnapshot = normalizePublishProfileSnapshot(variant.publishProfileSnapshot, {
                        profile: matchedProfile,
                        variant: {
                          name: variant.name ?? '',
                          videoProfile,
                          subtitleProfile,
                          publishProfileName: normalizeOptionalString(variant.publishProfileName),
                          targetSites: normalizeSiteIds(variant.targetSites),
                        },
                      })
                      const normalizedVariant: SeriesProjectVariant = {
                        id: variant.id,
                        name: variant.name ?? '',
                        directoryName: variant.directoryName ?? '',
                        videoProfile,
                        subtitleProfile,
                        publishProfileId:
                          typeof variant.publishProfileId === 'number' ? variant.publishProfileId : undefined,
                        publishProfileName:
                          normalizeOptionalString(variant.publishProfileName) ??
                          (typeof variant.publishProfileId === 'number'
                            ? publishProfileSnapshot?.name ?? matchedProfile?.name
                            : undefined),
                        publishProfileSnapshot,
                        publishResults: clonePublishResults(variant.publishResults),
                        targetSites: normalizeSiteIds(variant.targetSites),
                        title: normalizeOptionalString(variant.title),
                        createdAt: variant.createdAt ?? new Date(variant.id).toISOString(),
                        updatedAt: variant.updatedAt ?? new Date(variant.id).toISOString(),
                      }

                      return applyVariantSummary(normalizedVariant, readVariantConfigSummary(projectPath, nextEpisode, normalizedVariant))
                    })
                : []
              nextEpisode.variantCount = nextEpisode.variants.length
              return nextEpisode
            })
            .sort((left, right) => left.sortIndex - right.sortIndex)
        : []

      return hydrateSeriesWorkspace(projectPath, {
        projectId,
        episodes,
        publishProfiles,
        activeEpisodeId:
          typeof parsed.activeEpisodeId === 'number' ? parsed.activeEpisodeId : undefined,
        activeVariantId:
          typeof parsed.activeVariantId === 'number' ? parsed.activeVariantId : undefined,
        createdAt: parsed.createdAt ?? new Date(projectId).toISOString(),
        updatedAt: parsed.updatedAt ?? parsed.createdAt ?? new Date(projectId).toISOString(),
      })
    } catch {
      return hydrateSeriesWorkspace(projectPath, createDefaultSeriesWorkspace(projectId))
    }
  }

  function writeSeriesWorkspace(projectPath: string, workspace: SeriesProjectWorkspace) {
    const workspacePath = getSeriesWorkspacePath(projectPath)
    fs.writeFileSync(
      workspacePath,
      JSON.stringify(serializeSeriesWorkspace(workspace), null, 2),
    )
  }

  function writeEpisodeRecord(projectPath: string, episode: SeriesProjectEpisode) {
    const episodeDirectory = join(projectPath, episodesDirectoryName, episode.directoryName)
    fs.mkdirSync(episodeDirectory, { recursive: true })
    fs.writeFileSync(join(episodeDirectory, 'episode.json'), JSON.stringify(episode, null, 2))
  }

  function getVariantDirectoryPath(projectPath: string, episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
    return join(projectPath, episodesDirectoryName, episode.directoryName, variantsDirectoryName, variant.directoryName)
  }

  function getDraftConfigPath(projectPath: string) {
    return join(projectPath, 'config.json')
  }

  function getVariantConfigPath(projectPath: string, episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
    return join(getVariantDirectoryPath(projectPath, episode, variant), 'config.json')
  }

  function isSeriesVariantVideoProfile(value: unknown): value is SeriesVariantVideoProfile {
    return supportedVideoProfiles.includes(value as SeriesVariantVideoProfile)
  }

  function isSeriesVariantSubtitleProfile(value: unknown): value is SeriesVariantSubtitleProfile {
    return supportedSubtitleProfiles.includes(value as SeriesVariantSubtitleProfile)
  }

  function isSeriesVariantTemplateVideoProfile(value: unknown): value is SeriesVariantTemplateVideoProfile {
    return value !== 'custom' && isSeriesVariantVideoProfile(value)
  }

  function isSeriesVariantTemplateSubtitleProfile(value: unknown): value is SeriesVariantTemplateSubtitleProfile {
    return value !== 'custom' && isSeriesVariantSubtitleProfile(value)
  }

  function normalizeVariantVideoProfiles(profiles: SeriesVariantVideoProfile[]): SeriesVariantVideoProfile[] {
    const profileSet = new Set(profiles)
    return supportedVideoProfiles.filter(profile => profileSet.has(profile))
  }

  function normalizeVariantSubtitleProfiles(profiles: SeriesVariantSubtitleProfile[]): SeriesVariantSubtitleProfile[] {
    const profileSet = new Set(profiles)
    return supportedSubtitleProfiles.filter(profile => profileSet.has(profile))
  }

  function normalizeTemplateVideoProfiles(
    profiles: SeriesVariantTemplateVideoProfile[],
  ): SeriesVariantTemplateVideoProfile[] {
    return normalizeVariantVideoProfiles(profiles as SeriesVariantVideoProfile[]).filter(
      (profile): profile is SeriesVariantTemplateVideoProfile => profile !== 'custom',
    )
  }

  function normalizeTemplateSubtitleProfiles(
    profiles: SeriesVariantTemplateSubtitleProfile[],
  ): SeriesVariantTemplateSubtitleProfile[] {
    return normalizeVariantSubtitleProfiles(profiles as SeriesVariantSubtitleProfile[]).filter(
      (profile): profile is SeriesVariantTemplateSubtitleProfile => profile !== 'custom',
    )
  }

  function normalizeSiteIds(value: unknown): SiteId[] {
    if (!Array.isArray(value)) {
      return []
    }

    return [
      ...new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean),
      ),
    ]
  }

  function normalizeTitleTemplate(value: unknown) {
    if (typeof value !== 'string') {
      return undefined
    }

    const trimmedValue = value.trim()
    return trimmedValue || undefined
  }

  function normalizeSummaryTemplate(value: unknown) {
    if (typeof value !== 'string') {
      return undefined
    }

    const trimmedValue = value.trim()
    return trimmedValue || undefined
  }

  function normalizeOptionalString(value: unknown) {
    if (typeof value !== 'string') {
      return undefined
    }

    const trimmedValue = value.trim()
    return trimmedValue || undefined
  }

  function normalizePublishProfileTemplateContext(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }

    const rawContext = value as Partial<SeriesPublishProfileTemplateContext>
    const nextContext: SeriesPublishProfileTemplateContext = {}
    PUBLISH_PROFILE_TEMPLATE_CONTEXT_KEYS.forEach(key => {
      const normalizedValue = normalizeOptionalString(rawContext[key])
      if (normalizedValue) {
        nextContext[key] = normalizedValue
      }
    })

    return Object.keys(nextContext).length ? nextContext : undefined
  }

  function clonePublishProfileTemplateContext(context?: SeriesPublishProfileTemplateContext) {
    return normalizePublishProfileTemplateContext(context)
  }

  function serializePublishProfileTemplateContext(context?: SeriesPublishProfileTemplateContext) {
    const normalizedContext = normalizePublishProfileTemplateContext(context)
    if (!normalizedContext) {
      return ''
    }

    return PUBLISH_PROFILE_TEMPLATE_CONTEXT_KEYS.map(key => `${key}:${normalizedContext[key] ?? ''}`).join('|')
  }

  function clonePublishResults(value: unknown): PublishResult[] | undefined {
    if (!Array.isArray(value)) {
      return undefined
    }

    const nextResults = value
      .filter((result): result is PublishResult => {
        return (
          typeof result === 'object' &&
          result !== null &&
          typeof result.siteId === 'string' &&
          supportedPublishStates.includes(result.status as PublishState)
        )
      })
      .map(result => ({
        siteId: result.siteId,
        status: result.status,
        remoteId: normalizeOptionalString(result.remoteId),
        remoteUrl: normalizeOptionalString(result.remoteUrl),
        message: normalizeOptionalString(result.message),
        rawResponse: result.rawResponse,
        timestamp: normalizeOptionalString(result.timestamp),
      }))

    return nextResults.length ? nextResults : undefined
  }

  function getDraftPublishResults(projectId: number) {
    return clonePublishResults(projectStore.getProjectById(projectId)?.publishResults)
  }

  function replaceLegacyTaskPublishState(task: Config.Task, results?: PublishResult[]) {
    const nextResults = clonePublishResults(results)

    task.publishResults = nextResults
    task.forumLink = undefined
    trackedLegacyTorrentSites.forEach(siteId => {
      task[siteId] = undefined
    })

    nextResults?.forEach(result => {
      if (result.status !== 'published' || !result.remoteUrl) {
        return
      }

      if (result.siteId === 'forum') {
        if (!task.forumLink) {
          task.forumLink = result.remoteUrl
        }
        return
      }

      if (
        trackedLegacyTorrentSites.includes(result.siteId as (typeof trackedLegacyTorrentSites)[number]) &&
        !task[result.siteId as (typeof trackedLegacyTorrentSites)[number]]
      ) {
        task[result.siteId as (typeof trackedLegacyTorrentSites)[number]] = result.remoteUrl
      }
    })
  }

  function normalizeSiteFieldDefaults(value: unknown): SeriesPublishProfileSiteFieldDefaults | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }

    const nextFieldDefaults: Partial<Record<SiteId, Record<string, unknown>>> = {}
    Object.entries(value as Record<string, unknown>).forEach(([siteId, fieldDefaults]) => {
      const normalizedSiteId = normalizeSiteIds([siteId])[0]
      if (!normalizedSiteId || !fieldDefaults || typeof fieldDefaults !== 'object' || Array.isArray(fieldDefaults)) {
        return
      }

      nextFieldDefaults[normalizedSiteId] = { ...(fieldDefaults as Record<string, unknown>) }
    })

    return Object.keys(nextFieldDefaults).length > 0 ? nextFieldDefaults : undefined
  }

  function cloneSiteFieldDefaults(fieldDefaults?: SeriesPublishProfileSiteFieldDefaults) {
    return normalizeSiteFieldDefaults(fieldDefaults)
  }

  function mergeSiteFieldDefaults(
    baseFieldDefaults?: SeriesPublishProfileSiteFieldDefaults,
    overrideFieldDefaults?: SeriesPublishProfileSiteFieldDefaults,
  ) {
    const normalizedBase = normalizeSiteFieldDefaults(baseFieldDefaults)
    const normalizedOverride = normalizeSiteFieldDefaults(overrideFieldDefaults)

    if (!normalizedBase && !normalizedOverride) {
      return undefined
    }

    const mergedDefaults: Partial<Record<SiteId, Record<string, unknown>>> = {}
    const siteIds = new Set<SiteId>([
      ...Object.keys(normalizedBase ?? {}),
      ...Object.keys(normalizedOverride ?? {}),
    ] as SiteId[])

    siteIds.forEach(siteId => {
      const nextEntry = {
        ...(normalizedBase?.[siteId] ?? {}),
        ...(normalizedOverride?.[siteId] ?? {}),
      }

      if (Object.keys(nextEntry).length > 0) {
        mergedDefaults[siteId] = nextEntry
      }
    })

    return Object.keys(mergedDefaults).length > 0 ? mergedDefaults : undefined
  }

  function buildProjectSiteFieldDefaults(config: Config.PublishConfig) {
    const nextFieldDefaults = normalizeSiteFieldDefaults(config.siteFieldDefaults) ?? {}
    const bangumiCategory = normalizeOptionalString(config.category_bangumi)
    const nyaaCategory = normalizeOptionalString(config.category_nyaa)

    if (bangumiCategory) {
      nextFieldDefaults.bangumi = {
        ...(nextFieldDefaults.bangumi ?? {}),
        category_bangumi: bangumiCategory,
      }
    }

    if (nyaaCategory) {
      nextFieldDefaults.nyaa = {
        ...(nextFieldDefaults.nyaa ?? {}),
        category_nyaa: nyaaCategory,
      }
    }

    return Object.keys(nextFieldDefaults).length > 0 ? nextFieldDefaults : undefined
  }

  function readProjectSiteFieldDefaults(projectPath: string) {
    const draftConfigPath = getDraftConfigPath(projectPath)
    if (!fs.existsSync(draftConfigPath)) {
      return undefined
    }

    try {
      const config = JSON.parse(fs.readFileSync(draftConfigPath, { encoding: 'utf-8' })) as Config.PublishConfig
      return buildProjectSiteFieldDefaults(config)
    } catch {
      return undefined
    }
  }

  function hydrateSeriesWorkspace(projectPath: string, workspace: SeriesProjectWorkspace): SeriesProjectWorkspace {
    const hydratedWorkspace = {
      ...workspace,
      projectSiteFieldDefaults: readProjectSiteFieldDefaults(projectPath),
    }

    return withActiveVariantPublishResults(hydratedWorkspace, getDraftPublishResults(workspace.projectId))
  }

  function withActiveVariantPublishResults(workspace: SeriesProjectWorkspace, results?: PublishResult[]) {
    if (!workspace.activeEpisodeId || !workspace.activeVariantId) {
      return workspace
    }

    const episode = workspace.episodes.find(item => item.id === workspace.activeEpisodeId)
    const variant = episode?.variants.find(item => item.id === workspace.activeVariantId)
    if (!episode || !variant) {
      return workspace
    }

    const nextVariant: SeriesProjectVariant = {
      ...variant,
      publishResults: clonePublishResults(results),
    }
    const nextEpisode = replaceVariant(episode, nextVariant, episode.updatedAt)

    return replaceEpisode(workspace, nextEpisode)
  }

  function normalizeSiteDraftEntry(
    value: unknown,
    fallback?: {
      enabled?: boolean
      summaryTemplate?: string
    },
  ): SeriesPublishProfileSiteDraft | undefined {
    const rawDraft =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Partial<SeriesPublishProfileSiteDraft>)
        : undefined
    const enabled = typeof rawDraft?.enabled === 'boolean' ? rawDraft.enabled : Boolean(fallback?.enabled)
    const useGlobalTitle = typeof rawDraft?.useGlobalTitle === 'boolean' ? rawDraft.useGlobalTitle : true
    const titleTemplate = normalizeTitleTemplate(rawDraft?.titleTemplate)
    const summaryTemplate = normalizeSummaryTemplate(rawDraft?.summaryTemplate ?? fallback?.summaryTemplate)
    const note = normalizeOptionalString(rawDraft?.note)

    if (!enabled && useGlobalTitle && !titleTemplate && !summaryTemplate && !note) {
      return undefined
    }

    return {
      enabled,
      useGlobalTitle,
      titleTemplate,
      summaryTemplate,
      note,
    }
  }

  function normalizeSiteDrafts(
    value: unknown,
    fallback?: {
      targetSites?: SiteId[]
      summaryTemplate?: string
    },
  ): SeriesPublishProfileSiteDrafts | undefined {
    const normalizedTargetSites = normalizeSiteIds(fallback?.targetSites)
    const nextSiteDrafts: SeriesPublishProfileSiteDrafts = {}

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([siteId, siteDraft]) => {
        const normalizedSiteId = normalizeSiteIds([siteId])[0]
        if (!normalizedSiteId) {
          return
        }

        const normalizedSiteDraft = normalizeSiteDraftEntry(siteDraft, {
          enabled: normalizedTargetSites.includes(normalizedSiteId),
          summaryTemplate: fallback?.summaryTemplate,
        })
        if (normalizedSiteDraft) {
          nextSiteDrafts[normalizedSiteId] = normalizedSiteDraft
        }
      })
    }

    normalizedTargetSites.forEach(siteId => {
      if (nextSiteDrafts[siteId]) {
        nextSiteDrafts[siteId] = {
          ...nextSiteDrafts[siteId],
          enabled: true,
        }
        return
      }

      const normalizedSiteDraft = normalizeSiteDraftEntry(undefined, {
        enabled: true,
        summaryTemplate: fallback?.summaryTemplate,
      })
      if (normalizedSiteDraft) {
        nextSiteDrafts[siteId] = normalizedSiteDraft
      }
    })

    return Object.keys(nextSiteDrafts).length > 0 ? nextSiteDrafts : undefined
  }

  function cloneSiteDrafts(siteDrafts?: SeriesPublishProfileSiteDrafts) {
    return normalizeSiteDrafts(siteDrafts)
  }

  function getEnabledSiteIdsFromSiteDrafts(siteDrafts?: SeriesPublishProfileSiteDrafts) {
    if (!siteDrafts) {
      return []
    }

    return Object.entries(siteDrafts)
      .filter(([_siteId, siteDraft]) => Boolean(siteDraft?.enabled))
      .map(([siteId]) => siteId)
      .filter((siteId): siteId is SiteId => Boolean(siteId))
  }

  function resolvePrimarySiteDraftSummaryTemplate(
    siteDrafts?: SeriesPublishProfileSiteDrafts,
    targetSites: SiteId[] = [],
    fallbackSummaryTemplate?: string,
  ) {
    const orderedSiteIds = targetSites.length
      ? targetSites
      : siteDrafts
        ? (Object.keys(siteDrafts) as SiteId[])
        : []
    for (const siteId of orderedSiteIds) {
      const summaryTemplate = normalizeSummaryTemplate(siteDrafts?.[siteId]?.summaryTemplate)
      if (summaryTemplate) {
        return summaryTemplate
      }
    }

    return normalizeSummaryTemplate(fallbackSummaryTemplate)
  }

  function buildPublishProfileSnapshotName(input: {
    name?: string
    profile?: SeriesPublishProfile | null
    variantName?: string
    videoProfiles?: SeriesVariantVideoProfile[]
    subtitleProfiles?: SeriesVariantSubtitleProfile[]
  }) {
    const explicitName = normalizeOptionalString(input.name)
    if (explicitName) {
      return explicitName
    }

    const profileName = normalizeOptionalString(input.profile?.name)
    if (profileName) {
      return profileName
    }

    const variantName = normalizeOptionalString(input.variantName)
    if (variantName) {
      return variantName
    }

    const profileLabel = [
      normalizeVariantVideoProfiles(input.videoProfiles ?? []).join('+'),
      normalizeVariantSubtitleProfiles(input.subtitleProfiles ?? []).join('+'),
    ]
      .filter(Boolean)
      .join(' / ')

    return profileLabel || 'manual-publish-profile'
  }

  function buildPublishProfileSnapshot(input: {
    name?: string
    profile?: SeriesPublishProfile | null
    variantName?: string
    videoProfiles?: SeriesVariantVideoProfile[]
    subtitleProfiles?: SeriesVariantSubtitleProfile[]
    templateContext?: SeriesPublishProfileTemplateContext
    targetSites?: SiteId[]
    titleTemplate?: string
    summaryTemplate?: string
    siteDrafts?: SeriesPublishProfileSiteDrafts
    siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
  }): SeriesPublishProfileSnapshot {
    const videoProfiles = normalizeVariantVideoProfiles(
      input.videoProfiles?.length
        ? input.videoProfiles
        : input.profile
          ? (input.profile.videoProfiles as SeriesVariantVideoProfile[])
          : [],
    )
    const subtitleProfiles = normalizeVariantSubtitleProfiles(
      input.subtitleProfiles?.length
        ? input.subtitleProfiles
        : input.profile
          ? (input.profile.subtitleProfiles as SeriesVariantSubtitleProfile[])
          : [],
    )
    const targetSites = normalizeSiteIds(input.targetSites ?? input.profile?.targetSites)
    const templateContext = clonePublishProfileTemplateContext(input.templateContext ?? input.profile?.templateContext)
    const titleTemplate = normalizeTitleTemplate(input.titleTemplate ?? input.profile?.titleTemplate)
    const siteDrafts = Object.prototype.hasOwnProperty.call(input, 'siteDrafts')
      ? cloneSiteDrafts(input.siteDrafts)
      : cloneSiteDrafts(
          normalizeSiteDrafts(input.profile?.siteDrafts, {
            targetSites,
            summaryTemplate: input.profile?.summaryTemplate,
          }),
        )
    const summaryTemplate = resolvePrimarySiteDraftSummaryTemplate(
      siteDrafts,
      targetSites,
      input.summaryTemplate ?? input.profile?.summaryTemplate,
    )
    const siteFieldDefaults = cloneSiteFieldDefaults(input.siteFieldDefaults ?? input.profile?.siteFieldDefaults)

    return {
      name: buildPublishProfileSnapshotName({
        name: input.name,
        profile: input.profile,
        variantName: input.variantName,
        videoProfiles,
        subtitleProfiles,
      }),
      videoProfiles,
      subtitleProfiles,
      templateContext,
      targetSites: targetSites.length ? targetSites : undefined,
      titleTemplate,
      summaryTemplate,
      siteDrafts,
      siteFieldDefaults,
    }
  }

  function normalizePublishProfileSnapshot(
    value: unknown,
    fallback?: {
      profile?: SeriesPublishProfile | null
      variant?: Pick<
        SeriesProjectVariant,
        'name' | 'videoProfile' | 'subtitleProfile' | 'publishProfileName' | 'targetSites'
      >
    },
  ) {
    const rawSnapshot =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Partial<SeriesPublishProfileSnapshot>)
        : undefined
    if (!rawSnapshot && !fallback?.profile && !fallback?.variant) {
      return undefined
    }

    const rawVideoProfiles = Array.isArray(rawSnapshot?.videoProfiles)
      ? rawSnapshot.videoProfiles.filter((profile): profile is SeriesVariantVideoProfile => isSeriesVariantVideoProfile(profile))
      : []
    const rawSubtitleProfiles = Array.isArray(rawSnapshot?.subtitleProfiles)
      ? rawSnapshot.subtitleProfiles.filter(
          (profile): profile is SeriesVariantSubtitleProfile => isSeriesVariantSubtitleProfile(profile),
        )
      : []
    const hasRawTargetSites = Array.isArray(rawSnapshot?.targetSites)
    const fallbackTargetSites = hasRawTargetSites
      ? normalizeSiteIds(rawSnapshot?.targetSites)
      : fallback?.variant?.targetSites?.length
        ? fallback.variant.targetSites
        : normalizeSiteIds(fallback?.profile?.targetSites)
    const variantName =
      normalizeOptionalString(fallback?.variant?.publishProfileName) ??
      normalizeOptionalString(fallback?.variant?.name)
    const normalizedSiteDrafts = normalizeSiteDrafts(rawSnapshot?.siteDrafts, {
      targetSites: fallbackTargetSites,
      summaryTemplate:
        rawSnapshot && 'summaryTemplate' in rawSnapshot
          ? normalizeSummaryTemplate(rawSnapshot.summaryTemplate)
          : fallback?.profile?.summaryTemplate,
    })
    const snapshot = buildPublishProfileSnapshot({
      name: normalizeOptionalString(rawSnapshot?.name),
      profile: fallback?.profile,
      variantName,
      videoProfiles: rawVideoProfiles.length
        ? rawVideoProfiles
        : fallback?.variant?.videoProfile
          ? [fallback.variant.videoProfile]
          : fallback?.profile
            ? (fallback.profile.videoProfiles as SeriesVariantVideoProfile[])
            : undefined,
      subtitleProfiles: rawSubtitleProfiles.length
        ? rawSubtitleProfiles
        : fallback?.variant?.subtitleProfile
          ? [fallback.variant.subtitleProfile]
          : fallback?.profile
            ? (fallback.profile.subtitleProfiles as SeriesVariantSubtitleProfile[])
            : undefined,
      templateContext:
        rawSnapshot && 'templateContext' in rawSnapshot
          ? normalizePublishProfileTemplateContext(rawSnapshot.templateContext)
          : undefined,
      targetSites: [...new Set([...fallbackTargetSites, ...getEnabledSiteIdsFromSiteDrafts(normalizedSiteDrafts)])],
      titleTemplate:
        rawSnapshot && 'titleTemplate' in rawSnapshot ? normalizeTitleTemplate(rawSnapshot.titleTemplate) : undefined,
      summaryTemplate:
        rawSnapshot && 'summaryTemplate' in rawSnapshot
          ? normalizeSummaryTemplate(rawSnapshot.summaryTemplate)
          : undefined,
      siteDrafts: normalizedSiteDrafts,
      siteFieldDefaults: normalizeSiteFieldDefaults(rawSnapshot?.siteFieldDefaults),
    })

    if (rawSnapshot && 'titleTemplate' in rawSnapshot && !normalizeTitleTemplate(rawSnapshot.titleTemplate)) {
      snapshot.titleTemplate = undefined
    }
    if (rawSnapshot && 'summaryTemplate' in rawSnapshot && !normalizeSummaryTemplate(rawSnapshot.summaryTemplate)) {
      snapshot.summaryTemplate = undefined
    }

    return snapshot
  }

  function clonePublishProfileSnapshot(snapshot?: SeriesPublishProfileSnapshot) {
    return normalizePublishProfileSnapshot(snapshot)
  }

  function normalizePublishProfiles(profiles: SeriesPublishProfile[]) {
    if (!profiles.length) {
      return []
    }

    const hasDefaultProfile = profiles.some(profile => profile.isDefault)
    return profiles.map((profile, index) => ({
      ...profile,
      isDefault: hasDefaultProfile ? Boolean(profile.isDefault) : index === 0,
    }))
  }

  function resolveDefaultPublishProfileId(profiles: SeriesPublishProfile[], preferredId?: number) {
    if (!profiles.length) {
      return undefined
    }

    if (preferredId && profiles.some(profile => profile.id === preferredId)) {
      return preferredId
    }

    const defaultProfile = profiles.find(profile => profile.isDefault)
    return defaultProfile?.id ?? profiles[0]?.id
  }

  function getVariantTargetSitesFromConfig(config: Config.PublishConfig) {
    const content = config.content as Partial<Config.Content_episode>
    return normalizeSiteIds(config.targetSites ?? content.targetSites)
  }

  function buildVariantSummaryFromConfig(config: Config.PublishConfig) {
    return {
      title: normalizeOptionalString(config.title),
      targetSites: getVariantTargetSitesFromConfig(config),
    }
  }

  function readVariantConfigSummary(projectPath: string, episode: SeriesProjectEpisode, variant: SeriesProjectVariant) {
    const variantConfigPath = getVariantConfigPath(projectPath, episode, variant)
    if (!fs.existsSync(variantConfigPath)) {
      return {
        title: normalizeOptionalString(variant.title),
        targetSites: normalizeSiteIds(variant.targetSites),
      }
    }

    try {
      const config = JSON.parse(fs.readFileSync(variantConfigPath, { encoding: 'utf-8' })) as Config.PublishConfig
      return buildVariantSummaryFromConfig(config)
    } catch {
      return {
        title: normalizeOptionalString(variant.title),
        targetSites: normalizeSiteIds(variant.targetSites),
      }
    }
  }

  function applyVariantSummary(
    variant: SeriesProjectVariant,
    summary: {
      title?: string
      targetSites?: SiteId[]
    },
  ) {
    return {
      ...variant,
      title: summary.title ?? normalizeOptionalString(variant.title),
      targetSites: summary.targetSites?.length ? [...summary.targetSites] : normalizeSiteIds(variant.targetSites),
    }
  }

  function getVariantTemplateIdentity(
    videoProfiles: SeriesVariantTemplateVideoProfile[],
    subtitleProfiles: SeriesVariantTemplateSubtitleProfile[],
    targetSites: SiteId[] = [],
    templateContext?: string,
    titleTemplate?: string,
    summaryTemplate?: string,
    siteDrafts?: string,
    siteFieldDefaults?: string,
  ) {
    return [
      normalizeTemplateVideoProfiles(videoProfiles).join(','),
      normalizeTemplateSubtitleProfiles(subtitleProfiles).join(','),
      [...targetSites].sort().join(','),
      templateContext ?? '',
      titleTemplate?.trim() ?? '',
      summaryTemplate?.trim() ?? '',
      siteDrafts ?? '',
      siteFieldDefaults ?? '',
    ].join('|')
  }

  function buildSeriesLabelFromValues(values: {
    seriesTitleCN?: string
    seriesTitleEN?: string
    seriesTitleJP?: string
    seasonLabel?: string
  }) {
    const titles = [values.seriesTitleCN, values.seriesTitleEN, values.seriesTitleJP]
      .map(value => value?.trim() ?? '')
      .filter(Boolean)
    const dedupedTitles = [...new Set(titles)]
    const seasonLabel = values.seasonLabel?.trim()

    return seasonLabel ? [...dedupedTitles, seasonLabel].join(' / ') : dedupedTitles.join(' / ')
  }

  function buildSeriesLabelFromContent(content: Partial<Config.Content_episode>) {
    return buildSeriesLabelFromValues(content)
  }

  function buildTechLabelFromValues(values: {
    sourceType?: string
    resolution?: string
    videoCodec?: string
    audioCodec?: string
  }) {
    return [values.sourceType, values.resolution, values.videoCodec, values.audioCodec]
      .map(value => value?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
  }

  function buildTechLabelFromContent(content: Partial<Config.Content_episode>, resolutionOverride?: string) {
    return buildTechLabelFromValues({
      sourceType: content.sourceType,
      resolution: resolutionOverride ?? content.resolution,
      videoCodec: content.videoCodec,
      audioCodec: content.audioCodec,
    })
  }

  function getSubtitleTemplateLabel(profile?: SeriesVariantSubtitleProfile) {
    if (!profile) {
      return ''
    }

    const subtitleLabelMap: Record<SeriesVariantSubtitleProfile, string> = {
      chs: 'CHS',
      cht: 'CHT',
      eng: 'ENG',
      bilingual: 'bilingual',
      custom: 'custom',
    }

    return subtitleLabelMap[profile]
  }

  function applyTemplateContextToVariables(
    variables: Record<string, string>,
    templateContext?: SeriesPublishProfileTemplateContext,
  ) {
    if (!templateContext) {
      return variables
    }

    const nextVariables = { ...variables }
    PUBLISH_PROFILE_TEMPLATE_CONTEXT_KEYS.forEach(key => {
      if (key === 'seriesLabel' || key === 'techLabel') {
        return
      }

      const overrideValue = normalizeOptionalString(templateContext[key])
      if (overrideValue) {
        nextVariables[key] = overrideValue
      }
    })

    const seriesLabelOverride = normalizeOptionalString(templateContext.seriesLabel)
    const techLabelOverride = normalizeOptionalString(templateContext.techLabel)
    const derivedSeriesLabel = buildSeriesLabelFromValues({
      seriesTitleCN: nextVariables.seriesTitleCN,
      seriesTitleEN: nextVariables.seriesTitleEN,
      seriesTitleJP: nextVariables.seriesTitleJP,
      seasonLabel: nextVariables.seasonLabel,
    })
    const derivedTechLabel = buildTechLabelFromValues({
      sourceType: nextVariables.sourceType,
      resolution: nextVariables.resolution,
      videoCodec: nextVariables.videoCodec,
      audioCodec: nextVariables.audioCodec,
    })

    nextVariables.seriesLabel = seriesLabelOverride ?? derivedSeriesLabel ?? nextVariables.seriesLabel
    nextVariables.techLabel = techLabelOverride ?? derivedTechLabel ?? nextVariables.techLabel

    return nextVariables
  }

  function buildSeriesVariantTemplateVariables(
    config: Config.PublishConfig,
    variant: SeriesProjectVariant,
    templateContext?: SeriesPublishProfileTemplateContext,
  ) {
    const content = config.content as Partial<Config.Content_episode>
    const resolution =
      content.resolution?.trim() ??
      (variant.videoProfile && variant.videoProfile !== 'custom' ? variant.videoProfile : '')
    return applyTemplateContextToVariables(
      {
      title: config.title?.trim() ?? '',
      summary: content.summary?.trim() ?? '',
      releaseTeam: content.releaseTeam?.trim() ?? '',
      seriesTitleCN: content.seriesTitleCN?.trim() ?? '',
      seriesTitleEN: content.seriesTitleEN?.trim() ?? '',
      seriesTitleJP: content.seriesTitleJP?.trim() ?? '',
      seasonLabel: content.seasonLabel?.trim() ?? '',
      episodeLabel: content.episodeLabel?.trim() ?? '',
      episodeTitle: content.episodeTitle?.trim() ?? '',
      sourceType: content.sourceType?.trim() ?? '',
      resolution,
      videoCodec: content.videoCodec?.trim() ?? '',
      audioCodec: content.audioCodec?.trim() ?? '',
      seriesLabel: buildSeriesLabelFromContent(content),
      techLabel: buildTechLabelFromContent(content, resolution),
      variantName: variant.name,
      videoProfile: variant.videoProfile ?? '',
      subtitleProfile: variant.subtitleProfile ?? '',
      subtitleProfileLabel: getSubtitleTemplateLabel(variant.subtitleProfile),
      },
      templateContext,
    )
  }

  function renderSeriesVariantTemplate(
    template: string,
    variables: Record<string, string>,
    options?: {
      collapseWhitespace?: boolean
    },
  ) {
    const rendered = template
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token: string) => variables[token] ?? '')
      .replace(/\{(\w+)\}/g, (_match, token: string) => variables[token] ?? '')
      .trim()

    if (!options?.collapseWhitespace) {
      return rendered
    }

    return rendered.replace(/\s+/g, ' ').trim()
  }

  function buildVariantConfigFromDraft(
    projectPath: string,
    variant: SeriesProjectVariant,
    options?: {
      targetSites?: SiteId[]
      templateContext?: SeriesPublishProfileTemplateContext
      titleTemplate?: string
      summaryTemplate?: string
      siteDrafts?: SeriesPublishProfileSiteDrafts
      siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
    },
  ) {
    const config = JSON.parse(fs.readFileSync(getDraftConfigPath(projectPath), { encoding: 'utf-8' })) as Config.PublishConfig
    const targetSites = normalizeSiteIds(options?.targetSites)
    const templateContext = clonePublishProfileTemplateContext(options?.templateContext)
    const titleTemplate = normalizeTitleTemplate(options?.titleTemplate)
    const siteDrafts = normalizeSiteDrafts(options?.siteDrafts, {
      targetSites,
      summaryTemplate: options?.summaryTemplate,
    })
    const summaryTemplate = resolvePrimarySiteDraftSummaryTemplate(siteDrafts, targetSites, options?.summaryTemplate)
    const siteFieldDefaults = mergeSiteFieldDefaults(buildProjectSiteFieldDefaults(config), options?.siteFieldDefaults)

    if (templateContext && typeof config.content === 'object' && config.content && !Array.isArray(config.content)) {
      const content = config.content as unknown as Record<string, string | SiteId[] | undefined>
      PUBLISH_PROFILE_TEMPLATE_CONTENT_KEYS.forEach(key => {
        const value = templateContext[key]
        if (value) {
          content[key] = value
        }
      })
    }

    if (targetSites.length > 0) {
      config.targetSites = [...targetSites]
      if ('targetSites' in config.content) {
        config.content.targetSites = [...targetSites]
      }
    }

    if (titleTemplate) {
      const renderedTitle = renderSeriesVariantTemplate(
        titleTemplate,
        buildSeriesVariantTemplateVariables(config, variant, templateContext),
        { collapseWhitespace: true },
      )
      if (renderedTitle) {
        config.title = renderedTitle
      }
    }

    if (summaryTemplate && 'summary' in config.content) {
      const renderedSummary = renderSeriesVariantTemplate(
        summaryTemplate,
        buildSeriesVariantTemplateVariables(config, variant, templateContext),
      )
      if (renderedSummary) {
        config.content.summary = renderedSummary
      }
    }

    if (siteFieldDefaults) {
      config.siteFieldDefaults = cloneSiteFieldDefaults(siteFieldDefaults)
    } else {
      delete config.siteFieldDefaults
    }

    const bangumiCategory = normalizeOptionalString(siteFieldDefaults?.bangumi?.category_bangumi)
    if (bangumiCategory) {
      config.category_bangumi = bangumiCategory
    }

    const nyaaCategory = normalizeOptionalString(siteFieldDefaults?.nyaa?.category_nyaa)
    if (nyaaCategory) {
      config.category_nyaa = nyaaCategory
    }

    return config
  }

  function writeVariantConfigFromDraft(
    projectPath: string,
    episode: SeriesProjectEpisode,
    variant: SeriesProjectVariant,
    options?: {
      targetSites?: SiteId[]
      templateContext?: SeriesPublishProfileTemplateContext
      titleTemplate?: string
      summaryTemplate?: string
      siteDrafts?: SeriesPublishProfileSiteDrafts
      siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
    },
  ) {
    const variantConfigPath = getVariantConfigPath(projectPath, episode, variant)
    fs.mkdirSync(join(variantConfigPath, '..'), { recursive: true })
    const config = buildVariantConfigFromDraft(projectPath, variant, options)
    fs.writeFileSync(variantConfigPath, JSON.stringify(config))
    return config
  }

  function getVariantPresetName(
    videoProfile?: SeriesVariantVideoProfile,
    subtitleProfile?: SeriesVariantSubtitleProfile,
  ) {
    if (!videoProfile || !subtitleProfile || videoProfile === 'custom' || subtitleProfile === 'custom') {
      return ''
    }

    const subtitleLabelMap: Record<Exclude<SeriesVariantSubtitleProfile, 'custom'>, string> = {
      chs: 'CHS',
      cht: 'CHT',
      eng: 'ENG',
      bilingual: 'bilingual',
    }

    return `${videoProfile}-${subtitleLabelMap[subtitleProfile]}`
  }

  function normalizeVariantName(value: string) {
    return value.trim().toLowerCase()
  }

  function getVariantIdentity({
    name,
    videoProfile,
    subtitleProfile,
  }: {
    name: string
    videoProfile?: SeriesVariantVideoProfile
    subtitleProfile?: SeriesVariantSubtitleProfile
  }) {
    if (videoProfile && subtitleProfile && videoProfile !== 'custom' && subtitleProfile !== 'custom') {
      return `${videoProfile}:${subtitleProfile}`
    }

    return normalizeVariantName(name)
  }

  function resolveVariantName({
    name,
    videoProfile,
    subtitleProfile,
  }: {
    name?: string
    videoProfile?: SeriesVariantVideoProfile
    subtitleProfile?: SeriesVariantSubtitleProfile
  }) {
    const trimmedName = name?.trim() ?? ''
    if (trimmedName) {
      return trimmedName
    }

    return getVariantPresetName(videoProfile, subtitleProfile)
  }

  function resolveCopiedVariantName(name: string, existingVariants: SeriesProjectVariant[]) {
    const trimmedName = name.trim() || 'variant'
    const baseName = `${trimmedName} 副本`
    const existingNames = new Set(existingVariants.map(variant => normalizeVariantName(variant.name)))

    if (!existingNames.has(normalizeVariantName(baseName))) {
      return baseName
    }

    let suffix = 2
    while (existingNames.has(normalizeVariantName(`${baseName} ${suffix}`))) {
      suffix += 1
    }

    return `${baseName} ${suffix}`
  }

  function hasVariantConflict(
    episode: SeriesProjectEpisode,
    name: string,
    videoProfile?: SeriesVariantVideoProfile,
    subtitleProfile?: SeriesVariantSubtitleProfile,
  ) {
    const nextVariantIdentity = getVariantIdentity({ name, videoProfile, subtitleProfile })
    return episode.variants.some(variant => {
      const hasSameName = normalizeVariantName(variant.name) === normalizeVariantName(name)
      const hasSameIdentity =
        getVariantIdentity({
          name: variant.name,
          videoProfile: variant.videoProfile,
          subtitleProfile: variant.subtitleProfile,
        }) === nextVariantIdentity
      return hasSameName || hasSameIdentity
    })
  }

  function buildSeriesVariant(
    episode: SeriesProjectEpisode,
    input: {
      id: number
      name: string
      videoProfile?: SeriesVariantVideoProfile
      subtitleProfile?: SeriesVariantSubtitleProfile
      publishProfileId?: number
      publishProfileName?: string
      publishProfileSnapshot?: SeriesPublishProfileSnapshot
      targetSites?: SiteId[]
      title?: string
      createdAt: string
      existingDirectoryNames?: string[]
    },
  ): SeriesProjectVariant {
    const existingDirectoryNames = input.existingDirectoryNames ?? episode.variants.map(item => item.directoryName)
    const directoryName = resolveVariantDirectoryName(input.name, existingDirectoryNames)
    if (input.existingDirectoryNames) {
      input.existingDirectoryNames.push(directoryName)
    }

    return {
      id: input.id,
      name: input.name,
      directoryName,
      videoProfile: input.videoProfile,
      subtitleProfile: input.subtitleProfile,
      publishProfileId: input.publishProfileId,
      publishProfileName: normalizeOptionalString(input.publishProfileName),
      publishProfileSnapshot: clonePublishProfileSnapshot(input.publishProfileSnapshot),
      targetSites: normalizeSiteIds(input.targetSites),
      title: normalizeOptionalString(input.title),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }
  }

  function copyVariantConfig(sourcePath: string, targetPath: string) {
    fs.mkdirSync(join(targetPath, '..'), { recursive: true })
    fs.copyFileSync(sourcePath, targetPath)
  }

  function sanitizeDirectoryFragment(value: string) {
    return value
      .trim()
      .replace(/[\s\\/:"*?<>|]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)
  }

  function resolveEpisodeDirectoryName(episodeLabel: string, existingNames: string[]) {
    const normalizedLabel = sanitizeDirectoryFragment(episodeLabel).toUpperCase()
    const baseName = normalizedLabel ? `E${normalizedLabel}` : `E${Date.now()}`

    if (!existingNames.includes(baseName)) {
      return baseName
    }

    let suffix = 2
    while (existingNames.includes(`${baseName}-${suffix}`)) {
      suffix += 1
    }

    return `${baseName}-${suffix}`
  }

  function resolveVariantDirectoryName(name: string, existingNames: string[]) {
    const normalizedName = sanitizeDirectoryFragment(name).toLowerCase()
    const baseName = normalizedName || `variant-${Date.now()}`

    if (!existingNames.includes(baseName)) {
      return baseName
    }

    let suffix = 2
    while (existingNames.includes(`${baseName}-${suffix}`)) {
      suffix += 1
    }

    return `${baseName}-${suffix}`
  }

  function replaceEpisode(workspace: SeriesProjectWorkspace, nextEpisode: SeriesProjectEpisode): SeriesProjectWorkspace {
    return {
      ...workspace,
      episodes: workspace.episodes
        .map(episode => (episode.id === nextEpisode.id ? nextEpisode : episode))
        .sort((left, right) => left.sortIndex - right.sortIndex),
    }
  }

  function replaceVariant(
    episode: SeriesProjectEpisode,
    nextVariant: SeriesProjectVariant,
    updatedAt: string,
  ): SeriesProjectEpisode {
    return {
      ...episode,
      variants: episode.variants.map(variant => (variant.id === nextVariant.id ? nextVariant : variant)),
      variantCount: episode.variants.length,
      updatedAt,
    }
  }

  function syncActiveVariantDraft(projectPath: string, workspace: SeriesProjectWorkspace, updatedAt: string) {
    if (!workspace.activeEpisodeId || !workspace.activeVariantId) {
      return workspace
    }

    const episode = workspace.episodes.find(item => item.id === workspace.activeEpisodeId)
    const variant = episode?.variants.find(item => item.id === workspace.activeVariantId)
    if (!episode || !variant) {
      return workspace
    }

    const variantDirectoryPath = getVariantDirectoryPath(projectPath, episode, variant)
    fs.mkdirSync(variantDirectoryPath, { recursive: true })
    fs.copyFileSync(getDraftConfigPath(projectPath), getVariantConfigPath(projectPath, episode, variant))

    const nextVariant = applyVariantSummary(
      {
        ...variant,
        publishResults: getDraftPublishResults(workspace.projectId),
        updatedAt,
      },
      readVariantConfigSummary(projectPath, episode, variant),
    )
    const nextEpisode = replaceVariant(episode, nextVariant, updatedAt)
    writeEpisodeRecord(projectPath, nextEpisode)

    return {
      ...replaceEpisode(workspace, nextEpisode),
      updatedAt,
    }
  }

  function readDraftConfigSummary(projectPath: string) {
    try {
      const config = JSON.parse(fs.readFileSync(getDraftConfigPath(projectPath), { encoding: 'utf-8' })) as Config.PublishConfig
      return buildVariantSummaryFromConfig(config)
    } catch {
      return {
        title: undefined,
        targetSites: [],
      }
    }
  }

  function findPreviousEpisode(workspace: SeriesProjectWorkspace, episodeId: number) {
    const sortedEpisodes = [...workspace.episodes].sort((left, right) => left.sortIndex - right.sortIndex)
    const episodeIndex = sortedEpisodes.findIndex(episode => episode.id === episodeId)
    if (episodeIndex <= 0) {
      return null
    }

    return sortedEpisodes[episodeIndex - 1] ?? null
  }

  function findPublishProfile(workspace: SeriesProjectWorkspace, profileId?: number) {
    if (typeof profileId !== 'number') {
      return null
    }

    return workspace.publishProfiles.find(profile => profile.id === profileId) ?? null
  }

  function buildInitialContent(projectMode: ProjectMode, sourceKind?: ProjectSourceKind) {
    if (projectMode === 'episode') {
      return {
        seriesTitleCN: '',
        seriesTitleEN: '',
        seriesTitleJP: '',
        seasonLabel: '',
        episodeLabel: '',
        episodeTitle: '',
        releaseTeam: 'VCB-Studio',
        sourceType: 'WebRip',
        resolution: '1080p',
        videoCodec: 'HEVC',
        audioCodec: 'AAC',
        summary: '',
        targetSites: [...defaultEpisodeSites],
      }
    }

    return sourceKind === 'template'
      ? {
          title_CN: '',
          title_EN: '',
          title_JP: '',
          depth: '10-bit',
          resolution: '1080p',
          encoding: 'HEVC',
          contentType: 'BDRip',
          reseed: false,
          nomination: false,
          note: [],
          comment_CN: '',
          comment_EN: '',
          rsVersion: 1,
          members: {
            script: '',
            encode: '',
            collate: '',
            upload: '',
          },
          posterUrl: '',
          prefill: false,
        }
      : {
          path_md: '',
          path_html: '',
          path_bbcode: '',
        }
  }

  function buildInitialPublishConfig(input: CreateProjectInput): Config.PublishConfig {
    const { projectMode, sourceKind } = input
    const bangumiCategory = projectMode === 'episode' ? '549ef207fe682f7549f1ea90' : ''
    const nyaaCategory = projectMode === 'episode' ? '1_3' : ''
    return {
      title: '',
      category_bangumi: bangumiCategory,
      category_nyaa: nyaaCategory,
      siteFieldDefaults:
        projectMode === 'episode'
          ? {
              bangumi: {
                category_bangumi: bangumiCategory,
              },
              nyaa: {
                category_nyaa: nyaaCategory,
              },
            }
          : undefined,
      information: 'https://vcb-s.com/archives/138',
      tags: [],
      torrentName: '',
      torrentPath: '',
      sourceKind,
      targetSites: projectMode === 'episode' ? [...defaultEpisodeSites] : [],
      content: buildInitialContent(projectMode, sourceKind),
    }
  }

  async function createProjectRecord(input: CreateProjectInput) {
    let { workingDirectory, name, projectMode, sourceKind } = input

    if (projectMode === 'feature' && !sourceKind) {
      return fail('PROJECT_SOURCE_KIND_REQUIRED', 'Feature projects must include a source kind')
    }

    if (workingDirectory === '') {
      workingDirectory = join(app.getPath('userData'), 'task')
      if (!fs.existsSync(workingDirectory)) {
        fs.mkdirSync(workingDirectory)
      }
    }

    if (!fs.existsSync(workingDirectory)) {
      return fail('PROJECT_DIRECTORY_NOT_FOUND', 'Project working directory does not exist')
    }

    if (name === '') {
      name = getNowFormatDate().replace(/:/g, '-')
    }

    const projectPath = join(workingDirectory, name)
    fs.mkdirSync(projectPath)
    fs.writeFileSync(join(projectPath, 'config.json'), JSON.stringify(buildInitialPublishConfig(input)))

    const id = Date.now()
    if (projectMode === 'episode') {
      writeSeriesWorkspace(projectPath, createDefaultSeriesWorkspace(id))
    }
    const legacyType: LegacyProjectType = projectMode === 'episode' ? 'episode' : sourceKind!
    projectStore.insertLegacyTask({
      id,
      mode: projectMode,
      type: legacyType,
      name,
      path: projectPath,
      status: 'publishing',
      step: 'edit',
      sync: false,
    })
    await projectStore.write()
    notifyProjectDataChanged()

    const project = projectStore.getProjectById(id)
    if (!project) {
      return fail('PROJECT_CREATE_FAILED', 'Project record was not persisted')
    }

    return ok({ project })
  }

  async function createProject(msg: string) {
    try {
      const input: CreateProjectInput = JSON.parse(msg)
      return JSON.stringify(await createProjectRecord(input))
    } catch (err) {
      dialog.showErrorBox('闁挎瑨顕?', (err as Error).message)
      return JSON.stringify(fail('PROJECT_CREATE_FAILED', 'Unable to create project', (err as Error).message))
    }
  }

  async function createTask(msg: string) {
    try {
      const { type, path, name }: Message.Task.TaskConfig = JSON.parse(msg)
      const result = await createProjectRecord({
        name,
        workingDirectory: path,
        projectMode: type === 'episode' ? 'episode' : 'feature',
        sourceKind: type === 'episode' ? undefined : type,
      })
      if (!result.ok) {
        const legacyResult: Message.Task.Result = {
          result: result.error.code === 'PROJECT_DIRECTORY_NOT_FOUND' ? 'noSuchFolder' : 'failed',
        }
        return JSON.stringify(legacyResult)
      }
      const legacyResult: Message.Task.Result = { result: `success:${result.data.project.id}` }
      return JSON.stringify(legacyResult)
    } catch (err) {
      dialog.showErrorBox('闁挎瑨顕?', (err as Error).message)
      const result: Message.Task.Result = { result: 'failed' }
      return JSON.stringify(result)
    }
  }

  function listProjects() {
    return JSON.stringify(ok({ projects: projectStore.listProjects() }))
  }

  function getProject(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const project = projectStore.getProjectById(id)
    if (!project) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${id} does not exist`))
    }
    return JSON.stringify(ok({ project }))
  }

  function getSeriesWorkspace(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)
    if (!task) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${id} does not exist`))
    }

    const project = projectStore.getProjectById(id)
    if (!project || project.projectMode !== 'episode') {
      return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${id} is not in series mode`))
    }

    return JSON.stringify(ok({ workspace: readSeriesWorkspace(project.id, task.path) }))
  }

  async function createSeriesEpisode(msg: string) {
    try {
      const input: CreateSeriesEpisodeInput = JSON.parse(msg)
      const { projectId } = input
      const episodeLabel = input.episodeLabel.trim()
      const episodeTitle = input.episodeTitle?.trim() || undefined

      if (!episodeLabel) {
        return JSON.stringify(fail('SERIES_EPISODE_LABEL_REQUIRED', 'Episode label is required'))
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      if (workspace.episodes.some(episode => episode.episodeLabel === episodeLabel)) {
        return JSON.stringify(fail('SERIES_EPISODE_DUPLICATED', `Episode ${episodeLabel} already exists`))
      }

      const timestamp = new Date().toISOString()
      const episodeId = Date.now()
      const directoryName = resolveEpisodeDirectoryName(
        episodeLabel,
        workspace.episodes.map(episode => episode.directoryName),
      )
      const episode: SeriesProjectEpisode = {
        id: episodeId,
        episodeLabel,
        episodeTitle,
        sortIndex: workspace.episodes.length,
        directoryName,
        variantCount: 0,
        variants: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      writeEpisodeRecord(task.path, episode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...workspace,
        episodes: [...workspace.episodes, episode].sort((left, right) => left.sortIndex - right.sortIndex),
        activeEpisodeId: workspace.activeEpisodeId ?? episode.id,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂佹寧鐟ㄩ?', (err as Error).message)
      return JSON.stringify(fail('SERIES_EPISODE_CREATE_FAILED', 'Unable to create series episode', (err as Error).message))
    }
  }

  async function createSeriesVariant(msg: string) {
    try {
      const input: CreateSeriesVariantInput = JSON.parse(msg)
      const { projectId, episodeId } = input
      const videoProfile = isSeriesVariantVideoProfile(input.videoProfile) ? input.videoProfile : undefined
      const subtitleProfile = isSeriesVariantSubtitleProfile(input.subtitleProfile) ? input.subtitleProfile : undefined
      const targetSites = normalizeSiteIds(input.targetSites)
      const titleTemplate = normalizeTitleTemplate(input.titleTemplate)
      const summaryTemplate = normalizeSummaryTemplate(input.summaryTemplate)
      const name = resolveVariantName({
        name: input.name,
        videoProfile,
        subtitleProfile,
      })

      if (!name) {
        return JSON.stringify(fail('SERIES_VARIANT_NAME_REQUIRED', 'Variant name is required'))
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const publishProfile = findPublishProfile(workspace, input.publishProfileId)

      if (hasVariantConflict(episode, name, videoProfile, subtitleProfile)) {
        return JSON.stringify(fail('SERIES_VARIANT_DUPLICATED', `Variant ${name} already exists`))
      }

      const timestamp = new Date().toISOString()
      let variant = buildSeriesVariant(episode, {
        id: Date.now(),
        name,
        videoProfile,
        subtitleProfile,
        publishProfileId: publishProfile?.id,
        publishProfileName: publishProfile?.name,
        createdAt: timestamp,
      })

      const config = writeVariantConfigFromDraft(task.path, episode, variant, {
        targetSites,
        templateContext: publishProfile?.templateContext,
        titleTemplate,
        summaryTemplate,
        siteDrafts: publishProfile?.siteDrafts,
        siteFieldDefaults: publishProfile?.siteFieldDefaults,
      })
      const variantSummary = buildVariantSummaryFromConfig(config)
      variant = {
        ...applyVariantSummary(variant, variantSummary),
        publishProfileSnapshot: buildPublishProfileSnapshot({
          profile: publishProfile,
          variantName: name,
          videoProfiles: publishProfile ? undefined : videoProfile ? [videoProfile] : undefined,
          subtitleProfiles: publishProfile ? undefined : subtitleProfile ? [subtitleProfile] : undefined,
          templateContext: publishProfile?.templateContext,
          targetSites: variantSummary.targetSites,
          titleTemplate,
          summaryTemplate,
          siteDrafts: publishProfile?.siteDrafts,
          siteFieldDefaults: normalizeSiteFieldDefaults(config.siteFieldDefaults),
        }),
      }

      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, variant],
        variantCount: episode.variants.length + 1,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, variant, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(fail('SERIES_VARIANT_CREATE_FAILED', 'Unable to create series variant', (err as Error).message))
    }
  }

  async function batchCreateSeriesVariants(msg: string) {
    try {
      const input: BatchCreateSeriesVariantsInput = JSON.parse(msg)
      const { projectId, episodeId } = input
      const videoProfiles = Array.isArray(input.videoProfiles)
        ? input.videoProfiles.filter(profile => isSeriesVariantTemplateVideoProfile(profile))
        : []
      const subtitleProfiles = Array.isArray(input.subtitleProfiles)
        ? input.subtitleProfiles.filter(profile => isSeriesVariantTemplateSubtitleProfile(profile))
        : []
      const targetSites = normalizeSiteIds(input.targetSites)
      const titleTemplate = normalizeTitleTemplate(input.titleTemplate)
      const summaryTemplate = normalizeSummaryTemplate(input.summaryTemplate)

      if (!videoProfiles.length || !subtitleProfiles.length) {
        return JSON.stringify(
          fail('SERIES_VARIANT_BATCH_PRESET_REQUIRED', 'At least one video profile and subtitle profile are required'),
        )
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }
      const publishProfile = findPublishProfile(workspace, input.publishProfileId)

      const timestamp = new Date().toISOString()
      const baseId = Date.now()
      const existingDirectoryNames = episode.variants.map(item => item.directoryName)
      const nextVariants: SeriesProjectVariant[] = []
      let skippedCount = 0

      videoProfiles.forEach(videoProfile => {
        subtitleProfiles.forEach(subtitleProfile => {
          const name = resolveVariantName({ videoProfile, subtitleProfile })
          const nextEpisodeState: SeriesProjectEpisode = {
            ...episode,
            variants: [...episode.variants, ...nextVariants],
          }
          if (!name || hasVariantConflict(nextEpisodeState, name, videoProfile, subtitleProfile)) {
            skippedCount += 1
            return
          }

          nextVariants.push(
            buildSeriesVariant(episode, {
              id: baseId + nextVariants.length,
              name,
              videoProfile,
              subtitleProfile,
              publishProfileId: publishProfile?.id,
              publishProfileName: publishProfile?.name,
              createdAt: timestamp,
              existingDirectoryNames,
            }),
          )
        })
      })

      if (!nextVariants.length) {
        return JSON.stringify(
          fail(
            'SERIES_VARIANT_BATCH_EMPTY',
            `Episode ${episode.episodeLabel} already contains all selected preset variants`,
          ),
        )
      }

      const nextVariantsWithSummary = nextVariants.map(variant => {
        const config = writeVariantConfigFromDraft(task.path, episode, variant, {
          targetSites,
          templateContext: publishProfile?.templateContext,
          titleTemplate,
          summaryTemplate,
          siteDrafts: publishProfile?.siteDrafts,
          siteFieldDefaults: publishProfile?.siteFieldDefaults,
        })
        const variantSummary = buildVariantSummaryFromConfig(config)
        return {
          ...applyVariantSummary(variant, variantSummary),
          publishProfileSnapshot: buildPublishProfileSnapshot({
            profile: publishProfile,
            variantName: variant.name,
            videoProfiles: publishProfile ? undefined : videoProfiles,
            subtitleProfiles: publishProfile ? undefined : subtitleProfiles,
            templateContext: publishProfile?.templateContext,
            targetSites: variantSummary.targetSites,
            titleTemplate,
            summaryTemplate,
            siteDrafts: publishProfile?.siteDrafts,
            siteFieldDefaults: normalizeSiteFieldDefaults(config.siteFieldDefaults),
          }),
        }
      })

      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, ...nextVariantsWithSummary],
        variantCount: episode.variants.length + nextVariantsWithSummary.length,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(
        ok({
          episode: nextEpisode,
          workspace: hydrateSeriesWorkspace(task.path, nextWorkspace),
          createdCount: nextVariantsWithSummary.length,
          skippedCount,
        }),
      )
    } catch (err) {
      dialog.showErrorBox('闂傚倷鐒︾€笛囨偡閵娾晩鏁?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_BATCH_FAILED', 'Unable to batch create series variants', (err as Error).message),
      )
    }
  }

  async function saveSeriesPublishProfile(msg: string) {
    try {
      const input: SaveSeriesPublishProfileInput = JSON.parse(msg)
      const { projectId } = input
      const name = input.name.trim()
      const videoProfiles = Array.isArray(input.videoProfiles)
        ? normalizeTemplateVideoProfiles(input.videoProfiles.filter(isSeriesVariantTemplateVideoProfile))
        : []
      const subtitleProfiles = Array.isArray(input.subtitleProfiles)
        ? normalizeTemplateSubtitleProfiles(input.subtitleProfiles.filter(isSeriesVariantTemplateSubtitleProfile))
        : []
      const requestedTargetSites = normalizeSiteIds(input.targetSites)
      const templateContext = normalizePublishProfileTemplateContext(input.templateContext)
      const titleTemplate = normalizeTitleTemplate(input.titleTemplate)
      const siteDrafts = normalizeSiteDrafts(input.siteDrafts, {
        targetSites: requestedTargetSites,
        summaryTemplate: normalizeSummaryTemplate(input.summaryTemplate),
      })
      const targetSites = normalizeSiteIds([...requestedTargetSites, ...getEnabledSiteIdsFromSiteDrafts(siteDrafts)])
      const summaryTemplate = resolvePrimarySiteDraftSummaryTemplate(siteDrafts, targetSites, input.summaryTemplate)
      const siteFieldDefaults = normalizeSiteFieldDefaults(input.siteFieldDefaults)
      const profileId = typeof input.profileId === 'number' ? input.profileId : undefined
      const requestedDefault = Boolean(input.isDefault)

      if (!name) {
        return JSON.stringify(fail('SERIES_PUBLISH_PROFILE_NAME_REQUIRED', 'Publish profile name is required'))
      }

      if (!videoProfiles.length || !subtitleProfiles.length) {
        return JSON.stringify(
          fail(
            'SERIES_PUBLISH_PROFILE_PRESET_REQUIRED',
            'Publish profile must contain at least one video profile and subtitle profile',
          ),
        )
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const templateIdentity = getVariantTemplateIdentity(
        videoProfiles,
        subtitleProfiles,
        targetSites,
        serializePublishProfileTemplateContext(templateContext),
        titleTemplate,
        summaryTemplate,
        JSON.stringify(normalizeSiteDrafts(siteDrafts) ?? {}),
        JSON.stringify(siteFieldDefaults ?? {}),
      )
      if (
        workspace.publishProfiles.some(profile => {
          if (profile.id === profileId) {
            return false
          }

          const hasSameName = normalizeVariantName(profile.name) === normalizeVariantName(name)
          const hasSameIdentity =
            getVariantTemplateIdentity(
              profile.videoProfiles,
              profile.subtitleProfiles,
              profile.targetSites,
              serializePublishProfileTemplateContext(profile.templateContext),
              profile.titleTemplate,
              profile.summaryTemplate,
              JSON.stringify(normalizeSiteDrafts(profile.siteDrafts, {
                targetSites: profile.targetSites,
                summaryTemplate: profile.summaryTemplate,
              }) ?? {}),
              JSON.stringify(normalizeSiteFieldDefaults(profile.siteFieldDefaults) ?? {}),
            ) === templateIdentity
          return hasSameName || hasSameIdentity
        })
      ) {
        return JSON.stringify(
          fail('SERIES_PUBLISH_PROFILE_DUPLICATED', `Publish profile ${name} already exists in this project`),
        )
      }

      const timestamp = new Date().toISOString()
      const profile: SeriesPublishProfile = {
        id: profileId ?? Date.now(),
        name,
        isDefault: requestedDefault,
        videoProfiles,
        subtitleProfiles,
        templateContext,
        targetSites: targetSites.length ? targetSites : undefined,
        titleTemplate,
        summaryTemplate,
        siteDrafts,
        siteFieldDefaults,
        createdAt: workspace.publishProfiles.find(item => item.id === profileId)?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }

      const mergedProfiles = profileId
        ? workspace.publishProfiles.map(item => (item.id === profile.id ? profile : item))
        : [...workspace.publishProfiles, profile]
      const defaultProfileId = resolveDefaultPublishProfileId(
        mergedProfiles,
        requestedDefault ? profile.id : workspace.publishProfiles.find(item => item.isDefault)?.id,
      )
      const nextProfiles = normalizePublishProfiles(
        mergedProfiles.map(item => ({
          ...item,
          isDefault: item.id === defaultProfileId,
        })),
      )
      const nextWorkspace: SeriesProjectWorkspace = {
        ...workspace,
        publishProfiles: nextProfiles,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(
        ok({
          profile: nextProfiles.find(item => item.id === profile.id) ?? profile,
          workspace: hydrateSeriesWorkspace(task.path, nextWorkspace),
        }),
      )
    } catch (err) {
      dialog.showErrorBox('闂傚倷鐒︾€笛囨偡閵娾晩鏁?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_PUBLISH_PROFILE_SAVE_FAILED', 'Unable to save series publish profile', (err as Error).message),
      )
    }
  }

  async function removeSeriesPublishProfile(msg: string) {
    try {
      const input: RemoveSeriesPublishProfileInput = JSON.parse(msg)
      const { projectId, profileId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      if (!workspace.publishProfiles.some(profile => profile.id === profileId)) {
        return JSON.stringify(fail('SERIES_PUBLISH_PROFILE_NOT_FOUND', `Publish profile ${profileId} does not exist`))
      }

      const timestamp = new Date().toISOString()
      const nextProfiles = normalizePublishProfiles(workspace.publishProfiles.filter(profile => profile.id !== profileId))
      const nextWorkspace: SeriesProjectWorkspace = {
        ...workspace,
        publishProfiles: nextProfiles,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ profileId, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂傚倷鐒︾€笛囨偡閵娾晩鏁?', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_PUBLISH_PROFILE_REMOVE_FAILED',
          'Unable to remove series publish profile',
          (err as Error).message,
        ),
      )
    }
  }

  const saveSeriesVariantTemplate = saveSeriesPublishProfile
  const removeSeriesVariantTemplate = removeSeriesPublishProfile

  async function inheritSeriesEpisodeVariants(msg: string) {
    try {
      const input: InheritSeriesEpisodeVariantsInput = JSON.parse(msg)
      const { projectId, episodeId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const previousEpisode = findPreviousEpisode(workspace, episodeId)
      if (!previousEpisode) {
        return JSON.stringify(
          fail('SERIES_PREVIOUS_EPISODE_NOT_FOUND', `Episode ${episode.episodeLabel} has no previous episode`),
        )
      }

      if (!previousEpisode.variants.length) {
        return JSON.stringify(
          fail(
            'SERIES_PREVIOUS_EPISODE_VARIANTS_EMPTY',
            `Previous episode ${previousEpisode.episodeLabel} has no variants to inherit`,
          ),
        )
      }

      const timestamp = new Date().toISOString()
      const baseId = Date.now()
      const existingDirectoryNames = episode.variants.map(item => item.directoryName)
      const existingVariantKeys = new Set(
        episode.variants.map(variant =>
          getVariantIdentity({
            name: variant.name,
            videoProfile: variant.videoProfile,
            subtitleProfile: variant.subtitleProfile,
          }),
        ),
      )
      const existingVariantNames = new Set(episode.variants.map(variant => normalizeVariantName(variant.name)))
      const sourceVariantPairs: Array<{ source: SeriesProjectVariant; copied: SeriesProjectVariant }> = []

      previousEpisode.variants.forEach(sourceVariant => {
        const nextName = resolveVariantName({
          name: sourceVariant.name,
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
        })
        const variantIdentity = getVariantIdentity({
          name: nextName,
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
        })
        if (existingVariantKeys.has(variantIdentity) || existingVariantNames.has(normalizeVariantName(nextName))) {
          return
        }

        const copiedVariant: SeriesProjectVariant = {
          id: baseId + sourceVariantPairs.length,
          name: nextName,
          directoryName: resolveVariantDirectoryName(nextName, existingDirectoryNames),
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
          publishProfileId: sourceVariant.publishProfileId,
          publishProfileName: sourceVariant.publishProfileName,
          publishProfileSnapshot: clonePublishProfileSnapshot(sourceVariant.publishProfileSnapshot),
          targetSites: sourceVariant.targetSites,
          title: sourceVariant.title,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        existingDirectoryNames.push(copiedVariant.directoryName)
        existingVariantKeys.add(variantIdentity)
        existingVariantNames.add(normalizeVariantName(nextName))
        sourceVariantPairs.push({ source: sourceVariant, copied: copiedVariant })
      })

      if (!sourceVariantPairs.length) {
        return JSON.stringify(
          fail(
            'SERIES_VARIANTS_ALREADY_INHERITED',
            `Episode ${episode.episodeLabel} already has all inheritable variants from ${previousEpisode.episodeLabel}`,
          ),
        )
      }

      sourceVariantPairs.forEach(({ source, copied }) => {
        const sourceConfigPath = getVariantConfigPath(task.path, previousEpisode, source)
        copyVariantConfig(
          fs.existsSync(sourceConfigPath) ? sourceConfigPath : getDraftConfigPath(task.path),
          getVariantConfigPath(task.path, episode, copied),
        )
      })

      const copiedVariants = sourceVariantPairs.map(pair => pair.copied)
      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, ...copiedVariants],
        variantCount: episode.variants.length + copiedVariants.length,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace), copiedCount: copiedVariants.length }))
    } catch (err) {
      dialog.showErrorBox('闂傚倷鐒︾€笛囨偡閵娾晩鏁?', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_VARIANT_INHERIT_FAILED',
          'Unable to inherit variants from previous episode',
          (err as Error).message,
        ),
      )
    }
  }

  async function duplicateSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const sourceConfigPath = getVariantConfigPath(task.path, episode, variant)
      if (!fs.existsSync(sourceConfigPath)) {
        return JSON.stringify(
          fail('SERIES_VARIANT_CONFIG_NOT_FOUND', `Variant config for ${variant.name} does not exist`),
        )
      }

      const timestamp = new Date().toISOString()
      const existingDirectoryNames = episode.variants.map(item => item.directoryName)
      const nextName = resolveCopiedVariantName(variant.name, episode.variants)
      const nextVariant = buildSeriesVariant(episode, {
        id: Date.now(),
        name: nextName,
        videoProfile:
          variant.videoProfile && variant.videoProfile !== 'custom' ? undefined : variant.videoProfile,
        subtitleProfile:
          variant.subtitleProfile && variant.subtitleProfile !== 'custom' ? undefined : variant.subtitleProfile,
        publishProfileId: variant.publishProfileId,
        publishProfileName: variant.publishProfileName,
        publishProfileSnapshot: clonePublishProfileSnapshot(variant.publishProfileSnapshot),
        targetSites: variant.targetSites,
        title: variant.title,
        createdAt: timestamp,
        existingDirectoryNames,
      })
      copyVariantConfig(sourceConfigPath, getVariantConfigPath(task.path, episode, nextVariant))

      const nextVariantWithSummary = applyVariantSummary(
        nextVariant,
        readVariantConfigSummary(task.path, episode, nextVariant),
      )
      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, nextVariantWithSummary],
        variantCount: episode.variants.length + 1,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(
        ok({
          episode: nextEpisode,
          variant: nextVariantWithSummary,
          workspace: hydrateSeriesWorkspace(task.path, nextWorkspace),
        }),
      )
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_DUPLICATE_FAILED', 'Unable to duplicate series variant', (err as Error).message),
      )
    }
  }

  async function removeSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const timestamp = new Date().toISOString()
      const activeVariantRemoved =
        workspace.activeEpisodeId === episode.id && workspace.activeVariantId === variant.id

      fs.rmSync(getVariantDirectoryPath(task.path, episode, variant), { recursive: true, force: true })

      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: episode.variants.filter(item => item.id !== variant.id),
        variantCount: Math.max(episode.variants.length - 1, 0),
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      if (activeVariantRemoved) {
        replaceLegacyTaskPublishState(task, undefined)
        await projectStore.write()
      }

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId:
          activeVariantRemoved && workspace.activeEpisodeId === episode.id ? episode.id : workspace.activeEpisodeId,
        activeVariantId: activeVariantRemoved ? undefined : workspace.activeVariantId,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_REMOVE_FAILED', 'Unable to remove series variant', (err as Error).message),
      )
    }
  }

  async function activateSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const timestamp = new Date().toISOString()
      const workspace = syncActiveVariantDraft(task.path, readSeriesWorkspace(project.id, task.path), timestamp)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const variantConfigPath = getVariantConfigPath(task.path, episode, variant)
      if (!fs.existsSync(variantConfigPath)) {
        return JSON.stringify(
          fail('SERIES_VARIANT_CONFIG_NOT_FOUND', `Variant config for ${variant.name} does not exist`),
        )
      }

      fs.copyFileSync(variantConfigPath, getDraftConfigPath(task.path))
      replaceLegacyTaskPublishState(task, variant.publishResults)
      await projectStore.write()
      const nextVariant = applyVariantSummary(
        {
          ...variant,
          updatedAt: timestamp,
        },
        readVariantConfigSummary(task.path, episode, variant),
      )
      const nextEpisode = replaceVariant(episode, nextVariant, timestamp)
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: episode.id,
        activeVariantId: variant.id,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, variant: nextVariant, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_ACTIVATE_FAILED', 'Unable to activate series variant', (err as Error).message),
      )
    }
  }

  async function syncSeriesVariantFromDraft(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const variantDirectoryPath = getVariantDirectoryPath(task.path, episode, variant)
      fs.mkdirSync(variantDirectoryPath, { recursive: true })
      fs.copyFileSync(getDraftConfigPath(task.path), getVariantConfigPath(task.path, episode, variant))

      const timestamp = new Date().toISOString()
      const nextVariant = applyVariantSummary(
        {
          ...variant,
          publishResults: getDraftPublishResults(projectId),
          updatedAt: timestamp,
        },
        readDraftConfigSummary(task.path),
      )
      const nextEpisode = replaceVariant(episode, nextVariant, timestamp)
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, variant: nextVariant, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_VARIANT_SYNC_FAILED',
          'Unable to sync current draft to series variant',
          (err as Error).message,
        ),
      )
    }
  }

  function getProjectStats() {
    return JSON.stringify(ok({ stats: projectStore.getProjectStats() }))
  }

  function getTaskList() {
    const result: Message.Task.TaskList = { list: projectStore.getLegacyTaskList() }
    return JSON.stringify(result)
  }

  async function removeProject(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)
    if (!task) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${id} does not exist`))
    }
    fs.rmSync(task.path, { recursive: true, force: true })
    projectStore.removeLegacyTask(id)
    await projectStore.write()
    notifyProjectDataChanged()
    return JSON.stringify(ok({ id }))
  }

  async function removeTask(msg: string) {
    await removeProject(msg)
  }

  async function getForumLink(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const info = projectStore.findLegacyTaskById(id)!
    const result: Message.Task.ForumLink = { link: info.forumLink }
    return JSON.stringify(result)
  }

  async function setTaskProcess(msg: string) {
    const { id, step }: Message.Task.TaskStatus = JSON.parse(msg)
    projectStore.setLegacyTaskStep(id, step)
    await projectStore.write()
    notifyProjectDataChanged()
  }

  async function getPublishStatus(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)!
    const result: Message.Task.PublishStatus = {}
    const isPublishedLink = (value?: string) => Boolean(value && /^https?:\/\//.test(value))
    const publishedLabel = '閸欐垵绔风€瑰本鍨?'

    if (isPublishedLink(task.bangumi)) {
      result.bangumi = publishedLabel
      result.bangumi_all
    }
    if (isPublishedLink(task.mikan)) result.mikan = publishedLabel
    if (isPublishedLink(task.miobt)) result.miobt = publishedLabel
    if (isPublishedLink(task.nyaa)) result.nyaa = publishedLabel
    if (isPublishedLink(task.dmhy)) result.dmhy = publishedLabel
    if (isPublishedLink(task.acgrip)) result.acgrip = publishedLabel
    if (isPublishedLink(task.acgnx_a)) result.acgnx_a = publishedLabel
    if (isPublishedLink(task.acgnx_g)) result.acgnx_g = publishedLabel
    return JSON.stringify(result)
  }

  async function getPublishConfig(msg: string) {
    try {
      const { id }: Message.Task.TaskID = JSON.parse(msg)
      const task = projectStore.findLegacyTaskById(id)!
      const config: Message.Task.PublishConfig = JSON.parse(
        fs.readFileSync(join(task.path, 'config.json'), { encoding: 'utf-8' }),
      )
      return JSON.stringify(config)
    } catch (err) {
      dialog.showErrorBox('闁挎瑨顕?', (err as Error).message)
      return
    }
  }

  async function saveConfig(msg: string) {
    const { id, config }: Message.Task.ModifiedConfig = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)!
    fs.writeFileSync(getDraftConfigPath(task.path), JSON.stringify(config))

    const project = projectStore.getProjectById(id)
    if (project?.projectMode === 'episode') {
      const workspace = readSeriesWorkspace(project.id, task.path)
      const timestamp = new Date().toISOString()
      const nextWorkspace = syncActiveVariantDraft(task.path, workspace, timestamp)
      if (nextWorkspace !== workspace) {
        writeSeriesWorkspace(task.path, nextWorkspace)
      }
    }

    notifyProjectDataChanged()
    const result: Message.Task.Result = { result: 'success' }
    return JSON.stringify(result)
  }

  return {
    createProject,
    createTask,
    listProjects,
    getProject,
    getSeriesWorkspace,
    createSeriesEpisode,
    createSeriesVariant,
    batchCreateSeriesVariants,
    saveSeriesPublishProfile,
    removeSeriesPublishProfile,
    saveSeriesVariantTemplate,
    removeSeriesVariantTemplate,
    inheritSeriesEpisodeVariants,
    duplicateSeriesVariant,
    removeSeriesVariant,
    activateSeriesVariant,
    syncSeriesVariantFromDraft,
    getProjectStats,
    removeProject,
    getTaskList,
    removeTask,
    getForumLink,
    setTaskProcess,
    getPublishStatus,
    getPublishConfig,
    saveConfig,
  }
}
