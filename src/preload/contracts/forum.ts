import { ipcRenderer } from 'electron/renderer'

export const forumAPI = {
  searchPosts: async (msg: string) => await ipcRenderer.invoke('forum_searchPosts', msg),
  publish: async (msg: string) => await ipcRenderer.invoke('forum_publish', msg),
  rsPublish: async (msg: string) => await ipcRenderer.invoke('forum_rsPublish', msg),
}
