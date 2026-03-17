import type { AccountHealthStatus } from '../types/account'

export type LegacyAccountStatus =
  | 'disabled'
  | 'loggedIn'
  | 'loggedOut'
  | 'blocked'
  | 'failed'
  | 'loggingIn'
  | 'passwordError'
  | 'captchaError'
  | 'validationFailed'
  | 'unknown'

const orderedStatusVariants: Array<[Exclude<LegacyAccountStatus, 'unknown'>, string[]]> = [
  ['disabled', ['账号已禁用', '璐︽埛宸茬鐢?']],
  ['passwordError', ['账号密码错误', '璐﹀彿瀵嗙爜閿欒']],
  ['captchaError', ['验证码错误', '楠岃瘉鐮侀敊璇?', '妤犲矁鐦夐惍渚€鏁婄拠?']],
  ['validationFailed', ['验证未通过', '楠岃瘉鏈€氳繃', '妤犲矁鐦夐張顏堚偓姘崇箖']],
  ['blocked', ['防火墙阻止', '闃茬伀澧欓樆姝?']],
  ['loggingIn', ['正在登录', '姝ｅ湪鐧诲綍']],
  [
    'loggedIn',
    [
      '账号已登录',
      '璐﹀彿宸茬櫥褰?',
      'API credentials configured',
      '已配置 API 凭据',
      'API token configured',
      '已配置 API Token',
    ],
  ],
  [
    'loggedOut',
    [
      '账号未登录',
      '璐﹀彿鏈櫥褰?',
      'API credentials missing',
      '缺少 API 凭据',
      'API token missing',
      '缺少 API Token',
    ],
  ],
  ['failed', ['访问失败', '璁块棶澶辫触', 'API credentials rejected', 'API 凭据无效', 'API token rejected', 'API Token 无效', '错误', '閿欒']],
]

function matchesAnyVariant(status: string, variants: string[]) {
  return variants.some(variant => status.includes(variant))
}

export function normalizeLegacyAccountStatus(status: string | undefined | null, enabled: boolean): LegacyAccountStatus {
  if (!enabled) {
    return 'disabled'
  }

  const currentStatus = status?.trim() ?? ''
  if (!currentStatus) {
    return 'unknown'
  }

  for (const [normalized, variants] of orderedStatusVariants) {
    if (matchesAnyVariant(currentStatus, variants)) {
      return normalized
    }
  }

  return 'unknown'
}

export function resolveLegacyAccountHealthStatus(
  status: string | undefined | null,
  enabled: boolean,
): AccountHealthStatus {
  switch (normalizeLegacyAccountStatus(status, enabled)) {
    case 'disabled':
      return 'disabled'
    case 'loggingIn':
      return 'checking'
    case 'loggedIn':
      return 'authenticated'
    case 'loggedOut':
      return 'unauthenticated'
    case 'blocked':
      return 'blocked'
    case 'failed':
    case 'passwordError':
    case 'captchaError':
    case 'validationFailed':
      return 'error'
    case 'unknown':
    default:
      return 'unknown'
  }
}
