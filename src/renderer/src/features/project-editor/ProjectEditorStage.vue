<script setup lang="ts">
import { computed } from 'vue'
import Edit from '../../components/Edit.vue'
import StageWorkspace from '../../components/base/StageWorkspace.vue'
import { useI18n } from '../../i18n'
import ProjectStageAside from '../project-detail/ProjectStageAside.vue'
import { useProjectContext } from '../project-detail/project-context'

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, isLoading, errorMessage } = useProjectContext()
const projectName = computed(() => project.value?.name ?? t('common.projectWithId', { id: props.id }))

const notes = computed(() => [
  {
    title: t('stage.editor.note1.title'),
    text: t('stage.editor.note1.text'),
  },
  {
    title: t('stage.editor.note2.title'),
    text: t('stage.editor.note2.text'),
  },
  {
    title: t('stage.editor.note3.title'),
    text: t('stage.editor.note3.text'),
  },
])
</script>

<template>
  <StageWorkspace
    :show-intro="false"
    :eyebrow="t('stage.editor.eyebrow')"
    :title="t('stage.editor.title')"
    :description="t('stage.editor.description', { project: projectName })"
    :status-label="t('stage.editor.status')"
    status-tone="info"
    :panel-eyebrow="t('stage.editor.panelEyebrow')"
    :panel-title="t('stage.editor.panelTitle', { project: projectName })"
    :panel-description="t('stage.editor.panelDescription')"
    :aside-eyebrow="t('stage.shared.asideEyebrow')"
    :aside-title="t('stage.shared.asideTitle')"
    :aside-description="t('stage.editor.asideDescription')"
  >
    <Edit :id="id" />

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
