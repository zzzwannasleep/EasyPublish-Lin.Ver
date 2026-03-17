<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Download, EditPen, FolderOpened, Plus, Upload } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { projectBridge } from '../../services/bridge/project'
import { siteBridge } from '../../services/bridge/site'
import { taskBridge } from '../../services/bridge/task'
import { formatProjectTimestamp, getSiteLabel } from '../../services/project/presentation'
import type {
  MarkupFormat,
  PublishProject,
  SaveSeriesPublishProfileInput,
  SeriesProjectWorkspace,
  SeriesPublishProfile,
  SeriesPublishProfileSiteDrafts,
  SeriesPublishProfileSiteFieldDefaults,
  SeriesPublishProfileTemplateContext,
} from '../../types/project'
import type { SiteCatalogEntry, SiteId } from '../../types/site'

const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
const SITE_FORMAT_MAP: Partial<Record<SiteId, MarkupFormat | 'auto'>> = {
  bangumi: 'html',
  miobt: 'html',
  nyaa: 'md',
  mikan: 'bbcode',
  acgrip: 'bbcode',
  dmhy: 'html',
  acgnx_a: 'html',
  acgnx_g: 'html',
}
const TEMPLATE_TOKENS = [
  '{{title}}',
  '{{summary}}',
  '{{releaseTeam}}',
  '{{seriesLabel}}',
  '{{seriesTitleCN}}',
  '{{seriesTitleEN}}',
  '{{seriesTitleJP}}',
  '{{seasonLabel}}',
  '{{episodeLabel}}',
  '{{episodeTitle}}',
  '{{techLabel}}',
  '{{sourceType}}',
  '{{resolution}}',
  '{{videoCodec}}',
  '{{audioCodec}}',
  '{{variantName}}',
  '{{videoProfile}}',
  '{{subtitleProfile}}',
  '{{subtitleProfileLabel}}',
]
const DEFAULT_BODY_TEMPLATE = `<section>
  <p><strong>{{title}}</strong></p>
  <p>{{seriesLabel}}</p>
  <p>Episode: {{episodeLabel}} {{episodeTitle}}</p>
  <p>{{techLabel}}</p>
  <p>{{summary}}</p>
</section>`

type HiddenProfileState = {
  isDefault: boolean
  videoProfiles: Array<'1080p' | '2160p'>
  subtitleProfiles: Array<'chs' | 'cht' | 'eng' | 'bilingual'>
  templateContext?: SeriesPublishProfileTemplateContext
  titleTemplate?: string
  summaryTemplate?: string
  siteDrafts?: SeriesPublishProfileSiteDrafts
  siteFieldDefaults?: SeriesPublishProfileSiteFieldDefaults
}

const props = defineProps<{
  id: number
  project: PublishProject
}>()

const router = useRouter()

const workspace = ref<SeriesProjectWorkspace | null>(null)
const draftConfig = ref<Config.PublishConfig | null>(null)
const availableSites = ref<SiteCatalogEntry[]>([])
const selectedProfileId = ref<number | null>(null)
const loadError = ref('')
const siteError = ref('')
const isLoading = ref(false)
const isSavingOverview = ref(false)
const isSavingProfile = ref(false)
const isImportingProfile = ref(false)
const isExportingProfile = ref(false)
const isCreatingEpisode = ref(false)
const isPreviewLoading = ref(false)
const episodeDialogVisible = ref(false)
const previewRequestId = ref(0)

const overviewForm = reactive<{
  plannedEpisodeCount?: number
}>({
  plannedEpisodeCount: undefined,
})

const episodeForm = reactive({
  episodeLabel: '',
  episodeTitle: '',
})

const profileForm = reactive({
  name: '',
  targetSites: [] as SiteId[],
  bodyTemplate: DEFAULT_BODY_TEMPLATE,
})

const hiddenProfileState = reactive<HiddenProfileState>(createHiddenProfileState())
const convertedPreview = reactive<Record<'html' | 'md' | 'bbcode', string>>({
  html: '',
  md: '',
  bbcode: '',
})

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function createHiddenProfileState(seed?: Partial<HiddenProfileState>): HiddenProfileState {
  return {
    isDefault: Boolean(seed?.isDefault),
    videoProfiles: seed?.videoProfiles?.length ? [...seed.videoProfiles] : ['1080p'],
    subtitleProfiles: seed?.subtitleProfiles?.length ? [...seed.subtitleProfiles] : ['chs'],
    templateContext: deepClone(seed?.templateContext),
    titleTemplate: seed?.titleTemplate?.trim() || undefined,
    summaryTemplate: seed?.summaryTemplate?.trim() || undefined,
    siteDrafts: deepClone(seed?.siteDrafts),
    siteFieldDefaults: deepClone(seed?.siteFieldDefaults),
  }
}

function sortSiteIds(siteIds: SiteId[]) {
  const uniqueSiteIds = [...new Set(siteIds.filter(Boolean))]
  return uniqueSiteIds.sort((left, right) => {
    const leftIndex = SITE_ORDER.indexOf(left)
    const rightIndex = SITE_ORDER.indexOf(right)
    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex
    }
    if (leftIndex >= 0) {
      return -1
    }
    if (rightIndex >= 0) {
      return 1
    }
    return left.localeCompare(right)
  })
}

