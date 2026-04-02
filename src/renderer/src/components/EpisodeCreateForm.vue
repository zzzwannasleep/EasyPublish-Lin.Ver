<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { useRouter } from 'vue-router'
import { Collection, Document, FolderOpened } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { CreateProjectInput } from '../types/project'

type EpisodeCreateFormModel = CreateProjectInput & {
  projectMode: 'episode'
}

const emit = defineEmits<{
  back: []
}>()

const router = useRouter()
const { t } = useI18n()
const createForm = ref<FormInstance>()
const isCreating = ref(false)
const isPickingFolder = ref(false)

const form = reactive<EpisodeCreateFormModel>({
  name: '',
  projectMode: 'episode',
  workingDirectory: '',
  plannedEpisodeCount: undefined,
})

const summaryItems = computed(() => [
  {
    label: t('create.form.name.label'),
    value: form.name || t('create.form.name.placeholder'),
    icon: Document,
  },
  {
    label: t('create.form.directory.label'),
    value: form.workingDirectory || t('create.form.directory.placeholder'),
    icon: FolderOpened,
  },
  {
    label: t('create.mode.current'),
    value: t('create.mode.episode.label'),
    icon: Collection,
  },
  {
    label: '总集数',
    value: form.plannedEpisodeCount ? `${form.plannedEpisodeCount} 集` : '稍后再填',
    icon: Collection,
  },
])

async function pickFolder() {
  isPickingFolder.value = true
  try {
    const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFolderPath())
    form.workingDirectory = path
  } finally {
    isPickingFolder.value = false
  }
}

async function submitCreate() {
  isCreating.value = true
  try {
    const result = await projectBridge.createProject(form)
    if (!result.ok) {
      if (result.error.code === 'PROJECT_DIRECTORY_NOT_FOUND') {
        ElMessage.error(t('create.error.directoryMissing'))
        return
      }

      ElMessage.error(result.error.message)
      return
    }

    ElMessage({
      message: t('create.episode.success'),
      type: 'success',
      plain: true,
    })

    const { project } = result.data
    setTimeout(() => {
      router.push({
        name: 'edit',
        params: { id: project.id },
      })
    }, 300)
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="episode-create">
    <section class="episode-create__hero">
      <div class="episode-create__hero-copy">
        <div class="episode-create__eyebrow">{{ t('create.mode.episode.label') }}</div>
        <h3 class="episode-create__title">{{ t('create.episode.title') }}</h3>
        <p class="episode-create__description">{{ t('create.episode.description') }}</p>
      </div>
      <el-alert
        :title="t('create.episode.alert')"
        type="info"
        :closable="false"
        show-icon
      />
    </section>

    <section class="episode-create__summary">
      <article v-for="item in summaryItems" :key="item.label" class="episode-create__summary-card">
        <div class="episode-create__summary-icon">
          <el-icon><component :is="item.icon" /></el-icon>
        </div>
        <div>
          <div class="episode-create__summary-label">{{ item.label }}</div>
          <div class="episode-create__summary-value">{{ item.value }}</div>
        </div>
      </article>
    </section>

    <el-form ref="createForm" :model="form" label-position="top" class="episode-create__form">
      <section class="episode-create__card-grid">
        <article class="episode-create__card">
          <div class="episode-create__card-title">{{ t('create.form.name.label') }}</div>
          <div class="episode-create__card-text">{{ t('create.episode.nameHelp') }}</div>
          <el-form-item class="episode-create__item">
            <el-input v-model="form.name" size="large" :placeholder="t('create.form.name.placeholder')" />
          </el-form-item>
        </article>

        <article class="episode-create__card">
          <div class="episode-create__card-title">{{ t('create.form.directory.label') }}</div>
          <div class="episode-create__card-text">{{ t('create.episode.directoryHelp') }}</div>
          <el-form-item class="episode-create__item">
            <el-input
              v-model="form.workingDirectory"
              size="large"
              :placeholder="t('create.form.directory.placeholder')"
            >
              <template #append>
                <el-button :icon="FolderOpened" :loading="isPickingFolder" @click="pickFolder" />
              </template>
            </el-input>
          </el-form-item>
        </article>

        <article class="episode-create__card">
          <div class="episode-create__card-title">总集数</div>
          <div class="episode-create__card-text">剧集项目创建后会直接显示“已建集数 / 总集数”，这里可以先填一个计划值。</div>
          <el-form-item class="episode-create__item">
            <el-input-number v-model="form.plannedEpisodeCount" :min="1" :step="1" controls-position="right" />
          </el-form-item>
        </article>
      </section>

      <section class="episode-create__actions">
        <div class="episode-create__actions-copy">
          <div class="episode-create__actions-title">{{ t('create.episode.nextTitle') }}</div>
          <div class="episode-create__actions-text">{{ t('create.episode.nextDescription') }}</div>
        </div>
        <div class="episode-create__actions-buttons">
          <el-button plain @click="emit('back')">{{ t('create.mode.back') }}</el-button>
          <el-button type="primary" size="large" :loading="isCreating" @click="submitCreate">
            {{ t('create.form.submit') }}
          </el-button>
        </div>
      </section>
    </el-form>
  </div>
</template>

<style scoped>
.episode-create,
.episode-create__hero,
.episode-create__summary,
.episode-create__form,
.episode-create__card-grid {
  display: grid;
  gap: 16px;
}

.episode-create__hero,
.episode-create__summary-card,
.episode-create__card,
.episode-create__actions {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    var(--surface-panel-wash),
    var(--bg-panel);
}

.episode-create__hero,
.episode-create__actions {
  padding: 18px 20px;
}

.episode-create__summary {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.episode-create__summary-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px;
}

.episode-create__summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--surface-brand-fill-strong);
  color: var(--brand);
  font-size: 18px;
}

.episode-create__eyebrow,
.episode-create__summary-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.episode-create__title,
.episode-create__card-title,
.episode-create__actions-title {
  margin: 8px 0 0;
  font-family: var(--font-display);
  font-size: clamp(22px, 2vw, 28px);
  letter-spacing: -0.04em;
}

.episode-create__description,
.episode-create__card-text,
.episode-create__actions-text,
.episode-create__summary-value {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.episode-create__card-grid {
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}

.episode-create__card {
  padding: 18px;
}

.episode-create__item {
  margin: 14px 0 0;
}

.episode-create__item :deep(.el-form-item__content) {
  display: block;
}

.episode-create__item :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 14px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.episode-create__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.episode-create__actions-buttons {
  display: flex;
  gap: 12px;
  align-items: center;
}

@media (max-width: 960px) {
  .episode-create__actions,
  .episode-create__actions-buttons {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
