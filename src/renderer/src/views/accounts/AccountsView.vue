<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppPanel from '../../components/base/AppPanel.vue'
import Account from '../../components/Account.vue'
import PtSiteAccounts from '../../components/PtSiteAccounts.vue'
import WindowToolbar from '../../components/layout/WindowToolbar.vue'
import { useI18n } from '../../i18n'
import { useAppChrome } from '../../services/app-chrome'

type AccountCategory = 'bt' | 'pt'

const { t } = useI18n()
const route = useRoute()
const chrome = useAppChrome()
const activeCategory = ref<AccountCategory>('bt')

const categoryCards = computed(() => [
  {
    id: 'bt' as const,
    label: t('accounts.category.bt.label'),
    title: t('accounts.category.bt.title'),
    description: t('accounts.category.bt.description'),
  },
  {
    id: 'pt' as const,
    label: t('accounts.category.pt.label'),
    title: t('accounts.category.pt.title'),
    description: t('accounts.category.pt.description'),
  },
])

const panelCopy = computed(() =>
  activeCategory.value === 'bt'
    ? {
        eyebrow: t('accounts.panel.btEyebrow'),
        title: t('accounts.panel.btTitle'),
        description: t('accounts.panel.btDescription'),
      }
    : {
        eyebrow: t('accounts.panel.ptEyebrow'),
        title: t('accounts.panel.ptTitle'),
        description: t('accounts.panel.ptDescription'),
      },
)
</script>

<template>
  <div class="accounts-page">
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
            chrome.activeToolbarMenu === 'proxy' ? 'accounts-page__utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="chrome.toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
        <el-form :model="chrome.proxyForm" label-position="top" class="accounts-page__proxy-form">
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
          <el-form-item class="accounts-page__proxy-actions">
            <el-button type="primary" @click="chrome.setProxyConfig">{{ t('common.save') }}</el-button>
            <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </template>
    </WindowToolbar>

    <main class="accounts-page__main">
      <div class="flex min-h-full flex-col gap-4">
        <section class="grid gap-3 lg:grid-cols-2">
          <article
            v-for="card in categoryCards"
            :key="card.id"
            :class="[
              'surface-tile grid gap-2 px-4 py-4',
              activeCategory === card.id
                ? 'border-[rgba(230,156,28,0.34)] shadow-[0_8px_18px_rgba(230,156,28,0.1)]'
                : '',
            ]"
            @click="activeCategory = card.id"
          >
            <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
              {{ card.label }}
            </div>
            <h2 class="font-display text-[clamp(1.1rem,1.5vw,1.35rem)] leading-tight tracking-[-0.03em] text-copy-primary">
              {{ card.title }}
            </h2>
            <p class="text-[13px] leading-5 text-copy-secondary">{{ card.description }}</p>
          </article>
        </section>

        <AppPanel
          :eyebrow="panelCopy.eyebrow"
          :title="panelCopy.title"
          :description="panelCopy.description"
        >
          <Account
            v-if="activeCategory === 'bt'"
            :site-ids="['bangumi', 'mikan', 'anibt', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']"
            title-key="accounts.bt.title"
            description-key="accounts.bt.description"
          />
          <PtSiteAccounts v-else />
        </AppPanel>
      </div>
    </main>
  </div>
</template>

<style scoped>
.accounts-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
}

.accounts-page__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.accounts-page__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.accounts-page__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.accounts-page__proxy-actions {
  margin-bottom: 0;
}
</style>
