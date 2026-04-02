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
    asidePlacement?: 'side' | 'top'
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
    asideDescription: '',
    asidePlacement: 'side',
  }
)

const slots = useSlots()
const showIntroBlock = computed(() => props.showIntro && Boolean(props.eyebrow || props.title || props.description || props.statusLabel))
const hasAside = computed(() => Boolean(slots.aside || props.asideEyebrow || props.asideTitle || props.asideDescription))
const isTopAside = computed(() => hasAside.value && props.asidePlacement === 'top')
</script>

<template>
  <div class="stage-workspace">
    <section
      v-if="showIntroBlock"
      class="surface-panel flex flex-col gap-3 px-4 py-4 lg:px-5 lg:py-5 xl:flex-row xl:items-end xl:justify-between"
    >
      <div class="max-w-3xl">
        <div v-if="eyebrow" class="eyebrow-text">{{ eyebrow }}</div>
        <h2 class="mt-2 font-display text-[clamp(1.15rem,1.6vw,1.5rem)] leading-tight tracking-[-0.03em] text-copy-primary">
          {{ title }}
        </h2>
        <p class="mt-2 text-[13px] leading-5 text-copy-secondary">{{ description }}</p>
      </div>
      <StatusChip v-if="statusLabel" :tone="statusTone" class="self-start xl:self-end">{{ statusLabel }}</StatusChip>
    </section>

    <section
      class="grid gap-5"
      :class="{
        'xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]': hasAside && !isTopAside,
        'grid-cols-1': !hasAside || isTopAside,
      }"
    >
      <AppPanel
        v-if="isTopAside"
        class="stage-workspace__panel stage-workspace__panel--aside stage-workspace__panel--aside-top"
        :eyebrow="asideEyebrow"
        :title="asideTitle"
        :description="asideDescription"
      >
        <div class="stage-workspace__aside-grid">
          <slot name="aside" />
        </div>
      </AppPanel>

      <AppPanel
        class="stage-workspace__panel stage-workspace__panel--main"
        :eyebrow="panelEyebrow"
        :title="panelTitle"
        :description="panelDescription"
      >
        <div class="stage-workspace__main">
          <slot />
        </div>
      </AppPanel>

      <AppPanel
        v-if="hasAside && !isTopAside"
        class="stage-workspace__panel stage-workspace__panel--aside"
        :eyebrow="asideEyebrow"
        :title="asideTitle"
        :description="asideDescription"
      >
        <div class="stage-workspace__aside-stack">
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
  gap: 20px;
  min-height: 100%;
}

.stage-workspace__panel {
  min-width: 0;
}

.stage-workspace__main {
  min-height: 320px;
}

.stage-workspace__aside-stack,
.stage-workspace__aside-grid {
  display: grid;
  gap: 12px;
}

.stage-workspace__aside-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.stage-workspace__panel--main :deep(.app-panel__content) {
  padding: clamp(18px, 2vw, 24px);
}

.stage-workspace__panel--aside :deep(.app-panel__content) {
  padding: 20px;
}

.stage-workspace__panel--aside-top :deep(.app-panel__content) {
  padding: 18px 20px 20px;
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
