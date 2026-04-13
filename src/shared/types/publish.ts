import type { SiteId } from './site'

export type PublishState = 'idle' | 'pending' | 'published' | 'failed'

export interface PublishResult {
  siteId: SiteId
  status: PublishState
  remoteId?: string
  remoteUrl?: string
  message?: string
  rawResponse?: unknown
  timestamp?: string
}

export interface SitePublishBatchEntry {
  id: string
  name: string
  torrentPath: string
  title: string
}

export interface SitePublishDraft {
  projectId?: number
  siteId: SiteId
  typeId: number
  categoryBangumi?: string
  categoryCode?: string
  teamId?: number
  title: string
  description: string
  notes?: string
  torrentPath: string
  posterUrl?: string
  batchEntries?: SitePublishBatchEntry[]
  trackers?: string[]
  bangumiId?: number
  episodeKey?: string
  resolution?: string
  language?: string[]
  subtitle?: string
  format?: string
  version?: string
  fileSize?: number
  subtitleGroupId?: number
  publishGroupId?: number
  categoryId?: number
  resolutionId?: number
  smallDescription?: string
  url?: string
  technicalInfo?: string
  ptGen?: string
  mediaInfo?: string
  bdInfo?: string
  price?: number
  tagIds?: number[]
  regionId?: number
  distributorId?: number
  seasonNumber?: number
  episodeNumber?: number
  tmdb?: number
  imdb?: number
  tvdb?: number
  mal?: number
  igdb?: number
  posState?: string
  posStateUntil?: string
  pickType?: string
  disableDownloadSeedFile?: boolean
  emuleResource?: string
  syncKey?: string
  btSyncKey?: string
  anonymous?: boolean
  anonymousPost?: boolean
  complete?: boolean
  remake?: boolean
  teamPost?: boolean
  teamSync?: boolean
  publishIdentity?: string
  bangumiTagIds?: string[]
  personalRelease?: boolean
  internal?: boolean
  refundable?: boolean
  featured?: boolean
  free?: number
  flUntil?: number
  doubleup?: boolean
  duUntil?: number
  sticky?: boolean
  modQueueOptIn?: boolean
  subCategories: Record<string, number>
  nfoPath?: string
}

export interface SitePublishPayload {
  result: PublishResult
}
