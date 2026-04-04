import { app, BrowserWindow, WebContentsView } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import { Low } from 'lowdb'
import { JSONFilePreset } from 'lowdb/node'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import log from 'electron-log'
import socksProxy from 'socks-proxy-agent'



import { initializeAppEnvironment } from './bootstrap/app'
import { registerIpcHandlers } from './bootstrap/ipc'
import { APP_USER_MODEL_ID, TASK_DB_FILE, USER_AGENT, USER_DB_FILE } from './core/constants'
import { initializeLogger } from './core/logger'
import { createBtAccountService } from './services/bt-account-service'
import { createBtPublishService } from './services/bt-publish-service'
import { createContentService } from './services/content-service'
import { createForumService } from './services/forum-service'
import { createGlobalService } from './services/global-service'
import { createLogService } from './services/log-service'
import { createProjectService } from './services/project-service'
import { createSiteService } from './services/site-service'
import { createSiteRegistry } from './sites/registry'
import { createCredentialStore } from './storage/credential-store'
import { defaultTaskData, defaultUserData } from './storage/defaults'
import { createProjectStore } from './storage/project-store'
import { mergeUserDataWithDefaults, SecureUserDataFile } from './storage/secure-user-data'
import { createSettingsStore } from './storage/settings-store'
import { createMainAppWindow, openLoginWindow } from './windows/app-windows'

//闂傚倸鍊搁崐鎼佹偋婵犲洦鍋￠柨鏇炲€搁悞鍨亜閹寸偛顕滅紒浣瑰缁辨帗绗熼崶褌绨婚梺?
import nyaaResponse from '../renderer/src/assets/nyaa.html?asset'
import appIcon from '../../build/icon.ico?asset'

/*
  闂備礁婀遍崢褔鎮洪妸銉綎濠电姵鑹鹃弸渚€鏌曢崼婵愭Ц缂佲偓閸℃绡€闂傚牊绋掗敍宥嗙箾閸忕⒈娈滈柡灞剧洴瀵粙濡歌閳綊姊虹涵鍛吂闁告鍟块悾宄拔旈崨顓団晠鏌曟竟顖氬鐎氭娊姊洪懡銈呅＄紒鈧担瑙勬珷濞寸姴顑嗛崑顏堟煕閳╁啰鈯曢柛搴℃捣缁辨帞鈧綆浜炴禒銏㈡喐?
*/
initializeLogger()
initializeAppEnvironment()

//闂備浇顕у锕傦綖婢舵劖鍎楁い鏂垮⒔娑撳秹鏌ｉ弮鍌氬付闁哄绶氶弻锝呂旈埀顒勬偋閸℃瑧鐭堥柨鏇炲€哥粻?
let taskDB: Low<Config.TaskData>
let userDB: Low<Config.UserData>

const settingsStore = createSettingsStore({
  getUserDB: () => userDB,
})
const credentialStore = createCredentialStore({
  getUserDB: () => userDB,
})
const projectStore = createProjectStore({
  getTaskDB: () => taskDB,
})
const siteRegistry = createSiteRegistry({
  getCustomProfiles: () => credentialStore.listCustomSiteProfiles(),
})

