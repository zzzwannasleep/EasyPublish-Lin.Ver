<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import CreateTask from '../../components/CreateTask.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="page-shell project-create-workspace">
    <AppPanel
      :eyebrow="t('projectCreate.panel.eyebrow')"
      :title="t('projectCreate.panel.title')"
      :description="t('projectCreate.panel.description')"
    >
      <CreateTask />
    </AppPanel>
  </div>
</template>

<style scoped>
.project-create-workspace {
  min-height: 100%;
}
</style>
