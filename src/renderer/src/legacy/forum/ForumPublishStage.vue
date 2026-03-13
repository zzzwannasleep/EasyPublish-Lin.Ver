<script setup lang="ts">
import { computed } from 'vue'
import ForumPublish from '../../components/ForumPublish.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../../features/project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../../features/project-detail/project-context'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))

const notes = computed(() => [
  {
    title: t('stage.forum.note1.title'),
    text: t('stage.forum.note1.text'),
  },
  {
    title: t('stage.forum.note2.title'),
    text: t('stage.forum.note2.text'),
  },
  {
    title: t('stage.forum.note3.title'),
    text: t('stage.forum.note3.text'),
  },
])
</script>

<template>
  <StageWorkspace
    :eyebrow="t('stage.forum.eyebrow')"
    :title="t('stage.forum.title')"
    :description="t('stage.forum.description', { project: projectName })"
    :status-label="t('stage.forum.status')"
    status-tone="warning"
    :panel-eyebrow="t('stage.forum.panelEyebrow')"
    :panel-title="t('stage.forum.panelTitle', { project: projectName })"
    :panel-description="t('stage.forum.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.forum.asideDescription')"
  >
    <ForumPublish :id="id" />

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
