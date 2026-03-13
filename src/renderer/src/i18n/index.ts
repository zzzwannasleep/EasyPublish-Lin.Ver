import { computed, ref } from 'vue'
import enUS from '../locales/en-US'
import zhCN from '../locales/zh-CN'

export type LocaleCode = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'nexus-publish-locale'
const DEFAULT_LOCALE: LocaleCode = 'zh-CN'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const

const locale = ref<LocaleCode>(readInitialLocale())

export const localeOptions = [
  { value: 'zh-CN', label: zhCN['common.lang.zh-CN'] },
  { value: 'en-US', label: enUS['common.lang.en-US'] },
] as const

function readInitialLocale(): LocaleCode {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh-CN' || stored === 'en-US') {
    return stored
  }

  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function setLocale(nextLocale: LocaleCode) {
  locale.value = nextLocale
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, nextLocale)
  }
}

export function getCurrentLocale(): LocaleCode {
  return locale.value
}

export function translate(
  key: string,
  params?: Record<string, string | number | undefined>,
) {
  const currentTable = messages[locale.value]
  const fallbackTable = messages[DEFAULT_LOCALE]
  let text = currentTable[key] ?? fallbackTable[key] ?? key

  if (!params) {
    return text
  }

  return text.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? `{${token}}`))
}

export function useI18n() {
  return {
    locale: computed(() => locale.value),
    localeOptions,
    setLocale,
    t: translate,
  }
}
