<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { Edit, FolderOpened } from '@element-plus/icons-vue'
import StatusChip from './feedback/StatusChip.vue'
import { projectBridge } from '../services/bridge/project'
import { getPublishedSiteIds, getSiteLabel } from '../services/project/presentation'
import type { PublishProject } from '../types/project'
import type { SiteId } from '../types/site'

const props = defineProps<{ id: number }>()

type TagOption = {
  label: string
  value: {
    label: string
    value: string
  }
}

type EpisodeReleaseProfile = {
  id: string
  name: string
  releaseTeam: string
  sourceType: string
  resolution: string
  videoCodec: string
  audioCodec: string
}

type EpisodeForm = {
  torrentPath: string
  title: string
  seriesTitleCN: string
  seriesTitleEN: string
  seriesTitleJP: string
  seasonLabel: string
  episodeLabel: string
  episodeTitle: string
  releaseTeam: string
  sourceType: string
  resolution: string
  videoCodec: string
  audioCodec: string
  summary: string
  category_bangumi: string
  category_nyaa: string
  information: string
  tags: { label: string; value: string }[]
  targetSites: SiteId[]
  completed?: boolean
  remake?: boolean
}

const router = useRouter()
const loadCompleted = ref(false)
const isLoading = ref(false)
const isCreating = ref(false)
const isSaving = ref(false)
const isProjectLoading = ref(false)
const createForm = ref<FormInstance>()
const project = ref<PublishProject | null>(null)
const suggestedBangumiTags = ref<TagOption[]>([])
const inputBangumiTags = ref<TagOption[]>([])
const releaseProfiles = ref<EpisodeReleaseProfile[]>([])
const selectedReleaseProfileId = ref('')

const form = reactive<EpisodeForm>({
  torrentPath: '',
  title: '',
  seriesTitleCN: '',
  seriesTitleEN: '',
  seriesTitleJP: '',
  seasonLabel: '',
  episodeLabel: '',
  episodeTitle: '',
  releaseTeam: 'VCB-Studio',
  sourceType: 'WebRip',
  resolution: '1080p',
  videoCodec: 'HEVC',
  audioCodec: 'AAC',
  summary: '',
  category_bangumi: '549ef207fe682f7549f1ea90',
  category_nyaa: '1_3',
  information: 'https://vcb-s.com/archives/138',
  tags: [],
  targetSites: ['bangumi', 'mikan', 'miobt', 'nyaa'],
  completed: false,
  remake: false,
})

const targetSiteOptions: Array<{ label: string; value: SiteId }> = [
  { label: 'Bangumi', value: 'bangumi' },
  { label: 'Mikan', value: 'mikan' },
  { label: 'MioBT', value: 'miobt' },
  { label: 'Nyaa', value: 'nyaa' },
]

const RELEASE_PROFILE_STORAGE_KEY = 'episode-release-profiles-v1'
const defaultReleaseProfiles: EpisodeReleaseProfile[] = [
  {
    id: 'vcb-webrip-1080p',
    name: 'VCB-Studio / WebRip 1080p',
    releaseTeam: 'VCB-Studio',
    sourceType: 'WebRip',
    resolution: '1080p',
    videoCodec: 'HEVC',
    audioCodec: 'AAC',
  },
  {
    id: 'vcb-bdrip-1080p',
    name: 'VCB-Studio / BDRip 1080p',
    releaseTeam: 'VCB-Studio',
    sourceType: 'BDRip',
    resolution: '1080p',
    videoCodec: 'HEVC',
    audioCodec: 'FLAC',
  },
]

const sourceTypeOptions = ['WebRip', 'BDRip', 'TVRip', 'WEB-DL']
const resolutionOptions = ['1080p', '720p', '2160p']
const videoCodecOptions = ['HEVC', 'AVC', 'AV1']
const audioCodecOptions = ['AAC', 'FLAC', 'AC3', 'EAC3']

const bangumiCategoryOptions = [
  { label: '合集', value: '54967e14ff43b99e284d0bf7' },
  { label: '剧场版', value: '549cc9369310bc7d04cddf9f' },
  { label: '动画', value: '549ef207fe682f7549f1ea90' },
  { label: '其他', value: '549ef250fe682f7549f1ea91' },
]

