import type { ApiResult } from '../../types/api'
import type {
  BatchCreateSeriesVariantsInput,
  CreateProjectInput,
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  InheritSeriesEpisodeVariantsInput,
  ImportSeriesPublishProfileInput,
  ProjectDetailPayload,
  ProjectListPayload,
  ProjectRemovalPayload,
  ProjectStatsPayload,
  RemoveSeriesPublishProfileInput,
  SaveSeriesPublishProfileInput,
  SaveSeriesWorkspaceSettingsInput,
  SeriesEpisodeInheritancePayload,
  SeriesEpisodeVariantBatchPayload,
  SeriesEpisodePayload,
  SeriesPublishProfileExportPayload,
  SeriesPublishProfilePayload,
  SeriesPublishProfileRemovalPayload,
  SeriesVariantDraftInput,
  SeriesVariantPayload,
  SeriesWorkspaceSettingsPayload,
  SeriesWorkspacePayload,
  ExportSeriesPublishProfileInput,
} from '../../types/project'

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

  saveSeriesWorkspaceSettings(input: SaveSeriesWorkspaceSettingsInput) {
    return parseResult<SeriesWorkspaceSettingsPayload>(window.projectAPI.saveSeriesWorkspaceSettings(JSON.stringify(input)))
  },

  createSeriesEpisode(input: CreateSeriesEpisodeInput) {
    return parseResult<SeriesEpisodePayload>(window.projectAPI.createSeriesEpisode(JSON.stringify(input)))
  },

  createSeriesVariant(input: CreateSeriesVariantInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.createSeriesVariant(JSON.stringify(input)))
  },

  batchCreateSeriesVariants(input: BatchCreateSeriesVariantsInput) {
    return parseResult<SeriesEpisodeVariantBatchPayload>(
      window.projectAPI.batchCreateSeriesVariants(JSON.stringify(input)),
    )
  },

  saveSeriesPublishProfile(input: SaveSeriesPublishProfileInput) {
    return parseResult<SeriesPublishProfilePayload>(
      window.projectAPI.saveSeriesPublishProfile(JSON.stringify(input)),
    )
  },

  importSeriesPublishProfile(input: ImportSeriesPublishProfileInput) {
    return parseResult<SeriesPublishProfilePayload>(
      window.projectAPI.importSeriesPublishProfile(JSON.stringify(input)),
    )
  },

  exportSeriesPublishProfile(input: ExportSeriesPublishProfileInput) {
    return parseResult<SeriesPublishProfileExportPayload>(
      window.projectAPI.exportSeriesPublishProfile(JSON.stringify(input)),
    )
  },

  removeSeriesPublishProfile(input: RemoveSeriesPublishProfileInput) {
    return parseResult<SeriesPublishProfileRemovalPayload>(
      window.projectAPI.removeSeriesPublishProfile(JSON.stringify(input)),
    )
  },

  inheritSeriesEpisodeVariants(input: InheritSeriesEpisodeVariantsInput) {
    return parseResult<SeriesEpisodeInheritancePayload>(
      window.projectAPI.inheritSeriesEpisodeVariants(JSON.stringify(input)),
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

  getProjectStats() {
    return parseResult<ProjectStatsPayload>(window.projectAPI.getProjectStats())
  },

  removeProject(id: number) {
    return parseResult<ProjectRemovalPayload>(window.projectAPI.removeProject(JSON.stringify({ id })))
  },
}
