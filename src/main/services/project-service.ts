import { app, dialog } from 'electron'
import fs from 'fs'
import { basename, join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { PublishResult, PublishState } from '../../shared/types/publish'
import type {
  CreateProjectInput,
  LegacyProjectType,
  MarkupFormat,
  ProjectMode,
  ProjectSourceKind,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesPublishProfile,
  SeriesPublishProfileSnapshot,
  SeriesPublishProfileSiteDraft,
  SeriesPublishProfileSiteDrafts,
  SeriesPublishProfileSiteFieldDefaults,
  SeriesTitleMatchConfig,
  SaveSeriesTitleMatchConfigInput,
  ImportSeriesMatchedTorrentsInput,
  SeriesPublishProfileTemplateContext,
  SeriesVariantTemplateSubtitleProfile,
  SeriesVariantTemplateVideoProfile,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
  SeriesProjectWorkspace,
  SeriesVariantDraftInput,
} from '../../shared/types/project'
import type { SiteId } from '../../shared/types/site'
import {
  applySeriesTitleTagTemplateVariables,
  composeSeriesPublishTitle,
  matchSeriesTitlePattern,
  normalizeMatchedSubtitleProfile,
  normalizeMatchedVideoProfile,
  normalizeSeriesTitleMatchConfig,
  resolveSeriesTitleMappedTagBindings,
  renderSeriesEpisodeTemplate,
  renderSeriesTitleTemplate,
  renderSeriesVariantTemplate,
  stripTorrentExtension,
} from '../../shared/utils/series-title-match'
import { getNowFormatDate } from '../core/utils'
import { createProjectStore } from '../storage/project-store'
import { buildEpisodeDerivedContent, writeDerivedContent } from './episode-publish-support'

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

interface CreateProjectServiceOptions {
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged: ProjectChangeHandler
}

interface SeriesEpisodeReviewVariantPayload {
  variant: SeriesProjectVariant
  config: Config.PublishConfig
  isActive: boolean
}

interface SeriesEpisodeReviewPayload {
  episode: SeriesProjectEpisode
  variants: SeriesEpisodeReviewVariantPayload[]
  workspace: SeriesProjectWorkspace
}

interface RecordSeriesVariantPublishResultInput {
  projectId: number
  episodeId: number
  variantId: number
  result: PublishResult
  syncTaskState?: boolean
}

export function createProjectService(options: CreateProjectServiceOptions) {
  const { projectStore, notifyProjectDataChanged } = options
  const defaultEpisodeSites: SiteId[] = []
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

  function createDefaultSeriesWorkspace(projectId: number, plannedEpisodeCount?: number): SeriesProjectWorkspace {
    const timestamp = new Date(projectId).toISOString()
    return {
      projectId,
      plannedEpisodeCount: normalizePlannedEpisodeCount(plannedEpisodeCount),
      episodes: [],
      publishProfiles: [],
      titleMatchConfig: undefined,
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
            bodyTemplate: normalizeBodyTemplate(profile.bodyTemplate),
            bodyTemplateFormat: normalizeMarkupFormat(profile.bodyTemplateFormat),
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
    const titleMatchConfig = cloneSeriesTitleMatchConfig(workspace.titleMatchConfig)

    return {
      ...persistedWorkspace,
      publishProfiles,
      titleMatchConfig,
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
        plannedEpisodeCount: normalizePlannedEpisodeCount(parsed.plannedEpisodeCount),
        episodes,
        publishProfiles,
        titleMatchConfig: cloneSeriesTitleMatchConfig(parsed.titleMatchConfig),
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

  function normalizeBodyTemplate(value: unknown) {
    if (typeof value !== 'string') {
      return undefined
    }

    const trimmedValue = value.trim()
    return trimmedValue || undefined
  }

  function normalizeMarkupFormat(value: unknown): MarkupFormat | undefined {
    if (value === 'html' || value === 'md' || value === 'bbcode') {
      return value
    }

    return undefined
  }

  function cloneSeriesTitleMatchConfig(value: unknown) {
    return normalizeSeriesTitleMatchConfig(value)
  }

  function normalizePlannedEpisodeCount(value: unknown) {
    const count = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : undefined
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

  function filterSiteFieldDefaultsByTargetSites(
    fieldDefaults: SeriesPublishProfileSiteFieldDefaults | undefined,
    targetSites: SiteId[],
  ) {
    const normalizedFieldDefaults = normalizeSiteFieldDefaults(fieldDefaults)
    if (!normalizedFieldDefaults) {
      return undefined
    }

    const allowedSites = new Set(normalizeSiteIds(targetSites))
    if (!allowedSites.size) {
      return undefined
    }

    const nextFieldDefaults = Object.entries(normalizedFieldDefaults).reduce<
      Partial<Record<SiteId, Record<string, unknown>>>
    >((accumulator, [siteId, siteFieldDefaults]) => {
      if (!allowedSites.has(siteId as SiteId)) {
        return accumulator
      }

      accumulator[siteId as SiteId] = { ...siteFieldDefaults }
      return accumulator
    }, {})

    return Object.keys(nextFieldDefaults).length > 0 ? nextFieldDefaults : undefined
  }

  function buildProjectSiteFieldDefaults(config: Config.PublishConfig) {
    const targetSites = getVariantTargetSitesFromConfig(config)
    const nextFieldDefaults = filterSiteFieldDefaultsByTargetSites(config.siteFieldDefaults, targetSites) ?? {}
    const bangumiCategory = normalizeOptionalString(config.category_bangumi)
    const nyaaCategory = normalizeOptionalString(config.category_nyaa)

    if (bangumiCategory && targetSites.includes('bangumi')) {
      nextFieldDefaults.bangumi = {
        ...(nextFieldDefaults.bangumi ?? {}),
        category_bangumi: bangumiCategory,
      }
    }

    if (nyaaCategory && targetSites.includes('nyaa')) {
      nextFieldDefaults.nyaa = {
        ...(nextFieldDefaults.nyaa ?? {}),
        category_nyaa: nyaaCategory,
        categoryCode: nyaaCategory,
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
    bodyTemplate?: string
    bodyTemplateFormat?: MarkupFormat
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
    const bodyTemplate = normalizeBodyTemplate(input.bodyTemplate ?? input.profile?.bodyTemplate)
    const bodyTemplateFormat = normalizeMarkupFormat(input.bodyTemplateFormat ?? input.profile?.bodyTemplateFormat)
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
      bodyTemplate,
      bodyTemplateFormat,
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
      bodyTemplate:
        rawSnapshot && 'bodyTemplate' in rawSnapshot ? normalizeBodyTemplate(rawSnapshot.bodyTemplate) : undefined,
      bodyTemplateFormat:
        rawSnapshot && 'bodyTemplateFormat' in rawSnapshot
          ? normalizeMarkupFormat(rawSnapshot.bodyTemplateFormat)
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
    if (rawSnapshot && 'bodyTemplate' in rawSnapshot && !normalizeBodyTemplate(rawSnapshot.bodyTemplate)) {
      snapshot.bodyTemplate = undefined
      snapshot.bodyTemplateFormat = undefined
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

  function isEpisodeContent(value: unknown): value is Config.Content_episode {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'episodeLabel' in value)
  }

  function isEpisodePublishConfig(config: Config.PublishConfig): config is Config.PublishConfig & { content: Config.Content_episode } {
    return isEpisodeContent(config.content)
  }

  function materializeEpisodeDerivedDraftFiles(projectPath: string, config: Config.PublishConfig) {
    if (!isEpisodePublishConfig(config)) {
      return
    }

    writeDerivedContent(projectPath, buildEpisodeDerivedContent(config))
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

  function syncEpisodeSharedDraftAcrossVariants(
    projectPath: string,
    workspace: SeriesProjectWorkspace,
    updatedAt: string,
  ) {
    if (!workspace.activeEpisodeId || !workspace.activeVariantId) {
      return workspace
    }

    const episode = workspace.episodes.find(item => item.id === workspace.activeEpisodeId)
    const activeVariant = episode?.variants.find(item => item.id === workspace.activeVariantId)
    if (!episode || !activeVariant) {
      return workspace
    }

    const draftConfig = readPublishConfigFromPath(getDraftConfigPath(projectPath))
    if (!isEpisodePublishConfig(draftConfig)) {
      return workspace
    }

    const sourceTargetSites = getVariantTargetSitesFromConfig(draftConfig)
    const sourceSummary = draftConfig.content.summary ?? ''
    const sourceInformation = draftConfig.information ?? ''
    const sourceBangumiCategory = draftConfig.category_bangumi ?? ''
    const sourceNyaaCategory = draftConfig.category_nyaa ?? ''
    const sourceBodyTemplate = normalizeBodyTemplate(draftConfig.bodyTemplate)
    const sourceBodyTemplateFormat = normalizeMarkupFormat(draftConfig.bodyTemplateFormat)

    let nextEpisode = episode
    let didChange = false

    episode.variants.forEach(variant => {
      if (variant.id === activeVariant.id) {
        return
      }

      const variantConfigPath = getVariantConfigPath(projectPath, episode, variant)
      if (!fs.existsSync(variantConfigPath)) {
        return
      }

      const variantConfig = readPublishConfigFromPath(variantConfigPath)
      if (!isEpisodePublishConfig(variantConfig)) {
        return
      }

      let variantChanged = false

      const variantTargetSites = getVariantTargetSitesFromConfig(variantConfig)
      if (normalizeSiteIds(variantTargetSites).join('|') !== normalizeSiteIds(sourceTargetSites).join('|')) {
        variantConfig.targetSites = [...sourceTargetSites]
        variantConfig.content.targetSites = [...sourceTargetSites]
        variantChanged = true
      }

      if ((variantConfig.information ?? '') !== sourceInformation) {
        variantConfig.information = sourceInformation
        variantChanged = true
      }

      if ((variantConfig.content.summary ?? '') !== sourceSummary) {
        variantConfig.content.summary = sourceSummary
        variantChanged = true
      }

      if ((variantConfig.category_bangumi ?? '') !== sourceBangumiCategory) {
        variantConfig.category_bangumi = sourceBangumiCategory
        variantChanged = true
      }

      if ((variantConfig.category_nyaa ?? '') !== sourceNyaaCategory) {
        variantConfig.category_nyaa = sourceNyaaCategory
        variantChanged = true
      }

      const variantBodyTemplate = normalizeBodyTemplate(variantConfig.bodyTemplate)
      const variantBodyTemplateFormat = normalizeMarkupFormat(variantConfig.bodyTemplateFormat)
      if (variantBodyTemplate !== sourceBodyTemplate || variantBodyTemplateFormat !== sourceBodyTemplateFormat) {
        variantConfig.bodyTemplate = sourceBodyTemplate
        variantConfig.bodyTemplateFormat = sourceBodyTemplate ? sourceBodyTemplateFormat : undefined
        variantChanged = true
      }

      if (!variantChanged) {
        return
      }

      fs.writeFileSync(variantConfigPath, JSON.stringify(variantConfig))
      const nextVariant = applyVariantSummary(
        {
          ...variant,
          updatedAt,
        },
        buildVariantSummaryFromConfig(variantConfig),
      )
      nextEpisode = replaceVariant(nextEpisode, nextVariant, updatedAt)
      didChange = true
    })

    if (!didChange) {
      return workspace
    }

    writeEpisodeRecord(projectPath, nextEpisode)
    return {
      ...replaceEpisode(workspace, nextEpisode),
      updatedAt,
    }
  }

  function readPublishConfigFromPath(configPath: string) {
    return JSON.parse(fs.readFileSync(configPath, { encoding: 'utf-8' })) as Config.PublishConfig
  }

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

  function buildTitleMatchValues(config: SeriesTitleMatchConfig, filePath: string) {
    const fileName = basename(filePath)
    const matched = matchSeriesTitlePattern(config.fileNamePattern, fileName)
    if (!matched) {
      return null
    }

    const episodeLabel = renderSeriesEpisodeTemplate(config.episodeTemplate, matched)
    const variantName = renderSeriesVariantTemplate(config.variantTemplate, matched)
    const sourceType = renderSeriesTitleTemplate(config.sourceTypeTemplate, matched)
    const resolution = renderSeriesTitleTemplate(config.resolutionTemplate, matched)
    const videoCodec = renderSeriesTitleTemplate(config.videoCodecTemplate, matched)
    const audioCodec = renderSeriesTitleTemplate(config.audioCodecTemplate, matched)
    const subtitle = renderSeriesTitleTemplate(config.subtitleTemplate, matched)
    const releaseTeam = renderSeriesTitleTemplate(config.releaseTeamTemplate, matched)
    const titleTagBindings = resolveSeriesTitleMappedTagBindings(
      config.titleTagMappings,
      buildTitleTagSourceTexts({
        fileName,
        variables: matched,
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
    const titleVariables = applySeriesTitleTagTemplateVariables(matched, titleTagBindings)
    const title = renderSeriesTitleTemplate(config.titleTemplate, titleVariables)

    return {
      fileName,
      variables: matched,
      episodeLabel,
      variantName,
      title,
      releaseTeam,
      sourceType,
      resolution,
      videoCodec,
      audioCodec,
      subtitle,
      titleTags: titleTagBindings.flatMap(binding => binding.labels),
      titleTagBindings,
      videoProfile: normalizeMatchedVideoProfile(resolution),
      subtitleProfile: normalizeMatchedSubtitleProfile(subtitle),
    }
  }

  function applyTitleMatchConfigToPublishConfig(
    baseConfig: Config.PublishConfig,
    titleMatchConfig: SeriesTitleMatchConfig,
    values: NonNullable<ReturnType<typeof buildTitleMatchValues>>,
    filePath: string,
  ) {
    const nextConfig = JSON.parse(JSON.stringify(baseConfig)) as Config.PublishConfig
    const targetSites = normalizeSiteIds(titleMatchConfig.targetSites)
    nextConfig.torrentPath = filePath
    nextConfig.torrentName = basename(filePath)

    if (targetSites.length > 0) {
      nextConfig.targetSites = [...targetSites]
    }

    if (nextConfig.content && typeof nextConfig.content === 'object' && !Array.isArray(nextConfig.content)) {
      const content = nextConfig.content as Partial<Config.Content_episode>
      if (values.episodeLabel) {
        content.episodeLabel = values.episodeLabel
      }
      if (values.releaseTeam) {
        content.releaseTeam = values.releaseTeam
      }
      if (values.sourceType) {
        content.sourceType = values.sourceType
      }
      if (values.resolution) {
        content.resolution = values.resolution
      }
      if (values.videoCodec) {
        content.videoCodec = values.videoCodec
      }
      if (values.audioCodec) {
        content.audioCodec = values.audioCodec
      }
      if (targetSites.length > 0) {
        content.targetSites = [...targetSites]
      }
    }

    if (values.title) {
      nextConfig.title = values.title
      return nextConfig
    }

    const content =
      nextConfig.content && typeof nextConfig.content === 'object' && !Array.isArray(nextConfig.content)
        ? (nextConfig.content as Partial<Config.Content_episode>)
        : undefined
    const mainTitle =
      normalizeOptionalString(content?.seriesTitleEN) ??
      normalizeOptionalString(content?.seriesTitleCN) ??
      normalizeOptionalString(content?.seriesTitleJP) ??
      stripTorrentExtension(basename(filePath))

    nextConfig.title = composeSeriesPublishTitle({
      releaseTeam: values.releaseTeam || normalizeOptionalString(content?.releaseTeam),
      mainTitle,
      seasonLabel: normalizeOptionalString(content?.seasonLabel),
      episodeLabel: values.episodeLabel || normalizeOptionalString(content?.episodeLabel),
      sourceType: values.sourceType || normalizeOptionalString(content?.sourceType),
      resolution: values.resolution || normalizeOptionalString(content?.resolution),
      videoCodec: values.videoCodec || normalizeOptionalString(content?.videoCodec),
      audioCodec: values.audioCodec || normalizeOptionalString(content?.audioCodec),
      variantName: values.variantName,
    })

    return nextConfig
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

  function resolveCopiedVariantName(name: string, existingVariants: SeriesProjectVariant[]) {
    const trimmedName = name.trim() || 'variant'
    const baseName = `${trimmedName} \u526f\u672c`
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
  function buildInitialContent(projectMode: ProjectMode, sourceKind?: ProjectSourceKind) {
    if (projectMode === 'episode') {
      return {
        seriesTitleCN: '',
        seriesTitleEN: '',
        seriesTitleJP: '',
        seasonLabel: '',
        episodeLabel: '',
        episodeTitle: '',
        releaseTeam: '',
        sourceType: '',
        resolution: '',
        videoCodec: '',
        audioCodec: '',
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
      siteFieldDefaults: undefined,
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

    if (workingDirectory === '') {
      workingDirectory = join(app.getPath('userData'), 'task')
      if (!fs.existsSync(workingDirectory)) {
        fs.mkdirSync(workingDirectory)
      }
    }

    if (!fs.existsSync(workingDirectory)) {
      return fail('PROJECT_DIRECTORY_NOT_FOUND', '\u9879\u76ee\u5de5\u4f5c\u76ee\u5f55\u4e0d\u5b58\u5728')
    }

    if (name === '') {
      name = getNowFormatDate().replace(/:/g, '-')
    }

    const projectPath = join(workingDirectory, name)
    fs.mkdirSync(projectPath)
    const initialConfig = buildInitialPublishConfig(input)
    fs.writeFileSync(join(projectPath, 'config.json'), JSON.stringify(initialConfig))
    if (projectMode === 'episode') {
      materializeEpisodeDerivedDraftFiles(projectPath, initialConfig)
    }

    const id = Date.now()
    if (projectMode === 'episode') {
      writeSeriesWorkspace(projectPath, createDefaultSeriesWorkspace(id, input.plannedEpisodeCount))
    }
    const legacyType: LegacyProjectType | undefined = projectMode === 'episode' ? 'episode' : sourceKind
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
      return fail('PROJECT_CREATE_FAILED', '\u9879\u76ee\u8bb0\u5f55\u5199\u5165\u5931\u8d25')
    }

    return ok({ project })
  }

  async function createProject(msg: string) {
    try {
      const input: CreateProjectInput = JSON.parse(msg)
      return JSON.stringify(await createProjectRecord(input))
    } catch (err) {
      dialog.showErrorBox('\u521b\u5efa\u9879\u76ee\u5931\u8d25', (err as Error).message)
      return JSON.stringify(fail('PROJECT_CREATE_FAILED', '\u65e0\u6cd5\u521b\u5efa\u9879\u76ee', (err as Error).message))
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
      dialog.showErrorBox('\u521b\u5efa\u4efb\u52a1\u5931\u8d25', (err as Error).message)
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
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${id} \u4e0d\u5b58\u5728`))
    }
    return JSON.stringify(ok({ project }))
  }

  function getSeriesWorkspace(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)
    if (!task) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${id} \u4e0d\u5b58\u5728`))
    }

    const project = projectStore.getProjectById(id)
    if (!project || project.projectMode !== 'episode') {
      return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${id} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
    }

    return JSON.stringify(ok({ workspace: readSeriesWorkspace(project.id, task.path) }))
  }

  function getSeriesEpisodeReviewBundle(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)
    if (!task) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${id} \u4e0d\u5b58\u5728`))
    }

    const project = projectStore.getProjectById(id)
    if (!project || project.projectMode !== 'episode') {
      return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${id} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
    }

    const timestamp = new Date().toISOString()
    let syncedWorkspace = syncActiveVariantDraft(task.path, readSeriesWorkspace(project.id, task.path), timestamp)
    syncedWorkspace = syncEpisodeSharedDraftAcrossVariants(task.path, syncedWorkspace, timestamp)
    writeSeriesWorkspace(task.path, syncedWorkspace)
    const hydratedWorkspace = hydrateSeriesWorkspace(task.path, syncedWorkspace)
    const episode = hydratedWorkspace.episodes.find(item => item.id === hydratedWorkspace.activeEpisodeId)

    if (!episode) {
      return JSON.stringify(fail('SERIES_ACTIVE_EPISODE_REQUIRED', '\u8bf7\u5148\u5728\u7f16\u8f91\u9875\u8f7d\u5165\u4e00\u96c6\u7684\u5f53\u524d\u7248\u672c'))
    }

    const variants = episode.variants.reduce<SeriesEpisodeReviewVariantPayload[]>((records, variant) => {
      const variantConfigPath = getVariantConfigPath(task.path, episode, variant)
      const fallbackConfigPath = getDraftConfigPath(task.path)
      const configPath = fs.existsSync(variantConfigPath) ? variantConfigPath : fallbackConfigPath
      if (!fs.existsSync(configPath)) {
        return records
      }

      records.push({
        variant,
        config: readPublishConfigFromPath(configPath),
        isActive: variant.id === hydratedWorkspace.activeVariantId,
      })
      return records
    }, [])

    const payload: SeriesEpisodeReviewPayload = {
      episode,
      variants,
      workspace: hydratedWorkspace,
    }

    notifyProjectDataChanged()
    return JSON.stringify(ok(payload))
  }
  async function saveSeriesTitleMatchConfig(msg: string) {
    try {
      const input: SaveSeriesTitleMatchConfigInput = JSON.parse(msg)
      const { projectId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const titleMatchConfig = cloneSeriesTitleMatchConfig(input.config)
      if (!titleMatchConfig?.fileNamePattern) {
        return JSON.stringify(fail('SERIES_TITLE_MATCH_PATTERN_REQUIRED', '\u8bf7\u5148\u586b\u5199\u6587\u4ef6\u540d\u5339\u914d\u89c4\u5219'))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const timestamp = new Date().toISOString()
      const nextConfig: SeriesTitleMatchConfig = {
        ...titleMatchConfig,
        createdAt: workspace.titleMatchConfig?.createdAt ?? titleMatchConfig.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      const nextWorkspace: SeriesProjectWorkspace = {
        ...workspace,
        titleMatchConfig: nextConfig,
        updatedAt: timestamp,
      }

      writeSeriesWorkspace(task.path, nextWorkspace)
      notifyProjectDataChanged()
      return JSON.stringify(ok({ config: nextConfig, workspace: hydrateSeriesWorkspace(task.path, nextWorkspace) }))
    } catch (err) {
      dialog.showErrorBox('\u4fdd\u5b58\u6807\u9898\u5339\u914d\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_TITLE_MATCH_SAVE_FAILED', '\u65e0\u6cd5\u4fdd\u5b58\u6807\u9898\u5339\u914d\u65b9\u6848', (err as Error).message),
      )
    }
  }

  async function importSeriesMatchedTorrents(msg: string) {
    try {
      const input: ImportSeriesMatchedTorrentsInput = JSON.parse(msg)
      const { projectId } = input
      const filePaths = Array.isArray(input.filePaths)
        ? [...new Set(input.filePaths.filter((filePath): filePath is string => typeof filePath === 'string').map(filePath => filePath.trim()).filter(Boolean))]
        : []

      if (!filePaths.length) {
        return JSON.stringify(fail('SERIES_MATCHED_TORRENTS_EMPTY', '\u6ca1\u6709\u9009\u62e9\u4efb\u4f55 .torrent \u6587\u4ef6'))
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const timestamp = new Date().toISOString()
      const syncedWorkspace = syncActiveVariantDraft(task.path, readSeriesWorkspace(project.id, task.path), timestamp)
      const titleMatchConfig = cloneSeriesTitleMatchConfig(syncedWorkspace.titleMatchConfig)
      if (!titleMatchConfig?.fileNamePattern) {
        return JSON.stringify(
          fail('SERIES_TITLE_MATCH_NOT_CONFIGURED', '\u8bf7\u5148\u4fdd\u5b58\u6807\u9898\u5339\u914d\u65b9\u6848\uff0c\u518d\u5bfc\u5165 .torrent \u6587\u4ef6'),
        )
      }

      const workingEpisodes = [...syncedWorkspace.episodes]
        .map(episode => ({
          ...episode,
          variants: [...episode.variants],
        }))
        .sort((left, right) => left.sortIndex - right.sortIndex)
      const existingEpisodeDirectoryNames = workingEpisodes.map(episode => episode.directoryName)
      const changedEpisodes = new Set<number>()
      const unmatchedFiles: Array<{ path: string; fileName: string; reason: string }> = []
      let createdEpisodeCount = 0
      let createdVariantCount = 0
      let updatedVariantCount = 0
      let importedCount = 0
      let nextId = Date.now()
      let activatedEpisodeId: number | undefined
      let activatedVariantId: number | undefined

      const updateEpisode = (episode: SeriesProjectEpisode) => {
        const currentIndex = workingEpisodes.findIndex(item => item.id === episode.id)
        if (currentIndex >= 0) {
          workingEpisodes.splice(currentIndex, 1, episode)
        } else {
          workingEpisodes.push(episode)
        }
        changedEpisodes.add(episode.id)
      }

      const findEpisodeByLabel = (episodeLabel: string) =>
        workingEpisodes.find(episode => normalizeVariantName(episode.episodeLabel) === normalizeVariantName(episodeLabel))

      for (const filePath of filePaths) {
        const fileName = basename(filePath)
        const matchedValues = buildTitleMatchValues(titleMatchConfig, filePath)
        if (!matchedValues) {
          unmatchedFiles.push({
            path: filePath,
            fileName,
            reason: '\u6807\u9898\u5339\u914d\u89c4\u5219\u6ca1\u6709\u547d\u4e2d\u8fd9\u4e2a\u6587\u4ef6\u540d',
          })
          continue
        }

        const episodeLabel = matchedValues.episodeLabel.trim()
        const variantName = matchedValues.variantName.trim() || stripTorrentExtension(fileName)
        if (!episodeLabel) {
          unmatchedFiles.push({
            path: filePath,
            fileName,
            reason: '\u6ca1\u6709\u4ece\u6587\u4ef6\u540d\u91cc\u89e3\u6790\u51fa\u5267\u96c6\u6807\u8bc6',
          })
          continue
        }

        let episode = findEpisodeByLabel(episodeLabel)
        if (!episode) {
          const sortIndex = workingEpisodes.length ? Math.max(...workingEpisodes.map(item => item.sortIndex)) + 1 : 0
          episode = {
            id: nextId++,
            episodeLabel,
            episodeTitle: undefined,
            sortIndex,
            directoryName: resolveEpisodeDirectoryName(episodeLabel, existingEpisodeDirectoryNames),
            variantCount: 0,
            variants: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          }
          createdEpisodeCount += 1
          updateEpisode(episode)
        }

        const variantIdentity = getVariantIdentity({
          name: variantName,
          videoProfile: matchedValues.videoProfile,
          subtitleProfile: matchedValues.subtitleProfile,
        })
        const existingVariant = episode.variants.find(variant => {
          const sameName = normalizeVariantName(variant.name) === normalizeVariantName(variantName)
          const sameIdentity =
            getVariantIdentity({
              name: variant.name,
              videoProfile: variant.videoProfile,
              subtitleProfile: variant.subtitleProfile,
            }) === variantIdentity
          return sameName || sameIdentity
        })

        if (existingVariant) {
          const variantConfigPath = getVariantConfigPath(task.path, episode, existingVariant)
          const baseConfig = fs.existsSync(variantConfigPath)
            ? readPublishConfigFromPath(variantConfigPath)
            : readPublishConfigFromPath(getDraftConfigPath(task.path))
          const nextConfig = applyTitleMatchConfigToPublishConfig(baseConfig, titleMatchConfig, matchedValues, filePath)
          fs.mkdirSync(join(variantConfigPath, '..'), { recursive: true })
          fs.writeFileSync(variantConfigPath, JSON.stringify(nextConfig))

          const nextVariant = applyVariantSummary(
            {
              ...existingVariant,
              name: variantName,
              videoProfile: matchedValues.videoProfile,
              subtitleProfile: matchedValues.subtitleProfile,
              updatedAt: timestamp,
            },
            buildVariantSummaryFromConfig(nextConfig),
          )
          episode = replaceVariant(episode, nextVariant, timestamp)
          updatedVariantCount += 1
          importedCount += 1
          updateEpisode(episode)

          if (activatedEpisodeId === undefined || activatedVariantId === undefined) {
            activatedEpisodeId = episode.id
            activatedVariantId = nextVariant.id
          }
          continue
        }

        let nextVariant = buildSeriesVariant(episode, {
          id: nextId++,
          name: variantName,
          videoProfile: matchedValues.videoProfile,
          subtitleProfile: matchedValues.subtitleProfile,
          createdAt: timestamp,
        })
        const nextConfig = applyTitleMatchConfigToPublishConfig(
          readPublishConfigFromPath(getDraftConfigPath(task.path)),
          titleMatchConfig,
          matchedValues,
          filePath,
        )
        const variantConfigPath = getVariantConfigPath(task.path, episode, nextVariant)
        fs.mkdirSync(join(variantConfigPath, '..'), { recursive: true })
        fs.writeFileSync(variantConfigPath, JSON.stringify(nextConfig))
        nextVariant = applyVariantSummary(nextVariant, buildVariantSummaryFromConfig(nextConfig))
        episode = {
          ...episode,
          variants: [...episode.variants, nextVariant],
          variantCount: episode.variants.length + 1,
          updatedAt: timestamp,
        }
        createdVariantCount += 1
        importedCount += 1
        updateEpisode(episode)

        if (activatedEpisodeId === undefined || activatedVariantId === undefined) {
          activatedEpisodeId = episode.id
          activatedVariantId = nextVariant.id
        }
      }

      const sortedEpisodes = [...workingEpisodes].sort((left, right) => left.sortIndex - right.sortIndex)
      sortedEpisodes
        .filter(episode => changedEpisodes.has(episode.id))
        .forEach(episode => writeEpisodeRecord(task.path, episode))

      const shouldActivate =
        input.activateFirst !== false && activatedEpisodeId !== undefined && activatedVariantId !== undefined
      if (shouldActivate) {
        const activatedEpisode = sortedEpisodes.find(episode => episode.id === activatedEpisodeId)
        const activatedVariant = activatedEpisode?.variants.find(variant => variant.id === activatedVariantId)
        if (activatedEpisode && activatedVariant) {
          const activatedConfigPath = getVariantConfigPath(task.path, activatedEpisode, activatedVariant)
          fs.copyFileSync(activatedConfigPath, getDraftConfigPath(task.path))
          materializeEpisodeDerivedDraftFiles(task.path, readPublishConfigFromPath(activatedConfigPath))
          replaceLegacyTaskPublishState(task, activatedVariant.publishResults)
          await projectStore.write()
        }
      }

      const nextWorkspace: SeriesProjectWorkspace = {
        ...syncedWorkspace,
        episodes: sortedEpisodes,
        activeEpisodeId: shouldActivate ? activatedEpisodeId : syncedWorkspace.activeEpisodeId,
        activeVariantId: shouldActivate ? activatedVariantId : syncedWorkspace.activeVariantId,
        updatedAt: timestamp,
      }

      writeSeriesWorkspace(task.path, nextWorkspace)
      notifyProjectDataChanged()
      return JSON.stringify(
        ok({
          workspace: hydrateSeriesWorkspace(task.path, nextWorkspace),
          importedCount,
          createdEpisodeCount,
          createdVariantCount,
          updatedVariantCount,
          unmatchedFiles,
          activated:
            shouldActivate && activatedEpisodeId && activatedVariantId
              ? {
                  episodeId: activatedEpisodeId,
                  variantId: activatedVariantId,
                }
              : undefined,
        }),
      )
    } catch (err) {
      dialog.showErrorBox('\u81ea\u52a8\u8bc6\u522b\u79cd\u5b50\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_MATCHED_TORRENT_IMPORT_FAILED', '\u81ea\u52a8\u8bc6\u522b .torrent \u6587\u4ef6\u5931\u8d25', (err as Error).message),
      )
    }
  }
  async function duplicateSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `\u5267\u96c6 ${episodeId} \u4e0d\u5b58\u5728`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `\u7248\u672c ${variantId} \u4e0d\u5b58\u5728`))
      }

      const sourceConfigPath = getVariantConfigPath(task.path, episode, variant)
      if (!fs.existsSync(sourceConfigPath)) {
        return JSON.stringify(
          fail('SERIES_VARIANT_CONFIG_NOT_FOUND', `\u7248\u672c ${variant.name} \u7684\u914d\u7f6e\u6587\u4ef6\u4e0d\u5b58\u5728`),
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
      dialog.showErrorBox('\u590d\u5236\u7248\u672c\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_DUPLICATE_FAILED', '\u65e0\u6cd5\u590d\u5236\u5f53\u524d\u7248\u672c', (err as Error).message),
      )
    }
  }

  async function removeSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `\u5267\u96c6 ${episodeId} \u4e0d\u5b58\u5728`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `\u7248\u672c ${variantId} \u4e0d\u5b58\u5728`))
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
      dialog.showErrorBox('\u5220\u9664\u7248\u672c\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_REMOVE_FAILED', '\u65e0\u6cd5\u5220\u9664\u5f53\u524d\u7248\u672c', (err as Error).message),
      )
    }
  }

  async function activateSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const timestamp = new Date().toISOString()
      let workspace = syncActiveVariantDraft(task.path, readSeriesWorkspace(project.id, task.path), timestamp)
      workspace = syncEpisodeSharedDraftAcrossVariants(task.path, workspace, timestamp)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `\u5267\u96c6 ${episodeId} \u4e0d\u5b58\u5728`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `\u7248\u672c ${variantId} \u4e0d\u5b58\u5728`))
      }

      const variantConfigPath = getVariantConfigPath(task.path, episode, variant)
      if (!fs.existsSync(variantConfigPath)) {
        return JSON.stringify(
          fail('SERIES_VARIANT_CONFIG_NOT_FOUND', `\u7248\u672c ${variant.name} \u7684\u914d\u7f6e\u6587\u4ef6\u4e0d\u5b58\u5728`),
        )
      }

      const activatedConfig = readPublishConfigFromPath(variantConfigPath)
      fs.copyFileSync(variantConfigPath, getDraftConfigPath(task.path))
      materializeEpisodeDerivedDraftFiles(task.path, activatedConfig)
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
      dialog.showErrorBox('\u5207\u6362\u7248\u672c\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_ACTIVATE_FAILED', '\u65e0\u6cd5\u5207\u6362\u5230\u5f53\u524d\u7248\u672c', (err as Error).message),
      )
    }
  }

  async function syncSeriesVariantFromDraft(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `\u5267\u96c6 ${episodeId} \u4e0d\u5b58\u5728`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `\u7248\u672c ${variantId} \u4e0d\u5b58\u5728`))
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
      dialog.showErrorBox('\u540c\u6b65\u8349\u7a3f\u5230\u7248\u672c\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_VARIANT_SYNC_FAILED',
          '\u65e0\u6cd5\u628a\u5f53\u524d\u8349\u7a3f\u540c\u6b65\u5230\u7248\u672c',
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
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${id} \u4e0d\u5b58\u5728`))
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
    const publishedLabel = '\u5df2\u53d1\u5e03'
    const publishedSites = new Set(
      (task.publishResults ?? [])
        .filter(item => item.status === 'published')
        .map(item => item.siteId),
    )

    trackedLegacyTorrentSites.forEach(siteId => {
      if (publishedSites.has(siteId) || isPublishedLink(task[siteId])) {
        result[siteId] = publishedLabel
      }
    })

    return JSON.stringify(result)
  }

  async function recordSeriesVariantPublishResult(msg: string) {
    try {
      const input: RecordSeriesVariantPublishResultInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `\u9879\u76ee ${projectId} \u4e0d\u5b58\u5728`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `\u9879\u76ee ${projectId} \u4e0d\u662f\u5267\u96c6\u9879\u76ee`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `\u5267\u96c6 ${episodeId} \u4e0d\u5b58\u5728`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `\u7248\u672c ${variantId} \u4e0d\u5b58\u5728`))
      }

      const nextResult = clonePublishResults([input.result])?.[0]
      if (!nextResult) {
        return JSON.stringify(fail('SERIES_VARIANT_RESULT_INVALID', '\u65e0\u6cd5\u8bb0\u5f55\u5f53\u524d\u7248\u672c\u7684\u53d1\u5e03\u7ed3\u679c'))
      }

      const timestamp = new Date().toISOString()
      const nextResults = [...(clonePublishResults(variant.publishResults) ?? []), nextResult]
      const nextVariant = applyVariantSummary(
        {
          ...variant,
          publishResults: nextResults,
          updatedAt: timestamp,
        },
        readVariantConfigSummary(task.path, episode, variant),
      )
      const nextEpisode = replaceVariant(episode, nextVariant, timestamp)
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      if (input.syncTaskState && workspace.activeEpisodeId === episode.id && workspace.activeVariantId === variant.id) {
        replaceLegacyTaskPublishState(task, nextResults)
        await projectStore.write()
      }

      notifyProjectDataChanged()
      return JSON.stringify(
        ok({
          episode: nextEpisode,
          variant: nextVariant,
          workspace: hydrateSeriesWorkspace(task.path, nextWorkspace),
        }),
      )
    } catch (err) {
      dialog.showErrorBox('\u8bb0\u5f55\u7248\u672c\u53d1\u5e03\u7ed3\u679c\u5931\u8d25', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_RESULT_RECORD_FAILED', '\u65e0\u6cd5\u5199\u5165\u5f53\u524d\u7248\u672c\u7684\u53d1\u5e03\u7ed3\u679c', (err as Error).message),
      )
    }
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
      dialog.showErrorBox('\u83b7\u53d6\u53d1\u5e03\u914d\u7f6e\u5931\u8d25', (err as Error).message)
      return
    }
  }

  async function saveConfig(msg: string) {
    const { id, config }: Message.Task.ModifiedConfig = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)!
    fs.writeFileSync(getDraftConfigPath(task.path), JSON.stringify(config))

    const project = projectStore.getProjectById(id)
    if (project?.projectMode === 'feature') {
      const sourceKind =
        config.sourceKind === 'quick' || config.sourceKind === 'file' || config.sourceKind === 'template'
          ? config.sourceKind
          : undefined
      projectStore.setLegacyTaskType(id, sourceKind)
      await projectStore.write()
    }

    if (project?.projectMode === 'episode') {
      materializeEpisodeDerivedDraftFiles(task.path, config)
      const workspace = readSeriesWorkspace(project.id, task.path)
      const timestamp = new Date().toISOString()
      let nextWorkspace = syncActiveVariantDraft(task.path, workspace, timestamp)
      nextWorkspace = syncEpisodeSharedDraftAcrossVariants(task.path, nextWorkspace, timestamp)
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
    getSeriesEpisodeReviewBundle,
    saveSeriesTitleMatchConfig,
    importSeriesMatchedTorrents,
    duplicateSeriesVariant,
    removeSeriesVariant,
    activateSeriesVariant,
    syncSeriesVariantFromDraft,
    recordSeriesVariantPublishResult,
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

