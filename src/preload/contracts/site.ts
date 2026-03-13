import { ipcRenderer } from 'electron/renderer'

export const siteAPI = {
  listSites: async () => await ipcRenderer.invoke('site_listSites'),
  getSite: async (msg: string) => await ipcRenderer.invoke('site_getSite', msg),
  validateAccount: async (msg: string) => await ipcRenderer.invoke('site_validateAccount', msg),
  validatePublish: async (msg: string) => await ipcRenderer.invoke('site_validatePublish', msg),
  loadMetadata: async (msg: string) => await ipcRenderer.invoke('site_loadMetadata', msg),
  publish: async (msg: string) => await ipcRenderer.invoke('site_publish', msg),
}
