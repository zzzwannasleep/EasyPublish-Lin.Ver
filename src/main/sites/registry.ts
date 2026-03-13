import { buildSiteCapabilitySet, defaultSiteProfiles } from '../../shared/types/site'
import type { SiteAdapterKind, SiteCatalogEntry, SiteId, SiteProfile } from '../../shared/types/site'
import type { SiteAdapter } from './adapter'
import { createNexusphpAdapter } from './nexusphp/adapter'

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

function createStaticAdapter(
  id: Exclude<SiteAdapterKind, 'nexusphp'>,
  displayName: string,
  note: string,
): SiteAdapter {
  return {
    id,
    displayName,
    capabilitySet: buildSiteCapabilitySet([]),
    supports(profile) {
      return profile.adapter === id
    },
    describe(profile) {
      return {
        id: profile.id,
        name: profile.name,
        adapter: profile.adapter,
        enabled: profile.enabled ?? true,
        baseUrl: profile.baseUrl,
        normalizedBaseUrl: normalizeBaseUrl(profile.baseUrl),
        capabilities: [...profile.capabilities],
        capabilitySet: buildSiteCapabilitySet(profile.capabilities),
        notes: [note],
        customFieldMap: profile.customFieldMap,
      }
    },
  }
}

export function createSiteRegistry(siteProfiles: SiteProfile[] = defaultSiteProfiles) {
  const adapters: SiteAdapter[] = [
    createStaticAdapter('bangumi', 'Bangumi', 'Legacy Bangumi workflow remains bridged through the existing BT service.'),
    createStaticAdapter('nyaa', 'Nyaa', 'Legacy Nyaa workflow remains bridged through the existing BT service.'),
    createNexusphpAdapter(),
    createStaticAdapter('wordpress', 'WordPress', 'Forum publishing still routes through the legacy forum service for now.'),
  ]

  const adapterMap = new Map<SiteAdapterKind, SiteAdapter>(
    adapters.map(adapter => [adapter.id, adapter]),
  )

  function listProfiles(): SiteProfile[] {
    return siteProfiles.map(profile => ({
      ...profile,
      capabilities: [...profile.capabilities],
    }))
  }

  function getProfileById(id: SiteId): SiteProfile | undefined {
    return listProfiles().find(profile => profile.id === id)
  }

  function getAdapter(kind: SiteAdapterKind): SiteAdapter | undefined {
    return adapterMap.get(kind)
  }

  function describeProfile(profile: SiteProfile): SiteCatalogEntry {
    const adapter = getAdapter(profile.adapter)
    if (!adapter) {
      throw new Error(`Adapter ${profile.adapter} is not registered`)
    }

    return adapter.describe(profile)
  }

  function listCatalog(): SiteCatalogEntry[] {
    return listProfiles().map(describeProfile)
  }

  function getCatalogEntry(id: SiteId): SiteCatalogEntry | undefined {
    const profile = getProfileById(id)
    return profile ? describeProfile(profile) : undefined
  }

  return {
    listProfiles,
    getProfileById,
    getAdapter,
    listCatalog,
    getCatalogEntry,
  }
}
