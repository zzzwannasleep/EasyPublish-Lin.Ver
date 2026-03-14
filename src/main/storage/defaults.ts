export const defaultTaskData: Config.TaskData = { tasks: [] }

function createDefaultLoginInfo(name: string): Config.LoginInfo {
  return {
    name,
    time: '--',
    status: '账号未登录',
    username: '',
    password: '',
    apiToken: '',
    enable: false,
    cookies: [],
  }
}

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
  ptSites: [],
  forum: { username: '', password: '', cookies: [] },
  info: [
    createDefaultLoginInfo('bangumi'),
    createDefaultLoginInfo('nyaa'),
    {
      ...createDefaultLoginInfo('mikan'),
      status: 'API token missing',
    },
    {
      ...createDefaultLoginInfo('miobt'),
      status: 'API credentials missing',
    },
    createDefaultLoginInfo('acgrip'),
    createDefaultLoginInfo('dmhy'),
    createDefaultLoginInfo('acgnx_g'),
    createDefaultLoginInfo('acgnx_a'),
  ],
}
