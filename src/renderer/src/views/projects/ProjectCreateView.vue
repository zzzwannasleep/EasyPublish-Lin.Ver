<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import CreateTask from '../../components/CreateTask.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('projectCreate.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('projectCreate.hero.title') }}</h1>
        <p class="page-summary">{{ t('projectCreate.hero.summary') }}</p>
      </div>
      <StatusChip tone="success">{{ t('projectCreate.hero.chip') }}</StatusChip>
    </section>

    <AppPanel
      :eyebrow="t('projectCreate.panel.eyebrow')"
      :title="t('projectCreate.panel.title')"
      :description="t('projectCreate.panel.description')"
    >
      <div class="legacy-embed">
        <CreateTask />
      </div>
    </AppPanel>
  </div>
</template>