const userAgent = USER_AGENT
//axios闂傚倷鑳堕幊鎾诲吹閺嶎厽鈷旈柛鏇ㄥ灠閺勩儵鏌涘☉鍗炲笌閹艰揪绲剧€氭岸鏌熺紒妯轰刊婵炶偐娓筼okie闂傚倷绀侀幉锛勫垝瀹€鍕剨闁秆呮珴ragent,婵犵數鍋為崹鍫曞箲娴ｅ摜鏆﹂柣銏犳啞閸嬬喐銇勯弽銊х煁濠殿垰銈搁弻娑㈠箻濡も偓閹冲繘鎮楅銏＄厽闁绘﹢浜跺鐑芥煕婵犲啰娲撮柟?
axios.interceptors.request.use(
  config => {
    let type = ''
    config.headers['User-Agent'] = userAgent
    if (config.url!.includes('vcb-s.com')) {
      const forumCredentials = credentialStore.getForumCredentials()
      let key = "Basic " + btoa(forumCredentials.username + ':' + forumCredentials.password)
      config.headers['Authorization'] = key
      let str = ''
      let cookies = forumCredentials.cookies
      if (cookies)
      cookies.forEach(item => { str += `${item.name}=${item.value}; ` })
      config.headers['Cookie'] = str
      return config
    }
    else if (config.url!.includes('bangumi.moe')) type = 'bangumi'
    else if (config.url!.includes('nyaa.si')) type = 'nyaa'
    else if (config.url!.includes('acg.rip')) type = 'acgrip'
    else if (config.url!.includes('dmhy.org')) type = 'dmhy'
    else if (config.url!.includes('share.acgnx.se')) type = 'acgnx_a'
    else if (config.url!.includes('www.acgnx.se')) type = 'acgnx_g'
    else return config
    const cookies = credentialStore.getSiteCookies(
      type as 'bangumi' | 'nyaa' | 'acgrip' | 'dmhy' | 'acgnx_a' | 'acgnx_g',
    )
    let str = ''
    cookies.forEach(item => {
      str += `${item.name}=${item.value}; `
    })
    config.headers['Cookie'] = str
    config.headers['User-Agent'] = userAgent
    return config
  },
  error => {log.error(error)}
)
//闂傚倸鍊搁崐鎼佸疮閹殿喖鍨濇い鏍剱閺佸棙绻涢幋娆忕仾闁绘挸鍊婚埀顒€绠嶉崕閬嶅箠閹版澘姹插ù鐓庣摠閻撴洘鎱ㄥ鍡楀箹闁诲繈鍎甸弻鐔兼憥閸屾艾绁悗瑙勬穿缂嶄礁顕ｆ禒瀣╂い顒夊枔閸庣敻寮婚敐鍛傜喖宕归鎯у缚闂備線鈧偛鑻崢鎼佹煠閸愯尙鍩ｉ柟顔哄劚椤劑宕橀幆褎顓块梻浣侯焾閺堫剙顫濋妸鈺佹槬?
axios.defaults.maxRedirects = 0
axios.defaults.validateStatus = () => true
//闂備浇宕垫慨宕囩矆娴ｈ娅犲ù鐘差儐閸嬵亪鏌涢埄鍐噮缁鹃箖绠栭弻鐔衡偓鐢殿焾鍟搁梺纭咁潐濞茬喎顫忓ú顏勭閹艰揪绲鹃崳顖氼渻閵堝棙纾搁柛濠冪箞瀵崵浠︾粵瀣倯闂佸壊鍋侀崹铏圭懅
axiosRetry(axios, { 
  retries: 5,
  retryCondition: (error) => {
    if (error.message.includes('status code'))
      return false
    return true
  }
})

/*
  婵犵數鍋為崹鍫曞箲娴ｅ摜鏆﹂柣銏犳啞閸嬫﹢鏌曟径鍡樻珔闁活厽顨婇弻銊モ攽閸℃瑥鈷堥梺鍝ュ枎濞撮妲?
*/

let mainWindowWebContent: Electron.WebContents
let mainWindowContentView: Electron.View
let window: BrowserWindow
function createWindow(): void {
  const mainWindow = createMainAppWindow({
    appIcon,
    nyaaResponse,
    userAgent,
    getUserDB: () => userDB,
  })
  mainWindowWebContent = mainWindow.webContents
  mainWindowContentView = mainWindow.contentView
  window = mainWindow
}

//cloudflare-turnstile缂傚倸鍊烽悞锕傚礉閺嶎厹鈧啴宕ㄩ懜顑挎睏濠电偞鍨剁喊宥嗗垔婵傚憡鐓曢柟鐐殔閹冲繘鎮?
let cfView: WebContentsView
let cssKey: string[] = []

/*
  闂傚倷娴囬惃顐﹀幢閳轰焦顔勭紓鍌氬€哥粔瀵哥矓閸撲礁鍨濋柨婵嗘啒閺冨牆鐒垫い鎺戝暔娴滆绻涢幋鐐殿暡濠殿垰銈搁弻娑㈠箻濡も偓閹冲繘鎮?
*/

