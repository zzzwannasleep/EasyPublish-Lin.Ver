import { safeStorage } from 'electron'
import log from 'electron-log'
import fs from 'fs/promises'
import { dirname } from 'path'
import { defaultUserData } from './defaults'

const SECURE_VALUE_PREFIX = 'secure:v1:'

let warnedAboutUnavailableEncryption = false

type StoredSecret = unknown

type StoredLoginInfo = Omit<Config.LoginInfo, 'password' | 'cookies' | 'apiToken'> & {
  password: StoredSecret
  apiToken?: StoredSecret
  cookies: StoredSecret
}

type StoredForumCredentials = Omit<Config.UserData['forum'], 'password' | 'cookies'> & {
  password: StoredSecret
  cookies?: StoredSecret
}

type StoredAcgnxApiConfig = Omit<Config.AcgnXAPIConfig, 'asia' | 'global'> & {
  asia: Omit<Config.AcgnXAPIConfig['asia'], 'token'> & { token: StoredSecret }
  global: Omit<Config.AcgnXAPIConfig['global'], 'token'> & { token: StoredSecret }
}

type StoredPtSiteConfig = Omit<Config.PTSiteConfig, 'password' | 'apiToken'> & {
  password: StoredSecret
  apiToken?: StoredSecret
}

type StoredUserData = Omit<Config.UserData, 'info' | 'forum' | 'acgnxAPI' | 'ptSites'> & {
  info: StoredLoginInfo[]
  forum: StoredForumCredentials
  acgnxAPI?: StoredAcgnxApiConfig
  ptSites?: StoredPtSiteConfig[]
}

function cloneDefaultUserData(): Config.UserData {
  return JSON.parse(JSON.stringify(defaultUserData)) as Config.UserData
}

function getDefaultAcgnxApiConfig(): Config.AcgnXAPIConfig {
  return cloneDefaultUserData().acgnxAPI ?? {
    enable: false,
    asia: {
      uid: '',
      token: '',
    },
    global: {
      uid: '',
      token: '',
    },
  }
}

function isEncryptionAvailable() {
  const available = safeStorage.isEncryptionAvailable()
  if (!available && !warnedAboutUnavailableEncryption) {
    warnedAboutUnavailableEncryption = true
    log.warn('safeStorage is unavailable; sensitive user data will remain unencrypted on disk')
  }
  return available
}

function encryptSecret(value: unknown): StoredSecret {
  if (value === undefined) {
    return undefined
  }

  if (!isEncryptionAvailable()) {
    return value
  }

  const raw = JSON.stringify(value)
  const encrypted = safeStorage.encryptString(raw)
  return `${SECURE_VALUE_PREFIX}${encrypted.toString('base64')}`
}

function decryptSecret<T>(value: StoredSecret, fallback: T): T {
  if (value === undefined || value === null) {
    return fallback
  }

  if (typeof value === 'string' && value.startsWith(SECURE_VALUE_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage is unavailable and secure user data cannot be decrypted')
    }

    const encrypted = Buffer.from(value.slice(SECURE_VALUE_PREFIX.length), 'base64')
    return JSON.parse(safeStorage.decryptString(encrypted)) as T
  }

  return value as T
}

function normalizeUserData(data: Config.UserData | null | undefined): Config.UserData {
  const defaults = cloneDefaultUserData()
  const defaultAcgnxApi = getDefaultAcgnxApiConfig()
  const source = data ?? defaults

  return {
    ...defaults,
    ...source,
    proxyConfig: {
      ...defaults.proxyConfig,
      ...(source.proxyConfig ?? {}),
    },
    acgnxAPI: {
      ...defaultAcgnxApi,
      ...(source.acgnxAPI ?? {}),
      asia: {
        ...defaultAcgnxApi.asia,
        ...(source.acgnxAPI?.asia ?? {}),
      },
      global: {
        ...defaultAcgnxApi.global,
        ...(source.acgnxAPI?.global ?? {}),
      },
    },
    forum: {
      ...defaults.forum,
      ...(source.forum ?? {}),
      cookies: source.forum?.cookies ?? defaults.forum.cookies,
    },
    ptSites: (source.ptSites ?? []).map(site => ({
      id: site.id,
      name: site.name,
      adapter: site.adapter,
      baseUrl: site.baseUrl,
      enabled: site.enabled ?? true,
      username: site.username ?? '',
      password: site.password ?? '',
      apiToken: site.apiToken ?? '',
      lastCheckAt: site.lastCheckAt,
      healthStatus: site.healthStatus,
      statusMessage: site.statusMessage,
    })),
    info: defaults.info.map(defaultInfo => {
      const current = source.info?.find(item => item.name === defaultInfo.name)
      return {
        ...defaultInfo,
        ...(current ?? {}),
        cookies: current?.cookies ?? defaultInfo.cookies,
      }
    }),
  }
}

