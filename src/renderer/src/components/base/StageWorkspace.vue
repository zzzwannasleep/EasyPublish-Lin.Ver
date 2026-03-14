<script setup lang="ts">
import { computed, useSlots } from 'vue'
import AppPanel from './AppPanel.vue'
import StatusChip from '../feedback/StatusChip.vue'

const props = withDefaults(
  defineProps<{
    eyebrow?: string
    title: string
    description: string
    statusLabel?: string
    statusTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
    showIntro?: boolean
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
    showIntro: true,
    panelEyebrow: '',
    panelTitle: '',
    panelDescription: '',
    asideEyebrow: 'Handoff',
    asideTitle: '',
    asideDescription: ''
  }
)

const slots = useSlots()
const showIntroBlock = computed(() => props.showIntro && Boolean(props.eyebrow || props.title || props.description || props.statusLabel))
const hasAside = computed(() => Boolean(slots.aside || props.asideEyebrow || props.asideTitle || props.asideDescription))
</script>

<template>
  <div class="stage-workspace" :class="{ 'stage-workspace--compact': !showIntroBlock }">
    <section v-if="showIntroBlock" class="stage-workspace__intro">
      <div class="stage-workspace__copy">
        <div v-if="eyebrow" class="page-eyebrow">{{ eyebrow }}</div>
        <h2 class="stage-workspace__title">{{ title }}</h2>
        <p class="stage-workspace__description">{{ description }}</p>
      </div>
      <StatusChip v-if="statusLabel" :tone="statusTone">{{ statusLabel }}</StatusChip>
    </section>

    <section class="stage-workspace__grid" :class="{ 'stage-workspace__grid--single': !hasAside }">
      <AppPanel
        class="stage-workspace__panel stage-workspace__panel--main"
        :eyebrow="panelEyebrow"
        :title="panelTitle"
        :description="panelDescription"
      >
        <div class="legacy-embed">
          <slot />
        </div>
      </AppPanel>

      <AppPanel
        v-if="hasAside"
        class="stage-workspace__panel stage-workspace__panel--aside"
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

.stage-workspace--compact {
  gap: 16px;
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

.stage-workspace__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr);
  gap: 18px;
  align-items: start;
}

.stage-workspace__grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.stage-workspace__panel {
  min-width: 0;
}

.stage-workspace__panel--main :deep(.app-panel__content) {
  padding: clamp(18px, 2vw, 24px);
}

.stage-workspace__panel--aside :deep(.app-panel__content) {
  padding: 20px 24px 24px;
}

@media (max-width: 1240px) {
  .stage-workspace__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1180px) {
  .stage-workspace__intro {
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .stage-workspace {
    gap: 14px;
  }

  .stage-workspace__panel--main :deep(.app-panel__content),
  .stage-workspace__panel--aside :deep(.app-panel__content) {
    padding: 18px;
  }
}
</style>
