import { dialog, session, type BrowserWindow, type WebContentsView } from 'electron'
import fs from 'fs'
import { Low } from 'lowdb'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import log from 'electron-log'
import CryptoJS from 'crypto-js'
import { legacyApiStatusText, legacyAccountStatusText } from '../../shared/utils/legacy-account-status'
import { getCurrentTime, sleep } from '../core/utils'

type UserDbProvider = () => Low<Config.UserData>
type LoginWindowOpener = (type: string) => Promise<void> | void
type RefreshLoginDataHandler = () => void
type ValidationRequestHandler = (type: string) => void
type SimpleNotificationHandler = () => void

interface CreateBtAccountServiceOptions {
  getUserDB: UserDbProvider
  getMainWindow: () => BrowserWindow
  getMainContentView: () => Electron.View
  getCloudflareView: () => WebContentsView
  openSiteLoginWindow: LoginWindowOpener
  refreshLoginData: RefreshLoginDataHandler
  notifyValidationRequired: ValidationRequestHandler
  notifyImageCaptchaRequired: SimpleNotificationHandler
  notifyCloseValidation: SimpleNotificationHandler
}

export function createBtAccountService(options: CreateBtAccountServiceOptions) {
  const {
    getUserDB,
    getMainWindow,
    getMainContentView,
    getCloudflareView,
    openSiteLoginWindow,
    refreshLoginData,
    notifyValidationRequired,
    notifyImageCaptchaRequired,
    notifyCloseValidation,
  } = options

  let cfViewVisible = false
  const FAST_CHECK_TIMEOUT_MS = 5000
  const FAST_CHECK_MAX_ATTEMPTS = 2

  function getUserDBOrThrow() {
    const userDB = getUserDB()
    if (!userDB) {
      throw new Error('User DB is not initialized')
    }
    return userDB
  }

  function getBtSession() {
    const userDB = getUserDBOrThrow()
    return session.fromPartition(`persist:${userDB.data.name}`)
  }

  function createDefaultLoginInfo(type: string): Config.LoginInfo {
    return {
      name: type,
      time: '--',
      status:
        type === 'miobt'
          ? legacyApiStatusText.credentialsMissing
          : type === 'mikan' || type === 'anibt'
            ? legacyApiStatusText.tokenMissing
            : legacyAccountStatusText.loggedOut,
      username: '',
      password: '',
      apiToken: '',
      enable: false,
      cookies: [],
    }
  }

  function getLoginInfo(type: string) {
    const userDB = getUserDBOrThrow()
    let info = userDB.data.info.find(item => item.name === type)
    if (!info) {
      info = createDefaultLoginInfo(type)
      userDB.data.info.push(info)
    }
    return info
  }

  function setStatus(info: Config.LoginInfo, status: string) {
    info.time = getCurrentTime()
    info.status = status
  }

  async function persistUserData() {
    await getUserDBOrThrow().write()
    refreshLoginData()
  }

  async function setStatusAndPersist(info: Config.LoginInfo, status: string) {
    setStatus(info, status)
    await persistUserData()
  }

  function normalizeSetCookieHeaders(headerValue: unknown) {
    if (Array.isArray(headerValue)) {
      return headerValue.filter((item): item is string => typeof item === 'string')
    }

    return typeof headerValue === 'string' ? [headerValue] : []
  }

  async function syncSiteCookies(info: Config.LoginInfo, url: string) {
    try {
      info.cookies = await getBtSession().cookies.get({ url })
    } catch (err) {
      log.error(err)
    }
  }

  async function clearSiteCookies(info: Config.LoginInfo, url: string) {
    try {
      const cookies = await getBtSession().cookies.get({ url })
      await Promise.all(
        cookies.map(cookie =>
          getBtSession()
            .cookies.remove(url, cookie.name)
            .catch(err => {
              log.error(err)
            }),
        ),
      )
    } catch (err) {
      log.error(err)
    }

    info.cookies = []
  }

  async function storeResponseCookies(info: Config.LoginInfo, url: string, headerValue: unknown) {
    const cookies = normalizeSetCookieHeaders(headerValue)
    for (const item of cookies) {
      const cookie = item.split(';')[0]
      const index = cookie.indexOf('=')
      if (index < 0) {
        continue
      }

      const name = cookie.slice(0, index)
      const value = cookie.slice(index + 1)
      await getBtSession().cookies.set({
        url,
        name,
        value,
        httpOnly: true,
        expirationDate: Math.floor(Date.now() / 1000) + 31536000,
      })
    }

    await syncSiteCookies(info, url)
  }

  function parseJsonObject(payload: unknown) {
    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>
    }

    if (typeof payload !== 'string') {
      return undefined
    }

    try {
      const parsed = JSON.parse(payload)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  function getRequestErrorCode(error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status) {
        return String(error.response.status)
      }
      if (error.code) {
        return error.code
      }
    }

    if (error instanceof Error && error.name) {
      return error.name
    }

    return 'request_error'
  }

  function getRequestErrorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      return error.message
    }

    if (error instanceof Error) {
      return error.message
    }

    return 'Unknown request error'
  }

  type FastRequestConfig = AxiosRequestConfig & {
    'axios-retry'?: {
      retries?: number
    }
  }

  function createFastRequestConfig(config: AxiosRequestConfig = {}): FastRequestConfig {
    return {
      timeout: FAST_CHECK_TIMEOUT_MS,
      ...config,
      'axios-retry': {
        retries: 0,
      },
    }
  }

  async function requestFastCheck(url: string, expectedStatuses: number[]) {
    let lastResponse: AxiosResponse<string> | undefined
    let lastError: unknown

    for (let attempt = 0; attempt < FAST_CHECK_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await axios.get<string>(url, createFastRequestConfig({ responseType: 'text' }))
        lastResponse = response
        if (expectedStatuses.includes(response.status)) {
          return response
        }
      } catch (error) {
        lastError = error
      }
    }

    if (lastResponse) {
      return lastResponse
    }

    throw lastError ?? new Error(`Request to ${url} failed`)
  }

  async function verifyAuthenticated(
    info: Config.LoginInfo,
    checker: (info: Config.LoginInfo) => Promise<void>,
    fallbackStatus = legacyAccountStatusText.passwordError,
  ) {
    await checker(info)
    if (info.status === legacyAccountStatusText.loggedOut) {
      setStatus(info, fallbackStatus)
    }
  }

  async function checkLoginStatus(msg: string): Promise<string> {
    try {
      const { type }: Message.BT.AccountType = JSON.parse(msg)
      if (type == 'all') {
        void checkLoginStatus('{"type":"bangumi"}')
        void checkLoginStatus('{"type":"mikan"}')
        void checkLoginStatus('{"type":"miobt"}')
        void checkLoginStatus('{"type":"nyaa"}')
        void checkLoginStatus('{"type":"dmhy"}')
        void checkLoginStatus('{"type":"acgrip"}')
        void checkLoginStatus('{"type":"acgnx_a"}')
        void checkLoginStatus('{"type":"acgnx_g"}')
        return ''
      } else {
        const userDB = getUserDBOrThrow()
        const info: Config.LoginInfo = userDB.data.info.find(item => item.name === type)!
        if (!info.enable) {
          info.time = getCurrentTime()
          info.status = '璐︽埛宸茬鐢?'
          await userDB.write()
          refreshLoginData()
        } else {
          if (type == 'bangumi') {
            await checkBangumiLoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?')
              if (info.username != '' && info.password != '')
                void loginBangumi(info)
          }
          if (type == 'acgrip') {
            await checkAcgripLoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?')
              if (info.username != '' && info.password != '')
                void loginAcgrip(info)
          }
          if (type == 'mikan') {
            await checkMikanLoginStatus(info)
            await userDB.write()
            refreshLoginData()
          }
          if (type == 'miobt') {
            await checkMioBtLoginStatus(info)
            await userDB.write()
            refreshLoginData()
          }
          if (type == 'nyaa') {
            await checkNyaaLoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?') {
              if (info.username != '' && info.password != '') {
              }
            }
          }
          if (type == 'acgnx_a') {
            await checkAcgnxALoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?') {
              if (info.username != '' && info.password != '') {
                notifyValidationRequired('acgnx_a')
              }
            }
          }
          if (type == 'acgnx_g') {
            await checkAcgnxGLoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?') {
              if (info.username != '' && info.password != '') {
                notifyValidationRequired('acgnx_g')
              }
            }
          }
          if (type == 'dmhy') {
            await checkDmhyLoginStatus(info)
            await userDB.write()
            refreshLoginData()
            if (info.status == '璐﹀彿鏈櫥褰?') {
              if (info.username != '' && info.password != '') {
                const result = await axios.get('https://www.dmhy.org/common/generate-captcha?code=' + Date.now())
                if (result.headers['set-cookie']) {
                  result.headers['set-cookie']!.forEach(async item => {
                    const cookie = item.split(';')[0]
                    const index = cookie.indexOf('=')
                    const name = cookie.slice(0, index)
                    const value = cookie.slice(index + 1, cookie.length)
                    await getBtSession().cookies.set({
                      url: 'https://www.dmhy.org',
                      name,
                      value,
                      httpOnly: true,
                      expirationDate: Date.now() + 31536000,
                    })
                  })
                  await getBtSession()
                    .cookies.get({ url: 'https://www.dmhy.org' })
                    .then(cookies => {
                      info.cookies.push(...cookies)
                    })
                    .catch(err => {
                      log.error(err)
                    })
                  void userDB.write()
                }
                notifyImageCaptchaRequired()
              }
            }
          }
        }
        const result: Message.BT.LoginStatus = { status: info.status }
        return JSON.stringify(result)
      }
    } catch (err) {
      log.error(err)
      dialog.showErrorBox('閿欒', (err as Error).message)
      return ''
    }
  }

  async function checkBangumiLoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://bangumi.moe/api/team/myteam'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { data, status } = response
      if (status != 200) {
        throw response
      }
      if (data == '[]') {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else {
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function checkMikanLoginStatus(info: Config.LoginInfo) {
    info.time = getCurrentTime()
    info.status = info.apiToken?.trim() ? 'API token configured' : 'API token missing'
  }

  async function checkMioBtLoginStatus(info: Config.LoginInfo) {
    info.time = getCurrentTime()
    info.status = info.username.trim() && info.apiToken?.trim() ? 'API credentials configured' : 'API credentials missing'
  }

  async function checkNyaaLoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://nyaa.si/profile'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200 || response.status === 302) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { status } = response
      if (status == 302) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else if (status == 200) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function checkAcgripLoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://acg.rip/cp'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200 || response.status === 302) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { status } = response
      if (status == 302) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else if (status == 200) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function checkDmhyLoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://www.dmhy.org/user'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200 || response.status === 302) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { status } = response
      if (status == 302) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else if (status == 200) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function checkAcgnxGLoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://www.acgnx.se/user.php'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200 || response.status === 302 || response.status === 403) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { data, status } = response
      if (status == 302) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else if (status == 403) {
        info.time = getCurrentTime()
        info.status = '闃茬伀澧欓樆姝?'
        void openSiteLoginWindow('acgnx_g')
      } else if (status == 200) {
        if ((data as string).includes('Your request has been blocked, Please complete the captcha to access.')) {
          info.time = getCurrentTime()
          info.status = '闃茬伀澧欓樆姝?'
          void openSiteLoginWindow('acgnx_g')
        } else {
          info.time = getCurrentTime()
          info.status = '璐﹀彿宸茬櫥褰?'
        }
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function checkAcgnxALoginStatus(info: Config.LoginInfo) {
    try {
      const url = 'https://share.acgnx.se/user.php'
      let response = await axios.get(url, { responseType: 'text' })
      for (let i = 0; i < 5; i++) {
        if (response.status === 200 || response.status === 302 || response.status === 403) {
          break
        }
        response = await axios.get(url, { responseType: 'text' })
      }
      const { data, status } = response
      if (status == 302) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿鏈櫥褰?'
      } else if (status == 403) {
        info.time = getCurrentTime()
        info.status = '闃茬伀澧欓樆姝?'
        void openSiteLoginWindow('acgnx_a')
      } else if (status == 200) {
        if ((data as string).includes('Your request has been blocked, Please complete the captcha to access.')) {
          info.time = getCurrentTime()
          info.status = '闃茬伀澧欓樆姝?'
          void openSiteLoginWindow('acgnx_a')
        } else {
          info.time = getCurrentTime()
          info.status = '璐﹀彿宸茬櫥褰?'
        }
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      info.time = getCurrentTime()
      info.status = '璁块棶澶辫触'
    }
  }

  async function loginAccount(msg: string) {
    const { type, key, position }: Message.BT.ValidationInfo = JSON.parse(msg)
    const info = getLoginInfo(type)
    if (type == '__legacy_nyaa_removed__') void loginNyaa(info, key!)
    if (type == 'acgnx_a') void loginAcgnxA(info, position!)
    if (type == 'acgnx_g') void loginAcgnxG(info, position!)
    if (type == 'dmhy') void loginDmhy(info, key!)
  }

  async function loginBangumi(info: Config.LoginInfo) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://bangumi.moe/api/user/signin'
      const uname = info.username
      const pwd = info.password
      const response = await axios.post(url, { username: uname, password: CryptoJS.MD5(pwd).toString() })
      if (response.data.success) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://bangumi.moe',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://bangumi.moe' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      } else {
        info.time = getCurrentTime()
        info.status = '璐﹀彿瀵嗙爜閿欒'
        await userDB.write()
        refreshLoginData()
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function loginAcgrip(info: Config.LoginInfo) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://acg.rip/users/sign_in'
      const formData = new FormData()
      const csrf = await axios.get(url, { responseType: 'text' })
      const cookievalue = csrf.headers['set-cookie']![0].match(/_kanako_session=([\S]*?);/)![1]
      const sessionCookie = info.cookies.find(item => item.name == '_kanako_session')
      if (sessionCookie) sessionCookie.value = cookievalue
      else info.cookies.push({ name: '_kanako_session', value: cookievalue, sameSite: 'lax' })
      await userDB.write()
      const token = (csrf.data as string).match(/name="csrf-token"\scontent="([\S]*?)"/)![1]
      formData.append('authenticity_token', token)
      const uname = info.username
      const pwd = info.password
      formData.append('user[email]', uname)
      formData.append('user[password]', pwd)
      formData.append('user[remember_me]', '1')
      formData.append('commit', '鐧诲綍')
      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://acg.rip',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://acg.rip' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function loginNyaa(info: Config.LoginInfo, key: string) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://nyaa.si/login'
      const formData = new FormData()
      const uname = info.username
      const pwd = info.password
      formData.append('username', uname)
      formData.append('password', pwd)
      formData.append('g-recaptcha-response', key)
      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://nyaa.si',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://nyaa.si' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      } else if ((response.data as string).includes('Incorrect username or password')) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿瀵嗙爜閿欒'
        await userDB.write()
        refreshLoginData()
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function loginDmhy(info: Config.LoginInfo, key: string) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://www.dmhy.org/user/login'
      const uname = info.username
      const pwd = info.password
      const formData = new FormData()
      formData.append('goto', 'https://www.dmhy.org/')
      formData.append('email', uname)
      formData.append('password', pwd)
      formData.append('login_node', '0')
      formData.append('cookietime', '315360000')
      formData.append('captcha_code', key)
      const response = await axios.post(url, formData, { responseType: 'text' })
      if ((response.data as string).includes('鐧诲叆鎴愬姛')) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://www.dmhy.org',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://www.dmhy.org' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      } else if ((response.data as string).includes('甯愭埛瀵嗙爜閿欒')) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿瀵嗙爜閿欒'
        await userDB.write()
        refreshLoginData()
      } else if ((response.data as string).includes('楠岃瘉鐮侀敊璇?')) {
        info.time = getCurrentTime()
        info.status = '楠岃瘉鐮侀敊璇?'
        await userDB.write()
        refreshLoginData()
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function waitForTurnstile(url: string, position: Message.BT.TurnstilePosition) {
    const mainWindow = getMainWindow()
    const mainContentView = getMainContentView()
    const cfView = getCloudflareView()
    mainWindow.resizable = false
    cfViewVisible = true
    mainContentView.addChildView(cfView)
    void cfView.webContents.loadURL(url)
    cfView.setBounds({ x: position.x, y: position.y, width: 300, height: 65 })
    let key = 'waiting'
    let count = 20
    while (key == 'waiting' && count > 0 && cfViewVisible) {
      await sleep(1000)
      await cfView.webContents
        .executeJavaScript(`document.getElementsByName("form1")[0].querySelector("input[name='cf-turnstile-response']").value`)
        .then(result => {
          if (result) key = result
          count--
        })
        .catch(err => {
          console.log(err)
        })
    }
    mainContentView.removeChildView(cfView)
    mainWindow.resizable = true
    cfViewVisible = false
    notifyCloseValidation()
    return key
  }

  async function loginAcgnxG(info: Config.LoginInfo, position: Message.BT.TurnstilePosition) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://www.acgnx.se/user.php?o=login'
      const key = await waitForTurnstile(url, position)
      if (key == 'waiting') {
        info.time = getCurrentTime()
        info.status = '楠岃瘉鏈€氳繃'
        await userDB.write()
        refreshLoginData()
        return
      }
      const formData = new FormData()
      const uname = info.username
      const pwd = info.password
      formData.append('op', 'login')
      formData.append('url', 'http%3A%2F%2Fwww.acgnx.se')
      formData.append('emailaddress', uname)
      formData.append('password', pwd)
      formData.append('cookietime', '315360000')
      formData.append('cf-turnstile-response', key)
      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://www.acgnx.se',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://www.acgnx.se' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      } else if ((response.data as string).includes('鐧婚寗瀵嗙⒓涓嶆纰?')) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿瀵嗙爜閿欒'
        await userDB.write()
        refreshLoginData()
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function loginAcgnxA(info: Config.LoginInfo, position: Message.BT.TurnstilePosition) {
    try {
      const userDB = getUserDBOrThrow()
      info.time = getCurrentTime()
      info.status = '姝ｅ湪鐧诲綍'
      await userDB.write()
      refreshLoginData()
      const url = 'https://share.acgnx.se/user.php?o=login'
      const key = await waitForTurnstile(url, position)
      if (key == 'waiting') {
        info.time = getCurrentTime()
        info.status = '楠岃瘉鏈€氳繃'
        await userDB.write()
        refreshLoginData()
        return
      }
      const formData = new FormData()
      const uname = info.username
      const pwd = info.password
      formData.append('op', 'login')
      formData.append('url', 'http%3A%2F%2Fshare.acgnx.se')
      formData.append('emailaddress', uname)
      formData.append('password', pwd)
      formData.append('cookietime', '315360000')
      formData.append('cf-turnstile-response', key)
      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        response.headers['set-cookie']!.forEach(async item => {
          const cookie = item.split(';')[0]
          const index = cookie.indexOf('=')
          const name = cookie.slice(0, index)
          const value = cookie.slice(index + 1, cookie.length)
          await getBtSession().cookies.set({
            url: 'https://share.acgnx.se',
            name,
            value,
            httpOnly: true,
            expirationDate: Date.now() + 31536000,
          })
        })
        await getBtSession()
          .cookies.get({ url: 'https://share.acgnx.se' })
          .then(cookies => {
            info.cookies.push(...cookies)
          })
          .catch(err => {
            log.error(err)
          })
        info.time = getCurrentTime()
        info.status = '璐﹀彿宸茬櫥褰?'
        await userDB.write()
        refreshLoginData()
      } else if ((response.data as string).includes('鐧婚寗瀵嗙⒓涓嶆纰?')) {
        info.time = getCurrentTime()
        info.status = '璐﹀彿瀵嗙爜閿欒'
        await userDB.write()
        refreshLoginData()
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
    }
  }

  async function removeValidation() {
    getMainWindow().resizable = true
    cfViewVisible = false
    getMainContentView().removeChildView(getCloudflareView())
  }

  async function openLoginWindow(msg: string) {
    const { type }: Message.BT.AccountType = JSON.parse(msg)
    return openSiteLoginWindow(type)
  }

  async function saveAccountInfo(msg: string) {
    const userDB = getUserDBOrThrow()
    const result: Message.BT.AccountInfo = JSON.parse(msg)
    const info = getLoginInfo(result.type)
    const previousUsername = info.username
    const previousPassword = info.password
    const previousApiToken = info.apiToken?.trim() ?? ''
    const nextApiToken = result.apiToken?.trim() ?? ''
    const credentialsChanged =
      previousUsername !== result.username || previousPassword !== result.password || previousApiToken !== nextApiToken

    info.username = result.username
    info.password = result.password
    info.apiToken = nextApiToken
    info.enable = result.enable

    const siteCookieUrls: Partial<Record<string, string>> = {
      bangumi: 'https://bangumi.moe',
      nyaa: 'https://nyaa.si',
      acgrip: 'https://acg.rip',
      dmhy: 'https://www.dmhy.org',
      acgnx_a: 'https://share.acgnx.se',
      acgnx_g: 'https://www.acgnx.se',
    }

    if (credentialsChanged) {
      const cookieUrl = siteCookieUrls[result.type]
      if (cookieUrl) {
        await clearSiteCookies(info, cookieUrl)
      }

      if (!result.enable) {
        info.status = legacyAccountStatusText.disabled
      } else if (result.type == 'mikan' || result.type == 'anibt') {
        info.status = nextApiToken ? legacyApiStatusText.tokenConfigured : legacyApiStatusText.tokenMissing
      } else if (result.type == 'miobt') {
        info.status =
          result.username.trim() && nextApiToken
            ? legacyApiStatusText.credentialsConfigured
            : legacyApiStatusText.credentialsMissing
      } else {
        info.status = legacyAccountStatusText.loggedOut
      }
    } else if (!result.enable) {
      info.status = legacyAccountStatusText.disabled
    }

    await userDB.write()
    refreshLoginData()
  }

  async function getAccountInfo(msg: string) {
    const { type }: Message.BT.AccountType = JSON.parse(msg)
    const info = getLoginInfo(type)
    const result: Message.BT.AccountInfo = {
      type: info.name,
      time: info.time,
      status: info.status,
      username: info.username,
      password: info.password,
      apiToken: info.apiToken ?? '',
      enable: info.enable,
    }
    return JSON.stringify(result)
  }

  async function clearStorage() {
    const userDB = getUserDBOrThrow()
    await getBtSession().clearStorageData()
    userDB.data.info.forEach(item => {
      item.cookies = []
    })
    await userDB.write()
    refreshLoginData()
  }

  async function getAcgnXAPIConfig() {
    return JSON.stringify(getUserDBOrThrow().data.acgnxAPI)
  }

  async function saveAcgnXAPIConfig(msg: string) {
    const userDB = getUserDBOrThrow()
    const config: Message.BT.AcgnXAPIConfig = JSON.parse(msg)
    userDB.data.acgnxAPI = config
    await userDB.write()
  }

  async function exportCookies(msg: string) {
    const { canceled, filePath } = await dialog.showSaveDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled) return
    const { type }: Message.BT.AccountInfo = JSON.parse(msg)
    const info = getLoginInfo(type)
    fs.writeFileSync(filePath, JSON.stringify(info.cookies))
  }

  async function importCookies(msg: string) {
    const userDB = getUserDBOrThrow()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled) return
    const { type }: Message.BT.AccountInfo = JSON.parse(msg)
    getLoginInfo(type).cookies = JSON.parse(
      fs.readFileSync(filePaths[0], { encoding: 'utf-8' }),
    )
    await userDB.write()
  }

  void checkLoginStatus
  void loginAccount

  async function checkBangumiLoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://bangumi.moe/api/team/myteam'
      const response = await requestFastCheck(url, [200])

      const { data, status } = response
      if (status !== 200) {
        throw response
      }

      setStatus(info, data == '[]' ? legacyAccountStatusText.loggedOut : legacyAccountStatusText.loggedIn)
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function checkMikanLoginStatusClean(info: Config.LoginInfo): Promise<Omit<Message.BT.LoginStatus, 'status'>> {
    const apiToken = info.apiToken?.trim()
    if (!apiToken) {
      setStatus(info, legacyApiStatusText.tokenMissing)
      return {}
    }

    try {
      const response = await axios.post(
        'https://api.mikanani.me/api/episode',
        {},
        createFastRequestConfig({
          responseType: 'text',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `MikanHash ${apiToken}`,
          },
        }),
      )

      if ([200, 400, 415, 422].includes(response.status)) {
        setStatus(info, legacyApiStatusText.tokenConfigured)
        return {}
      }

      if (response.status === 401 || response.status === 403) {
        const errorCode = String(response.status)
        log.error('[BTAccount][mikan] token validation rejected', {
          status: response.status,
          data: response.data,
        })
        setStatus(info, `${legacyApiStatusText.tokenRejected} (${errorCode})`)
        return {
          errorCode,
          message: 'Mikan API token rejected',
        }
      }

      const errorCode = String(response.status)
      log.error('[BTAccount][mikan] token validation unexpected response', {
        status: response.status,
        data: response.data,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${errorCode})`)
      return {
        errorCode,
        message: `Mikan validation returned unexpected status ${errorCode}`,
      }
    } catch (err) {
      const errorCode = getRequestErrorCode(err)
      const message = getRequestErrorMessage(err)
      log.error('[BTAccount][mikan] token validation request failed', {
        errorCode,
        message,
        error: err,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${errorCode})`)
      return {
        errorCode,
        message,
      }
    }
  }

  async function checkAnibtLoginStatusClean(info: Config.LoginInfo): Promise<Omit<Message.BT.LoginStatus, 'status'>> {
    const apiToken = info.apiToken?.trim()
    if (!apiToken) {
      setStatus(info, legacyApiStatusText.tokenMissing)
      return {}
    }

    try {
      const response = await axios.post(
        'https://site.anibt.net/api/releases/publish',
        {},
        createFastRequestConfig({
          responseType: 'text',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
        }),
      )

      if ([200, 400, 422].includes(response.status)) {
        setStatus(info, legacyApiStatusText.tokenConfigured)
        return {}
      }

      if (response.status === 401 || response.status === 403) {
        const errorCode = String(response.status)
        log.error('[BTAccount][anibt] token validation rejected', {
          status: response.status,
          data: response.data,
        })
        setStatus(info, `${legacyApiStatusText.tokenRejected} (${errorCode})`)
        return {
          errorCode,
          message: 'Anibt API token rejected',
        }
      }

      const errorCode = String(response.status)
      log.error('[BTAccount][anibt] token validation unexpected response', {
        status: response.status,
        data: response.data,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${errorCode})`)
      return {
        errorCode,
        message: `Anibt validation returned unexpected status ${errorCode}`,
      }
    } catch (err) {
      const errorCode = getRequestErrorCode(err)
      const message = getRequestErrorMessage(err)
      log.error('[BTAccount][anibt] token validation request failed', {
        errorCode,
        message,
        error: err,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${errorCode})`)
      return {
        errorCode,
        message,
      }
    }
  }

  async function checkMioBtLoginStatusClean(info: Config.LoginInfo): Promise<Omit<Message.BT.LoginStatus, 'status'>> {
    const userId = info.username.trim()
    const apiKey = info.apiToken?.trim()
    if (!userId || !apiKey) {
      setStatus(info, legacyApiStatusText.credentialsMissing)
      return {}
    }

    try {
      const formData = new FormData()
      formData.append('user_id', userId)
      formData.append('api_key', apiKey)
      const response = await axios.post('https://www.miobt.com/addon.php?r=api/post/76cad81b', formData, createFastRequestConfig({
        responseType: 'text',
      }))
      const data = parseJsonObject(response.data)
      const responseCode =
        typeof data?.code === 'number' || typeof data?.code === 'string' ? String(data.code) : String(response.status)
      const responseMessage = typeof data?.message === 'string' ? data.message : ''

      if (responseCode === '114' || responseMessage === 'auth failed') {
        log.error('[BTAccount][miobt] credentials rejected', {
          status: response.status,
          data: response.data,
        })
        setStatus(info, `${legacyApiStatusText.credentialsRejected} (${responseCode})`)
        return {
          errorCode: responseCode,
          message: responseMessage || 'MioBT API credentials rejected',
        }
      }

      if (response.status === 200) {
        setStatus(info, legacyApiStatusText.credentialsConfigured)
        return {}
      }

      log.error('[BTAccount][miobt] credentials validation unexpected response', {
        status: response.status,
        data: response.data,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${responseCode})`)
      return {
        errorCode: responseCode,
        message: responseMessage || `MioBT validation returned unexpected status ${responseCode}`,
      }
    } catch (err) {
      const errorCode = getRequestErrorCode(err)
      const message = getRequestErrorMessage(err)
      log.error('[BTAccount][miobt] credentials validation request failed', {
        errorCode,
        message,
        error: err,
      })
      setStatus(info, `${legacyAccountStatusText.failed} (${errorCode})`)
      return {
        errorCode,
        message,
      }
    }
  }

  async function checkNyaaLoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://nyaa.si/profile'
      const response = await requestFastCheck(url, [200, 302])

      if (response.status == 302) {
        setStatus(info, legacyAccountStatusText.loggedOut)
      } else if (response.status == 200) {
        setStatus(info, legacyAccountStatusText.loggedIn)
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function checkAcgripLoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://acg.rip/cp'
      const response = await requestFastCheck(url, [200, 302])

      if (response.status == 302) {
        setStatus(info, legacyAccountStatusText.loggedOut)
      } else if (response.status == 200) {
        setStatus(info, legacyAccountStatusText.loggedIn)
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function checkDmhyLoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://www.dmhy.org/user'
      const response = await requestFastCheck(url, [200, 302])

      if (response.status == 302) {
        setStatus(info, legacyAccountStatusText.loggedOut)
      } else if (response.status == 200) {
        setStatus(info, legacyAccountStatusText.loggedIn)
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function checkAcgnxGLoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://www.acgnx.se/user.php'
      const response = await requestFastCheck(url, [200, 302, 403])

      const { data, status } = response
      if (status == 302) {
        setStatus(info, legacyAccountStatusText.loggedOut)
      } else if (status == 403) {
        setStatus(info, legacyAccountStatusText.blocked)
        void openSiteLoginWindow('acgnx_g')
      } else if (status == 200) {
        if ((data as string).includes('Your request has been blocked, Please complete the captcha to access.')) {
          setStatus(info, legacyAccountStatusText.blocked)
          void openSiteLoginWindow('acgnx_g')
        } else {
          setStatus(info, legacyAccountStatusText.loggedIn)
        }
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function checkAcgnxALoginStatusClean(info: Config.LoginInfo) {
    try {
      const url = 'https://share.acgnx.se/user.php'
      const response = await requestFastCheck(url, [200, 302, 403])

      const { data, status } = response
      if (status == 302) {
        setStatus(info, legacyAccountStatusText.loggedOut)
      } else if (status == 403) {
        setStatus(info, legacyAccountStatusText.blocked)
        void openSiteLoginWindow('acgnx_a')
      } else if (status == 200) {
        if ((data as string).includes('Your request has been blocked, Please complete the captcha to access.')) {
          setStatus(info, legacyAccountStatusText.blocked)
          void openSiteLoginWindow('acgnx_a')
        } else {
          setStatus(info, legacyAccountStatusText.loggedIn)
        }
      } else {
        throw response
      }
    } catch (err) {
      log.error(err)
      setStatus(info, legacyAccountStatusText.failed)
    }
  }

  async function loginBangumiClean(info: Config.LoginInfo) {
    try {
      await clearSiteCookies(info, 'https://bangumi.moe')
      await setStatusAndPersist(info, legacyAccountStatusText.loggingIn)

      const response = await axios.post('https://bangumi.moe/api/user/signin', {
        username: info.username,
        password: CryptoJS.MD5(info.password).toString(),
      })

      if (!response.data.success) {
        await setStatusAndPersist(info, legacyAccountStatusText.passwordError)
        return
      }

      await storeResponseCookies(info, 'https://bangumi.moe', response.headers['set-cookie'])
      await verifyAuthenticated(info, checkBangumiLoginStatusClean)
      await persistUserData()
    } catch (err) {
      log.error(err)
      await setStatusAndPersist(info, legacyAccountStatusText.failed)
    }
  }

  async function loginNyaaClean(info: Config.LoginInfo, key: string) {
    try {
      await clearSiteCookies(info, 'https://nyaa.si')
      await setStatusAndPersist(info, legacyAccountStatusText.loggingIn)

      const formData = new FormData()
      formData.append('username', info.username)
      formData.append('password', info.password)
      formData.append('g-recaptcha-response', key)

      const response = await axios.post('https://nyaa.si/login', formData, { responseType: 'text' })
      if (response.status == 302) {
        await storeResponseCookies(info, 'https://nyaa.si', response.headers['set-cookie'])
        await verifyAuthenticated(info, checkNyaaLoginStatusClean)
        await persistUserData()
        return
      }

      if ((response.data as string).includes('Incorrect username or password')) {
        await setStatusAndPersist(info, legacyAccountStatusText.passwordError)
        return
      }

      await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
    } catch (err) {
      log.error(err)
      await setStatusAndPersist(info, legacyAccountStatusText.failed)
    }
  }

  async function loginDmhyClean(info: Config.LoginInfo, key: string) {
    try {
      await clearSiteCookies(info, 'https://www.dmhy.org')
      await setStatusAndPersist(info, legacyAccountStatusText.loggingIn)

      const formData = new FormData()
      formData.append('goto', 'https://www.dmhy.org/')
      formData.append('email', info.username)
      formData.append('password', info.password)
      formData.append('login_node', '0')
      formData.append('cookietime', '315360000')
      formData.append('captcha_code', key)

      const response = await axios.post('https://www.dmhy.org/user/login', formData, { responseType: 'text' })
      const payload = response.data as string

      if (payload.includes('登录成功')) {
        await storeResponseCookies(info, 'https://www.dmhy.org', response.headers['set-cookie'])
        await verifyAuthenticated(info, checkDmhyLoginStatusClean)
        await persistUserData()
        return
      }

      if (payload.includes('帐户密码错误') || payload.includes('账户密码错误')) {
        await setStatusAndPersist(info, legacyAccountStatusText.passwordError)
        return
      }

      if (payload.includes('验证码错误')) {
        await setStatusAndPersist(info, legacyAccountStatusText.captchaError)
        return
      }

      await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
    } catch (err) {
      log.error(err)
      await setStatusAndPersist(info, legacyAccountStatusText.failed)
    }
  }

  async function loginAcgnxGClean(info: Config.LoginInfo, position: Message.BT.TurnstilePosition) {
    try {
      await clearSiteCookies(info, 'https://www.acgnx.se')
      await setStatusAndPersist(info, legacyAccountStatusText.loggingIn)

      const url = 'https://www.acgnx.se/user.php?o=login'
      const key = await waitForTurnstile(url, position)
      if (key == 'waiting') {
        await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
        return
      }

      const formData = new FormData()
      formData.append('op', 'login')
      formData.append('url', 'http%3A%2F%2Fwww.acgnx.se')
      formData.append('emailaddress', info.username)
      formData.append('password', info.password)
      formData.append('cookietime', '315360000')
      formData.append('cf-turnstile-response', key)

      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        await storeResponseCookies(info, 'https://www.acgnx.se', response.headers['set-cookie'])
        await verifyAuthenticated(info, checkAcgnxGLoginStatusClean)
        await persistUserData()
        return
      }

      if ((response.data as string).includes('登錄密碼不正確') || (response.data as string).includes('登录密码不正确')) {
        await setStatusAndPersist(info, legacyAccountStatusText.passwordError)
        return
      }

      await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
    } catch (err) {
      log.error(err)
      await setStatusAndPersist(info, legacyAccountStatusText.failed)
    }
  }

  async function loginAcgnxAClean(info: Config.LoginInfo, position: Message.BT.TurnstilePosition) {
    try {
      await clearSiteCookies(info, 'https://share.acgnx.se')
      await setStatusAndPersist(info, legacyAccountStatusText.loggingIn)

      const url = 'https://share.acgnx.se/user.php?o=login'
      const key = await waitForTurnstile(url, position)
      if (key == 'waiting') {
        await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
        return
      }

      const formData = new FormData()
      formData.append('op', 'login')
      formData.append('url', 'http%3A%2F%2Fshare.acgnx.se')
      formData.append('emailaddress', info.username)
      formData.append('password', info.password)
      formData.append('cookietime', '315360000')
      formData.append('cf-turnstile-response', key)

      const response = await axios.post(url, formData, { responseType: 'text' })
      if (response.status == 302) {
        await storeResponseCookies(info, 'https://share.acgnx.se', response.headers['set-cookie'])
        await verifyAuthenticated(info, checkAcgnxALoginStatusClean)
        await persistUserData()
        return
      }

      if ((response.data as string).includes('登錄密碼不正確') || (response.data as string).includes('登录密码不正确')) {
        await setStatusAndPersist(info, legacyAccountStatusText.passwordError)
        return
      }

      await setStatusAndPersist(info, legacyAccountStatusText.validationFailed)
    } catch (err) {
      log.error(err)
      await setStatusAndPersist(info, legacyAccountStatusText.failed)
    }
  }

  async function loginAccountClean(msg: string) {
    const { type, key, position }: Message.BT.ValidationInfo = JSON.parse(msg)
    const info = getLoginInfo(type)
    if (type == '__legacy_nyaa_removed__') await loginNyaaClean(info, key!)
    if (type == 'acgnx_a') await loginAcgnxAClean(info, position!)
    if (type == 'acgnx_g') await loginAcgnxGClean(info, position!)
    if (type == 'dmhy') await loginDmhyClean(info, key!)
  }

  async function checkLoginStatusClean(msg: string): Promise<string> {
    try {
      const { type }: Message.BT.AccountType = JSON.parse(msg)
      if (type == 'all') {
        void Promise.all(
          ['bangumi', 'mikan', 'anibt', 'miobt', 'nyaa', 'dmhy', 'acgrip', 'acgnx_a', 'acgnx_g'].map(accountType =>
            checkLoginStatusClean(JSON.stringify({ type: accountType })),
          ),
        )
        return ''
      }

      const info = getLoginInfo(type)
      let resultDetails: Omit<Message.BT.LoginStatus, 'status'> = {}
      if (!info.enable) {
        await setStatusAndPersist(info, legacyAccountStatusText.disabled)
        return JSON.stringify({ status: info.status } satisfies Message.BT.LoginStatus)
      }

      if (type == 'bangumi') {
        await checkBangumiLoginStatusClean(info)
        await persistUserData()
        if (info.status == legacyAccountStatusText.loggedOut && info.username && info.password) {
          await loginBangumiClean(info)
        }
      }

      if (type == 'acgrip') {
        await checkAcgripLoginStatusClean(info)
        await persistUserData()
      }

      if (type == 'mikan') {
        resultDetails = await checkMikanLoginStatusClean(info)
        await persistUserData()
      }

      if (type == 'anibt') {
        resultDetails = await checkAnibtLoginStatusClean(info)
        await persistUserData()
      }

      if (type == 'miobt') {
        resultDetails = await checkMioBtLoginStatusClean(info)
        await persistUserData()
      }

      if (type == 'nyaa') {
        await checkNyaaLoginStatusClean(info)
        await persistUserData()
      }

      if (type == 'acgnx_a') {
        await checkAcgnxALoginStatusClean(info)
        await persistUserData()
        if (info.status == legacyAccountStatusText.loggedOut && info.username && info.password) {
          notifyValidationRequired('acgnx_a')
        }
      }

      if (type == 'acgnx_g') {
        await checkAcgnxGLoginStatusClean(info)
        await persistUserData()
        if (info.status == legacyAccountStatusText.loggedOut && info.username && info.password) {
          notifyValidationRequired('acgnx_g')
        }
      }

      if (type == 'dmhy') {
        await checkDmhyLoginStatusClean(info)
        await persistUserData()
        if (info.status == legacyAccountStatusText.loggedOut && info.username && info.password) {
          const result = await axios.get(
            'https://www.dmhy.org/common/generate-captcha?code=' + Date.now(),
            createFastRequestConfig(),
          )
          if (result.headers['set-cookie']) {
            await storeResponseCookies(info, 'https://www.dmhy.org', result.headers['set-cookie'])
            await persistUserData()
          }
          notifyImageCaptchaRequired()
        }
      }

      const result: Message.BT.LoginStatus = { status: info.status, ...resultDetails }
      return JSON.stringify(result)
    } catch (err) {
      log.error(err)
      dialog.showErrorBox('错误', (err as Error).message)
      return ''
    }
  }

  return {
    checkLoginStatus: checkLoginStatusClean,
    loginAccount: loginAccountClean,
    removeValidation,
    openLoginWindow,
    saveAccountInfo,
    getAccountInfo,
    clearStorage,
    getAcgnXAPIConfig,
    saveAcgnXAPIConfig,
    exportCookies,
    importCookies,
  }
}