async function createLoginWindow(type: string) {
  await openLoginWindow({
    type,
    appIcon,
    userAgent,
    getUserDB: () => userDB,
    checkBtLoginStatus: async loginType => {
      await BT.checkLoginStatus(JSON.stringify({ type: loginType }))
    },
    refreshLoginData: () => {
      mainWindowWebContent.send('BT_refreshLoginData')
    },
  })
}

/*
  闂傚倸鍊风欢锟犲窗閹捐绀夌€光偓閸曨偄鐎柟鍏肩暘閸斿瞼绮堥崒鐐寸厪濠电偛鐏濋崝銈嗙節閳ь剚瀵肩€涙ê浠繛杈剧悼椤牓鍩涢弮鍫熺厽闁靛牆鎳忛ˉ銏ゆ煛娴ｅ摜肖濞寸媴绠撻幃鈩冩償閿濆柊鎺楁⒑閼姐倕鏋戞繛鍙夊灥椤啴骞掗弮鈧€氬鏌ｉ幋鐐插挤p.vue闂傚倷绀侀幉锛勫垝瀹€鍕殣妞ゆ牜鍊涢崶鈺傚磯闁靛ě鍜冪床闂備礁鎲″ú锔界濠靛鏁冨ù鐘差儐閻撴洟鐓崶銊х叝闁告凹鍋婇弻鈩冩媴闂堟稈鍋撳┑瀣畾闁告劦鍠栫粈瀣亜閺嶃劏澹樺┑顔哄€濆娲川婵犲倻鐟ㄥ┑鈽嗗亝椤ㄥ﹤鐣烽悽鍛婄劶鐎广儱鎳忛悗?*/
const Global = createGlobalService({
  getUserDB: () => userDB,
  settingsStore,
})
const btAccountService = createBtAccountService({
  getUserDB: () => userDB,
  getMainWindow: () => window,
  getMainContentView: () => mainWindowContentView,
  getCloudflareView: () => cfView,
  openSiteLoginWindow: type => createLoginWindow(type),
  refreshLoginData: () => {
    mainWindowWebContent.send('BT_refreshLoginData')
  },
  notifyValidationRequired: type => {
    mainWindowWebContent.send('BT_loadValidation', JSON.stringify({ type }))
  },
  notifyImageCaptchaRequired: () => {
    mainWindowWebContent.send('BT_loadIamgeCaptcha')
  },
  notifyCloseValidation: () => {
    mainWindowWebContent.send('BT_closeValidation')
  },
})
const btPublishService = createBtPublishService({
  getUserDB: () => userDB,
  getTaskDB: () => taskDB,
  projectStore,
  notifyProjectDataChanged: () => {
    mainWindowWebContent.send('task_refreshTaskData')
    mainWindowWebContent.send('project_refreshProjectData')
  },
})
const projectService = createProjectService({
  projectStore,
  notifyProjectDataChanged: () => {
    mainWindowWebContent.send('task_refreshTaskData')
    mainWindowWebContent.send('project_refreshProjectData')
  },
})
const contentService = createContentService({
  getTaskDB: () => taskDB,
})
const forumService = createForumService({
  credentialStore,
  projectStore,
  openSiteLoginWindow: type => createLoginWindow(type),
})
const siteService = createSiteService({
  siteRegistry,
  credentialStore,
  projectStore,
  notifyProjectDataChanged: () => {
    mainWindowWebContent.send('task_refreshTaskData')
    mainWindowWebContent.send('project_refreshProjectData')
  },
})
const logService = createLogService({
  projectStore,
  settingsStore,
})

/* 
BT缂傚倸鍊烽悞锕€顫忚ぐ鎺撳仭闁靛闄勯崣蹇旂箾閹存瑥鐏柛銈呭閺岋綁鏁愰崨顔芥嫳缂備椒鐒﹂悡锟犲蓟?
*/

