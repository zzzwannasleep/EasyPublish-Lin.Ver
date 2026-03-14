<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import AppPanel from '../../components/base/AppPanel.vue'
import TaskList from '../../components/TaskList.vue'
import { useI18n } from '../../i18n'
import { projectBridge } from '../../services/bridge/project'
import { getProjectModeLabel, getProjectStageLabel } from '../../services/project/presentation'
import type { ProjectMode, ProjectStage, ProjectStats } from '../../types/project'

interface DistributionItem {
  key: string
  label: string
  count: number
  share: string
  progress: string
}

const { t } = useI18n()

const stageOrder: ProjectStage[] = [
  'edit',
  'review',
  'torrent_publish',
  'forum_publish',
  'completed'
]

function createEmptyStats(): ProjectStats {
  return {
    total: 0,
    active: 0,
    published: 0,
    recent: 0,
    byStage: {
      edit: 0,
      review: 0,
      torrent_publish: 0,
      forum_publish: 0,
      completed: 0
    },
    byMode: {
      episode: 0,
      feature: 0
    },
    bySourceKind: {
      quick: 0,
      file: 0,
      template: 0
    }
  }
}

function formatShare(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return '0%'
  }

  if (ratio >= 1) {
    return '100%'
  }

  const percentage = ratio * 100
  return percentage >= 10 ? `${Math.round(percentage)}%` : `${percentage.toFixed(1)}%`
}

function buildDistributionItem(
  key: string,
  label: string,
  count: number,
  total: number
): DistributionItem {
  const ratio = total > 0 ? count / total : 0

  return {
    key,
    label,
    count,
    share: formatShare(ratio),
    progress: `${Math.max(ratio * 100, count > 0 ? 8 : 0)}%`
  }
}

const stats = reactive<ProjectStats>(createEmptyStats())

const quickLinks = computed(() => [
  {
    to: '/new-project',
    title: t('dashboard.quickLinks.create.title'),
    text: t('dashboard.quickLinks.create.text')
  },
  {
    to: '/projects',
    title: t('dashboard.quickLinks.projects.title'),
    text: t('dashboard.quickLinks.projects.text')
  },
  {
    to: '/accounts',
    title: t('dashboard.quickLinks.accounts.title'),
    text: t('dashboard.quickLinks.accounts.text')
  },
  {
    to: '/logs',
    title: t('dashboard.quickLinks.logs.title'),
    text: t('dashboard.quickLinks.logs.text')
  }
])

const stageItems = computed(() =>
  stageOrder.map((stage) =>
    buildDistributionItem(
      stage,
      getProjectStageLabel(stage),
      stats.byStage[stage] ?? 0,
      stats.total
    )
  )
)

const modeOrder: ProjectMode[] = ['episode', 'feature']

const modeItems = computed(() =>
  modeOrder.map(mode =>
    buildDistributionItem(mode, getProjectModeLabel(mode), stats.byMode[mode] ?? 0, stats.total)
  )
)

async function loadStats() {
  const result = await projectBridge.getProjectStats()
  if (!result.ok) {
    return
  }

  const nextStats = createEmptyStats()
  Object.assign(nextStats, result.data.stats, {
    byStage: {
      ...nextStats.byStage,
      ...result.data.stats.byStage
    },
    byMode: {
      ...nextStats.byMode,
      ...result.data.stats.byMode
    },
    bySourceKind: {
      ...nextStats.bySourceKind,
      ...result.data.stats.bySourceKind
    }
  })

  Object.assign(stats, nextStats)
}

onMounted(() => {
  void loadStats()
  window.projectAPI.refreshProjectData(loadStats)
})
</script>

