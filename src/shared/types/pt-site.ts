import type { AccountAuthMode, AccountHealthStatus } from './account'
import type { SiteAdapterKind, SiteCatalogEntry, SiteId } from './site'

export type PtSiteAdapterKind = Extract<SiteAdapterKind, 'acgnx' | 'nexusphp' | 'unit3d'>

export interface PtSiteDraft {
  id?: SiteId
  name: string
  adapter: PtSiteAdapterKind
  baseUrl: string
  enabled: boolean
  apiUid?: string
  username?: string
  password?: string
  apiToken?: string
}

export interface PtSiteRecord extends SiteCatalogEntry {
  builtIn: boolean
  accountAuthMode: AccountAuthMode
  accountStatus: AccountHealthStatus
  accountMessage?: string
  lastCheckAt?: string
  apiUid?: string
  username?: string
  password?: string
  apiToken?: string
}

export interface PtSiteListPayload {
  sites: PtSiteRecord[]
}

export interface PtSitePayload {
  site: PtSiteRecord
}