const nyaaCategoryOptions = [
  { label: 'Anime - English-translated', value: '1_2' },
  { label: 'Anime - Non-English-translated', value: '1_3' },
  { label: 'Anime - Raw', value: '1_4' },
  { label: 'Live Action - English-translated', value: '4_1' },
  { label: 'Live Action - Non-English-translated', value: '4_3' },
  { label: 'Live Action - Raw', value: '4_4' },
]

const bangumiTags = computed(() => {
  const entries = [...suggestedBangumiTags.value, ...inputBangumiTags.value]
  return entries.filter((entry, index) => entries.findIndex(item => item.value.value === entry.value.value) === index)
})

const rules = reactive<FormRules<EpisodeForm>>({
  seriesTitleEN: [{ required: true, message: '请填写英文标题', trigger: 'change' }],
  episodeLabel: [{ required: true, message: '请填写集数', trigger: 'change' }],
  torrentPath: [{ required: true, message: '请选择种子文件', trigger: 'change' }],
  category_bangumi: [{ required: true, message: '请选择 Bangumi 分类', trigger: 'change' }],
  category_nyaa: [{ required: true, message: '请选择 Nyaa 分类', trigger: 'change' }],
  targetSites: [
    {
      validator: (_rule, value, callback) => {
        if (Array.isArray(value) && value.length > 0) {
          callback()
          return
        }

        callback(new Error('至少选择一个目标站点'))
      },
      trigger: 'change',
    },
  ],
})

const targetSiteLabels = computed(() => form.targetSites.map(siteId => getSiteLabel(siteId)).join(', '))
const publishedSiteSet = computed(() => new Set(project.value ? getPublishedSiteIds(project.value) : []))
const publishedTargetSites = computed(() => form.targetSites.filter(siteId => publishedSiteSet.value.has(siteId)))
const missingTargetSites = computed(() => form.targetSites.filter(siteId => !publishedSiteSet.value.has(siteId)))
const publishedTargetLabels = computed(() => publishedTargetSites.value.map(siteId => getSiteLabel(siteId)).join(', '))
const missingTargetLabels = computed(() => missingTargetSites.value.map(siteId => getSiteLabel(siteId)).join(', '))
const resolvedTitle = computed(() => form.title.trim() || buildTitle())
const summaryPlaceholder = computed(() => (form.summary.trim() ? form.summary.trim() : '这里会作为生成的 HTML / Markdown / BBCode 简介主体。'))
const selectedReleaseProfileName = computed(
  () => releaseProfiles.value.find(profile => profile.id === selectedReleaseProfileId.value)?.name ?? '',
)
const publishProgressTone = computed(() => {
  if (missingTargetSites.value.length === 0 && form.targetSites.length > 0) {
    return 'success'
  }

  if (publishedTargetSites.value.length > 0) {
    return 'warning'
  }

  return 'info'
})

function loadReleaseProfiles() {
  try {
    const raw = window.localStorage.getItem(RELEASE_PROFILE_STORAGE_KEY)
    if (!raw) {
      releaseProfiles.value = [...defaultReleaseProfiles]
      return
    }

    const parsed = JSON.parse(raw) as EpisodeReleaseProfile[]
    releaseProfiles.value = Array.isArray(parsed) && parsed.length > 0 ? parsed : [...defaultReleaseProfiles]
  } catch {
    releaseProfiles.value = [...defaultReleaseProfiles]
  }
}

function persistReleaseProfiles() {
  window.localStorage.setItem(RELEASE_PROFILE_STORAGE_KEY, JSON.stringify(releaseProfiles.value))
}

function applyReleaseProfile(profile: EpisodeReleaseProfile) {
  form.releaseTeam = profile.releaseTeam
  form.sourceType = profile.sourceType
  form.resolution = profile.resolution
  form.videoCodec = profile.videoCodec
  form.audioCodec = profile.audioCodec
  selectedReleaseProfileId.value = profile.id
}

function syncSelectedReleaseProfile() {
  const matched = releaseProfiles.value.find(profile =>
    profile.releaseTeam === form.releaseTeam &&
    profile.sourceType === form.sourceType &&
    profile.resolution === form.resolution &&
    profile.videoCodec === form.videoCodec &&
    profile.audioCodec === form.audioCodec,
  )

  selectedReleaseProfileId.value = matched?.id ?? ''
}

function applySelectedReleaseProfile() {
  const profile = releaseProfiles.value.find(item => item.id === selectedReleaseProfileId.value)
  if (!profile) {
    ElMessage.warning('请先选择一个发布规格预设')
    return
  }

  applyReleaseProfile(profile)
  ElMessage.success(`已套用预设：${profile.name}`)
}

