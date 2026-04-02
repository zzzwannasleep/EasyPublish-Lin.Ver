<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppPanel from '../../components/base/AppPanel.vue'
import WindowToolbar from '../../components/layout/WindowToolbar.vue'
import Quickstart from '../../components/Quickstart.vue'
import { useI18n } from '../../i18n'
import { useAppChrome } from '../../services/app-chrome'

const route = useRoute()
const { t } = useI18n()
const chrome = useAppChrome()
</script>

<template>
  <div class="guide-page">
    <WindowToolbar
      :current-path="route.path"
      :dark="chrome.isDark"
      :active-toolbar-menu="chrome.activeToolbarMenu"
      :theme-palette="chrome.activeThemePalette"
      :theme-palette-options="chrome.themePaletteOptions"
      :locale="chrome.locale"
      :locale-options="chrome.localeOptions"
      @close="chrome.winClose"
      @maximize="chrome.winMax"
      @minimize="chrome.winMini"
      @toggle-toolbar-menu="chrome.toggleToolbarMenu"
      @close-toolbar-menu="chrome.closeToolbarMenu"
      @set-theme-mode="chrome.setThemeMode"
      @select-theme-palette="chrome.setThemePalette"
      @change-locale="chrome.changeLocale"
    >
      <template #utility>
        <button
          :class="[
            'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
            chrome.activeToolbarMenu === 'proxy' ? 'guide-page__utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="chrome.toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
        <el-form :model="chrome.proxyForm" label-position="top" class="guide-page__proxy-form">
          <el-form-item :label="t('app.proxy.enabled')">
            <el-switch v-model="chrome.proxyForm.status" />
          </el-form-item>
          <el-form-item :label="t('app.proxy.type')">
            <el-select v-model="chrome.proxyForm.type" :placeholder="t('common.selectProtocol')">
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
          <el-form-item class="guide-page__proxy-actions">
            <el-button type="primary" @click="chrome.setProxyConfig">{{ t('common.save') }}</el-button>
            <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </template>
    </WindowToolbar>

    <main class="guide-page__main">
      <div class="flex min-h-full flex-col gap-4">
        <section class="surface-panel px-4 py-4 lg:px-5 lg:py-5">
          <div class="max-w-3xl">
            <div class="eyebrow-text">{{ t('guide.hero.eyebrow') }}</div>
            <h1 class="mt-2 font-display text-[clamp(1.2rem,1.6vw,1.55rem)] leading-tight tracking-[-0.03em] text-copy-primary">
              {{ t('guide.hero.title') }}
            </h1>
            <p class="mt-2 text-[13px] leading-5 text-copy-secondary">{{ t('guide.hero.summary') }}</p>
          </div>
        </section>

        <AppPanel
          :eyebrow="t('guide.panel.eyebrow')"
          :title="t('guide.panel.title')"
          :description="t('guide.panel.description')"
        >
          <div class="min-h-[320px]">
            <Quickstart />
          </div>
        </AppPanel>
      </div>
    </main>
  </div>
</template>

<style scoped>
.guide-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
}

.guide-page__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.guide-page__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.guide-page__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.guide-page__proxy-actions {
  margin-bottom: 0;
}
</style>
