<script setup lang="ts">
import type { Component } from 'vue'
import SidebarNav from './SidebarNav.vue'
import TopBar from './TopBar.vue'

type NavItem = {
  label: string
  caption: string
  to: string
  icon: Component
  matchPrefixes?: string[]
}

defineProps<{
  navItems: NavItem[]
  currentPath: string
  title: string
  subtitle: string
  dark: boolean
  activeToolbarMenu: 'proxy' | 'theme' | 'language' | null
  themePalette: string
  themePaletteOptions: readonly { value: string; label: string; swatches: readonly string[] }[]
  sidebarExpanded: boolean
  locale: string
  localeOptions: readonly { value: string; label: string }[]
}>()

defineEmits<{
  minimize: []
  maximize: []
  close: []
  toggleToolbarMenu: [menu: 'proxy' | 'theme' | 'language']
  closeToolbarMenu: []
  setThemeMode: [mode: 'light' | 'dark']
  selectThemePalette: [palette: string]
  toggleSidebar: []
  changeLocale: [locale: string]
}>()
</script>

<template>
  <div
    class="app-shell relative grid h-full w-full overflow-hidden"
    :class="{ 'app-shell--sidebar-collapsed': !sidebarExpanded }"
  >
    <aside class="app-shell__sidebar relative z-10 min-h-0 overflow-visible px-2.5 py-3 lg:px-3 lg:py-4 xl:px-4 xl:py-4">
      <SidebarNav
        :items="navItems"
        :current-path="currentPath"
        :expanded="sidebarExpanded"
        @toggle-sidebar="$emit('toggleSidebar')"
      />
    </aside>
    <section class="app-shell__content relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden">
      <TopBar
        :title="title"
        :subtitle="subtitle"
        :dark="dark"
        :active-toolbar-menu="activeToolbarMenu"
        :theme-palette="themePalette"
        :theme-palette-options="themePaletteOptions"
        :locale="locale"
        :locale-options="localeOptions"
        @minimize="$emit('minimize')"
        @maximize="$emit('maximize')"
        @close="$emit('close')"
        @toggle-toolbar-menu="$emit('toggleToolbarMenu', $event)"
        @close-toolbar-menu="$emit('closeToolbarMenu')"
        @set-theme-mode="$emit('setThemeMode', $event)"
        @select-theme-palette="$emit('selectThemePalette', $event)"
        @change-locale="$emit('changeLocale', $event)"
      >
        <template #utility>
          <slot name="utility" />
        </template>
        <template #utility-panel>
          <slot name="utility-panel" />
        </template>
      </TopBar>
      <main class="relative z-0 min-h-0 flex-1 overflow-auto px-2.5 pb-2.5 sm:px-3 sm:pb-3 lg:px-4 lg:pb-4 xl:px-5 xl:pb-5">
        <slot />
      </main>
    </section>
  </div>
</template>

<style scoped>
.app-shell {
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  --sidebar-width: 252px;
  transition: grid-template-columns 220ms ease;
  background: var(--surface-shell);
}

.app-shell--sidebar-collapsed {
  --sidebar-width: 88px;
}

.app-shell__sidebar {
  border-right: 1px solid var(--border-soft);
  background: var(--bg-elevated);
}

.app-shell__content {
  isolation: isolate;
  background: var(--bg-base);
}

@media (max-width: 1180px) {
  .app-shell {
    --sidebar-width: 228px;
  }

  .app-shell--sidebar-collapsed {
    --sidebar-width: 92px;
  }
}

@media (max-width: 720px) {
  .app-shell {
    --sidebar-width: 208px;
  }

  .app-shell--sidebar-collapsed {
    --sidebar-width: 88px;
  }
}
</style>
