import type { Cookie } from 'electron'
import { Low } from 'lowdb'
import type { SiteAccount, SiteCredentialRecord } from '../../shared/types/account'
import type { PtSiteAdapterKind, PtSiteDraft } from '../../shared/types/pt-site'
import type { SiteCapability, SiteId, SiteProfile } from '../../shared/types/site'
import { resolveLegacyAccountHealthStatus } from '../../shared/utils/legacy-account-status'

type UserDbProvider = () => Low<Config.UserData>

interface CreateCredentialStoreOptions {
  getUserDB: UserDbProvider
}

const legacyTorrentSiteIds = [
  'bangumi',
  'mikan',
  'anibt',
  'miobt',
  'nyaa',
  'acgrip',
  'dmhy',
] as const

const legacyPtSiteIds = ['acgrip', 'dmhy'] as const
const builtInManagedPtSiteIds = ['acgnx_a', 'acgnx_g'] as const

const ptCapabilitiesByAdapter: Record<PtSiteAdapterKind, SiteCapability[]> = {
  acgnx: ['torrent_publish', 'token_auth', 'content_preview', 'raw_response'],
  nexusphp: [
    'torrent_publish',
    'cookie_auth',
    'token_auth',
    'username_password_auth',
    'metadata_sections',
    'metadata_tags',
    'metadata_sub_categories',
    'content_preview',
    'raw_response',
    'nfo_upload',
  ],
  unit3d: ['torrent_publish', 'token_auth', 'raw_response', 'nfo_upload'],
}

function isLegacySite(siteId: string): siteId is (typeof legacyTorrentSiteIds)[number] {
  return legacyTorrentSiteIds.includes(siteId as (typeof legacyTorrentSiteIds)[number])
}

function isLegacyPtSite(siteId: string): siteId is (typeof legacyPtSiteIds)[number] {
  return legacyPtSiteIds.includes(siteId as (typeof legacyPtSiteIds)[number])
}

function isBuiltInManagedPtSite(siteId: string): siteId is (typeof builtInManagedPtSiteIds)[number] {
  return builtInManagedPtSiteIds.includes(siteId as (typeof builtInManagedPtSiteIds)[number])
}

function mapHealthStatus(info: Config.LoginInfo): SiteAccount['healthStatus'] {
  return resolveLegacyAccountHealthStatus(info.status, info.enable)
}

function createCustomPtSiteProfile(config: Config.PTSiteConfig): SiteProfile {
  const adapter = config.adapter

  return {
    id: config.id,
    name: config.name.trim(),
    adapter,
    baseUrl: config.baseUrl.trim(),
    enabled: config.enabled,
    capabilities: [...ptCapabilitiesByAdapter[adapter]],
  }
}

function toCustomPtSiteId(seed: string) {
  return `pt-${seed
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || Date.now().toString()}`
}

