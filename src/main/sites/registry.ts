import { buildSiteCapabilitySet, defaultSiteProfiles } from '../../shared/types/site'
import type { SiteAdapterKind, SiteCatalogEntry, SiteFieldSchemaEntry, SiteId, SiteProfile } from '../../shared/types/site'
import type { SiteAdapter } from './adapter'
import { createAnibtAdapter } from './anibt/adapter'
import { createAcgripAdapter } from './acgrip/adapter'
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

const BANGUMI_FIELD_SCHEMAS: SiteFieldSchemaEntry[] = [
  {
    key: 'category_bangumi',
    labelKey: 'seriesWorkspace.profileEditor.siteFields.bangumiCategory',
    helpKey: 'seriesWorkspace.profileEditor.siteFields.bangumiHelp',
    control: 'select',
    mode: 'required',
    options: [
      { label: '合集', value: '54967e14ff43b99e284d0bf7' },
      { label: '剧场版', value: '549cc9369310bc7d04cddf9f' },
      { label: '动画', value: '549ef207fe682f7549f1ea90' },
      { label: '其他', value: '549ef250fe682f7549f1ea91' },
    ],
  },
]

function cloneSiteFieldSchemas(fieldSchemas: SiteFieldSchemaEntry[] = []): SiteFieldSchemaEntry[] {
  return fieldSchemas.map(field => ({
    ...field,
    options: field.options?.map(option => ({ ...option })),
  }))
}

function createStaticAdapter(
  id: Exclude<SiteAdapterKind, 'mikan' | 'anibt' | 'miobt' | 'acgrip' | 'dmhy' | 'nyaa' | 'nexusphp' | 'unit3d'>,
  displayName: string,
  note: string,
  fieldSchemas: SiteFieldSchemaEntry[] = [],
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
        fieldSchemas: cloneSiteFieldSchemas(fieldSchemas),
      }
    },
  }
}

export function createSiteRegistry(options: CreateSiteRegistryOptions = {}) {
  const { getCustomProfiles } = options
  const adapters: SiteAdapter[] = [
    createStaticAdapter(
      'bangumi',
      'Bangumi',
      'Legacy Bangumi workflow remains bridged through the existing BT service.',
      BANGUMI_FIELD_SCHEMAS,
    ),
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

  const adapterMap = new Map<SiteAdapterKind, SiteAdapter>(
    adapters.map(adapter => [adapter.id, adapter]),
  )

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