async function saveCurrentAsReleaseProfile() {
  const response = await ElMessageBox.prompt('输入一个便于识别的名称', '保存发布规格预设', {
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    inputValue: form.releaseTeam ? `${form.releaseTeam} / ${form.sourceType} ${form.resolution}` : '',
  }).catch(() => undefined)

  if (!response || typeof response !== 'object' || !('value' in response)) {
    return
  }

  const name = response.value.trim()
  if (!name) {
    ElMessage.warning('预设名称不能为空')
    return
  }

  const existing = releaseProfiles.value.find(profile => profile.name === name)
  const nextProfile: EpisodeReleaseProfile = {
    id: existing?.id ?? `${Date.now()}`,
    name,
    releaseTeam: form.releaseTeam.trim(),
    sourceType: form.sourceType.trim(),
    resolution: form.resolution.trim(),
    videoCodec: form.videoCodec.trim(),
    audioCodec: form.audioCodec.trim(),
  }

  const existingIndex = releaseProfiles.value.findIndex(profile => profile.id === nextProfile.id)
  if (existingIndex >= 0) {
    releaseProfiles.value.splice(existingIndex, 1, nextProfile)
  } else {
    releaseProfiles.value = [...releaseProfiles.value, nextProfile]
  }

  persistReleaseProfiles()
  selectedReleaseProfileId.value = nextProfile.id
  ElMessage.success(`已保存预设：${nextProfile.name}`)
}

async function removeSelectedReleaseProfile() {
  const profile = releaseProfiles.value.find(item => item.id === selectedReleaseProfileId.value)
  if (!profile) {
    return
  }

  const confirmed = await ElMessageBox.confirm(`确定删除预设“${profile.name}”吗？`, '删除发布规格预设', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => true).catch(() => false)

  if (!confirmed) {
    return
  }

  releaseProfiles.value = releaseProfiles.value.filter(item => item.id !== profile.id)
  persistReleaseProfiles()
  syncSelectedReleaseProfile()
  ElMessage.success(`已删除预设：${profile.name}`)
}

function buildSeriesLabel() {
  const titles = [form.seriesTitleCN.trim(), form.seriesTitleEN.trim(), form.seriesTitleJP.trim()].filter(Boolean)
  const dedupedTitles = [...new Set(titles)]
  const seasonLabel = form.seasonLabel.trim()

  if (!seasonLabel) {
    return dedupedTitles.join(' / ')
  }

  return [...dedupedTitles, seasonLabel].join(' / ')
}

function buildTitle() {
  const team = (form.releaseTeam || 'VCB-Studio').trim()
  const seriesLabel = buildSeriesLabel()
  const episodeLabel = form.episodeLabel.trim()
  const episodeTitle = form.episodeTitle.trim()
  const techLabel = [form.sourceType, form.resolution, form.videoCodec, form.audioCodec]
    .map(item => item.trim())
    .filter(Boolean)
    .join(' ')

  let title = `[${team}] ${seriesLabel}`
  if (episodeLabel) {
    title += ` - ${episodeLabel}`
  }
  if (episodeTitle) {
    title += ` ${episodeTitle}`
  }
  if (techLabel) {
    title += ` [${techLabel}]`
  }

  if (title.length <= 128) {
    return title
  }

  title = `[${team}] ${form.seriesTitleEN.trim()}`
  if (form.seasonLabel.trim()) {
    title += ` ${form.seasonLabel.trim()}`
  }
  if (episodeLabel) {
    title += ` - ${episodeLabel}`
  }
  if (techLabel) {
    title += ` [${techLabel}]`
  }

  return title.slice(0, 128)
}

function buildPublishConfig(): Config.PublishConfig {
  const title = form.title.trim() || buildTitle()

  return {
    torrentName: form.torrentPath.replace(/^.*[\\\/]/, ''),
    torrentPath: form.torrentPath,
    information: form.information.trim(),
    category_bangumi: form.category_bangumi,
    category_nyaa: form.category_nyaa,
    tags: form.tags,
    completed: form.completed,
    remake: form.remake,
    title,
    targetSites: [...form.targetSites],
    content: {
      seriesTitleCN: form.seriesTitleCN.trim(),
      seriesTitleEN: form.seriesTitleEN.trim(),
      seriesTitleJP: form.seriesTitleJP.trim(),
      seasonLabel: form.seasonLabel.trim() || undefined,
      episodeLabel: form.episodeLabel.trim(),
      episodeTitle: form.episodeTitle.trim() || undefined,
      releaseTeam: form.releaseTeam.trim(),
      sourceType: form.sourceType.trim(),
      resolution: form.resolution.trim(),
      videoCodec: form.videoCodec.trim(),
      audioCodec: form.audioCodec.trim(),
      summary: form.summary.trim(),
      targetSites: [...form.targetSites],
    },
  }
}

