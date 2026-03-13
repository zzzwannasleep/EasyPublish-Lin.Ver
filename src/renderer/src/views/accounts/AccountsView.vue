<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import Account from '../../components/Account.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('accounts.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('accounts.hero.title') }}</h1>
        <p class="page-summary">{{ t('accounts.hero.summary') }}</p>
      </div>
      <StatusChip tone="warning">{{ t('accounts.hero.chip') }}</StatusChip>
    </section>

    <AppPanel
      :eyebrow="t('accounts.panel.eyebrow')"
      :title="t('accounts.panel.title')"
      :description="t('accounts.panel.description')"
    >
      <div class="legacy-embed">
        <Account />
      </div>
    </AppPanel>
  </div>
</template>
