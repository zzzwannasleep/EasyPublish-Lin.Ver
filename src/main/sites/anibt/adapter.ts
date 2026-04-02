import { createHash } from 'crypto'
import axios from 'axios'
import fs from 'fs'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import { htmlToMarkdown } from '../../services/markup-conversion'
import type { SiteAdapter } from '../adapter'

const ANIBT_WEB_BASE = 'https://anibt.net'
const ANIBT_API_BASE = 'https://site.anibt.net'
const ANIBT_PUBLISH_PATH = 'api/releases/publish'

const ANIBT_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'bangumiId',
    labelKey: 'sites.form.bangumiId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.anibtBangumiIdHelp',
    control: 'number',
    mode: 'required',
    min: 1,
  },
  {
    key: 'trackersText',
    labelKey: 'sites.form.trackers',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.anibtTrackersHelp',
    control: 'text',
    mode: 'optional',
    placeholderKey: 'sites.form.trackersPlaceholder',
  },
]

interface AnibtPublishDraft {
  bangumiId: number
  title: string
  torrentPath: string
  notes?: string
  trackers: string[]
}

interface BencodeDictionary {
  [key: string]: BencodeValue
}

interface BencodeList extends Array<BencodeValue> {}

type BencodeValue = Buffer | number | BencodeList | BencodeDictionary

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function normalizeAnibtSiteBase(baseUrl: string) {
  const trimmed = baseUrl.trim() || ANIBT_WEB_BASE
  const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function joinAnibtUrl(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString()
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

function maybeConvertHtmlToMarkdown(value?: string) {
  if (!value) {
    return undefined
  }

  return /<[^>]+>/.test(value) ? htmlToMarkdown(value).trim() || undefined : value
}

function readResponseMessage(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim() !== '') {
    return data.trim()
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }

  const record = data as Record<string, unknown>
  const candidateKeys = ['message', 'Message', 'msg', 'error', 'Error', 'detail', 'Detail']
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

function parseJsonPayload(payload: unknown) {
  if (payload && typeof payload === 'object') {
    return payload
  }

  if (typeof payload !== 'string') {
    return payload
  }

  try {
    return JSON.parse(payload) as unknown
  } catch {
    return payload
  }
}

function collectNestedRecords(value: unknown) {
  const records: Array<Record<string, unknown>> = []
  const queue: unknown[] = [value]
  const seen = new Set<unknown>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || Array.isArray(current) || seen.has(current)) {
      continue
    }

    seen.add(current)
    const record = current as Record<string, unknown>
    records.push(record)
    Object.values(record).forEach(item => {
      if (item && typeof item === 'object') {
        queue.push(item)
      }
    })
  }

  return records
}

function readResponseSuccess(data: unknown) {
  const payload = parseJsonPayload(data)
  const records = collectNestedRecords(payload)

  for (const record of records) {
    for (const key of ['success', 'ok']) {
      if (typeof record[key] === 'boolean') {
        return record[key] as boolean
      }
    }

    for (const key of ['status', 'result', 'state']) {
      const value = record[key]
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['success', 'ok', 'published', 'created'].includes(normalized)) {
          return true
        }
        if (['error', 'failed', 'failure'].includes(normalized)) {
          return false
        }
      }
    }
  }

  return undefined
}

function extractRemoteUrl(data: unknown) {
  const payload = parseJsonPayload(data)
  const records = collectNestedRecords(payload)

  for (const record of records) {
    for (const key of ['url', 'href', 'link', 'releaseUrl', 'permalink']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') {
        const trimmed = value.trim()
        if (/^https?:\/\//i.test(trimmed)) {
          return trimmed
        }
        if (trimmed.startsWith('/')) {
          return joinAnibtUrl(ANIBT_WEB_BASE, trimmed)
        }
      }
    }
  }

  return undefined
}

