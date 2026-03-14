import axios, { type AxiosInstance } from 'axios'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import type { SiteProfile } from '../../../shared/types/site'
import { deriveUnit3dApiBase, normalizeUnit3dSiteBase } from './mapper'

type Unit3dAuthMode = 'api_token'

export interface Unit3dResolvedAuth {
  siteBaseUrl: string
  apiBaseUrl: string
  authMode: Unit3dAuthMode
  apiToken: string
  params: Record<string, string>
  headers: Record<string, string>
}

export function getPreferredUnit3dAuthModes(profile: SiteProfile): Unit3dAuthMode[] {
  return profile.capabilities.includes('token_auth') ? ['api_token'] : []
}

export function createUnit3dHttpClient(): AxiosInstance {
  return axios.create({
    maxRedirects: 0,
    validateStatus: () => true,
  })
}

export async function resolveUnit3dAuth(
  profile: SiteProfile,
  credentials?: SiteCredentialRecord,
): Promise<Unit3dResolvedAuth> {
  const siteBaseUrl = normalizeUnit3dSiteBase(profile.baseUrl)
  const apiBaseUrl = deriveUnit3dApiBase(siteBaseUrl)
  const apiToken = credentials?.apiToken?.trim()

  if (!apiToken) {
    throw new Error(`UNIT3D requires an API token for ${profile.name}`)
  }

  return {
    siteBaseUrl,
    apiBaseUrl,
    authMode: 'api_token',
    apiToken,
    params: {
      api_token: apiToken,
    },
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
  }
}
