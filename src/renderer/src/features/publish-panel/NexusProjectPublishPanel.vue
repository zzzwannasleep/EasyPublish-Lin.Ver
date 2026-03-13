<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { useI18n } from '../../i18n'
import { useProjectContext } from '../project-detail/project-context'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import { getPublishStateLabel, publishStateTones } from '../../services/project/presentation'
import type { PublishResult, SitePublishDraft } from '../../types/publish'
import type {
  SiteAccountValidationPayload,
  SiteCatalogEntry,
  SiteId,
  SiteMetadataRecord,
  SitePublishValidationPayload,
  SiteSection,
} from '../../types/site'

interface SitePublishDraftForm {
  title: string
  description: string
  torrentPath: string
  smallDescription: string
  url: string
  technicalInfo: string
  ptGen: string
  price: string
  tagIds: number[]
  posState: string
  posStateUntil: string
  pickType: string
  anonymous: boolean
  sectionId?: number
  typeId?: number
  subCategories: Record<string, number | undefined>
  nfoPath: string
}

const props = defineProps<{
  id: number
}>()

const { t } = useI18n()
const { project, refreshProject } = useProjectContext()

const isBootstrapping = ref(false)
const bootstrapError = ref('')
const sites = ref<SiteCatalogEntry[]>([])
const metadataBySite = ref<Partial<Record<SiteId, SiteMetadataRecord>>>({})
const metadataErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const metadataLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const accountValidationBySite = ref<Partial<Record<SiteId, SiteAccountValidationPayload>>>({})
const accountValidationLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishDrafts = ref<Partial<Record<SiteId, SitePublishDraftForm>>>({})
const publishValidationBySite = ref<Partial<Record<SiteId, SitePublishValidationPayload>>>({})
const publishValidationLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const publishLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const publishResultBySite = ref<Partial<Record<SiteId, PublishResult>>>({})

const descriptionPreview = computed(() => {
  const total = Object.keys(metadataBySite.value).length
  return total > 0 ? t('nexus.hero.loadedMetadata', { count: total }) : t('nexus.hero.noMetadata')
})

function isMetadataLoading(siteId: SiteId) {
  return Boolean(metadataLoadingBySite.value[siteId])
}

function isAccountValidationLoading(siteId: SiteId) {
  return Boolean(accountValidationLoadingBySite.value[siteId])
}

function isPublishValidationLoading(siteId: SiteId) {
  return Boolean(publishValidationLoadingBySite.value[siteId])
}

function isPublishLoading(siteId: SiteId) {
  return Boolean(publishLoadingBySite.value[siteId])
}

function getMetadata(siteId: SiteId) {
  return metadataBySite.value[siteId]
}

function getMetadataError(siteId: SiteId) {
  return metadataErrorBySite.value[siteId]
}

function getAccountValidation(siteId: SiteId) {
  return accountValidationBySite.value[siteId]
}

function getPublishValidation(siteId: SiteId) {
  return publishValidationBySite.value[siteId]
}

function getPublishError(siteId: SiteId) {
  return publishErrorBySite.value[siteId]
}

function getPublishResult(siteId: SiteId) {
  return publishResultBySite.value[siteId]
}

function getAccountStatusLabel(siteId: SiteId) {
  const status = getAccountValidation(siteId)?.status
  if (status === 'authenticated') {
    return t('nexus.account.authenticated')
  }
  if (status === 'unauthenticated') {
    return t('nexus.account.unauthenticated')
  }
  return t('nexus.account.error')
}

