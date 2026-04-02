<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'
import {
  getMissingTargetSiteIds,
  getProjectCompletionBackRouteName,
  getSiteLabel,
  sortPublishResults,
} from '../../services/project/presentation'
import ProjectPublishHistoryPanel from './ProjectPublishHistoryPanel.vue'

const props = defineProps<{
  id: number
}>()

const router = useRouter()
const { t } = useI18n()
const { project, isLoading, errorMessage, refreshProject } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))
const previousRouteName = computed(() => (project.value ? getProjectCompletionBackRouteName(project.value) : 'bt_publish'))
const missingTargetSites = computed(() => (project.value ? getMissingTargetSiteIds(project.value) : []))
const missingTargetLabels = computed(() => missingTargetSites.value.map(siteId => getSiteLabel(siteId)).join(', '))
const primaryLink = computed(() => {
  if (project.value?.forumLink) {
    return project.value.forumLink
  }

  return sortPublishResults(project.value?.publishResults ?? []).find(
    result => result.status === 'published' && result.remoteUrl,
  )?.remoteUrl
})

const notes = computed(() => [
  {
    title: t('stage.finish.note1.title'),
    text: t('stage.finish.note1.text'),
  },
  {
    title: t('stage.finish.note2.title'),
    text: t('stage.finish.note2.text'),
  },
  {
    title: t('stage.finish.note3.title'),
    text: t('stage.finish.note3.text'),
  },
])

function goBack() {
  router.push({
    name: previousRouteName.value,
    params: { id: props.id },
  })
}

onMounted(async () => {
  const message: Message.Task.TaskStatus = { id: props.id, step: 'finish' }
  window.taskAPI.setTaskProcess(JSON.stringify(message))
  await refreshProject()
})
</script>

<template>
  <StageWorkspace
    :eyebrow="t('stage.finish.eyebrow')"
    :title="t('stage.finish.title')"
    :description="t('stage.finish.description', { project: projectName })"
    :status-label="t('stage.finish.status')"
    status-tone="success"
    :panel-eyebrow="t('stage.finish.panelEyebrow')"
    :panel-title="t('stage.finish.panelTitle', { project: projectName })"
    :panel-description="t('stage.finish.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.finish.asideDescription')"
  >
    <el-alert
      v-if="missingTargetSites.length"
      :title="t('stage.finish.missingAlert', { sites: missingTargetLabels })"
      type="warning"
      :closable="false"
      show-icon
      class="mb-[18px]"
    />

    <div class="mb-[18px] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <el-button plain @click="goBack">{{ t('stage.finish.back') }}</el-button>
      <a
        v-if="primaryLink"
        :href="primaryLink"
        class="text-sm font-semibold text-accent transition hover:text-brand"
        target="_blank"
        rel="noreferrer"
      >
        {{ t('stage.finish.openLatest') }}
      </a>
    </div>

    <ProjectPublishHistoryPanel :project="project" :is-loading="isLoading" :error-message="errorMessage" />

    <template #aside>
      <ProjectStageAside
        :project="project"
        :is-loading="isLoading"
        :error-message="errorMessage"
        :notes="notes"
      />
    </template>
  </StageWorkspace>
</template>
