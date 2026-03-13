import { Low } from 'lowdb'
import type { AppSettings } from '../../shared/types/settings'

type UserDbProvider = () => Low<Config.UserData>

interface CreateSettingsStoreOptions {
  getUserDB: UserDbProvider
}

export function createSettingsStore(options: CreateSettingsStoreOptions) {
  const { getUserDB } = options

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getProxyConfig() {
    return getUserDBOrThrow().data.proxyConfig
  }

  async function setProxyConfig(proxyConfig: Config.ProxyConfig) {
    const userDB = getUserDBOrThrow()
    userDB.data.proxyConfig = proxyConfig
    await userDB.write()
  }

  function getConfigName() {
    return getUserDBOrThrow().data.name || 'default'
  }

  async function setConfigName(name: string) {
    const userDB = getUserDBOrThrow()
    userDB.data.name = name
    await userDB.write()
  }

  function getAppSettings(): AppSettings {
    return {
      theme: 'system',
      language: 'zh-CN',
      proxy: getProxyConfig(),
      logLevel: 'info',
      updatePolicy: 'manual',
      activeConfigName: getConfigName(),
    }
  }

  return {
    getProxyConfig,
    setProxyConfig,
    getConfigName,
    setConfigName,
    getAppSettings,
  }
}

