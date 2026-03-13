import { ipcRenderer } from 'electron/renderer'

export const projectAPI = {
  refreshProjectData: (loadData: () => void) =>
    ipcRenderer.on('project_refreshProjectData', () => loadData()),
  createProject: async (msg: string) => await ipcRenderer.invoke('project_createProject', msg),
  listProjects: async () => await ipcRenderer.invoke('project_listProjects'),
  getProject: async (msg: string) => await ipcRenderer.invoke('project_getProject', msg),
  getProjectStats: async () => await ipcRenderer.invoke('project_getProjectStats'),
  removeProject: async (msg: string) => await ipcRenderer.invoke('project_removeProject', msg),
}

