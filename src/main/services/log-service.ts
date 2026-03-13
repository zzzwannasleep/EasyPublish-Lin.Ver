import { app, dialog, safeStorage } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { DiagnosticsBundle, DiagnosticsFailureEntry, DiagnosticsLogEntry, LogFileSummary } from '../../shared/types/log'
import { createProjectStore } from '../storage/project-store'
import { createSettingsStore } from '../storage/settings-store'

function getLogsDirectory() {
  return join(app.getPath('userData'), 'logs')
}

const MAX_DIAGNOSTIC_LOG_BYTES = 256 * 1024

function toIsoTimestamp(value: number) {
  return new Date(value).toISOString()
}

interface CreateLogServiceOptions {
  projectStore: ReturnType<typeof createProjectStore>
  settingsStore: ReturnType<typeof createSettingsStore>
}

function listLogFiles(): { directory: string; files: LogFileSummary[] } {
  const directory = getLogsDirectory()
  if (!fs.existsSync(directory)) {
    return { files: [], directory }
  }

  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.log'))
    .map(entry => {
      const path = join(directory, entry.name)
      const stat = fs.statSync(path)
      return {
        name: entry.name,
        path,
        size: stat.size,
        updatedAt: toIsoTimestamp(stat.mtimeMs),
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return { files, directory }
}

function resolveLogPath(path: string) {
  const directory = getLogsDirectory()
  return join(directory, path.replace(/^.*[\\/]/, ''))
}

function readLogFileSummary(path: string): LogFileSummary {
  const stat = fs.statSync(path)
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    size: stat.size,
    updatedAt: toIsoTimestamp(stat.mtimeMs),
  }
}

function readDiagnosticLogEntry(file: LogFileSummary): DiagnosticsLogEntry {
  const buffer = fs.readFileSync(file.path)
  const truncated = buffer.length > MAX_DIAGNOSTIC_LOG_BYTES
  const preview = truncated ? buffer.subarray(0, MAX_DIAGNOSTIC_LOG_BYTES) : buffer

  return {
    file,
    truncated,
    content: `${preview.toString('utf-8')}${truncated ? '\n\n[truncated for diagnostics export]' : ''}`,
  }
}

export function createLogService(options: CreateLogServiceOptions) {
  const { projectStore, settingsStore } = options

  function listLogs() {
    try {
      return JSON.stringify(ok(listLogFiles()))
    } catch (error) {
      return JSON.stringify(fail('LOG_LIST_FAILED', 'Unable to list log files', (error as Error).message))
    }
  }

  function readLog(msg: string) {
    try {
      const { path } = JSON.parse(msg) as { path: string }
      const resolvedPath = resolveLogPath(path)

      if (!fs.existsSync(resolvedPath)) {
        return JSON.stringify(fail('LOG_NOT_FOUND', 'The requested log file does not exist'))
      }

      return JSON.stringify(
        ok({
          file: readLogFileSummary(resolvedPath),
          content: fs.readFileSync(resolvedPath, { encoding: 'utf-8' }),
        }),
      )
    } catch (error) {
      return JSON.stringify(fail('LOG_READ_FAILED', 'Unable to read log file', (error as Error).message))
    }
  }

  function listRecentFailures(limit = 20): DiagnosticsFailureEntry[] {
    return projectStore
      .listProjects()
      .flatMap(project =>
        project.publishResults
          .filter(result => result.status === 'failed')
          .map(result => ({
            projectId: project.id,
            projectName: project.name,
            stage: project.stage,
            result,
          })),
      )
      .sort((left, right) => {
        const leftValue = new Date(left.result.timestamp ?? 0).getTime()
        const rightValue = new Date(right.result.timestamp ?? 0).getTime()
        return rightValue - leftValue
      })
      .slice(0, limit)
  }

  function buildDiagnosticsBundle(): DiagnosticsBundle {
    const { files, directory } = listLogFiles()

    return {
      generatedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      userDataPath: app.getPath('userData'),
      logDirectory: directory,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      settings: settingsStore.getAppSettings(),
      projectStats: projectStore.getProjectStats(),
      failures: listRecentFailures(),
      logs: files.map(readDiagnosticLogEntry),
    }
  }

  async function exportDiagnostics() {
    try {
      const bundle = buildDiagnosticsBundle()
      const fileName = `nexus-publish-diagnostics-${bundle.generatedAt.replace(/[:.]/g, '-')}.json`
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export diagnostics bundle',
        defaultPath: join(app.getPath('documents'), fileName),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (canceled || !filePath) {
        return JSON.stringify(
          ok({
            canceled: true,
            path: '',
            fileName,
            generatedAt: bundle.generatedAt,
            includedLogCount: bundle.logs.length,
            includedFailureCount: bundle.failures.length,
          }),
        )
      }

      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), { encoding: 'utf-8' })

      return JSON.stringify(
        ok({
          canceled: false,
          path: filePath,
          fileName,
          generatedAt: bundle.generatedAt,
          includedLogCount: bundle.logs.length,
          includedFailureCount: bundle.failures.length,
        }),
      )
    } catch (error) {
      return JSON.stringify(
        fail('LOG_EXPORT_FAILED', 'Unable to export diagnostics bundle', (error as Error).message),
      )
    }
  }

  return {
    listLogs,
    readLog,
    exportDiagnostics,
  }
}
