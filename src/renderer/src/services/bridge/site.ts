import type { ApiResult } from '../../types/api'
import type { SitePublishDraft, SitePublishPayload } from '../../types/publish'
import type {
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

  getSite(id: SiteId) {
    return parseResult<SiteDetailPayload>(window.siteAPI.getSite(JSON.stringify({ id })))
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

  publish(input: SitePublishDraft) {
    return parseResult<SitePublishPayload>(window.siteAPI.publish(JSON.stringify(input)))
  },
}
