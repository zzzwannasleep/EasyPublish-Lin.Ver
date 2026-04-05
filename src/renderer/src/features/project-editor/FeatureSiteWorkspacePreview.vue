<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import StatusChip from '../../components/feedback/StatusChip.vue'
import { siteBridge } from '../../services/bridge/site'
import type { SiteCatalogEntry, SiteFieldSchemaEntry, SiteId } from '../../types/site'
import SeriesRichTextEditor from './SeriesRichTextEditor.vue'

type SiteFieldValue = string | number | boolean | undefined
type SiteFieldForm = Partial<Record<SiteId, Record<string, SiteFieldValue>>>

const props = defineProps<{
  initialTargetSiteIds?: SiteId[]
  initialSiteFieldDefaults?: Config.PublishConfig['siteFieldDefaults']
  initialBodyMarkdown?: string
}>()

const siteCatalog = ref<SiteCatalogEntry[]>([])
const loadError = ref('')
const SITE_ORDER: SiteId[] = ['bangumi', 'mikan', 'anibt', 'miobt', 'nyaa', 'acgrip', 'dmhy', 'acgnx_a', 'acgnx_g']
const form = reactive({
  targetSites: [...new Set((props.initialTargetSiteIds ?? []).filter(Boolean))] as SiteId[],
  siteFieldDefaults: normalizeSiteFieldDefaults(props.initialSiteFieldDefaults) as SiteFieldForm,
  bodyMarkdown: props.initialBodyMarkdown ?? '',
})

function normalizeSiteFieldDefaults(value: unknown): SiteFieldForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, defaults]) => defaults && typeof defaults === 'object' && !Array.isArray(defaults)),
  ) as SiteFieldForm
}

function getEditableSiteFields(siteId: SiteId) {
  return (siteCatalog.value.find(site => site.id === siteId)?.fieldSchemas ?? []).filter(field => field.mode !== 'readonly')
}

function ensureSiteFieldEntry(siteId: SiteId) {
  if (!form.siteFieldDefaults[siteId]) form.siteFieldDefaults[siteId] = {}
  return form.siteFieldDefaults[siteId] as Record<string, SiteFieldValue>
}

function readSiteFieldValue(siteId: SiteId, field: SiteFieldSchemaEntry) {
  const value = ensureSiteFieldEntry(siteId)[field.key]
  if (field.control === 'checkbox') return typeof value === 'boolean' ? value : false
  if (field.control === 'number') return typeof value === 'number' ? value : undefined
  return typeof value === 'string' ? value : ''
}

function updateSiteFieldValue(siteId: SiteId, field: SiteFieldSchemaEntry, value: unknown) {
  const entry = ensureSiteFieldEntry(siteId)
  if (field.control === 'checkbox') entry[field.key] = value === true || value === false ? value : undefined
  else if (field.control === 'number') entry[field.key] = typeof value === 'number' ? value : undefined
  else if (field.control === 'textarea') entry[field.key] = typeof value === 'string' ? value : ''
  else entry[field.key] = typeof value === 'string' ? value.trim() : ''
}

function addTargetSite(siteId: SiteId) {
  form.targetSites = [...new Set([...form.targetSites, siteId])]
}

function removeTargetSite(siteId: SiteId) {
  form.targetSites = form.targetSites.filter(item => item !== siteId)
}

