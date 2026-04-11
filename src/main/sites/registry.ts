import { defaultSiteProfiles } from '../../shared/types/site'
import type { SiteAdapterKind, SiteCatalogEntry, SiteId, SiteProfile } from '../../shared/types/site'
import type { SiteAdapter } from './adapter'
import { createAcgnxAdapter } from './acgnx/adapter'
import { createAcgripAdapter } from './acgrip/adapter'
import { createAnibtAdapter } from './anibt/adapter'
import { createBangumiAdapter } from './bangumi/adapter'
import { createDmhyAdapter } from './dmhy/adapter'
import { createMikanAdapter } from './mikan/adapter'
import { createMiobtAdapter } from './miobt/adapter'
import { createNexusphpAdapter } from './nexusphp/adapter'
import { createNyaaAdapter } from './nyaa/adapter'
import { createUnit3dAdapter } from './unit3d/adapter'
import { createWordpressAdapter } from './wordpress/adapter'

interface CreateSiteRegistryOptions {
  getCustomProfiles?: () => SiteProfile[]
}

export function createSiteRegistry(options: CreateSiteRegistryOptions = {}) {
  const { getCustomProfiles } = options
  const adapters: SiteAdapter[] = [
    createAcgnxAdapter(),
    createBangumiAdapter(),
    createMikanAdapter(),
    createAnibtAdapter(),
    createMiobtAdapter(),
    createAcgripAdapter(),
    createDmhyAdapter(),
    createNyaaAdapter(),
    createNexusphpAdapter(),
    createUnit3dAdapter(),
    createWordpressAdapter(),
  ]

  const adapterMap = new Map<SiteAdapterKind, SiteAdapter>(adapters.map(adapter => [adapter.id, adapter]))

  function listProfiles(): SiteProfile[] {
    const profiles = [...defaultSiteProfiles, ...(getCustomProfiles?.() ?? [])]

    return profiles.map(profile => ({
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
