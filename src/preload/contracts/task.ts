import { ipcRenderer } from 'electron/renderer'

export const taskAPI = {
  refreshTaskData: (loadData: () => void) =>
    ipcRenderer.on('task_refreshTaskData', () => loadData()),
  createTask: async (msg: string) => await ipcRenderer.invoke('task_createTask', msg),
  getTaskList: async () => await ipcRenderer.invoke('task_getTaskList'),
  getTaskType: async (msg: string) => await ipcRenderer.invoke('task_getTaskType', msg),
  getForumLink: async (msg: string) => await ipcRenderer.invoke('task_getForumLink', msg),
  getContent: async (msg: string) => await ipcRenderer.invoke('task_getContent', msg),
  getPublishConfig: async (msg: string) => await ipcRenderer.invoke('task_getPublishConfig', msg),
  getPublishStatus: async (msg: string) => await ipcRenderer.invoke('task_getPublishStatus', msg),
  loadComparisons: () => ipcRenderer.invoke('task_loadComparisons'),
  saveConfig: async (msg: string) => await ipcRenderer.invoke('task_saveConfig', msg),
  createConfig: async (msg: string) => await ipcRenderer.invoke('task_createConfig', msg),
  getForumConfig: async (msg: string) => await ipcRenderer.invoke('task_getForumConfig', msg),
  saveContent: (msg: string) => ipcRenderer.send('task_saveContent', msg),
  exportContent: (msg: string) => ipcRenderer.send('task_exportContent', msg),
  saveTitle: (msg: string) => ipcRenderer.send('task_saveTitle', msg),
  removeTask: (msg: string) => ipcRenderer.send('task_removeTask', msg),
  setTaskProcess: (msg: string) => ipcRenderer.send('task_setTaskProcess', msg),
}
