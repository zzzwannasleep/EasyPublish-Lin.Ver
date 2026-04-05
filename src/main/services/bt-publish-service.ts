import fs from 'fs'
import { join } from 'path'
import { Low } from 'lowdb'
import axios from 'axios'
import log from 'electron-log'
import type { PublishResult } from '../../shared/types/publish'
import type { SiteId } from '../../shared/types/site'
import { escapeHtml, sleep, unescapeHtml } from '../core/utils'
import { createProjectStore } from '../storage/project-store'
import {
  getActivePublishTorrentEntry,
  getSelectedPublishTorrentEntries,
  materializeEpisodePublishDraft,
} from './episode-publish-support'

type UserDbProvider = () => Low<Config.UserData>
type TaskDbProvider = () => Low<Config.TaskData>

interface CreateBtPublishServiceOptions {
  getUserDB: UserDbProvider
  getTaskDB: TaskDbProvider
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged?: () => void
}

const DMHY_LINK_MISSING = '\u672A\u627E\u5230\u94FE\u63A5'
const LOGGED_IN_STATUS = '\u8D26\u53F7\u5DF2\u767B\u5F55'
const DMHY_UPLOAD_EXISTS = '\u7A2E\u5B50\u5DF2\u5B58\u5728\uFF0C\u8ACB\u4E0D\u8981\u91CD\u8907\u4E0A\u50B3'
const DMHY_UPLOAD_SUCCESS = '\u4E0A\u50B3\u6210\u529F'
const DMHY_SUBMIT_LABEL = '\u63D0\u4EA4'
const DMHY_UPDATE_SUCCESS = '\u4FEE\u6539\u6210\u529F'
const ACGNX_ASIA_API_ERROR =
  '\u672B\u65E5\u52A8\u6F2B\uFF1A\u8A8D\u8B49\u5931\u6557\uFF0Capi token\u8207uid\u4E0D\u5339\u914D'
const ACGNX_ASIA_UPLOAD_SUCCESS = '\u606D\u559C\uFF0C\u8CC7\u6E90\u767C\u4F48\u6210\u529F'
const ACGNX_ASIA_TORRENT_EXISTS =
  '\u95A3\u4E0B\u6240\u8981\u4E0A\u8F09\u7684Torrent\u6A94\u6848\u5DF2\u5B58\u5728'
const ACGNX_GLOBAL_API_ERROR =
  'AcgnX\uFF1A\u8A8D\u8B49\u5931\u6557\uFF0Capi token\u8207uid\u4E0D\u5339\u914D'
const ACGRIP_PUBLISH_LABEL = '\u53D1\u5E03'
const ACGRIP_UPDATE_LABEL = '\u66F4\u65B0'
const ACGRIP_DUPLICATE_TORRENT = '\u5DF2\u5B58\u5728\u76F8\u540C\u7684\u79CD\u5B50'
const ACGNX_DATA_UPDATED = '\u64CD\u4F5C\u6210\u529F'
const MIOBT_POST_API_URL = 'https://www.miobt.com/addon.php?r=api/post/76cad81b'
const MIOBT_LINK_PREFIX = 'https://www.miobt.com/show-'
const MIOBT_TORRENT_FIELD_NAMES = ['torrent_file', 'bt_file', 'torrent', 'file'] as const

interface MioBtApiResponse {
  status?: string
  code?: number
  message?: string
  info_hash?: string
}

