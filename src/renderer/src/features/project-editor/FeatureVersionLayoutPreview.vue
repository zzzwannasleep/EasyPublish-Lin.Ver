<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, DocumentCopy, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import StatusChip from '../../components/feedback/StatusChip.vue'

type TorrentEntry = NonNullable<Config.PublishConfig['torrentEntries']>[number]

const props = defineProps<{
  projectName: string
  sourceLabel?: string
  torrentEntries?: TorrentEntry[]
}>()

const emit = defineEmits<{
  selectPath: [path: string]
}>()

const selectedVariantId = ref<string | null>(null)

const variants = computed(() => {
  const entries = props.torrentEntries?.length
    ? props.torrentEntries
    : [{ id: 'feature-main', name: props.projectName, path: '', enabled: true }]

  return entries.map((entry, index) => ({
    id: entry.id || `feature-variant-${index + 1}`,
    name: entry.name?.trim() || `版本 ${index + 1}`,
    path: entry.path?.trim() || '',
    enabled: entry.enabled !== false,
  }))
})

watch(
  variants,
  nextVariants => {
    if (!nextVariants.some(item => item.id === selectedVariantId.value)) {
      selectedVariantId.value = nextVariants[0]?.id ?? null
    }
  },
  { immediate: true },
)

function activateVariant(variant: (typeof variants.value)[number]) {
  selectedVariantId.value = variant.id
  emit('selectPath', variant.path)
}

function showPreviewOnlyMessage(action: string) {
  ElMessage.info(`${action} 这一块我先给你做成可看的预览层，后面再决定要不要真正接成多层结构。`)
}
</script>

<template>
  <section class="preview-section">
    <div class="preview-head">
      <div>
        <h3 class="preview-title">分集版本</h3>
        <p class="preview-text">这里先把当前项目的 torrent 条目映射成版本卡片，让你直接感受合集 / 电影模式照剧集工作台排起来是什么样。</p>
      </div>
      <div class="chips">
        <StatusChip tone="info">主条目</StatusChip>
        <StatusChip tone="success">{{ variants.length }} 个版本</StatusChip>
      </div>
    </div>

    <div class="episode-chip">
      <span class="episode-title">主条目</span>
      <span class="preview-text">{{ sourceLabel || '当前工作台' }} / {{ variants.length }} 个版本</span>
    </div>

    <div class="variant-grid">
      <article
        v-for="variant in variants"
        :key="variant.id"
        :class="['variant-card', { 'is-active': selectedVariantId === variant.id }]"
      >
        <div class="preview-head">
          <div>
            <div class="variant-name">{{ variant.name }}</div>
          </div>
          <div class="chips">
            <StatusChip v-if="selectedVariantId === variant.id" tone="success">当前预览</StatusChip>
            <StatusChip :tone="variant.enabled ? 'info' : 'neutral'">{{ variant.enabled ? '启用' : '已禁用' }}</StatusChip>
          </div>
        </div>

        <div class="actions">
          <el-button type="primary" plain size="small" @click="activateVariant(variant)">
            <el-icon><SwitchButton /></el-icon>
            <span>打开</span>
          </el-button>
          <el-button plain size="small" @click="showPreviewOnlyMessage('版本复制')">
            <el-icon><DocumentCopy /></el-icon>
            <span>复制</span>
          </el-button>
          <el-button text type="danger" size="small" @click="showPreviewOnlyMessage('版本删除')">
            <el-icon><Delete /></el-icon>
            <span>删除</span>
          </el-button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.preview-section,.variant-grid{display:grid;gap:14px}
.preview-section{padding:22px;border:1px solid var(--border-soft);border-radius:1.75rem;background:linear-gradient(180deg,rgba(255,255,255,.38),transparent 42%),var(--bg-panel);box-shadow:var(--shadow-sm)}
.preview-head,.chips,.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.preview-head{justify-content:space-between}
.preview-title{margin:0;font-size:1.2rem;line-height:1.08;color:var(--text-primary);font-family:var(--font-display);letter-spacing:-.04em}
.preview-text{color:var(--text-secondary);font-size:13px;line-height:1.75}
.episode-chip,.variant-card{display:grid;gap:10px;padding:16px;border:1px solid var(--border-soft);border-radius:1.25rem;background:color-mix(in srgb,var(--bg-panel) 92%,white 8%)}
.variant-grid{grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}
.variant-card{transition:border-color 160ms ease,background 160ms ease,transform 160ms ease}
.variant-card:hover,.variant-card.is-active{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 30%,var(--border-soft))}
.variant-card.is-active{background:linear-gradient(135deg,color-mix(in srgb,var(--brand-soft) 74%,white 26%),rgba(255,255,255,.64)),color-mix(in srgb,var(--bg-panel) 92%,white 8%)}
.episode-title,.variant-name{color:var(--text-primary);font-size:15px;font-weight:700}
@media (max-width:720px){.preview-head,.actions{flex-direction:column;align-items:stretch}.actions :deep(.el-button){width:100%}}
</style>
