<script setup lang="ts" name="ProjectWorkflowView">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import WindowToolbar from '../../components/layout/WindowToolbar.vue'
import { useI18n } from '../../i18n'
import { provideProjectContext } from '../../features/project-detail/project-context'
import { useAppChrome } from '../../services/app-chrome'
import { getProjectResumeRouteName, getProjectWorkflowRouteNames, type ProjectRouteName } from '../../services/project/presentation'
import { projectBridge } from '../../services/bridge/project'
import type { PublishProject } from '../../types/project'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const chrome = useAppChrome()

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

function getStepClasses(index: number) {
  if (index === activeStep.value) {
    return 'border-[rgba(198,90,46,0.24)] bg-[linear-gradient(135deg,rgba(247,219,206,0.72),rgba(255,255,255,0.44))] shadow-panel -translate-y-0.5'
  }

  if (index < activeStep.value) {
    return 'border-[rgba(29,124,85,0.22)] bg-[linear-gradient(135deg,rgba(214,239,229,0.72),rgba(255,255,255,0.4))]'
  }

  return 'border-border-soft bg-[linear-gradient(180deg,rgba(255,255,255,0.52),transparent_44%)]'
}

function getStepBarClasses(index: number) {
  if (index === activeStep.value) {
    return 'bg-[linear-gradient(90deg,var(--accent),rgba(198,90,46,0.25))]'
  }

  if (index < activeStep.value) {
    return 'bg-[linear-gradient(90deg,rgba(29,124,85,0.82),rgba(29,124,85,0.2))]'
  }

  return 'bg-transparent'
}

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
  <div class="project-workflow-page">
    <WindowToolbar
      :current-path="route.path"
      :dark="chrome.isDark"
      :active-toolbar-menu="chrome.activeToolbarMenu"
      :theme-palette="chrome.activeThemePalette"
      :theme-palette-options="chrome.themePaletteOptions"
      :locale="chrome.locale"
      :locale-options="chrome.localeOptions"
      @close="chrome.winClose"
      @maximize="chrome.winMax"
      @minimize="chrome.winMini"
      @toggle-toolbar-menu="chrome.toggleToolbarMenu"
      @close-toolbar-menu="chrome.closeToolbarMenu"
      @set-theme-mode="chrome.setThemeMode"
      @select-theme-palette="chrome.setThemePalette"
      @change-locale="chrome.changeLocale"
    >
      <template #utility>
        <button
          :class="[
            'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
            chrome.activeToolbarMenu === 'proxy' ? 'project-workflow-page__utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="chrome.toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
        <el-form :model="chrome.proxyForm" label-position="top" class="project-workflow-page__proxy-form">
          <el-form-item :label="t('app.proxy.enabled')">
            <el-switch v-model="chrome.proxyForm.status" />
          </el-form-item>
          <el-form-item :label="t('app.proxy.type')">
            <el-select v-model="chrome.proxyForm.type" :placeholder="t('common.selectProtocol')">
              <el-option label="HTTP" value="http" />
              <el-option label="HTTPS" value="https" />
              <el-option label="SOCKS5" value="socks" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('app.proxy.host')">
            <el-input v-model="chrome.proxyForm.host" />
          </el-form-item>
          <el-form-item :label="t('app.proxy.port')">
            <el-input-number v-model="chrome.proxyForm.port" />
          </el-form-item>
          <el-form-item class="project-workflow-page__proxy-actions">
            <el-button type="primary" @click="chrome.setProxyConfig">{{ t('common.save') }}</el-button>
            <el-button @click="chrome.closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
      </template>
    </WindowToolbar>

    <main class="project-workflow-page__main">
      <div class="flex min-h-full flex-col gap-4">
        <section v-if="!hideWorkflowRail" class="flex gap-3 overflow-x-auto pb-1">
          <article
            v-for="(item, index) in steps"
            :key="item.routeName"
            :class="[
              'relative grid min-w-[220px] grid-cols-[auto_minmax(0,1fr)] items-start gap-3 overflow-hidden rounded-[22px] border px-4 py-4 transition duration-200',
              getStepClasses(index),
            ]"
          >
            <span :class="['absolute inset-x-0 bottom-0 h-[3px]', getStepBarClasses(index)]" />
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
              0{{ index + 1 }}
            </div>
            <div class="grid gap-1.5">
              <div class="font-display text-[1.2rem] leading-tight tracking-[-0.04em] text-copy-primary">
                {{ item.title }}
              </div>
              <div class="text-[13px] leading-6 text-copy-secondary">{{ item.description }}</div>
            </div>
          </article>
        </section>

        <section class="min-h-0">
          <RouterView v-slot="{ Component, route: childRoute }">
            <transition name="workflow-stage" mode="out-in">
              <component :is="Component" :key="childRoute.fullPath" />
            </transition>
          </RouterView>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.project-workflow-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
}

.project-workflow-page__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.project-workflow-page__utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.project-workflow-page__proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.project-workflow-page__proxy-actions {
  margin-bottom: 0;
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
</style>
