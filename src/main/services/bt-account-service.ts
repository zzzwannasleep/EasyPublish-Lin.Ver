import { dialog, session, type BrowserWindow, type WebContentsView } from 'electron'
import fs from 'fs'
import { Low } from 'lowdb'
import axios from 'axios'
import log from 'electron-log'
import CryptoJS from 'crypto-js'
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

  function getLoginInfo(type: string) {
    return getUserDBOrThrow().data.info.find(item => item.name === type)!
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
                notifyValidationRequired('nyaa')
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
    if (type == 'nyaa') void loginNyaa(info, key!)
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
    const info = userDB.data.info.find(item => item.name == result.type)!
    info.username = result.username
    info.password = result.password
    info.apiToken = result.apiToken?.trim() ?? ''
    info.enable = result.enable
    await userDB.write()
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
    userDB.data.info.find(item => item.name == type)!.cookies = JSON.parse(
      fs.readFileSync(filePaths[0], { encoding: 'utf-8' }),
    )
    await userDB.write()
  }

  return {
    checkLoginStatus,
    loginAccount,
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
