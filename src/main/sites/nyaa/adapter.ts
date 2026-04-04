import axios from 'axios'
import fs from 'fs'
import { basename } from 'path'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import { unescapeHtml } from '../../core/utils'
import type { SiteAdapter } from '../adapter'

const NYAA_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'categoryCode',
    labelKey: 'sites.form.category',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.nyaaHelp',
    control: 'select',
    mode: 'required',
    options: [
      { label: 'Anime - Anime Music Video', value: '1_1' },
      { label: 'Anime - English-translated', value: '1_2' },
      { label: 'Anime - Non-English-translated', value: '1_3' },
      { label: 'Anime - Raw', value: '1_4' },
      { label: 'Audio - Lossless', value: '2_1' },
      { label: 'Audio - Lossy', value: '2_2' },
      { label: 'Literature - English-translated', value: '3_1' },
      { label: 'Literature - Non-English-translated', value: '3_2' },
      { label: 'Literature - Raw', value: '3_3' },
      { label: 'Live Action - English-translated', value: '4_1' },
      { label: 'Live Action - Idol/Promotional Video', value: '4_2' },
      { label: 'Live Action - Non-English-translated', value: '4_3' },
      { label: 'Live Action - Raw', value: '4_4' },
      { label: 'Pictures - Graphics', value: '5_1' },
      { label: 'Pictures - Photos', value: '5_2' },
      { label: 'Software - Applications', value: '6_1' },
      { label: 'Software - Games', value: '6_2' },
    ],
  },
]

interface NyaaResolvedAuth {
  siteBaseUrl: string
  headers: Record<string, string>
}

interface NyaaPublishDraft {
  title: string
  description: string
  torrentPath: string
  categoryCode: string
  information?: string
  anonymous: boolean
  complete: boolean
  remake: boolean
}

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function normalizeNyaaBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Nyaa base URL is required')
  }

  const url = new URL(trimmed)
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function joinNyaaUrl(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString()
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asBoolean(value: unknown) {
  return value === true
}

function buildCookieHeader(credentials?: SiteCredentialRecord) {
  const cookiePairs = credentials?.cookies
    ?.filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)

  return cookiePairs && cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function resolveNyaaAuth(profile: SiteProfile, credentials?: SiteCredentialRecord): NyaaResolvedAuth {
  const siteBaseUrl = normalizeNyaaBaseUrl(profile.baseUrl)
  const cookieHeader = buildCookieHeader(credentials)
  if (!cookieHeader) {
    throw new Error('Nyaa requires saved cookies from browser login or cookie import. Please log in first.')
  }

  return {
    siteBaseUrl,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookieHeader,
    },
  }
}

