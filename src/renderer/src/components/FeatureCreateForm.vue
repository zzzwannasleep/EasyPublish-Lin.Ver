<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Component } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { Document, Files, FolderOpened, Grid, Promotion } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { CreateProjectInput, ProjectSourceKind } from '../types/project'

type FeatureCreateFormModel = CreateProjectInput & {
  projectMode: 'feature'
  sourceKind: ProjectSourceKind
}

type SourceOption = {
  value: ProjectSourceKind
  label: string
  description: string
  icon: Component
}

type SummaryItem = {
  label: string
  value: string
  icon: Component
}

const emit = defineEmits<{
  back: []
}>()

const router = useRouter()
const { t } = useI18n()
const createForm = ref<FormInstance>()
const isCreating = ref(false)
const isPickingFolder = ref(false)

const form = reactive<FeatureCreateFormModel>({
  name: '',
  projectMode: 'feature',
  sourceKind: 'quick',
  workingDirectory: '',
})

const sourceOptions = computed<SourceOption[]>(() => [
  {
    value: 'quick',
    label: t('create.form.source.quick.label'),
    description: t('create.form.source.quick.description'),
    icon: Promotion,
  },
  {
    value: 'file',
    label: t('create.form.source.file.label'),
    description: t('create.form.source.file.description'),
    icon: Files,
  },
  {
    value: 'template',
    label: t('create.form.source.template.label'),
    description: t('create.form.source.template.description'),
    icon: Grid,
  },
])

const selectedSource = computed<SourceOption>(() => {
  return sourceOptions.value.find(option => option.value === form.sourceKind) ?? sourceOptions.value[0]
})

const summaryItems = computed<SummaryItem[]>(() => [
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
    label: t('create.form.source.label'),
    value: selectedSource.value.label,
    icon: Grid,
  },
])

const rules = computed<FormRules<FeatureCreateFormModel>>(() => ({
  sourceKind: [
    {
      required: true,
      message: t('create.validation.sourceKind'),
      trigger: 'change',
    },
  ],
}))

async function pickFolder() {
  isPickingFolder.value = true
  try {
    const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFolderPath())
    form.workingDirectory = path
  } finally {
    isPickingFolder.value = false
  }
}

async function submitCreate(formEl: FormInstance | undefined) {
  if (!formEl) {
    return
  }

  isCreating.value = true
  try {
    const isValid = await formEl.validate().catch(() => false)
    if (!isValid) {
      ElMessage.error(t('create.validation.completeRequired'))
      return
    }

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
      message: t('create.success.created'),
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
  <div class="create-project">
    <el-form ref="createForm" :model="form" :rules="rules" label-position="top" class="create-project__form">
      <section class="create-project__overview">
        <div class="create-project__overview-head">
          <div class="create-project__source-mark">
            <div class="create-project__source-icon">
              <el-icon><component :is="selectedSource.icon" /></el-icon>
            </div>
            <div class="create-project__source-copy">
              <div class="create-project__source-label">{{ t('create.form.source.label') }}</div>
              <h3 class="create-project__source-title">{{ selectedSource.label }}</h3>
            </div>
          </div>
          <p class="create-project__overview-text">{{ selectedSource.description }}</p>
        </div>

        <div class="create-project__summary-grid">
          <article v-for="item in summaryItems" :key="item.label" class="create-project__summary-card">
            <div class="create-project__summary-icon">
              <el-icon><component :is="item.icon" /></el-icon>
            </div>
            <div class="create-project__summary-copy">
              <div class="create-project__summary-label">{{ item.label }}</div>
              <div class="create-project__summary-value">{{ item.value }}</div>
            </div>
          </article>
        </div>
      </section>

      <section class="create-project__section">
        <div class="create-project__section-head">
          <span class="create-project__section-step">01</span>
          <div>
            <h3 class="create-project__section-title">{{ t('projectCreate.panel.title') }}</h3>
            <p class="create-project__section-text">{{ t('projectCreate.panel.description') }}</p>
          </div>
        </div>

        <div class="create-project__field-grid">
          <article class="create-project__field-card">
            <div class="create-project__field-head">
              <div class="create-project__field-icon">
                <el-icon><Document /></el-icon>
              </div>
              <div>
                <div class="create-project__field-title">{{ t('create.form.name.label') }}</div>
                <div class="create-project__field-text">{{ t('create.form.name.placeholder') }}</div>
              </div>
            </div>

            <el-form-item prop="name" class="create-project__item">
              <el-input v-model="form.name" size="large" :placeholder="t('create.form.name.placeholder')" />
            </el-form-item>
          </article>

          <article class="create-project__field-card">
            <div class="create-project__field-head">
              <div class="create-project__field-icon">
                <el-icon><FolderOpened /></el-icon>
              </div>
              <div>
                <div class="create-project__field-title">{{ t('create.form.directory.label') }}</div>
                <div class="create-project__field-text">{{ t('create.form.directory.placeholder') }}</div>
              </div>
            </div>

            <el-form-item prop="workingDirectory" class="create-project__item">
              <el-input
                v-model="form.workingDirectory"
                size="large"
                :placeholder="t('create.form.directory.placeholder')"
              >
                <template #append>
                  <el-button
                    :icon="FolderOpened"
                    :loading="isPickingFolder"
                    class="create-project__picker"
                    @click="pickFolder"
                  />
                </template>
              </el-input>
            </el-form-item>
          </article>
        </div>
      </section>

      <section class="create-project__section">
        <div class="create-project__section-head">
          <span class="create-project__section-step">02</span>
          <div>
            <h3 class="create-project__section-title">{{ t('create.form.source.label') }}</h3>
            <p class="create-project__section-text">{{ selectedSource.description }}</p>
          </div>
        </div>

        <el-form-item prop="sourceKind" class="create-project__item">
          <el-radio-group v-model="form.sourceKind" class="create-project__options">
            <label
              v-for="option in sourceOptions"
              :key="option.value"
              class="create-project__option"
              :class="{ 'is-active': form.sourceKind === option.value }"
            >
              <div class="create-project__option-head">
                <div class="create-project__option-icon">
                  <el-icon><component :is="option.icon" /></el-icon>
                </div>
                <div class="create-project__option-copy">
                  <el-radio :value="option.value">
                    <span class="create-project__option-label">{{ option.label }}</span>
                  </el-radio>
                  <span class="create-project__option-text">{{ option.description }}</span>
                </div>
              </div>
            </label>
          </el-radio-group>
        </el-form-item>
      </section>

      <section class="create-project__actions">
        <div class="create-project__actions-copy">
          <div class="create-project__actions-title">{{ t('create.form.submit') }}</div>
          <div class="create-project__actions-text">{{ t('create.feature.actionsText') }}</div>
        </div>
        <div class="create-project__actions-buttons">
          <el-button plain @click="emit('back')">{{ t('create.mode.back') }}</el-button>
          <el-button
            type="primary"
            size="large"
            class="create-project__submit"
            :loading="isCreating"
            @click="submitCreate(createForm)"
          >
            {{ t('create.form.submit') }}
          </el-button>
        </div>
      </section>
    </el-form>
  </div>
</template>

<style scoped>
.create-project,
.create-project__form {
  width: 100%;
}

.create-project__form {
  display: grid;
  gap: 18px;
}

.create-project__overview,
.create-project__section,
.create-project__actions {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    var(--surface-panel-wash),
    var(--bg-panel);
}

.create-project__overview,
.create-project__section {
  padding: clamp(16px, 2vw, 22px);
}

.create-project__overview {
  display: grid;
  gap: 18px;
}

.create-project__overview-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 0.9fr);
  gap: 16px;
  align-items: center;
}

