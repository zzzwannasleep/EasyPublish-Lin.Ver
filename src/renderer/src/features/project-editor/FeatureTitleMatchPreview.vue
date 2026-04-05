<script setup lang="ts">
import { computed, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import StatusChip from '../../components/feedback/StatusChip.vue'
import type { SeriesTitleMatchConfig, SeriesTitleTagMapping } from '../../types/project'
import {
  applySeriesTitleTagTemplateVariables,
  composeSeriesPublishTitle,
  getDefaultSeriesTitleTagTemplate,
  matchSeriesTitlePattern,
  normalizeMatchedSubtitleProfile,
  normalizeMatchedVideoProfile,
  resolveSeriesTitleMappedTagBindings,
  renderSeriesEpisodeTemplate,
  renderSeriesTitleTemplate,
  renderSeriesVariantTemplate,
  stripTorrentExtension,
} from '../../../../shared/utils/series-title-match'

const props = defineProps<{
  projectName: string
  torrentPath?: string
}>()

const DEFAULT_TITLE_TAG_TEMPLATE = getDefaultSeriesTitleTagTemplate()
let mappingSeed = 0

const form = reactive<SeriesTitleMatchConfig>({
  fileNamePattern: '',
  episodeTemplate: '<ep>',
  variantTemplate: '<res>p-<sub>',
  titleTemplate: '',
  releaseTeamTemplate: '',
  sourceTypeTemplate: '<source>',
  resolutionTemplate: '<res>p',
  videoCodecTemplate: '<video>',
  audioCodecTemplate: '<audio>',
  subtitleTemplate: '<sub>',
  titleTagMappings: [],
  targetSites: [],
})

function getFileName(path: string) {
  return path.replace(/^.*[\\/]/, '')
}

function createTitleTagMapping(value?: Partial<SeriesTitleTagMapping>): SeriesTitleTagMapping {
  mappingSeed += 1
  return {
    id: value?.id?.trim() || `feature-title-tag-${Date.now()}-${mappingSeed}`,
    keyword: value?.keyword?.trim() || '',
    templateToken: value?.templateToken?.trim() || DEFAULT_TITLE_TAG_TEMPLATE,
    label: value?.label?.trim() || '',
  }
}

function addTitleTagMapping() {
  form.titleTagMappings = [...(form.titleTagMappings ?? []), createTitleTagMapping()]
}

function removeTitleTagMapping(mappingId: string | undefined) {
  form.titleTagMappings = (form.titleTagMappings ?? []).filter(item => item.id !== mappingId)
}

function showPreviewOnlyMessage(action: string) {
  ElMessage.info(`${action} 先保留为布局预览，后面再接真实保存逻辑。`)
}

const preview = computed(() => {
  const currentFileName = props.torrentPath?.trim() ? getFileName(props.torrentPath.trim()) : ''
  if (!form.fileNamePattern || !currentFileName) {
    return null
  }

  const variables = matchSeriesTitlePattern(form.fileNamePattern, currentFileName)
  if (!variables) {
    return { fileName: currentFileName, matched: false as const }
  }

  const episodeLabel = renderSeriesEpisodeTemplate(form.episodeTemplate, variables)
  const variantName = renderSeriesVariantTemplate(form.variantTemplate, variables)
  const sourceType = renderSeriesTitleTemplate(form.sourceTypeTemplate, variables)
  const resolution = renderSeriesTitleTemplate(form.resolutionTemplate, variables)
  const videoCodec = renderSeriesTitleTemplate(form.videoCodecTemplate, variables)
  const audioCodec = renderSeriesTitleTemplate(form.audioCodecTemplate, variables)
  const subtitle = renderSeriesTitleTemplate(form.subtitleTemplate, variables)
  const releaseTeam = renderSeriesTitleTemplate(form.releaseTeamTemplate, variables)
  const titleTagBindings = resolveSeriesTitleMappedTagBindings(form.titleTagMappings, [
    currentFileName,
    ...Object.values(variables),
    episodeLabel,
    variantName,
    releaseTeam,
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
  ])
  const titleVariables = applySeriesTitleTagTemplateVariables(variables, titleTagBindings)
  const title = renderSeriesTitleTemplate(form.titleTemplate, titleVariables)
  const suggestedTitle =
    title ||
    composeSeriesPublishTitle({
      releaseTeam,
      mainTitle: props.projectName,
      seasonLabel: '',
      episodeLabel,
      sourceType,
      resolution,
      videoCodec,
      audioCodec,
      variantName: variantName || stripTorrentExtension(currentFileName),
    })

  return {
    fileName: currentFileName,
    matched: true as const,
    episodeLabel,
    variantName: variantName || stripTorrentExtension(currentFileName),
    sourceType,
    resolution,
    videoCodec,
    audioCodec,
    subtitle,
    videoProfile: normalizeMatchedVideoProfile(resolution),
    subtitleProfile: normalizeMatchedSubtitleProfile(subtitle),
    titleTags: titleTagBindings.flatMap(binding => binding.labels),
    titleTagBindings,
    title,
    suggestedTitle,
  }
})
</script>

<template>
  <section class="preview-section">
    <div class="preview-head">
      <div>
        <h3 class="preview-title">标题匹配自动识别</h3>
        <p class="preview-text">先完整摆一份剧集工作台的标题匹配区，方便你直接看合集 / 电影模式要不要也按这套方式组织。</p>
      </div>
      <StatusChip tone="warning">预览态</StatusChip>
    </div>

    <div class="preview-grid">
      <label class="field field--wide">
        <span class="field-label">文件名匹配</span>
        <el-input v-model="form.fileNamePattern" placeholder="[Group] Movie Title - <ep> [<source>][<res>P][<video>][<sub>]" />
      </label>
      <label class="field">
        <span class="field-label">分集模板</span>
        <el-input v-model="form.episodeTemplate" placeholder="<ep>" />
      </label>
      <label class="field">
        <span class="field-label">版本模板</span>
        <el-input v-model="form.variantTemplate" placeholder="<res>p-<sub>" />
      </label>
      <label class="field field--wide">
        <span class="field-label">主标题模板</span>
        <el-input v-model="form.titleTemplate" placeholder="[Group][片名][<source>][<res>P][<video>][<sub>]" />
      </label>
      <label class="field"><span class="field-label">来源类型模板</span><el-input v-model="form.sourceTypeTemplate" placeholder="<source>" /></label>
      <label class="field"><span class="field-label">分辨率模板</span><el-input v-model="form.resolutionTemplate" placeholder="<res>p" /></label>
      <label class="field"><span class="field-label">字幕模板</span><el-input v-model="form.subtitleTemplate" placeholder="<sub>" /></label>
      <label class="field"><span class="field-label">制作组模板</span><el-input v-model="form.releaseTeamTemplate" placeholder="<team>" /></label>
      <label class="field"><span class="field-label">音频编码模板</span><el-input v-model="form.audioCodecTemplate" placeholder="<audio>" /></label>
      <label class="field"><span class="field-label">视频编码模板</span><el-input v-model="form.videoCodecTemplate" placeholder="<video>" /></label>
    </div>

    <div class="card">
      <div class="preview-head">
        <div>
          <div class="field-label">标题标签映射</div>
          <div class="preview-text">这里也先保留一整块，方便你判断合集 / 电影模式以后要不要把标签映射一起收进工作台。</div>
        </div>
        <el-button plain size="small" @click="addTitleTagMapping">新增映射</el-button>
      </div>

      <div v-if="form.titleTagMappings?.length" class="stack">
        <div v-for="mapping in form.titleTagMappings" :key="mapping.id" class="mapping-row">
          <el-input v-model="mapping.keyword" placeholder="检测词，例如 ASSx2" />
          <el-input v-model="mapping.templateToken" placeholder="模板词，例如 <subtag>" />
          <el-input v-model="mapping.label" placeholder="标题标签，例如 简繁日内封" />
          <el-button text type="danger" @click="removeTitleTagMapping(mapping.id)">删除</el-button>
        </div>
      </div>
      <div v-else class="empty">暂时还没有映射规则，可以先加一条看看排布。</div>
    </div>

    <div v-if="preview" class="chips">
      <template v-if="preview.matched">
        <StatusChip tone="success">当前 torrent 可匹配</StatusChip>
        <span class="preview-text">{{ preview.fileName }} -> {{ preview.episodeLabel || '??' }} / {{ preview.variantName }}</span>
        <StatusChip v-if="preview.sourceType" tone="neutral">{{ preview.sourceType }}</StatusChip>
        <StatusChip v-if="preview.resolution" tone="info">{{ preview.resolution }}</StatusChip>
        <StatusChip v-if="preview.videoCodec" tone="info">{{ preview.videoCodec }}</StatusChip>
        <StatusChip v-if="preview.audioCodec" tone="neutral">{{ preview.audioCodec }}</StatusChip>
        <StatusChip v-if="preview.videoProfile" tone="info">{{ preview.videoProfile }}</StatusChip>
        <StatusChip v-if="preview.subtitleProfile" tone="warning">{{ preview.subtitleProfile }}</StatusChip>
        <StatusChip v-for="titleTag in preview.titleTags" :key="`${preview.fileName}-${titleTag}`" tone="success">{{ titleTag }}</StatusChip>
        <span v-if="preview.suggestedTitle" class="preview-text">{{ preview.title ? '模板标题：' : '预览标题：' }}{{ preview.suggestedTitle }}</span>
      </template>
      <template v-else>
        <StatusChip tone="danger">当前 torrent 未命中</StatusChip>
        <span class="preview-text">{{ preview.fileName }} 没有命中文件名匹配规则。</span>
      </template>
    </div>

    <div class="actions">
      <el-button plain @click="showPreviewOnlyMessage('标题匹配方案保存')">保存匹配方案</el-button>
      <el-button type="primary" @click="showPreviewOnlyMessage('导入 .torrent 自动识别')">导入 .torrent 自动识别</el-button>
    </div>
  </section>
</template>

<style scoped>
.preview-section,.card,.stack,.field{display:grid;gap:14px}
.preview-section{padding:22px;border:1px solid var(--border-soft);border-radius:1.75rem;background:linear-gradient(180deg,rgba(255,255,255,.38),transparent 42%),var(--bg-panel);box-shadow:var(--shadow-sm)}
.card,.empty{padding:16px;border:1px solid var(--border-soft);border-radius:1.25rem;background:color-mix(in srgb,var(--bg-panel) 92%,white 8%)}
.preview-head,.chips,.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.preview-head{justify-content:space-between}
.preview-title{margin:0;font-size:1.2rem;line-height:1.08;color:var(--text-primary);font-family:var(--font-display);letter-spacing:-.04em}
.preview-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}
.field--wide{grid-column:span 2}
.field-label{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.preview-text,.empty{color:var(--text-secondary);font-size:13px;line-height:1.75}
.mapping-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}
@media (min-width:1280px){.preview-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:860px){.field--wide{grid-column:auto}.mapping-row{grid-template-columns:1fr;align-items:stretch}}
</style>
