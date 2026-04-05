import axios from 'axios'
import fs from 'fs'
import { basename } from 'path'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type {
  BangumiMetadataCategoryOption,
  BangumiPublishIdentityOption,
  BangumiSiteMetadataRaw,
  SiteCatalogEntry,
  SiteFieldSchemaEntry,
  SiteMetadataRecord,
  SiteProfile,
  SiteValidationIssue,
} from '../../../shared/types/site'
import type { SiteAdapter } from '../adapter'

const BANGUMI_CATEGORY_OPTIONS: BangumiMetadataCategoryOption[] = [
  { id: '54967e14ff43b99e284d0bf7', name: '合集' },
  { id: '549cc9369310bc7d04cddf9f', name: '剧场版' },
  { id: '549ef207fe682f7549f1ea90', name: '动画' },
  { id: '549ef250fe682f7549f1ea91', name: '其他' },
]

const BANGUMI_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'category_bangumi',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.bangumiCategory',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.bangumiHelp',
    control: 'select',
    mode: 'required',
    options: BANGUMI_CATEGORY_OPTIONS.map(option => ({
      label: option.name,
      value: option.id,
    })),
  },
  {
    key: 'btSyncKey',
    labelKey: 'sites.form.btSyncKey',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.bangumiBtSyncKeyHelp',
    control: 'text',
    mode: 'optional',
  },
  {
    key: 'teamSync',
    labelKey: 'sites.flags.teamSync',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.bangumiTeamSyncHelp',
    control: 'checkbox',
    mode: 'optional',
  },
]

interface BangumiResolvedAuth {
  siteBaseUrl: string
  headers: Record<string, string>
}

interface BangumiPublishDraft {
  title: string
  description: string
  torrentPath: string
  categoryBangumi: string
  bangumiTagIds: string[]
  publishIdentity: string
  btSyncKey?: string
  teamSync: boolean
}

interface BangumiCategoryApiRecord {
  _id?: string
  name?: string
}

interface BangumiTeamApiRecord {
  _id?: string
  name?: string
}

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function normalizeBangumiBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Bangumi base URL is required')
  }

  const url = new URL(trimmed)
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function joinBangumiUrl(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString()
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asBoolean(value: unknown) {
  return value === true
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  ]
}

function buildCookieHeader(credentials?: SiteCredentialRecord) {
  const cookiePairs = credentials?.cookies
    ?.filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)

  return cookiePairs && cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function resolveBangumiAuth(profile: SiteProfile, credentials?: SiteCredentialRecord): BangumiResolvedAuth {
  const siteBaseUrl = normalizeBangumiBaseUrl(profile.baseUrl)
  const cookieHeader = buildCookieHeader(credentials)
  if (!cookieHeader) {
    throw new Error('Bangumi requires saved cookies from browser login or cookie import. Please log in first.')
  }

  return {
    siteBaseUrl,
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: cookieHeader,
    },
  }
}

function createBangumiHttpClient() {
  return axios.create({
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    maxRedirects: 0,
    validateStatus: () => true,
  })
}

function hasBangumiLoginMarkers(html: string) {
  return html.includes('showPublishDialog(') || html.includes('signout()') || html.includes('fa-sign-out')
}

function normalizeBangumiCategories(data: unknown) {
  if (!Array.isArray(data)) {
    return [...BANGUMI_CATEGORY_OPTIONS]
  }

  const categories = data.reduce<BangumiMetadataCategoryOption[]>((items, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return items
    }

    const category = raw as BangumiCategoryApiRecord
    const id = asString(category._id)
    const name = asString(category.name)
    if (!id || !name || items.some(item => item.id === id)) {
      return items
    }

    items.push({ id, name })
    return items
  }, [])

  return categories.length > 0 ? categories : [...BANGUMI_CATEGORY_OPTIONS]
}

function normalizeBangumiIdentities(data: unknown) {
  const identities: BangumiPublishIdentityOption[] = [
    {
      id: 'personal',
      name: '个人发布',
      type: 'personal',
    },
  ]

  if (!Array.isArray(data)) {
    return identities
  }

  data.forEach(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return
    }

    const team = raw as BangumiTeamApiRecord
    const id = asString(team._id)
    const name = asString(team.name)
    if (!id || !name || identities.some(item => item.id === id)) {
      return
    }

    identities.push({
      id,
      name,
      type: 'team',
    })
  })

  return identities
}

