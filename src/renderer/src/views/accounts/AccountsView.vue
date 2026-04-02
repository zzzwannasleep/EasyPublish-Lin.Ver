<script setup lang="ts">
import { computed, ref } from 'vue'
import AppPanel from '../../components/base/AppPanel.vue'
import Account from '../../components/Account.vue'
import PtSiteAccounts from '../../components/PtSiteAccounts.vue'
import { useI18n } from '../../i18n'

type AccountCategory = 'bt' | 'pt'

const { t } = useI18n()
const activeCategory = ref<AccountCategory>('bt')

const categoryCards = computed(() => [
  {
    id: 'bt' as const,
    label: t('accounts.category.bt.label'),
    title: t('accounts.category.bt.title'),
    description: t('accounts.category.bt.description'),
  },
  {
    id: 'pt' as const,
    label: t('accounts.category.pt.label'),
    title: t('accounts.category.pt.title'),
    description: t('accounts.category.pt.description'),
  },
])

const panelCopy = computed(() =>
  activeCategory.value === 'bt'
    ? {
        eyebrow: t('accounts.panel.btEyebrow'),
        title: t('accounts.panel.btTitle'),
        description: t('accounts.panel.btDescription'),
      }
    : {
        eyebrow: t('accounts.panel.ptEyebrow'),
        title: t('accounts.panel.ptTitle'),
        description: t('accounts.panel.ptDescription'),
      },
)
</script>

<template>
  <div class="flex min-h-full flex-col gap-4">
    <section class="grid gap-3 lg:grid-cols-2">
      <article
        v-for="card in categoryCards"
        :key="card.id"
        :class="[
          'surface-tile grid gap-2 px-4 py-4',
          activeCategory === card.id
            ? 'border-[rgba(230,156,28,0.34)] shadow-[0_8px_18px_rgba(230,156,28,0.1)]'
            : '',
        ]"
        @click="activeCategory = card.id"
      >
        <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-copy-muted">
          {{ card.label }}
        </div>
        <h2 class="font-display text-[clamp(1.1rem,1.5vw,1.35rem)] leading-tight tracking-[-0.03em] text-copy-primary">
          {{ card.title }}
        </h2>
        <p class="text-[13px] leading-5 text-copy-secondary">{{ card.description }}</p>
      </article>
    </section>

    <AppPanel
      :eyebrow="panelCopy.eyebrow"
      :title="panelCopy.title"
      :description="panelCopy.description"
    >
      <Account
        v-if="activeCategory === 'bt'"
        :site-ids="['bangumi', 'mikan', 'anibt', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']"
        title-key="accounts.bt.title"
        description-key="accounts.bt.description"
      />
      <PtSiteAccounts v-else />
    </AppPanel>
  </div>
</template>
