import { ipcRenderer } from 'electron/renderer'

export const projectAPI = {
  refreshProjectData: (loadData: () => void) =>
    ipcRenderer.on('project_refreshProjectData', () => loadData()),
  createProject: async (msg: string) => await ipcRenderer.invoke('project_createProject', msg),
  listProjects: async () => await ipcRenderer.invoke('project_listProjects'),
  getProject: async (msg: string) => await ipcRenderer.invoke('project_getProject', msg),
  getSeriesWorkspace: async (msg: string) => await ipcRenderer.invoke('project_getSeriesWorkspace', msg),
  getSeriesEpisodeReviewBundle: async (msg: string) =>
    await ipcRenderer.invoke('project_getSeriesEpisodeReviewBundle', msg),
  saveSeriesTitleMatchConfig: async (msg: string) => await ipcRenderer.invoke('project_saveSeriesTitleMatchConfig', msg),
  importSeriesMatchedTorrents: async (msg: string) => await ipcRenderer.invoke('project_importSeriesMatchedTorrents', msg),
  duplicateSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_duplicateSeriesVariant', msg),
  removeSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_removeSeriesVariant', msg),
  activateSeriesVariant: async (msg: string) => await ipcRenderer.invoke('project_activateSeriesVariant', msg),
  syncSeriesVariantFromDraft: async (msg: string) => await ipcRenderer.invoke('project_syncSeriesVariantFromDraft', msg),
  recordSeriesVariantPublishResult: async (msg: string) =>
    await ipcRenderer.invoke('project_recordSeriesVariantPublishResult', msg),
  getProjectStats: async () => await ipcRenderer.invoke('project_getProjectStats'),
  removeProject: async (msg: string) => await ipcRenderer.invoke('project_removeProject', msg),
}
