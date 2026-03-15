import fs from 'fs'
import { basename } from 'path'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import type { SiteAdapter } from '../adapter'
import { createUnit3dHttpClient, getPreferredUnit3dAuthModes, resolveUnit3dAuth } from './auth'
import { deriveUnit3dApiBase, joinUnit3dEndpoint, normalizeUnit3dSiteBase } from './mapper'
import {
  ensureUnit3dSuccess,
  extractUnit3dErrorMessage,
  extractUnit3dTorrentRecords,
  extractUnit3dUploadResponse,
  extractUnit3dUserSummary,
  type Unit3dTorrentRecord,
} from './schema'

const UNIT3D_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'categoryId',
    labelKey: 'nexus.site.manualCategoryId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dCategoryIdHelp',
    control: 'number',
    mode: 'required',
    min: 1,
  },
  {
    key: 'typeId',
    labelKey: 'nexus.site.manualTypeId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dTypeIdHelp',
    control: 'number',
    mode: 'required',
    min: 1,
  },
  {
    key: 'resolutionId',
    labelKey: 'nexus.site.manualResolutionId',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dResolutionIdHelp',
    control: 'number',
    mode: 'required',
    min: 1,
  },
  {
    key: 'tmdb',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dTmdb',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dTmdbHelp',
    control: 'number',
    mode: 'readonly',
    min: 1,
  },
  {
    key: 'imdb',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dImdb',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dImdbHelp',
    control: 'number',
    mode: 'readonly',
    min: 1,
  },
  {
    key: 'tvdb',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dTvdb',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dTvdbHelp',
    control: 'number',
    mode: 'readonly',
    min: 1,
  },
  {
    key: 'mal',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dMal',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dMalHelp',
    control: 'number',
    mode: 'readonly',
    min: 1,
  },
  {
    key: 'igdb',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dIgdb',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dIgdbHelp',
    control: 'number',
    mode: 'readonly',
    min: 1,
  },
  {
    key: 'free',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFree',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFreeHelp',
    control: 'number',
    mode: 'optional',
    min: 0,
    max: 100,
  },
  {
    key: 'flUntil',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFlUntil',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFlUntilHelp',
    control: 'number',
    mode: 'optional',
    min: 1,
  },
  {
    key: 'refundable',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dRefundable',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dRefundableHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'featured',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFeatured',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dFeaturedHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'doubleup',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dDoubleup',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dDoubleupHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'duUntil',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dDuUntil',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dDuUntilHelp',
    control: 'number',
    mode: 'optional',
    min: 1,
  },
  {
    key: 'personalRelease',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dPersonalRelease',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dPersonalReleaseHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'internal',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dInternal',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dInternalHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'sticky',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dSticky',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dStickyHelp',
    control: 'checkbox',
    mode: 'optional',
  },
  {
    key: 'modQueueOptIn',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.unit3dModQueueOptIn',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.unit3dModQueueOptInHelp',
    control: 'checkbox',
    mode: 'optional',
  },
]

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []) {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

interface Unit3dPublishDraft {
  title: string
  description: string
  torrentPath: string
  categoryId: number
  typeId: number
  resolutionId: number
  nfoPath?: string
  mediaInfo?: string
  bdInfo?: string
  regionId?: number
  distributorId?: number
  seasonNumber?: number
  episodeNumber?: number
  tmdb?: number
  imdb?: number
  tvdb?: number
  mal?: number
  igdb?: number
  anonymous: boolean
  personalRelease: boolean
  internal: boolean
  refundable: boolean
  featured: boolean
  free?: number
  flUntil?: number
  doubleup: boolean
  duUntil?: number
  sticky: boolean
  modQueueOptIn: boolean
}

function describeUnit3dSite(profile: SiteProfile): SiteCatalogEntry {
  const notes: string[] = []
  let normalizedBaseUrl = profile.baseUrl.trim()
  let apiBaseUrl: string | undefined

  try {
    normalizedBaseUrl = normalizeUnit3dSiteBase(profile.baseUrl)
    apiBaseUrl = deriveUnit3dApiBase(normalizedBaseUrl)
    notes.push(`Preferred auth: ${getPreferredUnit3dAuthModes(profile).join(' / ') || 'none'}`)
    notes.push('Metadata loading is not exposed by UNIT3D. Enter category/type/resolution IDs manually when publishing.')
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
    fieldSchemas: cloneSiteFieldSchemas(UNIT3D_FIELD_SCHEMAS),
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function asPositiveNumber(value: unknown): number | undefined {
  const parsed = asNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function validateUnit3dPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryId = asPositiveNumber(payload.categoryId)
  const typeId = asPositiveNumber(payload.typeId)
  const resolutionId = asPositiveNumber(payload.resolutionId)
  const nfoPath = asString(payload.nfoPath)
  const free = asNumber(payload.free)
  const flUntil = asPositiveNumber(payload.flUntil)
  const duUntil = asPositiveNumber(payload.duUntil)

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

  if (!categoryId) {
    issues.push({
      field: 'categoryId',
      message: 'UNIT3D category ID is required',
      severity: 'error',
    })
  }

  if (!typeId) {
    issues.push({
      field: 'typeId',
      message: 'UNIT3D type ID is required',
      severity: 'error',
    })
  }

  if (!resolutionId) {
    issues.push({
      field: 'resolutionId',
      message: 'UNIT3D resolution ID is required',
      severity: 'error',
    })
  }

  if (nfoPath && !fs.existsSync(nfoPath)) {
    issues.push({
      field: 'nfoPath',
      message: 'The selected NFO file does not exist',
      severity: 'error',
    })
  }

  if (free !== undefined && (free < 0 || free > 100)) {
    issues.push({
      field: 'free',
      message: 'Freeleech percentage must be between 0 and 100',
      severity: 'error',
    })
  }

  if (payload.flUntil !== undefined && payload.flUntil !== null && !flUntil) {
    issues.push({
      field: 'flUntil',
      message: 'Freeleech days must be greater than zero',
      severity: 'error',
    })
  }

  if (payload.duUntil !== undefined && payload.duUntil !== null && !duUntil) {
    issues.push({
      field: 'duUntil',
      message: 'Double upload days must be greater than zero',
      severity: 'error',
    })
  }

  return issues
}

function parseUnit3dPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): Unit3dPublishDraft {
  const issues = validateUnit3dPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const categoryId = asPositiveNumber(payload.categoryId)
  const typeId = asPositiveNumber(payload.typeId)
  const resolutionId = asPositiveNumber(payload.resolutionId)

  if (!title || !description || !torrentPath || !categoryId || !typeId || !resolutionId) {
    throw new Error('UNIT3D publish validation did not produce the required fields')
  }

  return {
    title,
    description,
    torrentPath,
    categoryId,
    typeId,
    resolutionId,
    nfoPath: asString(payload.nfoPath),
    mediaInfo: asString(payload.mediaInfo),
    bdInfo: asString(payload.bdInfo),
    regionId: asPositiveNumber(payload.regionId),
    distributorId: asPositiveNumber(payload.distributorId),
    seasonNumber: asPositiveNumber(payload.seasonNumber),
    episodeNumber: asPositiveNumber(payload.episodeNumber),
    tmdb: asPositiveNumber(payload.tmdb),
    imdb: asPositiveNumber(payload.imdb),
    tvdb: asPositiveNumber(payload.tvdb),
    mal: asPositiveNumber(payload.mal),
    igdb: asPositiveNumber(payload.igdb),
    anonymous: asBoolean(payload.anonymous),
    personalRelease: asBoolean(payload.personalRelease),
    internal: asBoolean(payload.internal),
    refundable: asBoolean(payload.refundable),
    featured: asBoolean(payload.featured),
    free: asNumber(payload.free),
    flUntil: asPositiveNumber(payload.flUntil),
    doubleup: asBoolean(payload.doubleup),
    duUntil: asPositiveNumber(payload.duUntil),
    sticky: asBoolean(payload.sticky),
    modQueueOptIn: asBoolean(payload.modQueueOptIn),
  }
}

function appendOptionalText(formData: FormData, key: string, value?: string | number) {
  if (value === undefined || value === null || `${value}`.trim() === '') {
    return
  }

  formData.append(key, `${value}`.trim())
}

function appendOptionalFlag(formData: FormData, key: string, value: boolean) {
  if (value) {
    formData.append(key, '1')
  }
}

function inferRemoteIdFromLink(link?: string): string | undefined {
  if (!link) {
    return undefined
  }

  try {
    const url = new URL(link)
    const match = url.pathname.match(/\/(\d+)(?:[./_-]|$)/)
    return match?.[1]
  } catch {
    return undefined
  }
}

function isMatchingTorrent(
  torrent: Unit3dTorrentRecord,
  draft: Unit3dPublishDraft,
  downloadLink?: string,
): boolean {
  if (downloadLink && torrent.downloadLink === downloadLink) {
    return true
  }

  if (torrent.name !== draft.title) {
    return false
  }

  if (torrent.categoryId !== undefined && torrent.categoryId !== draft.categoryId) {
    return false
  }

  if (torrent.typeId !== undefined && torrent.typeId !== draft.typeId) {
    return false
  }

  if (torrent.resolutionId !== undefined && torrent.resolutionId !== draft.resolutionId) {
    return false
  }

  if (draft.tmdb && torrent.tmdb !== undefined && torrent.tmdb !== draft.tmdb) {
    return false
  }

  if (draft.imdb && torrent.imdb !== undefined && torrent.imdb !== draft.imdb) {
    return false
  }

  if (draft.tvdb && torrent.tvdb !== undefined && torrent.tvdb !== draft.tvdb) {
    return false
  }

  if (draft.mal && torrent.mal !== undefined && torrent.mal !== draft.mal) {
    return false
  }

  if (draft.igdb && torrent.igdb !== undefined && torrent.igdb !== draft.igdb) {
    return false
  }

  return true
}

async function findUploadedTorrent(options: {
  apiBaseUrl: string
  siteBaseUrl: string
  params: Record<string, string>
  headers: Record<string, string>
  client: ReturnType<typeof createUnit3dHttpClient>
  draft: Unit3dPublishDraft
  downloadLink?: string
}) {
  const { apiBaseUrl, siteBaseUrl, params, headers, client, draft, downloadLink } = options
  const response = await client.get(joinUnit3dEndpoint(apiBaseUrl, 'torrents/filter'), {
    headers,
    params: {
      ...params,
      perPage: 10,
      sortField: 'created_at',
      sortDirection: 'desc',
      name: draft.title,
    },
  })

  if (response.status < 200 || response.status >= 300) {
    return undefined
  }

  const candidates = extractUnit3dTorrentRecords(response.data)
  const matched = candidates.find(item => isMatchingTorrent(item, draft, downloadLink))
  if (!matched) {
    return undefined
  }

  const remoteId = matched.id ?? inferRemoteIdFromLink(downloadLink)
  const remoteUrl = matched.detailsLink ?? (remoteId ? joinUnit3dEndpoint(siteBaseUrl, `torrents/${remoteId}`) : undefined)

  return {
    remoteId,
    remoteUrl,
    matched,
  }
}

export function createUnit3dAdapter(): SiteAdapter {
  return {
    id: 'unit3d',
    displayName: 'UNIT3D',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'token_auth',
      'raw_response',
      'nfo_upload',
    ]),
    supports(profile) {
      return profile.adapter === 'unit3d'
    },
    describe(profile) {
      return describeUnit3dSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const resolved = await resolveUnit3dAuth(profile, credentials)
        const client = createUnit3dHttpClient()
        const response = await client.get(joinUnit3dEndpoint(resolved.apiBaseUrl, 'user'), {
          headers: resolved.headers,
          params: resolved.params,
        })

        if (response.status === 401 || response.status === 403) {
          return {
            status: 'unauthenticated',
            message: extractUnit3dErrorMessage(response.data) || `UNIT3D token was rejected with HTTP ${response.status}`,
          }
        }

        if (response.status < 200 || response.status >= 300) {
          return {
            status: 'error',
            message: extractUnit3dErrorMessage(response.data) || `UNIT3D account check failed with HTTP ${response.status}`,
          }
        }

        const summary = extractUnit3dUserSummary(response.data)
        const groupText = summary?.group ? ` (${summary.group})` : ''

        return {
          status: 'authenticated',
          message: summary?.username
            ? `Validated UNIT3D token for ${summary.username}${groupText}`
            : `Validated UNIT3D token for ${resolved.apiBaseUrl}`,
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
      return validateUnit3dPublishDraft(profile, payload)
    },
    async publish({ profile, payload, credentials }) {
      const draft = parseUnit3dPublishDraft(profile, payload)
      const resolved = await resolveUnit3dAuth(profile, credentials)
      const client = createUnit3dHttpClient()

      const torrentPart = new Blob([fs.readFileSync(draft.torrentPath)], {
        type: 'application/x-bittorrent',
      })

      const formData = new FormData()
      formData.append('torrent', torrentPart, basename(draft.torrentPath))
      formData.append('name', draft.title)
      formData.append('description', draft.description)
      formData.append('category_id', `${draft.categoryId}`)
      formData.append('type_id', `${draft.typeId}`)
      formData.append('resolution_id', `${draft.resolutionId}`)

      appendOptionalText(formData, 'mediainfo', draft.mediaInfo)
      appendOptionalText(formData, 'bdinfo', draft.bdInfo)
      appendOptionalText(formData, 'region_id', draft.regionId)
      appendOptionalText(formData, 'distributor_id', draft.distributorId)
      appendOptionalText(formData, 'season_number', draft.seasonNumber)
      appendOptionalText(formData, 'episode_number', draft.episodeNumber)
      appendOptionalText(formData, 'tmdb', draft.tmdb)
      appendOptionalText(formData, 'imdb', draft.imdb)
      appendOptionalText(formData, 'tvdb', draft.tvdb)
      appendOptionalText(formData, 'mal', draft.mal)
      appendOptionalText(formData, 'igdb', draft.igdb)
      appendOptionalFlag(formData, 'anonymous', draft.anonymous)
      appendOptionalFlag(formData, 'personal_release', draft.personalRelease)
      appendOptionalFlag(formData, 'internal', draft.internal)
      appendOptionalFlag(formData, 'refundable', draft.refundable)
      appendOptionalFlag(formData, 'featured', draft.featured)
      if (draft.free !== undefined && draft.free > 0) {
        appendOptionalText(formData, 'free', draft.free)
      }
      appendOptionalText(formData, 'fl_until', draft.flUntil)
      appendOptionalFlag(formData, 'doubleup', draft.doubleup)
      appendOptionalText(formData, 'du_until', draft.duUntil)
      appendOptionalFlag(formData, 'sticky', draft.sticky)
      appendOptionalFlag(formData, 'mod_queue_opt_in', draft.modQueueOptIn)

      if (draft.nfoPath) {
        const nfoPart = new Blob([fs.readFileSync(draft.nfoPath)], {
          type: 'text/plain',
        })
        formData.append('nfo', nfoPart, basename(draft.nfoPath))
      }

      const response = await client.post(joinUnit3dEndpoint(resolved.apiBaseUrl, 'torrents/upload'), formData, {
        headers: resolved.headers,
        params: resolved.params,
      })

      if (response.status < 200 || response.status >= 300) {
        throw new Error(extractUnit3dErrorMessage(response.data) || `Upload request failed with HTTP ${response.status}`)
      }

      ensureUnit3dSuccess(response.data)
      const upload = extractUnit3dUploadResponse(response.data)
      const matched = await findUploadedTorrent({
        apiBaseUrl: resolved.apiBaseUrl,
        siteBaseUrl: resolved.siteBaseUrl,
        params: resolved.params,
        headers: resolved.headers,
        client,
        draft,
        downloadLink: upload.downloadLink,
      })

      const remoteId = matched?.remoteId ?? inferRemoteIdFromLink(upload.downloadLink)
      const remoteUrl =
        matched?.remoteUrl ??
        (remoteId ? joinUnit3dEndpoint(resolved.siteBaseUrl, `torrents/${remoteId}`) : undefined)

      return {
        result: {
          siteId: profile.id,
          status: 'published',
          remoteId,
          remoteUrl,
          message:
            upload.message ||
            (remoteId ? `Published through UNIT3D adapter with remote id ${remoteId}` : 'Published through UNIT3D adapter'),
          rawResponse: {
            upload: response.data,
            matchedTorrent: matched?.matched,
            downloadLink: upload.downloadLink,
          },
          timestamp: new Date().toISOString(),
        },
        raw: response.data,
      }
    },
  }
}
