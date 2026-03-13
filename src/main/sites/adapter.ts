import type { AccountHealthStatus, SiteAccount, SiteCredentialRecord } from '../../shared/types/account'
import type { PublishResult } from '../../shared/types/publish'
import type {
  SiteAdapterKind,
  SiteCapabilitySet,
  SiteCatalogEntry,
  SiteMetadataRecord,
  SiteProfile,
  SiteValidationIssue,
} from '../../shared/types/site'

export interface AdapterAccountStatus {
  status: AccountHealthStatus
  message?: string
  raw?: unknown
}

export interface ValidateAccountInput {
  profile: SiteProfile
  account?: SiteAccount
  credentials?: SiteCredentialRecord
}

export interface LoadMetadataInput {
  profile: SiteProfile
  account?: SiteAccount
  credentials?: SiteCredentialRecord
}

export interface SitePublishInput {
  profile: SiteProfile
  projectId: number
  payload: Record<string, unknown>
  account?: SiteAccount
  credentials?: SiteCredentialRecord
}

export interface SitePublishOutput {
  result: PublishResult
  raw?: unknown
}

export interface PublishValidationInput {
  profile: SiteProfile
  payload: Record<string, unknown>
}

export interface SiteAdapter {
  readonly id: SiteAdapterKind
  readonly displayName: string
  readonly capabilitySet: SiteCapabilitySet
  supports(profile: SiteProfile): boolean
  describe(profile: SiteProfile): SiteCatalogEntry
  validateAccount?(input: ValidateAccountInput): Promise<AdapterAccountStatus>
  validatePublish?(input: PublishValidationInput): Promise<SiteValidationIssue[]>
  loadMetadata?(input: LoadMetadataInput): Promise<SiteMetadataRecord>
  publish?(input: SitePublishInput): Promise<SitePublishOutput>
}
