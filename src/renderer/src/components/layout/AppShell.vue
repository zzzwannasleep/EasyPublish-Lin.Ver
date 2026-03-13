<script setup lang="ts">
import type { Component } from 'vue'
import { useI18n } from '../../i18n'
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
  sidebarOpen: boolean
  locale: string
  localeOptions: readonly { value: string; label: string }[]
}>()

defineEmits<{
  minimize: []
  maximize: []
  close: []
  toggleTheme: []
  toggleSidebar: []
  closeSidebar: []
  changeLocale: [locale: string]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--sidebar-open': sidebarOpen }">
    <div class="app-shell__glow app-shell__glow--one" />
    <div class="app-shell__glow app-shell__glow--two" />
    <button
      class="app-shell__backdrop"
      type="button"
      :aria-label="t('common.closeNavigation')"
      @click="$emit('closeSidebar')"
    />
    <aside class="app-shell__sidebar">
      <SidebarNav :items="navItems" :current-path="currentPath" @navigate="$emit('closeSidebar')" />
    </aside>
    <section class="app-shell__body">
      <TopBar
        :title="title"
        :subtitle="subtitle"
        :dark="dark"
        :sidebar-open="sidebarOpen"
        :locale="locale"
        :locale-options="localeOptions"
        @minimize="$emit('minimize')"
        @maximize="$emit('maximize')"
        @close="$emit('close')"
        @toggle-theme="$emit('toggleTheme')"
        @toggle-sidebar="$emit('toggleSidebar')"
        @change-locale="$emit('changeLocale', $event)"
      >
        <template #utility>
          <slot name="utility" />
        </template>
      </TopBar>
      <main class="app-shell__main">
        <slot />
      </main>
    </section>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 18px;
  width: 100%;
  height: 100%;
  padding: 18px;
  overflow: hidden;
}

.app-shell__glow {
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  filter: blur(20px);
}

.app-shell__glow--one {
  top: -100px;
  left: -40px;
  width: 280px;
  height: 280px;
  background: rgba(198, 90, 46, 0.16);
}

.app-shell__glow--two {
  right: 10%;
  bottom: -120px;
  width: 360px;
  height: 360px;
  background: rgba(31, 111, 120, 0.12);
}

.app-shell__backdrop {
  position: fixed;
  inset: 0;
  z-index: 4;
  border: 0;
  background: rgba(10, 10, 10, 0.34);
  opacity: 0;
  pointer-events: none;
  transition: opacity 220ms ease;
}

.app-shell__sidebar,
.app-shell__body {
  position: relative;
  z-index: 1;
  min-height: 0;
}

.app-shell__sidebar {
  padding: 24px 22px;
  border: 1px solid var(--border-soft);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.36), transparent 24%),
    var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.app-shell__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 16%),
    var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.app-shell__main {
  flex: 1;
  min-height: 0;
  padding: 10px 28px 28px;
  overflow: auto;
}

@media (max-width: 1180px) {
  .app-shell {
    grid-template-columns: 1fr;
    padding: 14px;
  }

  .app-shell__backdrop {
    display: block;
  }

  .app-shell__sidebar {
    position: fixed;
    top: 14px;
    left: 14px;
    bottom: 14px;
    z-index: 5;
    width: min(320px, calc(100vw - 28px));
    padding: 18px;
    transform: translateX(calc(-100% - 18px));
    transition: transform 240ms ease;
  }

  .app-shell--sidebar-open .app-shell__sidebar {
    transform: translateX(0);
  }

  .app-shell--sidebar-open .app-shell__backdrop {
    opacity: 1;
    pointer-events: auto;
  }

  .app-shell__main {
    padding: 8px 18px 18px;
  }
}

@media (max-width: 720px) {
  .app-shell {
    gap: 12px;
    padding: 10px;
  }

  .app-shell__sidebar {
    top: 10px;
    left: 10px;
    bottom: 10px;
    width: min(320px, calc(100vw - 20px));
  }

  .app-shell__body {
    border-radius: 24px;
  }

  .app-shell__main {
    padding: 6px 14px 14px;
  }
}
</style>
