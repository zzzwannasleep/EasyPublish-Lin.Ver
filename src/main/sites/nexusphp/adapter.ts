import fs from 'fs'
import { basename } from 'path'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteProfile, SiteValidationIssue } from '../../../shared/types/site'
import type { SitePublishDraft } from '../../../shared/types/publish'
import type { SiteAdapter } from '../adapter'
import { createNexusHttpClient, getPreferredNexusAuthModes, resolveNexusAuth } from './auth'
import { deriveNexusApiBase, joinNexusEndpoint, normalizeNexusSiteBase, sortNexusSections } from './mapper'
import { ensureNexusApiSuccess, extractNexusData, extractNexusSections } from './schema'

function describeNexusSite(profile: SiteProfile): SiteCatalogEntry {
  const notes: string[] = []
  let normalizedBaseUrl = profile.baseUrl.trim()
  let apiBaseUrl: string | undefined

  try {
    normalizedBaseUrl = normalizeNexusSiteBase(profile.baseUrl)
    apiBaseUrl = deriveNexusApiBase(normalizedBaseUrl)
    notes.push(`Preferred auth: ${getPreferredNexusAuthModes(profile).join(' / ') || 'none'}`)
    notes.push('NexusPHP metadata loading, validation, and torrent publishing now route through this adapter.')
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value
        .map(asNumber)
        .filter((item): item is number => typeof item === 'number' && item > 0)
    : []
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((accumulator, [key, raw]) => {
    const parsed = asNumber(raw)
    if (parsed && parsed > 0) {
      accumulator[key] = parsed
    }
    return accumulator
  }, {})
}

function parsePublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SitePublishDraft {
  const issues = validateNexusPublishDraft(profile, payload)
  if (issues.length > 0) {
    throw new Error(issues.map(issue => issue.message).join(' | '))
  }

  const typeId = asNumber(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)

  if (typeId === undefined || !title || !description || !torrentPath) {
    throw new Error('Publish draft validation did not produce the required NexusPHP fields')
  }

  const draft: SitePublishDraft = {
    siteId: profile.id,
    typeId,
    title,
    description,
    torrentPath,
    smallDescription: asString(payload.smallDescription),
    url: asString(payload.url),
    technicalInfo: asString(payload.technicalInfo),
    ptGen: asString(payload.ptGen),
    price: asNumber(payload.price),
    tagIds: asNumberArray(payload.tagIds),
    posState: asString(payload.posState) ?? 'normal',
    posStateUntil: asString(payload.posStateUntil),
    pickType: asString(payload.pickType) ?? 'normal',
    anonymous: asBoolean(payload.anonymous),
    subCategories: asNumberRecord(payload.subCategories),
    nfoPath: asString(payload.nfoPath),
  }

  if (draft.nfoPath && !fs.existsSync(draft.nfoPath)) {
    throw new Error('The selected NFO file does not exist')
  }

  return draft
}

function validateNexusPublishDraft(profile: SiteProfile, payload: Record<string, unknown>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = []
  const typeId = asNumber(payload.typeId)
  const title = asString(payload.title)
  const description = asString(payload.description)
  const torrentPath = asString(payload.torrentPath)
  const nfoPath = asString(payload.nfoPath)

  if (!typeId) {
    issues.push({
      field: 'typeId',
      message: `A category id is required before publishing to ${profile.name}`,
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

  if (nfoPath && !fs.existsSync(nfoPath)) {
    issues.push({
      field: 'nfoPath',
      message: 'The selected NFO file does not exist',
      severity: 'error',
    })
  }

  return issues
}

function appendOptionalText(formData: FormData, key: string, value?: string | number) {
  if (value === undefined || value === null || `${value}`.trim() === '') {
    return
  }

  formData.append(key, `${value}`.trim())
}

function extractRemoteId(raw: unknown): string | undefined {
  const data = extractNexusData(raw)
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    const nested = record.data
    const directId = record.id
    const nestedId =
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? (nested as Record<string, unknown>).id
        : undefined

    return asString(directId) ?? (typeof directId === 'number' ? `${directId}` : undefined) ??
      asString(nestedId) ?? (typeof nestedId === 'number' ? `${nestedId}` : undefined)
  }

  return undefined
}

export function createNexusphpAdapter(): SiteAdapter {
  return {
    id: 'nexusphp',
    displayName: 'NexusPHP',
    capabilitySet: buildSiteCapabilitySet([
      'torrent_publish',
      'cookie_auth',
      'username_password_auth',
      'metadata_sections',
      'metadata_tags',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
      'nfo_upload',
    ]),
    supports(profile) {
      return profile.adapter === 'nexusphp'
    },
    describe(profile) {
      return describeNexusSite(profile)
    },
    async validateAccount({ profile, credentials }) {
      try {
        const resolved = await resolveNexusAuth(profile, credentials)
        return {
          status: 'authenticated',
          message: `Resolved ${resolved.authMode} authentication for ${resolved.apiBaseUrl}`,
        }
      } catch (error) {
        return {
          status: 'unauthenticated',
          message: (error as Error).message,
        }
      }
    },
    async validatePublish({ profile, payload }) {
      return validateNexusPublishDraft(profile, payload)
    },
    async loadMetadata({ profile, credentials }) {
      const resolved = await resolveNexusAuth(profile, credentials)
      const client = createNexusHttpClient()
      const response = await client.get(joinNexusEndpoint(resolved.apiBaseUrl, 'sections'), {
        headers: resolved.headers,
      })

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Sections request failed with HTTP ${response.status}`)
      }

      ensureNexusApiSuccess(response.data)
      const sections = sortNexusSections(extractNexusSections(response.data))

      return {
        siteId: profile.id,
        apiBaseUrl: resolved.apiBaseUrl,
        sections,
        raw: response.data,
      }
    },
    async publish({ profile, payload, credentials }) {
      const draft = parsePublishDraft(profile, payload)
      const resolved = await resolveNexusAuth(profile, credentials)
      const client = createNexusHttpClient()

      const torrentPart = new Blob([fs.readFileSync(draft.torrentPath)], {
        type: 'application/x-bittorrent',
      })

      const formData = new FormData()
      formData.append('name', draft.title)
      formData.append('descr', draft.description)
      formData.append('type', `${draft.typeId}`)
      formData.append('file', torrentPart, basename(draft.torrentPath))

      appendOptionalText(formData, 'small_descr', draft.smallDescription)
      appendOptionalText(formData, 'url', draft.url)
      appendOptionalText(formData, 'technical_info', draft.technicalInfo)
      appendOptionalText(formData, 'pt_gen', draft.ptGen)
      appendOptionalText(formData, 'price', draft.price)
      appendOptionalText(formData, 'tags', draft.tagIds?.join(','))
      appendOptionalText(formData, 'pos_state', draft.posState ?? 'normal')
      appendOptionalText(formData, 'pos_state_until', draft.posStateUntil)
      appendOptionalText(formData, 'pick_type', draft.pickType ?? 'normal')
      appendOptionalText(formData, 'uplver', draft.anonymous ? 'yes' : 'no')

      Object.entries(draft.subCategories).forEach(([field, value]) => {
        appendOptionalText(formData, field, value)
      })

      if (draft.nfoPath) {
        const nfoPart = new Blob([fs.readFileSync(draft.nfoPath)], {
          type: 'text/plain',
        })
        formData.append('nfo', nfoPart, basename(draft.nfoPath))
      }

      const response = await client.post(joinNexusEndpoint(resolved.apiBaseUrl, 'upload'), formData, {
        headers: resolved.headers,
      })

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Upload request failed with HTTP ${response.status}`)
      }

      ensureNexusApiSuccess(response.data)
      const remoteId = extractRemoteId(response.data)

      return {
        result: {
          siteId: profile.id,
          status: 'published',
          remoteId,
          remoteUrl: remoteId ? joinNexusEndpoint(resolved.siteBaseUrl, `details.php?id=${remoteId}`) : undefined,
          message: remoteId
            ? `Published through NexusPHP adapter with remote id ${remoteId}`
            : 'Published through NexusPHP adapter',
          rawResponse: response.data,
          timestamp: new Date().toISOString(),
        },
        raw: response.data,
      }
    },
  }
}