function joinProjectPath(basePath: string, fileName: string) {
  if (!basePath || !fileName) {
    return ''
  }

  const separator = basePath.includes('\\') ? '\\' : '/'
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${fileName.replace(/^[\\/]+/, '')}`
}

function createEmptyDraft(): SitePublishDraftForm {
  return {
    title: '',
    description: '',
    torrentPath: '',
    smallDescription: '',
    url: '',
    technicalInfo: '',
    ptGen: '',
    price: '',
    tagIds: [],
    posState: 'normal',
    posStateUntil: '',
    pickType: 'normal',
    anonymous: false,
    sectionId: undefined,
    typeId: undefined,
    subCategories: {},
    nfoPath: '',
  }
}

function createInitialDraft(config: Config.PublishConfig, content: Message.Task.TaskContents): SitePublishDraftForm {
  const draft = createEmptyDraft()
  draft.title = config.title ?? content.title ?? ''
  draft.description = content.html ?? ''
  draft.url = config.information ?? ''
  draft.torrentPath =
    config.torrentName && project.value?.workingDirectory
      ? joinProjectPath(project.value.workingDirectory, config.torrentName)
      : config.torrentPath ?? ''
  return draft
}

function ensureDraft(siteId: SiteId): SitePublishDraftForm {
  if (!publishDrafts.value[siteId]) {
    publishDrafts.value[siteId] = createEmptyDraft()
  }

  return publishDrafts.value[siteId] as SitePublishDraftForm
}

function resetSectionDependentFields(siteId: SiteId, section?: SiteSection) {
  const draft = ensureDraft(siteId)
  draft.typeId = section?.categories[0]?.id
  draft.tagIds = []
  draft.subCategories = Object.fromEntries(
    (section?.subCategories ?? []).map(subCategory => [subCategory.field, undefined]),
  )
}

function applyMetadataDefaults(siteId: SiteId, metadata: SiteMetadataRecord) {
  const draft = ensureDraft(siteId)
  draft.sectionId = metadata.sections[0]?.id
  resetSectionDependentFields(siteId, metadata.sections[0])
}

function getSelectedSection(siteId: SiteId) {
  const metadata = getMetadata(siteId)
  const draft = ensureDraft(siteId)
  return metadata?.sections.find(section => section.id === draft.sectionId) ?? metadata?.sections[0]
}

function onSectionChange(siteId: SiteId) {
  resetSectionDependentFields(siteId, getSelectedSection(siteId))
}

function buildPublishInput(siteId: SiteId): SitePublishDraft {
  const draft = ensureDraft(siteId)

  return {
    projectId: props.id,
    siteId,
    typeId: draft.typeId ?? 0,
    title: draft.title.trim(),
    description: draft.description.trim(),
    torrentPath: draft.torrentPath.trim(),
    smallDescription: draft.smallDescription.trim() || undefined,
    url: draft.url.trim() || undefined,
    technicalInfo: draft.technicalInfo.trim() || undefined,
    ptGen: draft.ptGen.trim() || undefined,
    price: draft.price.trim() ? Number(draft.price.trim()) : undefined,
    tagIds: draft.tagIds.length > 0 ? [...draft.tagIds] : undefined,
    posState: draft.posState,
    posStateUntil: draft.posStateUntil.trim() || undefined,
    pickType: draft.pickType,
    anonymous: draft.anonymous,
    subCategories: Object.entries(draft.subCategories).reduce<Record<string, number>>(
      (accumulator, [field, value]) => {
        if (typeof value === 'number' && value > 0) {
          accumulator[field] = value
        }
        return accumulator
      },
      {},
    ),
    nfoPath: draft.nfoPath.trim() || undefined,
  }
}

async function chooseFile(siteId: SiteId, field: 'torrentPath' | 'nfoPath', extension: string) {
  const message: Message.Global.FileType = { type: extension }
  const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFilePath(JSON.stringify(message)))
  if (path) {
    ensureDraft(siteId)[field] = path
  }
}

async function validateAccount(siteId: SiteId) {
  accountValidationLoadingBySite.value[siteId] = true

  try {
    const result = await siteBridge.validateAccount(siteId)
    if (!result.ok) {
      accountValidationBySite.value[siteId] = {
        siteId,
        status: 'error',
        message: result.error.message,
      }
      return
    }

    accountValidationBySite.value[siteId] = result.data
  } catch (error) {
    accountValidationBySite.value[siteId] = {
      siteId,
      status: 'error',
      message: (error as Error).message,
    }
  } finally {
    accountValidationLoadingBySite.value[siteId] = false
  }
}

async function loadMetadata(siteId: SiteId) {
  metadataLoadingBySite.value[siteId] = true
  metadataErrorBySite.value[siteId] = ''

  try {
    const result = await siteBridge.loadMetadata(siteId)
    if (!result.ok) {
      metadataBySite.value[siteId] = undefined
      metadataErrorBySite.value[siteId] = result.error.message
      return
    }

    metadataBySite.value[siteId] = result.data.metadata
    applyMetadataDefaults(siteId, result.data.metadata)
  } catch (error) {
    metadataBySite.value[siteId] = undefined
    metadataErrorBySite.value[siteId] = (error as Error).message
  } finally {
    metadataLoadingBySite.value[siteId] = false
  }
}

async function validatePublish(siteId: SiteId) {
  publishValidationLoadingBySite.value[siteId] = true
  publishErrorBySite.value[siteId] = ''

  try {
    const result = await siteBridge.validatePublish(buildPublishInput(siteId))
    if (!result.ok) {
      publishValidationBySite.value[siteId] = {
        siteId,
        valid: false,
        issues: [
          {
            field: 'publish',
            message: result.error.message,
            severity: 'error',
          },
        ],
      }
      return false
    }

    publishValidationBySite.value[siteId] = result.data
    return result.data.valid
  } catch (error) {
    publishValidationBySite.value[siteId] = {
      siteId,
      valid: false,
      issues: [
        {
          field: 'publish',
          message: (error as Error).message,
          severity: 'error',
        },
      ],
    }
    return false
  } finally {
    publishValidationLoadingBySite.value[siteId] = false
  }
}

async function publishSite(siteId: SiteId) {
  publishLoadingBySite.value[siteId] = true
  publishErrorBySite.value[siteId] = ''

  try {
    const isValid = await validatePublish(siteId)
    if (!isValid) {
      publishResultBySite.value[siteId] = undefined
      publishErrorBySite.value[siteId] = t('nexus.validation.fixIssues')
      return
    }

    const result = await siteBridge.publish(buildPublishInput(siteId))
    if (!result.ok) {
      publishResultBySite.value[siteId] = undefined
      publishErrorBySite.value[siteId] = result.error.message
      return
    }

    publishResultBySite.value[siteId] = result.data.result
    await refreshProject()
  } catch (error) {
    publishResultBySite.value[siteId] = undefined
    publishErrorBySite.value[siteId] = (error as Error).message
  } finally {
    publishLoadingBySite.value[siteId] = false
  }
}

function formatRawResponse(rawResponse: unknown) {
  if (rawResponse === undefined) {
    return ''
  }

  return JSON.stringify(rawResponse, null, 2)
}

async function bootstrap() {
  isBootstrapping.value = true
  bootstrapError.value = ''

  try {
    const [siteResult, content, config] = await Promise.all([
      siteBridge.listSites(),
      taskBridge.getContent(props.id),
      taskBridge.getPublishConfig(props.id),
    ])

    if (!siteResult.ok) {
      bootstrapError.value = siteResult.error.message
      sites.value = []
      return
    }

    sites.value = siteResult.data.sites.filter(site => site.adapter === 'nexusphp')
    sites.value.forEach(site => {
      publishDrafts.value[site.id] = createInitialDraft(config, content)
      publishErrorBySite.value[site.id] = ''
      publishResultBySite.value[site.id] = undefined
      publishValidationBySite.value[site.id] = undefined
      accountValidationBySite.value[site.id] = undefined
    })
  } catch (error) {
    bootstrapError.value = (error as Error).message
  } finally {
    isBootstrapping.value = false
  }
}

onMounted(() => {
  void bootstrap()
})
</script>

<template>
  <section class="nexus-panel">
    <header class="nexus-panel__header">
      <div>
        <div class="nexus-panel__eyebrow">{{ t('nexus.hero.eyebrow') }}</div>
        <h3 class="nexus-panel__title">{{ t('nexus.hero.title') }}</h3>
        <p class="nexus-panel__description">
          {{ t('nexus.hero.descriptionPrefix', { summary: descriptionPreview }) }}
        </p>
      </div>
      <StatusChip tone="success">{{ t('nexus.hero.count', { count: sites.length }) }}</StatusChip>
    </header>

    <div v-if="isBootstrapping" class="nexus-panel__empty">{{ t('nexus.empty.loading') }}</div>
    <div v-else-if="bootstrapError" class="nexus-panel__empty nexus-panel__empty--danger">
      {{ bootstrapError }}
    </div>
    <div v-else class="nexus-site-list">
      <article v-for="site in sites" :key="site.id" class="nexus-site-card">
        <header class="nexus-site-card__header">
          <div>
            <div class="nexus-site-card__name">{{ site.name }}</div>
            <div class="nexus-site-card__endpoint">{{ site.apiBaseUrl || site.normalizedBaseUrl }}</div>
          </div>
          <div class="nexus-site-card__header-actions">
            <el-button
              :loading="isAccountValidationLoading(site.id)"
              type="primary"
              plain
              @click="validateAccount(site.id)"
            >
              {{ t('nexus.actions.validateAccount') }}
            </el-button>
            <el-button :loading="isMetadataLoading(site.id)" type="primary" plain @click="loadMetadata(site.id)">
              {{ getMetadata(site.id) ? t('nexus.actions.reloadMetadata') : t('nexus.actions.loadMetadata') }}
            </el-button>
          </div>
        </header>

        <div v-if="getAccountValidation(site.id)" class="nexus-site-card__account-status">
          <StatusChip
            :tone="
              getAccountValidation(site.id)?.status === 'authenticated'
                ? 'success'
                : getAccountValidation(site.id)?.status === 'unauthenticated'
                  ? 'warning'
                  : 'danger'
            "
          >
            {{ getAccountStatusLabel(site.id) }}
          </StatusChip>
          <span class="nexus-site-card__account-text">{{ getAccountValidation(site.id)?.message }}</span>
        </div>

        <div v-if="getMetadata(site.id)" class="nexus-site-card__body">
          <div class="nexus-form__grid">
            <el-form-item :label="t('sites.form.section')">
              <el-select v-model="ensureDraft(site.id).sectionId" @change="onSectionChange(site.id)">
                <el-option
                  v-for="section in getMetadata(site.id)?.sections ?? []"
                  :key="section.id"
                  :label="`${section.displayName || section.name} (${section.name})`"
                  :value="section.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="t('sites.form.category')">
              <el-select v-model="ensureDraft(site.id).typeId">
                <el-option
                  v-for="category in getSelectedSection(site.id)?.categories ?? []"
                  :key="category.id"
                  :label="`${category.name} (${category.id})`"
                  :value="category.id"
                />
              </el-select>
            </el-form-item>
          </div>

          <div class="nexus-form__grid">
            <el-form-item :label="t('sites.form.title')">
              <el-input v-model="ensureDraft(site.id).title" />
            </el-form-item>
            <el-form-item :label="t('sites.form.smallDescription')">
              <el-input v-model="ensureDraft(site.id).smallDescription" />
            </el-form-item>
          </div>

          <el-form-item :label="t('sites.form.description')">
            <el-input v-model="ensureDraft(site.id).description" type="textarea" :rows="5" />
          </el-form-item>

          <div class="nexus-form__grid nexus-form__grid--files">
            <el-form-item :label="t('sites.form.torrentFile')">
              <div class="file-picker">
                <el-input v-model="ensureDraft(site.id).torrentPath" />
                <el-button plain @click="chooseFile(site.id, 'torrentPath', 'torrent')">{{ t('sites.actions.pickTorrent') }}</el-button>
              </div>
            </el-form-item>

            <el-form-item :label="t('sites.form.nfoFile')">
              <div class="file-picker">
                <el-input v-model="ensureDraft(site.id).nfoPath" />
                <el-button plain @click="chooseFile(site.id, 'nfoPath', 'nfo')">{{ t('sites.actions.pickNfo') }}</el-button>
              </div>
            </el-form-item>
          </div>

          <div class="nexus-form__grid nexus-form__grid--meta">
            <el-form-item :label="t('sites.form.referenceUrl')">
              <el-input v-model="ensureDraft(site.id).url" />
            </el-form-item>
            <el-form-item :label="t('sites.form.ptgen')">
              <el-input v-model="ensureDraft(site.id).ptGen" />
            </el-form-item>
            <el-form-item :label="t('sites.form.technicalInfo')">
              <el-input v-model="ensureDraft(site.id).technicalInfo" />
            </el-form-item>
            <el-form-item :label="t('sites.form.price')">
              <el-input v-model="ensureDraft(site.id).price" />
            </el-form-item>
          </div>

          <div class="nexus-form__grid nexus-form__grid--meta">
            <el-form-item :label="t('sites.form.tags')">
              <el-select v-model="ensureDraft(site.id).tagIds" multiple collapse-tags collapse-tags-tooltip>
                <el-option
                  v-for="tag in getSelectedSection(site.id)?.tags ?? []"
                  :key="tag.id"
                  :label="`${tag.name} (${tag.id})`"
                  :value="tag.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('sites.form.positionState')">
              <el-select v-model="ensureDraft(site.id).posState">
                <el-option :label="t('sites.values.normal')" value="normal" />
                <el-option :label="t('sites.values.sticky')" value="sticky" />
                <el-option :label="t('sites.values.recommended')" value="recommended" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('sites.form.pickType')">
              <el-select v-model="ensureDraft(site.id).pickType">
                <el-option :label="t('sites.values.normal')" value="normal" />
                <el-option :label="t('sites.values.hot')" value="hot" />
                <el-option :label="t('sites.values.classic')" value="classic" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('sites.form.positionUntil')">
              <el-input v-model="ensureDraft(site.id).posStateUntil" placeholder="YYYY-MM-DD HH:mm:ss" />
            </el-form-item>
          </div>

          <div v-if="(getSelectedSection(site.id)?.subCategories?.length ?? 0) > 0" class="nexus-form__grid">
            <el-form-item
              v-for="subCategory in getSelectedSection(site.id)?.subCategories ?? []"
              :key="subCategory.field"
              :label="`${subCategory.label} (${subCategory.field})`"
            >
              <el-select v-model="ensureDraft(site.id).subCategories[subCategory.field]">
                <el-option :label="t('common.none')" :value="undefined" />
                <el-option
                  v-for="option in subCategory.data"
                  :key="option.id"
                  :label="`${option.name} (${option.id})`"
                  :value="option.id"
                />
              </el-select>
            </el-form-item>
          </div>

          <div class="nexus-site-card__actions">
            <el-checkbox v-model="ensureDraft(site.id).anonymous">{{ t('sites.flags.anonymous') }}</el-checkbox>
            <div class="nexus-site-card__action-buttons">
              <el-button :loading="isPublishValidationLoading(site.id)" plain type="primary" @click="validatePublish(site.id)">
                {{ t('nexus.actions.runChecks') }}
              </el-button>
              <el-button :loading="isPublishLoading(site.id)" type="primary" @click="publishSite(site.id)">
                {{ t('sites.actions.publishViaAdapter') }}
              </el-button>
            </div>
          </div>

          <div v-if="getPublishValidation(site.id)" class="nexus-site-card__validation">
            <StatusChip :tone="getPublishValidation(site.id)?.valid ? 'success' : 'warning'">
              {{ getPublishValidation(site.id)?.valid ? t('nexus.validation.passed') : t('nexus.validation.found') }}
            </StatusChip>
            <ul v-if="(getPublishValidation(site.id)?.issues.length ?? 0) > 0" class="nexus-site-card__issues">
              <li v-for="issue in getPublishValidation(site.id)?.issues ?? []" :key="`${issue.field}-${issue.message}`">
                <strong>{{ issue.field }}</strong>: {{ issue.message }}
              </li>
            </ul>
          </div>

          <div v-if="getPublishError(site.id)" class="nexus-site-card__error">
            {{ getPublishError(site.id) }}
          </div>

          <div v-if="getPublishResult(site.id)" class="nexus-site-card__result">
            <StatusChip :tone="publishStateTones[getPublishResult(site.id)!.status]">
              {{ getPublishStateLabel(getPublishResult(site.id)!.status) }}
            </StatusChip>
            <a
              v-if="getPublishResult(site.id)?.remoteUrl"
              :href="getPublishResult(site.id)?.remoteUrl"
              class="nexus-site-card__result-link"
              target="_blank"
            >
              {{ getPublishResult(site.id)?.remoteUrl }}
            </a>
            <pre class="nexus-site-card__raw">{{ formatRawResponse(getPublishResult(site.id)?.rawResponse) }}</pre>
          </div>
        </div>

        <div v-else-if="getMetadataError(site.id)" class="nexus-site-card__error">
          {{ getMetadataError(site.id) }}
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.nexus-panel,
.nexus-panel__header,
.nexus-site-card__header,
.nexus-site-card__header-actions,
.nexus-site-card__account-status,
.nexus-site-card__actions,
.nexus-site-card__action-buttons,
.file-picker {
  display: flex;
}

.nexus-panel {
  flex-direction: column;
  gap: 18px;
}

.nexus-panel__header,
.nexus-site-card__header,
.nexus-site-card__actions {
  justify-content: space-between;
  gap: 14px;
}

.nexus-site-card__header-actions,
.nexus-site-card__action-buttons,
.nexus-site-card__account-status {
  gap: 10px;
}

.nexus-site-card__account-status {
  align-items: center;
  margin-top: 12px;
}

.nexus-panel__eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.nexus-panel__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
}

.nexus-panel__description,
.nexus-site-card__endpoint,
.nexus-site-card__account-text,
.nexus-site-card__error,
.nexus-site-card__result-link {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.nexus-panel__description {
  margin: 12px 0 0;
}

.nexus-panel__empty {
  padding: 32px 18px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  text-align: center;
}

.nexus-panel__empty--danger,
.nexus-site-card__error {
  color: var(--danger);
}

.nexus-site-list,
.nexus-site-card__body,
.nexus-site-card__validation,
.nexus-site-card__result {
  display: grid;
  gap: 16px;
}

.nexus-site-card {
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-strong);
}

.nexus-site-card__name {
  font-weight: 700;
}

.nexus-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.nexus-form__grid--meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.nexus-form__grid--files {
  grid-template-columns: 1fr;
}

.file-picker {
  gap: 10px;
}

.file-picker :deep(.el-input) {
  flex: 1;
}

.nexus-site-card__actions {
  align-items: center;
}

.nexus-site-card__issues {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.nexus-site-card__raw {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.04);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1180px) {
  .nexus-panel__header,
  .nexus-site-card__header,
  .nexus-site-card__header-actions,
  .nexus-site-card__account-status,
  .nexus-site-card__actions,
  .nexus-site-card__action-buttons,
  .file-picker {
    flex-direction: column;
    align-items: stretch;
  }

  .nexus-form__grid,
  .nexus-form__grid--meta {
    grid-template-columns: 1fr;
  }
}
</style>
