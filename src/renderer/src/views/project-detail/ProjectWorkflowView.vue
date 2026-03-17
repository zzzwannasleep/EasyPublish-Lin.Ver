<script setup lang="ts" name="ProjectWorkflowView">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from '../../i18n'
import { provideProjectContext } from '../../features/project-detail/project-context'
import { getProjectResumeRouteName, getProjectWorkflowRouteNames, type ProjectRouteName } from '../../services/project/presentation'
import { projectBridge } from '../../services/bridge/project'
import type { PublishProject } from '../../types/project'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const allSteps = computed(
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
    ] satisfies Array<{
      routeName: ProjectRouteName
      title: string
      description: string
    }>,
)

const steps = computed(() => {
  if (!project.value) {
    return allSteps.value
  }

  const availableRoutes = new Set(getProjectWorkflowRouteNames(project.value))
  return allSteps.value.filter(step => availableRoutes.has(step.routeName))
})

const activeStep = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : ''
  const matchedIndex = steps.value.findIndex(item => item.routeName === routeName)
  if (matchedIndex >= 0) {
    return matchedIndex
  }

  const currentProject = project.value
  if (currentProject) {
    return steps.value.findIndex(item => item.routeName === getProjectResumeRouteName(currentProject))
  }

  return 0
})

const hideWorkflowRail = computed(() => project.value?.projectMode === 'episode' && route.name === 'edit')

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

onMounted(() => {
  void loadProject()
  window.projectAPI.refreshProjectData(loadProject)
})

watch(workflowId, () => {
  void loadProject()
})

watch(
  () => [project.value, route.name] as const,
  ([currentProject, currentRouteName]) => {
    if (!currentProject || typeof currentRouteName !== 'string') {
      return
    }

    const availableRoutes = getProjectWorkflowRouteNames(currentProject)
    if (availableRoutes.includes(currentRouteName as ProjectRouteName)) {
      return
    }

    void router.replace({
      name: getProjectResumeRouteName(currentProject),
      params: { id: workflowId.value },
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="workflow-shell">
    <section v-if="!hideWorkflowRail" class="workflow-rail">
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
        <div class="workflow-step__body">
          <div class="workflow-step__title">{{ item.title }}</div>
          <div class="workflow-step__text">{{ item.description }}</div>
        </div>
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
  gap: 16px;
  min-height: 100%;
}

.workflow-rail {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;
}

.workflow-step {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  min-width: 220px;
  padding: 14px 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.52), transparent 44%),
    rgba(255, 255, 255, 0.32);
  box-shadow: var(--shadow-sm);
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.workflow-step::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: transparent;
}

.workflow-step.is-active {
  border-color: rgba(198, 90, 46, 0.24);
  background:
    linear-gradient(135deg, rgba(247, 219, 206, 0.72), rgba(255, 255, 255, 0.44)),
    rgba(255, 255, 255, 0.36);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.workflow-step.is-active::after {
  background: linear-gradient(90deg, var(--accent), rgba(198, 90, 46, 0.25));
}

.workflow-step.is-complete {
  border-color: rgba(29, 124, 85, 0.22);
  background:
    linear-gradient(135deg, rgba(214, 239, 229, 0.72), rgba(255, 255, 255, 0.38)),
    rgba(255, 255, 255, 0.32);
}

.workflow-step.is-complete::after {
  background: linear-gradient(90deg, rgba(29, 124, 85, 0.82), rgba(29, 124, 85, 0.2));
}

.workflow-step__index {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.workflow-step__body {
  display: grid;
  gap: 6px;
}

.workflow-step__title {
  font-family: var(--font-display);
  font-size: clamp(18px, 1.6vw, 20px);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.workflow-step__text {
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

@media (max-width: 720px) {
  .workflow-rail {
    gap: 10px;
  }

  .workflow-step {
    min-width: 200px;
    padding: 13px 14px;
  }
}
</style>