async function loadFile(type: string) {
  isLoading.value = true
  try {
    const msg: Message.Global.FileType = { type }
    const { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFilePath(JSON.stringify(msg)))
    if (type === 'torrent') {
      form.torrentPath = path
    }
  } finally {
    isLoading.value = false
  }
}

async function getBangumiTags() {
  const msg: Message.BT.BangumiQuery = { query: form.title.trim() || buildTitle() }
  const { data, status }: Message.BT.BangumiTags = JSON.parse(await window.BTAPI.getBangumiTags(JSON.stringify(msg)))
  if (status !== 200) {
    ElMessage.error('获取 Bangumi 标签建议失败')
    return
  }

  suggestedBangumiTags.value = []
  for (const item of data) {
    if (item.type !== 'misc') {
      suggestedBangumiTags.value.push({ label: item.name, value: { label: item.name, value: item._id } })
    }
  }
}

const searchBangumiTags = async (query: string) => {
  const msg: Message.BT.BangumiQuery = { query }
  const { data, status }: Message.BT.BangumiTags = JSON.parse(await window.BTAPI.searchBangumiTags(JSON.stringify(msg)))
  if (status !== 200 || !data.success) {
    inputBangumiTags.value = []
    return
  }

  inputBangumiTags.value = []
  for (const item of data.tag) {
    if (item.type !== 'misc') {
      inputBangumiTags.value.push({ label: item.name, value: { label: item.name, value: item._id } })
    }
  }
}

async function loadProject() {
  isProjectLoading.value = true
  try {
    const result = await projectBridge.getProject(props.id)
    if (!result.ok) {
      project.value = null
      return
    }

    project.value = result.data.project
  } finally {
    isProjectLoading.value = false
  }
}

async function getTaskInfo() {
  const msg: Message.Task.TaskID = { id: props.id }
  const result: Message.Task.PublishConfig = JSON.parse(await window.taskAPI.getPublishConfig(JSON.stringify(msg)))
  const content = result.content as Partial<Config.Content_episode>

  form.torrentPath = result.torrentPath ?? form.torrentPath
  form.title = result.title ?? form.title
  form.category_bangumi = result.category_bangumi ?? form.category_bangumi
  form.category_nyaa = result.category_nyaa ?? form.category_nyaa
  form.information = result.information ?? form.information
  form.tags = result.tags ?? form.tags
  form.completed = result.completed ?? form.completed
  form.remake = result.remake ?? form.remake
  form.seriesTitleCN = content.seriesTitleCN ?? form.seriesTitleCN
  form.seriesTitleEN = content.seriesTitleEN ?? form.seriesTitleEN
  form.seriesTitleJP = content.seriesTitleJP ?? form.seriesTitleJP
  form.seasonLabel = content.seasonLabel ?? form.seasonLabel
  form.episodeLabel = content.episodeLabel ?? form.episodeLabel
  form.episodeTitle = content.episodeTitle ?? form.episodeTitle
  form.releaseTeam = content.releaseTeam ?? form.releaseTeam
  form.sourceType = content.sourceType ?? form.sourceType
  form.resolution = content.resolution ?? form.resolution
  form.videoCodec = content.videoCodec ?? form.videoCodec
  form.audioCodec = content.audioCodec ?? form.audioCodec
  form.summary = content.summary ?? form.summary
  form.targetSites = result.targetSites ?? content.targetSites ?? form.targetSites

  suggestedBangumiTags.value = []
  form.tags.forEach(value => {
    suggestedBangumiTags.value.push({ label: value.label, value })
  })
  syncSelectedReleaseProfile()
}

async function persistConfig() {
  const msg: Message.Task.ModifiedConfig = {
    id: props.id,
    config: buildPublishConfig(),
  }
  return JSON.parse(await window.taskAPI.saveConfig(JSON.stringify(msg))) as Message.Task.Result
}

