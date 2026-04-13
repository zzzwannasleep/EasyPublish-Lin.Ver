import { ipcRenderer } from 'electron/renderer'

export const globalAPI = {
  getProxyConfig: async () => await ipcRenderer.invoke('global_getProxyConfig'),
  getFilePath: async (msg: string) => await ipcRenderer.invoke('global_getFilePath', msg),
  getFilePaths: async (msg: string) => await ipcRenderer.invoke('global_getFilePaths', msg),
  getFolderPath: async () => await ipcRenderer.invoke('global_getFolderPath'),
  readFileContent: async () => await ipcRenderer.invoke('global_readFileContent'),
  html2markdown: async (msg: string) => await ipcRenderer.invoke('global_html2markdown', msg),
  html2bbcode: async (msg: string) => await ipcRenderer.invoke('global_html2bbcode', msg),
  winHandle: (msg: string) => ipcRenderer.send('global_winHandle', msg),
  setProxyConfig: (msg: string) => ipcRenderer.send('global_setProxyConfig', msg),
  openFolder: (msg: string) => ipcRenderer.send('global_openFolder', msg),
  writeClipboard: (msg: string) => ipcRenderer.send('global_writeClipboard', msg),
}
