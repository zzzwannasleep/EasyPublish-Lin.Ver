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

export const legacyAccountStatusText = {
  disabled: '账号已禁用',
  loggedIn: '账号已登录',
  loggedOut: '账号未登录',
  blocked: '防火墙阻止',
  failed: '访问失败',
  loggingIn: '正在登录',
  passwordError: '账号密码错误',
  captchaError: '验证码错误',
  validationFailed: '验证未通过',
} as const

export const legacyApiStatusText = {
  credentialsConfigured: 'API credentials configured',
  credentialsMissing: 'API credentials missing',
  credentialsRejected: 'API credentials rejected',
  tokenConfigured: 'API token configured',
  tokenMissing: 'API token missing',
  tokenRejected: 'API token rejected',
} as const

const orderedStatusVariants: Array<[Exclude<LegacyAccountStatus, 'unknown'>, string[]]> = [
  ['disabled', [legacyAccountStatusText.disabled, '鐠愶附鍩涘鑼洣閻?']],
  ['passwordError', [legacyAccountStatusText.passwordError, '鐠愶箑褰跨€靛棛鐖滈柨娆掝嚖']],
  ['captchaError', [legacyAccountStatusText.captchaError, '楠岃瘉鐮侀敊璇?', '妤犲矁鐦夐惍渚€鏁婄拠?']],
  ['validationFailed', [legacyAccountStatusText.validationFailed, '楠岃瘉鏈€氳繃', '妤犲矁鐦夐張顏堚偓姘崇箖']],
  ['blocked', [legacyAccountStatusText.blocked, '闃茬伀澧欓樆姝?', '闂冭尙浼€婢ф瑩妯嗗?']],
  ['loggingIn', [legacyAccountStatusText.loggingIn, '姝ｅ湪鐧诲綍', '濮濓絽婀惂璇茬秿']],
  [
    'loggedIn',
    [
      legacyAccountStatusText.loggedIn,
      '璐﹀彿宸茬櫥褰?',
      legacyApiStatusText.credentialsConfigured,
      '宸查厤缃?API 鍑嵁',
      legacyApiStatusText.tokenConfigured,
      '宸查厤缃?API Token',
    ],
  ],
  [
    'loggedOut',
    [
      legacyAccountStatusText.loggedOut,
      '璐﹀彿鏈櫥褰?',
      legacyApiStatusText.credentialsMissing,
      '缂哄皯 API 鍑嵁',
      legacyApiStatusText.tokenMissing,
      '缂哄皯 API Token',
    ],
  ],
  [
    'failed',
    [
      legacyAccountStatusText.failed,
      '璁块棶澶辫触',
      '鐠佸潡妫舵径杈Е',
      legacyApiStatusText.credentialsRejected,
      'API 鍑嵁鏃犳晥',
      legacyApiStatusText.tokenRejected,
      'API Token 鏃犳晥',
      '错误',
      '闁挎瑨顕?',
    ],
  ],
]

function matchesAnyVariant(status: string, variants: string[]) {
  return variants.some(variant => variant && status.includes(variant))
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
