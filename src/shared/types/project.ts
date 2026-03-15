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

export interface SeriesProjectVariant {
  id: number
  name: string
  directoryName: string
  videoProfile?: SeriesVariantVideoProfile
  subtitleProfile?: SeriesVariantSubtitleProfile
  createdAt: string
  updatedAt: string
}

export interface SeriesProjectWorkspace {
  projectId: number
  episodes: SeriesProjectEpisode[]
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
