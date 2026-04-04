import type { ApiResult } from '../../types/api'
import type { SitePublishDraft, SitePublishPayload } from '../../types/publish'
import type { PtSiteDraft, PtSiteListPayload, PtSitePayload } from '../../types/pt-site'
import type {
  BangumiSubjectSearchPayload,
  SiteAccountValidationPayload,
  SiteDetailPayload,
  SiteId,
  SiteListPayload,
  SiteMetadataPayload,
  SitePublishValidationPayload,
} from '../../types/site'

async function parseResult<T>(promise: Promise<string>): Promise<ApiResult<T>> {
  return JSON.parse(await promise) as ApiResult<T>
}

export const siteBridge = {
  listSites() {
    return parseResult<SiteListPayload>(window.siteAPI.listSites())
  },

  listManagedPtSites() {
    return parseResult<PtSiteListPayload>(window.siteAPI.listManagedPtSites())
  },

  getSite(id: SiteId) {
    return parseResult<SiteDetailPayload>(window.siteAPI.getSite(JSON.stringify({ id })))
  },

  saveManagedPtSite(input: PtSiteDraft) {
    return parseResult<PtSitePayload>(window.siteAPI.saveManagedPtSite(JSON.stringify(input)))
  },

  removeManagedPtSite(id: SiteId) {
    return parseResult<{ id: SiteId }>(window.siteAPI.removeManagedPtSite(JSON.stringify({ id })))
  },

  validateAccount(id: SiteId) {
    return parseResult<SiteAccountValidationPayload>(window.siteAPI.validateAccount(JSON.stringify({ id })))
  },

  validatePublish(input: SitePublishDraft) {
    return parseResult<SitePublishValidationPayload>(window.siteAPI.validatePublish(JSON.stringify(input)))
  },

  loadMetadata(id: SiteId) {
    return parseResult<SiteMetadataPayload>(window.siteAPI.loadMetadata(JSON.stringify({ id })))
  },

  searchBangumiSubjects(query: string, limit = 8) {
    return parseResult<BangumiSubjectSearchPayload>(
      window.siteAPI.searchBangumiSubjects(JSON.stringify({ query, limit })),
    )
  },

  publish(input: SitePublishDraft) {
    return parseResult<SitePublishPayload>(window.siteAPI.publish(JSON.stringify(input)))
  },
}
