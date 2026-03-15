import { app, dialog } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type {
  CreateProjectInput,
  CreateSeriesEpisodeInput,
  CreateSeriesVariantInput,
  InheritSeriesEpisodeVariantsInput,
  LegacyProjectType,
  ProjectMode,
  ProjectSourceKind,
  SeriesProjectEpisode,
  SeriesProjectVariant,
  SeriesVariantSubtitleProfile,
  SeriesVariantVideoProfile,
  SeriesProjectWorkspace,
  SeriesVariantDraftInput,
} from '../../shared/types/project'
import type { SiteId } from '../../shared/types/site'
import { getNowFormatDate } from '../core/utils'
import { createProjectStore } from '../storage/project-store'

type ProjectChangeHandler = () => void

interface CreateProjectServiceOptions {
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged: ProjectChangeHandler
}

export function createProjectService(options: CreateProjectServiceOptions) {
  const { projectStore, notifyProjectDataChanged } = options
  const defaultEpisodeSites: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa']
  const supportedVideoProfiles: SeriesVariantVideoProfile[] = ['1080p', '2160p', 'custom']
  const supportedSubtitleProfiles: SeriesVariantSubtitleProfile[] = ['chs', 'cht', 'eng', 'bilingual', 'custom']
  const seriesWorkspaceFileName = 'series-workspace.json'
  const episodesDirectoryName = 'episodes'
  const variantsDirectoryName = 'variants'

  function getSeriesWorkspacePath(projectPath: string) {
    return join(projectPath, seriesWorkspaceFileName)
  }

  function createDefaultSeriesWorkspace(projectId: number): SeriesProjectWorkspace {
    const timestamp = new Date(projectId).toISOString()
    return {
      projectId,
      episodes: [],
      activeEpisodeId: undefined,
      activeVariantId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  function readSeriesWorkspace(projectId: number, projectPath: string): SeriesProjectWorkspace {
    const workspacePath = getSeriesWorkspacePath(projectPath)
    try {
      if (!fs.existsSync(workspacePath)) {
        return createDefaultSeriesWorkspace(projectId)
      }

      const parsed = JSON.parse(fs.readFileSync(workspacePath, { encoding: 'utf-8' })) as Partial<SeriesProjectWorkspace>
      const episodes = Array.isArray(parsed.episodes)
        ? parsed.episodes
            .filter((episode): episode is SeriesProjectEpisode => {
              return typeof episode === 'object' && episode !== null && typeof episode.id === 'number'
            })
            .map(episode => ({
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
              variants: Array.isArray(episode.variants)
                ? episode.variants
                    .filter((variant): variant is SeriesProjectVariant => {
                      return typeof variant === 'object' && variant !== null && typeof variant.id === 'number'
                    })
                    .map(variant => ({
                      id: variant.id,
                      name: variant.name ?? '',
                      directoryName: variant.directoryName ?? '',
                      videoProfile: supportedVideoProfiles.includes(variant.videoProfile as SeriesVariantVideoProfile)
                        ? (variant.videoProfile as SeriesVariantVideoProfile)
                        : undefined,
                      subtitleProfile: supportedSubtitleProfiles.includes(
                        variant.subtitleProfile as SeriesVariantSubtitleProfile,
                      )
                        ? (variant.subtitleProfile as SeriesVariantSubtitleProfile)
                        : undefined,
                      createdAt: variant.createdAt ?? new Date(variant.id).toISOString(),
                      updatedAt: variant.updatedAt ?? new Date(variant.id).toISOString(),
                    }))
                : [],
              createdAt: episode.createdAt ?? new Date(episode.id).toISOString(),
              updatedAt: episode.updatedAt ?? new Date(episode.id).toISOString(),
            }))
            .sort((left, right) => left.sortIndex - right.sortIndex)
        : []

      return {
        projectId,
        episodes,
        activeEpisodeId:
          typeof parsed.activeEpisodeId === 'number' ? parsed.activeEpisodeId : undefined,
        activeVariantId:
          typeof parsed.activeVariantId === 'number' ? parsed.activeVariantId : undefined,
        createdAt: parsed.createdAt ?? new Date(projectId).toISOString(),
        updatedAt: parsed.updatedAt ?? parsed.createdAt ?? new Date(projectId).toISOString(),
      }
    } catch {
      return createDefaultSeriesWorkspace(projectId)
    }
  }

  function writeSeriesWorkspace(projectPath: string, workspace: SeriesProjectWorkspace) {
    const workspacePath = getSeriesWorkspacePath(projectPath)
    fs.writeFileSync(workspacePath, JSON.stringify(workspace, null, 2))
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

  function getVariantPresetName(
    videoProfile?: SeriesVariantVideoProfile,
    subtitleProfile?: SeriesVariantSubtitleProfile,
  ) {
    if (!videoProfile || !subtitleProfile || videoProfile === 'custom' || subtitleProfile === 'custom') {
      return ''
    }

    const subtitleLabelMap: Record<Exclude<SeriesVariantSubtitleProfile, 'custom'>, string> = {
      chs: 'CHS',
      cht: 'CHT',
      eng: 'ENG',
      bilingual: 'bilingual',
    }

    return `${videoProfile}-${subtitleLabelMap[subtitleProfile]}`
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

  function resolveVariantName({
    name,
    videoProfile,
    subtitleProfile,
  }: {
    name?: string
    videoProfile?: SeriesVariantVideoProfile
    subtitleProfile?: SeriesVariantSubtitleProfile
  }) {
    const trimmedName = name?.trim() ?? ''
    if (trimmedName) {
      return trimmedName
    }

    return getVariantPresetName(videoProfile, subtitleProfile)
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

    const nextVariant: SeriesProjectVariant = {
      ...variant,
      updatedAt,
    }
    const nextEpisode = replaceVariant(episode, nextVariant, updatedAt)
    writeEpisodeRecord(projectPath, nextEpisode)

    return {
      ...replaceEpisode(workspace, nextEpisode),
      updatedAt,
    }
  }

  function findPreviousEpisode(workspace: SeriesProjectWorkspace, episodeId: number) {
    const sortedEpisodes = [...workspace.episodes].sort((left, right) => left.sortIndex - right.sortIndex)
    const episodeIndex = sortedEpisodes.findIndex(episode => episode.id === episodeId)
    if (episodeIndex <= 0) {
      return null
    }

    return sortedEpisodes[episodeIndex - 1] ?? null
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
        releaseTeam: 'VCB-Studio',
        sourceType: 'WebRip',
        resolution: '1080p',
        videoCodec: 'HEVC',
        audioCodec: 'AAC',
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
    return {
      title: '',
      category_bangumi: projectMode === 'episode' ? '549ef207fe682f7549f1ea90' : '',
      category_nyaa: projectMode === 'episode' ? '1_3' : '',
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

    if (projectMode === 'feature' && !sourceKind) {
      return fail('PROJECT_SOURCE_KIND_REQUIRED', 'Feature projects must include a source kind')
    }

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
    fs.writeFileSync(join(projectPath, 'config.json'), JSON.stringify(buildInitialPublishConfig(input)))

    const id = Date.now()
    if (projectMode === 'episode') {
      writeSeriesWorkspace(projectPath, createDefaultSeriesWorkspace(id))
    }
    const legacyType: LegacyProjectType = projectMode === 'episode' ? 'episode' : sourceKind!
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

  function getSeriesWorkspace(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = projectStore.findLegacyTaskById(id)
    if (!task) {
      return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${id} does not exist`))
    }

    const project = projectStore.getProjectById(id)
    if (!project || project.projectMode !== 'episode') {
      return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${id} is not in series mode`))
    }

    return JSON.stringify(ok({ workspace: readSeriesWorkspace(project.id, task.path) }))
  }

  async function createSeriesEpisode(msg: string) {
    try {
      const input: CreateSeriesEpisodeInput = JSON.parse(msg)
      const { projectId } = input
      const episodeLabel = input.episodeLabel.trim()
      const episodeTitle = input.episodeTitle?.trim() || undefined

      if (!episodeLabel) {
        return JSON.stringify(fail('SERIES_EPISODE_LABEL_REQUIRED', 'Episode label is required'))
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      if (workspace.episodes.some(episode => episode.episodeLabel === episodeLabel)) {
        return JSON.stringify(fail('SERIES_EPISODE_DUPLICATED', `Episode ${episodeLabel} already exists`))
      }

      const timestamp = new Date().toISOString()
      const episodeId = Date.now()
      const directoryName = resolveEpisodeDirectoryName(
        episodeLabel,
        workspace.episodes.map(episode => episode.directoryName),
      )
      const episode: SeriesProjectEpisode = {
        id: episodeId,
        episodeLabel,
        episodeTitle,
        sortIndex: workspace.episodes.length,
        directoryName,
        variantCount: 0,
        variants: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      writeEpisodeRecord(task.path, episode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...workspace,
        episodes: [...workspace.episodes, episode].sort((left, right) => left.sortIndex - right.sortIndex),
        activeEpisodeId: workspace.activeEpisodeId ?? episode.id,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode, workspace: nextWorkspace }))
    } catch (err) {
      dialog.showErrorBox('闂佹寧鐟ㄩ?', (err as Error).message)
      return JSON.stringify(fail('SERIES_EPISODE_CREATE_FAILED', 'Unable to create series episode', (err as Error).message))
    }
  }

  async function createSeriesVariant(msg: string) {
    try {
      const input: CreateSeriesVariantInput = JSON.parse(msg)
      const { projectId, episodeId } = input
      const videoProfile = isSeriesVariantVideoProfile(input.videoProfile) ? input.videoProfile : undefined
      const subtitleProfile = isSeriesVariantSubtitleProfile(input.subtitleProfile) ? input.subtitleProfile : undefined
      const name = resolveVariantName({
        name: input.name,
        videoProfile,
        subtitleProfile,
      })

      if (!name) {
        return JSON.stringify(fail('SERIES_VARIANT_NAME_REQUIRED', 'Variant name is required'))
      }

      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const nextVariantIdentity = getVariantIdentity({ name, videoProfile, subtitleProfile })
      if (
        episode.variants.some(variant => {
          const hasSameName = normalizeVariantName(variant.name) === normalizeVariantName(name)
          const hasSameIdentity =
            getVariantIdentity({
              name: variant.name,
              videoProfile: variant.videoProfile,
              subtitleProfile: variant.subtitleProfile,
            }) === nextVariantIdentity
          return hasSameName || hasSameIdentity
        })
      ) {
        return JSON.stringify(fail('SERIES_VARIANT_DUPLICATED', `Variant ${name} already exists`))
      }

      const timestamp = new Date().toISOString()
      const variant: SeriesProjectVariant = {
        id: Date.now(),
        name,
        directoryName: resolveVariantDirectoryName(
          name,
          episode.variants.map(item => item.directoryName),
        ),
        videoProfile,
        subtitleProfile,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      copyVariantConfig(getDraftConfigPath(task.path), getVariantConfigPath(task.path, episode, variant))

      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, variant],
        variantCount: episode.variants.length + 1,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId ?? variant.id,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, variant, workspace: nextWorkspace }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(fail('SERIES_VARIANT_CREATE_FAILED', 'Unable to create series variant', (err as Error).message))
    }
  }

  async function inheritSeriesEpisodeVariants(msg: string) {
    try {
      const input: InheritSeriesEpisodeVariantsInput = JSON.parse(msg)
      const { projectId, episodeId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const previousEpisode = findPreviousEpisode(workspace, episodeId)
      if (!previousEpisode) {
        return JSON.stringify(
          fail('SERIES_PREVIOUS_EPISODE_NOT_FOUND', `Episode ${episode.episodeLabel} has no previous episode`),
        )
      }

      if (!previousEpisode.variants.length) {
        return JSON.stringify(
          fail(
            'SERIES_PREVIOUS_EPISODE_VARIANTS_EMPTY',
            `Previous episode ${previousEpisode.episodeLabel} has no variants to inherit`,
          ),
        )
      }

      const timestamp = new Date().toISOString()
      const baseId = Date.now()
      const existingDirectoryNames = episode.variants.map(item => item.directoryName)
      const existingVariantKeys = new Set(
        episode.variants.map(variant =>
          getVariantIdentity({
            name: variant.name,
            videoProfile: variant.videoProfile,
            subtitleProfile: variant.subtitleProfile,
          }),
        ),
      )
      const existingVariantNames = new Set(episode.variants.map(variant => normalizeVariantName(variant.name)))
      const sourceVariantPairs: Array<{ source: SeriesProjectVariant; copied: SeriesProjectVariant }> = []

      previousEpisode.variants.forEach(sourceVariant => {
        const nextName = resolveVariantName({
          name: sourceVariant.name,
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
        })
        const variantIdentity = getVariantIdentity({
          name: nextName,
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
        })
        if (existingVariantKeys.has(variantIdentity) || existingVariantNames.has(normalizeVariantName(nextName))) {
          return
        }

        const copiedVariant: SeriesProjectVariant = {
          id: baseId + sourceVariantPairs.length,
          name: nextName,
          directoryName: resolveVariantDirectoryName(nextName, existingDirectoryNames),
          videoProfile: sourceVariant.videoProfile,
          subtitleProfile: sourceVariant.subtitleProfile,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        existingDirectoryNames.push(copiedVariant.directoryName)
        existingVariantKeys.add(variantIdentity)
        existingVariantNames.add(normalizeVariantName(nextName))
        sourceVariantPairs.push({ source: sourceVariant, copied: copiedVariant })
      })

      if (!sourceVariantPairs.length) {
        return JSON.stringify(
          fail(
            'SERIES_VARIANTS_ALREADY_INHERITED',
            `Episode ${episode.episodeLabel} already has all inheritable variants from ${previousEpisode.episodeLabel}`,
          ),
        )
      }

      sourceVariantPairs.forEach(({ source, copied }) => {
        const sourceConfigPath = getVariantConfigPath(task.path, previousEpisode, source)
        copyVariantConfig(
          fs.existsSync(sourceConfigPath) ? sourceConfigPath : getDraftConfigPath(task.path),
          getVariantConfigPath(task.path, episode, copied),
        )
      })

      const copiedVariants = sourceVariantPairs.map(pair => pair.copied)
      const nextEpisode: SeriesProjectEpisode = {
        ...episode,
        variants: [...episode.variants, ...copiedVariants],
        variantCount: episode.variants.length + copiedVariants.length,
        updatedAt: timestamp,
      }
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        activeEpisodeId: workspace.activeEpisodeId ?? nextEpisode.id,
        activeVariantId: workspace.activeVariantId ?? copiedVariants[0]?.id,
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, workspace: nextWorkspace, copiedCount: copiedVariants.length }))
    } catch (err) {
      dialog.showErrorBox('闂傚倷鐒︾€笛囨偡閵娾晩鏁?', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_VARIANT_INHERIT_FAILED',
          'Unable to inherit variants from previous episode',
          (err as Error).message,
        ),
      )
    }
  }

  async function activateSeriesVariant(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const variantConfigPath = getVariantConfigPath(task.path, episode, variant)
      if (!fs.existsSync(variantConfigPath)) {
        return JSON.stringify(
          fail('SERIES_VARIANT_CONFIG_NOT_FOUND', `Variant config for ${variant.name} does not exist`),
        )
      }

      fs.copyFileSync(variantConfigPath, getDraftConfigPath(task.path))

      const timestamp = new Date().toISOString()
      const nextVariant: SeriesProjectVariant = {
        ...variant,
        updatedAt: timestamp,
      }
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
      return JSON.stringify(ok({ episode: nextEpisode, variant: nextVariant, workspace: nextWorkspace }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail('SERIES_VARIANT_ACTIVATE_FAILED', 'Unable to activate series variant', (err as Error).message),
      )
    }
  }

  async function syncSeriesVariantFromDraft(msg: string) {
    try {
      const input: SeriesVariantDraftInput = JSON.parse(msg)
      const { projectId, episodeId, variantId } = input
      const task = projectStore.findLegacyTaskById(projectId)
      if (!task) {
        return JSON.stringify(fail('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`))
      }

      const project = projectStore.getProjectById(projectId)
      if (!project || project.projectMode !== 'episode') {
        return JSON.stringify(fail('PROJECT_MODE_MISMATCH', `Project ${projectId} is not in series mode`))
      }

      const workspace = readSeriesWorkspace(project.id, task.path)
      const episode = workspace.episodes.find(item => item.id === episodeId)
      if (!episode) {
        return JSON.stringify(fail('SERIES_EPISODE_NOT_FOUND', `Episode ${episodeId} does not exist`))
      }

      const variant = episode.variants.find(item => item.id === variantId)
      if (!variant) {
        return JSON.stringify(fail('SERIES_VARIANT_NOT_FOUND', `Variant ${variantId} does not exist`))
      }

      const variantDirectoryPath = getVariantDirectoryPath(task.path, episode, variant)
      fs.mkdirSync(variantDirectoryPath, { recursive: true })
      fs.copyFileSync(getDraftConfigPath(task.path), getVariantConfigPath(task.path, episode, variant))

      const timestamp = new Date().toISOString()
      const nextVariant: SeriesProjectVariant = {
        ...variant,
        updatedAt: timestamp,
      }
      const nextEpisode = replaceVariant(episode, nextVariant, timestamp)
      writeEpisodeRecord(task.path, nextEpisode)

      const nextWorkspace: SeriesProjectWorkspace = {
        ...replaceEpisode(workspace, nextEpisode),
        updatedAt: timestamp,
      }
      writeSeriesWorkspace(task.path, nextWorkspace)

      notifyProjectDataChanged()
      return JSON.stringify(ok({ episode: nextEpisode, variant: nextVariant, workspace: nextWorkspace }))
    } catch (err) {
      dialog.showErrorBox('闂備焦瀵ч悷銊╊敋?', (err as Error).message)
      return JSON.stringify(
        fail(
          'SERIES_VARIANT_SYNC_FAILED',
          'Unable to sync current draft to series variant',
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
    if (isPublishedLink(task.mikan)) result.mikan = publishedLabel
    if (isPublishedLink(task.miobt)) result.miobt = publishedLabel
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
    fs.writeFileSync(getDraftConfigPath(task.path), JSON.stringify(config))

    const project = projectStore.getProjectById(id)
    if (project?.projectMode === 'episode') {
      const workspace = readSeriesWorkspace(project.id, task.path)
      const timestamp = new Date().toISOString()
      const nextWorkspace = syncActiveVariantDraft(task.path, workspace, timestamp)
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
    createSeriesEpisode,
    createSeriesVariant,
    inheritSeriesEpisodeVariants,
    activateSeriesVariant,
    syncSeriesVariantFromDraft,
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
