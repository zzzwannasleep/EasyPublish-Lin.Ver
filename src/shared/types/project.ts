import type { PublishResult } from './publish'
import type { SiteId } from './site'

export type ProjectMode = 'episode' | 'feature'
export type ProjectSourceKind = 'quick' | 'file' | 'template'
export type LegacyProjectType = ProjectSourceKind | 'episode'
export type ProjectStatus = 'draft' | 'publishing' | 'published'
export type ProjectStage = 'edit' | 'review' | 'torrent_publish' | 'forum_publish' | 'completed'

export interface CreateProjectInput {
  name: string
  workingDirectory: string
  projectMode: ProjectMode
  sourceKind?: ProjectSourceKind
}

export interface PublishProject {
  id: number
  name: string
  workingDirectory: string
  projectMode: ProjectMode
  sourceKind?: ProjectSourceKind
  status: ProjectStatus
  stage: ProjectStage
  syncEnabled: boolean
  siteLinks: Partial<Record<SiteId, string>>
  forumLink?: string
  targetSites: SiteId[]
  publishResults: PublishResult[]
  configPath: string
  createdAt: string
  updatedAt: string
}

export interface SeriesProjectEpisode {
  id: number
  episodeLabel: string
  episodeTitle?: string
  sortIndex: number
  directoryName: string
  variantCount: number
  variants: SeriesProjectVariant[]
  createdAt: string
  updatedAt: string
}

export type SeriesVariantVideoProfile = '1080p' | '2160p' | 'custom'
export type SeriesVariantSubtitleProfile = 'chs' | 'cht' | 'eng' | 'bilingual' | 'custom'
export type SeriesVariantTemplateVideoProfile = Exclude<SeriesVariantVideoProfile, 'custom'>
export type SeriesVariantTemplateSubtitleProfile = Exclude<SeriesVariantSubtitleProfile, 'custom'>

export interface SeriesProjectVariant {
  id: number
  name: string
  directoryName: string
  videoProfile?: SeriesVariantVideoProfile
  subtitleProfile?: SeriesVariantSubtitleProfile
  publishProfileId?: number
  publishProfileName?: string
  publishProfileSnapshot?: SeriesPublishProfileSnapshot
  publishResults?: PublishResult[]
  targetSites?: SiteId[]
  title?: string
  createdAt: string
  updatedAt: string
}

export type SeriesPublishProfileVideoProfile = SeriesVariantTemplateVideoProfile
export type SeriesPublishProfileSubtitleProfile = SeriesVariantTemplateSubtitleProfile
export type SeriesPublishProfileSiteFieldDefaults = Partial<Record<SiteId, Record<string, unknown>>>

export interface SeriesPublishProfileTemplateContext {
  title?: string
  summary?: string
  releaseTeam?: string
  seriesLabel?: string
  seriesTitleCN?: string
  seriesTitleEN?: string
  seriesTitleJP?: string
  seasonLabel?: string
  techLabel?: string
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
  variantName?: string
  videoProfile?: string
  subtitleProfile?: string
  subtitleProfileLabel?: string
}

export interface SeriesPublishProfileSiteDraft {
  enabled: boolean
  useGlobalTitle?: boolean
  titleTemplate?: string
  summaryTemplate?: string
  note?: string
}

export type SeriesPublishProfileSiteDrafts = Partial<Record<SiteId, SeriesPublishProfileSiteDraft>>

export interface SeriesPublishProfile {
  id: number
  name: string
  isDefault?: boolean
  videoProfiles: SeriesPublishProfileVideoProfile[]
  subtitleProfiles: SeriesPublishProfileSubtitleProfile[]
  templateContext?: SeriesPublishProfileTemplateContext
  targetSites?: SiteId[]
  titleTemplate?: string
  summaryTemplate?: string
  siteDrafts?: SeriesPublishProfileSiteDrafts
  siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
  createdAt: string
  updatedAt: string
}

export interface SeriesPublishProfileSnapshot {
  name: string
  videoProfiles: SeriesVariantVideoProfile[]
  subtitleProfiles: SeriesVariantSubtitleProfile[]
  templateContext?: SeriesPublishProfileTemplateContext
  targetSites?: SiteId[]
  titleTemplate?: string
  summaryTemplate?: string
  siteDrafts?: SeriesPublishProfileSiteDrafts
  siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
}

