import { ipcRenderer } from 'electron/renderer'

export const forumAPI = {
  getAccountInfo: async () => await ipcRenderer.invoke('forum_getAccountInfo'),
  searchPosts: async (msg: string) => await ipcRenderer.invoke('forum_searchPosts', msg),
  publish: async (msg: string) => await ipcRenderer.invoke('forum_publish', msg),
  rsPublish: async (msg: string) => await ipcRenderer.invoke('forum_rsPublish', msg),
  saveAccountInfo: (msg: string) => ipcRenderer.send('forum_saveAccountInfo', msg),
}
