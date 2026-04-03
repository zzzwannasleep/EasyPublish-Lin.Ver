import axios from 'axios'
import { buildSiteCapabilitySet } from '../../../shared/types/site'
import type { SiteCatalogEntry, SiteProfile } from '../../../shared/types/site'
import type { SiteAdapter } from '../adapter'

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

function describeProfile(profile: SiteProfile): SiteCatalogEntry {
  return {
    id: profile.id,
    name: profile.name,
    adapter: profile.adapter,
    enabled: profile.enabled ?? true,
    baseUrl: profile.baseUrl,
    normalizedBaseUrl: normalizeBaseUrl(profile.baseUrl),
    capabilities: [...profile.capabilities],
    capabilitySet: buildSiteCapabilitySet(profile.capabilities),
    notes: ['Main-site account validation now goes through the WordPress adapter before related fields are exposed.'],
    customFieldMap: profile.customFieldMap,
  }
}

export function createWordpressAdapter(): SiteAdapter {
  return {
    id: 'wordpress',
    displayName: 'WordPress',
    capabilitySet: buildSiteCapabilitySet(['article_publish', 'cookie_auth', 'username_password_auth']),
    supports(profile) {
      return profile.adapter === 'wordpress'
    },
    describe(profile) {
      return describeProfile(profile)
    },
    async validateAccount({ profile, credentials }) {
      const username = credentials?.username?.trim() ?? ''
      const password = credentials?.password ?? ''
      const hasCookies = Boolean(credentials?.cookies?.length)
      if ((!username || !password) && !hasCookies) {
        return {
          status: 'unauthenticated',
          message: '主站账号未配置或尚未登录。',
        }
      }

      const response = await axios.get(`${normalizeBaseUrl(profile.baseUrl)}/wp-json/wp/v2/users/me?context=edit`, {
        responseType: 'json',
        validateStatus: () => true,
      })

      if (response.status === 200) {
        const accountName =
          typeof response.data?.name === 'string' && response.data.name.trim() ? response.data.name.trim() : username
        return {
          status: 'authenticated',
          message: accountName ? `主站账号已验证：${accountName}` : '主站账号已通过验证。',
          raw: response.data,
        }
      }

      if (response.status === 401) {
        return {
          status: 'unauthenticated',
          message: '主站账号或应用程序密码无效。',
          raw: response.data,
        }
      }

      if (response.status === 403) {
        return {
          status: 'blocked',
          message: '主站接口拒绝了当前账号请求。',
          raw: response.data,
        }
      }

      return {
        status: 'error',
        message: `主站账号检测失败，接口返回 ${response.status}`,
        raw: response.data,
      }
    },
  }
}
