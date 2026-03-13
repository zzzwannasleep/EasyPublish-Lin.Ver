<script setup lang="ts" name="ProjectWorkflowView">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { provideProjectContext } from '../../features/project-detail/project-context'
import { projectBridge } from '../../services/bridge/project'
import {
  getProjectSourceLabel,
  getProjectStageLabel,
  getProjectStatusLabel,
  projectStatusTones,
} from '../../services/project/presentation'
import type { PublishProject } from '../../types/project'

const route = useRoute()
const { t } = useI18n()

const steps = computed(
  () =>
    [
      {
        routeName: 'edit',
        title: t('workflow.step.edit.title'),
        description: t('workflow.step.edit.description'),
      },
      {
        routeName: 'check',
        title: t('workflow.step.review.title'),
        description: t('workflow.step.review.description'),
      },
      {
        routeName: 'bt_publish',
        title: t('workflow.step.torrent.title'),
        description: t('workflow.step.torrent.description'),
      },
      {
        routeName: 'forum_publish',
        title: t('workflow.step.forum.title'),
        description: t('workflow.step.forum.description'),
      },
      {
        routeName: 'finish',
        title: t('workflow.step.finish.title'),
        description: t('workflow.step.finish.description'),
      },
    ] as const,
)

const activeStep = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : ''
  return steps.value.findIndex(item => item.routeName === routeName) >= 0
    ? steps.value.findIndex(item => item.routeName === routeName)
    : 0
})

const currentStage = computed(() => steps.value[activeStep.value])
const workflowId = computed(() => Number(route.params.id ?? 0))
const project = ref<PublishProject | null>(null)
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)

async function loadProject() {
  if (!Number.isFinite(workflowId.value) || workflowId.value <= 0) {
    project.value = null
    errorMessage.value = t('workflow.invalidProjectId')
    return
  }

  isLoading.value = true
  try {
    const result = await projectBridge.getProject(workflowId.value)
    if (!result.ok) {
      project.value = null
      errorMessage.value = result.error.message
      return
    }

    project.value = result.data.project
    errorMessage.value = null
  } finally {
    isLoading.value = false
  }
}

provideProjectContext({
  project,
  isLoading,
  errorMessage,
  refreshProject: loadProject,
})

const projectTitle = computed(() => project.value?.name ?? t('common.projectWithId', { id: workflowId.value || '--' }))
const projectSummary = computed(() => {
  if (errorMessage.value) {
    return errorMessage.value
  }

  if (!project.value) {
    return currentStage.value.description
  }

  return t('workflow.summary.withProject', {
    description: currentStage.value.description,
    source: getProjectSourceLabel(project.value.sourceKind),
    stage: getProjectStageLabel(project.value.stage),
  })
})

onMounted(() => {
  void loadProject()
  window.projectAPI.refreshProjectData(loadProject)
})

watch(workflowId, () => {
  void loadProject()
})
</script>

<template>
  <div class="workflow-shell">
    <section class="workflow-hero">
      <div class="workflow-hero__content">
        <div class="page-eyebrow">{{ t('workflow.hero.eyebrow') }}</div>
        <h1 class="page-title">{{ projectTitle }}</h1>
        <p class="page-summary">{{ projectSummary }}</p>
        <div class="workflow-hero__stage">
          {{ t('workflow.hero.currentWorkspace', { title: currentStage.title }) }}
        </div>
      </div>
      <div class="workflow-hero__meta">
        <StatusChip tone="info">{{ t('common.projectWithId', { id: workflowId || '--' }) }}</StatusChip>
        <StatusChip tone="success">
          {{ t('common.stepProgress', { current: activeStep + 1, total: steps.length }) }}
        </StatusChip>
        <StatusChip v-if="project" :tone="projectStatusTones[project.status]">
          {{ getProjectStatusLabel(project.status) }}
        </StatusChip>
        <StatusChip v-if="project" tone="info">
          {{ getProjectSourceLabel(project.sourceKind) }}
        </StatusChip>
        <StatusChip v-else-if="isLoading" tone="warning">{{ t('workflow.status.loadingContext') }}</StatusChip>
        <StatusChip v-else-if="errorMessage" tone="danger">{{ t('workflow.status.missingContext') }}</StatusChip>
        <StatusChip tone="warning">{{ t('workflow.status.legacyAttached') }}</StatusChip>
      </div>
    </section>

    <section class="workflow-rail">
      <article
        v-for="(item, index) in steps"
        :key="item.routeName"
        class="workflow-step"
        :class="{
          'is-active': index === activeStep,
          'is-complete': index < activeStep
        }"
      >
        <div class="workflow-step__index">0{{ index + 1 }}</div>
        <div class="workflow-step__title">{{ item.title }}</div>
        <div class="workflow-step__text">{{ item.description }}</div>
      </article>
    </section>

    <section class="workflow-stage">
      <RouterView v-slot="{ Component, route: childRoute }">
        <transition name="workflow-stage" mode="out-in">
          <component :is="Component" :key="childRoute.fullPath" />
        </transition>
      </RouterView>
    </section>
  </div>
</template>

<style scoped>
.workflow-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.workflow-hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 26px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.5), transparent 56%),
    var(--bg-panel);
  box-shadow: var(--shadow-md);
}

.workflow-hero__content {
  max-width: 720px;
}

.workflow-hero__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 10px;
}

.workflow-hero__stage {
  margin-top: 16px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.workflow-rail {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.workflow-step {
  padding: 16px 16px 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.3);
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.workflow-step.is-active {
  border-color: rgba(198, 90, 46, 0.24);
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.4));
  transform: translateY(-1px);
}

.workflow-step.is-complete {
  border-color: rgba(29, 124, 85, 0.22);
  background: linear-gradient(135deg, var(--success-soft), rgba(255, 255, 255, 0.34));
}

.workflow-step__index {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.workflow-step__title {
  margin-top: 10px;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.workflow-step__text {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.workflow-stage {
  min-height: 0;
}

:deep(.workflow-stage-enter-active),
:deep(.workflow-stage-leave-active) {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

:deep(.workflow-stage-enter-from),
:deep(.workflow-stage-leave-to) {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 1180px) {
  .workflow-hero {
    flex-direction: column;
  }

  .workflow-hero__meta {
    justify-content: flex-start;
  }

  .workflow-rail {
    grid-template-columns: 1fr;
  }
}
</style>
