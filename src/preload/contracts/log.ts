import { ipcRenderer } from 'electron/renderer'

export const logAPI = {
  listLogs: async () => await ipcRenderer.invoke('log_listLogs'),
  readLog: async (msg: string) => await ipcRenderer.invoke('log_readLog', msg),
  exportDiagnostics: async () => await ipcRenderer.invoke('log_exportDiagnostics'),
}
