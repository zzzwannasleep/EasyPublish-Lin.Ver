import fs from 'fs'
import { join } from 'path'
import { fail, ok } from '../../shared/types/api'
import type { PublishResult, SitePublishBatchEntry } from '../../shared/types/publish'
import type { PtSiteDraft } from '../../shared/types/pt-site'
import type { SiteCatalogEntry, SiteId } from '../../shared/types/site'
import { createSiteRegistry } from '../sites/registry'
import { createCredentialStore } from '../storage/credential-store'
import { createProjectStore } from '../storage/project-store'
import { applyPublishTorrentEntry, buildEpisodeDerivedContent, getSelectedPublishTorrentEntries } from './episode-publish-support'

interface CreateSiteServiceOptions {
  siteRegistry: ReturnType<typeof createSiteRegistry>
  credentialStore: ReturnType<typeof createCredentialStore>
  projectStore: ReturnType<typeof createProjectStore>
  notifyProjectDataChanged?: () => void
}

export function createSiteService(options: CreateSiteServiceOptions) {
  const { siteRegistry, credentialStore, projectStore, notifyProjectDataChanged } = options
  const ptAdapters = new Set(['nexusphp', 'unit3d'])

  function readOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
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
    const shouldUseDerivedDescription =
      typeof context.defaultDescription === 'string' && inputDescription.trim() === context.defaultDescription.trim()

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
          description: shouldUseDerivedDescription
            ? buildEpisodeDerivedContent(nextConfig, nextEntry.bodyOverride).html
            : inputDescription,
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
    if (!site.capabilitySet.publish.torrent) {
      return site
    }

    try {
      const account = credentialStore.getSiteAccount(site.id)
      return {
        ...site,
        accountAuthMode: account.authMode,
        accountStatus: account.healthStatus,
        accountMessage: account.legacyStatus,
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

    if (id === 'forum') {
      return {
        profile,
        adapter,
        account: undefined,
        credentials: undefined,
      }
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
            builtIn: false,
            accountAuthMode: account.authMode,
            accountStatus: account.healthStatus,
            accountMessage: account.legacyStatus,
            lastCheckAt: account.lastCheckAt,
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

      if (credentialStore.getCustomPtSite(id)) {
        await credentialStore.recordCustomPtSiteValidation(
          id,
          result.status === 'authenticated'
            ? 'authenticated'
            : result.status === 'unauthenticated'
              ? 'unauthenticated'
              : 'error',
          result.message,
        )
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
            builtIn: !credentialStore.getCustomPtSite(site.id),
            accountAuthMode: account.authMode,
            accountStatus: account.healthStatus,
            accountMessage: account.legacyStatus,
            lastCheckAt: account.lastCheckAt,
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
    publish,
  }
}
