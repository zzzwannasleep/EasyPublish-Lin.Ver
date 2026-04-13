import { ipcRenderer } from 'electron/renderer'

export const BTAPI = {
  refreshLoginData: (loadData: () => void) =>
    ipcRenderer.on('BT_refreshLoginData', () => loadData()),
  loadImageCaptcha: (loadImage: () => void) =>
    ipcRenderer.on('BT_loadIamgeCaptcha', () => loadImage()),
  getAccountInfo: async (msg: string) => await ipcRenderer.invoke('BT_getAccountInfo', msg),
  checkLoginStatus: async (msg: string) => await ipcRenderer.invoke('BT_checkLoginStatus', msg),
  getBangumiTags: async (msg: string) => await ipcRenderer.invoke('BT_getBangumiTags', msg),
  searchBangumiTags: async (msg: string) => await ipcRenderer.invoke('BT_searchBangumiTags', msg),
  publish: async (msg: string) => await ipcRenderer.invoke('BT_publish', msg),
  getBTLinks: async (msg: string) => await ipcRenderer.invoke('BT_getBTLinks', msg),
  getTorrentDetail: async (msg: string) => await ipcRenderer.invoke('BT_getTorrentDetail', msg),
  updateTorrent: async (msg: string) => await ipcRenderer.invoke('BT_updateTorrent', msg),
  getTorrentList: async () => await ipcRenderer.invoke('BT_getTorrentList'),
  loginAccount: (msg: string) => ipcRenderer.send('BT_loginAccount', msg),
  openLoginWindow: (msg: string) => ipcRenderer.send('BT_openLoginWindow', msg),
  saveAccountInfo: (msg: string) => ipcRenderer.send('BT_saveAccountInfo', msg),
  exportCookies: (msg: string) => ipcRenderer.send('BT_exportCookies', msg),
  importCookies: (msg: string) => ipcRenderer.send('BT_importCookies', msg),
  clearStorage: () => ipcRenderer.send('BT_clearStorage'),
}
