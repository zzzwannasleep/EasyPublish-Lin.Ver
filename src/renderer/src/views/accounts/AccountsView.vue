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
  <div class="page-shell account-classified">
    <section class="account-switcher">
      <article
        v-for="card in categoryCards"
        :key="card.id"
        class="account-switcher__card"
        :class="{ 'account-switcher__card--active': activeCategory === card.id }"
        @click="activeCategory = card.id"
      >
        <div class="account-switcher__label">{{ card.label }}</div>
        <h2 class="account-switcher__title">{{ card.title }}</h2>
        <p class="account-switcher__text">{{ card.description }}</p>
      </article>
    </section>

    <AppPanel
      :eyebrow="panelCopy.eyebrow"
      :title="panelCopy.title"
      :description="panelCopy.description"
    >
      <Account
        v-if="activeCategory === 'bt'"
        :site-ids="['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']"
        title-key="accounts.bt.title"
        description-key="accounts.bt.description"
      />
      <PtSiteAccounts v-else />
    </AppPanel>
  </div>
</template>

<style scoped>
.account-classified {
  display: grid;
  gap: 18px;
  min-height: 100%;
}

.account-switcher {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.account-switcher__card {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 20px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  cursor: pointer;
  background:
    radial-gradient(circle at top right, rgba(255, 190, 92, 0.1), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.44), transparent 38%),
    var(--bg-panel);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.account-switcher__card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.account-switcher__card--active {
  border-color: rgba(230, 156, 28, 0.48);
  box-shadow: 0 18px 38px rgba(230, 156, 28, 0.12);
}

.account-switcher__label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.account-switcher__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  letter-spacing: -0.04em;
}

.account-switcher__text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 720px) {
  .account-switcher {
    grid-template-columns: minmax(0, 1fr);
  }

  .account-switcher__card {
    padding: 16px;
  }
}
</style>
