import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import type { SiteCredentialRecord } from '../../../shared/types/account'
import type { SiteProfile } from '../../../shared/types/site'
import { deriveNexusApiBase, joinNexusEndpoint, normalizeNexusSiteBase } from './mapper'

type NexusAuthMode = 'api_token' | 'username_password' | 'cookie'

export interface NexusResolvedAuth {
  siteBaseUrl: string
  apiBaseUrl: string
  authMode: NexusAuthMode
  headers: Record<string, string>
}

export function getPreferredNexusAuthModes(profile: SiteProfile): NexusAuthMode[] {
  const modes: NexusAuthMode[] = []

  if (profile.capabilities.includes('token_auth')) {
    modes.push('api_token')
  }

  if (profile.capabilities.includes('username_password_auth')) {
    modes.push('username_password')
  }

  if (profile.capabilities.includes('cookie_auth')) {
    modes.push('cookie')
  }

  return modes
}

function trimForError(input: string): string {
  const normalized = input.trim()
  if (normalized.length <= 240) {
    return normalized
  }
  return `${normalized.slice(0, 237)}...`
}

function stringifyBody(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function readContentType(response: AxiosResponse): string {
  const contentType = response.headers['content-type']
  return Array.isArray(contentType) ? contentType.join('; ') : contentType || ''
}

function readSetCookieHeader(response: AxiosResponse): string | undefined {
  const setCookie = response.headers['set-cookie']
  if (!setCookie) {
    return undefined
  }

  const cookiePairs = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map(entry => entry.split(';', 1)[0]?.trim())
    .filter(Boolean)

  return cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function findTokenCandidate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findTokenCandidate(item)
      if (token) {
        return token
      }
    }
    return undefined
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase()
      if (
        ['token', 'api_token', 'apitoken', 'access_token', 'accesstoken'].includes(normalizedKey) &&
        typeof nestedValue === 'string' &&
        nestedValue.trim() !== ''
      ) {
        return nestedValue.trim()
      }
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const token = findTokenCandidate(nestedValue)
      if (token) {
        return token
      }
    }
  }

  return undefined
}

function buildStoredCookieHeader(credentials?: SiteCredentialRecord): string | undefined {
  const cookiePairs = credentials?.cookies
    ?.filter(cookie => cookie.name && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)

  return cookiePairs && cookiePairs.length > 0 ? cookiePairs.join('; ') : undefined
}

function buildBaseHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    ...headers,
  }
}

export function createNexusHttpClient(): AxiosInstance {
  return axios.create({
    maxRedirects: 0,
    validateStatus: () => true,
  })
}

async function tryApiLogin(
  client: AxiosInstance,
  siteBaseUrl: string,
  apiBaseUrl: string,
  username: string,
  password: string,
): Promise<NexusResolvedAuth | undefined> {
  const response = await client.post(
    joinNexusEndpoint(apiBaseUrl, 'login'),
    { username, password },
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
  )

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`API login HTTP ${response.status}: ${trimForError(stringifyBody(response.data))}`)
  }

  if (!readContentType(response).includes('application/json')) {
    throw new Error(`API login did not return JSON: ${trimForError(stringifyBody(response.data))}`)
  }

  const payload = response.data as Record<string, unknown>
  if (typeof payload.ret === 'number' && payload.ret !== 0) {
    const message =
      (typeof payload.msg === 'string' && payload.msg) ||
      (typeof payload.message === 'string' && payload.message) ||
      'Login failed'
    throw new Error(`API login rejected with ret=${payload.ret}: ${message}`)
  }

  const apiToken = findTokenCandidate(payload)
  if (apiToken) {
    return {
      siteBaseUrl,
      apiBaseUrl,
      authMode: 'api_token',
      headers: buildBaseHeaders({
        Authorization: `Bearer ${apiToken}`,
      }),
    }
  }

  const cookieHeader = readSetCookieHeader(response)
  if (cookieHeader) {
    return {
      siteBaseUrl,
      apiBaseUrl,
      authMode: 'cookie',
      headers: buildBaseHeaders({
        Cookie: cookieHeader,
      }),
    }
  }

  return undefined
}

async function tryClassicFormLogin(
  client: AxiosInstance,
  siteBaseUrl: string,
  apiBaseUrl: string,
  username: string,
  password: string,
): Promise<NexusResolvedAuth> {
  const errors: string[] = []
  const body = new URLSearchParams({
    username,
    password,
    returnto: '/',
    rememberme: 'on',
    securelogin: 'yes',
  }).toString()

  for (const path of ['takelogin.php', 'login.php', 'login']) {
    try {
      const response = await client.post(joinNexusEndpoint(siteBaseUrl, path), body, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      const cookieHeader = readSetCookieHeader(response)
      if (response.status >= 200 && response.status < 400 && cookieHeader) {
        return {
          siteBaseUrl,
          apiBaseUrl,
          authMode: 'cookie',
          headers: buildBaseHeaders({
            Cookie: cookieHeader,
          }),
        }
      }

      errors.push(`${path} returned HTTP ${response.status}`)
    } catch (error) {
      errors.push(`${path} request failed: ${(error as Error).message}`)
    }
  }

  throw new Error(errors.join(' | '))
}

export async function resolveNexusAuth(
  profile: SiteProfile,
  credentials?: SiteCredentialRecord,
): Promise<NexusResolvedAuth> {
  const client = createNexusHttpClient()
  const siteBaseUrl = normalizeNexusSiteBase(profile.baseUrl)
  const apiBaseUrl = deriveNexusApiBase(siteBaseUrl)

  if (credentials?.apiToken?.trim()) {
    return {
      siteBaseUrl,
      apiBaseUrl,
      authMode: 'api_token',
      headers: buildBaseHeaders({
        Authorization: `Bearer ${credentials.apiToken.trim()}`,
      }),
    }
  }

  if (credentials?.username?.trim() && credentials?.password?.trim()) {
    try {
      const apiLogin = await tryApiLogin(
        client,
        siteBaseUrl,
        apiBaseUrl,
        credentials.username.trim(),
        credentials.password.trim(),
      )
      if (apiLogin) {
        return apiLogin
      }
    } catch (error) {
      try {
        return await tryClassicFormLogin(
          client,
          siteBaseUrl,
          apiBaseUrl,
          credentials.username.trim(),
          credentials.password.trim(),
        )
      } catch {
        throw error
      }
    }

    return tryClassicFormLogin(
      client,
      siteBaseUrl,
      apiBaseUrl,
      credentials.username.trim(),
      credentials.password.trim(),
    )
  }

  const cookieHeader = buildStoredCookieHeader(credentials)
  if (cookieHeader) {
    return {
      siteBaseUrl,
      apiBaseUrl,
      authMode: 'cookie',
      headers: buildBaseHeaders({
        Cookie: cookieHeader,
      }),
    }
  }

  throw new Error(`No supported credentials are available for ${profile.name}`)
}