async function saveDraft() {
  isSaving.value = true
  try {
    const result = await persistConfig()
    if (result.result.includes('success')) {
      await loadProject()
      ElMessage.success('已保存单集草稿')
    }
  } finally {
    isSaving.value = false
  }
}

async function createConfig() {
  if (!createForm.value) {
    return
  }

  isCreating.value = true
  try {
    const valid = await createForm.value.validate().catch(() => false)
    if (!valid) {
      ElMessage.error('请先补全单集发布配置')
      return
    }

    const msg: Message.Task.ModifiedConfig = {
      id: props.id,
      type: 'episode',
      config: buildPublishConfig(),
    }
    const { result }: Message.Task.Result = JSON.parse(await window.taskAPI.createConfig(JSON.stringify(msg)))
    if (!result.includes('success')) {
      ElMessage.error(result)
      return
    }

    await loadProject()
    ElMessage.success('单集项目已生成，正在进入发布页')
    setTimeout(() => {
      router.push({
        name: 'bt_publish',
        params: { id: props.id },
      })
    }, 300)
  } finally {
    isCreating.value = false
  }
}

onMounted(async () => {
  loadReleaseProfiles()
  const statusMessage: Message.Task.TaskStatus = { id: props.id, step: 'edit' }
  window.taskAPI.setTaskProcess(JSON.stringify(statusMessage))
  await Promise.all([getTaskInfo(), loadProject()])
  window.projectAPI.refreshProjectData(() => {
    void loadProject()
  })
  loadCompleted.value = true
})

watch(
  () => [form.releaseTeam, form.sourceType, form.resolution, form.videoCodec, form.audioCodec],
  () => {
    syncSelectedReleaseProfile()
  },
)
</script>