export type SeriesVariantTemplate = SeriesPublishProfile

export interface SeriesProjectWorkspace {
  projectId: number
  episodes: SeriesProjectEpisode[]
  publishProfiles: SeriesPublishProfile[]
  variantTemplates?: SeriesVariantTemplate[]
  projectSiteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
  activeEpisodeId?: number
  activeVariantId?: number
  createdAt: string
  updatedAt: string
}

export interface CreateSeriesEpisodeInput {
  projectId: number
  episodeLabel: string
  episodeTitle?: string
}

export interface CreateSeriesVariantInput {
  projectId: number
  episodeId: number
  name?: string
  videoProfile?: SeriesVariantVideoProfile
  subtitleProfile?: SeriesVariantSubtitleProfile
  publishProfileId?: number
  targetSites?: SiteId[]
  titleTemplate?: string
  summaryTemplate?: string
}

export interface SeriesVariantDraftInput {
  projectId: number
  episodeId: number
  variantId: number
}

export interface InheritSeriesEpisodeVariantsInput {
  projectId: number
  episodeId: number
}

export interface BatchCreateSeriesVariantsInput {
  projectId: number
  episodeId: number
  publishProfileId?: number
  videoProfiles: SeriesVariantTemplateVideoProfile[]
  subtitleProfiles: SeriesVariantTemplateSubtitleProfile[]
  targetSites?: SiteId[]
  titleTemplate?: string
  summaryTemplate?: string
}

export interface SaveSeriesPublishProfileInput {
  projectId: number
  profileId?: number
  name: string
  isDefault?: boolean
  videoProfiles: SeriesVariantTemplateVideoProfile[]
  subtitleProfiles: SeriesVariantTemplateSubtitleProfile[]
  templateContext?: SeriesPublishProfileTemplateContext
  targetSites?: SiteId[]
  titleTemplate?: string
  summaryTemplate?: string
  siteDrafts?: SeriesPublishProfileSiteDrafts
  siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
}

export interface RemoveSeriesPublishProfileInput {
  projectId: number
  profileId: number
}

export type SaveSeriesVariantTemplateInput = SaveSeriesPublishProfileInput
export type RemoveSeriesVariantTemplateInput = RemoveSeriesPublishProfileInput

export interface ProjectStats {
  total: number
  active: number
  published: number
  recent: number
  byStage: Record<ProjectStage, number>
  byMode: Record<ProjectMode, number>
  bySourceKind: Record<ProjectSourceKind, number>
}

export interface ProjectListPayload {
  projects: PublishProject[]
}

export interface ProjectDetailPayload {
  project: PublishProject
}

export interface ProjectStatsPayload {
  stats: ProjectStats
}

export interface ProjectRemovalPayload {
  id: number
}

export interface SeriesWorkspacePayload {
  workspace: SeriesProjectWorkspace
}

export interface SeriesEpisodePayload {
  episode: SeriesProjectEpisode
  workspace: SeriesProjectWorkspace
}

export interface SeriesVariantPayload {
  episode: SeriesProjectEpisode
  variant: SeriesProjectVariant
  workspace: SeriesProjectWorkspace
}

export interface SeriesEpisodeInheritancePayload {
  episode: SeriesProjectEpisode
  workspace: SeriesProjectWorkspace
  copiedCount: number
}

export interface SeriesEpisodeVariantBatchPayload {
  episode: SeriesProjectEpisode
  workspace: SeriesProjectWorkspace
  createdCount: number
  skippedCount: number
}

export interface SeriesPublishProfilePayload {
  profile: SeriesPublishProfile
  workspace: SeriesProjectWorkspace
}

export interface SeriesPublishProfileRemovalPayload {
  profileId: number
  workspace: SeriesProjectWorkspace
}

export type SeriesVariantTemplatePayload = SeriesPublishProfilePayload
export type SeriesVariantTemplateRemovalPayload = SeriesPublishProfileRemovalPayload
