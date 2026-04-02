<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string
    title?: string
    description?: string
  }>(),
  {
    eyebrow: '',
    title: '',
    description: ''
  }
)
</script>

<template>
  <section class="app-panel surface-panel overflow-hidden">
    <header
      v-if="eyebrow || title || description"
      class="app-panel__header px-4 pt-4 sm:px-5 sm:pt-5"
    >
      <span v-if="eyebrow" class="app-panel__eyebrow eyebrow-text mb-1.5 inline-flex">{{ eyebrow }}</span>
      <h2
        v-if="title"
        class="app-panel__title font-display text-[clamp(1.1rem,1.4vw,1.35rem)] leading-tight tracking-[-0.03em] text-copy-primary"
      >
        {{ title }}
      </h2>
      <p v-if="description" class="app-panel__description mt-2 max-w-3xl text-[13px] leading-5 text-copy-secondary">
        {{ description }}
      </p>
    </header>
    <div class="app-panel__content px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-4">
      <slot />
    </div>
  </section>
</template>
