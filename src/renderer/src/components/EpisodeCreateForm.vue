<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Document, FolderOpened, Loading } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { CreateProjectInput } from '../types/project'

type EpisodeCreateFormModel = CreateProjectInput & {
  projectMode: 'episode'
}

const router = useRouter()
const { t } = useI18n()
const isCreating = ref(false)
const isPickingFolder = ref(false)

const form = reactive<EpisodeCreateFormModel>({
  name: '',
  projectMode: 'episode',
  workingDirectory: '',
  plannedEpisodeCount: undefined,
})

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
    <el-form :model="form" label-position="top" class="episode-create__form">
      <section class="episode-create__panel">
        <div class="episode-create__field-grid">
          <article class="episode-create__field-card">
            <div class="episode-create__field-label">
              <span class="episode-create__field-icon">
                <el-icon><Document /></el-icon>
              </span>
              <span>{{ t('create.form.name.label') }}</span>
            </div>
            <el-form-item class="episode-create__item">
              <el-input v-model="form.name" size="large" :placeholder="t('create.form.name.placeholder')" />
            </el-form-item>
          </article>

          <article class="episode-create__field-card">
            <div class="episode-create__field-label">
              <span class="episode-create__field-icon">
                <el-icon><FolderOpened /></el-icon>
              </span>
              <span>{{ t('create.form.directory.label') }}</span>
            </div>
            <el-form-item class="episode-create__item">
              <el-input
                v-model="form.workingDirectory"
                size="large"
                :placeholder="t('create.form.directory.placeholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="episode-create__picker"
                    :disabled="isPickingFolder"
                    :title="t('create.form.directory.label')"
                    :aria-label="t('create.form.directory.label')"
                    @click="pickFolder"
                  >
                    <el-icon class="episode-create__picker-icon" :class="{ 'is-spinning': isPickingFolder }">
                      <component :is="isPickingFolder ? Loading : FolderOpened" />
                    </el-icon>
                  </button>
                </template>
              </el-input>
            </el-form-item>
          </article>
        </div>
      </section>

      <section class="episode-create__actions">
        <el-button type="primary" size="large" :loading="isCreating" @click="submitCreate">
          {{ t('create.form.submit') }}
        </el-button>
      </section>
    </el-form>
  </div>
</template>

<style scoped>
.episode-create,
.episode-create__form {
  width: 100%;
}

.episode-create__form {
  display: grid;
  gap: 18px;
}

.episode-create__panel {
  position: relative;
  overflow: hidden;
  padding: clamp(18px, 2.4vw, 26px);
  border: 1px solid var(--border-soft);
  border-radius: calc(var(--radius-xl) + 4px);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--brand-soft) 92%, white 8%), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.46), transparent 44%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.episode-create__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.episode-create__field-card {
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-soft-fill) 90%, white 10%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.episode-create__field-label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  font-weight: 700;
}

.episode-create__field-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--brand-soft) 68%, white 32%);
  color: var(--brand);
  font-size: 18px;
  flex: none;
}

.episode-create__item {
  margin: 16px 0 0;
}

.episode-create__item :deep(.el-form-item__content) {
  display: block;
}

.episode-create__item :deep(.el-input__wrapper) {
  min-height: 52px;
  border-radius: 16px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.episode-create__item :deep(.el-input__suffix) {
  display: flex;
  align-items: center;
}

.episode-create__item :deep(.el-input__suffix-inner) {
  display: flex;
  align-items: center;
  gap: 0;
}

.episode-create__picker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  background: color-mix(in srgb, var(--brand-soft) 62%, white 38%);
  color: var(--brand);
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.episode-create__picker:hover:not(:disabled) {
  background: color-mix(in srgb, var(--brand-soft) 76%, white 24%);
  border-color: color-mix(in srgb, var(--brand) 18%, transparent);
  transform: translateY(-1px);
}

.episode-create__picker:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--brand) 28%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-soft) 72%, transparent);
}

.episode-create__picker:disabled {
  cursor: wait;
  opacity: 0.9;
}

.episode-create__picker-icon {
  font-size: 18px;
}

.episode-create__picker-icon.is-spinning {
  animation: episode-create-spin 1s linear infinite;
}

.episode-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@keyframes episode-create-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 860px) {
  .episode-create__field-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .episode-create__actions {
    flex-direction: column;
  }

  .episode-create__actions :deep(.el-button) {
    width: 100%;
  }
}
</style>