function describeBangumiSite(profile: SiteProfile): SiteCatalogEntry {
  let normalizedBaseUrl = profile.baseUrl.trim()
  let apiBaseUrl: string | undefined
  const notes: string[] = []

  try {
    normalizedBaseUrl = normalizeBangumiBaseUrl(profile.baseUrl)
    apiBaseUrl = joinBangumiUrl(normalizedBaseUrl, 'api')
    notes.push('Publishes through the live BangumiMoe web API with the saved browser-cookie session.')
    notes.push('Use the BT account popup login first, then choose personal or team publishing in the adapter form.')
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
    apiBaseUrl,
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes,
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneSiteFieldSchemas(BANGUMI_FIELD_SCHEMAS),
  }
}

function validateBangumiPublishDraft(profile: SiteProfile, payload: Record<string, unknown>) {
  const issues: SiteValidationIssue[] = []
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryBangumi =
    asString(payload.categoryBangumi) ?? asString(payload.category_bangumi) ?? asString(payload.categoryCode)
  const publishIdentity = asString(payload.publishIdentity)
  const teamSync = asBoolean(payload.teamSync)

  if (!title) {
    issues.push({
      field: 'title',
      message: `A title is required before publishing to ${profile.name}`,
      severity: 'error',
    })
  } else if (title.length >= 128) {
    issues.push({
      field: 'title',
      message: 'Bangumi titles must be shorter than 128 characters',
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

  if (!categoryBangumi) {
    issues.push({
      field: 'categoryBangumi',
      message: 'A Bangumi category is required',
      severity: 'error',
    })
  }

  if (!publishIdentity) {
    issues.push({
      field: 'publishIdentity',
      message: 'Please choose personal or team publishing',
      severity: 'error',
    })
  }

  if (teamSync && publishIdentity === 'personal') {
    issues.push({
      field: 'teamSync',
      message: 'Team sync only applies when publishing as a team',
      severity: 'warning',
    })
  }

  return issues
}

function parseBangumiPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): BangumiPublishDraft {
  const issues = validateBangumiPublishDraft(profile, payload)
  const blockingIssues = issues.filter(issue => issue.severity === 'error')
  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map(issue => issue.message).join(' | '))
  }

  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryBangumi =
    asString(payload.categoryBangumi) ?? asString(payload.category_bangumi) ?? asString(payload.categoryCode)
  const publishIdentity = asString(payload.publishIdentity)

  if (!title || !description || !torrentPath || !categoryBangumi || !publishIdentity) {
    throw new Error('Bangumi publish validation did not produce the required fields')
  }

  return {
    title,
    description,
    torrentPath,
    categoryBangumi,
    bangumiTagIds: asStringArray(payload.bangumiTagIds),
    publishIdentity,
    btSyncKey: asString(payload.btSyncKey) ?? asString(payload.syncKey),
    teamSync: asBoolean(payload.teamSync) && publishIdentity !== 'personal',
  }
}

function extractRemoteIdFromMessage(message?: string) {
  return message?.match(/torrent same as\s+([a-z0-9]+)/i)?.[1]
}

