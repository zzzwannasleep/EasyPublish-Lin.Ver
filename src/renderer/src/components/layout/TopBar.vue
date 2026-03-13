<script setup lang="ts">
import { useI18n } from '../../i18n'

defineProps<{
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
  changeLocale: [locale: string]
}>()

const { t } = useI18n()
</script>

<template>
  <header class="top-bar">
    <div class="top-bar__heading">
      <button
        class="top-bar__menu"
        :class="{ 'is-active': sidebarOpen }"
        type="button"
        @click="$emit('toggleSidebar')"
      >
        <el-icon><Menu /></el-icon>
      </button>
      <div class="top-bar__brand">PT</div>
      <div class="top-bar__copy">
        <h1 class="top-bar__title">{{ title }}</h1>
        <p class="top-bar__subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div class="top-bar__tools">
      <slot name="utility" />
      <el-select
        class="top-bar__locale"
        :model-value="locale"
        size="small"
        @update:model-value="$emit('changeLocale', $event)"
      >
        <el-option
          v-for="option in localeOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <button class="top-bar__ghost" type="button" @click="$emit('toggleTheme')">
        <el-icon :size="16">
          <component :is="dark ? 'Moon' : 'Sunny'" />
        </el-icon>
        <span>{{ dark ? t('common.theme.dark') : t('common.theme.light') }}</span>
      </button>
      <div class="top-bar__window">
        <button class="top-bar__icon" type="button" @click="$emit('minimize')">
          <el-icon><Minus /></el-icon>
        </button>
        <button class="top-bar__icon" type="button" @click="$emit('maximize')">
          <el-icon><FullScreen /></el-icon>
        </button>
        <button class="top-bar__icon top-bar__icon--danger" type="button" @click="$emit('close')">
          <el-icon><CloseBold /></el-icon>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 88px;
  padding: 18px 28px 12px;
  -webkit-app-region: drag;
}

.top-bar__heading,
.top-bar__tools,
.top-bar__window {
  display: flex;
  align-items: center;
  gap: 12px;
}

.top-bar__heading {
  min-width: 0;
}

.top-bar__brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--brand), #e1a15b);
  color: #fff7ed;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: var(--shadow-md);
}

.top-bar__menu {
  display: none;
}

.top-bar__locale {
  width: 124px;
  -webkit-app-region: no-drag;
}

.top-bar__copy {
  min-width: 0;
}

.top-bar__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.top-bar__subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.top-bar__tools,
.top-bar__window,
.top-bar__ghost,
.top-bar__icon,
.top-bar__menu {
  -webkit-app-region: no-drag;
}

.top-bar__ghost,
.top-bar__icon,
.top-bar__menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.top-bar__icon,
.top-bar__menu {
  width: 40px;
  min-width: 40px;
  padding: 0;
}

.top-bar__ghost:hover,
.top-bar__icon:hover,
.top-bar__menu:hover,
.top-bar__menu.is-active {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.top-bar__icon--danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 1180px) {
  .top-bar {
    flex-direction: column;
    align-items: stretch;
    padding: 18px 18px 8px;
  }

  .top-bar__menu {
    display: inline-flex;
  }

  .top-bar__tools {
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .top-bar__window {
    margin-left: auto;
  }
}

@media (max-width: 720px) {
  .top-bar {
    padding: 16px 14px 6px;
    gap: 14px;
  }

  .top-bar__heading,
  .top-bar__tools {
    gap: 10px;
  }

  .top-bar__title {
    font-size: 20px;
  }

  .top-bar__tools {
    align-items: stretch;
  }
}
</style>
