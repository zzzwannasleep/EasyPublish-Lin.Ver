import { app, dialog } from 'electron'
import log from 'electron-log'

export function initializeAppEnvironment(): void {
  app.commandLine.appendSwitch('lang', 'zh-CN')

  process.on('uncaughtException', (err) => {
    log.error(err)
    dialog.showErrorBox('错误', (err as Error).message)
  })
}