export function createBangumiAdapter(): SiteAdapter {
  return {
    id: 'bangumi',
    displayName: 'Bangumi',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'cookie_auth',
      'browser_login',
      'metadata_sections',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'bangumi'
    },
    describe(profile) {
      return describeBangumiSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const siteBaseUrl = normalizeBangumiBaseUrl(profile.baseUrl)
        const cookieHeader = buildCookieHeader(credentials)
        if (!cookieHeader) {
          return {
            status: 'unauthenticated',
            message: 'Bangumi cookies are missing. Open the popup browser login window first.',
          }
        }

        const client = createBangumiHttpClient()
        const response = await client.get(siteBaseUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Cookie: cookieHeader,
          },
          responseType: 'text',
        })

        if (response.status >= 200 && response.status < 300 && typeof response.data === 'string') {
          return hasBangumiLoginMarkers(response.data)
            ? {
                status: 'authenticated',
                message: `Validated Bangumi session at ${siteBaseUrl}`,
                raw: response.data,
              }
            : {
                status: 'unauthenticated',
                message: 'Bangumi cookies are missing or have expired',
                raw: response.data,
              }
        }

        if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
          return {
            status: 'unauthenticated',
            message: 'Bangumi cookies are missing or have expired',
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: `Bangumi account check returned HTTP ${response.status}`,
          raw: response.data,
        }
      } catch (error) {
        return {
          status: 'unauthenticated',
          message: (error as Error).message,
        }
      }
    },
    async validatePublish({ profile, payload }) {
      return validateBangumiPublishDraft(profile, payload)
    },
    async loadMetadata({ profile, credentials }) {
      const siteBaseUrl = normalizeBangumiBaseUrl(profile.baseUrl)
      const client = createBangumiHttpClient()
      const categoriesResponse = await client.get(joinBangumiUrl(siteBaseUrl, 'api/tag/misc'), {
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
        responseType: 'json',
      })

      if (categoriesResponse.status < 200 || categoriesResponse.status >= 300) {
        throw new Error(`Bangumi category metadata request returned HTTP ${categoriesResponse.status}`)
      }

      const raw: BangumiSiteMetadataRaw = {
        categories: normalizeBangumiCategories(categoriesResponse.data),
        identities: [
          {
            id: 'personal',
            name: '个人发布',
            type: 'personal',
          },
        ],
      }

      const cookieHeader = buildCookieHeader(credentials)
      if (cookieHeader) {
        const teamResponse = await client.get(joinBangumiUrl(siteBaseUrl, 'api/team/myteam'), {
          headers: {
            Accept: 'application/json, text/plain, */*',
            Cookie: cookieHeader,
          },
          responseType: 'json',
        })

        if (teamResponse.status >= 200 && teamResponse.status < 300) {
          raw.identities = normalizeBangumiIdentities(teamResponse.data)
        } else {
          raw.teamError = `Bangumi team list returned HTTP ${teamResponse.status}`
        }
      }

      return {
        siteId: profile.id,
        apiBaseUrl: joinBangumiUrl(siteBaseUrl, 'api'),
        sections: [],
        raw,
      } satisfies SiteMetadataRecord
    },
    async publish({ profile, payload, credentials }) {
      const draft = parseBangumiPublishDraft(profile, payload)
      const { siteBaseUrl, headers } = resolveBangumiAuth(profile, credentials)
      const client = createBangumiHttpClient()

      const formData = new FormData()
      formData.append('category_tag_id', draft.categoryBangumi)
      formData.append('title', draft.title)
      formData.append('introduction', draft.description)
      formData.append('tag_ids', draft.bangumiTagIds.join(','))
      formData.append('btskey', draft.btSyncKey ?? '')
      if (draft.publishIdentity !== 'personal') {
        formData.append('team_id', draft.publishIdentity)
        if (draft.teamSync) {
          formData.append('teamsync', '1')
        }
      }
      formData.append(
        'file',
        new Blob([fs.readFileSync(draft.torrentPath)], {
          type: 'application/x-bittorrent',
        }),
        basename(draft.torrentPath),
      )

      const response = await client.post(joinBangumiUrl(siteBaseUrl, 'api/torrent/add'), formData, {
        headers: {
          ...headers,
          Origin: siteBaseUrl,
          Referer: `${siteBaseUrl}/`,
        },
        responseType: 'json',
      })

      if (response.status === 401 || response.status === 403) {
        throw new Error('Bangumi session expired during publish. Please log in again.')
      }

      const payloadData =
        response.data && typeof response.data === 'object' && !Array.isArray(response.data)
          ? (response.data as Record<string, unknown>)
          : undefined
      const success = payloadData?.success === true
      const torrentRecord =
        payloadData?.torrent && typeof payloadData.torrent === 'object' && !Array.isArray(payloadData.torrent)
          ? (payloadData.torrent as Record<string, unknown>)
          : undefined
      const message = asString(payloadData?.message)
      const remoteId = asString(torrentRecord?._id) ?? extractRemoteIdFromMessage(message)
      const remoteUrl = remoteId ? joinBangumiUrl(siteBaseUrl, `torrent/${remoteId}`) : undefined

      if (response.status >= 200 && response.status < 300 && success) {
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId,
            remoteUrl,
            message: remoteUrl ? `Published through the Bangumi adapter (${remoteUrl})` : 'Published through the Bangumi adapter',
            rawResponse: response.data,
            timestamp: new Date().toISOString(),
          },
          raw: response.data,
        }
      }

      if (remoteId && message?.includes('torrent same as')) {
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId,
            remoteUrl,
            message: 'Bangumi reports that this torrent already exists',
            rawResponse: response.data,
            timestamp: new Date().toISOString(),
          },
          raw: response.data,
        }
      }

      throw new Error(message ?? `Bangumi publish failed with HTTP ${response.status}`)
    },
  }
}
