export function normalizeUnit3dSiteBase(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Site base URL is required')
  }

  const url = new URL(trimmed)
  const currentPath = url.pathname.replace(/\/+$/, '')
  const apiIndex = currentPath.indexOf('/api')
  const normalizedPath = apiIndex >= 0 ? currentPath.slice(0, apiIndex) || '/' : currentPath || '/'

  url.pathname = normalizedPath
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

export function deriveUnit3dApiBase(siteBase: string): string {
  const url = new URL(siteBase)
  const currentPath = url.pathname.replace(/\/+$/, '')
  url.pathname = currentPath && currentPath !== '/' ? `${currentPath}/api` : '/api'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function joinUnit3dEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
