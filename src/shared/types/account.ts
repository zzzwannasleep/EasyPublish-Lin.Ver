import type { SiteId } from './site'

export type AccountAuthMode = 'username_password' | 'api_token' | 'cookie'

export type AccountHealthStatus =
  | 'unknown'
  | 'disabled'
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'blocked'
  | 'error'

export interface StoredCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | string
}

export interface SiteAccount {
  siteId: SiteId
  authMode: AccountAuthMode
  username: string
  enabled: boolean
  lastCheckAt?: string
  healthStatus: AccountHealthStatus
  legacyStatus?: string
}

export interface SiteCredentialRecord {
  siteId: SiteId
  username?: string
  password?: string
  apiToken?: string
  cookies?: StoredCookie[]
}

