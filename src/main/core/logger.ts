import { app } from 'electron'
import log from 'electron-log'
import { join } from 'path'

export function initializeLogger(): void {
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'

  const date = new Date()
  const dateStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  const logPath = join(app.getPath('userData'), 'logs', `${dateStr}.log`)

  log.transports.file.resolvePathFn = () => logPath
  log.initialize()
  console.log = log.log
  log.info(logPath)
}