<template>
  <div class="page-shell dashboard-shell">
    <section class="dashboard-top-grid">
      <AppPanel
        :eyebrow="t('dashboard.panel.links.eyebrow')"
        :title="t('dashboard.panel.links.title')"
        :description="t('dashboard.panel.links.description')"
      >
        <div class="quick-link-grid">
          <router-link
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            class="quick-link-card"
          >
            <div class="quick-link-card__copy">
              <span class="quick-link-card__title">{{ link.title }}</span>
              <p class="quick-link-card__text">{{ link.text }}</p>
            </div>
            <span class="quick-link-card__action">{{ t('dashboard.quickLinks.action') }}</span>
          </router-link>
        </div>
      </AppPanel>

      <AppPanel
        :eyebrow="t('dashboard.panel.stages.eyebrow')"
        :title="t('dashboard.panel.stages.title')"
        :description="t('dashboard.panel.stages.description')"
      >
        <div class="dashboard-distribution">
          <section class="dashboard-distribution__section">
            <div class="dashboard-distribution__label">{{ t('dashboard.panel.stages.workflowLabel') }}</div>
            <div class="distribution-list">
              <article v-for="item in stageItems" :key="item.key" class="distribution-item">
                <div class="distribution-item__main">
                  <span class="distribution-item__label">{{ item.label }}</span>
                  <strong class="distribution-item__count">{{ item.count }}</strong>
                </div>
                <div class="distribution-item__track">
                  <span class="distribution-item__fill" :style="{ width: item.progress }"></span>
                </div>
                <div class="distribution-item__meta">{{ item.share }}</div>
              </article>
            </div>
          </section>

          <section class="dashboard-distribution__section">
            <div class="dashboard-distribution__label">{{ t('dashboard.panel.stages.modeLabel') }}</div>
            <div class="distribution-list distribution-list--compact">
              <article v-for="item in modeItems" :key="item.key" class="distribution-item">
                <div class="distribution-item__main">
                  <span class="distribution-item__label">{{ item.label }}</span>
                  <strong class="distribution-item__count">{{ item.count }}</strong>
                </div>
                <div class="distribution-item__track">
                  <span class="distribution-item__fill" :style="{ width: item.progress }"></span>
                </div>
                <div class="distribution-item__meta">{{ item.share }}</div>
              </article>
            </div>
          </section>
        </div>
      </AppPanel>
    </section>

    <AppPanel
      :eyebrow="t('dashboard.panel.projects.eyebrow')"
      :title="t('dashboard.panel.projects.title')"
      :description="t('dashboard.panel.projects.description')"
    >
      <TaskList variant="preview" :limit="4" />
    </AppPanel>
  </div>
</template>

<style scoped>
.dashboard-shell {
  gap: 1.125rem;
}

.dashboard-top-grid,
.dashboard-distribution,
.quick-link-grid,
.distribution-list {
  display: grid;
}

.dashboard-top-grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 1fr);
  gap: 1.125rem;
}

.quick-link-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.distribution-list {
  grid-template-columns: repeat(auto-fit, minmax(9.25rem, 1fr));
  gap: 1rem;
}

.dashboard-distribution {
  gap: 1rem;
}

.dashboard-distribution__section {
  display: grid;
  gap: 0.875rem;
}

.dashboard-distribution__label {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.distribution-list--compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.distribution-item,
.quick-link-card {
  position: relative;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.distribution-item__meta,
.quick-link-card__text,
.quick-link-card__action {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.quick-link-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem;
  text-decoration: none;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.quick-link-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.4), transparent 62%), var(--bg-panel);
}

.quick-link-card__copy {
  min-width: 0;
}

.quick-link-card__title {
  display: block;
  color: var(--text-primary);
  font-weight: 700;
  font-size: 1rem;
}

.quick-link-card__text {
  margin: 0;
}

.quick-link-card__action {
  color: var(--accent);
  font-weight: 700;
  white-space: nowrap;
}

.distribution-item {
  padding: 1rem;
}

.distribution-item__main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.distribution-item__label,
.distribution-item__count {
  color: var(--text-primary);
}

.distribution-item__label {
  font-weight: 700;
}

.distribution-item__count {
  font-family: var(--font-display);
  font-size: 1.25rem;
  letter-spacing: -0.03em;
}

.distribution-item__track {
  margin-top: 0.75rem;
  height: 0.5rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.distribution-item__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(198, 90, 46, 0.92), rgba(214, 123, 40, 0.5));
}

.distribution-item__fill--soft {
  background: linear-gradient(90deg, rgba(79, 117, 122, 0.92), rgba(79, 117, 122, 0.36));
}

@media (max-width: 1080px) {
  .dashboard-top-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .dashboard-shell {
    gap: 0.875rem;
  }

  .dashboard-top-grid {
    grid-template-columns: 1fr;
  }

  .quick-link-grid,
  .distribution-list,
  .distribution-list--compact {
    grid-template-columns: 1fr;
    gap: 0.875rem;
  }

  .quick-link-card {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .distribution-item__main {
    align-items: center;
  }
}
</style>
