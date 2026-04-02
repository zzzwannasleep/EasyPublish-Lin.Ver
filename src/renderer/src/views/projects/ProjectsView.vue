<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import TaskList from '../../components/TaskList.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-full flex-col gap-5">
    <AppPanel
      :eyebrow="t('projects.panel.eyebrow')"
      :title="t('projects.panel.title')"
      :description="t('projects.panel.description')"
    >
      <TaskList />
    </AppPanel>
  </div>
</template>
