<script setup lang="ts">
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from '../../i18n'

type NavItem = {
  label: string
  caption: string
  to: string
  icon: Component
  matchPrefixes?: string[]
}

const props = defineProps<{
  items: NavItem[]
  currentPath: string
  expanded: boolean
}>()

const emit = defineEmits<{
  navigate: []
  toggleSidebar: []
}>()

const { t } = useI18n()

function isActive(item: NavItem) {
  if (item.to === '/') return props.currentPath === '/'
  if (props.currentPath === item.to) return true
  return item.matchPrefixes?.some(prefix => props.currentPath.startsWith(prefix)) ?? false
}

function handleNavigate(navigate: () => void) {
  navigate()
  emit('navigate')
}
</script>

<template>
  <nav class="sidebar-nav" :class="{ 'sidebar-nav--collapsed': !expanded }">
    <div class="sidebar-nav__header">
      <div class="sidebar-nav__brand">
        <span class="sidebar-nav__brand-icon" aria-hidden="true">
          <svg viewBox="0 0 1024 1024" focusable="false">
            <path
              d="M341.333333 277.333333l115.2-115.2c8.533333-8.533333 17.066667-12.8 29.866667-17.066666v473.6c0 17.066667 12.8 29.866667 25.6 29.866666s25.6-12.8 25.6-29.866666V140.8c8.533333 4.266667 21.333333 8.533333 29.866667 17.066667L682.666667 277.333333c4.266667 4.266667 12.8 8.533333 21.333333 8.533334s12.8-4.266667 21.333333-8.533334c12.8-12.8 12.8-29.866667 0-38.4l-115.2-115.2C554.666667 68.266667 469.333333 68.266667 418.133333 119.466667L302.933333 234.666667c-12.8 12.8-12.8 29.866667 0 38.4s25.6 12.8 38.4 4.266666z"
              fill="currentColor"
            />
            <path
              d="M738.133333 435.2h-72.533333c-17.066667 0-29.866667 12.8-29.866667 25.6s12.8 25.6 29.866667 25.6h72.533333c42.666667 0 76.8 34.133333 76.8 76.8V810.666667c0 42.666667-34.133333 76.8-76.8 76.8H285.866667c-42.666667 0-76.8-34.133333-76.8-76.8v-243.2c0-42.666667 34.133333-76.8 76.8-76.8h72.533333c17.066667 0 25.6-12.8 25.6-25.6s-12.8-25.6-25.6-25.6H285.866667c-72.533333 0-132.266667 59.733333-132.266667 132.266666V810.666667c0 72.533333 59.733333 132.266667 132.266667 132.266666h456.533333c72.533333 0 132.266667-59.733333 132.266667-132.266666v-243.2c0-72.533333-59.733333-132.266667-136.533334-132.266667z"
              fill="currentColor"
            />
          </svg>
        </span>
        <h2 v-if="expanded" class="sidebar-nav__title">{{ t('nav.title') }}</h2>
      </div>
      <button
        class="sidebar-nav__toggle"
        type="button"
        :aria-label="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        :title="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        @click="emit('toggleSidebar')"
      >
        <svg v-if="expanded" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path
            d="M14.25 5.25L7.5 12l6.75 6.75"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path
            d="M9.75 5.25L16.5 12l-6.75 6.75"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>
    <div class="sidebar-nav__list">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ navigate }"
      >
        <button
          class="sidebar-nav__item"
          :class="{ 'is-active': isActive(item) }"
          type="button"
          :aria-label="item.label"
          :title="expanded ? undefined : item.label"
          @click="handleNavigate(navigate)"
        >
          <span class="sidebar-nav__icon">
            <el-icon><component :is="item.icon" /></el-icon>
          </span>
          <span v-if="expanded" class="sidebar-nav__meta">
            <span class="sidebar-nav__label">{{ item.label }}</span>
            <span class="sidebar-nav__caption">{{ item.caption }}</span>
          </span>
        </button>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 22px;
  height: 100%;
  overflow: auto;
}

.sidebar-nav__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 4px 8px;
}

.sidebar-nav__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  min-height: 32px;
}

.sidebar-nav__brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--brand);
}

.sidebar-nav__brand-icon svg {
  width: 100%;
  height: 100%;
}

.sidebar-nav__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.02;
  letter-spacing: -0.04em;
}

.sidebar-nav__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.55), transparent 100%),
    var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    background 160ms ease;
}

.sidebar-nav__toggle:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.sidebar-nav__toggle svg {
  width: 18px;
  height: 18px;
}

.sidebar-nav__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-nav__item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 14px 14px 12px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
}

.sidebar-nav__item:hover {
  transform: translateX(3px);
  background: rgba(255, 255, 255, 0.26);
  border-color: var(--border-soft);
}

.sidebar-nav__item.is-active {
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.42));
  border-color: rgba(198, 90, 46, 0.22);
}

.sidebar-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  color: var(--brand);
}

.sidebar-nav__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sidebar-nav__label {
  font-size: 15px;
  font-weight: 700;
}

.sidebar-nav__caption {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.sidebar-nav--collapsed {
  gap: 18px;
}

.sidebar-nav--collapsed .sidebar-nav__header,
.sidebar-nav--collapsed .sidebar-nav__list {
  width: 100%;
}

.sidebar-nav--collapsed .sidebar-nav__header {
  align-items: center;
  padding-inline: 0;
}

.sidebar-nav--collapsed .sidebar-nav__item {
  justify-content: center;
  width: 72px;
  padding: 12px 0;
  margin: 0 auto;
}

.sidebar-nav--collapsed .sidebar-nav__item:hover {
  transform: translateY(-1px);
}

.sidebar-nav--collapsed .sidebar-nav__icon {
  width: 46px;
  height: 46px;
}

.sidebar-nav--collapsed .sidebar-nav__toggle {
  width: 34px;
  height: 34px;
}
</style>
