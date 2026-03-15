import type { AccountAuthMode, AccountHealthStatus } from './account'

export const builtinSiteIds = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g', 'forum'] as const

export type BuiltInSiteId = (typeof builtinSiteIds)[number]

export type SiteId = string

export type SiteAdapterKind = 'bangumi' | 'mikan' | 'miobt' | 'nyaa' | 'nexusphp' | 'unit3d' | 'wordpress'

export type SiteCapability =
  | 'torrent_publish'
  | 'article_publish'
  | 'cookie_auth'
  | 'token_auth'
  | 'username_password_auth'
  | 'browser_login'
  | 'metadata_sections'
  | 'metadata_tags'
  | 'metadata_sub_categories'
  | 'content_preview'
  | 'raw_response'
  | 'update_publish'
  | 'nfo_upload'

export interface SiteCapabilitySet {
  auth: {
    cookie: boolean
    token: boolean
    usernamePassword: boolean
    browserLogin: boolean
  }
  metadata: {
    sections: boolean
    tags: boolean
    subCategories: boolean
    preview: boolean
  }
  publish: {
    torrent: boolean
    article: boolean
    update: boolean
    rawResponse: boolean
    nfoUpload: boolean
  }
}

export interface SiteProfile {
  id: SiteId
  name: string
  adapter: SiteAdapterKind
  baseUrl: string
  capabilities: SiteCapability[]
  enabled?: boolean
  customFieldMap?: Record<string, string>
}

export type SiteFieldSchemaControl = 'select' | 'text' | 'number' | 'checkbox'

export type SiteFieldSchemaMode = 'required' | 'optional' | 'readonly'

export interface SiteFieldSchemaOption {
  label: string
  value: string
  labelKey?: string
}

export interface SiteFieldSchemaEntry {
  key: string
  labelKey: string
  helpKey: string
  control: SiteFieldSchemaControl
  mode: SiteFieldSchemaMode
  options?: SiteFieldSchemaOption[]
  placeholderKey?: string
  min?: number
  max?: number
  step?: number
}

export interface SiteCatalogEntry {
  id: SiteId
  name: string
  adapter: SiteAdapterKind
  enabled: boolean
  baseUrl: string
  normalizedBaseUrl: string
  apiBaseUrl?: string
  capabilities: SiteCapability[]
  capabilitySet: SiteCapabilitySet
  notes: string[]
  customFieldMap?: Record<string, string>
  fieldSchemas?: SiteFieldSchemaEntry[]
  accountAuthMode?: AccountAuthMode
  accountStatus?: AccountHealthStatus
  accountMessage?: string
  accountConfigured?: boolean
}

export interface SiteSectionOption {
  id: number
  name: string
}

export interface SiteSectionTag {
  id: number
  name: string
  color?: string
  fontColor?: string
}

export interface SiteSectionSubCategory {
  field: string
  label: string
  data: SiteSectionOption[]
}

export interface SiteSection {
  id: number
  name: string
  displayName?: string
  categories: SiteSectionOption[]
  tags: SiteSectionTag[]
  subCategories: SiteSectionSubCategory[]
}

export interface SiteMetadataRecord {
  siteId: SiteId
  apiBaseUrl?: string
  sections: SiteSection[]
  raw?: unknown
}

export interface SiteListPayload {
  sites: SiteCatalogEntry[]
}

export interface SiteDetailPayload {
  site: SiteCatalogEntry
}

export interface SiteMetadataPayload {
  siteId: SiteId
  metadata: SiteMetadataRecord
}