function serializeUserData(data: Config.UserData): StoredUserData {
  const normalized = normalizeUserData(data)

  return {
    ...normalized,
    info: normalized.info.map(info => ({
      ...info,
      password: encryptSecret(info.password),
      apiToken: encryptSecret(info.apiToken ?? ''),
      cookies: encryptSecret(info.cookies),
    })),
    forum: {
      ...normalized.forum,
      password: encryptSecret(normalized.forum.password),
      cookies: encryptSecret(normalized.forum.cookies ?? []),
    },
    ptSites: normalized.ptSites?.map(site => ({
      ...site,
      password: encryptSecret(site.password),
      apiToken: encryptSecret(site.apiToken ?? ''),
    })),
    acgnxAPI: normalized.acgnxAPI
      ? {
          ...normalized.acgnxAPI,
          asia: {
            ...normalized.acgnxAPI.asia,
            token: encryptSecret(normalized.acgnxAPI.asia.token),
          },
          global: {
            ...normalized.acgnxAPI.global,
            token: encryptSecret(normalized.acgnxAPI.global.token),
          },
        }
      : undefined,
  }
}

function deserializeUserData(raw: StoredUserData | null | undefined): Config.UserData {
  const normalized = normalizeUserData(raw as Config.UserData | null | undefined)
  const normalizedAcgnxApi = normalized.acgnxAPI ?? getDefaultAcgnxApiConfig()

  return {
    ...normalized,
    info: normalized.info.map(info => {
      const storedInfo = raw?.info?.find(item => item.name === info.name)
      return {
        ...info,
        password: decryptSecret(storedInfo?.password, info.password),
        apiToken: decryptSecret(storedInfo?.apiToken, info.apiToken ?? ''),
        cookies: decryptSecret(storedInfo?.cookies, info.cookies),
      }
    }),
    forum: {
      ...normalized.forum,
      password: decryptSecret(raw?.forum?.password, normalized.forum.password),
      cookies: decryptSecret(raw?.forum?.cookies, normalized.forum.cookies ?? []),
    },
    ptSites: normalized.ptSites?.map(site => {
      const storedSite = raw?.ptSites?.find(item => item.id === site.id)
      return {
        ...site,
        password: decryptSecret(storedSite?.password, site.password),
        apiToken: decryptSecret(storedSite?.apiToken, site.apiToken ?? ''),
      }
    }) ?? [],
    acgnxAPI: {
      ...normalizedAcgnxApi,
      asia: {
        ...normalizedAcgnxApi.asia,
        token: decryptSecret(raw?.acgnxAPI?.asia?.token, normalizedAcgnxApi.asia.token),
      },
      global: {
        ...normalizedAcgnxApi.global,
        token: decryptSecret(raw?.acgnxAPI?.global?.token, normalizedAcgnxApi.global.token),
      },
    },
  }
}

export class SecureUserDataFile {
  constructor(private readonly filename: string) {}

  async read(): Promise<Config.UserData | null> {
    try {
      const text = await fs.readFile(this.filename, { encoding: 'utf-8' })
      return deserializeUserData(JSON.parse(text) as StoredUserData)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async write(data: Config.UserData): Promise<void> {
    await fs.mkdir(dirname(this.filename), { recursive: true })
    await fs.writeFile(this.filename, JSON.stringify(serializeUserData(data), null, 2), {
      encoding: 'utf-8',
    })
  }
}

export function mergeUserDataWithDefaults(data: Config.UserData | null | undefined): Config.UserData {
  return normalizeUserData(data)
}
