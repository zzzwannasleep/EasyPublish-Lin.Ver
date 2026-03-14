import { ipcMain } from 'electron'

type Asyncish<T = unknown> = T | Promise<T>

type GlobalHandlers = {
  getProxyConfig: () => Asyncish<unknown>
  getConfigName: () => Asyncish<unknown>
  getFilePath: (msg: string) => Asyncish<unknown>
  getFolderPath: () => Asyncish<unknown>
  readFileContent: () => Asyncish<unknown>
  html2markdown: (msg: string) => Asyncish<unknown>
  html2bbcode: (msg: string) => Asyncish<unknown>
  setProxyConfig: (msg: string) => Asyncish<void>
  openFolder: (msg: string) => Asyncish<void>
  writeClipboard: (msg: string) => Asyncish<void>
  setConfigName: (msg: string) => Asyncish<void>
  changeConfig: () => Asyncish<void>
  createConfig: () => Asyncish<void>
}

type BTHandlers = {
  getTorrentList: () => Asyncish<unknown>
  checkLoginStatus: (msg: string) => Asyncish<unknown>
  getAccountInfo: (msg: string) => Asyncish<unknown>
  getAcgnXAPIConfig: () => Asyncish<unknown>
  publish: (msg: string) => Asyncish<unknown>
  getBangumiTags: (msg: string) => Asyncish<unknown>
  searchBangumiTags: (msg: string) => Asyncish<unknown>
  getBTLinks: (msg: string) => Asyncish<unknown>
  getTorrentDetail: (msg: string) => Asyncish<unknown>
  updateTorrent: (msg: string) => Asyncish<unknown>
  loginAccount: (msg: string) => Asyncish<void>
  openLoginWindow: (msg: string) => Asyncish<void>
  saveAccountInfo: (msg: string) => Asyncish<void>
  clearStorage: () => Asyncish<void>
  removeValidation: () => Asyncish<void>
  exportCookies: (msg: string) => Asyncish<void>
  importCookies: (msg: string) => Asyncish<void>
  saveAcgnXAPIConfig: (msg: string) => Asyncish<void>
}

type ForumHandlers = {
  getAccountInfo: () => Asyncish<unknown>
  searchPosts: (msg: string) => Asyncish<unknown>
  publish: (msg: string) => Asyncish<unknown>
  rsPublish: (msg: string) => Asyncish<unknown>
  saveAccountInfo: (msg: string) => Asyncish<void>
}

type ProjectHandlers = {
  createProject: (msg: string) => Asyncish<unknown>
  listProjects: () => Asyncish<unknown>
  getProject: (msg: string) => Asyncish<unknown>
  getProjectStats: () => Asyncish<unknown>
  removeProject: (msg: string) => Asyncish<unknown>
}

type SiteHandlers = {
  listSites: () => Asyncish<unknown>
  listManagedPtSites: () => Asyncish<unknown>
  getSite: (msg: string) => Asyncish<unknown>
  saveManagedPtSite: (msg: string) => Asyncish<unknown>
  removeManagedPtSite: (msg: string) => Asyncish<unknown>
  validateAccount: (msg: string) => Asyncish<unknown>
  validatePublish: (msg: string) => Asyncish<unknown>
  loadMetadata: (msg: string) => Asyncish<unknown>
  publish: (msg: string) => Asyncish<unknown>
}

type LogHandlers = {
  listLogs: () => Asyncish<unknown>
  readLog: (msg: string) => Asyncish<unknown>
  exportDiagnostics: () => Asyncish<unknown>
}

type TaskHandlers = {
  createTask: (msg: string) => Asyncish<unknown>
  getTaskList: () => Asyncish<unknown>
  getTaskType: (msg: string) => Asyncish<unknown>
  getForumLink: (msg: string) => Asyncish<unknown>
  getContent: (msg: string) => Asyncish<unknown>
  getPublishStatus: (msg: string) => Asyncish<unknown>
  getPublishConfig: (msg: string) => Asyncish<unknown>
  loadComparisons: () => Asyncish<unknown>
  saveConfig: (msg: string) => Asyncish<unknown>
  createConfig: (msg: string) => Asyncish<unknown>
  getForumConfig: (msg: string) => Asyncish<unknown>
  removeTask: (msg: string) => Asyncish<void>
  setTaskProcess: (msg: string) => Asyncish<void>
  saveContent: (msg: string) => Asyncish<void>
  exportContent: (msg: string) => Asyncish<void>
  saveTitle: (msg: string) => Asyncish<void>
}

type IpcHandlerRegistry = {
  Global: GlobalHandlers
  BT: BTHandlers
  Forum: ForumHandlers
  Project: ProjectHandlers
  Site: SiteHandlers
  Log: LogHandlers
  Task: TaskHandlers
}

