import axios from 'axios'
import fs from 'fs'
import { basename } from 'path'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import type { SitePublishDraft } from '../../../shared/types/publish'
import { sleep, unescapeHtml } from '../../core/utils'
import type { SiteAdapter } from '../adapter'

const ACGRIP_DUPLICATE_TORRENT = '已存在相同的种子'
const ACGRIP_SIGN_IN_PATH = '/users/sign_in'
const ACGRIP_CONTROL_PANEL_PATH = '/cp'
const ACGRIP_UPLOAD_PATH = '/cp/posts/upload'
const ACGRIP_PUBLISH_PATH = '/cp/posts'
const ACGRIP_TEAM_POSTS_PATH = '/cp/team_posts'

const ACGRIP_CATEGORY_OPTIONS = [
  { value: '1', label: '动画' },
  { value: '2', label: '日剧' },
  { value: '3', label: '综艺' },
  { value: '4', label: '音乐' },
  { value: '5', label: '合集' },
  { value: '9', label: '其它' },
]

const ACGRIP_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'typeId',
    labelKey: 'sites.form.category',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.acgripCategoryHelp',
    control: 'select',
    mode: 'required',
    options: ACGRIP_CATEGORY_OPTIONS,
  },
]

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return 'https://acg.rip'
  }

  try {
    const url = new URL(trimmed)
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

function cloneFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function buildCookieHeader(credentials?: SiteCredentialRecord) {
  const cookiePairs = credentials?.cookies
    ?.filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)

  return cookiePairs && cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function parseCookieHeader(cookieHeader?: string) {
  const result = new Map<string, string>()
  if (!cookieHeader) {
    return result
  }

  cookieHeader
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(item => {
      const index = item.indexOf('=')
      if (index <= 0) {
        return
      }

      result.set(item.slice(0, index).trim(), item.slice(index + 1).trim())
    })

  return result
}

function readSetCookieValues(headerValue: unknown) {
  if (Array.isArray(headerValue)) {
    return headerValue.filter((item): item is string => typeof item === 'string')
  }

  return typeof headerValue === 'string' ? [headerValue] : []
}

function mergeCookieHeader(cookieHeader: string | undefined, headerValue: unknown) {
  const cookies = parseCookieHeader(cookieHeader)
  readSetCookieValues(headerValue).forEach(item => {
    const cookie = item.split(';', 1)[0]?.trim()
    if (!cookie) {
      return
    }

    const index = cookie.indexOf('=')
    if (index <= 0) {
      return
    }

    cookies.set(cookie.slice(0, index).trim(), cookie.slice(index + 1).trim())
  })

  const entries = [...cookies.entries()].map(([name, value]) => `${name}=${value}`)
  return entries.length > 0 ? entries.join('; ') : undefined
}

function buildRequestHeaders(cookieHeader?: string) {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
}

function isSignInResponse(status: number, data: unknown, location?: string) {
  if (status === 302 && location?.includes(ACGRIP_SIGN_IN_PATH)) {
    return true
  }

  const body = typeof data === 'string' ? data : ''
  return body.includes('action="/users/sign_in"') || body.includes('name="user[email]"')
}

function extractAuthenticityToken(html: string) {
  return (
    html.match(/name="authenticity_token"\svalue="([^"]+)"/)?.[1] ??
    html.match(/name="csrf-token"\scontent="([^"]+)"/)?.[1]
  )
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function normalizeComparableText(value: string) {
  return unescapeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findRemoteUrlByTitle(baseUrl: string, html: string, title: string) {
  const normalizedTitle = normalizeComparableText(title)
  const matcher = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g

  for (const match of html.matchAll(matcher)) {
    const href = match[1]?.trim()
    const label = match[2] ? normalizeComparableText(match[2]) : ''
    if (!href || !label || label !== normalizedTitle || !href.startsWith('/t/')) {
      continue
    }

    const remoteUrl = new URL(href, baseUrl).toString()
    const remoteId = remoteUrl.match(/\/t\/(\d+)/)?.[1]
    return {
      remoteId,
      remoteUrl,
    }
  }

  return undefined
}

function describeAcgripSite(profile: SiteProfile): SiteCatalogEntry {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl)
  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl,
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes: [
      'Publishes through the live AcgRip web upload form with saved browser cookies.',
      'Use the BT account page to sign in through the popup browser window or import cookies from JSON.',
    ],
    customFieldMap: profile.customFieldMap,
    fieldSchemas: cloneFieldSchemas(ACGRIP_FIELD_SCHEMAS),
  }
}