export interface SiteValidationIssue {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface SiteAccountValidationPayload {
  siteId: SiteId
  status: 'authenticated' | 'unauthenticated' | 'error'
  message?: string
}

export interface SitePublishValidationPayload {
  siteId: SiteId
  valid: boolean
  issues: SiteValidationIssue[]
}

export const defaultSiteCapabilitySet: SiteCapabilitySet = {
  auth: {
    cookie: false,
    token: false,
    usernamePassword: false,
    browserLogin: false,
  },
  metadata: {
    sections: false,
    tags: false,
    subCategories: false,
    preview: false,
  },
  publish: {
    torrent: false,
    article: false,
    update: false,
    rawResponse: false,
    nfoUpload: false,
  },
}

export function buildSiteCapabilitySet(capabilities: SiteCapability[]): SiteCapabilitySet {
  const capabilitySet: SiteCapabilitySet = {
    auth: { ...defaultSiteCapabilitySet.auth },
    metadata: { ...defaultSiteCapabilitySet.metadata },
    publish: { ...defaultSiteCapabilitySet.publish },
  }

  capabilities.forEach(capability => {
    switch (capability) {
      case 'cookie_auth':
        capabilitySet.auth.cookie = true
        break
      case 'token_auth':
        capabilitySet.auth.token = true
        break
      case 'username_password_auth':
        capabilitySet.auth.usernamePassword = true
        break
      case 'browser_login':
        capabilitySet.auth.browserLogin = true
        break
      case 'metadata_sections':
        capabilitySet.metadata.sections = true
        break
      case 'metadata_tags':
        capabilitySet.metadata.tags = true
        break
      case 'metadata_sub_categories':
        capabilitySet.metadata.subCategories = true
        break
      case 'content_preview':
        capabilitySet.metadata.preview = true
        break
      case 'torrent_publish':
        capabilitySet.publish.torrent = true
        break
      case 'article_publish':
        capabilitySet.publish.article = true
        break
      case 'update_publish':
        capabilitySet.publish.update = true
        break
      case 'raw_response':
        capabilitySet.publish.rawResponse = true
        break
      case 'nfo_upload':
        capabilitySet.publish.nfoUpload = true
        break
      default:
        break
    }
  })

  return capabilitySet
}

export const defaultSiteProfiles: SiteProfile[] = [
  {
    id: 'bangumi',
    name: 'Bangumi',
    adapter: 'bangumi',
    baseUrl: 'https://bangumi.moe',
    capabilities: ['torrent_publish', 'cookie_auth', 'browser_login', 'content_preview'],
  },
  {
    id: 'nyaa',
    name: 'Nyaa',
    adapter: 'nyaa',
    baseUrl: 'https://nyaa.si',
    capabilities: ['torrent_publish', 'cookie_auth', 'browser_login', 'content_preview'],
  },
  {
    id: 'mikan',
    name: 'Mikan',
    adapter: 'mikan',
    baseUrl: 'https://mikanani.me',
    capabilities: ['torrent_publish', 'token_auth', 'content_preview', 'raw_response'],
  },
  {
    id: 'miobt',
    name: 'MioBT',
    adapter: 'miobt',
    baseUrl: 'https://www.miobt.com',
    capabilities: ['torrent_publish', 'token_auth', 'content_preview'],
  },
  {
    id: 'acgrip',
    name: 'AcgRip',
    adapter: 'nexusphp',
    baseUrl: 'https://acg.rip',
    capabilities: [
      'torrent_publish',
      'cookie_auth',
      'username_password_auth',
      'metadata_sections',
      'metadata_tags',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
      'nfo_upload',
    ],
  },
  {
    id: 'dmhy',
    name: 'DMHY',
    adapter: 'nexusphp',
    baseUrl: 'https://www.dmhy.org',
    capabilities: [
      'torrent_publish',
      'cookie_auth',
      'username_password_auth',
      'metadata_sections',
      'metadata_tags',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
      'nfo_upload',
    ],
  },
  {
    id: 'acgnx_a',
    name: 'AcgnX Asia',
    adapter: 'nexusphp',
    baseUrl: 'https://share.acgnx.se',
    capabilities: [
      'torrent_publish',
      'cookie_auth',
      'token_auth',
      'username_password_auth',
      'metadata_sections',
      'metadata_tags',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
      'nfo_upload',
    ],
  },
  {
    id: 'acgnx_g',
    name: 'AcgnX Global',
    adapter: 'nexusphp',
    baseUrl: 'https://www.acgnx.se',
    capabilities: [
      'torrent_publish',
      'cookie_auth',
      'token_auth',
      'username_password_auth',
      'metadata_sections',
      'metadata_tags',
      'metadata_sub_categories',
      'content_preview',
      'raw_response',
      'nfo_upload',
    ],
  },
  {
    id: 'forum',
    name: 'VCB-S Forum',
    adapter: 'wordpress',
    baseUrl: 'https://vcb-s.com',
    capabilities: ['article_publish', 'cookie_auth', 'username_password_auth'],
  },
]
