import axios from 'axios'
import fs from 'fs'
import { basename } from 'path'
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
import type { SiteAdapter } from '../adapter'

const MIOBT_POST_API_PATH = 'addon.php?r=api/post/76cad81b'
const MIOBT_TORRENT_FIELD_NAMES = ['torrent_file', 'bt_file', 'torrent', 'file'] as const
const MIOBT_MAX_TITLE_LENGTH = 255
const MIOBT_MIN_INTRO_LENGTH = 20
const MIOBT_MAX_INTRO_LENGTH = 50000
const MIOBT_MAX_DISCUSS_URL_LENGTH = 200
const MIOBT_CATEGORY_OPTIONS: SiteSectionOption[] = [
  { id: 1, name: '动画' },
  { id: 2, name: '漫画' },
  { id: 3, name: '音乐' },
  { id: 4, name: '周边' },
  { id: 5, name: '其它' },
  { id: 6, name: 'Raw' },
]

const MIOBT_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'typeId',
    labelKey: 'sites.form.category',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.miobtCategoryHelp',
    control: 'select',
    mode: 'required',
    options: MIOBT_CATEGORY_OPTIONS.map(option => ({
      label: option.name,
      value: `${option.id}`,
    })),
  },
  {
    key: 'url',
    labelKey: 'sites.form.referenceUrl',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.miobtReferenceUrlHelp',
    control: 'text',
    mode: 'optional',
  },
]

interface MioBtApiResponse {
  status?: string
  code?: number
  message?: string
  infoHash?: string
}

