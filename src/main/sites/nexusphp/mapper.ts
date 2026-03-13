import type { SiteSection } from '../../../shared/types/site'

export function normalizeNexusSiteBase(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Site base URL is required')
  }

  const url = new URL(trimmed)
  const currentPath = url.pathname.replace(/\/+$/, '')

  let normalizedPath = '/'
  if (currentPath && currentPath !== '/') {
    const apiIndex = currentPath.indexOf('/api/v1')
    normalizedPath = apiIndex >= 0 ? currentPath.slice(0, apiIndex) || '/' : currentPath
  }

  url.pathname = normalizedPath
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

export function deriveNexusApiBase(siteBase: string): string {
  const url = new URL(siteBase)
  const currentPath = url.pathname.replace(/\/+$/, '')

  if (!currentPath || currentPath === '/') {
    url.pathname = '/api/v1'
  } else if (!currentPath.endsWith('/api/v1')) {
    url.pathname = `${currentPath}/api/v1`
  }

  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

export function joinNexusEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function getNexusSectionLabel(section: Pick<SiteSection, 'name' | 'displayName'>): string {
  return section.displayName?.trim() || section.name
}

export function sortNexusSections(sections: SiteSection[]): SiteSection[] {
  return [...sections].sort((left, right) =>
    getNexusSectionLabel(left).toLowerCase().localeCompare(getNexusSectionLabel(right).toLowerCase()),
  )
}
