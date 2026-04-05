import type { ApiResult } from '../../types/api'
import type {
  CreateProjectInput,
  ImportSeriesMatchedTorrentsInput,
  ProjectDetailPayload,
  ProjectListPayload,
  ProjectRemovalPayload,
  ProjectStatsPayload,
  SaveSeriesTitleMatchConfigInput,
  SeriesEpisodePayload,
  SeriesMatchedTorrentImportPayload,
  SeriesTitleMatchConfigPayload,
  SeriesVariantDraftInput,
  SeriesVariantPayload,
  SeriesWorkspacePayload,
} from '../../types/project'
import type { PublishResult } from '../../types/publish'

export interface SeriesEpisodeReviewVariantPayload {
  variant: import('../../types/project').SeriesProjectVariant
  config: Config.PublishConfig
  isActive: boolean
}

export interface SeriesEpisodeReviewPayload {
  episode: import('../../types/project').SeriesProjectEpisode
  variants: SeriesEpisodeReviewVariantPayload[]
  workspace: import('../../types/project').SeriesProjectWorkspace
}

export interface RecordSeriesVariantPublishResultInput {
  projectId: number
  episodeId: number
  variantId: number
  result: PublishResult
  syncTaskState?: boolean
}

async function parseResult<T>(promise: Promise<string>): Promise<ApiResult<T>> {
  return JSON.parse(await promise) as ApiResult<T>
}

export const projectBridge = {
  createProject(input: CreateProjectInput) {
    return parseResult<ProjectDetailPayload>(window.projectAPI.createProject(JSON.stringify(input)))
  },

  listProjects() {
    return parseResult<ProjectListPayload>(window.projectAPI.listProjects())
  },

  getProject(id: number) {
    return parseResult<ProjectDetailPayload>(window.projectAPI.getProject(JSON.stringify({ id })))
  },

  getSeriesWorkspace(projectId: number) {
    return parseResult<SeriesWorkspacePayload>(window.projectAPI.getSeriesWorkspace(JSON.stringify({ id: projectId })))
  },

  getSeriesEpisodeReviewBundle(projectId: number) {
    return parseResult<SeriesEpisodeReviewPayload>(
      window.projectAPI.getSeriesEpisodeReviewBundle(JSON.stringify({ id: projectId })),
    )
  },

  saveSeriesTitleMatchConfig(input: SaveSeriesTitleMatchConfigInput) {
    return parseResult<SeriesTitleMatchConfigPayload>(window.projectAPI.saveSeriesTitleMatchConfig(JSON.stringify(input)))
  },

  importSeriesMatchedTorrents(input: ImportSeriesMatchedTorrentsInput) {
    return parseResult<SeriesMatchedTorrentImportPayload>(
      window.projectAPI.importSeriesMatchedTorrents(JSON.stringify(input)),
    )
  },

  duplicateSeriesVariant(input: SeriesVariantDraftInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.duplicateSeriesVariant(JSON.stringify(input)))
  },

  removeSeriesVariant(input: SeriesVariantDraftInput) {
    return parseResult<SeriesEpisodePayload>(window.projectAPI.removeSeriesVariant(JSON.stringify(input)))
  },

  activateSeriesVariant(input: SeriesVariantDraftInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.activateSeriesVariant(JSON.stringify(input)))
  },

  syncSeriesVariantFromDraft(input: SeriesVariantDraftInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.syncSeriesVariantFromDraft(JSON.stringify(input)))
  },

  recordSeriesVariantPublishResult(input: RecordSeriesVariantPublishResultInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.recordSeriesVariantPublishResult(JSON.stringify(input)))
  },

  getProjectStats() {
    return parseResult<ProjectStatsPayload>(window.projectAPI.getProjectStats())
  },

  removeProject(id: number) {
    return parseResult<ProjectRemovalPayload>(window.projectAPI.removeProject(JSON.stringify({ id })))
  },
}