function extractRemoteId(data: unknown) {
  const payload = parseJsonPayload(data)
  const records = collectNestedRecords(payload)

  for (const record of records) {
    for (const key of ['id', 'releaseId', 'slug']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim()
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value}`
      }
    }
  }

  return undefined
}

function describeAnibtSite(profile: SiteProfile): SiteCatalogEntry {
  const normalizedBaseUrl = normalizeAnibtSiteBase(profile.baseUrl)
  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl,
    apiBaseUrl: joinAnibtUrl(ANIBT_API_BASE, ANIBT_PUBLISH_PATH),
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes: [
      'Publishes through the Anibt release API with Bearer token authentication.',
      'The adapter converts the selected .torrent into a magnet link automatically before publishing.',
      'Shared description content is sent as optional release notes and HTML content is converted to Markdown first.',
    ],
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneSiteFieldSchemas(ANIBT_FIELD_SCHEMAS),
  }
}

function validateAnibtPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const bangumiId = asPositiveNumber(payload.bangumiId)
  const title = asString(payload.title)
  const torrentPath = asString(payload.torrentPath)

  if (!bangumiId) {
    issues.push({
      field: 'bangumiId',
      message: `A Bangumi ID is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  }

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

  return issues
}

function parseAnibtPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): AnibtPublishDraft {
  const issues = validateAnibtPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const bangumiId = asPositiveNumber(payload.bangumiId)
  const title = asString(payload.title)
  const torrentPath = asString(payload.torrentPath)
  if (!bangumiId || !title || !torrentPath) {
    throw new Error('Anibt publish validation did not produce the required fields')
  }

  return {
    bangumiId,
    title,
    torrentPath,
    notes: maybeConvertHtmlToMarkdown(asString(payload.description)),
    trackers: parseTrackers(payload.trackers ?? payload.trackersText),
  }
}

function parseBencode(data: Buffer, offset: number): { value: BencodeValue; next: number } {
  const marker = String.fromCharCode(data[offset])

  if (marker === 'i') {
    const end = data.indexOf(101, offset + 1)
    if (end < 0) {
      throw new Error('Invalid torrent file: unterminated integer value')
    }

    const value = Number.parseInt(data.toString('ascii', offset + 1, end), 10)
    if (!Number.isFinite(value)) {
      throw new Error('Invalid torrent file: malformed integer value')
    }

    return { value, next: end + 1 }
  }

  if (marker === 'l') {
    const value: BencodeValue[] = []
    let cursor = offset + 1
    while (data[cursor] !== 101) {
      const parsed = parseBencode(data, cursor)
      value.push(parsed.value)
      cursor = parsed.next
    }

    return { value, next: cursor + 1 }
  }

  if (marker === 'd') {
    const value: Record<string, BencodeValue> = {}
    let cursor = offset + 1
    while (data[cursor] !== 101) {
      const keyResult = parseBencode(data, cursor)
      if (!Buffer.isBuffer(keyResult.value)) {
        throw new Error('Invalid torrent file: dictionary keys must be byte strings')
      }

      const key = keyResult.value.toString('utf8')
      const valueResult = parseBencode(data, keyResult.next)
      value[key] = valueResult.value
      cursor = valueResult.next
    }

    return { value, next: cursor + 1 }
  }

  if (marker >= '0' && marker <= '9') {
    const separator = data.indexOf(58, offset)
    if (separator < 0) {
      throw new Error('Invalid torrent file: malformed byte string length')
    }

    const length = Number.parseInt(data.toString('ascii', offset, separator), 10)
    if (!Number.isFinite(length) || length < 0) {
      throw new Error('Invalid torrent file: malformed byte string length')
    }

    const start = separator + 1
    const end = start + length
    return {
      value: data.subarray(start, end),
      next: end,
    }
  }

  throw new Error('Invalid torrent file: unsupported bencode marker')
}

function collectTrackersFromBencode(value: BencodeValue): string[] {
  if (Buffer.isBuffer(value)) {
    const tracker = value.toString('utf8').trim()
    return tracker ? [tracker] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectTrackersFromBencode)
  }

  return []
}