function getDraftTargetSites() {
  const config = draftConfig.value
  if (!config) {
    return []
  }

  if (Array.isArray(config.targetSites) && config.targetSites.length > 0) {
    return sortSiteIds(config.targetSites)
  }

  if (config.content && typeof config.content === 'object' && 'targetSites' in config.content) {
    const targetSites = config.content.targetSites
    if (Array.isArray(targetSites)) {
      return sortSiteIds(targetSites)
    }
  }

  return []
}

function getProfileById(profileId: number | null) {
  return workspace.value?.publishProfiles.find(profile => profile.id === profileId) ?? null
}

function getSiteName(siteId: SiteId) {
  return availableSites.value.find(site => site.id === siteId)?.name ?? getSiteLabel(siteId)
}

function getSiteFormat(siteId: SiteId) {
  return SITE_FORMAT_MAP[siteId] ?? 'html'
}

function getSiteFormatLabel(siteId: SiteId) {
  const format = getSiteFormat(siteId)
  if (format === 'md') {
    return 'Markdown'
  }
  if (format === 'bbcode') {
    return 'BBCode'
  }
  if (format === 'auto') {
    return 'Auto'
  }
  return 'HTML'
}

function getSitePreviewContent(siteId: SiteId) {
  const format = getSiteFormat(siteId)
  if (format === 'md') {
    return convertedPreview.md
  }
  if (format === 'bbcode') {
    return convertedPreview.bbcode
  }
  return convertedPreview.html
}

function getSitePreviewNote(siteId: SiteId) {
  return `${getSiteName(siteId)} 使用 ${getSiteFormatLabel(siteId)} 格式发布。`
}

function buildSeriesLabel(values: {
  seriesTitleCN?: string
  seriesTitleEN?: string
  seriesTitleJP?: string
  seasonLabel?: string
}) {
  const titles = [values.seriesTitleCN, values.seriesTitleEN, values.seriesTitleJP]
    .map(value => value?.trim() ?? '')
    .filter(Boolean)
  const uniqueTitles = [...new Set(titles)]
  const seasonLabel = values.seasonLabel?.trim()
  return seasonLabel ? [...uniqueTitles, seasonLabel].join(' / ') : uniqueTitles.join(' / ')
}

function buildTechLabel(values: {
  sourceType?: string
  resolution?: string
  videoCodec?: string
  audioCodec?: string
}) {
  return [values.sourceType, values.resolution, values.videoCodec, values.audioCodec]
    .map(value => value?.trim() ?? '')
    .filter(Boolean)
    .join(' / ')
}

function buildTemplateVariables() {
  const content =
    draftConfig.value?.content && typeof draftConfig.value.content === 'object' && !Array.isArray(draftConfig.value.content)
      ? (draftConfig.value.content as Partial<Config.Content_episode>)
      : {}
  const overrides = hiddenProfileState.templateContext ?? {}

  const baseVariables = {
    title: draftConfig.value?.title?.trim() || props.project.name,
    summary: content.summary?.trim() || '这里填写全站通用正文。',
    releaseTeam: content.releaseTeam?.trim() || 'VCB-Studio',
    seriesTitleCN: content.seriesTitleCN?.trim() || '',
    seriesTitleEN: content.seriesTitleEN?.trim() || props.project.name,
    seriesTitleJP: content.seriesTitleJP?.trim() || '',
    seasonLabel: content.seasonLabel?.trim() || '',
    episodeLabel: content.episodeLabel?.trim() || '',
    episodeTitle: content.episodeTitle?.trim() || '',
    sourceType: content.sourceType?.trim() || 'WebRip',
    resolution: content.resolution?.trim() || '1080p',
    videoCodec: content.videoCodec?.trim() || 'HEVC',
    audioCodec: content.audioCodec?.trim() || 'AAC',
    variantName: overrides.variantName?.trim() || '',
    videoProfile: overrides.videoProfile?.trim() || '',
    subtitleProfile: overrides.subtitleProfile?.trim() || '',
    subtitleProfileLabel: overrides.subtitleProfileLabel?.trim() || '',
  }

  const variables = {
    ...baseVariables,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([_key, value]) => typeof value === 'string' && value.trim() !== ''),
    ),
  }

  return {
    ...variables,
    seriesLabel:
      overrides.seriesLabel?.trim() ||
      buildSeriesLabel({
        seriesTitleCN: variables.seriesTitleCN,
        seriesTitleEN: variables.seriesTitleEN,
        seriesTitleJP: variables.seriesTitleJP,
        seasonLabel: variables.seasonLabel,
      }),
    techLabel:
      overrides.techLabel?.trim() ||
      buildTechLabel({
        sourceType: variables.sourceType,
        resolution: variables.resolution,
        videoCodec: variables.videoCodec,
        audioCodec: variables.audioCodec,
      }),
  }
}

function renderBodyTemplate(template: string) {
  const variables = buildTemplateVariables()
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_match, key: string) => variables[key as keyof typeof variables] ?? '')
}