export function registerIpcHandlers({ Global, BT, Forum, Project, Site, Log, Task }: IpcHandlerRegistry): void {
  ipcMain.handle('global_getProxyConfig', () => Global.getProxyConfig())
  ipcMain.handle('global_getConfigName', () => Global.getConfigName())
  ipcMain.handle('global_getFilePath', (_event, msg) => Global.getFilePath(msg))
  ipcMain.handle('global_getFolderPath', () => Global.getFolderPath())
  ipcMain.handle('global_readFileContent', () => Global.readFileContent())
  ipcMain.handle('global_html2markdown', (_event, msg) => Global.html2markdown(msg))
  ipcMain.handle('global_html2bbcode', (_event, msg) => Global.html2bbcode(msg))

  ipcMain.handle('BT_getTorrentList', () => BT.getTorrentList())
  ipcMain.handle('BT_checkLoginStatus', (_event, msg) => BT.checkLoginStatus(msg))
  ipcMain.handle('BT_getAccountInfo', (_event, msg) => BT.getAccountInfo(msg))
  ipcMain.handle('BT_getAcgnXAPIConfig', () => BT.getAcgnXAPIConfig())
  ipcMain.handle('BT_publish', (_event, msg) => BT.publish(msg))
  ipcMain.handle('BT_getBangumiTags', (_event, msg) => BT.getBangumiTags(msg))
  ipcMain.handle('BT_searchBangumiTags', (_event, msg) => BT.searchBangumiTags(msg))
  ipcMain.handle('BT_getBTLinks', (_event, msg) => BT.getBTLinks(msg))
  ipcMain.handle('BT_getTorrentDetail', (_event, msg) => BT.getTorrentDetail(msg))
  ipcMain.handle('BT_updateTorrent', (_event, msg) => BT.updateTorrent(msg))

  ipcMain.handle('forum_getAccountInfo', () => Forum.getAccountInfo())
  ipcMain.handle('forum_searchPosts', (_event, msg) => Forum.searchPosts(msg))
  ipcMain.handle('forum_publish', (_event, msg) => Forum.publish(msg))
  ipcMain.handle('forum_rsPublish', (_event, msg) => Forum.rsPublish(msg))

  ipcMain.handle('project_createProject', (_event, msg) => Project.createProject(msg))
  ipcMain.handle('project_listProjects', () => Project.listProjects())
  ipcMain.handle('project_getProject', (_event, msg) => Project.getProject(msg))
  ipcMain.handle('project_getProjectStats', () => Project.getProjectStats())
  ipcMain.handle('project_removeProject', (_event, msg) => Project.removeProject(msg))

  ipcMain.handle('site_listSites', () => Site.listSites())
  ipcMain.handle('site_listManagedPtSites', () => Site.listManagedPtSites())
  ipcMain.handle('site_getSite', (_event, msg) => Site.getSite(msg))
  ipcMain.handle('site_saveManagedPtSite', (_event, msg) => Site.saveManagedPtSite(msg))
  ipcMain.handle('site_removeManagedPtSite', (_event, msg) => Site.removeManagedPtSite(msg))
  ipcMain.handle('site_validateAccount', (_event, msg) => Site.validateAccount(msg))
  ipcMain.handle('site_validatePublish', (_event, msg) => Site.validatePublish(msg))
  ipcMain.handle('site_loadMetadata', (_event, msg) => Site.loadMetadata(msg))
  ipcMain.handle('site_publish', (_event, msg) => Site.publish(msg))

  ipcMain.handle('log_listLogs', () => Log.listLogs())
  ipcMain.handle('log_readLog', (_event, msg) => Log.readLog(msg))
  ipcMain.handle('log_exportDiagnostics', () => Log.exportDiagnostics())

  ipcMain.handle('task_createTask', (_event, msg) => Task.createTask(msg))
  ipcMain.handle('task_getTaskList', () => Task.getTaskList())
  ipcMain.handle('task_getTaskType', (_event, msg) => Task.getTaskType(msg))
  ipcMain.handle('task_getForumLink', (_event, msg) => Task.getForumLink(msg))
  ipcMain.handle('task_getContent', (_event, msg) => Task.getContent(msg))
  ipcMain.handle('task_getPublishStatus', (_event, msg) => Task.getPublishStatus(msg))
  ipcMain.handle('task_getPublishConfig', (_event, msg) => Task.getPublishConfig(msg))
  ipcMain.handle('task_loadComparisons', () => Task.loadComparisons())
  ipcMain.handle('task_saveConfig', (_event, msg) => Task.saveConfig(msg))
  ipcMain.handle('task_createConfig', (_event, msg) => Task.createConfig(msg))
  ipcMain.handle('task_getForumConfig', (_event, msg) => Task.getForumConfig(msg))

  ipcMain.on('global_setProxyConfig', (_event, msg) => Global.setProxyConfig(msg))
  ipcMain.on('global_openFolder', (_event, msg) => Global.openFolder(msg))
  ipcMain.on('global_writeClipboard', (_event, msg) => Global.writeClipboard(msg))
  ipcMain.on('global_setConfigName', (_event, msg) => Global.setConfigName(msg))
  ipcMain.on('global_changeConfig', () => Global.changeConfig())
  ipcMain.on('global_createConfig', () => Global.createConfig())

  ipcMain.on('BT_loginAccount', (_event, msg) => BT.loginAccount(msg))
  ipcMain.on('BT_openLoginWindow', (_event, msg) => BT.openLoginWindow(msg))
  ipcMain.on('BT_saveAccountInfo', (_event, msg) => BT.saveAccountInfo(msg))
  ipcMain.on('BT_clearStorage', () => BT.clearStorage())
  ipcMain.on('BT_removeValidation', () => BT.removeValidation())
  ipcMain.on('BT_exportCookies', (_event, msg) => BT.exportCookies(msg))
  ipcMain.on('BT_importCookies', (_event, msg) => BT.importCookies(msg))
  ipcMain.on('BT_saveAcgnXAPIConfig', (_event, msg) => BT.saveAcgnXAPIConfig(msg))

  ipcMain.on('forum_saveAccountInfo', (_event, msg) => Forum.saveAccountInfo(msg))

  ipcMain.on('task_removeTask', (_event, msg) => Task.removeTask(msg))
  ipcMain.on('task_setTaskProcess', (_event, msg) => Task.setTaskProcess(msg))
  ipcMain.on('task_saveContent', (_event, msg) => Task.saveContent(msg))
  ipcMain.on('task_exportContent', (_event, msg) => Task.exportContent(msg))
  ipcMain.on('task_saveTitle', (_event, msg) => Task.saveTitle(msg))
}
