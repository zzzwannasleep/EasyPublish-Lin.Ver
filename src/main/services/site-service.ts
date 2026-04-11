import axios from 'axios'
import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { PublishResult, SitePublishBatchEntry } from '../../shared/types/publish'
import type { PtSiteDraft } from '../../shared/types/pt-site'
import type { BangumiSubjectSearchItem, SiteCatalogEntry, SiteId } from '../../shared/types/site'
import { createSiteRegistry } from '../sites/registry'
import { createCredentialStore } from '../storage/credential-store'
import { createProjectStore } from '../storage/project-store'
import {
  applyPublishTorrentEntry,
  buildEpisodeDerivedContent,
  getActivePublishTorrentEntry,
  getSelectedPublishTorrentEntries,
} from './episode-publish-support'

interface CreateSiteServiceOptions {
  siteRegistry: ReturnType<typeof createSiteRegistry>
  credentialStore: ReturnType<typeof createCredentialStore>
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged?: () => void
}

export function createSiteService(options: CreateSiteServiceOptions) {
  const { siteRegistry, credentialStore, projectStore, notifyProjectDataChanged } = options
  const ptAdapters = new Set(['acgnx', 'nexusphp', 'unit3d'])
  const builtInManagedPtSiteIds = new Set(['acgnx_a', 'acgnx_g'])

  function readOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  function readPositiveInteger(value: unknown, fallback: number) {
    const nextValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return fallback
    }

    return Math.floor(nextValue)
  }

  function normalizeBatchEntries(value: unknown) {
    if (!Array.isArray(value)) {
      return [] as SitePublishBatchEntry[]
    }

    return value.reduce<SitePublishBatchEntry[]>((entries, item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return entries
      }

      const raw = item as Record<string, unknown>
      entries.push({
        id: readOptionalString(raw.id) ?? `batch-entry-${index + 1}`,
        name: readOptionalString(raw.name) ?? `Torrent ${index + 1}`,
        torrentPath: typeof raw.torrentPath === 'string' ? raw.torrentPath.trim() : '',
        title: typeof raw.title === 'string' ? raw.title : '',
      })
      return entries
    }, [])
  }

  function readProjectPublishContext(projectId?: number) {
    if (!projectId) {
      return undefined
    }

    const task = projectStore.findLegacyTaskById(projectId)
    if (!task) {
      return undefined
    }

    const configPath = join(task.path, 'config.json')
    if (!fs.existsSync(configPath)) {
      return undefined
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf-8' })) as Config.PublishConfig
      const htmlPath = join(task.path, 'bangumi.html')
      const defaultDescription = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, { encoding: 'utf-8' })
        : undefined

      return {
        task,
        config,
        defaultDescription,
      }
    } catch {
      return undefined
    }
  }

  function resolveBatchEntryOverride(
    overrides: SitePublishBatchEntry[],
    entry: {
      id: string
      name: string
      path: string
    },
  ) {
    return (
      overrides.find(item => item.id === entry.id) ??
      overrides.find(item => item.torrentPath === entry.path) ??
      overrides.find(item => item.name === entry.name)
    )
  }

  function buildBatchPublishInputs(input: Record<string, unknown>) {
    const projectId = typeof input.projectId === 'number' && input.projectId > 0 ? input.projectId : undefined
    const context = readProjectPublishContext(projectId)
    if (!context) {
      return []
    }

    const selectedEntries = getSelectedPublishTorrentEntries(context.config)
    if (selectedEntries.length <= 1) {
      return []
    }

    const rawContent = context.config.content
    const isEpisodeContent = Boolean(rawContent && typeof rawContent === 'object' && 'episodeLabel' in rawContent)
    if (!isEpisodeContent) {
      return []
    }

    const overrides = normalizeBatchEntries(input.batchEntries)
    const inputDescription = typeof input.description === 'string' ? input.description : ''
    const activeEntry = getActivePublishTorrentEntry(context.config)
    const activeDerivedDescription =
      activeEntry ? buildEpisodeDerivedContent(applyPublishTorrentEntry(context.config, activeEntry), activeEntry.bodyOverride).html : ''
    const shouldReuseSharedDescription =
      inputDescription.trim() !== '' &&
      inputDescription.trim() !== activeDerivedDescription.trim()

    return selectedEntries.map(entry => {
      const override = resolveBatchEntryOverride(overrides, entry)
      const nextEntry = {
        ...entry,
        titleOverride: override ? override.title : entry.titleOverride,
      }
      const nextConfig = applyPublishTorrentEntry(context.config, nextEntry)
      const resolvedTitle = override ? override.title.trim() : readOptionalString(nextConfig.title) ?? ''
      nextConfig.title = resolvedTitle

      return {
        entryId: entry.id,
        entryName: entry.name,
        payload: {
          ...input,
          title: resolvedTitle,
          torrentPath: override?.torrentPath.trim() || entry.path,
          description: shouldReuseSharedDescription
            ? inputDescription
            : buildEpisodeDerivedContent(nextConfig, nextEntry.bodyOverride).html,
        } as Record<string, unknown>,
      }
    })
  }

  function stripBatchEntries(payload: Record<string, unknown>) {
    const { batchEntries, ...nextPayload } = payload
    void batchEntries
    return nextPayload
  }

  function summarizeBatchPublishMessage(siteName: string, total: number, publishedCount: number) {
    if (publishedCount === total) {
      return `Published ${publishedCount} torrents to ${siteName}`
    }

    if (publishedCount === 0) {
      return `Failed to publish ${total} torrents to ${siteName}`
    }

    return `Published ${publishedCount} of ${total} torrents to ${siteName}`
  }

  function hasConfiguredCredentials(siteId: SiteId) {
    try {
      const credentials = credentialStore.getSiteCredentialRecord(siteId)
      return Boolean(
        credentials.apiToken?.trim() ||
          credentials.username?.trim() ||
          credentials.password?.trim() ||
          credentials.cookies?.length,
      )
    } catch {
      return false
    }
  }

  function enrichSiteCatalogEntry(site: SiteCatalogEntry): SiteCatalogEntry {
    try {
      const account = credentialStore.getSiteAccount(site.id)
      return {
        ...site,
        accountAuthMode: account.authMode,
        accountStatus: account.healthStatus,
        accountMessage: account.legacyStatus,
        lastCheckAt: account.lastCheckAt,
        accountConfigured:
          hasConfiguredCredentials(site.id) ||
          ['authenticated', 'blocked', 'error', 'disabled'].includes(account.healthStatus),
      }
    } catch {
      return site
    }
  }

  function getSiteContext(id: SiteId) {
    const profile = siteRegistry.getProfileById(id)
    if (!profile) {
      throw new Error(`Site ${id} does not exist`)
    }

    const adapter = siteRegistry.getAdapter(profile.adapter)
    if (!adapter) {
      throw new Error(`Adapter ${profile.adapter} is not registered`)
    }

    return {
      profile,
      adapter,
      account: credentialStore.getSiteAccount(id),
      credentials: credentialStore.getSiteCredentialRecord(id),
    }
  }

  function listManagedPtSites() {
    try {
      const sites = siteRegistry
        .listCatalog()
        .filter(site => ptAdapters.has(site.adapter))
        .filter(site => Boolean(credentialStore.getCustomPtSite(site.id)))
        .map(site => {
          const account = credentialStore.getSiteAccount(site.id)
          const credentials = credentialStore.getSiteCredentialRecord(site.id)
          return {
            ...site,
            builtIn: builtInManagedPtSiteIds.has(site.id),
            accountAuthMode: account.authMode,
            accountStatus: account.healthStatus,
            accountMessage: account.legacyStatus,
            lastCheckAt: account.lastCheckAt,
            apiUid: credentials.apiUid,
            username: credentials.username,
            password: credentials.password,
            apiToken: credentials.apiToken,
          }
        })

      return JSON.stringify(ok({ sites }))
    } catch (error) {
      return JSON.stringify(
        fail('PT_SITE_LIST_FAILED', 'Unable to load PT site accounts', (error as Error).message),
      )
    }
  }

  function listSites() {
    try {
      return JSON.stringify(ok({ sites: siteRegistry.listCatalog().map(enrichSiteCatalogEntry) }))
    } catch (error) {
      return JSON.stringify(
        fail('SITE_LIST_FAILED', 'Unable to load site catalog', (error as Error).message),
      )
    }
  }

  function getSite(msg: string) {
    try {
      const { id } = JSON.parse(msg) as { id: SiteId }
      const site = siteRegistry.getCatalogEntry(id)
      if (!site) {
        return JSON.stringify(fail('SITE_NOT_FOUND', `Site ${id} does not exist`))
      }
      return JSON.stringify(ok({ site: enrichSiteCatalogEntry(site) }))
    } catch (error) {
      return JSON.stringify(fail('SITE_READ_FAILED', 'Unable to read site information', (error as Error).message))
    }
  }

  async function loadMetadata(msg: string) {
    try {
      const { id } = JSON.parse(msg) as { id: SiteId }
      const { profile, adapter, account, credentials } = getSiteContext(id)
      if (!adapter.loadMetadata) {
        return JSON.stringify(
          fail('SITE_METADATA_UNSUPPORTED', `${profile.name} does not support metadata loading yet`),
        )
      }

      const metadata = await adapter.loadMetadata({
        profile,
        account,
        credentials,
      })

      return JSON.stringify(ok({ siteId: id, metadata }))
    } catch (error) {
      return JSON.stringify(
        fail('SITE_METADATA_FAILED', 'Unable to load site metadata', (error as Error).message),
      )
    }
  }

  async function searchBangumiSubjects(msg: string) {
    try {
      const { query, limit } = JSON.parse(msg) as { query?: string; limit?: number }
      const normalizedQuery = readOptionalString(query)
      if (!normalizedQuery) {
        return JSON.stringify(fail('BANGUMI_SEARCH_QUERY_REQUIRED', 'Please provide a Bangumi search keyword'))
      }

      const normalizedLimit = Math.min(readPositiveInteger(limit, 8), 12)
      const response = await axios.post(
        `https://api.bgm.tv/v0/search/subjects?limit=${normalizedLimit}&offset=0`,
        {
          keyword: normalizedQuery,
          sort: 'match',
          filter: {
            type: [2],
          },
        },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      )

      if (response.status < 200 || response.status >= 300) {
        return JSON.stringify(
          fail(
            'BANGUMI_SEARCH_FAILED',
            'Unable to search Bangumi subjects',
            typeof response.data === 'string' ? response.data : `HTTP ${response.status}`,
          ),
        )
      }

      const payload =
        response.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>) : {}
      const items = Array.isArray(payload.data)
        ? payload.data.reduce<BangumiSubjectSearchItem[]>((subjects, item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return subjects
            }

            const raw = item as Record<string, unknown>
            const id = typeof raw.id === 'number' ? raw.id : typeof raw.id === 'string' ? Number(raw.id) : NaN
            const name = readOptionalString(raw.name)
            if (!Number.isFinite(id) || !name) {
              return subjects
            }

            const images =
              raw.images && typeof raw.images === 'object' && !Array.isArray(raw.images)
                ? {
                    small: readOptionalString((raw.images as Record<string, unknown>).small),
                    grid: readOptionalString((raw.images as Record<string, unknown>).grid),
                    medium: readOptionalString((raw.images as Record<string, unknown>).medium),
                    large: readOptionalString((raw.images as Record<string, unknown>).large),
                    common: readOptionalString((raw.images as Record<string, unknown>).common),
                  }
                : undefined

            subjects.push({
              id,
              name,
              nameCn: readOptionalString(raw.name_cn),
              summary: readOptionalString(raw.summary),
              airDate: readOptionalString(raw.date),
              rank: readPositiveInteger(raw.rank, 0) || undefined,
              score:
                typeof raw.score === 'number'
                  ? raw.score
                  : typeof raw.score === 'string' && Number.isFinite(Number(raw.score))
                    ? Number(raw.score)
                    : undefined,
              url: readOptionalString(raw.url),
              images,
            })
            return subjects
          }, [])
        : []

      return JSON.stringify(ok({ query: normalizedQuery, items }))
    } catch (error) {
      return JSON.stringify(
        fail('BANGUMI_SEARCH_FAILED', 'Unable to search Bangumi subjects', (error as Error).message),
      )
    }
  }

  async function validateAccount(msg: string) {
    try {
      const { id } = JSON.parse(msg) as { id: SiteId }
      const { profile, adapter, account, credentials } = getSiteContext(id)
      if (!adapter.validateAccount) {
        return JSON.stringify(
          fail('SITE_ACCOUNT_VALIDATE_UNSUPPORTED', `${profile.name} does not support account validation yet`),
        )
      }

      const result = await adapter.validateAccount({
        profile,
        account,
        credentials,
      })

      const persistedStatus =
        result.status === 'authenticated'
          ? 'authenticated'
          : result.status === 'unauthenticated'
            ? 'unauthenticated'
            : result.status === 'blocked'
              ? 'blocked'
              : 'error'

      if (credentialStore.getCustomPtSite(id)) {
        await credentialStore.recordCustomPtSiteValidation(
          id,
          persistedStatus,
          result.message,
        )
      }

      if (id === 'forum') {
        await credentialStore.recordForumValidation(persistedStatus, result.message)
      }

      return JSON.stringify(
        ok({
          siteId: id,
          status: result.status === 'authenticated' ? 'authenticated' : result.status === 'unauthenticated' ? 'unauthenticated' : 'error',
          message: result.message,
        }),
      )
    } catch (error) {
      return JSON.stringify(
        fail('SITE_ACCOUNT_VALIDATE_FAILED', 'Unable to validate site account', (error as Error).message),
      )
    }
  }

  async function validatePublish(msg: string) {
    try {
      const input = JSON.parse(msg) as { siteId: SiteId } & Record<string, unknown>
      const { siteId } = input
      const { profile, adapter } = getSiteContext(siteId)
      if (!adapter.validatePublish) {
        return JSON.stringify(
          fail('SITE_PUBLISH_VALIDATE_UNSUPPORTED', `${profile.name} does not support publish validation yet`),
        )
      }

      const batchInputs = buildBatchPublishInputs(input)
      if (batchInputs.length > 0) {
        const issueGroups = await Promise.all(
          batchInputs.map(entry =>
            adapter.validatePublish!({
              profile,
              payload: stripBatchEntries(entry.payload),
            }),
          ),
        )
        const issues = issueGroups.flatMap((group, index) =>
          group.map(issue => ({
            ...issue,
            field: `batchEntries.${batchInputs[index].entryId}.${issue.field}`,
            message: `[${batchInputs[index].entryName}] ${issue.message}`,
          })),
        )

        return JSON.stringify(
          ok({
            siteId,
            valid: issues.every(issue => issue.severity !== 'error'),
            issues,
          }),
        )
      }

      const issues = await adapter.validatePublish({
        profile,
        payload: stripBatchEntries(input),
      })

      return JSON.stringify(
        ok({
          siteId,
          valid: issues.every(issue => issue.severity !== 'error'),
          issues,
        }),
      )
    } catch (error) {
      return JSON.stringify(
        fail('SITE_PUBLISH_VALIDATE_FAILED', 'Unable to validate publish input', (error as Error).message),
      )
    }
  }

  async function publish(msg: string) {
    let siteId: SiteId | undefined
    let projectId: number | undefined

    try {
      const input = JSON.parse(msg) as { siteId: SiteId } & Record<string, unknown>
      siteId = input.siteId
      projectId = typeof input.projectId === 'number' && input.projectId > 0 ? input.projectId : undefined
      const { profile, adapter, account, credentials } = getSiteContext(siteId)
      if (!adapter.publish) {
        return JSON.stringify(
          fail('SITE_PUBLISH_UNSUPPORTED', `${profile.name} does not support adapter publishing yet`),
        )
      }

      const batchInputs = buildBatchPublishInputs(input)
      if (batchInputs.length > 0) {
        const batchResults: PublishResult[] = []
        const rawResponse: Array<{
          entryId: string
          entryName: string
          status: string
          remoteId?: string
          remoteUrl?: string
          message?: string
          rawResponse?: unknown
        }> = []

        for (const entry of batchInputs) {
          try {
            const { result, raw } = await adapter.publish({
              profile,
              projectId: typeof input.projectId === 'number' ? input.projectId : 0,
              payload: stripBatchEntries(entry.payload),
              account,
              credentials,
            })

            const entryResult: PublishResult = {
              ...result,
              message: `[${entry.entryName}] ${result.message ?? 'Published'}`,
              rawResponse: raw ?? result.rawResponse,
              timestamp: result.timestamp ?? new Date().toISOString(),
            }

            batchResults.push(entryResult)
            rawResponse.push({
              entryId: entry.entryId,
              entryName: entry.entryName,
              status: entryResult.status,
              remoteId: entryResult.remoteId,
              remoteUrl: entryResult.remoteUrl,
              message: entryResult.message,
              rawResponse: entryResult.rawResponse,
            })
          } catch (error) {
            const entryError = (error as Error).message
            const failedResult: PublishResult = {
              siteId,
              status: 'failed',
              message: `[${entry.entryName}] ${entryError}`,
              timestamp: new Date().toISOString(),
            }

            batchResults.push(failedResult)
            rawResponse.push({
              entryId: entry.entryId,
              entryName: entry.entryName,
              status: 'failed',
              message: entryError,
            })
          }
        }

        if (projectId) {
          batchResults.forEach(result => projectStore.recordPublishResult(projectId!, result))
          await projectStore.write()
          notifyProjectDataChanged?.()
        }

        const publishedResults = batchResults.filter(result => result.status === 'published')
        const aggregateResult: PublishResult = {
          siteId,
          status: publishedResults.length === batchResults.length ? 'published' : 'failed',
          remoteId: publishedResults.length === 1 ? publishedResults[0].remoteId : undefined,
          remoteUrl: publishedResults.length === 1 ? publishedResults[0].remoteUrl : undefined,
          message: summarizeBatchPublishMessage(profile.name, batchResults.length, publishedResults.length),
          rawResponse,
          timestamp: new Date().toISOString(),
        }

        return JSON.stringify(ok({ result: aggregateResult }))
      }

      const { result } = await adapter.publish({
        profile,
        projectId: typeof input.projectId === 'number' ? input.projectId : 0,
        payload: stripBatchEntries(input),
        account,
        credentials,
      })

      if (projectId) {
        projectStore.recordPublishResult(projectId, result)
        await projectStore.write()
        notifyProjectDataChanged?.()
      }

      return JSON.stringify(ok({ result }))
    } catch (error) {
      if (projectId && siteId) {
        projectStore.recordPublishResult(projectId, {
          siteId,
          status: 'failed',
          message: (error as Error).message,
          timestamp: new Date().toISOString(),
        })
        await projectStore.write()
        notifyProjectDataChanged?.()
      }

      return JSON.stringify(
        fail('SITE_PUBLISH_FAILED', 'Unable to publish through site adapter', (error as Error).message),
      )
    }
  }

  async function saveManagedPtSite(msg: string) {
    try {
      const draft = JSON.parse(msg) as PtSiteDraft
      const siteId = await credentialStore.saveManagedPtSite(draft)
      const site = siteRegistry.getCatalogEntry(siteId)
      if (!site) {
        return JSON.stringify(fail('PT_SITE_NOT_FOUND', `PT site ${siteId} does not exist`))
      }

      const account = credentialStore.getSiteAccount(siteId)
      const credentials = credentialStore.getSiteCredentialRecord(siteId)

      return JSON.stringify(
        ok({
          site: {
            ...site,
            builtIn: builtInManagedPtSiteIds.has(site.id),
            accountAuthMode: account.authMode,
            accountStatus: account.healthStatus,
            accountMessage: account.legacyStatus,
            lastCheckAt: account.lastCheckAt,
            apiUid: credentials.apiUid,
            username: credentials.username,
            password: credentials.password,
            apiToken: credentials.apiToken,
          },
        }),
      )
    } catch (error) {
      return JSON.stringify(
        fail('PT_SITE_SAVE_FAILED', 'Unable to save PT site account', (error as Error).message),
      )
    }
  }

  async function removeManagedPtSite(msg: string) {
    try {
      const { id } = JSON.parse(msg) as { id: SiteId }
      await credentialStore.removeManagedPtSite(id)
      return JSON.stringify(ok({ id }))
    } catch (error) {
      return JSON.stringify(
        fail('PT_SITE_REMOVE_FAILED', 'Unable to remove PT site account', (error as Error).message),
      )
    }
  }

  return {
    listSites,
    listManagedPtSites,
    getSite,
    saveManagedPtSite,
    removeManagedPtSite,
    validateAccount,
    validatePublish,
    loadMetadata,
    searchBangumiSubjects,
    publish,
  }
}
