import fs from 'fs'
import { join } from 'path'
import { Low } from 'lowdb'
import type {
  ProjectSourceKind,
  ProjectStage,
  ProjectStats,
  ProjectStatus,
  PublishProject,
} from '../../shared/types/project'
import type { PublishResult } from '../../shared/types/publish'
import type { SiteId } from '../../shared/types/site'

type TaskDbProvider = () => Low<Config.TaskData>

interface CreateProjectStoreOptions {
  getTaskDB: TaskDbProvider
}

const torrentSites: Exclude<SiteId, 'forum'>[] = [
  'bangumi',
  'nyaa',
  'acgrip',
  'dmhy',
  'acgnx_a',
  'acgnx_g',
]

function createEmptyStageStats(): Record<ProjectStage, number> {
  return {
    edit: 0,
    review: 0,
    torrent_publish: 0,
    forum_publish: 0,
    completed: 0,
  }
}

function createEmptySourceStats(): Record<ProjectSourceKind, number> {
  return {
    quick: 0,
    file: 0,
    template: 0,
  }
}

function mapLegacyStage(step: Config.Task['step']): ProjectStage {
  if (step === 'check') return 'review'
  if (step === 'bt_publish') return 'torrent_publish'
  if (step === 'forum_publish') return 'forum_publish'
  if (step === 'finish') return 'completed'
  return 'edit'
}

function mapLegacyStatus(status: Config.Task['status']): ProjectStatus {
  return status === 'published' ? 'published' : 'publishing'
}

function getTimestamp(task: Config.Task, filePath?: string) {
  try {
    const targetPath = filePath && fs.existsSync(filePath) ? filePath : task.path
    return fs.statSync(targetPath).mtime.toISOString()
  } catch {
    return new Date(task.id).toISOString()
  }
}

function buildSiteLinks(task: Config.Task): Partial<Record<SiteId, string>> {
  return {
    bangumi: task.bangumi,
    nyaa: task.nyaa,
    acgrip: task.acgrip,
    dmhy: task.dmhy,
    acgnx_a: task.acgnx_a,
    acgnx_g: task.acgnx_g,
  }
}

function buildLegacyPublishResults(task: Config.Task, updatedAt: string): PublishResult[] {
  const siteLinks = buildSiteLinks(task)
  const results: PublishResult[] = []

  torrentSites.forEach(siteId => {
    const remoteUrl = siteLinks[siteId]
    if (remoteUrl) {
      results.push({
        siteId,
        status: 'published',
        remoteUrl,
        timestamp: updatedAt,
      })
    }
  })

  if (task.forumLink) {
    results.push({
      siteId: 'forum',
      status: 'published',
      remoteUrl: task.forumLink,
      timestamp: updatedAt,
    })
  }

  return results
}

function buildStoredPublishResults(task: Config.Task, fallbackTimestamp: string): PublishResult[] {
  return (task.publishResults ?? []).map(result => ({
    siteId: result.siteId,
    status: result.status,
    remoteId: result.remoteId,
    remoteUrl: result.remoteUrl,
    message: result.message,
    rawResponse: result.rawResponse,
    timestamp: result.timestamp ?? fallbackTimestamp,
  }))
}

