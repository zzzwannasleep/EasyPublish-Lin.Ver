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
  sidebarExpanded: boolean
  locale: string
  localeOptions: readonly { value: string; label: string }[]
}>()

defineEmits<{
  minimize: []
  maximize: []
  close: []
  toggleTheme: []
  toggleSidebar: []
  changeLocale: [locale: string]
}>()
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--sidebar-collapsed': !sidebarExpanded }">
    <div class="app-shell__glow app-shell__glow--one" />
    <div class="app-shell__glow app-shell__glow--two" />
    <aside class="app-shell__sidebar">
      <SidebarNav
        :items="navItems"
        :current-path="currentPath"
        :expanded="sidebarExpanded"
        @toggle-sidebar="$emit('toggleSidebar')"
      />
    </aside>
    <section class="app-shell__body">
      <TopBar
        :title="title"
        :subtitle="subtitle"
        :dark="dark"
        :locale="locale"
        :locale-options="localeOptions"
        @minimize="$emit('minimize')"
        @maximize="$emit('maximize')"
        @close="$emit('close')"
        @toggle-theme="$emit('toggleTheme')"
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
  --sidebar-width: 300px;

  position: relative;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  gap: 18px;
  width: 100%;
  height: 100%;
  padding: 18px;
  overflow: hidden;
  transition: grid-template-columns 220ms ease;
}

.app-shell--sidebar-collapsed {
  --sidebar-width: 136px;
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
  overflow: visible;
  transition: padding 220ms ease, border-radius 220ms ease;
}

.app-shell--sidebar-collapsed .app-shell__sidebar {
  padding: 24px 14px;
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
    --sidebar-width: 264px;

    padding: 14px;
  }

  .app-shell--sidebar-collapsed {
    --sidebar-width: 120px;
  }

  .app-shell__sidebar {
    padding: 18px;
  }

  .app-shell--sidebar-collapsed .app-shell__sidebar {
    padding: 18px 12px;
  }

  .app-shell__main {
    padding: 8px 18px 18px;
  }
}

@media (max-width: 720px) {
  .app-shell {
    --sidebar-width: 220px;

    gap: 12px;
    padding: 10px;
  }

  .app-shell--sidebar-collapsed {
    --sidebar-width: 112px;
  }

  .app-shell__sidebar {
    padding: 16px 12px;
    border-radius: 24px;
  }

  .app-shell__body {
    border-radius: 24px;
  }

  .app-shell--sidebar-collapsed .app-shell__sidebar {
    padding: 16px 10px;
  }

  .app-shell__main {
    padding: 6px 14px 14px;
  }
}
</style>
