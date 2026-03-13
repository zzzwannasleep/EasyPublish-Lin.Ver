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
  <section class="app-panel">
    <header v-if="eyebrow || title || description" class="app-panel__header">
      <span v-if="eyebrow" class="app-panel__eyebrow">{{ eyebrow }}</span>
      <h2 v-if="title" class="app-panel__title">{{ title }}</h2>
      <p v-if="description" class="app-panel__description">{{ description }}</p>
    </header>
    <div class="app-panel__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.app-panel {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.48), transparent 38%),
    var(--bg-panel);
  box-shadow: var(--shadow-md);
}

.app-panel__header {
  padding: 22px 24px 0;
}

.app-panel__eyebrow {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.app-panel__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: -0.03em;
}

.app-panel__description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.app-panel__content {
  padding: 24px;
}
</style>
