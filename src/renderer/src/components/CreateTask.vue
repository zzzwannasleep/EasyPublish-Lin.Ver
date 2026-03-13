<script setup lang="ts" name="ProjectCreateForm">
import { computed, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { FolderOpened } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { CreateProjectInput } from '../types/project'

type CreateProjectForm = CreateProjectInput

const router = useRouter()
const { t } = useI18n()
const createForm = ref<FormInstance>()
const isCreating = ref(false)
const isPickingFolder = ref(false)

const form = reactive<CreateProjectForm>({
  name: '',
  sourceKind: 'quick',
  workingDirectory: '',
})

const sourceOptions = computed(() => [
  {
    value: 'quick',
    label: t('create.form.source.quick.label'),
    description: t('create.form.source.quick.description'),
  },
  {
    value: 'file',
    label: t('create.form.source.file.label'),
    description: t('create.form.source.file.description'),
  },
  {
    value: 'template',
    label: t('create.form.source.template.label'),
    description: t('create.form.source.template.description'),
  },
])

const rules = computed<FormRules<CreateProjectForm>>(() => ({
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
      <el-form-item :label="t('create.form.name.label')" prop="name">
        <el-input v-model="form.name" :placeholder="t('create.form.name.placeholder')" />
      </el-form-item>

      <el-form-item :label="t('create.form.directory.label')" prop="workingDirectory">
        <el-input v-model="form.workingDirectory" :placeholder="t('create.form.directory.placeholder')">
          <template #append>
            <el-button :icon="FolderOpened" @click="pickFolder" v-loading.fullscreen.lock="isPickingFolder" />
          </template>
        </el-input>
      </el-form-item>

      <el-form-item :label="t('create.form.source.label')" prop="sourceKind">
        <el-radio-group v-model="form.sourceKind" class="create-project__options">
          <label
            v-for="option in sourceOptions"
            :key="option.value"
            class="create-project__option"
            :class="{ 'is-active': form.sourceKind === option.value }"
          >
            <el-radio :value="option.value">
              <span class="create-project__option-label">{{ option.label }}</span>
            </el-radio>
            <span class="create-project__option-text">{{ option.description }}</span>
          </label>
        </el-radio-group>
      </el-form-item>

      <div class="create-project__actions">
        <el-button type="primary" size="large" :loading="isCreating" @click="submitCreate(createForm)">
          {{ t('create.form.submit') }}
        </el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.create-project {
  width: 100%;
}

.create-project__form {
  max-width: 880px;
}

.create-project__options {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.create-project__option {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.58);
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.create-project__option:hover,
.create-project__option.is-active {
  transform: translateY(-1px);
  border-color: rgba(198, 90, 46, 0.24);
  background: linear-gradient(135deg, var(--brand-soft), rgba(255, 255, 255, 0.5));
}

.create-project__option-label {
  font-weight: 700;
}

.create-project__option-text {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.create-project__actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 28px;
}

@media (max-width: 980px) {
  .create-project__options {
    grid-template-columns: 1fr;
  }
}
</style>
