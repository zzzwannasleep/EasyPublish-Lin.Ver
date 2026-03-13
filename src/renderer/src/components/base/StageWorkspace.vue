<script setup lang="ts">
import AppPanel from './AppPanel.vue'
import StatusChip from '../feedback/StatusChip.vue'

withDefaults(
  defineProps<{
    eyebrow?: string
    title: string
    description: string
    statusLabel?: string
    statusTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
    panelEyebrow?: string
    panelTitle?: string
    panelDescription?: string
    asideEyebrow?: string
    asideTitle?: string
    asideDescription?: string
  }>(),
  {
    eyebrow: 'Workflow Stage',
    statusLabel: '',
    statusTone: 'neutral',
    panelEyebrow: '',
    panelTitle: '',
    panelDescription: '',
    asideEyebrow: 'Handoff',
    asideTitle: '',
    asideDescription: ''
  }
)
</script>

<template>
  <div class="stage-workspace">
    <section class="stage-workspace__intro">
      <div class="stage-workspace__copy">
        <div v-if="eyebrow" class="page-eyebrow">{{ eyebrow }}</div>
        <h2 class="stage-workspace__title">{{ title }}</h2>
        <p class="stage-workspace__description">{{ description }}</p>
      </div>
      <StatusChip v-if="statusLabel" :tone="statusTone">{{ statusLabel }}</StatusChip>
    </section>

    <section class="page-grid">
      <AppPanel
        class="span-8"
        :eyebrow="panelEyebrow"
        :title="panelTitle"
        :description="panelDescription"
      >
        <div class="legacy-embed">
          <slot />
        </div>
      </AppPanel>

      <AppPanel
        class="span-4"
        :eyebrow="asideEyebrow"
        :title="asideTitle"
        :description="asideDescription"
      >
        <div class="stack-list">
          <slot name="aside" />
        </div>
      </AppPanel>
    </section>
  </div>
</template>

<style scoped>
.stage-workspace {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.stage-workspace__intro {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;
}

.stage-workspace__copy {
  max-width: 760px;
}

.stage-workspace__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(24px, 2vw, 30px);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.stage-workspace__description {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .stage-workspace__intro {
    flex-direction: column;
  }
}
</style>
