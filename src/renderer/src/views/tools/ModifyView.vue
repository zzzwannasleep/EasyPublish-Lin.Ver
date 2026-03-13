<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import Modify from '../../components/Modify.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('tools.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('tools.hero.title') }}</h1>
        <p class="page-summary">{{ t('tools.hero.summary') }}</p>
      </div>
    </section>

    <AppPanel
      :eyebrow="t('tools.panel.eyebrow')"
      :title="t('tools.panel.title')"
      :description="t('tools.panel.description')"
    >
      <div class="legacy-embed">
        <Modify />
      </div>
    </AppPanel>
  </div>
</template>