namespace BT {
  //闂傚倷绀侀崥瀣磿閹惰棄搴婇柤鑹扮堪娴滃綊鏌涢妷顔煎闁稿骸鐭傞幃褰掑炊椤忓嫮姣㈢紓浣割槼濞夋洜妲愰幒妤€绠涙い鎾楀嫮鏆ラ柣鐔哥矌婢ф鎯勯姘辨殾闁割偅娲橀崐鐑芥煕閹捐尙鍔嶉柍?

  // Delegate BT account status checks to the extracted service.
  export async function checkLoginStatus(msg: string) {
    return btAccountService.checkLoginStatus(msg)
  }

  // Delegate BT login actions to the extracted service.
  export async function loginAccount(msg: string) {
    return btAccountService.loginAccount(msg)
  }
  export async function removeValidation() {
    return btAccountService.removeValidation()
  }
  export async function openLoginWindow(msg: string) {
    return btAccountService.openLoginWindow(msg)
  }
  export async function saveAccountInfo(msg: string) {
    return btAccountService.saveAccountInfo(msg)
  }
  export async function getAccountInfo(msg: string) {
    return btAccountService.getAccountInfo(msg)
  }
  export async function clearStorage() {
    return btAccountService.clearStorage()
  }
  export async function getAcgnXAPIConfig() {
    return btAccountService.getAcgnXAPIConfig()
  }
  export async function saveAcgnXAPIConfig(msg: string) {
    return btAccountService.saveAcgnXAPIConfig(msg)
  }
  export async function exportCookies(msg: string) {
    return btAccountService.exportCookies(msg)
  }
  export async function importCookies(msg: string) {
    return btAccountService.importCookies(msg)
  }
  export async function publish(msg: string) {
    return btPublishService.publish(msg)
  }

  export async function getBangumiTags(msg: string) {
    try {
      let { query }: Message.BT.BangumiQuery = JSON.parse(msg)
      const response = await axios.post('https://bangumi.moe/api/tag/suggest', { query })
      let result: Message.BT.BangumiTags = { data: response.data, status: response.status }
      return JSON.stringify(result)
    }
    catch (err) {
      log.error(err)
      let result: Message.BT.BangumiTags = { data: {}, status: 0 }
      return JSON.stringify(result)
    }
  }

  export async function searchBangumiTags(msg: string) {
    try {
      let { query }: Message.BT.BangumiQuery = JSON.parse(msg)
      const response = await axios.post('https://bangumi.moe/api/tag/search', { name: query, multi: true, keywords: true })
      let result: Message.BT.BangumiTags = { data: response.data, status: response.status }
      return JSON.stringify(result)
    }
    catch (err) {
      log.error(err)
      let result: Message.BT.BangumiTags = { data: {}, status: 0 }
      return JSON.stringify(result)
    }
  }

  export async function getBTLinks(msg: string) {
    return btPublishService.getBTLinks(msg)
  }

  export async function getTorrentList() {
    return btPublishService.getTorrentList()
  }

  export async function getTorrentDetail(msg: string) {
    return btPublishService.getTorrentDetail(msg)
  }

  export async function updateTorrent(msg: string) {
    return btPublishService.updateTorrent(msg)
  }
}

/* 
婵犵數鍋為崹鍫曞箲娴ｅ摜鏆﹂柣銏犳啞閸嬬喐銇勯弽顐粶缂佲偓婢舵劖鐓熼柡鍐ㄦ祩閸ゆ瑩鏌涘Ο缁樺唉闁哄矉缍侀崺锟犲礃閸撗冨Ъ闂?
*/

namespace Forum {

