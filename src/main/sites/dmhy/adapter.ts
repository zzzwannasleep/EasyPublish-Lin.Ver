import axios from 'axios'
import fs from 'fs'
import { basename } from 'path'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type {
  SiteCatalogEntry,
  SiteFieldSchemaEntry,
  SiteMetadataRecord,
  SiteProfile,
  SiteSection,
  SiteSectionOption,
  SiteValidationIssue,
} from '../../../shared/types/site'
import { escapeHtml, sleep, unescapeHtml } from '../../core/utils'
import type { SiteAdapter } from '../adapter'

const DMHY_UPLOAD_EXISTS = '種子已存在，請不要重複上傳'
const DMHY_UPLOAD_SUCCESS = '上傳成功'
const DMHY_SUBMIT_LABEL = '提交'
const DMHY_UPLOAD_ENDPOINT = 'topics/add'
const DMHY_USER_ENDPOINT = 'user'
const DMHY_TEAM_LIST_ENDPOINT = 'topics/mlist/scope/team'
const DMHY_CATEGORY_OPTIONS = [
  { label: '動畫', value: '2' },
  { label: '季度全集', value: '31' },
  { label: '漫畫', value: '3' },
  { label: '港台原版', value: '41' },
  { label: '日文原版', value: '42' },
  { label: '音樂', value: '4' },
  { label: '動漫音樂', value: '43' },
  { label: '同人音樂', value: '44' },
  { label: '流行音樂', value: '15' },
  { label: '日劇', value: '6' },
  { label: 'ＲＡＷ', value: '7' },
  { label: '遊戲', value: '9' },
  { label: '電腦遊戲', value: '17' },
  { label: '電視遊戲', value: '18' },
  { label: '掌機遊戲', value: '19' },
  { label: '網絡遊戲', value: '20' },
  { label: '遊戲周邊', value: '21' },
  { label: '特攝', value: '12' },
  { label: '其他', value: '1' },
] as const

const DMHY_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'typeId',
    labelKey: 'sites.form.category',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.dmhyCategoryHelp',
    control: 'select',
    mode: 'required',
    options: [...DMHY_CATEGORY_OPTIONS],
  },
  {
    key: 'teamId',
    labelKey: 'sites.form.teamId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.dmhyTeamHelp',
    control: 'number',
    mode: 'optional',
    min: 0,
  },
  {
    key: 'posterUrl',
    labelKey: 'sites.form.posterUrl',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.dmhyPosterUrlHelp',
    control: 'text',
    mode: 'optional',
  },
]

interface DmhyResolvedAuth {
  siteBaseUrl: string
  headers: Record<string, string>
}

interface DmhyPublishDraft {
  typeId: number
  teamId: number
  title: string
  description: string
  torrentPath: string
  posterUrl?: string
  trackers: string[]
  disableDownloadSeedFile: boolean
  emuleResource?: string
  syncKey?: string
}

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function normalizeDmhySiteBase(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('DMHY base URL is required')
  }

  const url = new URL(trimmed)
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function joinDmhyUrl(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString()
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}

function asNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
  }

  return undefined
}

function asBoolean(value: unknown) {
  return value === true
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

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value: string) {
  return unescapeHtml(stripHtml(value))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildCookieHeader(credentials?: SiteCredentialRecord) {
  const cookiePairs = credentials?.cookies
    ?.filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)

  return cookiePairs && cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function resolveDmhyAuth(profile: SiteProfile, credentials?: SiteCredentialRecord): DmhyResolvedAuth {
  const siteBaseUrl = normalizeDmhySiteBase(profile.baseUrl)
  const cookieHeader = buildCookieHeader(credentials)
  if (!cookieHeader) {
    throw new Error('DMHY requires saved cookies from the BT account login flow. Please log in to DMHY first.')
  }

  return {
    siteBaseUrl,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookieHeader,
    },
  }
}

function createDmhyHttpClient() {
  return axios.create({
    maxRedirects: 0,
    validateStatus: () => true,
  })
}

function readResponseText(data: unknown) {
  return typeof data === 'string' ? data : JSON.stringify(data)
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400
}

function ensureAuthenticatedHtml(responseStatus: number, html: string, siteName: string) {
  if (isRedirectStatus(responseStatus)) {
    throw new Error(`${siteName} session has expired. Please log in again.`)
  }

  if (responseStatus === 401 || responseStatus === 403) {
    throw new Error(`${siteName} rejected the current session with HTTP ${responseStatus}`)
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    throw new Error(`${siteName} request failed with HTTP ${responseStatus}`)
  }

  if (!html.includes('bt_data_title') || !html.includes('sort_id')) {
    throw new Error(`${siteName} upload form was not available for the current account`)
  }
}

