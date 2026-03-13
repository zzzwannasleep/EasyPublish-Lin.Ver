<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import Quickstart from '../../components/Quickstart.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('guide.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('guide.hero.title') }}</h1>
        <p class="page-summary">{{ t('guide.hero.summary') }}</p>
      </div>
    </section>

    <AppPanel
      :eyebrow="t('guide.panel.eyebrow')"
      :title="t('guide.panel.title')"
      :description="t('guide.panel.description')"
    >
      <div class="legacy-embed">
        <Quickstart />
      </div>
    </AppPanel>
  </div>
</template>
