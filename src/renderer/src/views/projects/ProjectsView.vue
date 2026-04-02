<script setup lang="ts">
import TaskList from '../../components/TaskList.vue'
import PageShell from '../../components/layout/PageShell.vue'
</script>

<template>
  <PageShell>
    <div class="flex min-h-full flex-col gap-5">
      <TaskList />
    </div>
  </PageShell>
</template>
