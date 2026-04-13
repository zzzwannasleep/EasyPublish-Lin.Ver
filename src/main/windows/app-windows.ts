import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import type { Low } from 'lowdb'
import { join } from 'path'

type UserDbProvider = () => Low<Config.UserData>
type BtLoginStatusChecker = (type: string) => Promise<void>
type RefreshLoginDataHandler = () => void

interface CreateMainAppWindowOptions {
  appIcon: string
  userAgent: string
  getUserDB: UserDbProvider
}

interface OpenLoginWindowOptions {
  type: string
  appIcon: string
  userAgent: string
  getUserDB: UserDbProvider
  checkBtLoginStatus: BtLoginStatusChecker
  refreshLoginData: RefreshLoginDataHandler
}

function getLoginUrl(type: string) {
  if (type === 'bangumi') return 'https://bangumi.moe'
  if (type === 'mikan') return 'https://mikanani.me/Account/ApiLogin'
  if (type === 'nyaa') return 'https://nyaa.si/login'
  if (type === 'acgrip') return 'https://acg.rip/users/sign_in'
  if (type === 'dmhy') return 'https://www.dmhy.org/user'
  return 'https://vcb-s.com'
}

function getCookieStorageUrl(type: string) {
  if (type === 'bangumi') return 'https://bangumi.moe'
  if (type === 'mikan') return 'https://mikanani.me'
  if (type === 'nyaa') return 'https://nyaa.si'
  if (type === 'acgrip') return 'https://acg.rip'
  if (type === 'dmhy') return 'https://www.dmhy.org'
  return 'https://vcb-s.com'
}

function parseMikanApiToken(data: unknown) {
  function normalizeCandidate(value: string) {
    const token = value.trim()
    const lowered = token.toLowerCase()
    if (!token) {
      return ''
    }

    if (lowered === 'apikey' || lowered === 'api_key' || lowered === 'your_api_key') {
      return ''
    }

    if (token.includes('api/Message/apikey')) {
      return ''
    }

    return token
  }

  if (data && typeof data === 'object' && 'Message' in data) {
    const token = (data as { Message?: unknown }).Message
    return typeof token === 'string' ? normalizeCandidate(token) : ''
  }

  if (typeof data !== 'string') {
    return ''
  }

  try {
    const payload = JSON.parse(data) as { Message?: unknown }
    return typeof payload.Message === 'string' ? normalizeCandidate(payload.Message) : ''
  } catch {
    const match = data.match(/"Message"\s*:\s*"([^"]+)"/)
    return match?.[1] ? normalizeCandidate(match[1]) : ''
  }
}

function parseMikanApiTokenFromUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    if (url.origin !== 'https://api.mikanani.me') {
      return ''
    }

    const prefix = '/api/Message/'
    if (!url.pathname.startsWith(prefix)) {
      return ''
    }

    const candidate = decodeURIComponent(url.pathname.slice(prefix.length)).trim()
    if (!candidate || candidate.includes('/')) {
      return ''
    }

    const lowered = candidate.toLowerCase()
    if (lowered === 'apikey' || lowered === 'api_key' || lowered === 'your_api_key') {
      return ''
    }

    return candidate
  } catch {
    return ''
  }
}