function createNyaaHttpClient() {
  return axios.create({
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
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

function extractAlertMessage(html: string) {
  const matches = [...html.matchAll(/<div[^>]*class="[^"]*alert-(?:danger|warning)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)]
  for (const match of matches) {
    const message = decodeHtml(match[1] ?? '')
    if (message) {
      return message
    }
  }

  return undefined
}

function parseRemoteUrl(siteBaseUrl: string, location?: string, html?: string) {
  const candidate =
    location?.trim() ||
    html?.match(/href="([^"]*\/view\/\d+[^"]*)"/i)?.[1] ||
    html?.match(/target URL:\s*<a href="([^"]+)"/i)?.[1]

  if (!candidate) {
    return undefined
  }

  try {
    return new URL(candidate, `${siteBaseUrl}/`).toString()
  } catch {
    return undefined
  }
}

function parseRemoteId(value?: string) {
  return value?.match(/\/view\/(\d+)(?:$|[?#])/i)?.[1]
}

function parseDuplicateRemoteUrl(siteBaseUrl: string, html: string) {
  const duplicateId = html.match(/This torrent already exists\s*\(#(\d+)\)/i)?.[1]
  return duplicateId ? joinNyaaUrl(siteBaseUrl, `/view/${duplicateId}`) : undefined
}

function describeNyaaSite(profile: SiteProfile): SiteCatalogEntry {
  let normalizedBaseUrl = profile.baseUrl.trim()
  let apiBaseUrl: string | undefined
  const notes: string[] = []

  try {
    normalizedBaseUrl = normalizeNyaaBaseUrl(profile.baseUrl)
    apiBaseUrl = joinNyaaUrl(normalizedBaseUrl, 'upload')
    notes.push('Publishes through the live Nyaa upload form with a saved browser-cookie session.')
    notes.push('Use the browser login window on the account page or import cookies from JSON before publishing.')
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
    fieldSchemas: cloneSiteFieldSchemas(NYAA_FIELD_SCHEMAS),
  }
}

function validateNyaaPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryCode = asString(payload.categoryCode)

  if (!title) {
    issues.push({
      field: 'title',
      message: `A title is required before publishing to ${profile.name}`,
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

  if (!categoryCode) {
    issues.push({
      field: 'categoryCode',
      message: 'A Nyaa category is required',
      severity: 'error',
    })
  }

  return issues
}

function parseNyaaPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): NyaaPublishDraft {
  const issues = validateNyaaPublishDraft(profile, payload)
  const blockingIssues = issues.filter(issue => issue.severity === 'error')
  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map(issue => issue.message).join(' | '))
  }

  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryCode = asString(payload.categoryCode)
  if (!title || !description || !torrentPath || !categoryCode) {
    throw new Error('Nyaa publish validation did not produce the required fields')
  }

  return {
    title,
    description,
    torrentPath,
    categoryCode,
    information: asString(payload.information) ?? asString(payload.url),
    anonymous: asBoolean(payload.anonymous),
    complete: asBoolean(payload.complete),
    remake: asBoolean(payload.remake),
  }
}

export function createNyaaAdapter(): SiteAdapter {
  return {
    id: 'nyaa',
    displayName: 'Nyaa',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'cookie_auth',
      'browser_login',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'nyaa'
    },
    describe(profile) {
      return describeNyaaSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const { siteBaseUrl, headers } = resolveNyaaAuth(profile, credentials)
        const client = createNyaaHttpClient()
        const response = await client.get(joinNyaaUrl(siteBaseUrl, 'profile'), { headers })

        if (response.status >= 200 && response.status < 300) {
          return {
            status: 'authenticated',
            message: `Validated Nyaa session at ${siteBaseUrl}`,
            raw: response.data,
          }
        }

        if (isRedirectStatus(response.status) || response.status === 401 || response.status === 403) {
          return {
            status: 'unauthenticated',
            message: 'Nyaa session is missing or expired',
            raw: response.data,
          }
        }

        return {
          status: 'error',
          message: `Nyaa validation failed with HTTP ${response.status}`,
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
      return validateNyaaPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const draft = parseNyaaPublishDraft(profile, payload)
      const { siteBaseUrl, headers } = resolveNyaaAuth(profile, credentials)
      const client = createNyaaHttpClient()
      const torrentPart = new Blob([fs.readFileSync(draft.torrentPath)], {
        type: 'application/x-bittorrent',
      })

      const formData = new FormData()
      formData.append('torrent_file', torrentPart, basename(draft.torrentPath))
      formData.append('display_name', draft.title)
      formData.append('category', draft.categoryCode)
      formData.append('information', draft.information ?? '')
      formData.append('description', draft.description)
      if (draft.anonymous) {
        formData.append('is_anonymous', 'y')
      }
      if (draft.complete) {
        formData.append('is_complete', 'y')
      }
      if (draft.remake) {
        formData.append('is_remake', 'y')
      }

      const response = await client.post(joinNyaaUrl(siteBaseUrl, 'upload'), formData, {
        headers: {
          ...headers,
          Origin: siteBaseUrl,
          Referer: joinNyaaUrl(siteBaseUrl, 'upload'),
        },
      })
      const responseText = readResponseText(response.data)

      if (isRedirectStatus(response.status)) {
        const remoteUrl = parseRemoteUrl(siteBaseUrl, response.headers.location, responseText)
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: parseRemoteId(remoteUrl),
            remoteUrl,
            message: remoteUrl ? `Published through Nyaa adapter: ${remoteUrl}` : 'Published through Nyaa adapter',
            rawResponse: {
              location: response.headers.location,
              responseText,
            },
            timestamp: new Date().toISOString(),
          },
          raw: {
            location: response.headers.location,
            responseText,
          },
        }
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error('Nyaa session expired during publish. Please log in again.')
      }

      const duplicateRemoteUrl = parseDuplicateRemoteUrl(siteBaseUrl, responseText)
      if (duplicateRemoteUrl) {
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: parseRemoteId(duplicateRemoteUrl),
            remoteUrl: duplicateRemoteUrl,
            message: 'Nyaa reports that the torrent already exists',
            rawResponse: responseText,
            timestamp: new Date().toISOString(),
          },
          raw: responseText,
        }
      }

      const alertMessage = extractAlertMessage(responseText)
      if (alertMessage) {
        throw new Error(alertMessage)
      }

      throw new Error(`Nyaa publish failed with HTTP ${response.status}`)
    },
  }
}