const authenticatedSites = computed(() =>
  sortSiteIds(
    availableSites.value
      .filter(site => site.enabled && site.capabilitySet.publish.torrent && site.accountStatus === 'authenticated')
      .map(site => site.id),
  ).map(siteId => availableSites.value.find(site => site.id === siteId)!)
)

const publishProfiles = computed(() => workspace.value?.publishProfiles ?? [])
const builtEpisodeCount = computed(() => workspace.value?.episodes.length ?? 0)
const selectedSiteNames = computed(() => profileForm.targetSites.map(siteId => getSiteName(siteId)))
const selectedSiteCards = computed(() =>
  profileForm.targetSites
    .map(siteId => authenticatedSites.value.find(site => site.id === siteId))
    .filter((site): site is SiteCatalogEntry => Boolean(site)),
)
const overviewEpisodeText = computed(() => {
  if (!overviewForm.plannedEpisodeCount) {
    return `${builtEpisodeCount.value} 集已建立`
  }

  return `${builtEpisodeCount.value} / ${overviewForm.plannedEpisodeCount} 集`
})
const selectedProfileDisplayName = computed(() => {
  const profile = getProfileById(selectedProfileId.value)
  if (profile) {
    return profile.name
  }

  return profileForm.name.trim() || '\u672a\u547d\u540d\u65b0\u914d\u7f6e'
})
const selectedProfileSummary = computed(() => {
  const profile = getProfileById(selectedProfileId.value)
  if (!profile) {
    return '\u5f53\u524d\u6b63\u5728\u7f16\u8f91\u4e00\u5957\u65b0\u914d\u7f6e\uff0c\u4fdd\u5b58\u540e\u4f1a\u52a0\u5165\u4e0a\u9762\u7684\u914d\u7f6e\u9879\u3002'
  }

  return `${(profile.targetSites ?? []).length} \u4e2a\u7ad9\u70b9 \u00b7 \u6700\u8fd1\u66f4\u65b0 ${formatProjectTimestamp(profile.updatedAt)}`
})
const renderedHtmlPreview = computed(() => renderBodyTemplate(profileForm.bodyTemplate.trim() || ''))

async function refreshPreviews() {
  const html = renderedHtmlPreview.value.trim()
  const requestId = ++previewRequestId.value

  convertedPreview.html = html
  if (!html) {
    convertedPreview.md = ''
    convertedPreview.bbcode = ''
    return
  }

  isPreviewLoading.value = true
  try {
    const [markdownRaw, bbcodeRaw] = await Promise.all([
      window.globalAPI.html2markdown(JSON.stringify({ content: html })),
      window.globalAPI.html2bbcode(JSON.stringify({ content: html })),
    ])

    if (requestId !== previewRequestId.value) {
      return
    }

    convertedPreview.md = (JSON.parse(markdownRaw) as Message.Global.FileContent).content
    convertedPreview.bbcode = (JSON.parse(bbcodeRaw) as Message.Global.FileContent).content
  } finally {
    if (requestId === previewRequestId.value) {
      isPreviewLoading.value = false
    }
  }
}

watch(
  renderedHtmlPreview,
  () => {
    void refreshPreviews()
  },
  { immediate: true },
)

function fillProfileForm(profile: SeriesPublishProfile | null) {
  const fallbackTargetSites = getDraftTargetSites().filter(siteId =>
    authenticatedSites.value.some(site => site.id === siteId),
  )
  const allowedSiteIds = new Set(authenticatedSites.value.map(site => site.id))
  const nextTargetSites = sortSiteIds((profile?.targetSites ?? fallbackTargetSites).filter(siteId => allowedSiteIds.has(siteId)))

  Object.assign(
    hiddenProfileState,
    createHiddenProfileState({
      isDefault: profile?.isDefault,
      videoProfiles: profile?.videoProfiles,
      subtitleProfiles: profile?.subtitleProfiles,
      templateContext: profile?.templateContext,
      titleTemplate: profile?.titleTemplate,
      summaryTemplate: profile?.summaryTemplate,
      siteDrafts: profile?.siteDrafts,
      siteFieldDefaults: profile?.siteFieldDefaults,
    }),
  )

  profileForm.name = profile?.name ?? ''
  profileForm.targetSites = nextTargetSites
  profileForm.bodyTemplate = profile?.bodyTemplate?.trim() || draftConfig.value?.bodyTemplate?.trim() || DEFAULT_BODY_TEMPLATE
}

async function syncDraftConfigFromProfile(profile: SeriesPublishProfile | null) {
  if (!profile) {
    return
  }

  const currentDraft = draftConfig.value ?? (await taskBridge.getPublishConfig(props.id))
  const nextDraft = deepClone(currentDraft)

  nextDraft.targetSites = [...(profile.targetSites ?? [])]
  if (nextDraft.content && typeof nextDraft.content === 'object' && 'targetSites' in nextDraft.content) {
    nextDraft.content.targetSites = [...(profile.targetSites ?? [])]
  }

  if (profile.siteFieldDefaults) {
    nextDraft.siteFieldDefaults = deepClone(profile.siteFieldDefaults)
    const bangumiCategory = profile.siteFieldDefaults.bangumi?.category_bangumi
    const nyaaCategory = profile.siteFieldDefaults.nyaa?.category_nyaa
    if (typeof bangumiCategory === 'string' && bangumiCategory.trim()) {
      nextDraft.category_bangumi = bangumiCategory
    }
    if (typeof nyaaCategory === 'string' && nyaaCategory.trim()) {
      nextDraft.category_nyaa = nyaaCategory
    }
  }

  if (profile.bodyTemplate?.trim()) {
    nextDraft.bodyTemplate = profile.bodyTemplate.trim()
    nextDraft.bodyTemplateFormat = profile.bodyTemplateFormat ?? 'html'
  } else {
    delete nextDraft.bodyTemplate
    delete nextDraft.bodyTemplateFormat
  }

  await window.taskAPI.saveConfig(
    JSON.stringify({
      id: props.id,
      config: nextDraft,
    } satisfies Message.Task.ModifiedConfig),
  )

  draftConfig.value = nextDraft
}