export function createBtPublishService(options: CreateBtPublishServiceOptions) {
  const { getUserDB, getTaskDB, projectStore, notifyProjectDataChanged } = options

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getTaskDBOrThrow() {
    const taskDB = getTaskDB()
    if (!taskDB) {
      throw new Error('Task DB is not initialized')
    }
    return taskDB
  }

  function getTaskOrThrow(id: number) {
    return getTaskDBOrThrow().data.tasks.find(item => item.id == id)!
  }

  function resolveLegacySiteId(type: string): SiteId | undefined {
    switch (type) {
      case 'mikan':
      case 'miobt':
      case 'acgrip':
      case 'dmhy':
      case 'acgnx_a':
      case 'acgnx_g':
        return type
      default:
        return undefined
    }
  }

  function getLegacySiteLabel(type: string) {
    switch (type) {
      case 'mikan':
        return 'Mikan'
      case 'miobt':
        return 'MioBT'
      case 'acgrip':
        return 'AcgRip'
      case 'dmhy':
        return 'DMHY'
      case 'acgnx_a':
        return 'AcgnX Asia'
      case 'acgnx_g':
        return 'AcgnX Global'
      default:
        return type
    }
  }

  function getLegacySiteLink(task: Config.Task, siteId: SiteId) {
    if (siteId === 'forum') {
      return task.forumLink
    }

    return task[siteId]
  }

  function getLatestPublishedRemoteUrl(task: Config.Task, siteId: SiteId) {
    const latestPublishedResult = [...(task.publishResults ?? [])]
      .reverse()
      .find(item => item.siteId === siteId && item.status === 'published' && item.remoteUrl)

    return latestPublishedResult?.remoteUrl ?? getLegacySiteLink(task, siteId)
  }

  async function persistLegacyPublishResult(task: Config.Task, type: string, result: string, torrentName?: string) {
    const siteId = resolveLegacySiteId(type)
    if (!siteId) {
      return
    }

    const siteLabel = getLegacySiteLabel(type)
    const siteLabelWithTorrent = torrentName ? `${siteLabel} (${torrentName})` : siteLabel
    const remoteUrl = getLegacySiteLink(task, siteId)
    const persistedResult: PublishResult = {
      siteId,
      status: result === 'success' || (result === 'exist' && Boolean(remoteUrl)) ? 'published' : 'failed',
      remoteUrl,
      message:
        result === 'success'
          ? `Published through legacy ${siteLabelWithTorrent} workflow`
          : result === 'exist'
            ? remoteUrl
              ? `Existing torrent detected in legacy ${siteLabelWithTorrent} workflow`
              : `Existing torrent detected in legacy ${siteLabelWithTorrent} workflow, but no remote link was captured`
            : result === 'unauthorized'
              ? `Legacy ${siteLabelWithTorrent} publish failed because the account is unauthorized`
              : `Legacy ${siteLabelWithTorrent} publish failed`,
      timestamp: new Date().toISOString(),
    }

    projectStore.recordPublishResult(task.id, persistedResult)
    await projectStore.write()
    notifyProjectDataChanged?.()
  }

  function readPublishConfig(taskPath: string) {
    return JSON.parse(fs.readFileSync(join(taskPath, 'config.json'), { encoding: 'utf-8' })) as Config.PublishConfig
  }

  function isEpisodeTask(task: Config.Task) {
    return (task.mode ?? (task.type === 'episode' ? 'episode' : 'feature')) === 'episode'
  }

  function mergePublishResult(current: string, next: string) {
    if (!current) {
      return next
    }
    if (current === 'failed' || next === 'failed') {
      return 'failed'
    }
    if (current === 'unauthorized' || next === 'unauthorized') {
      return 'unauthorized'
    }
    if (current === 'success' || next === 'success') {
      return 'success'
    }
    if (current === 'exist' || next === 'exist') {
      return 'exist'
    }
    return next
  }

  function getMikanApiToken() {
    return getUserDBOrThrow().data.info.find(item => item.name === 'mikan')?.apiToken?.trim() ?? ''
  }

  function getMioBtCredentials() {
    const info = getUserDBOrThrow().data.info.find(item => item.name === 'miobt')
    return {
      userId: info?.username?.trim() ?? '',
      apiKey: info?.apiToken?.trim() ?? '',
    }
  }

  function readMikanDescription(taskPath: string) {
    const candidates = ['acgrip.bbcode', 'nyaa.md', 'bangumi.html']
    for (const filename of candidates) {
      const filePath = join(taskPath, filename)
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, { encoding: 'utf-8' }).trim()
      }
    }
    return ''
  }

  async function runLegacyPublish(task: Config.Task, config: Config.PublishConfig, type: string) {
    if (type == 'mikan') return await publishMikan(task, config)
    if (type == 'miobt') return await publishMioBt(task, config)
    if (type == 'dmhy') return await publishDmhy(task, config)
    if (type == 'acgnx_a') return await publishAcgnxA(task, config)
    if (type == 'acgnx_g') return await publishAcgnxG(task, config)
    if (type == 'acgrip') return await publishAcgrip(task, config)
    return 'failed'
  }

  async function publish(msg: string) {
    let payload: Message.Task.ContentType | null = null
    try {
      payload = JSON.parse(msg)
      let result = ''
      const { id, type } = payload as Message.Task.ContentType
      const task = getTaskOrThrow(id)
      const config = readPublishConfig(task.path)
      if (isEpisodeTask(task)) {
        const selectedEntries = getSelectedPublishTorrentEntries(config)
        const activeEntry = getActivePublishTorrentEntry(config)

        if (selectedEntries.length > 0) {
          for (const entry of selectedEntries) {
            try {
              const entryConfig = materializeEpisodePublishDraft(task.path, config, entry)
              const entryResult = await runLegacyPublish(task, entryConfig, type)
              await persistLegacyPublishResult(task, type, entryResult, entry.name)
              result = mergePublishResult(result, entryResult)
            } catch (error) {
              log.error(error)
              await persistLegacyPublishResult(task, type, 'failed', entry.name)
              result = mergePublishResult(result, 'failed')
            }
          }

          if (activeEntry) {
            try {
              materializeEpisodePublishDraft(task.path, config, activeEntry)
            } catch (error) {
              log.error(error)
            }
          }
        } else {
          result = 'failed'
        }
      } else {
        result = await runLegacyPublish(task, config, type)
        await persistLegacyPublishResult(task, type, result)
      }

      const message: Message.Task.Result = { result }
      return JSON.stringify(message)
    } catch (err) {
      log.error(err)
      if (payload) {
        const task = getTaskDBOrThrow().data.tasks.find(item => item.id === payload!.id)
        if (task) {
          await persistLegacyPublishResult(task, payload.type, 'failed')
        }
      }
      const message: Message.Task.Result = { result: 'failed' }
      return JSON.stringify(message)
    }
  }

  async function publishMikan(task: Config.Task, config: Config.PublishConfig) {
    try {
      const apiToken = getMikanApiToken()
      if (!apiToken) {
        return 'unauthorized'
      }

      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const payload: Record<string, unknown> = {
        name: config.title,
        torrentBase64: torrent.toString('base64'),
      }

      const description = readMikanDescription(task.path)
      if (description) {
        payload.description = description
      }

      const response = await axios.post('https://api.mikanani.me/api/episode', payload, {
        responseType: 'text',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `MikanHash ${apiToken}`,
        },
      })

      if (response.status === 200) {
        return 'success'
      }

      if (response.status === 401 || response.status === 403) {
        return 'unauthorized'
      }

      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  function resolveMioBtSortId(config: Config.PublishConfig) {
    switch (config.category_nyaa) {
      case '1_4':
        return '6'
      case '4_1':
      case '4_3':
      case '4_4':
        return '5'
      case '1_2':
      case '1_3':
        return '1'
      default:
        break
    }

    if (config.category_bangumi === '549ef250fe682f7549f1ea91') {
      return '5'
    }

    return '1'
  }

  function parseMioBtApiResponse(payload: unknown) {
    if (!payload) {
      return undefined
    }

    if (typeof payload === 'object') {
      const response = payload as MioBtApiResponse
      return response.status ? response : undefined
    }

    if (typeof payload === 'string') {
      try {
        const response = JSON.parse(payload) as MioBtApiResponse
        return response.status ? response : undefined
      } catch {
        return undefined
      }
    }

    return undefined
  }

  async function publishMioBt(task: Config.Task, config: Config.PublishConfig) {
    try {
      const { userId, apiKey } = getMioBtCredentials()
      if (!userId || !apiKey) {
        return 'unauthorized'
      }

      const taskDB = getTaskDBOrThrow()
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
      let fallbackPayload: unknown

      for (const fieldName of MIOBT_TORRENT_FIELD_NAMES) {
        const formData = new FormData()
        formData.append('sort_id', resolveMioBtSortId(config))
        formData.append('title', config.title)
        formData.append('intro', html)
        formData.append('discuss_url', task.forumLink ?? '')
        formData.append('user_id', userId)
        formData.append('api_key', apiKey)
        formData.append(fieldName, new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)

        const response = await axios.post(MIOBT_POST_API_URL, formData, { responseType: 'text' })
        fallbackPayload = response.data
        const data = parseMioBtApiResponse(response.data)

        if (!data) {
          continue
        }

        if (data.status === 'success' && data.info_hash) {
          task.miobt = `${MIOBT_LINK_PREFIX}${data.info_hash}.html`
          await taskDB.write()
          return 'success'
        }

        if (data.code === 103 && data.info_hash) {
          if (!task.miobt) {
            task.miobt = `${MIOBT_LINK_PREFIX}${data.info_hash}.html`
            await taskDB.write()
          }
          return 'exist'
        }

        if (data.code === 114 || data.message === 'auth failed') {
          return 'unauthorized'
        }

        log.error(data)
        return 'failed'
      }

      log.error(fallbackPayload)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function publishDmhy(task: Config.Task, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
      const formData = new FormData()
      const team = await axios.get('https://www.dmhy.org/team/myteam', { responseType: 'text' })
      const teamId = (team.data as string).match(/<tbody>[\s\S]*?<td>([\S]*?)<\/td>/)
      if (config.category_bangumi == '54967e14ff43b99e284d0bf7') formData.append('sort_id', '31')
      else if (config.category_bangumi == '549ef207fe682f7549f1ea90') formData.append('sort_id', '2')
      else if (config.category_bangumi == '549cc9369310bc7d04cddf9f') formData.append('sort_id', '2')
      else formData.append('sort_id', '1')
      formData.append('team_id', teamId ? teamId[1] : '')
      formData.append('bt_data_title', config.title)
      const imgSrc = html.match(/<img[\s\S]*?src="([\S]*?)"/)![1]
      formData.append('poster_url', imgSrc)
      formData.append('bt_data_intro', html)
      formData.append('tracker', '')
      formData.append('MAX_FILE_SIZE', '2097152')
      formData.append('bt_file', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      formData.append('disable_download_seed_file', '0')
      formData.append('emule_resource', '')
      formData.append('synckey', '')
      formData.append('submit', DMHY_SUBMIT_LABEL)
      const response = await axios.post('https://www.dmhy.org/topics/add', formData, { responseType: 'text' })
      if (response.status != 200) throw response
      if ((response.data as string).includes(DMHY_UPLOAD_EXISTS)) {
        if (!task.dmhy) {
          const src = await getDmhyLink(config.title)
          task.dmhy = src == '' ? DMHY_LINK_MISSING : `https://www.dmhy.org${src}`
          await taskDB.write()
        }
        return 'exist'
      }
      if ((response.data as string).includes(DMHY_UPLOAD_SUCCESS)) {
        const src = await getDmhyLink(config.title)
        task.dmhy = src == '' ? DMHY_LINK_MISSING : `https://www.dmhy.org${src}`
        await taskDB.write()
        return 'success'
      }
      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function publishAcgnxA(task: Config.Task, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const userDB = getUserDBOrThrow()
      const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const formData = new FormData()
      if (config.category_bangumi == '54967e14ff43b99e284d0bf7') formData.append('sort_id', '2')
      else if (config.category_bangumi == '549ef207fe682f7549f1ea90') formData.append('sort_id', '1')
      else formData.append('sort_id', '19')
      formData.append('bt_file', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      formData.append('title', config.title)
      formData.append('intro', html)
      formData.append('Anonymous_Post', '0')
      formData.append('Team_Post', '1')
      if (userDB.data.acgnxAPI?.enable) {
        formData.append('uid', userDB.data.acgnxAPI.asia.uid)
        formData.append('api_token', userDB.data.acgnxAPI.asia.token)
        formData.append('mod', 'upload')
        const response = await axios.post('https://share.acgnx.se/user.php?o=api&op=upload', formData, {
          responseType: 'json',
        })
        if (response.data.code == 200) {
          task.acgnx_a = `https://share.acgnx.se/show-${response.data.infohash}.html`
          await taskDB.write()
          return 'success'
        }
        if (response.data.code == 302) {
          task.acgnx_a = `https://share.acgnx.se/show-${response.data.infohash}.html`
          await taskDB.write()
          return 'exist'
        }
        if (response.data.code == 105) {
          log.error(ACGNX_ASIA_API_ERROR)
          if (userDB.data.info.find(item => item.name == 'acgnx_a')!.status != LOGGED_IN_STATUS) {
            return 'unauthorized'
          }
        } else {
          log.error(response)
          if (userDB.data.info.find(item => item.name == 'acgnx_a')!.status != LOGGED_IN_STATUS) {
            return 'failed'
          }
        }
      }
      formData.delete('uid')
      formData.delete('api_token')
      formData.delete('mod')
      formData.append('op', 'upload')
      formData.append('emule_resource', '')
      formData.append('synckey', '')
      formData.append('discuss_url', '')
      const response = await axios.post('https://share.acgnx.se/user.php?o=upload', formData, { responseType: 'text' })
      if (response.status != 200) throw response
      if ((response.data as string).includes(ACGNX_ASIA_UPLOAD_SUCCESS)) {
        task.acgnx_a =
          `https://share.acgnx.se/${(response.data as string).match(/href="([\S]*?)">\u67E5\u770B\u767C\u4F48\u7684\u8CC7\u6E90/)![1]}`
        await taskDB.write()
        return 'success'
      }
      if ((response.data as string).includes(ACGNX_ASIA_TORRENT_EXISTS)) {
        if (!task.acgnx_a) {
          const url = (response.data as string).match(/\u67E5\u770B\u539F\u8CC7\u6E90\u8A73\u60C5\uFF1A<a\shref="([\S]*?)">/)![1]
          task.acgnx_a = `https://share.acgnx.se/${url}`
          await taskDB.write()
        }
        return 'exist'
      }
      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function publishAcgnxG(task: Config.Task, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const userDB = getUserDBOrThrow()
      const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const formData = new FormData()
      if (config.category_nyaa == '1_2') formData.append('sort_id', '2')
      else if (config.category_nyaa == '1_3') formData.append('sort_id', '4')
      else if (config.category_nyaa == '1_4') formData.append('sort_id', '3')
      else if (config.category_nyaa == '4_1') formData.append('sort_id', '14')
      else if (config.category_nyaa == '4_2') formData.append('sort_id', '16')
      else formData.append('sort_id', '15')
      formData.append('bt_file', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      formData.append('title', config.title)
      formData.append('intro', html)
      formData.append('Anonymous_Post', '0')
      formData.append('Team_Post', '1')
      if (userDB.data.acgnxAPI?.enable) {
        formData.append('uid', userDB.data.acgnxAPI.global.uid)
        formData.append('api_token', userDB.data.acgnxAPI.global.token)
        formData.append('mod', 'upload')
        const response = await axios.post('https://www.acgnx.se/user.php?o=api&op=upload', formData, {
          responseType: 'json',
        })
        if (response.data.code == 200) {
          task.acgnx_g = `https://www.acgnx.se/show-${response.data.infohash}.html`
          await taskDB.write()
          return 'success'
        }
        if (response.data.code == 302) {
          task.acgnx_g = `https://www.acgnx.se/show-${response.data.infohash}.html`
          await taskDB.write()
          return 'exist'
        }
        if (response.data.code == 105) {
          log.error(ACGNX_GLOBAL_API_ERROR)
          if (userDB.data.info.find(item => item.name == 'acgnx_g')!.status != LOGGED_IN_STATUS) {
            return 'unauthorized'
          }
        } else {
          log.error(response)
          if (userDB.data.info.find(item => item.name == 'acgnx_g')!.status != LOGGED_IN_STATUS) {
            return 'failed'
          }
        }
      }
      formData.delete('uid')
      formData.delete('api_token')
      formData.delete('mod')
      formData.append('tos', '1')
      formData.append('emule_resource', '')
      formData.append('synckey', '')
      formData.append('discuss_url', '')
      formData.append('op', 'upload')
      const response = await axios.post('https://www.acgnx.se/user.php?o=upload', formData, { responseType: 'text' })
      if (response.status != 200) throw response
      if ((response.data as string).includes('Congratulations, upload success')) {
        task.acgnx_g =
          `https://www.acgnx.se/${(response.data as string).match(/href="([\S]*?)">View\sThis\sTorrent/)![1]}`
        await taskDB.write()
        return 'success'
      }
      if ((response.data as string).includes('The Torrent file you are going to upload is already there')) {
        if (!task.acgnx_g) {
          const url = (response.data as string).match(/View\soriginal\storrent\sdetails[:\uFF1A]<a\shref="([\S]*?)">/)![1]
          task.acgnx_g = `https://www.acgnx.se/${url}`
          await taskDB.write()
        }
        return 'exist'
      }
      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function publishAcgrip(task: Config.Task, config: Config.PublishConfig) {
    try {
      const userDB = getUserDBOrThrow()
      const taskDB = getTaskDBOrThrow()
      const bbcode = fs.readFileSync(join(task.path, 'acgrip.bbcode'), { encoding: 'utf-8' })
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const formData = new FormData()
      const date = new Date()
      const csrf = await axios.get('https://acg.rip/cp/posts/upload', { responseType: 'text' })
      let cookieValue = csrf.headers['set-cookie']![0].match(/_kanako_session=([\S]*?);/)![1]
      userDB.data.info.find(item => item.name == 'acgrip')!.cookies.find(item => item.name == '_kanako_session')!.value =
        cookieValue
      await userDB.write()
      const token = (csrf.data as string).match(/name="csrf-token"\scontent="([\S]*?)"/)![1]
      formData.append('authenticity_token', token)
      if (config.category_bangumi == '54967e14ff43b99e284d0bf7') formData.append('post[category_id]', '5')
      else if (config.category_bangumi == '549ef207fe682f7549f1ea90') formData.append('post[category_id]', '1')
      else formData.append('post[category_id]', '9')
      formData.append('year', date.getFullYear().toString())
      formData.append('post[series_id]', '0')
      formData.append('post[torrent]', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      formData.append('post[title]', config.title)
      formData.append('post[post_as_team]', '1')
      formData.append('post[content]', bbcode)
      formData.append('commit', ACGRIP_PUBLISH_LABEL)
      const response = await axios.post('https://acg.rip/cp/posts', formData, { responseType: 'text' })
      if (response.status == 302) {
        cookieValue = response.headers['set-cookie']![0].match(/_kanako_session=([\S]*?);/)![1]
        userDB.data.info.find(item => item.name == 'acgrip')!.cookies.find(item => item.name == '_kanako_session')!.value =
          cookieValue
        await userDB.write()
        const src = await getAcgripLink(config.title)
        task.acgrip = src == '' ? DMHY_LINK_MISSING : `https://acg.rip${src}`
        await taskDB.write()
        return 'success'
      }
      if ((response.data as string).includes(ACGRIP_DUPLICATE_TORRENT)) {
        if (!task.acgrip) {
          const src = await getAcgripLink(config.title)
          task.acgrip = src == '' ? DMHY_LINK_MISSING : `https://acg.rip${src}`
          await taskDB.write()
        }
        return 'exist'
      }
      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function getDmhyLink(title: string) {
    const ruleTitle = escapeHtml(title.replace(/[\*\.\?\+\^\$\|\\\/\[\]\(\)\{\}\s]/g, '[\\S\\s]'))
    const rule = new RegExp(`<a\\shref="([\\S]*?)"[\\s]*?target="_blank">${ruleTitle}`)
    let src = ''
    for (let index = 0; index < 5; index++) {
      await sleep(1000)
      const result = await axios.get('https://www.dmhy.org/topics/mlist/scope/team', { responseType: 'text' })
      const link = (result.data as string).match(rule)
      if (link) {
        src = link[1]
        break
      }
    }
    return src
  }

  async function getAcgripLink(title: string) {
    const userDB = getUserDBOrThrow()
    const ruleTitle = escapeHtml(title.replace(/[\*\.\?\+\^\$\|\\\/\[\]\(\)\{\}\s]/g, '[\\S\\s]'))
    const rule = new RegExp(`href="([\\S]*?)">${ruleTitle}`)
    let src = ''
    for (let index = 0; index < 5; index++) {
      const result = await axios.get('https://acg.rip/cp/team_posts', { responseType: 'text' })
      const link = (result.data as string).match(rule)
      if (link) {
        src = link[1]
        break
      }
      await sleep(1000)
      const cookieValue = result.headers['set-cookie']![0].match(/_kanako_session=([\S]*?);/)![1]
      userDB.data.info.find(item => item.name == 'acgrip')!.cookies.find(item => item.name == '_kanako_session')!.value =
        cookieValue
      await userDB.write()
    }
    return src
  }

  async function getBTLinks(msg: string) {
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = getTaskOrThrow(id)
    let dmhyLink = getLatestPublishedRemoteUrl(task, 'dmhy')

    if (dmhyLink == DMHY_LINK_MISSING) {
      const config = readPublishConfig(task.path)
      const src = await getDmhyLink(config.title)
      if (src == '') task.dmhy = DMHY_LINK_MISSING
      else {
        task.dmhy = `https://www.dmhy.org${src}`
      }
      await getTaskDBOrThrow().write()
      dmhyLink = task.dmhy
    }

    const bangumiLink = getLatestPublishedRemoteUrl(task, 'bangumi')
    const mikanLink = getLatestPublishedRemoteUrl(task, 'mikan')
    const miobtLink = getLatestPublishedRemoteUrl(task, 'miobt')
    const nyaaLink = getLatestPublishedRemoteUrl(task, 'nyaa')
    const acgripLink = getLatestPublishedRemoteUrl(task, 'acgrip')
    const acgnxALink = getLatestPublishedRemoteUrl(task, 'acgnx_a')
    const acgnxGLink = getLatestPublishedRemoteUrl(task, 'acgnx_g')
    const hasResolvedLink = [bangumiLink, mikanLink, miobtLink, nyaaLink, dmhyLink, acgripLink, acgnxALink, acgnxGLink]
      .filter((link): link is string => typeof link === 'string' && link.length > 0)
      .some(link => link !== DMHY_LINK_MISSING)

    const result: Message.Task.PublishStatus = {
      bangumi_all: hasResolvedLink ? 'true' : 'false',
      bangumi: bangumiLink,
      mikan: mikanLink,
      miobt: miobtLink,
      nyaa: nyaaLink,
      dmhy: dmhyLink,
      acgrip: acgripLink,
      acgnx_a: acgnxALink,
      acgnx_g: acgnxGLink,
    }
    return JSON.stringify(result)
  }

  async function getTorrentList() {
    const loginInfo = getUserDBOrThrow().data.info
    const result: Message.BT.TorrentList = { list: [] }
    if (loginInfo.find(item => item.name == 'acgrip')!.enable) {
      mergeTorrentDetails(result.list, await getAcgripTorrentList(), 'acgrip')
    }
    if (loginInfo.find(item => item.name == 'dmhy')!.enable) {
      mergeTorrentDetails(result.list, await getDmhyTorrentList(), 'dmhy')
    }
    if (loginInfo.find(item => item.name == 'acgnx_a')!.enable) {
      mergeTorrentDetails(result.list, await getAcgnxTorrentList(false), 'acgnx_a')
    }
    if (loginInfo.find(item => item.name == 'acgnx_g')!.enable) {
      mergeTorrentDetails(result.list, await getAcgnxTorrentList(true), 'acgnx_g')
    }
    return JSON.stringify(result)
  }

  function mergeTorrentDetails(
    list: Message.BT.TorrentList['list'],
    items: { title: string; detail: unknown }[],
    key: 'acgrip' | 'dmhy' | 'acgnx_a' | 'acgnx_g',
  ) {
    items.forEach(item => {
      const torrent = list.find(element => element.title == item.title)
      if (torrent) {
        torrent[key] = item.detail
      } else {
        list.push({ title: item.title, [key]: item.detail })
      }
    })
  }

  async function getAcgnxTorrentList(global: boolean) {
    try {
      const baseUrl = global ? 'https://www.acgnx.se/' : 'https://share.acgnx.se/'
      const response = await axios.get(`${baseUrl}user.php?o=data`, { responseType: 'text' })
      const torrents = (response.data as string).match(/<tr\sclass="alt[12]\stext_center">[\s\S]*?<\/tr>/g) ?? []
      const result: { title: string; detail: Message.BT.TorrentDetail.AcgnxDetail }[] = []
      torrents.forEach(item => {
        const linkMatch = item.match(/<a\shref="(\S*?)"\starget="_blank">(?!<)([\s\S]*?)<\/a>/)
        const idMatch = item.match(/user.php\?o=data&act=edit&id=(\d+)&type=/)
        if (!linkMatch || !idMatch) return
        const [, link, title] = linkMatch
        const [, id] = idMatch
        result.push({
          title: unescapeHtml(title),
          detail: {
            id,
            url: `${baseUrl}${link}`,
            is_loaded: false,
          },
        })
      })
      return result
    } catch (err) {
      log.error(err)
      return []
    }
  }

  async function getDmhyTorrentList() {
    try {
      const response = await axios.get('https://www.dmhy.org/topics/mlist/scope/team', { responseType: 'text' })
      const torrents = (response.data as string).match(/<tr\sclass="">[\s\S]*?<\/tr>/g) ?? []
      const result: { title: string; detail: Message.BT.TorrentDetail.DmhyDetail }[] = []
      torrents.forEach(item => {
        const linkMatch = item.match(/<a\shref="(\S*?)"\s+target="_blank">([\s\S]*?)<\/a>/)
        const idMatch = item.match(/"\/topics\/edit\/id\/(\d+)"/)
        if (!linkMatch || !idMatch) return
        const [, link, title] = linkMatch
        const [, id] = idMatch
        result.push({
          title: unescapeHtml(title),
          detail: {
            id,
            url: `https://www.dmhy.org${link}`,
            is_loaded: false,
          },
        })
      })
      return result
    } catch (err) {
      log.error(err)
      return []
    }
  }

  async function getAcgripTorrentList() {
    try {
      const response = await axios.get('https://acg.rip/cp/posts', { responseType: 'text' })
      const torrents = (response.data as string).match(/<div\sclass="list-group-item-heading">[\s\S]*?<\/div>/g) ?? []
      const result: { title: string; detail: Message.BT.TorrentDetail.AcgripDetail }[] = []
      torrents.forEach(item => {
        const matches = item.match(/<a\shref="\/t\/(\d+)">([\s\S]*?)<\/a>/)
        if (!matches) return
        const [, id, title] = matches
        result.push({
          title: unescapeHtml(title),
          detail: {
            id,
            url: `https://acg.rip/t/${id}`,
            is_loaded: false,
          },
        })
      })
      return result
    } catch (err) {
      log.error(err)
      return []
    }
  }

  async function getTorrentDetail(msg: string) {
    const { type, id }: Message.BT.TorrentInfo = JSON.parse(msg)
    let result
    if (type == 'acgrip') result = await getAcgripTorrentDetail(id)
    if (type == 'acgnx_a') result = await getAcgnxTorrentDetail(false, id)
    if (type == 'acgnx_g') result = await getAcgnxTorrentDetail(true, id)
    if (type == 'dmhy') result = await getDmhyTorrentDetail(id)
    return JSON.stringify(result)
  }

  async function getAcgripTorrentDetail(id: string) {
    try {
      const response = await axios.get(`https://acg.rip/cp/posts/${id}/edit`, { responseType: 'text' })
      const data = response.data as string
      const categoryId = data.match(/<select[\s\S]*?id="post_category_id">[\s\S]*?<option\sselected="selected"\svalue="(\d)">/)![1]
      const content = data.match(/<textarea[\s\S]*?id="post_content">([\s\S]*?)<\/textarea>/)![1]
      const seriesId = data.match(/<select\sname="post\[series_id\]"[\s\S]*?<option\sselected="selected"\svalue="(\d+)">/)![1]
      const team = data.match(/<input[\s\S]*?id="post_post_as_team"\s\/>/)![0]
      const postAsTeam = team.includes('checked="checked"') ? '1' : '0'
      const result: Message.BT.TorrentDetail.AcgripContent = {
        category_id: categoryId,
        content,
        series_id: seriesId,
        post_as_team: postAsTeam,
      }
      return result
    } catch (err) {
      log.error(err)
      return
    }
  }

  async function getAcgnxTorrentDetail(global: boolean, id: string) {
    try {
      const url = global
        ? `https://www.acgnx.se/user.php?o=data&act=edit&id=${id}&type=`
        : `https://share.acgnx.se/user.php?o=data&act=edit&id=${id}&type=`
      const response = await axios.get(url, { responseType: 'text' })
      const data = response.data as string
      const content = data.match(/<textarea\sid="intro"[\s\S]*?>([\s\S]*?)<\/textarea>/)![1]
      const sortId = data.match(/<select\sid="sort_id"[\s\S]*?<option\svalue="(\d+)"\sselected="selected">/)![1]
      const syncKey = data.match(/<input[\s\S]*?id="synckey"[\s\S]*?value="([\s\S]*?)"\s\/>/)![1]
      const discussUrl = data.match(/<input[\s\S]*?id="discuss_url"[\s\S]*?value="([\s\S]*?)"\s\/>/)![1]
      const team = data.match(/<input[\s\S]*?name="Team_Post"\svalue="1"[\s\S]*?\/>/)![0]
      const teamPost = team.includes('checked="checked"') ? '1' : '0'
      const result: Message.BT.TorrentDetail.AcgnxContent = {
        content,
        sort_id: sortId,
        synckey: syncKey,
        discuss_url: discussUrl,
        team_post: teamPost,
      }
      return result
    } catch (err) {
      log.error(err)
      return
    }
  }

  async function getDmhyTorrentDetail(id: string) {
    try {
      const response = await axios.get(`https://www.dmhy.org/topics/edit/id/${id}`, { responseType: 'text' })
      const data = response.data as string
      const sortId = data.match(
        /<select\sname="sort_id"\sid="sort_id">[\s\S]*?<option\svalue="(\d+)"\s\S*\sselected="selected">/,
      )![1]
      const content = data.match(/<input[\s\S]*?name="bt_data_intro"\svalue="([\s\S]*?)"/)![1]
      const posterUrl = data.match(/<input[\s\S]*?id="poster_url"\svalue="([\s\S]*?)"/)![1]
      const syncKey = data.match(/<input[\s\S]*?id="synckey"\svalue="([\s\S]*?)"/)![1]
      const result: Message.BT.TorrentDetail.DmhyContent = {
        content,
        sort_id: sortId,
        poster_url: posterUrl,
        synckey: syncKey,
      }
      return result
    } catch (err) {
      log.error(err)
      return
    }
  }

  async function updateTorrent(msg: string) {
    const { type, id, config, title }: Message.BT.UpdatedContent = JSON.parse(msg)
    let result
    if (type == 'acgnx_a') result = await updateAcgnxTorrent(false, title, id, config as Message.BT.TorrentDetail.AcgnxContent)
    if (type == 'acgnx_g') result = await updateAcgnxTorrent(true, title, id, config as Message.BT.TorrentDetail.AcgnxContent)
    if (type == 'dmhy') result = await updateDmhyTorrent(title, id, config as Message.BT.TorrentDetail.DmhyContent)
    if (type == 'acgrip') result = await updateAcgripTorrent(title, id, config as Message.BT.TorrentDetail.AcgripContent)
    const message: Message.Task.Result = { result }
    return JSON.stringify(message)
  }

  async function updateAcgnxTorrent(
    global: boolean,
    title: string,
    id: string,
    config: Message.BT.TorrentDetail.AcgnxContent,
  ) {
    try {
      const formData = new FormData()
      formData.append('op', 'edit')
      formData.append('id', id)
      formData.append('sort_id', config.sort_id)
      formData.append('title', title)
      formData.append('intro', config.content)
      formData.append('emule_resource', '')
      formData.append('synckey', config.synckey)
      formData.append('discuss_url', config.discuss_url)
      formData.append('Team_Post', config.team_post)
      if (global) {
        formData.append('url', 'https%3A%2F%2Fwww.acgnx.se%2Fuser.php%3Fo%3Ddata')
        formData.append('tos', '1')
      } else {
        formData.append('url', 'https%3A%2F%2Fshare.acgnx.se%2Fuser.php%3Fo%3Ddata')
      }
      const url = global
        ? 'https://www.acgnx.se/user.php?o=data&type='
        : 'https://share.acgnx.se/user.php?o=data&type='
      const response = await axios.post(url, formData, { responseType: 'text' })
      if (global && (response.data as string).includes('Successful!')) return 'success'
      if (!global && (response.data as string).includes(ACGNX_DATA_UPDATED)) return 'success'
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function updateDmhyTorrent(title: string, id: string, config: Message.BT.TorrentDetail.DmhyContent) {
    try {
      const formData = new FormData()
      formData.append('sort_id', config.sort_id)
      formData.append('bt_data_title', title)
      formData.append('poster_url', config.poster_url)
      formData.append('bt_data_intro', config.content)
      formData.append('synckey', '')
      formData.append('submit', DMHY_SUBMIT_LABEL)
      formData.append('bt_data_id', id)
      const response = await axios.post(`https://www.dmhy.org/topics/edit/id/${id}`, formData, { responseType: 'text' })
      if ((response.data as string).includes(DMHY_UPDATE_SUCCESS)) return 'success'
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function updateAcgripTorrent(title: string, id: string, config: Message.BT.TorrentDetail.AcgripContent) {
    try {
      const tokenPage = await axios.get(`https://acg.rip/cp/posts/${id}/edit`, { responseType: 'text' })
      const token = (tokenPage.data as string).match(/name="authenticity_token"\svalue="([\s\S]*?)"/)![1]
      const formData = new FormData()
      formData.append('_method', 'patch')
      formData.append('authenticity_token', token)
      formData.append('post[category_id]', config.category_id)
      formData.append('post[series_id]', config.series_id)
      formData.append('post[title]', title)
      formData.append('post[post_as_team]', config.post_as_team)
      formData.append('post[content]', config.content)
      formData.append('commit', ACGRIP_UPDATE_LABEL)
      const response = await axios.post(`https://acg.rip/cp/posts/${id}`, formData, { responseType: 'text' })
      if (response.status == 302) return 'success'
      log.error(response)
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  return {
    publish,
    getBTLinks,
    getTorrentList,
    getTorrentDetail,
    updateTorrent,
  }
}
