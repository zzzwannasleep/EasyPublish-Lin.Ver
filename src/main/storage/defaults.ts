import { legacyApiStatusText, legacyAccountStatusText } from '../../shared/utils/legacy-account-status'

export const defaultTaskData: Config.TaskData = { tasks: [] }

function createDefaultLoginInfo(name: string): Config.LoginInfo {
  return {
    name,
    time: '--',
    status: legacyAccountStatusText.loggedOut,
    username: '',
    password: '',
    apiToken: '',
    enable: false,
    cookies: [],
  }
}

function createDefaultManagedPtSite(
  id: string,
  name: string,
  baseUrl: string,
  adapter: Config.PTSiteConfig['adapter'],
): Config.PTSiteConfig {
  return {
    id,
    name,
    adapter,
    baseUrl,
    enabled: true,
    apiUid: '',
    username: '',
    password: '',
    apiToken: '',
    healthStatus: 'unknown',
    statusMessage: '尚未校验账号',
  }
}

export const defaultManagedPtSites: Config.PTSiteConfig[] = [
  createDefaultManagedPtSite('acgnx_a', '末日动漫', 'https://share.acgnx.se', 'acgnx'),
  createDefaultManagedPtSite('acgnx_g', 'AcgnX', 'https://www.acgnx.se', 'acgnx'),
]

export const defaultUserData: Config.UserData = {
  proxyConfig: {
    status: false,
    type: '',
    host: '',
    port: 8080,
  },
  name: 'default',
  acgnxAPI: {
    enable: false,
    asia: {
      uid: '',
      token: '',
    },
    global: {
      uid: '',
      token: '',
    },
  },
  ptSites: defaultManagedPtSites,
  forum: {
    username: '',
    password: '',
    cookies: [],
    healthStatus: 'unknown',
    statusMessage: '主站账号尚未检测',
  },
  info: [
    createDefaultLoginInfo('bangumi'),
    createDefaultLoginInfo('nyaa'),
    {
      ...createDefaultLoginInfo('mikan'),
      status: legacyApiStatusText.tokenMissing,
    },
    {
      ...createDefaultLoginInfo('anibt'),
      status: legacyApiStatusText.tokenMissing,
    },
    {
      ...createDefaultLoginInfo('miobt'),
      status: legacyApiStatusText.credentialsMissing,
    },
    createDefaultLoginInfo('acgrip'),
    createDefaultLoginInfo('dmhy'),
    createDefaultLoginInfo('acgnx_g'),
    createDefaultLoginInfo('acgnx_a'),
  ],
}
