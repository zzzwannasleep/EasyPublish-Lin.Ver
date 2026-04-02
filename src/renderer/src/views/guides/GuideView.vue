<script setup lang="ts">
import AppPanel from '../../components/base/AppPanel.vue'
import Quickstart from '../../components/Quickstart.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-full flex-col gap-4">
    <section class="surface-panel px-4 py-4 lg:px-5 lg:py-5">
      <div class="max-w-3xl">
        <div class="eyebrow-text">{{ t('guide.hero.eyebrow') }}</div>
        <h1 class="mt-2 font-display text-[clamp(1.2rem,1.6vw,1.55rem)] leading-tight tracking-[-0.03em] text-copy-primary">
          {{ t('guide.hero.title') }}
        </h1>
        <p class="mt-2 text-[13px] leading-5 text-copy-secondary">{{ t('guide.hero.summary') }}</p>
      </div>
    </section>

    <AppPanel
      :eyebrow="t('guide.panel.eyebrow')"
      :title="t('guide.panel.title')"
      :description="t('guide.panel.description')"
    >
      <div class="min-h-[320px]">
        <Quickstart />
      </div>
    </AppPanel>
  </div>
</template>