function getPublishResultTimestampValue(result: PublishResult) {
  if (!result.timestamp) {
    return 0
  }

  const value = new Date(result.timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

function hasEquivalentPublishResult(left: PublishResult, right: PublishResult) {
  if (left.siteId !== right.siteId || left.status !== right.status) {
    return false
  }

  if (left.remoteUrl && right.remoteUrl) {
    return left.remoteUrl === right.remoteUrl
  }

  if (left.remoteId && right.remoteId) {
    return left.remoteId === right.remoteId
  }

  return (
    left.remoteId === right.remoteId &&
    left.remoteUrl === right.remoteUrl &&
    left.message === right.message
  )
}

function buildProjectPublishResults(task: Config.Task, updatedAt: string): PublishResult[] {
  const storedResults = buildStoredPublishResults(task, updatedAt)
  const legacyResults = buildLegacyPublishResults(task, updatedAt).filter(
    legacyResult => !storedResults.some(storedResult => hasEquivalentPublishResult(storedResult, legacyResult)),
  )

  return [...storedResults, ...legacyResults].sort(
    (left, right) => getPublishResultTimestampValue(right) - getPublishResultTimestampValue(left),
  )
}

function mapTaskToProject(task: Config.Task): PublishProject {
  const configPath = join(task.path, 'config.json')
  const createdAt = new Date(task.id).toISOString()
  const updatedAt = getTimestamp(task, configPath)
  const publishResults = buildProjectPublishResults(task, updatedAt)
  const siteLinks = buildSiteLinks(task)
  const targetSites = [...new Set(publishResults.map(item => item.siteId))]

  return {
    id: task.id,
    name: task.name,
    workingDirectory: task.path,
    sourceKind: task.type,
    status: mapLegacyStatus(task.status),
    stage: mapLegacyStage(task.step),
    syncEnabled: task.sync,
    siteLinks,
    forumLink: task.forumLink,
    targetSites,
    publishResults,
    configPath,
    createdAt,
    updatedAt,
  }
}

export function createProjectStore(options: CreateProjectStoreOptions) {
  const { getTaskDB } = options

  function getTaskDBOrThrow() {
    const taskDB = getTaskDB()
    if (!taskDB) {
      throw new Error('Task DB is not initialized')
    }
    return taskDB
  }

  function getLegacyTaskList() {
    return getTaskDBOrThrow().data.tasks
  }

  function findLegacyTaskById(id: number) {
    return getTaskDBOrThrow().data.tasks.find(item => item.id === id)
  }

  function listProjects() {
    return [...getLegacyTaskList()].map(mapTaskToProject).sort((a, b) => b.id - a.id)
  }

  function getProjectById(id: number) {
    const task = findLegacyTaskById(id)
    return task ? mapTaskToProject(task) : undefined
  }

  function insertLegacyTask(task: Config.Task) {
    const taskDB = getTaskDBOrThrow()
    taskDB.data.tasks.push(task)
    return task
  }

  async function write() {
    await getTaskDBOrThrow().write()
  }

  function removeLegacyTask(id: number) {
    const taskDB = getTaskDBOrThrow()
    taskDB.data.tasks = taskDB.data.tasks.filter(item => item.id !== id)
  }

  function getLegacyTaskType(id: number) {
    return findLegacyTaskById(id)?.type
  }

  function setLegacyTaskStep(id: number, step: Config.Task['step']) {
    const task = findLegacyTaskById(id)
    if (!task) {
      throw new Error(`Project ${id} does not exist`)
    }
    task.step = step
    if (step === 'finish') {
      task.status = 'published'
    }
  }

  function setForumLink(id: number, link: string) {
    const task = findLegacyTaskById(id)
    if (!task) {
      throw new Error(`Project ${id} does not exist`)
    }
    task.forumLink = link
  }

  function setSiteLink(id: number, siteId: Exclude<SiteId, 'forum'>, remoteUrl: string) {
    const task = findLegacyTaskById(id)
    if (!task) {
      throw new Error(`Project ${id} does not exist`)
    }
    task[siteId] = remoteUrl
  }

  function recordPublishResult(id: number, result: PublishResult) {
    const task = findLegacyTaskById(id)
    if (!task) {
      throw new Error(`Project ${id} does not exist`)
    }

    const nextResult: PublishResult = {
      siteId: result.siteId,
      status: result.status,
      remoteId: result.remoteId,
      remoteUrl: result.remoteUrl,
      message: result.message,
      rawResponse: result.rawResponse,
      timestamp: result.timestamp ?? new Date().toISOString(),
    }

    task.publishResults = [...(task.publishResults ?? []), nextResult]

    if (nextResult.status === 'published' && nextResult.remoteUrl) {
      if (nextResult.siteId === 'forum') {
        task.forumLink = nextResult.remoteUrl
      } else {
        const siteId = nextResult.siteId as Exclude<SiteId, 'forum'>
        task[siteId] = nextResult.remoteUrl
      }
    }
  }

  function getProjectStats(): ProjectStats {
    const projects = listProjects()
    const byStage = createEmptyStageStats()
    const bySourceKind = createEmptySourceStats()
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    projects.forEach(project => {
      byStage[project.stage] += 1
      bySourceKind[project.sourceKind] += 1
    })

    return {
      total: projects.length,
      active: projects.filter(project => project.status !== 'published').length,
      published: projects.filter(project => project.status === 'published').length,
      recent: projects.filter(project => project.id >= sevenDaysAgo).length,
      byStage,
      bySourceKind,
    }
  }

  return {
    getLegacyTaskList,
    findLegacyTaskById,
    listProjects,
    getProjectById,
    insertLegacyTask,
    write,
    removeLegacyTask,
    getLegacyTaskType,
    setLegacyTaskStep,
    setForumLink,
    setSiteLink,
    recordPublishResult,
    getProjectStats,
  }
}