function buildTorrentMagnet(torrentPath: string, title: string, preferredTrackers: string[]) {
  const torrent = fs.readFileSync(torrentPath)
  if (torrent[0] !== 100) {
    throw new Error('The selected torrent file is not a valid bencoded torrent')
  }

  let cursor = 1
  let infoBytes: Buffer | undefined
  const trackerCandidates: string[] = []

  while (torrent[cursor] !== 101) {
    const keyResult = parseBencode(torrent, cursor)
    if (!Buffer.isBuffer(keyResult.value)) {
      throw new Error('The selected torrent file has an invalid top-level structure')
    }

    const key = keyResult.value.toString('utf8')
    const valueStart = keyResult.next
    const valueResult = parseBencode(torrent, valueStart)

    if (key === 'info') {
      infoBytes = torrent.subarray(valueStart, valueResult.next)
    } else if (key === 'announce') {
      trackerCandidates.push(...collectTrackersFromBencode(valueResult.value))
    } else if (key === 'announce-list') {
      trackerCandidates.push(...collectTrackersFromBencode(valueResult.value))
    }

    cursor = valueResult.next
  }

  if (!infoBytes) {
    throw new Error('The selected torrent file is missing its info dictionary')
  }

  const trackers = [...new Set([...(preferredTrackers ?? []), ...trackerCandidates])]
  const infoHash = createHash('sha1').update(infoBytes).digest('hex')
  const magnetParts = [`magnet:?xt=urn:btih:${infoHash}`]

  if (title.trim()) {
    magnetParts.push(`dn=${encodeURIComponent(title.trim())}`)
  }

  trackers.forEach(tracker => {
    magnetParts.push(`tr=${encodeURIComponent(tracker)}`)
  })

  return {
    infoHash,
    trackers,
    magnetUri: magnetParts.join('&'),
  }
}

export function createAnibtAdapter(): SiteAdapter {
  return {
    id: 'anibt',
    displayName: 'Anibt',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'token_auth',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'anibt'
    },
    describe(profile) {
      return describeAnibtSite(profile)
    },
    async validateAccount({ credentials }) {
      const apiToken = credentials?.apiToken?.trim()
      if (!apiToken) {
        return {
          status: 'unauthenticated',
          message: 'Anibt API token is required',
        }
      }

      try {
        const response = await axios.post(
          joinAnibtUrl(ANIBT_API_BASE, ANIBT_PUBLISH_PATH),
          {},
          {
            responseType: 'text',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
          },
        )

        if ([200, 400, 422].includes(response.status)) {
          return {
            status: 'authenticated',
            message: 'Validated Anibt API token',
            raw: response.data,
          }
        }

        const responseMessage = readResponseMessage(parseJsonPayload(response.data))
        if (response.status === 401 || response.status === 403) {
          return {
            status: 'unauthenticated',
            message: responseMessage || `Anibt API token was rejected with HTTP ${response.status}`,
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: responseMessage || `Anibt validation failed with HTTP ${response.status}`,
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
      return validateAnibtPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const apiToken = credentials?.apiToken?.trim()
      if (!apiToken) {
        throw new Error('Anibt API token is required')
      }

      const draft = parseAnibtPublishDraft(profile, payload)
      const endpoint = joinAnibtUrl(ANIBT_API_BASE, ANIBT_PUBLISH_PATH)
      const magnet = buildTorrentMagnet(draft.torrentPath, draft.title, draft.trackers)
      const requestPayload: Record<string, unknown> = {
        bgmId: draft.bangumiId,
        title: draft.title,
        magnetBase64: magnet.magnetUri,
      }

      if (draft.notes) {
        requestPayload.notes = draft.notes
      }

      if (magnet.trackers.length > 0) {
        requestPayload.trackers = magnet.trackers
      }

      const response = await axios.post(endpoint, requestPayload, {
        responseType: 'text',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
      })

      const parsedResponse = parseJsonPayload(response.data)
      const responseMessage = readResponseMessage(parsedResponse)
      if (response.status === 401 || response.status === 403) {
        throw new Error(responseMessage || `Anibt API token was rejected with HTTP ${response.status}`)
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(responseMessage || `Anibt publish failed with HTTP ${response.status}`)
      }

      if (readResponseSuccess(parsedResponse) === false) {
        throw new Error(responseMessage || 'Anibt publish request was rejected by the server')
      }

      const remoteUrl = extractRemoteUrl(parsedResponse)
      const remoteId = extractRemoteId(parsedResponse) ?? magnet.infoHash
      const raw = {
        request: requestPayload,
        response: parsedResponse,
        responseText: response.data,
        remoteUrl,
      }

      return {
        result: {
          siteId: profile.id,
          status: 'published',
          remoteId,
          remoteUrl,
          message: remoteUrl ? `Published through Anibt adapter: ${remoteUrl}` : 'Published through Anibt adapter',
          rawResponse: raw,
          timestamp: new Date().toISOString(),
        },
        raw,
      }
    },
  }
}
