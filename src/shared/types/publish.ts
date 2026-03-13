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

export interface SitePublishDraft {
  projectId?: number
  siteId: SiteId
  typeId: number
  title: string
  description: string
  torrentPath: string
  smallDescription?: string
  url?: string
  technicalInfo?: string
  ptGen?: string
  price?: number
  tagIds?: number[]
  posState?: string
  posStateUntil?: string
  pickType?: string
  anonymous?: boolean
  subCategories: Record<string, number>
  nfoPath?: string
}

export interface SitePublishPayload {
  result: PublishResult
}
