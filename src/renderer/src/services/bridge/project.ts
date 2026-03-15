import type { ApiResult } from '../../types/api'
import type {
  CreateProjectInput,
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  InheritSeriesEpisodeVariantsInput,
  ProjectDetailPayload,
  ProjectListPayload,
  ProjectRemovalPayload,
  ProjectStatsPayload,
  SeriesEpisodeInheritancePayload,
  SeriesEpisodePayload,
  SeriesVariantDraftInput,
  SeriesVariantPayload,
  SeriesWorkspacePayload,
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

  createSeriesEpisode(input: CreateSeriesEpisodeInput) {
    return parseResult<SeriesEpisodePayload>(window.projectAPI.createSeriesEpisode(JSON.stringify(input)))
  },

  createSeriesVariant(input: CreateSeriesVariantInput) {
    return parseResult<SeriesVariantPayload>(window.projectAPI.createSeriesVariant(JSON.stringify(input)))
  },

  inheritSeriesEpisodeVariants(input: InheritSeriesEpisodeVariantsInput) {
    return parseResult<SeriesEpisodeInheritancePayload>(
      window.projectAPI.inheritSeriesEpisodeVariants(JSON.stringify(input)),
    )
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
