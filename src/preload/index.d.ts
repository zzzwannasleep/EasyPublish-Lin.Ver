export interface IElectronAPI {
}

export interface GlobalAPI {
  winHandle: (msg: string) => void
  getConfigName: () => Promise<string>
  getProxyConfig: () => Promise<string>
  setProxyConfig: (config: string) => void
  getFilePath: (msg: string) => Promise<string>
  getFilePaths: (msg: string) => Promise<string>
  getFolderPath: () => Promise<string>
  openFolder: (msg: string) => void
  changeConfig: () => void
  createConfig: () => void
  writeClipboard: (msg: string) => void
  setConfigName: (msg: string) => void
  readFileContent: () => Promise<string>
  html2markdown: (msg: string) => Promise<string>
  html2bbcode: (msg: string) => Promise<string>
}

export interface BTAPI {
  loadValidation: (loadValidation: Function) => void
  closeValidation: (closeValidation: Function) => void
  loadImageCaptcha: (loadImage: Function) => void
  loginAccount: (msg: string) => void
  checkLoginStatus: (msg: string) => Promise<string>
  openLoginWindow: (msg: string) => void
  refreshLoginData: (loadData: Function) => void
  saveAccountInfo: (msg: string) => void
  getAccountInfo: (msg: string) => Promise<string>
  importCookies: (msg: string) => void
  exportCookies: (msg: string) => void
  clearStorage: () => void
  removeValidation: () => void
  publish: (msg: string) => Promise<string>
  getBangumiTags: (msg: string) => Promise<string>
  searchBangumiTags: (msg: string) => Promise<string>
  getBTLinks: (msg: string) => Promise<string>
  getTorrentList: () => Promise<string>
  getTorrentDetail: (msg: string) => Promise<string>
  updateTorrent: (msg: string) => Promise<string>
}

export interface ForumAPI {
  saveAccountInfo: (msg: string) => Promise<unknown>
  getAccountInfo: () => Promise<string>
  searchPosts: (msg: string) => Promise<string>
  publish: (msg: string) => Promise<string>
  rsPublish: (msg: string) => Promise<string>
}

export interface ProjectAPI {
  refreshProjectData: (loadData: Function) => void
  createProject: (msg: string) => Promise<string>
  listProjects: () => Promise<string>
  getProject: (msg: string) => Promise<string>
  getSeriesWorkspace: (msg: string) => Promise<string>
  getSeriesEpisodeReviewBundle: (msg: string) => Promise<string>
  saveSeriesTitleMatchConfig: (msg: string) => Promise<string>
  importSeriesMatchedTorrents: (msg: string) => Promise<string>
  duplicateSeriesVariant: (msg: string) => Promise<string>
  removeSeriesVariant: (msg: string) => Promise<string>
  activateSeriesVariant: (msg: string) => Promise<string>
  syncSeriesVariantFromDraft: (msg: string) => Promise<string>
  recordSeriesVariantPublishResult: (msg: string) => Promise<string>
  getProjectStats: () => Promise<string>
  removeProject: (msg: string) => Promise<string>
}

export interface SiteAPI {
  listSites: () => Promise<string>
  listManagedPtSites: () => Promise<string>
  getSite: (msg: string) => Promise<string>
  saveManagedPtSite: (msg: string) => Promise<string>
  removeManagedPtSite: (msg: string) => Promise<string>
  validateAccount: (msg: string) => Promise<string>
  validatePublish: (msg: string) => Promise<string>
  loadMetadata: (msg: string) => Promise<string>
  searchBangumiSubjects: (msg: string) => Promise<string>
  publish: (msg: string) => Promise<string>
}

export interface LogAPI {
  listLogs: () => Promise<string>
  readLog: (msg: string) => Promise<string>
  exportDiagnostics: () => Promise<string>
}

export interface TaskAPI {
  refreshTaskData: (loadData: Function) => void
  createTask: (msg: string) => Promise<string>
  getTaskList: () => Promise<string>
  removeTask: (msg: string) => void
  setTaskProcess: (msg: string) => void
  getForumLink: (msg: string) => Promise<string>
  getContent: (msg: string) => Promise<string>
  saveContent: (msg: string) => void
  exportContent: (msg: string) => void
  saveTitle: (msg: string) => void
  getPublishStatus: (msg: string) => Promise<string>
  getPublishConfig: (msg: string) => Promise<string>
  loadComparisons: () => Promise<string>
  saveConfig: (msg: string) => Promise<string>
  createConfig: (msg: string) => Promise<string>
  getForumConfig: (msg: string) => Promise<string>
}

declare global {
  interface Window {
    globalAPI: GlobalAPI
    BTAPI: BTAPI
    forumAPI: ForumAPI
    projectAPI: ProjectAPI
    siteAPI: SiteAPI
    logAPI: LogAPI
    taskAPI: TaskAPI
  }
}
