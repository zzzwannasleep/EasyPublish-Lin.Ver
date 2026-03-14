import fs from 'fs'
import { join } from 'path'
import { Low } from 'lowdb'
import axios from 'axios'
import log from 'electron-log'
import type { PublishResult } from '../../shared/types/publish'
import type { SiteId } from '../../shared/types/site'
import { escapeHtml, sleep, unescapeHtml } from '../core/utils'
import { createProjectStore } from '../storage/project-store'

type UserDbProvider = () => Low<Config.UserData>
type TaskDbProvider = () => Low<Config.TaskData>

interface CreateBtPublishServiceOptions {
  getUserDB: UserDbProvider
  getTaskDB: TaskDbProvider
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged?: () => void
}

const DMHY_LINK_MISSING = '\u672A\u627E\u5230\u94FE\u63A5'
const DUPLICATE_TORRENT = '\u5DF2\u5B58\u5728\u76F8\u540C\u7684\u79CD\u5B50'
const TORRENT_EXISTS = '\u79CD\u5B50\u5DF2\u5B58\u5728'
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
      case 'bangumi_all':
      case 'bangumi':
        return 'bangumi'
      case 'mikan':
      case 'miobt':
      case 'nyaa':
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
      case 'bangumi_all':
        return 'Bangumi sync'
      case 'bangumi':
        return 'Bangumi'
      case 'mikan':
        return 'Mikan'
      case 'miobt':
        return 'MioBT'
      case 'nyaa':
        return 'Nyaa'
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

  async function persistLegacyPublishResult(task: Config.Task, type: string, result: string) {
    const siteId = resolveLegacySiteId(type)
    if (!siteId) {
      return
    }

    const siteLabel = getLegacySiteLabel(type)
    const remoteUrl = getLegacySiteLink(task, siteId)
    const persistedResult: PublishResult = {
      siteId,
      status: result === 'success' || (result === 'exist' && Boolean(remoteUrl)) ? 'published' : 'failed',
      remoteUrl,
      message:
        result === 'success'
          ? `Published through legacy ${siteLabel} workflow`
          : result === 'exist'
            ? remoteUrl
              ? `Existing torrent detected in legacy ${siteLabel} workflow`
              : `Existing torrent detected in legacy ${siteLabel} workflow, but no remote link was captured`
            : result === 'unauthorized'
              ? `Legacy ${siteLabel} publish failed because the account is unauthorized`
              : `Legacy ${siteLabel} publish failed`,
      timestamp: new Date().toISOString(),
    }

    projectStore.recordPublishResult(task.id, persistedResult)
    await projectStore.write()
    notifyProjectDataChanged?.()
  }

  function readPublishConfig(taskPath: string) {
    return JSON.parse(fs.readFileSync(join(taskPath, 'config.json'), { encoding: 'utf-8' })) as Config.PublishConfig
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

  async function publish(msg: string) {
    let payload: Message.Task.ContentType | null = null
    try {
      payload = JSON.parse(msg)
      let result = ''
      const { id, type } = payload as Message.Task.ContentType
      const task = getTaskOrThrow(id)
      const config = readPublishConfig(task.path)
      if (type == 'bangumi_all') result = await publishBangumi(task, config, true)
      else if (type == 'bangumi') result = await publishBangumi(task, config, false)
      else if (type == 'mikan') result = await publishMikan(task, config)
      else if (type == 'miobt') result = await publishMioBt(task, config)
      else if (type == 'nyaa') result = await publishNyaa(task, config)
      else if (type == 'dmhy') result = await publishDmhy(task, config)
      else if (type == 'acgnx_a') result = await publishAcgnxA(task, config)
      else if (type == 'acgnx_g') result = await publishAcgnxG(task, config)
      else if (type == 'acgrip') result = await publishAcgrip(task, config)
      else result = 'failed'
      await persistLegacyPublishResult(task, type, result)
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

  async function publishBangumi(task: Config.Task, config: Config.PublishConfig, sync: boolean) {
    try {
      const taskDB = getTaskDBOrThrow()
      const html = fs.readFileSync(join(task.path, 'bangumi.html'), { encoding: 'utf-8' })
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const formData = new FormData()
      const team = await axios.get('https://bangumi.moe/api/team/myteam', { responseType: 'json' })
      const teamId: string = team.data[0]._id
      formData.append('category_tag_id', config.category_bangumi)
      formData.append('title', config.title)
      formData.append('introduction', html)
      formData.append('tag_ids', config.tags.map(item => item.value).toString())
      formData.append('btskey', 'undefined')
      formData.append('team_id', teamId)
      if (sync) formData.append('teamsync', '1')
      formData.append('file', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      const response = await axios.post('https://bangumi.moe/api/torrent/add', formData, { responseType: 'json' })
      if (response.status != 200) throw response
      if (response.data.success === true) {
        task.bangumi = `https://bangumi.moe/torrent/${response.data.torrent._id}`
        if (sync) {
          await getBangumiSyncLink(task, response.data.torrent._id)
        }
        await taskDB.write()
        return 'success'
      }
      if (response.data.success === false && (response.data.message as string).includes('torrent same as')) {
        if (!task.bangumi) {
          const id = (response.data.message as string).slice(16)
          task.bangumi = `https://bangumi.moe/torrent/${id}`
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

  async function publishNyaa(task: Config.Task, config: Config.PublishConfig) {
    try {
      const taskDB = getTaskDBOrThrow()
      const torrent = fs.readFileSync(join(task.path, config.torrentName))
      const md = fs.readFileSync(join(task.path, 'nyaa.md'), { encoding: 'utf-8' })
      const formData = new FormData()
      formData.append('torrent_file', new Blob([torrent], { type: 'application/x-bittorrent' }), config.torrentName)
      formData.append('display_name', config.title)
      formData.append('category', config.category_nyaa)
      formData.append('information', config.information)
      if (config.completed) formData.append('is_complete', 'y')
      if (config.remake) formData.append('is_remake', 'y')
      formData.append('description', md)
      const response = await axios.post('https://nyaa.si/upload', formData, { responseType: 'text' })
      if ((response.data as string).includes('You should be redirected automatically to target URL')) {
        task.nyaa = response.headers.location
        await taskDB.write()
        return 'success'
      }
      if ((response.data as string).includes('This torrent already exists')) {
        if (!task.nyaa) {
          const id = (response.data as string).match(/This\storrent\salready\sexists\s\(#(\d+)\)/)![1]
          task.nyaa = `https://nyaa.si/view/${id}`
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

  async function getBangumiSyncLink(task: Config.Task, id: string) {
    const taskDB = getTaskDBOrThrow()
    task.sync = true
    let data: any
    for (let index = 0; index < 5; index++) {
      await sleep(1000)
      const result = await axios.post('https://bangumi.moe/api/torrent/fetch', { _id: id }, { responseType: 'json' })
      if (result.status == 200 && result.data.sync) {
        task.sync = false
        data = result.data
        await taskDB.write()
        break
      }
    }
    if (task.sync || !data?.sync) return
    if (data.sync.acgnx) {
      if (data.sync.acgnx != DUPLICATE_TORRENT) task.acgnx_a = data.sync.acgnx
      else if (!task.acgnx_a) task.acgnx_a = TORRENT_EXISTS
    }
    if (data.sync.acgnx_int) {
      if (data.sync.acgnx_int != DUPLICATE_TORRENT) task.acgnx_g = data.sync.acgnx_int
      else if (!task.acgnx_g) task.acgnx_g = TORRENT_EXISTS
    }
    if (data.sync.acgrip) {
      if (data.sync.acgrip != DUPLICATE_TORRENT) task.acgrip = data.sync.acgrip
      else if (!task.acgrip) task.acgrip = TORRENT_EXISTS
    }
    if (data.sync.dmhy) {
      if (data.sync.dmhy != DUPLICATE_TORRENT) task.dmhy = data.sync.dmhy
      else if (!task.dmhy) task.dmhy = TORRENT_EXISTS
    }
  }

  async function getBTLinks(msg: string) {
    const taskDB = getTaskDBOrThrow()
    const { id }: Message.Task.TaskID = JSON.parse(msg)
    const task = getTaskOrThrow(id)
    let isFinished = 'true'
    if (task.sync) {
      isFinished = 'false'
      const bangumiId = task.bangumi!.split('torrent/')[1]
      await getBangumiSyncLink(task, bangumiId)
      await taskDB.write()
      if (!task.sync) isFinished = 'true'
    }
    if (task.dmhy == DMHY_LINK_MISSING) {
      isFinished = 'false'
      const config = readPublishConfig(task.path)
      const src = await getDmhyLink(config.title)
      if (src == '') task.dmhy = DMHY_LINK_MISSING
      else {
        task.dmhy = `https://www.dmhy.org${src}`
        isFinished = 'true'
      }
      await taskDB.write()
    }
    const latestMikanResult = [...(task.publishResults ?? [])].reverse().find(item => item.siteId === 'mikan')
    const result: Message.Task.PublishStatus = {
      bangumi_all: isFinished,
      bangumi: task.bangumi,
      mikan: task.mikan ?? latestMikanResult?.message,
      miobt: task.miobt,
      nyaa: task.nyaa,
      dmhy: task.dmhy,
      acgrip: task.acgrip,
      acgnx_a: task.acgnx_a,
      acgnx_g: task.acgnx_g,
    }
    return JSON.stringify(result)
  }

  async function getTorrentList() {
    const loginInfo = getUserDBOrThrow().data.info
    const result: Message.BT.TorrentList = { list: [] }
    if (loginInfo.find(item => item.name == 'bangumi')!.enable) {
      mergeTorrentDetails(result.list, await getBangumiTorrentList(), 'bangumi')
    }
    if (loginInfo.find(item => item.name == 'nyaa')!.enable) {
      mergeTorrentDetails(result.list, await getNyaaTorrentList(), 'nyaa')
    }
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
    key: 'bangumi' | 'nyaa' | 'acgrip' | 'dmhy' | 'acgnx_a' | 'acgnx_g',
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

  async function getBangumiTorrentList() {
    try {
      const team = await axios.get('https://bangumi.moe/api/team/myteam', { responseType: 'json' })
      const teamId: string = team.data[0]._id
      const response = await axios.get(`https://bangumi.moe/api/torrent/team?team_id=${teamId}`, { responseType: 'json' })
      const result: { title: string; detail: Message.BT.TorrentDetail.BangumiDetail }[] = []
      response.data.torrents.forEach(item => {
        result.push({
          title: item.title,
          detail: {
            id: item._id,
            url: `https://bangumi.moe/torrent/${item._id}`,
            is_loaded: true,
            content: {
              category_tag_id: item.category_tag_id,
              tag_ids: item.tag_ids,
              content: item.introduction,
            },
          },
        })
      })
      return result
    } catch (err) {
      log.error(err)
      return []
    }
  }

  async function getNyaaTorrentList() {
    try {
      const team = await axios.get('https://nyaa.si/profile', { responseType: 'text' })
      const teamName = (team.data as string).match(/Profile\sof\s<strong\sclass="text-default">([\s\S]*?)<\/strong>/)![1]
      const response = await axios.get(`https://nyaa.si/user/${teamName}`, { responseType: 'text' })
      const torrents = (response.data as string).match(/<tr\s\S*?>[\s\S]*?<\/tr>/g) ?? []
      const result: { title: string; detail: Message.BT.TorrentDetail.NyaaDetail }[] = []
      torrents.forEach(item => {
        const substr = item.match(/<td\scolspan="2">[\s\S]*?<\/td>/g)?.[0]
        if (!substr) return
        const matches = substr.match(/<a\shref="(\S*?)"\stitle="([\s\S]*?)">/)
        if (!matches) return
        const [, link, title] = matches
        result.push({
          title: unescapeHtml(title),
          detail: {
            id: link.slice(6),
            url: `https://nyaa.si${link}`,
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
    if (type == 'nyaa') result = await getNyaaTorrentDetail(id)
    if (type == 'acgrip') result = await getAcgripTorrentDetail(id)
    if (type == 'acgnx_a') result = await getAcgnxTorrentDetail(false, id)
    if (type == 'acgnx_g') result = await getAcgnxTorrentDetail(true, id)
    if (type == 'dmhy') result = await getDmhyTorrentDetail(id)
    return JSON.stringify(result)
  }

  async function getNyaaTorrentDetail(id: string) {
    try {
      const response = await axios.get(`https://nyaa.si/view/${id}/edit`, { responseType: 'text' })
      const data = response.data as string
      const content = data.match(/<textarea[\s\S]*?>([\s\S]*?)<\/textarea>/)![1]
      const category = data.match(/<option\sselected\svalue="([\s\S]*?)">/)![1]
      const information = data.match(/<input[\s\S]*?id="information"[\s\S]*?value="([\s\S]*?)"/)![1]
      const isRemake = data.includes('<input checked id="is_remake"')
      const isComplete = data.includes('<input checked id="is_complete"')
      const result: Message.BT.TorrentDetail.NyaaContent = {
        content,
        category,
        information,
        is_complete: isComplete,
        is_remake: isRemake,
      }
      return result
    } catch (err) {
      log.error(err)
      return
    }
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
    if (type == 'bangumi') result = await updateBangumiTorrent(title, id, config as Message.BT.TorrentDetail.BangumiContent)
    if (type == 'nyaa') result = await updateNyaaTorrent(title, id, config as Message.BT.TorrentDetail.NyaaContent)
    if (type == 'acgnx_a') result = await updateAcgnxTorrent(false, title, id, config as Message.BT.TorrentDetail.AcgnxContent)
    if (type == 'acgnx_g') result = await updateAcgnxTorrent(true, title, id, config as Message.BT.TorrentDetail.AcgnxContent)
    if (type == 'dmhy') result = await updateDmhyTorrent(title, id, config as Message.BT.TorrentDetail.DmhyContent)
    if (type == 'acgrip') result = await updateAcgripTorrent(title, id, config as Message.BT.TorrentDetail.AcgripContent)
    const message: Message.Task.Result = { result }
    return JSON.stringify(message)
  }

  async function updateBangumiTorrent(title: string, id: string, config: Message.BT.TorrentDetail.BangumiContent) {
    try {
      const team = await axios.get('https://bangumi.moe/api/team/myteam', { responseType: 'json' })
      const teamId: string = team.data[0]._id
      const data = {
        category_tag_id: config.category_tag_id,
        introduction: config.content.replaceAll('\n', ''),
        tag_ids: config.tag_ids,
        btskey: '',
        _id: id,
        title,
        team_id: teamId,
      }
      const response = await axios.post('https://bangumi.moe/api/torrent/update', data, { responseType: 'json' })
      if (response.status == 200 && response.data.success) return 'success'
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
  }

  async function updateNyaaTorrent(title: string, id: string, config: Message.BT.TorrentDetail.NyaaContent) {
    try {
      const formData = new FormData()
      formData.append('display_name', title)
      formData.append('category', config.category)
      formData.append('information', config.information)
      formData.append('description', config.content)
      if (config.is_complete) formData.append('is_complete', 'y')
      if (config.is_remake) formData.append('is_remake', 'y')
      formData.append('submit', 'Save Changes')
      const response = await axios.post(`https://nyaa.si/view/${id}/edit`, formData, { responseType: 'text' })
      if ((response.data as string).includes('You should be redirected automatically to target URL')) return 'success'
      return 'failed'
    } catch (err) {
      log.error(err)
      return 'failed'
    }
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