  //闂傚倷绀侀崥瀣磿閹惰棄搴婇柤鑹扮堪娴滃綊鏌涢妷锝呭闁崇粯妫冮弻銈嗘叏閹邦兘鍋撳Δ鍕╀汗闁哄被鍎查崑锝夋煙閺夎法鍩ｆ俊缁㈠櫍閺屾盯鍩￠崒婧惧缂備礁鐭傛禍鍫曞春閸曨垰绀冪憸蹇曠矆閳?
  export function getAccountInfo() {
    return forumService.getAccountInfo()
  }
  //婵犵數鍎戠徊钘壝洪敂鐐床闁稿瞼鍋為崑銈夋煏婵犲繐顩柍缁樻閺屻倖鎱ㄩ幇顑藉亾濡ゅ嫨浜归柡灞诲劜閸嬶綁鏌熼弶璺ㄥ煟婵＄虎鍣ｉ弻娑㈠煛閸屾壕濮囩紓浣哥焸娴滃爼宕洪崟顖氱鐟滃繒绮堥埀?
  export async function saveAccountInfo(msg: string) {
    return forumService.saveAccountInfo(msg)
  }
  
  //RS闂傚倷鑳堕幊鎾诲触鐎ｎ剙鍨濋幖娣妼绾惧ジ鏌曟繛鐐珔婵☆偅锕㈤弻娑㈠Ψ閵忊剝鐝栭悷?
  export async function searchPosts(msg: string) {
    return forumService.searchPosts(msg)
  }
  export async function publish(msg: string) {
    return forumService.publish(msg)
  }
  //RS婵犵數鍋為崹鍫曞箲娴ｅ摜鏆﹂柣銏犳啞閸嬬喐銇勯弽顐粶闁活厽顨婇弻鐔衡偓娑欘焽缁犳ɑ銇?
  export async function rsPublish(msg: string) {
    return forumService.rsPublish(msg)
  }
}

/* 
婵犵數鍋涢顓熸叏妤ｅ喚鏁嬬憸搴ㄥ箞閵娾晜鍋勯柛蹇曞帶閸擃喚绱撴担鍓插剰闁诲繑绻嗛妵鎰版偐瀹割喚鍞甸柣鐘叉惈閹碱偊顢旈锔界厵?
*/

namespace Task {

  export async function createTask(msg: string) {
    return projectService.createTask(msg)
  }
  export function getTaskList() {
    return projectService.getTaskList()
  }
  export async function removeTask(msg: string) {
    return projectService.removeTask(msg)
  }
  export async function getForumLink(msg: string) {
    return projectService.getForumLink(msg)
  }
  export async function setTaskProcess(msg: string) {
    return projectService.setTaskProcess(msg)
  }
  export async function getContent(msg: string) {
    return contentService.getContent(msg)
  }
  export async function saveContent(msg: string) {
    return contentService.saveContent(msg)
  }
  export async function saveTitle(msg: string) {
    return contentService.saveTitle(msg)
  }
  export async function exportContent(msg: string) {
    return contentService.exportContent(msg)
  }
  export async function getPublishStatus(msg: string) {
    return projectService.getPublishStatus(msg)
  }
  export async function getPublishConfig(msg: string) {
    return projectService.getPublishConfig(msg)
  }
  export async function loadComparisons() {
    return contentService.loadComparisons()
  }
  export async function createConfig(msg: string) {
    return contentService.createConfig(msg)
  }
  export async function saveConfig(msg: string) {
    return projectService.saveConfig(msg)
  }
  export async function getForumConfig(msg: string) {
    return contentService.getForumConfig(msg)
  }
}

namespace Project {
  export async function createProject(msg: string) {
    return projectService.createProject(msg)
  }
  export function listProjects() {
    return projectService.listProjects()
  }
  export function getProject(msg: string) {
    return projectService.getProject(msg)
  }
  export function getSeriesWorkspace(msg: string) {
    return projectService.getSeriesWorkspace(msg)
  }
  export function saveSeriesTitleMatchConfig(msg: string) {
    return projectService.saveSeriesTitleMatchConfig(msg)
  }
  export function importSeriesMatchedTorrents(msg: string) {
    return projectService.importSeriesMatchedTorrents(msg)
  }
  export function duplicateSeriesVariant(msg: string) {
    return projectService.duplicateSeriesVariant(msg)
  }
  export function removeSeriesVariant(msg: string) {
    return projectService.removeSeriesVariant(msg)
  }
  export function activateSeriesVariant(msg: string) {
    return projectService.activateSeriesVariant(msg)
  }
  export function syncSeriesVariantFromDraft(msg: string) {
    return projectService.syncSeriesVariantFromDraft(msg)
  }
  export function getProjectStats() {
    return projectService.getProjectStats()
  }
  export async function removeProject(msg: string) {
    return projectService.removeProject(msg)
  }
}

