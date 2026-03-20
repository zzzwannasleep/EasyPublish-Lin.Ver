import axios from 'axios'
import fs from 'fs'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import type { SiteAdapter } from '../adapter'

const MIKAN_EPISODE_ENDPOINT = 'https://api.mikanani.me/api/episode'
const MIKAN_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'trackersText',
    labelKey: 'sites.form.trackers',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.mikanTrackersHelp',
    control: 'text',
    mode: 'optional',
    placeholderKey: 'sites.form.trackersPlaceholder',
  },
  {
    key: 'bangumiId',
    labelKey: 'sites.form.bangumiId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.mikanBangumiIdHelp',
    control: 'number',
    mode: 'optional',
    min: 1,
  },
  {
    key: 'subtitleGroupId',
    labelKey: 'sites.form.subtitleGroupId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.mikanSubtitleGroupIdHelp',
    control: 'number',
    mode: 'optional',
    min: 1,
  },
  {
    key: 'publishGroupId',
    labelKey: 'sites.form.publishGroupId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.mikanPublishGroupIdHelp',
    control: 'number',
    mode: 'optional',
    min: 1,
  },
]

interface MikanPublishDraft {
  title: string
  torrentPath: string
  description?: string
  trackers: string[]
  bangumiId?: number
  subtitleGroupId?: number
  publishGroupId?: number
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function parseTrackers(value: unknown): string[] {
  const arrayValue = asStringArray(value)
  if (arrayValue.length > 0) {
    return [...new Set(arrayValue)]
  }

  const textValue = asString(value)
  if (!textValue) {
    return []
  }

  return [
    ...new Set(
      textValue
        .split(/[\r\n,]+/)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
}

function readResponseMessage(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim() !== '') {
    return data.trim()
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }

  const record = data as Record<string, unknown>
  const candidateKeys = ['message', 'Message', 'error', 'Error', 'detail', 'Detail']
  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }

  try {
    return JSON.stringify(data)
  } catch {
    return undefined
  }
}

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function describeMikanSite(profile: SiteProfile): SiteCatalogEntry {
  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl: normalizeBaseUrl(profile.baseUrl),
    apiBaseUrl: MIKAN_EPISODE_ENDPOINT,
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes: [
      'Publishes through the Mikan episode API with token-based authentication.',
      'Optional description, trackers, Bangumi/subtitle group ids, and publish group id are supported.',
    ],
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneSiteFieldSchemas(MIKAN_FIELD_SCHEMAS),
  }
}

function validateMikanPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const title = asString(payload.title)
  const torrentPath = asString(payload.torrentPath)
  const trackers = parseTrackers(payload.trackers ?? payload.trackersText)
  const bangumiId = asPositiveNumber(payload.bangumiId)
  const subtitleGroupId = asPositiveNumber(payload.subtitleGroupId)
  const publishGroupId = asPositiveNumber(payload.publishGroupId)
  const hasBangumiId = payload.bangumiId !== undefined && payload.bangumiId !== null && `${payload.bangumiId}`.trim() !== ''
  const hasSubtitleGroupId =
    payload.subtitleGroupId !== undefined && payload.subtitleGroupId !== null && `${payload.subtitleGroupId}`.trim() !== ''
  const hasPublishGroupId =
    payload.publishGroupId !== undefined && payload.publishGroupId !== null && `${payload.publishGroupId}`.trim() !== ''

  if (!title) {
    issues.push({
      field: 'title',
      message: `A title is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  }

  if (!torrentPath) {
    issues.push({
      field: 'torrentPath',
      message: 'A torrent file path is required',
      severity: 'error',
    })
  } else if (!fs.existsSync(torrentPath)) {
    issues.push({
      field: 'torrentPath',
      message: 'The selected torrent file does not exist',
      severity: 'error',
    })
  }

  if (trackers.length > 10) {
    issues.push({
      field: 'trackers',
      message: 'Mikan accepts at most 10 trackers; only the first 10 will be sent',
      severity: 'warning',
    })
  }

  if (hasBangumiId !== hasSubtitleGroupId) {
    issues.push({
      field: 'bangumiId',
      message: 'bangumiId and subtitleGroupId must be provided together',
      severity: 'error',
    })
  }

  if (hasBangumiId && bangumiId === undefined) {
    issues.push({
      field: 'bangumiId',
      message: 'bangumiId must be a positive number',
      severity: 'error',
    })
  }

  if (hasSubtitleGroupId && subtitleGroupId === undefined) {
    issues.push({
      field: 'subtitleGroupId',
      message: 'subtitleGroupId must be a positive number',
      severity: 'error',
    })
  }

  if (hasPublishGroupId && publishGroupId === undefined) {
    issues.push({
      field: 'publishGroupId',
      message: 'publishGroupId must be a positive number',
      severity: 'error',
    })
  }

  return issues
}

function parseMikanPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): MikanPublishDraft {
  const issues = validateMikanPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const title = asString(payload.title)
  const torrentPath = asString(payload.torrentPath)
  const description = asString(payload.description)
  const trackers = parseTrackers(payload.trackers ?? payload.trackersText).slice(0, 10)
  const bangumiId = asPositiveNumber(payload.bangumiId)
  const subtitleGroupId = asPositiveNumber(payload.subtitleGroupId)
  const publishGroupId = asPositiveNumber(payload.publishGroupId)
  if (!title || !torrentPath) {
    throw new Error('Mikan publish validation did not produce the required fields')
  }

  return {
    title,
    torrentPath,
    description,
    trackers,
    bangumiId,
    subtitleGroupId,
    publishGroupId,
  }
}

export function createMikanAdapter(): SiteAdapter {
  return {
    id: 'mikan',
    displayName: 'Mikan',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'token_auth',
      'browser_login',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'mikan'
    },
    describe(profile) {
      return describeMikanSite(profile)
    },
    async validateAccount({ credentials }) {
      const apiToken = credentials?.apiToken?.trim()
      if (!apiToken) {
        return {
          status: 'unauthenticated',
          message: 'Mikan API token is required',
        }
      }

      try {
        const response = await axios.post(
          MIKAN_EPISODE_ENDPOINT,
          {},
          {
            responseType: 'text',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `MikanHash ${apiToken}`,
            },
          },
        )

        if ([200, 400, 415, 422].includes(response.status)) {
          return {
            status: 'authenticated',
            message: 'Validated Mikan API token',
            raw: response.data,
          }
        }

        const responseMessage = readResponseMessage(response.data)
        if (response.status === 401 || response.status === 403) {
          return {
            status: 'unauthenticated',
            message: responseMessage || `Mikan API token was rejected with HTTP ${response.status}`,
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: responseMessage || `Mikan validation failed with HTTP ${response.status}`,
          raw: response.data,
        }
      } catch (error) {
        return {
          status: 'error',
          message: (error as Error).message,
        }
      }
    },
    async validatePublish({ profile, payload }) {
      return validateMikanPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const apiToken = credentials?.apiToken?.trim()
      if (!apiToken) {
        throw new Error('Mikan API token is required')
      }

      const draft = parseMikanPublishDraft(profile, payload)
      const requestPayload: Record<string, unknown> = {
        name: draft.title,
        torrentBase64: fs.readFileSync(draft.torrentPath).toString('base64'),
      }

      if (draft.description) {
        requestPayload.description = draft.description
      }

      if (draft.trackers.length > 0) {
        requestPayload.trackers = draft.trackers
      }

      if (draft.bangumiId && draft.subtitleGroupId) {
        requestPayload.bangumiId = draft.bangumiId
        requestPayload.subtitleGroupId = draft.subtitleGroupId
      }

      if (draft.publishGroupId) {
        requestPayload.publishGroupId = draft.publishGroupId
      }

      const response = await axios.post(
        MIKAN_EPISODE_ENDPOINT,
        requestPayload,
        {
          responseType: 'text',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `MikanHash ${apiToken}`,
          },
        },
      )

      const responseMessage = readResponseMessage(response.data)
      if (response.status === 401 || response.status === 403) {
        throw new Error(responseMessage || `Mikan API token was rejected with HTTP ${response.status}`)
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(responseMessage || `Mikan publish failed with HTTP ${response.status}`)
      }

      return {
        result: {
          siteId: profile.id,
          status: 'published',
          message: responseMessage || 'Published through Mikan adapter',
          rawResponse: response.data,
          timestamp: new Date().toISOString(),
        },
        raw: response.data,
      }
    },
  }
}
