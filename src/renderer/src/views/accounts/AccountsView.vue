<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import Account from '../../components/Account.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell account-workspace">
    <AppPanel
      :eyebrow="t('accounts.panel.eyebrow')"
      :title="t('accounts.panel.title')"
      :description="t('accounts.panel.description')"
    >
      <Account />
    </AppPanel>
  </div>
</template>

<style scoped>
.account-workspace {
  min-height: 100%;
}
</style>
