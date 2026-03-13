import type { PublishResult } from './publish'
import type { SiteId } from './site'

export type ProjectSourceKind = 'quick' | 'file' | 'template'
export type ProjectStatus = 'draft' | 'publishing' | 'published'
export type ProjectStage = 'edit' | 'review' | 'torrent_publish' | 'forum_publish' | 'completed'

export interface CreateProjectInput {
  name: string
  workingDirectory: string
  sourceKind: ProjectSourceKind
}

export interface PublishProject {
  id: number
  name: string
  workingDirectory: string
  sourceKind: ProjectSourceKind
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

export interface ProjectStats {
  total: number
  active: number
  published: number
  recent: number
  byStage: Record<ProjectStage, number>
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

