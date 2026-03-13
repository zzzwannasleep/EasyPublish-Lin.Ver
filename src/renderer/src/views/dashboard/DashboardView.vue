<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import AppPanel from '../../components/base/AppPanel.vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'

const { t } = useI18n()

const quickLinks = computed(() => [
  {
    to: '/new-project',
    title: t('dashboard.quickLinks.create.title'),
    text: t('dashboard.quickLinks.create.text'),
  },
  {
    to: '/projects',
    title: t('dashboard.quickLinks.projects.title'),
    text: t('dashboard.quickLinks.projects.text'),
  },
  {
    to: '/accounts',
    title: t('dashboard.quickLinks.accounts.title'),
    text: t('dashboard.quickLinks.accounts.text'),
  },
  {
    to: '/logs',
    title: t('dashboard.quickLinks.logs.title'),
    text: t('dashboard.quickLinks.logs.text'),
  },
  {
    to: '/legacy/modify',
    title: t('dashboard.quickLinks.modify.title'),
    text: t('dashboard.quickLinks.modify.text'),
  },
])

const milestones = computed(() => [
  {
    title: t('dashboard.milestones.m1.title'),
    text: t('dashboard.milestones.m1.text'),
  },
  {
    title: t('dashboard.milestones.m2.title'),
    text: t('dashboard.milestones.m2.text'),
  },
  {
    title: t('dashboard.milestones.m3.title'),
    text: t('dashboard.milestones.m3.text'),
  },
  {
    title: t('dashboard.milestones.m5.title'),
    text: t('dashboard.milestones.m5.text'),
  },
])

const stats = reactive({
  total: 0,
  active: 0,
  published: 0,
})

async function loadStats() {
  const result = await projectBridge.getProjectStats()
  if (!result.ok) {
    return
  }

  Object.assign(stats, result.data.stats)
}

onMounted(() => {
  void loadStats()
  window.projectAPI.refreshProjectData(loadStats)
})
</script>

<template>
  <div class="page-shell">
    <section class="page-hero">
      <div class="page-hero__content">
        <div class="page-eyebrow">{{ t('dashboard.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ t('dashboard.hero.title') }}</h1>
        <p class="page-summary">{{ t('dashboard.hero.summary') }}</p>
        <div class="page-actions">
          <router-link to="/new-project">
            <el-button type="primary" size="large">{{ t('dashboard.actions.create') }}</el-button>
          </router-link>
          <router-link to="/projects">
            <el-button size="large" plain>{{ t('dashboard.actions.openList') }}</el-button>
          </router-link>
        </div>
      </div>
      <div class="stack-list">
        <StatusChip tone="success">{{ t('dashboard.chips.engineOnline') }}</StatusChip>
        <StatusChip tone="info">{{ t('dashboard.chips.desktopScope') }}</StatusChip>
        <StatusChip tone="warning">{{ t('dashboard.chips.uiRefactor') }}</StatusChip>
      </div>
    </section>

    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-card__label">{{ t('dashboard.stats.total.label') }}</div>
        <div class="stat-card__value">{{ stats.total }}</div>
        <div class="stat-card__text">{{ t('dashboard.stats.total.text') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">{{ t('dashboard.stats.active.label') }}</div>
        <div class="stat-card__value">{{ stats.active }}</div>
        <div class="stat-card__text">{{ t('dashboard.stats.active.text') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">{{ t('dashboard.stats.published.label') }}</div>
        <div class="stat-card__value">{{ stats.published }}</div>
        <div class="stat-card__text">{{ t('dashboard.stats.published.text') }}</div>
      </div>
    </section>

    <section class="page-grid">
      <div class="span-7">
        <AppPanel
          :eyebrow="t('dashboard.panel.links.eyebrow')"
          :title="t('dashboard.panel.links.title')"
          :description="t('dashboard.panel.links.description')"
        >
          <div class="quick-links">
            <router-link v-for="link in quickLinks" :key="link.to" :to="link.to" class="quick-link">
              <div class="quick-link__title">{{ link.title }}</div>
              <div class="quick-link__text">{{ link.text }}</div>
            </router-link>
          </div>
        </AppPanel>
      </div>
      <div class="span-5">
        <AppPanel
          :eyebrow="t('dashboard.panel.milestones.eyebrow')"
          :title="t('dashboard.panel.milestones.title')"
          :description="t('dashboard.panel.milestones.description')"
        >
          <div class="stack-list">
            <article v-for="item in milestones" :key="item.title" class="stack-list__item">
              <div class="stack-list__title">{{ item.title }}</div>
              <div class="stack-list__text">{{ item.text }}</div>
            </article>
          </div>
        </AppPanel>
      </div>
    </section>
  </div>
</template>
