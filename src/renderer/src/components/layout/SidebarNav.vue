<script setup lang="ts">
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from '../../i18n'

type NavItem = {
  label: string
  caption: string
  to: string
  icon: Component
  matchPrefixes?: string[]
}

const props = defineProps<{
  items: NavItem[]
  currentPath: string
  expanded: boolean
}>()

const emit = defineEmits<{
  navigate: []
  toggleSidebar: []
}>()

const { t } = useI18n()

function isActive(item: NavItem) {
  if (item.to === '/') return props.currentPath === '/'
  if (props.currentPath === item.to) return true
  return item.matchPrefixes?.some(prefix => props.currentPath.startsWith(prefix)) ?? false
}

function handleNavigate(navigate: () => void) {
  navigate()
  emit('navigate')
}
</script>

<template>
  <nav class="flex h-full flex-col gap-4 overflow-auto">
    <div v-if="expanded" class="flex items-start justify-between gap-2 py-1 pl-0.5 pr-0.5">
      <div class="flex min-h-9 min-w-0 flex-1 items-center gap-2.5">
        <span
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand shadow-[0_4px_12px_rgba(193,96,55,0.14)]"
          aria-hidden="true"
        >
          <svg viewBox="0 0 1024 1024" focusable="false">
            <path
              d="M341.333333 277.333333l115.2-115.2c8.533333-8.533333 17.066667-12.8 29.866667-17.066666v473.6c0 17.066667 12.8 29.866667 25.6 29.866666s25.6-12.8 25.6-29.866666V140.8c8.533333 4.266667 21.333333 8.533333 29.866667 17.066667L682.666667 277.333333c4.266667 4.266667 12.8 8.533333 21.333333 8.533334s12.8-4.266667 21.333333-8.533334c12.8-12.8 12.8-29.866667 0-38.4l-115.2-115.2C554.666667 68.266667 469.333333 68.266667 418.133333 119.466667L302.933333 234.666667c-12.8 12.8-12.8 29.866667 0 38.4s25.6 12.8 38.4 4.266666z"
              fill="currentColor"
            />
            <path
              d="M738.133333 435.2h-72.533333c-17.066667 0-29.866667 12.8-29.866667 25.6s12.8 25.6 29.866667 25.6h72.533333c42.666667 0 76.8 34.133333 76.8 76.8V810.666667c0 42.666667-34.133333 76.8-76.8 76.8H285.866667c-42.666667 0-76.8-34.133333-76.8-76.8v-243.2c0-42.666667 34.133333-76.8 76.8-76.8h72.533333c17.066667 0 25.6-12.8 25.6-25.6s-12.8-25.6-25.6-25.6H285.866667c-72.533333 0-132.266667 59.733333-132.266667 132.266666V810.666667c0 72.533333 59.733333 132.266667 132.266667 132.266666h456.533333c72.533333 0 132.266667-59.733333 132.266667-132.266666v-243.2c0-72.533333-59.733333-132.266667-136.533334-132.266667z"
              fill="currentColor"
            />
          </svg>
        </span>

        <div class="min-w-0">
          <h2 class="font-display text-[22px] leading-none tracking-[-0.03em] text-copy-primary">
            {{ t('nav.title') }}
          </h2>
        </div>
      </div>

      <button
        class="soft-pill inline-flex h-9 w-9 shrink-0 items-center justify-center text-copy-secondary transition duration-200 hover:border-border-strong hover:text-copy-primary"
        type="button"
        :aria-label="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        :title="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
        @click="emit('toggleSidebar')"
      >
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path
            d="M14.25 5.25L7.5 12l6.75 6.75"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>

    <div v-else class="flex justify-center py-1">
      <button
        class="soft-pill inline-flex h-10 w-10 items-center justify-center text-copy-secondary transition duration-200 hover:border-border-strong hover:text-copy-primary"
        type="button"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        @click="emit('toggleSidebar')"
      >
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path
            d="M9.75 5.25L16.5 12l-6.75 6.75"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
    </div>

    <div class="flex flex-col gap-2">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ navigate }"
      >
        <button
          :class="[
            'group flex w-full items-center rounded-[16px] border text-left transition duration-200',
            expanded ? 'gap-3 px-2.5 py-2.5' : 'mx-auto w-[56px] justify-center px-0 py-2.5',
            isActive(item)
              ? 'border-[rgba(193,96,55,0.18)] bg-brand-soft shadow-sm'
              : 'border-transparent bg-transparent hover:border-border-soft hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
          ]"
          type="button"
          :aria-label="item.label"
          :title="expanded ? undefined : item.label"
          @click="handleNavigate(navigate)"
        >
          <span
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-black/[0.03] text-brand transition duration-200 group-hover:bg-black/[0.05] dark:bg-white/[0.04] dark:group-hover:bg-white/[0.08]"
          >
            <el-icon><component :is="item.icon" /></el-icon>
          </span>

          <span v-if="expanded" class="block min-w-0 truncate text-[14px] font-semibold text-copy-primary">
            {{ item.label }}
          </span>
        </button>
      </RouterLink>
    </div>
  </nav>
</template>