async function applyProfile(profileId: number | null, syncDraft = true) {
  selectedProfileId.value = profileId
  const profile = getProfileById(profileId)
  fillProfileForm(profile)
  if (syncDraft && profile) {
    await syncDraftConfigFromProfile(profile)
  }
}

async function loadWorkspace(preferredProfileId?: number | null) {
  isLoading.value = true
  loadError.value = ''
  siteError.value = ''
  try {
    const [workspaceResult, siteResult, currentDraft] = await Promise.all([
      projectBridge.getSeriesWorkspace(props.project.id),
      siteBridge.listSites(),
      taskBridge.getPublishConfig(props.id),
    ])

    draftConfig.value = currentDraft

    if (!workspaceResult.ok) {
      workspace.value = null
      loadError.value = workspaceResult.error.message
      return
    }

    workspace.value = workspaceResult.data.workspace
    overviewForm.plannedEpisodeCount = workspace.value.plannedEpisodeCount

    if (!siteResult.ok) {
      availableSites.value = []
      siteError.value = siteResult.error.message
    } else {
      availableSites.value = siteResult.data.sites.filter(site => site.capabilitySet.publish.torrent)
    }

    const targetProfileId =
      preferredProfileId !== undefined
        ? preferredProfileId
        : selectedProfileId.value ?? workspace.value.publishProfiles[0]?.id ?? null

    await applyProfile(targetProfileId, false)
  } catch (error) {
    loadError.value = (error as Error).message
  } finally {
    isLoading.value = false
  }
}

function beginCreateProfile() {
  selectedProfileId.value = null
  profileForm.name = ''
  profileForm.bodyTemplate = draftConfig.value?.bodyTemplate?.trim() || profileForm.bodyTemplate || DEFAULT_BODY_TEMPLATE
  profileForm.targetSites = getDraftTargetSites().filter(siteId => authenticatedSites.value.some(site => site.id === siteId))
}