function sortSiteIds(siteIds: SiteId[]) {
  return [...new Set(siteIds.filter(Boolean))].sort((left, right) => {
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

const availableSites = computed(() =>
  [...siteCatalog.value]
    .filter(site => site.enabled && site.capabilitySet.publish.torrent && site.accountStatus === 'authenticated')
    .sort((left, right) => sortSiteIds([left.id, right.id]).indexOf(left.id) - sortSiteIds([left.id, right.id]).indexOf(right.id)),
)

const visibleTargetSiteIds = computed(() =>
  sortSiteIds(form.targetSites).filter(siteId => availableSites.value.some(site => site.id === siteId)),
)

const selectedSections = computed(() =>
  visibleTargetSiteIds.value
    .map(siteId => availableSites.value.find(site => site.id === siteId) ?? null)
    .filter((site): site is SiteCatalogEntry => Boolean(site))
    .map(site => ({ site, fields: getEditableSiteFields(site.id) })),
)

watch(
  () => props.initialTargetSiteIds,
  nextValue => {
    form.targetSites = [...new Set((nextValue ?? []).filter(Boolean))]
  },
)

watch(
  () => props.initialSiteFieldDefaults,
  nextValue => {
    form.siteFieldDefaults = normalizeSiteFieldDefaults(nextValue)
  },
)

watch(
  () => props.initialBodyMarkdown,
  nextValue => {
    form.bodyMarkdown = nextValue ?? ''
  },
)

onMounted(async () => {
  const result = await siteBridge.listSites()
  if (result.ok) siteCatalog.value = result.data.sites
  else loadError.value = result.error.message
})
</script>

<template>
  <section class="preview-section">
    <div class="preview-head">
      <h3 class="preview-title">选择站点</h3>
      <StatusChip tone="info">{{ visibleTargetSiteIds.length }} 个目标站点</StatusChip>
    </div>
    <div v-if="loadError" class="empty">{{ loadError }}</div>
    <div v-else-if="availableSites.length" class="grid">
      <article
        v-for="site in availableSites"
        :key="site.id"
        :class="['card', { 'is-active': form.targetSites.includes(site.id) }]"
        @click="form.targetSites.includes(site.id) ? removeTargetSite(site.id) : addTargetSite(site.id)"
      >
        <div class="preview-head">
          <div>
            <div class="card-title">{{ site.name }}</div>
            <div class="preview-text">{{ site.accountMessage || '账号有效，可直接加入当前项目。' }}</div>
          </div>
          <StatusChip :tone="form.targetSites.includes(site.id) ? 'success' : 'neutral'">
            {{ form.targetSites.includes(site.id) ? '已选择' : '未选择' }}
          </StatusChip>
        </div>
        <div class="preview-text">{{ getEditableSiteFields(site.id).length ? `${getEditableSiteFields(site.id).length} 个填写项` : '无需额外填写' }}</div>
      </article>
    </div>
    <div v-else class="empty">还没有已登录并校验通过的可发布站点。</div>
  </section>

  <section class="preview-section">
    <div class="preview-head">
      <h3 class="preview-title">站点字段</h3>
      <StatusChip tone="info">{{ selectedSections.length }} 个站点展开</StatusChip>
    </div>
    <div v-if="selectedSections.length" class="stack">
      <article v-for="section in selectedSections" :key="section.site.id" class="card is-active">
        <div class="preview-head">
          <div>
            <div class="card-title">{{ section.site.name }}</div>
            <div class="preview-text">{{ section.site.accountMessage || '这里先看合集 / 电影模式的站点字段展开方式。' }}</div>
          </div>
          <StatusChip :tone="section.fields.length ? 'info' : 'neutral'">{{ section.fields.length ? `${section.fields.length} 个字段` : '无需额外填写' }}</StatusChip>
        </div>
        <div v-if="section.fields.length" class="field-grid">
          <label v-for="field in section.fields" :key="field.key" class="field">
            <span class="field-label">{{ field.key }}</span>
            <el-select
              v-if="field.control === 'select'"
              :model-value="readSiteFieldValue(section.site.id, field)"
              clearable
              @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
            >
              <el-option v-for="option in field.options ?? []" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
            <el-input
              v-else-if="field.control === 'textarea'"
              :model-value="readSiteFieldValue(section.site.id, field)"
              type="textarea"
              :rows="field.rows ?? 4"
              @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
            />
            <el-input
              v-else-if="field.control === 'text'"
              :model-value="readSiteFieldValue(section.site.id, field)"
              @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
            />
            <el-input-number
              v-else-if="field.control === 'number'"
              :model-value="readSiteFieldValue(section.site.id, field)"
              :controls="false"
              @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
            />
            <el-switch
              v-else
              :model-value="Boolean(readSiteFieldValue(section.site.id, field))"
              @update:model-value="value => updateSiteFieldValue(section.site.id, field, value)"
            />
          </label>
        </div>
        <div v-else class="empty">这个站点没有额外填写项。</div>
      </article>
    </div>
    <div v-else class="empty">上面先选择几个站点，这里就会展开对应站点字段。</div>
  </section>

  <section class="preview-section">
    <div class="preview-head">
      <div>
        <h3 class="preview-title">正文编辑</h3>
        <p class="preview-text">先用和剧集工作台同一套正文编辑器，把合集 / 电影模式的正文区位置和占比定下来。</p>
      </div>
      <StatusChip tone="warning">预览编辑</StatusChip>
    </div>
    <SeriesRichTextEditor v-model="form.bodyMarkdown" placeholder="这里先按合集 / 电影工作台的思路编辑共享正文。" />
  </section>
</template>

<style scoped>
.preview-section,.grid,.stack,.field,.field-grid{display:grid;gap:14px}
.preview-section{padding:22px;border:1px solid var(--border-soft);border-radius:1.75rem;background:linear-gradient(180deg,rgba(255,255,255,.38),transparent 42%),var(--bg-panel);box-shadow:var(--shadow-sm)}
.preview-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.preview-title{margin:0;font-size:1.2rem;line-height:1.08;color:var(--text-primary);font-family:var(--font-display);letter-spacing:-.04em}
.preview-text,.empty{color:var(--text-secondary);font-size:13px;line-height:1.75}
.grid{grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
.stack,.card{display:grid;gap:12px}
.card,.empty{padding:16px;border:1px solid var(--border-soft);border-radius:1.25rem;background:color-mix(in srgb,var(--bg-panel) 92%,white 8%)}
.card{cursor:pointer;transition:border-color 160ms ease,background 160ms ease,transform 160ms ease}
.card:hover,.card.is-active{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 30%,var(--border-soft))}
.card.is-active{background:linear-gradient(135deg,color-mix(in srgb,var(--brand-soft) 74%,white 26%),rgba(255,255,255,.64)),color-mix(in srgb,var(--bg-panel) 92%,white 8%)}
.card-title{color:var(--text-primary);font-size:15px;font-weight:700}
.field-grid{grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
.field-label{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.field :deep(.el-input-number){width:100%}
</style>
