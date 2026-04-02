<script setup lang="ts">
import CreateTask from '../../components/CreateTask.vue'
import PageShell from '../../components/layout/PageShell.vue'
</script>

<template>
  <PageShell>
    <div class="flex min-h-full flex-col gap-5">
      <CreateTask />
    </div>
  </PageShell>
</template>