async function saveOverview() {
  isSavingOverview.value = true
  try {
    const result = await projectBridge.saveSeriesWorkspaceSettings({
      projectId: props.project.id,
      plannedEpisodeCount: overviewForm.plannedEpisodeCount,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    ElMessage.success('总集数已保存')
  } finally {
    isSavingOverview.value = false
  }
}

function buildProfilePayload(): SaveSeriesPublishProfileInput {
  return {
    projectId: props.project.id,
    profileId: selectedProfileId.value ?? undefined,
    name: profileForm.name.trim(),
    isDefault: hiddenProfileState.isDefault,
    videoProfiles: [...hiddenProfileState.videoProfiles],
    subtitleProfiles: [...hiddenProfileState.subtitleProfiles],
    templateContext: deepClone(hiddenProfileState.templateContext),
    targetSites: [...profileForm.targetSites],
    titleTemplate: hiddenProfileState.titleTemplate,
    summaryTemplate: hiddenProfileState.summaryTemplate,
    bodyTemplate: profileForm.bodyTemplate.trim() || undefined,
    bodyTemplateFormat: 'html',
    siteDrafts: deepClone(hiddenProfileState.siteDrafts),
    siteFieldDefaults: deepClone(hiddenProfileState.siteFieldDefaults),
  }
}

function buildSavedProfilePayload(profile: SeriesPublishProfile, name: string): SaveSeriesPublishProfileInput {
  return {
    projectId: props.project.id,
    profileId: profile.id,
    name,
    isDefault: profile.isDefault,
    videoProfiles: [...(profile.videoProfiles ?? [])],
    subtitleProfiles: [...(profile.subtitleProfiles ?? [])],
    templateContext: deepClone(profile.templateContext),
    targetSites: [...(profile.targetSites ?? [])],
    titleTemplate: profile.titleTemplate,
    summaryTemplate: profile.summaryTemplate,
    bodyTemplate: profile.bodyTemplate?.trim() || undefined,
    bodyTemplateFormat: profile.bodyTemplateFormat ?? 'html',
    siteDrafts: deepClone(profile.siteDrafts),
    siteFieldDefaults: deepClone(profile.siteFieldDefaults),
  }
}

async function promptProfileName(initialValue = '', title = '\u91cd\u547d\u540d\u53d1\u5e03\u914d\u7f6e') {
  try {
    const response = await ElMessageBox.prompt('\u8f93\u5165\u4e00\u4e2a\u4fbf\u4e8e\u8bc6\u522b\u7684\u914d\u7f6e\u540d\u79f0', title, {
      inputValue: initialValue,
      inputPlaceholder:
        '\u4f8b\u5982\uff1a\u5e38\u89c4\u53d1\u5e03 / \u6d77\u5916\u540c\u6b65 / \u6e2f\u6fb3\u53f0\u7248',
      confirmButtonText: '\u786e\u5b9a',
      cancelButtonText: '\u53d6\u6d88',
      inputValidator: value => (value.trim() ? true : '\u8bf7\u8f93\u5165\u914d\u7f6e\u540d\u79f0'),
    })

    return (typeof response === 'object' && response && 'value' in response ? String(response.value) : '').trim()
  } catch {
    return null
  }
}

async function renameDraftProfile() {
  const nextName = await promptProfileName(profileForm.name, '\u8bbe\u7f6e\u914d\u7f6e\u540d\u79f0')
  if (!nextName) {
    return
  }

  profileForm.name = nextName
}

async function renameProfile(profile: SeriesPublishProfile) {
  const nextName = await promptProfileName(profile.name, `\u91cd\u547d\u540d\u300c${profile.name}\u300d`)
  if (!nextName || nextName === profile.name) {
    return
  }

  const result = await projectBridge.saveSeriesPublishProfile(buildSavedProfilePayload(profile, nextName))
  if (!result.ok) {
    ElMessage.error(result.error.message)
    return
  }

  workspace.value = result.data.workspace
  overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
  if (selectedProfileId.value === profile.id) {
    profileForm.name = nextName
  }
  ElMessage.success(`\u5df2\u91cd\u547d\u540d\u914d\u7f6e\uff1a${nextName}`)
}

/*
async function saveProfile() {
  if (!profileForm.name.trim()) {
    const nextName = await promptProfileName('', selectedProfileId.value ? '重命名发布配置' : '保存发布配置')
    if (!nextName) {
      return
    }

    profileForm.name = nextName
  }

  if (!profileForm.name.trim()) {
    ElMessage.error('请先填写配置名称')
    return
  }

  isSavingProfile.value = true
  try {
    const result = await projectBridge.saveSeriesPublishProfile(buildProfilePayload())
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    await applyProfile(result.data.profile.id, false)
    await syncDraftConfigFromProfile(result.data.profile)
    ElMessage.success(`配置已保存：${result.data.profile.name}`)
  } finally {
    isSavingProfile.value = false
  }
}
*/
async function saveProfile() {
  if (!profileForm.name.trim()) {
    const nextName = await promptProfileName(
      '',
      selectedProfileId.value ? '\u91cd\u547d\u540d\u53d1\u5e03\u914d\u7f6e' : '\u4fdd\u5b58\u53d1\u5e03\u914d\u7f6e',
    )
    if (!nextName) {
      return
    }

    profileForm.name = nextName
  }

  if (!profileForm.name.trim()) {
    ElMessage.error('\u8bf7\u5148\u586b\u5199\u914d\u7f6e\u540d\u79f0')
    return
  }

  isSavingProfile.value = true
  try {
    const result = await projectBridge.saveSeriesPublishProfile(buildProfilePayload())
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    await applyProfile(result.data.profile.id, false)
    await syncDraftConfigFromProfile(result.data.profile)
    ElMessage.success(`\u5df2\u4fdd\u5b58\u914d\u7f6e\uff1a${result.data.profile.name}`)
  } finally {
    isSavingProfile.value = false
  }
}

async function importProfile() {
  isImportingProfile.value = true
  try {
    const result = await projectBridge.importSeriesPublishProfile({
      projectId: props.project.id,
    })

    if (!result.ok) {
      if (result.error.code !== 'SERIES_PUBLISH_PROFILE_IMPORT_CANCELLED') {
        ElMessage.error(result.error.message)
      }
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    await applyProfile(result.data.profile.id, false)
    await syncDraftConfigFromProfile(result.data.profile)
    ElMessage.success(`已导入配置：${result.data.profile.name}`)
  } finally {
    isImportingProfile.value = false
  }
}

async function exportProfile() {
  if (!selectedProfileId.value) {
    ElMessage.warning('请先选择一个配置项')
    return
  }

  isExportingProfile.value = true
  try {
    const result = await projectBridge.exportSeriesPublishProfile({
      projectId: props.project.id,
      profileId: selectedProfileId.value,
    })

    if (!result.ok) {
      if (result.error.code !== 'SERIES_PUBLISH_PROFILE_EXPORT_CANCELLED') {
        ElMessage.error(result.error.message)
      }
      return
    }

    ElMessage.success(result.data.path ? `已导出到 ${result.data.path}` : '配置已导出')
  } finally {
    isExportingProfile.value = false
  }
}

async function createEpisode() {
  if (!episodeForm.episodeLabel.trim()) {
    ElMessage.error('请先填写集数')
    return
  }

  isCreatingEpisode.value = true
  try {
    const result = await projectBridge.createSeriesEpisode({
      projectId: props.project.id,
      episodeLabel: episodeForm.episodeLabel.trim(),
      episodeTitle: episodeForm.episodeTitle.trim() || undefined,
    })

    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    workspace.value = result.data.workspace
    overviewForm.plannedEpisodeCount = result.data.workspace.plannedEpisodeCount
    episodeDialogVisible.value = false
    episodeForm.episodeLabel = ''
    episodeForm.episodeTitle = ''
    ElMessage.success(`已建立剧集：${result.data.episode.episodeLabel}`)
  } finally {
    isCreatingEpisode.value = false
  }
}

function openProjectFolder() {
  window.globalAPI.openFolder(JSON.stringify({ path: props.project.workingDirectory } satisfies Message.Global.Path))
}

function openAccountsPage() {
  void router.push({ name: 'account' })
}

onMounted(() => {
  void loadWorkspace()
})
</script>

<template>
  <div class="series-editor">
    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" />

    <template v-else>
      <section class="series-editor__overview" v-loading="isLoading">
        <div class="series-editor__overview-main">
          <div class="series-editor__overview-item">
            <div class="series-editor__label">当前项目</div>
            <div class="series-editor__value">{{ props.project.name }}</div>
            <button class="series-editor__link" type="button" @click="openProjectFolder">
              <el-icon><FolderOpened /></el-icon>
              <span>打开项目目录</span>
            </button>
          </div>

          <div class="series-editor__overview-item">
            <div class="series-editor__label">已建集数 / 总集数</div>
            <div class="series-editor__value">{{ overviewEpisodeText }}</div>
            <div class="series-editor__inline-form">
              <el-input-number
                v-model="overviewForm.plannedEpisodeCount"
                :min="1"
                :step="1"
                controls-position="right"
                placeholder="总集数"
              />
              <el-button :loading="isSavingOverview" @click="saveOverview">保存总集数</el-button>
              <el-button plain @click="episodeDialogVisible = true">新增剧集</el-button>
            </div>
          </div>

          <div class="series-editor__overview-item">
            <div class="series-editor__label">同步站点</div>
            <div class="series-editor__value">{{ profileForm.targetSites.length }} 个站点</div>
            <div class="series-editor__chip-row">
              <el-tag v-for="siteName in selectedSiteNames" :key="siteName" effect="plain" type="info">
                {{ siteName }}
              </el-tag>
              <span v-if="selectedSiteNames.length === 0" class="series-editor__muted">还没有选择发布站点</span>
            </div>
          </div>
        </div>

        <div class="series-editor__overview-side">
          <div class="series-editor__meta-line">
            项目更新时间：{{ formatProjectTimestamp(workspace?.updatedAt ?? props.project.updatedAt) }}
          </div>
          <div class="series-editor__meta-line">已保存配置：{{ publishProfiles.length }}</div>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">发布配置</h3>
            <p class="series-editor__text">
              点击下面的配置项即可直接使用。当前页面只保留配置本身，不再展示多层工作台关系。
            </p>
          </div>
          <div class="series-editor__actions">
            <el-button plain :icon="Upload" :loading="isImportingProfile" @click="importProfile">导入配置项</el-button>
            <el-button plain :icon="Download" :loading="isExportingProfile" @click="exportProfile">导出配置项</el-button>
            <el-button type="primary" :icon="Plus" @click="beginCreateProfile">新建配置项</el-button>
          </div>
        </div>

        <div class="series-editor__profile-strip">
          <div
            v-if="selectedProfileId === null"
            class="series-editor__profile-option"
            :class="{ 'is-active': true, 'is-draft': true }"
          >
            <button type="button" class="series-editor__profile-option-main" @click="selectedProfileId = null">
              <span class="series-editor__profile-option-name">{{
                profileForm.name.trim() || '\u672a\u547d\u540d\u65b0\u914d\u7f6e'
              }}</span>
              <span class="series-editor__profile-option-badge">{{ '\u65b0\u5efa' }}</span>
            </button>
            <button
              type="button"
              class="series-editor__profile-option-icon"
              :aria-label="'\u91cd\u547d\u540d\u5f53\u524d\u65b0\u914d\u7f6e'"
              @click.stop="renameDraftProfile"
            >
              <el-icon><EditPen /></el-icon>
            </button>
          </div>

          <div
            v-for="profile in publishProfiles"
            :key="`compact-${profile.id}`"
            class="series-editor__profile-option"
            :class="{ 'is-active': selectedProfileId === profile.id }"
          >
            <button type="button" class="series-editor__profile-option-main" @click="applyProfile(profile.id)">
              <span class="series-editor__profile-option-name">{{ profile.name }}</span>
            </button>
            <button
              type="button"
              class="series-editor__profile-option-icon"
              :aria-label="`\u91cd\u547d\u540d\u914d\u7f6e ${profile.name}`"
              @click.stop="renameProfile(profile)"
            >
              <el-icon><EditPen /></el-icon>
            </button>
          </div>

          <button
            v-for="profile in publishProfiles"
            :key="profile.id"
            type="button"
            class="series-editor__profile-card"
            :class="{ 'is-active': selectedProfileId === profile.id }"
            @click="applyProfile(profile.id)"
          >
            <div class="series-editor__profile-name">{{ profile.name }}</div>
            <div class="series-editor__profile-meta">
              <span>{{ (profile.targetSites ?? []).length }} 个站点</span>
              <span>{{ formatProjectTimestamp(profile.updatedAt) }}</span>
            </div>
          </button>

          <div v-if="publishProfiles.length === 0" class="series-editor__empty-card">
            当前还没有配置项，先新建一个即可。
          </div>
        </div>

        <div v-if="publishProfiles.length === 0 && selectedProfileId !== null" class="series-editor__empty-card">
          {{ '\u5f53\u524d\u8fd8\u6ca1\u6709\u914d\u7f6e\u9879\uff0c\u5148\u65b0\u5efa\u4e00\u4e2a\u5373\u53ef\u3002' }}
        </div>

        <div class="series-editor__profile-footer">
          <div class="series-editor__profile-selection">
            <span class="series-editor__profile-selection-name">{{ selectedProfileDisplayName }}</span>
            <span class="series-editor__profile-selection-meta">{{ selectedProfileSummary }}</span>
          </div>
          <div class="series-editor__profile-footer-actions">
            <el-button type="primary" :loading="isSavingProfile" @click="saveProfile">{{
              '\u4fdd\u5b58\u5f53\u524d\u914d\u7f6e'
            }}</el-button>
          </div>
        </div>

        <div class="series-editor__config-bar">
          <label class="series-editor__field">
            <span class="series-editor__label">配置名称</span>
            <el-input v-model="profileForm.name" placeholder="例如：常规发布 / 海外同步 / 港澳台版" />
          </label>
          <div class="series-editor__config-bar-actions">
            <el-button type="primary" :loading="isSavingProfile" @click="saveProfile">保存当前配置</el-button>
          </div>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">正文模板</h3>
            <p class="series-editor__text">
              这里统一维护 HTML 正文源稿，页面会自动转换成 Markdown 和 BBCode 供不同站点使用。
            </p>
          </div>
        </div>

        <div class="series-editor__template-grid">
          <div class="series-editor__editor-card">
            <div class="series-editor__label">HTML 正文源稿</div>
            <el-input
              v-model="profileForm.bodyTemplate"
              type="textarea"
              :rows="18"
              placeholder="在这里填写全站通用的 HTML 正文模板。"
            />
            <div class="series-editor__token-list">
              <span v-for="token in TEMPLATE_TOKENS" :key="token" class="series-editor__token">{{ token }}</span>
            </div>
          </div>

          <div class="series-editor__preview-stack">
            <article class="series-editor__preview-card">
              <div class="series-editor__label">HTML 预览</div>
              <div v-if="renderedHtmlPreview" class="series-editor__html-preview" v-html="renderedHtmlPreview"></div>
              <div v-else class="series-editor__muted">模板为空时，这里不会生成预览。</div>
            </article>

            <article class="series-editor__preview-card">
              <div class="series-editor__label">格式转换</div>
              <div class="series-editor__preview-status">
                <span v-if="isPreviewLoading" class="series-editor__muted">正在生成 Markdown / BBCode 预览...</span>
                <span v-else class="series-editor__muted">已根据当前模板生成多站点输出预览。</span>
              </div>
              <div class="series-editor__site-preview-list">
                <article v-for="site in selectedSiteCards" :key="site.id" class="series-editor__site-preview">
                  <div class="series-editor__site-preview-head">
                    <div class="series-editor__site-name">{{ site.name }}</div>
                    <el-tag effect="plain" size="small">{{ getSiteFormatLabel(site.id) }}</el-tag>
                  </div>
                  <div class="series-editor__site-note">{{ getSitePreviewNote(site.id) }}</div>
                  <pre class="series-editor__site-code">
{{ getSitePreviewContent(site.id) || '当前模板暂无可转换内容。' }}</pre
                  >
                </article>
                <div v-if="selectedSiteCards.length === 0" class="series-editor__muted">
                  先在下面勾选站点，这里才会按站点格式显示预览。
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section class="series-editor__section">
        <div class="series-editor__section-head">
          <div>
            <h3 class="series-editor__title">发布站点</h3>
            <p class="series-editor__text">这里只显示已经登录且状态有效的站点，直接勾选要同步发布的目标站点即可。</p>
          </div>
          <div class="series-editor__actions">
            <el-button plain @click="openAccountsPage">去账号页检查登录状态</el-button>
          </div>
        </div>

        <el-alert v-if="siteError" type="warning" :closable="false" show-icon :title="siteError" />

        <div v-if="authenticatedSites.length" class="series-editor__site-grid">
          <label
            v-for="site in authenticatedSites"
            :key="site.id"
            class="series-editor__site-card"
            :class="{ 'is-active': profileForm.targetSites.includes(site.id) }"
          >
            <div class="series-editor__site-card-head">
              <div>
                <div class="series-editor__site-name">{{ site.name }}</div>
                <div class="series-editor__site-note">{{ site.baseUrl }}</div>
              </div>
              <el-checkbox
                :model-value="profileForm.targetSites.includes(site.id)"
                @update:model-value="
                  value =>
                    (profileForm.targetSites = value
                      ? sortSiteIds([...profileForm.targetSites, site.id])
                      : profileForm.targetSites.filter(current => current !== site.id))
                "
              />
            </div>
            <div class="series-editor__site-foot">
              <el-tag effect="plain" size="small">{{ getSiteFormatLabel(site.id) }}</el-tag>
              <span class="series-editor__muted">{{ site.accountMessage || '已通过账号校验' }}</span>
            </div>
          </label>
        </div>

        <div v-else class="series-editor__empty-card">当前没有已登录且有效的站点，请先去账号页面完成登录校验。</div>
      </section>
    </template>

    <el-dialog v-model="episodeDialogVisible" title="新增剧集" width="420px">
      <div class="series-editor__dialog-grid">
        <label class="series-editor__field">
          <span class="series-editor__label">集数</span>
          <el-input v-model="episodeForm.episodeLabel" placeholder="例如 01 / 02 / SP1" />
        </label>
        <label class="series-editor__field">
          <span class="series-editor__label">分集标题</span>
          <el-input v-model="episodeForm.episodeTitle" placeholder="可选" />
        </label>
      </div>
      <template #footer>
        <el-button @click="episodeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="isCreatingEpisode" @click="createEpisode">建立剧集</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.series-editor {
  display: grid;
  gap: 18px;
}

.series-editor__overview,
.series-editor__section,
.series-editor__preview-card,
.series-editor__editor-card,
.series-editor__site-preview,
.series-editor__site-card,
.series-editor__profile-card,
.series-editor__empty-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}

.series-editor__overview,
.series-editor__section {
  padding: 18px;
}

.series-editor__overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
}