function parseSelectOptions(html: string, selectName: string, mode: 'positive' | 'nonnegative'): SiteSectionOption[] {
  const selectMatch = html.match(
    new RegExp(`<select\\b[^>]*name=(["'])${escapeRegExp(selectName)}\\1[^>]*>([\\s\\S]*?)</select>`, 'i'),
  )
  if (!selectMatch) {
    return []
  }

  const optionPattern = /<option\b[^>]*value=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/option>/gi
  const options: SiteSectionOption[] = []
  let match = optionPattern.exec(selectMatch[2])
  while (match) {
    const rawValue = match[2].trim()
    const parsed = mode === 'positive' ? asPositiveInteger(rawValue) : asNonNegativeInteger(rawValue)
    if (parsed !== undefined) {
      const label = decodeHtml(match[3])
      if (label) {
        options.push({ id: parsed, name: label })
      }
    }
    match = optionPattern.exec(selectMatch[2])
  }

  return options
}

function extractFirstImageUrl(html: string) {
  const match = html.match(/<img\b[^>]*src=(["'])(.*?)\1/i)
  return match?.[2]?.trim() || undefined
}

function normalizeComparableTitle(value: string) {
  return decodeHtml(value).replace(/\s+/g, ' ').trim()
}

function parseRemoteIdFromUrl(value?: string) {
  if (!value) {
    return undefined
  }

  const idMatch = value.match(/id[=/](\d+)/i) ?? value.match(/\/(\d+)(?:$|[/?#])/)
  return idMatch?.[1]
}

async function findDmhyRemoteUrl(siteBaseUrl: string, headers: Record<string, string>, title: string) {
  const client = createDmhyHttpClient()
  const expectedTitle = normalizeComparableTitle(title)
  const titlePattern = new RegExp(escapeRegExp(escapeHtml(title)).replace(/\s+/g, '[\\s\\S]*?'))

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await sleep(1000)
    }

    const response = await client.get(joinDmhyUrl(siteBaseUrl, DMHY_TEAM_LIST_ENDPOINT), { headers })
    if (isRedirectStatus(response.status) || response.status === 401 || response.status === 403) {
      return undefined
    }

    const html = readResponseText(response.data)
    const anchorPattern = /<a\s+href=(["'])(.*?)\1[^>]*target=(["'])_blank\3[^>]*>([\s\S]*?)<\/a>/gi
    let match = anchorPattern.exec(html)
    while (match) {
      const href = match[2]
      const labelHtml = match[4]
      const normalizedLabel = normalizeComparableTitle(labelHtml)
      if (normalizedLabel === expectedTitle || titlePattern.test(labelHtml)) {
        return new URL(href, `${siteBaseUrl}/`).toString()
      }
      match = anchorPattern.exec(html)
    }
  }

  return undefined
}

function validateDmhyPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const typeId = asPositiveInteger(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const teamId =
    payload.teamId === undefined || payload.teamId === null || `${payload.teamId}`.trim() === ''
      ? undefined
      : asNonNegativeInteger(payload.teamId)

  if (!typeId) {
    issues.push({
      field: 'typeId',
      message: `A DMHY category is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  }

  if (!title) {
    issues.push({
      field: 'title',
      message: 'Title is required',
      severity: 'error',
    })
  }

  if (!description) {
    issues.push({
      field: 'description',
      message: 'Description is required',
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

  if (
    payload.teamId !== undefined &&
    payload.teamId !== null &&
    `${payload.teamId}`.trim() !== '' &&
    teamId === undefined
  ) {
    issues.push({
      field: 'teamId',
      message: 'teamId must be a non-negative integer',
      severity: 'error',
    })
  }

  if (!asString(payload.posterUrl) && !extractFirstImageUrl(description ?? '')) {
    issues.push({
      field: 'posterUrl',
      message: 'No poster URL was provided and no image was found in the description; DMHY will publish without a poster.',
      severity: 'warning',
    })
  }

  return issues
}

function parseDmhyPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): DmhyPublishDraft {
  const issues = validateDmhyPublishDraft(profile, payload)
  const blockingIssues = issues.filter(issue => issue.severity === 'error')
  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map(issue => issue.message).join(' | '))
  }

  const typeId = asPositiveInteger(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)

  if (!typeId || !title || !description || !torrentPath) {
    throw new Error('DMHY publish validation did not produce the required fields')
  }

  return {
    typeId,
    teamId: asNonNegativeInteger(payload.teamId) ?? 0,
    title,
    description,
    torrentPath,
    posterUrl: asString(payload.posterUrl) ?? extractFirstImageUrl(description),
    trackers: parseTrackers(payload.trackers ?? payload.trackersText),
    disableDownloadSeedFile: asBoolean(payload.disableDownloadSeedFile),
    emuleResource: asString(payload.emuleResource),
    syncKey: asString(payload.syncKey),
  }
}

function describeDmhySite(profile: SiteProfile): SiteCatalogEntry {
  let normalizedBaseUrl = profile.baseUrl.trim()
  const notes: string[] = []

  try {
    normalizedBaseUrl = normalizeDmhySiteBase(profile.baseUrl)
    notes.push('Publishes through the DMHY web upload form with an authenticated browser-cookie session.')
    notes.push('Load metadata to fetch the current category list and your available publish teams.')
  } catch (error) {
    notes.push((error as Error).message)
  }

  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl,
    apiBaseUrl: joinDmhyUrl(normalizedBaseUrl, DMHY_UPLOAD_ENDPOINT),
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes,
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneSiteFieldSchemas(DMHY_FIELD_SCHEMAS),
  }
}

export function createDmhyAdapter(): SiteAdapter {
  return {
    id: 'dmhy',
    displayName: 'DMHY',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'cookie_auth',
      'username_password_auth',
      'browser_login',
      'metadata_sections',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'dmhy'
    },
    describe(profile) {
      return describeDmhySite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const { siteBaseUrl, headers } = resolveDmhyAuth(profile, credentials)
        const client = createDmhyHttpClient()
        const response = await client.get(joinDmhyUrl(siteBaseUrl, DMHY_USER_ENDPOINT), { headers })

        if (response.status >= 200 && response.status < 300) {
          return {
            status: 'authenticated',
            message: `Validated DMHY session at ${siteBaseUrl}`,
            raw: response.data,
          }
        }

        if (isRedirectStatus(response.status) || response.status === 401 || response.status === 403) {
          return {
            status: 'unauthenticated',
            message: 'DMHY session is missing or expired',
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: `DMHY validation failed with HTTP ${response.status}`,
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
      return validateDmhyPublishDraft(profile, payload)
    },
    async loadMetadata({ profile, credentials }) {
      const { siteBaseUrl, headers } = resolveDmhyAuth(profile, credentials)
      const client = createDmhyHttpClient()
      const response = await client.get(joinDmhyUrl(siteBaseUrl, DMHY_UPLOAD_ENDPOINT), { headers })
      const html = readResponseText(response.data)

      ensureAuthenticatedHtml(response.status, html, profile.name)

      const categories = parseSelectOptions(html, 'sort_id', 'positive')
      const teams = parseSelectOptions(html, 'team_id', 'nonnegative')
      if (categories.length === 0) {
        throw new Error('DMHY upload form did not expose any category options')
      }

      const section: SiteSection = {
        id: 1,
        name: 'upload',
        displayName: 'DMHY Upload',
        categories,
        tags: [],
        subCategories: [
          {
            field: 'teamId',
            label: '發布方式',
            data: teams,
          },
        ],
      }

      const metadata: SiteMetadataRecord = {
        siteId: profile.id,
        apiBaseUrl: joinDmhyUrl(siteBaseUrl, DMHY_UPLOAD_ENDPOINT),
        sections: [section],
        raw: {
          categoryCount: categories.length,
          teamCount: teams.length,
        },
      }

      return metadata
    },
    async publish({ profile, payload, credentials }) {
      const draft = parseDmhyPublishDraft(profile, payload)
      const { siteBaseUrl, headers } = resolveDmhyAuth(profile, credentials)
      const client = createDmhyHttpClient()
      const torrentPart = new Blob([fs.readFileSync(draft.torrentPath)], {
        type: 'application/x-bittorrent',
      })

      const formData = new FormData()
      formData.append('sort_id', `${draft.typeId}`)
      formData.append('team_id', `${draft.teamId}`)
      formData.append('bt_data_title', draft.title)
      formData.append('poster_url', draft.posterUrl ?? '')
      formData.append('bt_data_intro', draft.description)
      formData.append('tracker', draft.trackers.join('\n'))
      formData.append('MAX_FILE_SIZE', '2097152')
      formData.append('bt_file', torrentPart, basename(draft.torrentPath))
      formData.append('disable_download_seed_file', draft.disableDownloadSeedFile ? '1' : '0')
      formData.append('emule_resource', draft.emuleResource ?? '')
      formData.append('synckey', draft.syncKey ?? '')
      formData.append('submit', DMHY_SUBMIT_LABEL)

      const response = await client.post(joinDmhyUrl(siteBaseUrl, DMHY_UPLOAD_ENDPOINT), formData, { headers })
      const responseText = readResponseText(response.data)
      if (isRedirectStatus(response.status) || response.status === 401 || response.status === 403) {
        throw new Error('DMHY session expired during publish. Please log in again.')
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`DMHY publish failed with HTTP ${response.status}`)
      }

      const duplicate = responseText.includes(DMHY_UPLOAD_EXISTS)
      const success = responseText.includes(DMHY_UPLOAD_SUCCESS)
      if (!duplicate && !success) {
        throw new Error('DMHY publish did not return a recognized success state')
      }

      const remoteUrl = await findDmhyRemoteUrl(siteBaseUrl, headers, draft.title)
      const remoteId = parseRemoteIdFromUrl(remoteUrl)

      return {
        result: {
          siteId: profile.id,
          status: 'published',
          remoteId,
          remoteUrl,
          message: duplicate
            ? 'DMHY reports that the torrent already exists'
            : remoteUrl
              ? `Published through DMHY adapter: ${remoteUrl}`
              : 'Published through DMHY adapter',
          rawResponse: {
            duplicate,
            responseText,
            remoteUrl,
          },
          timestamp: new Date().toISOString(),
        },
        raw: {
          duplicate,
          responseText,
          remoteUrl,
        },
      }
    },
  }
}
