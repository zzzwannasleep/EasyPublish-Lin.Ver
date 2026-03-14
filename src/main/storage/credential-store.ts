import type { Cookie } from 'electron'
import { Low } from 'lowdb'
import type { SiteAccount, SiteCredentialRecord } from '../../shared/types/account'
import type { PtSiteAdapterKind, PtSiteDraft } from '../../shared/types/pt-site'
import type { SiteCapability, SiteId, SiteProfile } from '../../shared/types/site'

type UserDbProvider = () => Low<Config.UserData>

interface CreateCredentialStoreOptions {
  getUserDB: UserDbProvider
}

const legacyTorrentSiteIds = [
  'bangumi',
  'mikan',
  'miobt',
  'nyaa',
  'acgrip',
  'dmhy',
  'acgnx_a',
  'acgnx_g',
] as const

const legacyPtSiteIds = ['acgrip', 'dmhy', 'acgnx_a', 'acgnx_g'] as const

const ptCapabilitiesByAdapter: Record<PtSiteAdapterKind, SiteCapability[]> = {
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

function mapHealthStatus(info: Config.LoginInfo): SiteAccount['healthStatus'] {
  if (!info.enable) return 'disabled'

  const status = info.status.trim()
  if (status.includes('API credentials configured') || status.includes('已配置 API 凭据')) return 'authenticated'
  if (status.includes('API credentials missing') || status.includes('缺少 API 凭据')) return 'unauthenticated'
  if (status.includes('API credentials rejected') || status.includes('API 凭据无效')) return 'error'
  if (status.includes('API token configured') || status.includes('已配置 API Token')) return 'authenticated'
  if (status.includes('API token missing') || status.includes('缺少 API Token')) return 'unauthenticated'
  if (status.includes('API token rejected') || status.includes('API Token 无效')) return 'error'
  if (status.includes('账号已登录')) return 'authenticated'
  if (status.includes('账号未登录')) return 'unauthenticated'
  if (status.includes('访问失败') || status.includes('错误')) return 'error'
  if (status.includes('正在登录')) return 'checking'
  if (status.includes('已登录')) return 'authenticated'
  if (status.includes('未登录')) return 'unauthenticated'
  if (status.includes('防火墙')) return 'blocked'
  if (status.includes('访问失败') || status.includes('错误')) return 'error'
  if (status.includes('正在登录')) return 'checking'
  return 'unknown'
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

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getSiteLoginInfo(siteId: (typeof legacyTorrentSiteIds)[number]) {
    return getUserDBOrThrow().data.info.find(item => item.name === siteId)!
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

    if (siteId === 'mikan' || siteId === 'miobt') {
      return getSiteLoginInfo(siteId).apiToken || undefined
    }

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
    if (!isLegacySite(siteId)) {
      const site = getCustomPtSite(siteId)
      if (!site) {
        throw new Error(`Site ${siteId} does not exist`)
      }

      return {
        siteId,
        authMode: site.apiToken ? 'api_token' : 'username_password',
        username: site.username,
        enabled: site.enabled,
        lastCheckAt: site.lastCheckAt,
        healthStatus: site.enabled ? site.healthStatus ?? 'unknown' : 'disabled',
        legacyStatus: site.statusMessage,
      }
    }

    const info = getSiteLoginInfo(siteId)
    const apiToken = getSiteApiToken(siteId)
    return {
      siteId,
      authMode: siteId === 'mikan' || siteId === 'miobt' || apiToken ? 'api_token' : 'username_password',
      username: info.username,
      enabled: info.enable,
      lastCheckAt: info.time,
      healthStatus: mapHealthStatus(info),
      legacyStatus: info.status,
    }
  }

  function getSiteCredentialRecord(siteId: SiteId): SiteCredentialRecord {
    if (!isLegacySite(siteId)) {
      const site = getCustomPtSite(siteId)
      if (!site) {
        throw new Error(`Site ${siteId} does not exist`)
      }

      return {
        siteId,
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
    return getCustomPtSites().map(createCustomPtSiteProfile)
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
    if (adapter !== 'nexusphp' && adapter !== 'unit3d') {
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
    await userDB.write()
    return id
  }

  async function removeManagedPtSite(siteId: SiteId) {
    if (isLegacyPtSite(siteId)) {
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
    getForumCredentials,
    saveForumCredentials,
    getAcgnxApiConfig,
    setAcgnxApiConfig,
  }
}
