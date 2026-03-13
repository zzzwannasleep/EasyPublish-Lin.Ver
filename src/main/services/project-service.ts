import { app, dialog } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { CreateProjectInput } from '../../shared/types/project'
import { getNowFormatDate } from '../core/utils'
import { createProjectStore } from '../storage/project-store'

type ProjectChangeHandler = () => void

interface CreateProjectServiceOptions {
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged: ProjectChangeHandler
}

export function createProjectService(options: CreateProjectServiceOptions) {
  const { projectStore, notifyProjectDataChanged } = options

  function buildInitialContent(type: CreateProjectInput['sourceKind']) {
    return type === 'template'
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

  function buildInitialPublishConfig(type: CreateProjectInput['sourceKind']): Config.PublishConfig {
    return {
      title: '',
      category_bangumi: '',
      category_nyaa: '',
      information: 'https://vcb-s.com/archives/138',
      tags: [],
      torrentName: '',
      torrentPath: '',
      content: buildInitialContent(type),
    }
  }

  async function createProjectRecord(input: CreateProjectInput) {
    let { workingDirectory, name, sourceKind } = input

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
    fs.writeFileSync(join(projectPath, 'config.json'), JSON.stringify(buildInitialPublishConfig(sourceKind)))

    const id = Date.now()
    projectStore.insertLegacyTask({
      id,
      type: sourceKind,
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
        sourceKind: type,
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

  function getProjectStats() {
    return JSON.stringify(ok({ stats: projectStore.getProjectStats() }))
  }

  function getTaskList() {
    const result: Message.Task.TaskList = { list: projectStore.getLegacyTaskList() }
    return JSON.stringify(result)
  }

  function getTaskType(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const type = projectStore.getLegacyTaskType(id)!
    const result: Message.Task.TaskType = { type }
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
    fs.writeFileSync(join(task.path, 'config.json'), JSON.stringify(config))
    const result: Message.Task.Result = { result: 'success' }
    return JSON.stringify(result)
  }

  return {
    createProject,
    createTask,
    listProjects,
    getProject,
    getProjectStats,
    removeProject,
    getTaskList,
    getTaskType,
    removeTask,
    getForumLink,
    setTaskProcess,
    getPublishStatus,
    getPublishConfig,
    saveConfig,
  }
}
