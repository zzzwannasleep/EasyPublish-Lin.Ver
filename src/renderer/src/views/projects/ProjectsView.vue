<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import TaskList from '../../components/TaskList.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('projects.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('projects.hero.title') }}</h1>
        <p class="page-summary">{{ t('projects.hero.summary') }}</p>
      </div>
      <StatusChip tone="success">{{ t('projects.hero.chip') }}</StatusChip>
    </section>

    <AppPanel
      :eyebrow="t('projects.panel.eyebrow')"
      :title="t('projects.panel.title')"
      :description="t('projects.panel.description')"
    >
      <div class="legacy-embed">
        <TaskList />
      </div>
    </AppPanel>
  </div>
</template>