.series-editor__overview-main {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.series-editor__overview-item,
.series-editor__preview-stack,
.series-editor__dialog-grid,
.series-editor__field,
.series-editor__site-preview-list {
  display: grid;
  gap: 10px;
}

.series-editor__overview-item {
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 92%, #eff3f8);
}

.series-editor__overview-side {
  display: grid;
  gap: 8px;
  min-width: 220px;
}

.series-editor__meta-line,
.series-editor__text,
.series-editor__site-note,
.series-editor__muted,
.series-editor__profile-meta {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.series-editor__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: -0.03em;
}

.series-editor__label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.series-editor__value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.series-editor__link {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.series-editor__inline-form,
.series-editor__actions,
.series-editor__profile-footer,
.series-editor__profile-footer-actions,
.series-editor__config-bar,
.series-editor__config-bar-actions,
.series-editor__chip-row,
.series-editor__site-card-head,
.series-editor__site-foot,
.series-editor__section-head,
.series-editor__site-preview-head {
  display: flex;
  gap: 10px;
  align-items: center;
}

.series-editor__inline-form,
.series-editor__profile-footer,
.series-editor__config-bar {
  flex-wrap: wrap;
}

.series-editor__chip-row {
  flex-wrap: wrap;
}

.series-editor__section {
  display: grid;
  gap: 16px;
}

.series-editor__section-head {
  justify-content: space-between;
  align-items: flex-start;
}

.series-editor__profile-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.series-editor__profile-card {
  display: none;
  min-width: 220px;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, transform 160ms ease;
}

.series-editor__profile-strip > .series-editor__empty-card {
  display: none;
}

.series-editor__profile-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  transform: translateY(-1px);
}

.series-editor__profile-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 92%, #eef2f7);
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.series-editor__profile-option.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  transform: translateY(-1px);
}

