import { ipcRenderer } from 'electron/renderer'

export const projectAPI = {
  refreshProjectData: (loadData: () => void) =>
    ipcRenderer.on('project_refreshProjectData', () => loadData()),
  createProject: async (msg: string) => await ipcRenderer.invoke('project_createProject', msg),
  listProjects: async () => await ipcRenderer.invoke('project_listProjects'),
  getProject: async (msg: string) => await ipcRenderer.invoke('project_getProject', msg),
  getSeriesWorkspace: async (msg: string) => await ipcRenderer.invoke('project_getSeriesWorkspace', msg),
  createSeriesEpisode: async (msg: string) => await ipcRenderer.invoke('project_createSeriesEpisode', msg),
  createSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_createSeriesVariant', msg),
  inheritSeriesEpisodeVariants: async (msg: string) =>
    await ipcRenderer.invoke('project_inheritSeriesEpisodeVariants', msg),
  activateSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_activateSeriesVariant', msg),
  syncSeriesVariantFromDraft: async (msg: string) => await ipcRenderer.invoke('project_syncSeriesVariantFromDraft', msg),
  getProjectStats: async () => await ipcRenderer.invoke('project_getProjectStats'),
  removeProject: async (msg: string) => await ipcRenderer.invoke('project_removeProject', msg),
}
