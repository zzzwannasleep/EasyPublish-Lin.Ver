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
  batchCreateSeriesVariants: async (msg: string) =>
    await ipcRenderer.invoke('project_batchCreateSeriesVariants', msg),
  saveSeriesPublishProfile: async (msg: string) =>
    await ipcRenderer.invoke('project_saveSeriesPublishProfile', msg),
  removeSeriesPublishProfile: async (msg: string) =>
    await ipcRenderer.invoke('project_removeSeriesPublishProfile', msg),
  saveSeriesVariantTemplate: async (msg: string) =>
    await ipcRenderer.invoke('project_saveSeriesPublishProfile', msg),
  removeSeriesVariantTemplate: async (msg: string) =>
    await ipcRenderer.invoke('project_removeSeriesPublishProfile', msg),
  inheritSeriesEpisodeVariants: async (msg: string) =>
    await ipcRenderer.invoke('project_inheritSeriesEpisodeVariants', msg),
  duplicateSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_duplicateSeriesVariant', msg),
  removeSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_removeSeriesVariant', msg),
  activateSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_activateSeriesVariant', msg),
  syncSeriesVariantFromDraft: async (msg: string) => await ipcRenderer.invoke('project_syncSeriesVariantFromDraft', msg),
  getProjectStats: async () => await ipcRenderer.invoke('project_getProjectStats'),
  removeProject: async (msg: string) => await ipcRenderer.invoke('project_removeProject', msg),
}
