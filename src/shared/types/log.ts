import type { ProjectStage, ProjectStats } from './project'
import type { PublishResult } from './publish'
import type { AppSettings } from './settings'

export interface LogFileSummary {
  name: string
  path: string
  size: number
  updatedAt: string
}

export interface LogListPayload {
  files: LogFileSummary[]
  directory: string
}

export interface LogReadPayload {
  file: LogFileSummary
  content: string
}

export interface DiagnosticsLogEntry {
  file: LogFileSummary
  content: string
  truncated: boolean
}

export interface DiagnosticsFailureEntry {
  projectId: number
  projectName: string
  stage: ProjectStage
  result: PublishResult
}

export interface DiagnosticsBundle {
  generatedAt: string
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  userDataPath: string
  logDirectory: string
  safeStorageAvailable: boolean
  settings: AppSettings
  projectStats: ProjectStats
  failures: DiagnosticsFailureEntry[]
  logs: DiagnosticsLogEntry[]
}

export interface DiagnosticsExportPayload {
  canceled: boolean
  path: string
  fileName: string
  generatedAt: string
  includedLogCount: number
  includedFailureCount: number
}
