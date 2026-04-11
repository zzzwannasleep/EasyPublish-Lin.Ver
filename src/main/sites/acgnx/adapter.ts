import fs from 'fs'
import { basename } from 'path'
import axios from 'axios'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import type { SitePublishDraft } from '../../../shared/types/publish'
import type { SiteAdapter } from '../adapter'

const ACGNX_CAPABILITIES = ['torrent_publish', 'token_auth', 'content_preview', 'raw_response'] as const

const ACGNX_SORT_OPTIONS = [
  { label: '动画 (1)', value: '1' },
  { label: '季度全集 (2)', value: '2' },
  { label: '漫画 (3)', value: '3' },
  { label: '港版原版 (4)', value: '4' },
  { label: '日文原版 (5)', value: '5' },
  { label: '音乐 (6)', value: '6' },
  { label: '动漫音乐 (7)', value: '7' },
  { label: '同人音乐 (8)', value: '8' },
  { label: '流行音乐 (9)', value: '9' },
  { label: '日剧 (10)', value: '10' },
  { label: 'RAW (11)', value: '11' },
  { label: '游戏 (12)', value: '12' },
  { label: '电脑游戏 (13)', value: '13' },
  { label: '电视游戏 (14)', value: '14' },
  { label: '掌机游戏 (15)', value: '15' },
  { label: '网络游戏 (16)', value: '16' },
  { label: '游戏周边 (17)', value: '17' },
  { label: '特摄 (18)', value: '18' },
  { label: '其他 (19)', value: '19' },
] as const

const ACGNX_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'typeId',
    labelKey: 'sites.form.category',
    helpKey: 'nexus.site.acgnxManualHint',
    control: 'select',
    mode: 'optional',
    options: ACGNX_SORT_OPTIONS.map(option => ({
      label: option.label,
      value: option.value,
    })),
  },
]

interface AcgnxApiResponse {
  status?: string
  code?: number | string
  value?: string
  infohash?: string
  title?: string
}

function normalizeBaseUrl(input: string) {
  return input.trim().replace(/\/+$/, '')
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = toNumber(value)
  return parsed && parsed > 0 ? parsed : undefined
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function parseAcgnxResponse(payload: unknown): AcgnxApiResponse | undefined {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as AcgnxApiResponse
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as AcgnxApiResponse
    } catch {
      return undefined
    }
  }

  return undefined
}

function cloneFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[]) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function describeAcgnxSite(profile: SiteProfile): SiteCatalogEntry {
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const uploadEndpoint = `${baseUrl}/user.php?o=api&op=upload`

  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl: baseUrl,
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet([...ACGNX_CAPABILITIES]),
    notes: [
      `Public Upload API endpoint: ${uploadEndpoint}`,
      'Uses API UID + token instead of NexusPHP /api/v1 metadata and upload endpoints.',
      'If category is not filled manually, the adapter falls back to the legacy Bangumi / Nyaa category mapping.',
    ],
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneFieldSchemas(ACGNX_FIELD_SCHEMAS),
  }
}

function resolveDefaultSortId(siteId: string, payload: Record<string, unknown>) {
  const categoryBangumi = toStringValue(payload.categoryBangumi)
  const categoryCode = toStringValue(payload.categoryCode)

  if (siteId === 'acgnx_a') {
    if (categoryBangumi === '54967e14ff43b99e284d0bf7') {
      return 2
    }

    if (categoryBangumi === '549ef207fe682f7549f1ea90') {
      return 1
    }

    return 19
  }

  if (categoryCode === '1_2') {
    return 2
  }

  if (categoryCode === '1_3') {
    return 4
  }

  if (categoryCode === '1_4') {
    return 3
  }

  if (categoryCode === '4_1') {
    return 14
  }

  if (categoryCode === '4_2') {
    return 16
  }

  return 15
}

function resolveSortId(profile: SiteProfile, payload: Record<string, unknown>) {
  return toPositiveNumber(payload.typeId) ?? resolveDefaultSortId(profile.id, payload)
}

function parseDraft(profile: SiteProfile, payload: Record<string, unknown>): SitePublishDraft {
  const issues = validateAcgnxPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const title = toStringValue(payload.title)
  const description = typeof payload.description === 'string' ? payload.description : ''
  const torrentPath = toStringValue(payload.torrentPath)
  const typeId = resolveSortId(profile, payload)

  if (!title || !torrentPath || !typeId) {
    throw new Error('AcgnX publish draft is incomplete')
  }

  return {
    siteId: profile.id,
    typeId,
    categoryBangumi: toStringValue(payload.categoryBangumi),
    categoryCode: toStringValue(payload.categoryCode),
    title,
    description,
    torrentPath,
    anonymous: payload.anonymous === true,
    url: toStringValue(payload.url),
    emuleResource: toStringValue(payload.emuleResource),
    btSyncKey: toStringValue(payload.btSyncKey),
    subCategories: {},
  }
}

function validateAcgnxPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const sortId = resolveSortId(profile, payload)
  const title = toStringValue(payload.title)
  const torrentPath = toStringValue(payload.torrentPath)

  if (!sortId) {
    issues.push({
      field: 'typeId',
      message: `${profile.name} requires a sort_id, or a source category that can be mapped automatically`,
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

function buildRemoteUrl(baseUrl: string, infohash?: string) {
  return infohash ? `${normalizeBaseUrl(baseUrl)}/show-${infohash}.html` : undefined
}

export function createAcgnxAdapter(): SiteAdapter {
  return {
    id: 'acgnx',
    displayName: 'AcgnX Public Upload API',
    capabilitySet: buildSiteCapabilitySet([...ACGNX_CAPABILITIES]),
    supports(profile) {
      return profile.adapter === 'acgnx'
    },
    describe(profile) {
      return describeAcgnxSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      if (!credentials?.apiUid?.trim() || !credentials.apiToken?.trim()) {
        return {
          status: 'unauthenticated',
          message: `${profile.name} requires both API UID and API token`,
        }
      }

      return {
        status: 'authenticated',
        message: `Configured Public Upload API credentials for ${profile.name}`,
      }
    },
    async validatePublish({ profile, payload }) {
      return validateAcgnxPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const apiUid = credentials?.apiUid?.trim()
      const apiToken = credentials?.apiToken?.trim()
      if (!apiUid || !apiToken) {
        throw new Error(`${profile.name} requires both API UID and API token`)
      }

      const draft = parseDraft(profile, payload)
      const torrent = fs.readFileSync(draft.torrentPath)
      const formData = new FormData()
      formData.append('mod', 'upload')
      formData.append('sort_id', `${draft.typeId}`)
      formData.append('bt_file', new Blob([torrent], { type: 'application/x-bittorrent' }), basename(draft.torrentPath))
      formData.append('title', draft.title)
      formData.append('intro', draft.description)
      formData.append('Anonymous_Post', draft.anonymous ? '1' : '0')
      formData.append('Team_Post', draft.anonymous ? '0' : '1')
      formData.append('uid', apiUid)
      formData.append('api_token', apiToken)

      if (draft.emuleResource) {
        formData.append('emule_resource', draft.emuleResource)
      }

      if (draft.btSyncKey) {
        formData.append('synckey', draft.btSyncKey)
      }

      if (draft.url) {
        formData.append('discuss_url', draft.url)
      }

      const response = await axios.post(`${normalizeBaseUrl(profile.baseUrl)}/user.php?o=api&op=upload`, formData, {
        responseType: 'text',
        validateStatus: () => true,
      })

      const parsed = parseAcgnxResponse(response.data)
      const responseCode = toNumber(parsed?.code)
      const infohash = toStringValue(parsed?.infohash)
      const remoteUrl = buildRemoteUrl(profile.baseUrl, infohash)

      if (response.status >= 200 && response.status < 300 && responseCode === 200) {
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: infohash,
            remoteUrl,
            message: `Published through ${profile.name} Public Upload API`,
            rawResponse: parsed ?? response.data,
            timestamp: new Date().toISOString(),
          },
          raw: parsed ?? response.data,
        }
      }

      if (response.status >= 200 && response.status < 300 && responseCode === 302) {
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: infohash,
            remoteUrl,
            message: `${profile.name} reported that the torrent already exists`,
            rawResponse: parsed ?? response.data,
            timestamp: new Date().toISOString(),
          },
          raw: parsed ?? response.data,
        }
      }

      if (responseCode === 105) {
        throw new Error(`${profile.name} API UID or token is invalid`)
      }

      if (parsed) {
        const detail = [toStringValue(parsed.value), toStringValue(parsed.title)].filter(Boolean).join(' | ')
        throw new Error(
          `${profile.name} Public Upload API rejected the request with code ${parsed.code ?? response.status}${detail ? `: ${detail}` : ''}`,
        )
      }

      throw new Error(`${profile.name} upload failed with HTTP ${response.status}`)
    },
  }
}
