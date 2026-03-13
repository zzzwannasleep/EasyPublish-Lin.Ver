import { contextBridge } from 'electron'
import { BTAPI } from './contracts/bt'
import { forumAPI } from './contracts/forum'
import { globalAPI } from './contracts/global'
import { logAPI } from './contracts/log'
import { projectAPI } from './contracts/project'
import { siteAPI } from './contracts/site'
import { taskAPI } from './contracts/task'

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
contextBridge.exposeInMainWorld('globalAPI', globalAPI)
contextBridge.exposeInMainWorld('BTAPI', BTAPI)
contextBridge.exposeInMainWorld('forumAPI', forumAPI)
contextBridge.exposeInMainWorld('projectAPI', projectAPI)
contextBridge.exposeInMainWorld('siteAPI', siteAPI)
contextBridge.exposeInMainWorld('logAPI', logAPI)
contextBridge.exposeInMainWorld('taskAPI', taskAPI)
