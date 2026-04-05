<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from '../../i18n'
import { useAppChrome } from '../../services/app-chrome'
import AppShell from './AppShell.vue'

const props = withDefaults(
  defineProps<{
    showTheme?: boolean
    showProxy?: boolean
    showLanguage?: boolean
  }>(),
  {
    showTheme: true,
    showProxy: true,
    showLanguage: true
  }
)

const route = useRoute()
const { t } = useI18n()
const chrome = useAppChrome()
</script>

<template>
  <AppShell
    :nav-items="chrome.navItems"
    :current-path="route.path"
    :title="chrome.pageTitle"
    :subtitle="chrome.pageSubtitle"
    :dark="chrome.isDark"
    :active-toolbar-menu="chrome.activeToolbarMenu"
    :theme-palette="chrome.activeThemePalette"
    :theme-palette-options="chrome.themePaletteOptions"
    :sidebar-expanded="chrome.sidebarExpanded"
    :locale="chrome.locale"
    :locale-options="chrome.localeOptions"
    :show-theme="props.showTheme"
    :show-proxy="props.showProxy"
    :show-language="props.showLanguage"
    @close="chrome.winClose"
    @maximize="chrome.winMax"
    @minimize="chrome.winMini"
    @toggle-toolbar-menu="chrome.toggleToolbarMenu"
    @close-toolbar-menu="chrome.closeToolbarMenu"
    @set-theme-mode="chrome.setThemeMode"
    @select-theme-palette="chrome.setThemePalette"
    @toggle-sidebar="chrome.toggleSidebar"
    @change-locale="chrome.changeLocale"
  >
    <template #utility>
      <button
        :class="[
          'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
          chrome.activeToolbarMenu === 'proxy'
            ? 'page-shell__utility-button is-active'
            : 'text-copy-secondary'
        ]"
        type="button"
        @click="chrome.toggleToolbarMenu('proxy')"
      >
        <el-icon><Operation /></el-icon>
        <span>{{ t('common.proxy') }}</span>
      </button>
    </template>

    <template #utility-panel>
      <el-form :model="chrome.proxyForm" label-position="top" class="page-shell__proxy-form">
        <el-form-item :label="t('app.proxy.enabled')">
          <el-switch v-model="chrome.proxyForm.status" />
        </el-form-item>
        <el-form-item :label="t('app.proxy.type')">
          <el-select
            v-model="chrome.proxyForm.type"
            :teleported="false"
            :placeholder="t('common.selectProtocol')"
          >
            <el-option label="HTTP" value="http" />
            <el-option label="HTTPS" value="https" />
            <el-option label="SOCKS5" value="socks" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('app.proxy.host')">
          <el-input v-model="chrome.proxyForm.host" />
        </el-form-item>
        <el-form-item :label="t('app.proxy.port')">
          <el-input-number v-model="chrome.proxyForm.port" />
        </el-form-item>
        <el-form-item class="page-shell__proxy-actions">
          <el-button type="primary" @click="chrome.setProxyConfig">{{
            t('common.save')
          }}</el-button>
          <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
        </el-form-item>
      </el-form>
    </template>

    <slot />
  </AppShell>
</template>

<style scoped>
.page-shell__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.page-shell__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.page-shell__proxy-actions {
  margin-bottom: 0;
}
</style>