interface MioBtPublishDraft {
  typeId: number
  title: string
  description: string
  torrentPath: string
  discussUrl?: string
}

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function normalizeMiobtSiteBase(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('MioBT base URL is required')
  }

  const url = new URL(trimmed)
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function joinMiobtUrl(baseUrl: string, path: string) {
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

function isKnownCategoryId(typeId?: number) {
  return typeof typeId === 'number' && MIOBT_CATEGORY_OPTIONS.some(option => option.id === typeId)
}

function textLength(value: string) {
  return value.length
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

function toMiobtApiResponse(record: Record<string, unknown>): MioBtApiResponse | undefined {
  const status = asString(record.status)
  const message = asString(record.message)
  const infoHash = asString(record.info_hash ?? record.infoHash)
  const rawCode = record.code
  const code =
    typeof rawCode === 'number' && Number.isFinite(rawCode)
      ? rawCode
      : typeof rawCode === 'string' && rawCode.trim() !== '' && Number.isFinite(Number(rawCode))
        ? Number(rawCode)
        : undefined

  if (!status && code === undefined && !message && !infoHash) {
    return undefined
  }

  return {
    status,
    code,
    message,
    infoHash,
  }
}

function parseMiobtApiResponse(payload: unknown): MioBtApiResponse | undefined {
  if (!payload) {
    return undefined
  }

  if (typeof payload === 'object' && !Array.isArray(payload)) {
    return toMiobtApiResponse(payload as Record<string, unknown>)
  }

  if (typeof payload === 'string') {
    try {
      return toMiobtApiResponse(JSON.parse(payload) as Record<string, unknown>)
    } catch {
      return undefined
    }
  }

  return undefined
}

function buildMiobtRemoteUrl(siteBaseUrl: string, infoHash: string) {
  return joinMiobtUrl(siteBaseUrl, `show-${infoHash}.html`)
}

function describeMiobtSite(profile: SiteProfile): SiteCatalogEntry {
  const normalizedBaseUrl = normalizeMiobtSiteBase(profile.baseUrl)
  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl,
    apiBaseUrl: joinMiobtUrl(normalizedBaseUrl, MIOBT_POST_API_PATH),
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes: [
      'Publishes through the MioBT multipart POST API using user ID and API key authentication.',
      'Load metadata to pick one of the six published MioBT categories before uploading.',
      'The API allows up to 15 successful or duplicate submissions per 24 hours.',
    ],
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneSiteFieldSchemas(MIOBT_FIELD_SCHEMAS),
  }
}

function validateMiobtPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const typeId = asPositiveInteger(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const discussUrl = asString(payload.url ?? payload.discussUrl ?? payload.discuss_url)

  if (!isKnownCategoryId(typeId)) {
    issues.push({
      field: 'typeId',
      message: `A valid MioBT category is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  }

  if (!title) {
    issues.push({
      field: 'title',
      message: `A title is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  } else {
    const length = textLength(title)
    if (length < 1 || length > MIOBT_MAX_TITLE_LENGTH) {
      issues.push({
        field: 'title',
        message: `MioBT titles must be between 1 and ${MIOBT_MAX_TITLE_LENGTH} characters`,
        severity: 'error',
      })
    }
  }

  if (!description) {
    issues.push({
      field: 'description',
      message: 'A description is required',
      severity: 'error',
    })
  } else {
    const length = textLength(description)
    if (length < MIOBT_MIN_INTRO_LENGTH || length > MIOBT_MAX_INTRO_LENGTH) {
      issues.push({
        field: 'description',
        message: `MioBT descriptions must be between ${MIOBT_MIN_INTRO_LENGTH} and ${MIOBT_MAX_INTRO_LENGTH} characters`,
        severity: 'error',
      })
    }
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

  if (discussUrl && textLength(discussUrl) > MIOBT_MAX_DISCUSS_URL_LENGTH) {
    issues.push({
      field: 'url',
      message: `MioBT discussion URLs must not exceed ${MIOBT_MAX_DISCUSS_URL_LENGTH} characters`,
      severity: 'error',
    })
  }

  return issues
}

function parseMiobtPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): MioBtPublishDraft {
  const issues = validateMiobtPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const typeId = asPositiveInteger(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  if (!typeId || !title || !description || !torrentPath) {
    throw new Error('MioBT publish validation did not produce the required fields')
  }

  return {
    typeId,
    title,
    description,
    torrentPath,
    discussUrl: asString(payload.url ?? payload.discussUrl ?? payload.discuss_url),
  }
}

function createMiobtMetadata(profile: SiteProfile): SiteMetadataRecord {
  const siteBaseUrl = normalizeMiobtSiteBase(profile.baseUrl)
  const section: SiteSection = {
    id: 1,
    name: 'upload',
    displayName: 'MioBT Upload',
    categories: MIOBT_CATEGORY_OPTIONS.map(option => ({ ...option })),
    tags: [],
    subCategories: [],
  }

  return {
    siteId: profile.id,
    apiBaseUrl: joinMiobtUrl(siteBaseUrl, MIOBT_POST_API_PATH),
    sections: [section],
    raw: {
      categoryCount: MIOBT_CATEGORY_OPTIONS.length,
    },
  }
}

function createMiobtHttpClient() {
  return axios.create({
    maxRedirects: 0,
    validateStatus: () => true,
  })
}

export function createMiobtAdapter(): SiteAdapter {
  return {
    id: 'miobt',
    displayName: 'MioBT',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'token_auth',
      'metadata_sections',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'miobt'
    },
    describe(profile) {
      return describeMiobtSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      const userId = credentials?.username?.trim()
      const apiKey = credentials?.apiToken?.trim()
      if (!userId || !apiKey) {
        return {
          status: 'unauthenticated',
          message: 'MioBT user ID and API key are required',
        }
      }

      try {
        const client = createMiobtHttpClient()
        const siteBaseUrl = normalizeMiobtSiteBase(profile.baseUrl)
        const formData = new FormData()
        formData.append('user_id', userId)
        formData.append('api_key', apiKey)
        const response = await client.post(joinMiobtUrl(siteBaseUrl, MIOBT_POST_API_PATH), formData, {
          responseType: 'text',
        })
        const data = parseMiobtApiResponse(response.data)
        const responseMessage = data?.message ?? readResponseMessage(response.data)

        if (data?.code === 114 || data?.message === 'auth failed') {
          return {
            status: 'unauthenticated',
            message: responseMessage || 'MioBT API credentials rejected',
            raw: response.data,
          }
        }

        if (response.status === 200) {
          return {
            status: 'authenticated',
            message: responseMessage || 'Validated MioBT API credentials',
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: responseMessage || `MioBT validation returned HTTP ${response.status}`,
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
      return validateMiobtPublishDraft(profile, payload)
    },
    async loadMetadata({ profile }) {
      return createMiobtMetadata(profile)
    },
    async publish({ profile, payload, credentials }) {
      const userId = credentials?.username?.trim()
      const apiKey = credentials?.apiToken?.trim()
      if (!userId || !apiKey) {
        throw new Error('MioBT user ID and API key are required')
      }

      const draft = parseMiobtPublishDraft(profile, payload)
      const client = createMiobtHttpClient()
      const siteBaseUrl = normalizeMiobtSiteBase(profile.baseUrl)
      const endpoint = joinMiobtUrl(siteBaseUrl, MIOBT_POST_API_PATH)
      let fallbackPayload: unknown

      for (const fieldName of MIOBT_TORRENT_FIELD_NAMES) {
        const formData = new FormData()
        formData.append('sort_id', `${draft.typeId}`)
        formData.append('title', draft.title)
        formData.append('intro', draft.description)
        formData.append('discuss_url', draft.discussUrl ?? '')
        formData.append('user_id', userId)
        formData.append('api_key', apiKey)
        formData.append(
          fieldName,
          new Blob([fs.readFileSync(draft.torrentPath)], { type: 'application/x-bittorrent' }),
          basename(draft.torrentPath),
        )

        const response = await client.post(endpoint, formData, { responseType: 'text' })
        fallbackPayload = response.data
        const data = parseMiobtApiResponse(response.data)

        if (!data) {
          continue
        }

        const remoteId = data.infoHash
        const remoteUrl = data.infoHash ? buildMiobtRemoteUrl(siteBaseUrl, data.infoHash) : undefined
        const raw = {
          fieldName,
          response: data,
          responseText: response.data,
          remoteUrl,
        }

        if (data.status === 'success' && data.infoHash) {
          return {
            result: {
              siteId: profile.id,
              status: 'published',
              remoteId,
              remoteUrl,
              message: remoteUrl ? `Published through MioBT adapter: ${remoteUrl}` : 'Published through MioBT adapter',
              rawResponse: raw,
              timestamp: new Date().toISOString(),
            },
            raw,
          }
        }

        if (data.code === 103 && data.infoHash) {
          return {
            result: {
              siteId: profile.id,
              status: 'published',
              remoteId,
              remoteUrl,
              message: 'MioBT reports that the torrent already exists',
              rawResponse: raw,
              timestamp: new Date().toISOString(),
            },
            raw,
          }
        }

        if (data.code === 114 || data.message === 'auth failed') {
          throw new Error(data.message || 'MioBT API credentials were rejected')
        }

        if (data.code === 116) {
          throw new Error(data.message || 'MioBT API quota exceeded, please try later')
        }

        throw new Error(data.message || `MioBT publish failed with code ${data.code ?? response.status}`)
      }

      throw new Error(readResponseMessage(fallbackPayload) || 'MioBT publish did not return a recognized API response')
    },
  }
}