function validateAcgripPublishDraft(profile: SiteProfile, payload: Record<string, unknown>) {
  const issues: SiteValidationIssue[] = []
  const typeId = asNumber(payload.typeId)
  const title = asOptionalString(payload.title)
  const description = asOptionalString(payload.description)
  const torrentPath = asOptionalString(payload.torrentPath)

  if (!typeId) {
    issues.push({
      field: 'typeId',
      message: `A category is required before publishing to ${profile.name}`,
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

  return issues
}

function parsePublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SitePublishDraft {
  const issues = validateAcgripPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  return {
    siteId: profile.id,
    typeId: asNumber(payload.typeId)!,
    title: asOptionalString(payload.title)!,
    description: asOptionalString(payload.description)!,
    torrentPath: asOptionalString(payload.torrentPath)!,
    subCategories: {},
  }
}

function requireCookieHeader(profile: SiteProfile, credentials?: SiteCredentialRecord) {
  const cookieHeader = buildCookieHeader(credentials)
  if (!cookieHeader) {
    throw new Error(
      `${profile.name} requires saved cookies from browser login or cookie import. Open the popup login window first.`,
    )
  }

  return cookieHeader
}

async function lookupPublishedTorrent(
  baseUrl: string,
  cookieHeader: string | undefined,
  title: string,
): Promise<{
  cookieHeader?: string
  remoteId?: string
  remoteUrl?: string
}> {
  const client = axios.create({
    maxRedirects: 0,
    validateStatus: () => true,
  })

  let nextCookieHeader = cookieHeader
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await client.get(`${baseUrl}${ACGRIP_TEAM_POSTS_PATH}`, {
      headers: buildRequestHeaders(nextCookieHeader),
      responseType: 'text',
    })
    nextCookieHeader = mergeCookieHeader(nextCookieHeader, response.headers['set-cookie'])

    if (response.status >= 200 && response.status < 400 && typeof response.data === 'string') {
      const remote = findRemoteUrlByTitle(baseUrl, response.data, title)
      if (remote) {
        return {
          ...remote,
          cookieHeader: nextCookieHeader,
        }
      }
    }

    if (attempt < 4) {
      await sleep(1000)
    }
  }

  return {
    cookieHeader: nextCookieHeader,
  }
}

export function createAcgripAdapter(): SiteAdapter {
  return {
    id: 'acgrip',
    displayName: 'AcgRip',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'cookie_auth',
      'browser_login',
      'content_preview',
      'raw_response',
    ]),
    supports(profile) {
      return profile.adapter === 'acgrip'
    },
    describe(profile) {
      return describeAcgripSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const cookieHeader = requireCookieHeader(profile, credentials)
        const baseUrl = normalizeBaseUrl(profile.baseUrl)
        const response = await axios.get(`${baseUrl}${ACGRIP_CONTROL_PANEL_PATH}`, {
          headers: buildRequestHeaders(cookieHeader),
          maxRedirects: 0,
          validateStatus: () => true,
          responseType: 'text',
        })

        if (isSignInResponse(response.status, response.data, response.headers.location as string | undefined)) {
          return {
            status: 'unauthenticated',
            message: 'AcgRip cookies are missing or have expired. Log in again through the popup browser window.',
          }
        }

        if (response.status >= 200 && response.status < 300) {
          return {
            status: 'authenticated',
            message: `Validated saved AcgRip cookies against ${baseUrl}${ACGRIP_CONTROL_PANEL_PATH}`,
          }
        }

        return {
          status: 'error',
          message: `AcgRip account check returned HTTP ${response.status}`,
        }
      } catch (error) {
        return {
          status: 'unauthenticated',
          message: (error as Error).message,
        }
      }
    },
    async validatePublish({ profile, payload }) {
      return validateAcgripPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const draft = parsePublishDraft(profile, payload)
      const baseUrl = normalizeBaseUrl(profile.baseUrl)
      let cookieHeader: string | undefined = requireCookieHeader(profile, credentials)
      const client = axios.create({
        maxRedirects: 0,
        validateStatus: () => true,
      })

      const uploadPage = await client.get(`${baseUrl}${ACGRIP_UPLOAD_PATH}`, {
        headers: buildRequestHeaders(cookieHeader),
        responseType: 'text',
      })
      cookieHeader = mergeCookieHeader(cookieHeader, uploadPage.headers['set-cookie'])

      if (isSignInResponse(uploadPage.status, uploadPage.data, uploadPage.headers.location as string | undefined)) {
        throw new Error('AcgRip login has expired. Please sign in again through the popup browser window.')
      }

      if (uploadPage.status < 200 || uploadPage.status >= 300 || typeof uploadPage.data !== 'string') {
        throw new Error(`AcgRip upload page returned HTTP ${uploadPage.status}`)
      }

      const token = extractAuthenticityToken(uploadPage.data)
      if (!token) {
        throw new Error('AcgRip upload page did not include an authenticity token')
      }

      const formData = new FormData()
      formData.append('authenticity_token', token)
      formData.append('post[category_id]', `${draft.typeId}`)
      formData.append('year', `${new Date().getFullYear()}`)
      formData.append('post[series_id]', '0')
      formData.append(
        'post[torrent]',
        new Blob([fs.readFileSync(draft.torrentPath)], {
          type: 'application/x-bittorrent',
        }),
        basename(draft.torrentPath),
      )
      formData.append('post[title]', draft.title)
      formData.append('post[post_as_team]', '1')
      formData.append('post[content]', draft.description)
      formData.append('commit', '发布')

      const response = await client.post(`${baseUrl}${ACGRIP_PUBLISH_PATH}`, formData, {
        headers: buildRequestHeaders(cookieHeader),
        responseType: 'text',
      })
      cookieHeader = mergeCookieHeader(cookieHeader, response.headers['set-cookie'])

      const location = typeof response.headers.location === 'string' ? response.headers.location : undefined
      const redirectMatch = location?.match(/\/t\/(\d+)/)
      const redirectedRemote =
        redirectMatch && location
          ? {
              remoteId: redirectMatch[1],
              remoteUrl: new URL(location, baseUrl).toString(),
            }
          : undefined

      if (response.status === 302) {
        const remote = redirectedRemote ?? (await lookupPublishedTorrent(baseUrl, cookieHeader, draft.title))
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: remote.remoteId,
            remoteUrl: remote.remoteUrl,
            message: remote.remoteUrl
              ? `Published through the AcgRip web adapter (${remote.remoteUrl})`
              : 'Published through the AcgRip web adapter, but the resulting torrent link was not confirmed yet.',
            rawResponse: {
              status: response.status,
              location,
            },
            timestamp: new Date().toISOString(),
          },
          raw: {
            status: response.status,
            location,
          },
        }
      }

      const responseText = typeof response.data === 'string' ? response.data : ''
      if (responseText.includes(ACGRIP_DUPLICATE_TORRENT)) {
        const remote = await lookupPublishedTorrent(baseUrl, cookieHeader, draft.title)
        return {
          result: {
            siteId: profile.id,
            status: 'published',
            remoteId: remote.remoteId,
            remoteUrl: remote.remoteUrl,
            message: remote.remoteUrl
              ? 'AcgRip reports this torrent already exists, and the existing entry was matched successfully.'
              : 'AcgRip reports this torrent already exists, but the existing entry link could not be captured yet.',
            rawResponse: responseText,
            timestamp: new Date().toISOString(),
          },
          raw: responseText,
        }
      }

      throw new Error(`AcgRip publish failed with HTTP ${response.status}`)
    },
  }
}
