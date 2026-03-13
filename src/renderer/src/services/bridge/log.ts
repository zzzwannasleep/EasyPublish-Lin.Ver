import type { ApiResult } from '../../types/api'
import type { DiagnosticsExportPayload, LogListPayload, LogReadPayload } from '../../types/log'

async function parseResult<T>(promise: Promise<string>): Promise<ApiResult<T>> {
  return JSON.parse(await promise) as ApiResult<T>
}

export const logBridge = {
  listLogs() {
    return parseResult<LogListPayload>(window.logAPI.listLogs())
  },

  readLog(path: string) {
    return parseResult<LogReadPayload>(window.logAPI.readLog(JSON.stringify({ path })))
  },

  exportDiagnostics() {
    return parseResult<DiagnosticsExportPayload>(window.logAPI.exportDiagnostics())
  },
}
