<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { ProjectMode } from '../types/project'
import { useRouter } from 'vue-router'
import { Collection, Document, Film, FolderOpened, Loading } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import { projectBridge } from '../services/bridge/project'
import type { CreateProjectInput } from '../types/project'

const props = defineProps<{
  mode: ProjectMode
}>()

const emit = defineEmits<{
  back: []
}>()

const router = useRouter()
const { t } = useI18n()
const isCreating = ref(false)
const isPickingFolder = ref(false)

const form = reactive<CreateProjectInput>({
  name: '',
  projectMode: props.mode,
  workingDirectory: '',
  plannedEpisodeCount: props.mode === 'episode' ? undefined : undefined,
})

const isEpisodeMode = computed(() => props.mode === 'episode')
const modeIcon = computed(() => (isEpisodeMode.value ? Collection : Film))
const titleText = computed(() =>
  isEpisodeMode.value ? t('create.episode.title') : t('create.feature.title'),
)
const descriptionText = computed(() =>
  isEpisodeMode.value ? t('create.episode.description') : t('create.feature.description'),
)
const alertText = computed(() =>
  isEpisodeMode.value ? t('create.episode.alert') : t('create.feature.alert'),
)
const nameHelpText = computed(() =>
  isEpisodeMode.value ? t('create.episode.nameHelp') : t('create.feature.nameHelp'),
)
const directoryHelpText = computed(() =>
  isEpisodeMode.value ? t('create.episode.directoryHelp') : t('create.feature.directoryHelp'),
)
const nextDescriptionText = computed(() =>
  isEpisodeMode.value ? t('create.episode.nextDescription') : t('create.feature.nextDescription'),
)
const successMessage = computed(() =>
  isEpisodeMode.value ? t('create.episode.success') : t('create.feature.success'),
)

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
      message: successMessage.value,
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
  <div class="project-shell-create">
    <el-form :model="form" label-position="top" class="project-shell-create__form">
      <section class="project-shell-create__hero">
        <div class="project-shell-create__hero-copy">
          <div class="project-shell-create__mode-mark">
            <span class="project-shell-create__mode-icon">
              <el-icon><component :is="modeIcon" /></el-icon>
            </span>
            <span class="project-shell-create__mode-label">{{ t(`create.mode.${mode}.label`) }}</span>
          </div>
          <h3 class="project-shell-create__title">{{ titleText }}</h3>
          <p class="project-shell-create__description">{{ descriptionText }}</p>
        </div>

        <el-alert :title="alertText" type="info" :closable="false" show-icon />
      </section>

      <section class="project-shell-create__panel">
        <div class="project-shell-create__field-grid">
          <article class="project-shell-create__field-card">
            <div class="project-shell-create__field-label">
              <span class="project-shell-create__field-icon">
                <el-icon><Document /></el-icon>
              </span>
              <div>
                <div class="project-shell-create__field-title">{{ t('create.form.name.label') }}</div>
                <div class="project-shell-create__field-text">{{ nameHelpText }}</div>
              </div>
            </div>
            <el-form-item class="project-shell-create__item">
              <el-input v-model="form.name" size="large" :placeholder="t('create.form.name.placeholder')" />
            </el-form-item>
          </article>

          <article class="project-shell-create__field-card">
            <div class="project-shell-create__field-label">
              <span class="project-shell-create__field-icon">
                <el-icon><FolderOpened /></el-icon>
              </span>
              <div>
                <div class="project-shell-create__field-title">{{ t('create.form.directory.label') }}</div>
                <div class="project-shell-create__field-text">{{ directoryHelpText }}</div>
              </div>
            </div>
            <el-form-item class="project-shell-create__item">
              <el-input
                v-model="form.workingDirectory"
                size="large"
                :placeholder="t('create.form.directory.placeholder')"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="project-shell-create__picker"
                    :disabled="isPickingFolder"
                    :title="t('create.form.directory.label')"
                    :aria-label="t('create.form.directory.label')"
                    @click="pickFolder"
                  >
                    <el-icon class="project-shell-create__picker-icon" :class="{ 'is-spinning': isPickingFolder }">
                      <component :is="isPickingFolder ? Loading : FolderOpened" />
                    </el-icon>
                  </button>
                </template>
              </el-input>
            </el-form-item>
          </article>
        </div>
      </section>

      <section class="project-shell-create__actions">
        <div class="project-shell-create__actions-copy">
          <div class="project-shell-create__actions-title">{{ t('create.episode.nextTitle') }}</div>
          <div class="project-shell-create__actions-text">{{ nextDescriptionText }}</div>
        </div>
        <div class="project-shell-create__actions-buttons">
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
.project-shell-create,
.project-shell-create__form {
  width: 100%;
}

.project-shell-create__form {
  display: grid;
  gap: 18px;
}

.project-shell-create__hero,
.project-shell-create__panel,
.project-shell-create__actions {
  border: 1px solid var(--border-soft);
  border-radius: calc(var(--radius-xl) + 4px);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--brand-soft) 92%, white 8%), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.46), transparent 44%),
    var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.project-shell-create__hero,
.project-shell-create__panel {
  padding: clamp(18px, 2.4vw, 26px);
}

.project-shell-create__hero {
  display: grid;
  gap: 16px;
}

.project-shell-create__hero-copy {
  display: grid;
  gap: 10px;
}

.project-shell-create__mode-mark {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 74%, var(--bg-panel) 26%);
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

.project-shell-create__mode-icon,
.project-shell-create__field-icon {
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

.project-shell-create__mode-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  font-size: 16px;
}

.project-shell-create__title,
.project-shell-create__actions-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(22px, 2vw, 28px);
  letter-spacing: -0.04em;
}

.project-shell-create__description,
.project-shell-create__field-text,
.project-shell-create__actions-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.project-shell-create__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.project-shell-create__field-card {
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-soft-fill) 90%, white 10%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.project-shell-create__field-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.project-shell-create__field-title {
  font-size: 15px;
  font-weight: 700;
}

.project-shell-create__item {
  margin: 16px 0 0;
}

.project-shell-create__item :deep(.el-form-item__content) {
  display: block;
}

.project-shell-create__item :deep(.el-input__wrapper) {
  min-height: 52px;
  border-radius: 16px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.project-shell-create__item :deep(.el-input__suffix),
.project-shell-create__item :deep(.el-input__suffix-inner) {
  display: flex;
  align-items: center;
  gap: 0;
}

.project-shell-create__picker {
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

.project-shell-create__picker:hover:not(:disabled) {
  background: color-mix(in srgb, var(--brand-soft) 76%, white 24%);
  border-color: color-mix(in srgb, var(--brand) 18%, transparent);
  transform: translateY(-1px);
}

.project-shell-create__picker:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--brand) 28%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-soft) 72%, transparent);
}

.project-shell-create__picker:disabled {
  cursor: wait;
  opacity: 0.9;
}

.project-shell-create__picker-icon {
  font-size: 18px;
}

.project-shell-create__picker-icon.is-spinning {
  animation: project-shell-create-spin 1s linear infinite;
}

.project-shell-create__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: clamp(16px, 2vw, 22px);
}

.project-shell-create__actions-buttons {
  display: flex;
  gap: 12px;
}

@keyframes project-shell-create-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 860px) {
  .project-shell-create__field-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .project-shell-create__actions,
  .project-shell-create__actions-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .project-shell-create__actions :deep(.el-button) {
    width: 100%;
  }
}
</style>