<template>
  <div v-if="loadCompleted" class="episode-edit">
    <el-alert
      title="单集模式会直接进入种子发布页，并记录计划目标站点用于防漏发提示。"
      type="info"
      :closable="false"
      show-icon
    />

    <div class="episode-edit__toolbar">
      <div class="episode-edit__title-group">
        <div class="episode-edit__eyebrow">Episode Workflow</div>
        <h3 class="episode-edit__title">单集发布配置</h3>
        <p class="episode-edit__description">
          保留旧流程给合集/剧场版，单集在这里走更紧凑的输入和更明确的目标站点检查。
        </p>
      </div>

      <div class="episode-edit__actions">
        <el-button plain :loading="isSaving" @click="saveDraft">
          <el-icon><Edit /></el-icon>
          <span>保存草稿</span>
        </el-button>
        <el-button type="primary" :loading="isCreating" @click="createConfig">进入发布</el-button>
      </div>
    </div>

    <section class="episode-edit__summary">
      <article class="episode-edit__summary-card">
        <div class="episode-edit__summary-label">目标站点</div>
        <div class="episode-edit__summary-value">{{ form.targetSites.length }}</div>
        <div class="episode-edit__summary-text">{{ targetSiteLabels || '尚未选择目标站点' }}</div>
      </article>
      <article class="episode-edit__summary-card">
        <div class="episode-edit__summary-label">已发布</div>
        <div class="episode-edit__summary-value">{{ publishedTargetSites.length }}</div>
        <div class="episode-edit__summary-text">{{ publishedTargetLabels || '还没有已发布目标站点' }}</div>
      </article>
      <article class="episode-edit__summary-card">
        <div class="episode-edit__summary-label">待补发</div>
        <div class="episode-edit__summary-value">{{ missingTargetSites.length }}</div>
        <div class="episode-edit__summary-text">{{ missingTargetLabels || '所有已选目标站点都已覆盖' }}</div>
      </article>
    </section>

    <el-form ref="createForm" :model="form" :rules="rules" label-position="top" class="episode-edit__form">
      <section class="episode-edit__grid">
        <article class="episode-edit__card">
          <div class="episode-edit__card-title">标题信息</div>
          <el-form-item label="中文标题">
            <el-input v-model="form.seriesTitleCN" placeholder="可选" />
          </el-form-item>
          <el-form-item label="英文标题" prop="seriesTitleEN">
            <el-input v-model="form.seriesTitleEN" placeholder="必填" />
          </el-form-item>
          <el-form-item label="日文标题">
            <el-input v-model="form.seriesTitleJP" placeholder="可选" />
          </el-form-item>
          <el-form-item label="季 / 篇章">
            <el-input v-model="form.seasonLabel" placeholder="例如 Season 2 / Final Season / Part 1" />
          </el-form-item>
          <el-form-item label="集数" prop="episodeLabel">
            <el-input v-model="form.episodeLabel" placeholder="例如 01 / 01-02 / SP1" />
          </el-form-item>
          <el-form-item label="分集标题">
            <el-input v-model="form.episodeTitle" placeholder="可选" />
          </el-form-item>
        </article>

        <article class="episode-edit__card">
          <div class="episode-edit__card-title">发布规格</div>
          <div class="episode-edit__preset-tools">
            <el-select
              v-model="selectedReleaseProfileId"
              clearable
              filterable
              placeholder="选择一个发布规格预设"
            >
              <el-option
                v-for="profile in releaseProfiles"
                :key="profile.id"
                :label="profile.name"
                :value="profile.id"
              />
            </el-select>
            <div class="episode-edit__preset-actions">
              <el-button plain @click="applySelectedReleaseProfile">套用预设</el-button>
              <el-button plain @click="saveCurrentAsReleaseProfile">保存当前配置</el-button>
              <el-button plain :disabled="!selectedReleaseProfileId" @click="removeSelectedReleaseProfile">
                删除预设
              </el-button>
            </div>
            <div class="episode-edit__preset-text">
              {{
                selectedReleaseProfileName
                  ? `当前已匹配预设：${selectedReleaseProfileName}`
                  : '可为不同发布组和规则保存命名预设，后续可直接切换。'
              }}
            </div>
          </div>
          <el-form-item label="发布组">
            <el-input v-model="form.releaseTeam" placeholder="默认 VCB-Studio" />
          </el-form-item>
          <el-form-item label="来源类型">
            <el-select v-model="form.sourceType">
              <el-option v-for="item in sourceTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="分辨率">
            <el-select v-model="form.resolution">
              <el-option v-for="item in resolutionOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="视频编码">
            <el-select v-model="form.videoCodec">
              <el-option v-for="item in videoCodecOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="音频编码">
            <el-select v-model="form.audioCodec">
              <el-option v-for="item in audioCodecOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
        </article>
      </section>

      <section class="episode-edit__grid">
        <article class="episode-edit__card">
          <div class="episode-edit__card-title">站点与种子</div>
          <el-form-item label="Bangumi 分类" prop="category_bangumi">
            <el-select v-model="form.category_bangumi">
              <el-option
                v-for="item in bangumiCategoryOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="Nyaa 分类" prop="category_nyaa">
            <el-select v-model="form.category_nyaa">
              <el-option v-for="item in nyaaCategoryOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标站点" prop="targetSites">
            <el-checkbox-group v-model="form.targetSites" class="episode-edit__checkboxes">
              <el-checkbox v-for="item in targetSiteOptions" :key="item.value" :label="item.value">
                {{ item.label }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="种子文件" prop="torrentPath">
            <el-input v-model="form.torrentPath" placeholder="请选择种子文件">
              <template #append>
                <el-button :icon="FolderOpened" :loading="isLoading" @click="loadFile('torrent')" />
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="Nyaa Information">
            <el-input v-model="form.information" />
          </el-form-item>
          <div class="episode-edit__switches">
            <el-checkbox v-model="form.completed">标记为完结</el-checkbox>
            <el-checkbox v-model="form.remake">标记为重制</el-checkbox>
          </div>
        </article>

        <article class="episode-edit__card">
          <div class="episode-edit__card-title">标题与标签</div>
          <el-form-item label="建议标题">
            <el-input :model-value="resolvedTitle" readonly>
              <template #append>
                <el-button @click="form.title = resolvedTitle">使用</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="发布标题">
            <el-input v-model="form.title" placeholder="留空则自动使用建议标题" maxlength="128" show-word-limit />
          </el-form-item>
          <el-form-item label="Bangumi 标签">
            <el-select
              v-model="form.tags"
              multiple
              filterable
              remote
              reserve-keyword
              value-key="value"
              placeholder="可选"
              :remote-method="searchBangumiTags"
            >
              <el-option
                v-for="item in bangumiTags"
                :key="item.value.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <div class="episode-edit__inline-action">
              <el-button plain @click="getBangumiTags">按标题获取标签建议</el-button>
            </div>
          </el-form-item>
          <el-form-item label="简介 / 备注">
            <el-input
              v-model="form.summary"
              type="textarea"
              :rows="8"
              placeholder="这里写本集补充说明、版本差异、字幕/音轨信息等。"
            />
          </el-form-item>
        </article>
      </section>

      <section class="episode-edit__preview-grid">
        <article class="episode-edit__card">
          <div class="episode-edit__card-title">发布预览</div>
          <div class="episode-edit__preview-title">{{ resolvedTitle }}</div>
          <div class="episode-edit__preview-copy">
            <div class="episode-edit__preview-row">
              <span>系列标题</span>
              <strong>{{ buildSeriesLabel() || '待填写标题' }}</strong>
            </div>
            <div class="episode-edit__preview-row">
              <span>技术标签</span>
              <strong>{{ [form.sourceType, form.resolution, form.videoCodec, form.audioCodec].join(' / ') }}</strong>
            </div>
            <div class="episode-edit__preview-row">
              <span>简介摘要</span>
              <strong>{{ summaryPlaceholder }}</strong>
            </div>
          </div>
        </article>

        <article class="episode-edit__card">
          <div class="episode-edit__card-title">目标站点检查</div>
          <div class="episode-edit__progress">
            <StatusChip :tone="publishProgressTone">
              {{ missingTargetSites.length === 0 ? '目标站点已全部覆盖' : `仍需补发 ${missingTargetSites.length} 个站点` }}
            </StatusChip>
            <StatusChip v-if="isProjectLoading" tone="info">正在同步项目结果</StatusChip>
          </div>
          <div class="episode-edit__preview-copy">
            <div class="episode-edit__preview-row">
              <span>计划发布</span>
              <strong>{{ targetSiteLabels || '尚未选择' }}</strong>
            </div>
            <div class="episode-edit__preview-row">
              <span>已完成</span>
              <strong>{{ publishedTargetLabels || '暂无已发布记录' }}</strong>
            </div>
            <div class="episode-edit__preview-row">
              <span>待补发</span>
              <strong>{{ missingTargetLabels || '暂无待补发站点' }}</strong>
            </div>
          </div>
        </article>
      </section>
    </el-form>
  </div>
</template>

<style scoped>
.episode-edit,
.episode-edit__summary,
.episode-edit__preview-grid {
  display: grid;
  gap: 18px;
}

.episode-edit__summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.episode-edit__summary-card,
.episode-edit__card {
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.52);
}

