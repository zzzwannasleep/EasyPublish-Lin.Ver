<script setup lang="ts">
import { computed, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import StatusChip from '../../components/feedback/StatusChip.vue'
import type { SeriesTitleMatchConfig, SeriesTitleTagMapping } from '../../types/project'
import {
  applySeriesTitleTagTemplateVariables,
  composeSeriesPublishTitle,
  getDefaultSeriesTitleTagTemplate,
  resolveSeriesTitleMappedTagBindings,
  renderSeriesTitleTemplate,
} from '../../../../shared/utils/series-title-match'

const props = defineProps<{
  projectName: string
  torrentPath?: string
}>()

const DEFAULT_TITLE_TAG_TEMPLATE = getDefaultSeriesTitleTagTemplate()
let mappingSeed = 0

const form = reactive<SeriesTitleMatchConfig>({
  titleTemplate: '',
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
  if (!currentFileName) {
    return null
  }

  const variables: Record<string, string> = {}
  const titleTagBindings = resolveSeriesTitleMappedTagBindings(form.titleTagMappings, [currentFileName])
  const titleTags = [...new Set(titleTagBindings.flatMap(binding => binding.labels))]
  const titleVariables = applySeriesTitleTagTemplateVariables(variables, titleTagBindings)
  const title = renderSeriesTitleTemplate(form.titleTemplate, titleVariables)
  const suggestedTitle =
    title ||
    composeSeriesPublishTitle({
      releaseTeam: '',
      mainTitle: props.projectName,
      seasonLabel: '',
      titleTags,
    })

  return {
    fileName: currentFileName,
    titleTags,
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
        <p class="preview-text">只保留主标题模板，标题标签完全靠映射词命中，不再自动拆文件名字段。</p>
      </div>
      <StatusChip tone="warning">预览态</StatusChip>
    </div>

    <div class="preview-grid">
      <label class="field field--wide">
        <span class="field-label">主标题模板</span>
        <el-input v-model="form.titleTemplate" placeholder="[Group][片名][<subtag>][<misctag>]" />
      </label>
    </div>

    <div class="card">
      <div class="preview-head">
        <div>
          <div class="field-label">标题标签映射</div>
          <div class="preview-text">每条规则都可以单独指定模板词，命中后会把标题标签写进对应模板词里。</div>
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
      <div v-else class="empty">暂时还没有映射规则，可以先加一条，例如 ASSx2 -> &lt;subtag&gt; -> 简繁日内封。</div>
    </div>

    <div v-if="preview" class="chips">
      <StatusChip tone="success">当前 torrent 已识别</StatusChip>
      <span class="preview-text">{{ preview.fileName }}</span>
      <StatusChip v-for="titleTag in preview.titleTags" :key="`${preview.fileName}-${titleTag}`" tone="success">{{ titleTag }}</StatusChip>
      <span v-if="preview.suggestedTitle" class="preview-text">{{ preview.title ? '模板标题：' : '预览标题：' }}{{ preview.suggestedTitle }}</span>
    </div>

    <div class="actions">
      <el-button plain @click="showPreviewOnlyMessage('标题匹配方案保存')">保存匹配方案</el-button>
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