.create-project__source-mark,
.create-project__summary-card,
.create-project__field-card,
.create-project__option {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-soft-fill);
}

.create-project__source-mark {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
}

.create-project__source-icon,
.create-project__summary-icon,
.create-project__field-icon,
.create-project__option-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--surface-brand-fill-strong);
  color: var(--brand);
  font-size: 18px;
  flex: none;
}

.create-project__source-copy,
.create-project__summary-copy,
.create-project__option-copy {
  min-width: 0;
}

.create-project__source-label,
.create-project__summary-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.create-project__source-title,
.create-project__section-title,
.create-project__actions-title {
  margin: 6px 0 0;
  font-family: var(--font-display);
  font-size: clamp(20px, 2vw, 24px);
  letter-spacing: -0.03em;
}

.create-project__overview-text,
.create-project__section-text,
.create-project__actions-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.create-project__summary-grid,
.create-project__field-grid,
.create-project__options {
  display: grid;
  gap: 14px;
}

.create-project__summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.create-project__summary-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px;
}

.create-project__summary-value {
  margin-top: 6px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.create-project__section {
  display: grid;
  gap: 18px;
}

.create-project__section-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.create-project__section-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 38px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
}

.create-project__field-grid {
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}

.create-project__field-card {
  padding: 18px;
}

.create-project__field-head,
.create-project__option-head {
  display: flex;
  gap: 12px;
}

.create-project__field-head {
  align-items: flex-start;
  margin-bottom: 16px;
}

.create-project__field-icon {
  background: var(--surface-subtle-fill);
  color: var(--accent);
}

.create-project__field-title,
.create-project__option-label {
  font-size: 15px;
  font-weight: 700;
}

.create-project__field-text,
.create-project__option-text {
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.create-project__item {
  margin-bottom: 0;
}

.create-project__item :deep(.el-form-item__content) {
  display: block;
}

.create-project__item :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 14px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.create-project__item :deep(.el-input-group__append) {
  padding: 0 10px;
  border-radius: 0 14px 14px 0;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.create-project__picker {
  min-height: 38px;
  border: 0;
  background: transparent;
}

.create-project__options {
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  width: 100%;
}

.create-project__option {
  padding: 18px;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.create-project__option:hover,
.create-project__option.is-active {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  box-shadow: var(--shadow-md);
}

.create-project__option-icon {
  background: var(--surface-subtle-fill);
}

.create-project__option :deep(.el-radio) {
  margin-right: 0;
}

.create-project__option :deep(.el-radio__label) {
  display: inline-flex;
  min-width: 0;
  padding-left: 10px;
}

.create-project__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: clamp(16px, 2vw, 22px);
}

.create-project__actions-copy {
  min-width: 0;
}

.create-project__actions-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.create-project__submit {
  min-width: clamp(11rem, 24vw, 14rem);
}

@media (max-width: 980px) {
  .create-project__overview-head {
    grid-template-columns: 1fr;
  }

  .create-project__actions,
  .create-project__actions-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .create-project__submit {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 720px) {
  .create-project__source-mark,
  .create-project__summary-card,
  .create-project__field-card,
  .create-project__option {
    padding: 14px;
  }
}
</style>
