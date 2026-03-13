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
}>()

const emit = defineEmits<{
  navigate: []
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
  <nav class="sidebar-nav">
    <div class="sidebar-nav__header">
      <span class="sidebar-nav__eyebrow">{{ t('nav.workspaceEyebrow') }}</span>
      <h2 class="sidebar-nav__title">{{ t('nav.title') }}</h2>
      <p class="sidebar-nav__text">{{ t('nav.text') }}</p>
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
          @click="handleNavigate(navigate)"
        >
          <span class="sidebar-nav__icon">
            <el-icon><component :is="item.icon" /></el-icon>
          </span>
          <span class="sidebar-nav__meta">
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
  padding: 6px 4px 8px;
}

.sidebar-nav__eyebrow {
  color: var(--brand);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.sidebar-nav__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.02;
  letter-spacing: -0.04em;
}

.sidebar-nav__text {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
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
</style>
