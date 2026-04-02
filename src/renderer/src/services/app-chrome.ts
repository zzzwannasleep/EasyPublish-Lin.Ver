import { inject, provide, proxyRefs, type ComputedRef, type InjectionKey, type Ref, type ShallowUnwrapRef } from 'vue'
import type { Component } from 'vue'
import type { LocaleCode } from '../i18n'
import type { ThemePaletteId } from '../theme/palette'

export type ChromeToolbarMenu = 'proxy' | 'theme' | 'language' | null

export type ChromeNavItem = {
  label: string
  caption: string
  to: string
  icon: Component
  matchPrefixes?: string[]
}

type ThemePaletteOption = {
  value: string
  label: string
  swatches: readonly string[]
}

type LocaleOption = {
  value: string
  label: string
}

export type ProxyFormState = {
  status: boolean
  type: string
  host: string
  port: number
}

export type AppChromeContext = {
  navItems: ComputedRef<ChromeNavItem[]>
  pageTitle: ComputedRef<string>
  pageSubtitle: ComputedRef<string>
  isDark: Ref<boolean>
  activeToolbarMenu: Ref<ChromeToolbarMenu>
  activeThemePalette: Ref<ThemePaletteId>
  themePaletteOptions: ComputedRef<ThemePaletteOption[]>
  sidebarExpanded: Ref<boolean>
  locale: Ref<LocaleCode>
  localeOptions: readonly LocaleOption[]
  proxyForm: ProxyFormState
  toggleSidebar: () => void
  toggleToolbarMenu: (menu: 'proxy' | 'theme' | 'language') => void
  closeToolbarMenu: () => void
  setThemeMode: (mode: 'light' | 'dark') => void
  setThemePalette: (value: string) => void
  setProxyConfig: () => void
  changeLocale: (value: string) => void
  winClose: () => void
  winMini: () => void
  winMax: () => void
}

const appChromeKey: InjectionKey<AppChromeContext> = Symbol('app-chrome')

export function provideAppChrome(context: AppChromeContext) {
  provide(appChromeKey, context)
}

export function useAppChrome(): ShallowUnwrapRef<AppChromeContext> {
  const context = inject(appChromeKey)
  if (!context) {
    throw new Error('App chrome context is not available.')
  }

  return proxyRefs(context) as ShallowUnwrapRef<AppChromeContext>
}
