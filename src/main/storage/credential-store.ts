import type { Cookie } from 'electron'
import { Low } from 'lowdb'
import type { SiteAccount, SiteCredentialRecord } from '../../shared/types/account'
import type { SiteId } from '../../shared/types/site'

type UserDbProvider = () => Low<Config.UserData>

interface CreateCredentialStoreOptions {
  getUserDB: UserDbProvider
}

const torrentSiteIds: Exclude<SiteId, 'forum'>[] = [
  'bangumi',
  'nyaa',
  'acgrip',
  'dmhy',
  'acgnx_a',
  'acgnx_g',
]

function mapHealthStatus(info: Config.LoginInfo): SiteAccount['healthStatus'] {
  if (!info.enable) return 'disabled'
  return 'unknown'
}

export function createCredentialStore(options: CreateCredentialStoreOptions) {
  const { getUserDB } = options

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getSiteLoginInfo(siteId: Exclude<SiteId, 'forum'>) {
    return getUserDBOrThrow().data.info.find(item => item.name === siteId)!
  }

  function getSiteCookies(siteId: Exclude<SiteId, 'forum'>): Cookie[] {
    return getSiteLoginInfo(siteId).cookies
  }

  function getSiteApiToken(siteId: Exclude<SiteId, 'forum'>) {
    const acgnxAPI = getUserDBOrThrow().data.acgnxAPI
    if (!acgnxAPI?.enable) {
      return undefined
    }

    if (siteId === 'acgnx_a') {
      return acgnxAPI.asia.token || undefined
    }

    if (siteId === 'acgnx_g') {
      return acgnxAPI.global.token || undefined
    }

    return undefined
  }

  async function setSiteCookies(siteId: Exclude<SiteId, 'forum'>, cookies: Cookie[]) {
    const userDB = getUserDBOrThrow()
    const info = userDB.data.info.find(item => item.name === siteId)!
    info.cookies = cookies
    await userDB.write()
  }

  function getSiteAccount(siteId: Exclude<SiteId, 'forum'>): SiteAccount {
    const info = getSiteLoginInfo(siteId)
    const apiToken = getSiteApiToken(siteId)
    return {
      siteId,
      authMode: apiToken ? 'api_token' : 'username_password',
      username: info.username,
      enabled: info.enable,
      lastCheckAt: info.time,
      healthStatus: mapHealthStatus(info),
      legacyStatus: info.status,
    }
  }

  function getSiteCredentialRecord(siteId: Exclude<SiteId, 'forum'>): SiteCredentialRecord {
    const info = getSiteLoginInfo(siteId)
    return {
      siteId,
      username: info.username || undefined,
      password: info.password || undefined,
      apiToken: getSiteApiToken(siteId),
      cookies: info.cookies?.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      })),
    }
  }

  function listSiteAccounts(): SiteAccount[] {
    return torrentSiteIds.map(getSiteAccount)
  }

  function getForumCredentials() {
    const forum = getUserDBOrThrow().data.forum
    return {
      username: forum.username,
      password: forum.password,
      cookies: forum.cookies ?? [],
    }
  }

  async function saveForumCredentials(credentials: {
    username: string
    password: string
    cookies?: Cookie[]
  }) {
    const userDB = getUserDBOrThrow()
    userDB.data.forum.username = credentials.username
    userDB.data.forum.password = credentials.password
    if (credentials.cookies) {
      userDB.data.forum.cookies = credentials.cookies
    }
    await userDB.write()
  }

  function getAcgnxApiConfig() {
    return getUserDBOrThrow().data.acgnxAPI
  }

  async function setAcgnxApiConfig(config: Config.AcgnXAPIConfig) {
    const userDB = getUserDBOrThrow()
    userDB.data.acgnxAPI = config
    await userDB.write()
  }

  return {
    getSiteCookies,
    setSiteCookies,
    getSiteAccount,
    getSiteCredentialRecord,
    listSiteAccounts,
    getForumCredentials,
    saveForumCredentials,
    getAcgnxApiConfig,
    setAcgnxApiConfig,
  }
}