export function createCredentialStore(options: CreateCredentialStoreOptions) {
  const { getUserDB } = options

  function createDefaultLoginInfo(name: (typeof legacyTorrentSiteIds)[number]): Config.LoginInfo {
    return {
      name,
      time: '--',
      status:
        name === 'miobt'
          ? 'API credentials missing'
          : name === 'mikan' || name === 'anibt'
            ? 'API token missing'
            : '账号未登录',
      username: '',
      password: '',
      apiToken: '',
      enable: false,
      cookies: [],
    }
  }

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getSiteLoginInfo(siteId: (typeof legacyTorrentSiteIds)[number]) {
    const userDB = getUserDBOrThrow()
    let info = userDB.data.info.find(item => item.name === siteId)
    if (!info) {
      info = createDefaultLoginInfo(siteId)
      userDB.data.info.push(info)
    }
    return info
  }

  function getCustomPtSites() {
    return [...(getUserDBOrThrow().data.ptSites ?? [])]
  }

  function getCustomPtSite(siteId: string) {
    return getCustomPtSites().find(item => item.id === siteId)
  }

  function getSiteCookies(siteId: SiteId): Cookie[] {
    if (!isLegacySite(siteId)) {
      return []
    }

    return getSiteLoginInfo(siteId).cookies
  }

  function getSiteApiToken(siteId: SiteId) {
    if (!isLegacySite(siteId)) {
      return getCustomPtSite(siteId)?.apiToken || undefined
    }

    if (siteId === 'mikan' || siteId === 'anibt' || siteId === 'miobt') {
      return getSiteLoginInfo(siteId).apiToken || undefined
    }

    return undefined
  }

  async function setSiteCookies(siteId: SiteId, cookies: Cookie[]) {
    if (!isLegacySite(siteId)) {
      throw new Error(`Site ${siteId} does not support cookie storage`)
    }

    const userDB = getUserDBOrThrow()
    const info = userDB.data.info.find(item => item.name === siteId)!
    info.cookies = cookies
    await userDB.write()
  }

  function getSiteAccount(siteId: SiteId): SiteAccount {
    if (siteId === 'forum') {
      const forum = getUserDBOrThrow().data.forum
      const hasCredentials = Boolean(forum.username.trim() && forum.password)
      return {
        siteId,
        authMode: 'username_password',
        username: forum.username,
        enabled: true,
        lastCheckAt: forum.lastCheckAt,
        healthStatus: forum.healthStatus ?? (hasCredentials ? 'unknown' : 'unauthenticated'),
        legacyStatus: forum.statusMessage,
      }
    }

    if (!isLegacySite(siteId)) {
      const site = getCustomPtSite(siteId)
      if (!site) {
        throw new Error(`Site ${siteId} does not exist`)
      }

      return {
        siteId,
        authMode: site.apiToken || site.apiUid ? 'api_token' : 'username_password',
        username: site.username,
        enabled: site.enabled,
        lastCheckAt: site.lastCheckAt,
        healthStatus: site.enabled ? site.healthStatus ?? 'unknown' : 'disabled',
        legacyStatus: site.statusMessage,
      }
    }

    const info = getSiteLoginInfo(siteId)
    const apiToken = getSiteApiToken(siteId)
    const hasCookies = Boolean(info.cookies?.length)
    return {
      siteId,
      authMode:
        siteId === 'mikan' || siteId === 'anibt' || siteId === 'miobt' || apiToken
          ? 'api_token'
          : hasCookies
            ? 'cookie'
            : 'username_password',
      username: info.username,
      enabled: info.enable,
      lastCheckAt: info.time,
      healthStatus: mapHealthStatus(info),
      legacyStatus: info.status,
    }
  }

  function getSiteCredentialRecord(siteId: SiteId): SiteCredentialRecord {
    if (siteId === 'forum') {
      const forum = getUserDBOrThrow().data.forum
      return {
        siteId,
        username: forum.username || undefined,
        password: forum.password || undefined,
        cookies: forum.cookies?.map(cookie => ({
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

    if (!isLegacySite(siteId)) {
      const site = getCustomPtSite(siteId)
      if (!site) {
        throw new Error(`Site ${siteId} does not exist`)
      }

      return {
        siteId,
        apiUid: site.apiUid || undefined,
        username: site.username || undefined,
        password: site.password || undefined,
        apiToken: site.apiToken || undefined,
      }
    }

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
    return [...legacyTorrentSiteIds, ...getCustomPtSites().map(site => site.id)].map(getSiteAccount)
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
    userDB.data.forum.lastCheckAt = undefined
    userDB.data.forum.healthStatus = credentials.username.trim() && credentials.password ? 'unknown' : 'unauthenticated'
    userDB.data.forum.statusMessage =
      credentials.username.trim() && credentials.password ? '主站账号已更新，等待检测' : '主站账号未配置'
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

  function listCustomSiteProfiles(): SiteProfile[] {
    return getCustomPtSites()
      .filter(site => !isBuiltInManagedPtSite(site.id))
      .map(createCustomPtSiteProfile)
  }

  async function saveManagedPtSite(draft: PtSiteDraft) {
    const userDB = getUserDBOrThrow()
    const existingLegacyInfo = isLegacyPtSite(draft.id ?? '') ? getSiteLoginInfo(draft.id as (typeof legacyPtSiteIds)[number]) : undefined

    if (existingLegacyInfo) {
      existingLegacyInfo.username = draft.username?.trim() ?? existingLegacyInfo.username
      existingLegacyInfo.password = draft.password ?? existingLegacyInfo.password
      existingLegacyInfo.enable = draft.enabled
      await userDB.write()
      return draft.id as SiteId
    }

    const adapter = draft.adapter
    if (adapter !== 'acgnx' && adapter !== 'nexusphp' && adapter !== 'unit3d') {
      throw new Error(`Unsupported PT adapter: ${draft.adapter}`)
    }

    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim()
    if (!name) {
      throw new Error('PT site name is required')
    }
    if (!baseUrl) {
      throw new Error('PT site URL is required')
    }

    const ptSites = userDB.data.ptSites ?? []
    const id = draft.id?.trim() || toCustomPtSiteId(`${name}-${baseUrl}-${Date.now()}`)
    const nextSite: Config.PTSiteConfig = {
      id,
      name,
      adapter,
      baseUrl,
      enabled: draft.enabled,
      apiUid: draft.apiUid?.trim() ?? '',
      username: draft.username?.trim() ?? '',
      password: draft.password ?? '',
      apiToken: draft.apiToken?.trim() ?? '',
      lastCheckAt: draft.id ? getCustomPtSite(id)?.lastCheckAt : undefined,
      healthStatus: draft.id ? getCustomPtSite(id)?.healthStatus : undefined,
      statusMessage: draft.id ? getCustomPtSite(id)?.statusMessage : undefined,
    }

    const index = ptSites.findIndex(site => site.id === id)
    if (index >= 0) {
      ptSites[index] = nextSite
    } else {
      ptSites.push(nextSite)
    }

    userDB.data.ptSites = ptSites

    if (id === 'acgnx_a') {
      userDB.data.acgnxAPI = {
        ...(userDB.data.acgnxAPI ?? {
          enable: false,
          asia: { uid: '', token: '' },
          global: { uid: '', token: '' },
        }),
        enable: Boolean(nextSite.apiUid || nextSite.apiToken || userDB.data.acgnxAPI?.global.uid || userDB.data.acgnxAPI?.global.token),
        asia: {
          uid: nextSite.apiUid ?? '',
          token: nextSite.apiToken ?? '',
        },
        global: {
          uid: userDB.data.acgnxAPI?.global.uid ?? '',
          token: userDB.data.acgnxAPI?.global.token ?? '',
        },
      }
    }

    if (id === 'acgnx_g') {
      userDB.data.acgnxAPI = {
        ...(userDB.data.acgnxAPI ?? {
          enable: false,
          asia: { uid: '', token: '' },
          global: { uid: '', token: '' },
        }),
        enable: Boolean(userDB.data.acgnxAPI?.asia.uid || userDB.data.acgnxAPI?.asia.token || nextSite.apiUid || nextSite.apiToken),
        asia: {
          uid: userDB.data.acgnxAPI?.asia.uid ?? '',
          token: userDB.data.acgnxAPI?.asia.token ?? '',
        },
        global: {
          uid: nextSite.apiUid ?? '',
          token: nextSite.apiToken ?? '',
        },
      }
    }

    await userDB.write()
    return id
  }

  async function removeManagedPtSite(siteId: SiteId) {
    if (isLegacyPtSite(siteId) || isBuiltInManagedPtSite(siteId)) {
      throw new Error('Built-in PT sites cannot be removed')
    }

    const userDB = getUserDBOrThrow()
    const current = userDB.data.ptSites ?? []
    userDB.data.ptSites = current.filter(site => site.id !== siteId)
    await userDB.write()
  }

  async function recordCustomPtSiteValidation(
    siteId: SiteId,
    status: SiteAccount['healthStatus'],
    message?: string,
  ) {
    const userDB = getUserDBOrThrow()
    const ptSite = userDB.data.ptSites?.find(site => site.id === siteId)
    if (!ptSite) {
      return
    }

    ptSite.lastCheckAt = new Date().toISOString()
    ptSite.healthStatus = status
    ptSite.statusMessage = message
    await userDB.write()
  }

  async function recordForumValidation(
    status: SiteAccount['healthStatus'],
    message?: string,
  ) {
    const userDB = getUserDBOrThrow()
    userDB.data.forum.lastCheckAt = new Date().toISOString()
    userDB.data.forum.healthStatus = status
    userDB.data.forum.statusMessage = message
    await userDB.write()
  }

  return {
    getSiteCookies,
    setSiteCookies,
    getSiteAccount,
    getSiteCredentialRecord,
    listSiteAccounts,
    getCustomPtSite,
    listCustomSiteProfiles,
    saveManagedPtSite,
    removeManagedPtSite,
    recordCustomPtSiteValidation,
    recordForumValidation,
    getForumCredentials,
    saveForumCredentials,
    getAcgnxApiConfig,
    setAcgnxApiConfig,
  }
}