.episode-edit__summary-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.episode-edit__summary-value {
  margin-top: 10px;
  font-family: var(--font-display);
  font-size: 30px;
  letter-spacing: -0.05em;
}

.episode-edit__summary-text,
.episode-edit__preview-row span,
.episode-edit__preview-row strong {
  font-size: 14px;
  line-height: 1.7;
}

.episode-edit__summary-text {
  margin-top: 8px;
  color: var(--text-secondary);
}

.episode-edit__toolbar,
.episode-edit__actions,
.episode-edit__grid,
.episode-edit__preset-tools {
  display: grid;
  gap: 16px;
}

.episode-edit__toolbar {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.48), transparent 42%), var(--bg-panel);
}

.episode-edit__title-group {
  min-width: 0;
}

.episode-edit__eyebrow {
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.episode-edit__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
}

.episode-edit__description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.episode-edit__actions {
  grid-auto-flow: column;
  align-items: center;
}

.episode-edit__form,
.episode-edit__checkboxes {
  display: grid;
  gap: 16px;
}

.episode-edit__grid,
.episode-edit__preview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.episode-edit__card-title {
  margin-bottom: 12px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.episode-edit__switches,
.episode-edit__progress,
.episode-edit__preset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.episode-edit__preset-text {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.episode-edit__inline-action {
  margin-top: 10px;
}

.episode-edit__preview-title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
  word-break: break-word;
}

.episode-edit__preview-copy {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.episode-edit__preview-row {
  display: grid;
  gap: 4px;
}

.episode-edit__preview-row span {
  color: var(--text-muted);
}

.episode-edit__preview-row strong {
  color: var(--text-primary);
  font-weight: 600;
  word-break: break-word;
}

@media (max-width: 1080px) {
  .episode-edit__toolbar,
  .episode-edit__grid,
  .episode-edit__preview-grid,
  .episode-edit__summary {
    grid-template-columns: 1fr;
  }

  .episode-edit__actions {
    grid-auto-flow: row;
  }

  .episode-edit__preset-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
