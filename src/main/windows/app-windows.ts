import { app, shell, BrowserWindow, ipcMain, net, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import fs from 'fs'
import log from 'electron-log'
import type { Low } from 'lowdb'
import { join } from 'path'

type UserDbProvider = () => Low<Config.UserData>
type BtLoginStatusChecker = (type: string) => Promise<void>
type RefreshLoginDataHandler = () => void

interface CreateMainAppWindowOptions {
  appIcon: string
  nyaaResponse: string
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
  if (type === 'acgnx_g') return 'https://www.acgnx.se/user.php?o=login'
  if (type === 'acgnx_a') return 'https://share.acgnx.se/user.php?o=login'
  return 'https://vcb-s.com'
}

function buildCookieHeader(cookies: Electron.Cookie[]) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

function parseMikanApiToken(data: unknown) {
  if (data && typeof data === 'object' && 'Message' in data) {
    const token = (data as { Message?: unknown }).Message
    return typeof token === 'string' ? token.trim() : ''
  }

  if (typeof data !== 'string') {
    return ''
  }

  try {
    const payload = JSON.parse(data) as { Message?: unknown }
    return typeof payload.Message === 'string' ? payload.Message.trim() : ''
  } catch {
    const match = data.match(/"Message"\s*:\s*"([^"]+)"/)
    return match?.[1]?.trim() ?? ''
  }
}

export function createMainAppWindow(options: CreateMainAppWindowOptions) {
  const { appIcon, nyaaResponse, userAgent, getUserDB } = options
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

  const browserSession = session.fromPartition(partition)

  browserSession.protocol.handle('https', async req => {
    try {
      const { host, pathname } = new URL(req.url)
      if (pathname === '/grecaptcha' && host === 'nyaa.si') {
        const data = fs.readFileSync(nyaaResponse, { encoding: 'utf-8' })
        return new Response(data, {
          headers: { 'content-type': 'text/html' },
        })
      }
      return net.fetch(req, { bypassCustomProtocolHandlers: true })
    } catch (err) {
      log.error(err)
      return new Response('bad', {
        status: 400,
        headers: { 'content-type': 'text/html' },
      })
    }
  })

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const userDB = getUserDB()
    let type = ''
    if (details.url.includes('bangumi.moe')) type = 'bangumi'
    else if (details.url.includes('nyaa.si')) type = 'nyaa'
    else if (details.url.includes('acg.rip')) type = 'acgrip'
    else if (details.url.includes('dmhy.org')) type = 'dmhy'
    else if (details.url.includes('share.acgnx.se')) type = 'acgnx_a'
    else if (details.url.includes('www.acgnx.se')) type = 'acgnx_g'
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
  const userDB = getUserDB()
  const partition = `persist:${userDB.data.name}`
  const browserSession = session.fromPartition(partition)

  async function setCookies(accountType: string, targetUrl: string) {
    await browserSession.cookies
      .get({ url: targetUrl })
      .then(cookies => {
        userDB.data.info.find(item => item.name === accountType)!.cookies = cookies
      })
      .catch(err => {
        log.error(err)
      })

    if (accountType.includes('acgnx')) {
      await browserSession.cookies
        .get({ name: 'cf_clearance' })
        .then(cookies => {
          userDB.data.info.find(item => item.name === accountType)!.cookies.push(...cookies)
        })
        .catch(err => {
          log.error(err)
        })
    }

    await userDB.write()
  }

  async function fetchMikanApiToken() {
    const [siteCookies, apiCookies] = await Promise.all([
      browserSession.cookies.get({ url: 'https://mikanani.me' }),
      browserSession.cookies.get({ url: 'https://api.mikanani.me' }),
    ])
    const cookies = [...siteCookies, ...apiCookies].filter(
      (cookie, index, list) =>
        list.findIndex(
          item =>
            item.name === cookie.name &&
            item.domain === cookie.domain &&
            item.path === cookie.path &&
            item.value === cookie.value,
        ) === index,
    )
    const cookieHeader = buildCookieHeader(cookies)
    if (!cookieHeader) {
      return ''
    }

    const response = await net.fetch('https://api.mikanani.me/api/Message/apikey', {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: cookieHeader,
        'User-Agent': userAgent,
      },
      bypassCustomProtocolHandlers: true,
    })
    if (!response.ok) {
      return ''
    }

    return parseMikanApiToken(await response.text())
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

  loginWindow.on('close', async event => {
    try {
      event.preventDefault()
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
        await setCookies(type, url)
        if (type === 'mikan') {
          const apiToken = await fetchMikanApiToken()
          if (apiToken) {
            userDB.data.info.find(item => item.name === 'mikan')!.apiToken = apiToken
            await userDB.write()
          }
        }
        await checkBtLoginStatus(type)
        refreshLoginData()
      }
    } catch (err) {
      log.error(err)
    } finally {
      loginWindow.destroy()
    }
  })

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