namespace Site {
  export function listSites() {
    return siteService.listSites()
  }
  export function listManagedPtSites() {
    return siteService.listManagedPtSites()
  }
  export function getSite(msg: string) {
    return siteService.getSite(msg)
  }
  export function saveManagedPtSite(msg: string) {
    return siteService.saveManagedPtSite(msg)
  }
  export function removeManagedPtSite(msg: string) {
    return siteService.removeManagedPtSite(msg)
  }
  export function validateAccount(msg: string) {
    return siteService.validateAccount(msg)
  }
  export function validatePublish(msg: string) {
    return siteService.validatePublish(msg)
  }
  export function loadMetadata(msg: string) {
    return siteService.loadMetadata(msg)
  }
  export function searchBangumiSubjects(msg: string) {
    return siteService.searchBangumiSubjects(msg)
  }
  export function publish(msg: string) {
    return siteService.publish(msg)
  }
}
app.whenReady().then(async () => {
  //闂備浇宕垫慨宕囩矆娴ｈ娅犲ù鐘差儐閸嬵亪鏌涢埄鍏╂垿宕曢悢鍏肩厸闁告劑鍔岄埀顒€缍婂瀹犵疀濞戞瑧鍘告繛杈剧到閹碱偊銆傞懖鈹惧亾鐟欏嫭灏柣鎺炵畵楠?
  userDB = new Low<Config.UserData>(
    new SecureUserDataFile(join(app.getPath('userData'), USER_DB_FILE)),
    mergeUserDataWithDefaults(defaultUserData),
  )
  await userDB.read()
  userDB.data = mergeUserDataWithDefaults(userDB.data)
  taskDB = await JSONFilePreset<Config.TaskData>(join(app.getPath('userData'), TASK_DB_FILE), defaultTaskData)
  await userDB.write()
  await taskDB.write()
  //闂傚倷绀侀崥瀣磿閹惰棄搴婇柤鑹扮堪娴滃綊鏌涢妷顔煎闁稿骸鐭傞幃褰掑炊椤忓嫮姣㈢紓浣割槼濞夋洜妲愰幒妤€绠涙い鎾楀嫮鏆ラ柣鐔哥矌婢ф鎯勯姘辨殾闁割偅娲橀崐鐑芥煕閹捐尙鍔嶉柍?
  //濠电姷鏁搁崑娑⑺囬銏犵鐎光偓閸曨偉鍩炵紓浣圭ゴ閸嬫彋C闂傚倸鍊风欢锟犲磻閸涘瓨鍎楁い鏃傛櫕閳?
  registerIpcHandlers({ Global, BT, Forum, Project, Site, Log: logService, Task })

  //闂傚倸鍊烽悞锕€顭垮Ο鑲╃煋闁割偅娲橀崑顏堟煕濠靛牜浠篿os婵犵數鍋涢顓熷垔鐎电绶ら柛褎顨呯粻?
  let pconf = settingsStore.getProxyConfig()
  if (pconf.status) {
    if (pconf.type == "socks") {
      axios.defaults.httpsAgent = new socksProxy.SocksProxyAgent(`socks://${pconf.host}:${pconf.port}`)
    }
    else{
      axios.defaults.proxy = {
        protocol: pconf.type,
        port: pconf.port,
        host: pconf.host
      }
    }
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  cfView = new WebContentsView()
  cfView.webContents.on('did-finish-load', async () => {
    cssKey.forEach(item => { cfView.webContents.removeInsertedCSS(item) })
    cssKey.push(await cfView.webContents.insertCSS('body {overflow: hidden;}'))
    cssKey.push(await cfView.webContents.insertCSS('.cf-turnstile { position: fixed; left: 0px; top: 0px}'))
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