.series-editor__profile-option-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.series-editor__profile-option-name,
.series-editor__profile-selection-name,
.series-editor__profile-name,
.series-editor__site-name {
  font-size: 16px;
  font-weight: 700;
}

.series-editor__profile-option-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-editor__profile-option-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-panel));
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.series-editor__profile-option-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.series-editor__profile-option-icon:hover {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  color: var(--accent);
}

.series-editor__profile-meta {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
}

.series-editor__profile-footer {
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 92%, #eef2f7);
}

.series-editor__profile-selection {
  display: grid;
  gap: 4px;
}

.series-editor__profile-selection-meta {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.series-editor__config-bar {
  display: none;
  justify-content: space-between;
}

.series-editor__config-bar .series-editor__field {
  flex: 1 1 320px;
}

.series-editor__template-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
}

.series-editor__editor-card,
.series-editor__preview-card,
.series-editor__site-card,
.series-editor__site-preview,
.series-editor__empty-card {
  padding: 16px;
}

.series-editor__token-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.series-editor__token {
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 86%, #eef2f7);
  color: var(--text-secondary);
  font-size: 12px;
}

.series-editor__html-preview {
  min-height: 160px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 90%, #eef2f7);
  overflow: auto;
}

.series-editor__preview-status {
  min-height: 20px;
}

.series-editor__site-code {
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-panel) 88%, #eef2f7);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.series-editor__site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.series-editor__site-card {
  display: grid;
  gap: 12px;
}

.series-editor__site-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 54%, white);
}

.series-editor__site-card-head {
  justify-content: space-between;
  align-items: flex-start;
}

.series-editor__site-foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.series-editor__empty-card {
  color: var(--text-secondary);
}

@media (max-width: 1120px) {
  .series-editor__overview,
  .series-editor__template-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .series-editor__overview-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .series-editor__section-head,
  .series-editor__actions,
  .series-editor__profile-footer,
  .series-editor__config-bar,
  .series-editor__inline-form,
  .series-editor__site-card-head,
  .series-editor__site-foot {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
