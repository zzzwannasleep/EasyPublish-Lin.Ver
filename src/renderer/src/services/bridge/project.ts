import type { ApiResult } from '../../types/api'
import type {
  CreateProjectInput,
  ProjectDetailPayload,
  ProjectListPayload,
  ProjectRemovalPayload,
  ProjectStatsPayload,
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

  getProjectStats() {
    return parseResult<ProjectStatsPayload>(window.projectAPI.getProjectStats())
  },

  removeProject(id: number) {
    return parseResult<ProjectRemovalPayload>(window.projectAPI.removeProject(JSON.stringify({ id })))
  },
}