export function createMainAppWindow(options: CreateMainAppWindowOptions) {
  const { appIcon, userAgent, getUserDB } = options
  const partition = 'persist:mainWindow'
  const mainWindow = new BrowserWindow({
    width: 1150,
    minWidth: 1150,
    minHeight: 650,
    height: 650,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      partition,
    },
    icon: appIcon,
  })

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const userDB = getUserDB()
    let type = ''
    if (details.url.includes('bangumi.moe')) type = 'bangumi'
    else if (details.url.includes('nyaa.si')) type = 'nyaa'
    else if (details.url.includes('acg.rip')) type = 'acgrip'
    else if (details.url.includes('dmhy.org')) type = 'dmhy'
    else {
      details.requestHeaders['user-agent'] = userAgent
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    const info = userDB.data.info.find(item => item.name === type) as Config.LoginInfo
    let cookieValue = ''
    info.cookies.forEach(item => {
      cookieValue += `${item.name}=${item.value}; `
    })

    details.requestHeaders['Cookie'] = cookieValue
    details.requestHeaders['user-agent'] = userAgent
    callback({ requestHeaders: details.requestHeaders })
  })

  const proxyConfig = getUserDB().data.proxyConfig
  if (proxyConfig.status) {
    session.defaultSession.setProxy({
      proxyRules: `${proxyConfig.type}://${proxyConfig.host}:${proxyConfig.port}`,
    })
  }

  mainWindow.webContents.on('render-process-gone', (_event, detail) => {
    log.error(detail)
    app.quit()
  })

  ipcMain.on('global_winHandle', (_event, message: string) => {
    const { command } = JSON.parse(message) as Message.Global.WinHandle
    if (command === 'close') {
      mainWindow.close()
      return
    }

    if (command === 'mini') {
      mainWindow.minimize()
      return
    }

    if (mainWindow.isMaximized()) {
      mainWindow.restore()
    } else {
      mainWindow.maximize()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    void mainWindow.webContents.stop()
    void shell.openExternal(url)
  })
  mainWindow.webContents.setWindowOpenHandler(details => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('close', () => app.exit())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export async function openLoginWindow(options: OpenLoginWindowOptions) {
  const { type, appIcon, userAgent, getUserDB, checkBtLoginStatus, refreshLoginData } = options
  const url = getLoginUrl(type)
  const mikanApiMessagePrefix = 'https://api.mikanani.me/api/Message/'
  const mikanApiKeyUrl = 'https://api.mikanani.me/api/Message/apikey'
  const userDB = getUserDB()
  const partition = `persist:${userDB.data.name}`
  const browserSession = session.fromPartition(partition)
  let loginWindowClosed = false
  let mikanAutoCompleteTimer: ReturnType<typeof setInterval> | undefined

  async function setCookies(accountType: string, targetUrl: string) {
    await browserSession.cookies
      .get({ url: targetUrl })
      .then(cookies => {
        userDB.data.info.find(item => item.name === accountType)!.cookies = cookies
      })
      .catch(err => {
        log.error(err)
      })

    await userDB.write()
  }

  async function fetchMikanApiToken() {
    const response = await browserSession.fetch(mikanApiKeyUrl, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': userAgent,
      },
      bypassCustomProtocolHandlers: true,
    })
    if (!response.ok) {
      log.error('[Mikan] Failed to fetch API key with session', { status: response.status })
      return ''
    }

    const token = parseMikanApiToken(await response.text())
    if (!token) {
      log.warn('[Mikan] API key endpoint returned no usable token')
    }

    return token
  }

  async function storeMikanApiToken(apiToken: string) {
    const nextToken = apiToken.trim()
    if (!nextToken) {
      return false
    }

    const info = userDB.data.info.find(item => item.name === 'mikan')
    if (!info) {
      return false
    }

    if (info.apiToken === nextToken) {
      log.info('[Mikan] API token already matches stored value')
      refreshLoginData()
      return true
    }

    log.info('[Mikan] Storing API token from login window', {
      previousLength: info.apiToken?.length ?? 0,
      nextLength: nextToken.length,
    })
    info.apiToken = nextToken
    await userDB.write()
    refreshLoginData()
    return true
  }

  const loginWindow = new BrowserWindow({
    width: 1200,
    minWidth: 950,
    minHeight: 750,
    height: 600,
    autoHideMenuBar: true,
    show: false,
    icon: appIcon,
    webPreferences: {
      partition,
    },
  })

  loginWindow.on('ready-to-show', () => {
    loginWindow.show()
  })

  function closeLoginWindowImmediately() {
    if (loginWindowClosed) {
      return false
    }

    loginWindowClosed = true
    if (mikanAutoCompleteTimer) {
      clearInterval(mikanAutoCompleteTimer)
      mikanAutoCompleteTimer = undefined
    }

    if (!loginWindow.isDestroyed()) {
      loginWindow.hide()
      setImmediate(() => {
        if (!loginWindow.isDestroyed()) {
          loginWindow.destroy()
        }
      })
    }

    return true
  }

  async function persistLoginWindowState(explicitMikanApiToken = '') {
    try {
      if (type === 'vcb') {
        await browserSession.cookies
          .get({ url })
          .then(cookies => {
            userDB.data.forum.cookies = cookies
          })
          .catch(err => {
            log.error(err)
          })
        await browserSession.cookies
          .get({ name: 'cf_clearance' })
          .then(cookies => {
            userDB.data.forum.cookies!.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        await userDB.write()
      } else {
        await setCookies(type, getCookieStorageUrl(type))
        if (type === 'mikan') {
          const apiToken = explicitMikanApiToken.trim() || (await fetchMikanApiToken())
          if (apiToken) {
            await storeMikanApiToken(apiToken)
          } else {
            log.warn('[Mikan] Login window finalized without an API token')
          }
        }
        await checkBtLoginStatus(type)
        refreshLoginData()
      }
    } catch (err) {
      log.error(err)
    }
  }

  function finalizeLoginWindow(explicitMikanApiToken = '') {
    if (!closeLoginWindowImmediately()) {
      return
    }

    void persistLoginWindowState(explicitMikanApiToken)
  }

  async function tryAutoCompleteMikanLogin() {
    if (type !== 'mikan' || loginWindowClosed || loginWindow.isDestroyed()) {
      return
    }

    try {
      const currentUrl = loginWindow.webContents.getURL()
      let apiToken = parseMikanApiTokenFromUrl(currentUrl)

      if (apiToken) {
        log.info('[Mikan] Extracted API token directly from redirect URL', {
          currentUrl,
          tokenLength: apiToken.length,
        })
        finalizeLoginWindow(apiToken)
        return
      }

      if (currentUrl.startsWith(mikanApiMessagePrefix)) {
        try {
          const bodyText = await loginWindow.webContents.executeJavaScript('document.body?.innerText ?? ""')
          apiToken = parseMikanApiToken(bodyText)
        } catch (err) {
          log.error('[Mikan] Failed to read API key page body', err)
        }
      }

      if (!apiToken && currentUrl.includes('mikanani.me')) {
        try {
          const shouldOpenApiKeyPage = await loginWindow.webContents.executeJavaScript(`
            (() => {
              const apiUrl = ${JSON.stringify(mikanApiKeyUrl)}
              const bodyText = document.body?.innerText ?? ''
              if (bodyText.includes(apiUrl)) {
                return true
              }

              return Array.from(document.querySelectorAll('a'))
                .some(anchor => (anchor instanceof HTMLAnchorElement ? anchor.href : '').includes(apiUrl))
            })()
          `)
          if (shouldOpenApiKeyPage && !currentUrl.includes(mikanApiKeyUrl)) {
            await loginWindow.loadURL(mikanApiKeyUrl)
            return
          }
        } catch (err) {
          log.error('[Mikan] Failed to inspect login page for API key entry', err)
        }
      }

      if (!apiToken) {
        apiToken = await fetchMikanApiToken()
      }

      if (!apiToken) {
        return
      }

      finalizeLoginWindow(apiToken)
    } catch (err) {
      log.error('[Mikan] Auto-complete login failed', err)
    }
  }

  loginWindow.on('close', event => {
    if (loginWindowClosed) {
      return
    }

    event.preventDefault()
    finalizeLoginWindow()
  })

  if (type === 'mikan') {
    mikanAutoCompleteTimer = setInterval(() => {
      void tryAutoCompleteMikanLogin()
    }, 1200)
    loginWindow.webContents.on('did-finish-load', () => {
      void tryAutoCompleteMikanLogin()
    })
    loginWindow.webContents.on('did-navigate', () => {
      void tryAutoCompleteMikanLogin()
    })
    loginWindow.webContents.on('did-navigate-in-page', () => {
      void tryAutoCompleteMikanLogin()
    })
  }

  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['user-agent'] = userAgent
    callback({ requestHeaders: details.requestHeaders })
  })

  const proxyConfig = userDB.data.proxyConfig
  if (proxyConfig.status) {
    await loginWindow.webContents.session.setProxy({
      proxyRules: `${proxyConfig.type}://${proxyConfig.host}:${proxyConfig.port}`,
    })
  }

  await loginWindow.loadURL(url)
}
