<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentAdd } from '@element-plus/icons-vue'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { marked } from 'marked'

type ImportedMarkdownDocument = {
  id: string
  name: string
  content: string
  size: number
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
  }>(),
  {
    placeholder: '在这里编辑当前版本的 Markdown 正文。',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const activeMode = ref<'rich' | 'source' | 'preview'>('rich')
const importedDocMode = ref<'source' | 'preview'>('preview')
const activeImportedDocumentId = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const importedDocuments = ref<ImportedMarkdownDocument[]>([])
const internalMarkdown = ref(normalizeMarkdown(props.modelValue))
const isSyncingEditor = ref(false)

function normalizeMarkdown(value: string | undefined) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : ''
}

function markdownToHtml(markdown: string) {
  return (marked.parse(markdown, { async: false }) as string) || ''
}

async function htmlToMarkdown(html: string) {
  try {
    const response = await window.globalAPI.html2markdown(JSON.stringify({ content: html }))
    const payload = JSON.parse(response) as Message.Global.FileContent
    return normalizeMarkdown(payload.content)
  } catch (_error) {
    return normalizeMarkdown(html.replace(/<[^>]+>/g, ' '))
  }
}

function emitMarkdown(value: string) {
  const normalizedValue = normalizeMarkdown(value)
  internalMarkdown.value = normalizedValue
  emit('update:modelValue', normalizedValue)
}

function normalizeExternalLink(value: string) {
  const nextValue = value.trim()
  if (!nextValue) {
    return ''
  }

  if (/^(https?:\/\/|mailto:|magnet:|ftp:\/\/|file:\/\/|data:)/i.test(nextValue)) {
    return nextValue
  }

  if (nextValue.startsWith('//')) {
    return `https:${nextValue}`
  }

  return `https://${nextValue}`
}

function normalizeMediaSource(value: string) {
  const nextValue = value.trim()
  if (!nextValue) {
    return ''
  }

  if (/^(https?:\/\/|file:\/\/|data:)/i.test(nextValue)) {
    return nextValue
  }

  if (/^[A-Za-z]:[\\/]/.test(nextValue)) {
    return `file:///${nextValue.replace(/\\/g, '/')}`
  }

  return nextValue
}

const editor = useEditor({
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: props.placeholder,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
    }),
    Image.configure({
      allowBase64: true,
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
  ],
  content: markdownToHtml(internalMarkdown.value),
  editorProps: {
    attributes: {
      class: 'series-rich-text-editor__prose',
    },
  },
  onUpdate: async ({ editor: currentEditor }) => {
    if (isSyncingEditor.value) {
      return
    }

    const nextMarkdown = await htmlToMarkdown(currentEditor.getHTML())
    if (nextMarkdown !== internalMarkdown.value) {
      emitMarkdown(nextMarkdown)
    }
  },
})

function syncEditorFromMarkdown(value: string) {
  if (!editor.value) {
    return
  }

  const nextHtml = markdownToHtml(value)
  if (editor.value.getHTML() === nextHtml) {
    return
  }

  isSyncingEditor.value = true
  editor.value.commands.setContent(nextHtml, { emitUpdate: false })
  isSyncingEditor.value = false
}

const activeImportedDocument = computed(
  () => importedDocuments.value.find(document => document.id === activeImportedDocumentId.value) ?? null,
)

const currentPreviewHtml = computed(() =>
  internalMarkdown.value.trim() ? markdownToHtml(internalMarkdown.value) : '',
)

const importedPreviewHtml = computed(() =>
  activeImportedDocument.value?.content.trim() ? markdownToHtml(activeImportedDocument.value.content) : '',
)

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  if (size >= 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${size} B`
}

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) {
    return
  }

  const nextDocuments = await Promise.all(
    files.map(async file => ({
      id: `markdown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      content: normalizeMarkdown(await file.text()),
      size: file.size,
    })),
  )

  const existingKeys = new Set(importedDocuments.value.map(document => `${document.name}-${document.content}`))
  nextDocuments.forEach(document => {
    const key = `${document.name}-${document.content}`
    if (!existingKeys.has(key)) {
      importedDocuments.value.push(document)
    }
  })

  activeImportedDocumentId.value = nextDocuments[0]?.id ?? activeImportedDocumentId.value
  input.value = ''
}

function applyImportedDocument(document: ImportedMarkdownDocument) {
  emitMarkdown(document.content)
  if (activeMode.value === 'rich') {
    syncEditorFromMarkdown(document.content)
  }
  ElMessage.success(`已载入 ${document.name}`)
}

function removeImportedDocument(documentId: string) {
  const currentIndex = importedDocuments.value.findIndex(document => document.id === documentId)
  if (currentIndex < 0) {
    return
  }

  importedDocuments.value = importedDocuments.value.filter(document => document.id !== documentId)

  if (activeImportedDocumentId.value === documentId) {
    const nextDocument = importedDocuments.value[currentIndex] ?? importedDocuments.value[currentIndex - 1] ?? null
    activeImportedDocumentId.value = nextDocument?.id ?? null
  }
}

async function promptForLink() {
  if (!editor.value) {
    return
  }

  const currentHref = (editor.value.getAttributes('link').href as string | undefined) ?? ''
  const result = await ElMessageBox.prompt('输入链接地址', '插入超链接', {
    inputValue: currentHref,
    inputPlaceholder: 'https://example.com',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).catch(() => null)

  if (!result || typeof result !== 'object' || !('value' in result)) {
    return
  }

  const nextHref = normalizeExternalLink(result.value)
  const chain = editor.value.chain().focus().extendMarkRange('link')

  if (!nextHref) {
    chain.unsetLink().run()
    return
  }

  chain.setLink({ href: nextHref }).run()
}

async function promptForImage() {
  if (!editor.value) {
    return
  }

  const result = await ElMessageBox.prompt('输入图片地址或本地绝对路径', '插入图片', {
    inputPlaceholder: 'https://example.com/image.png',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).catch(() => null)

  if (!result || typeof result !== 'object' || !('value' in result)) {
    return
  }

  const nextSource = normalizeMediaSource(result.value)
  if (!nextSource) {
    return
  }

  editor.value.chain().focus().setImage({ src: nextSource }).run()
}

function insertHardBreak() {
  editor.value?.chain().focus().setHardBreak().run()
}

watch(
  () => props.modelValue,
  value => {
    const normalizedValue = normalizeMarkdown(value)
    if (normalizedValue === internalMarkdown.value) {
      return
    }

    internalMarkdown.value = normalizedValue
    if (activeMode.value === 'rich') {
      syncEditorFromMarkdown(normalizedValue)
    }
  },
  { immediate: true },
)

watch(activeMode, mode => {
  if (mode === 'rich') {
    syncEditorFromMarkdown(internalMarkdown.value)
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="series-rich-text-editor">
    <div class="series-rich-text-editor__topbar">
      <el-button-group>
        <el-button :type="activeMode === 'rich' ? 'primary' : 'default'" @click="activeMode = 'rich'">
          富文本
        </el-button>
        <el-button :type="activeMode === 'source' ? 'primary' : 'default'" @click="activeMode = 'source'">
          源码
        </el-button>
        <el-button :type="activeMode === 'preview' ? 'primary' : 'default'" @click="activeMode = 'preview'">
          预览
        </el-button>
      </el-button-group>

      <el-button plain @click="openFilePicker">导入 Markdown</el-button>
      <input
        ref="fileInput"
        class="series-rich-text-editor__file-input"
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        multiple
        @change="handleFileChange"
      />
    </div>

    <div v-if="activeMode === 'rich'" class="series-rich-text-editor__formatbar">
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('bold') }]"
        :disabled="!editor"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        粗体
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('italic') }]"
        :disabled="!editor"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        斜体
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('bulletList') }]"
        :disabled="!editor"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        列表
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('blockquote') }]"
        :disabled="!editor"
        @click="editor?.chain().focus().toggleBlockquote().run()"
      >
        引用
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('link') }]"
        :disabled="!editor"
        @click="promptForLink"
      >
        超链接
      </button>
      <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="promptForImage">
        插入图片
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'left' }) }]"
        :disabled="!editor"
        @click="editor?.chain().focus().setTextAlign('left').run()"
      >
        居左
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'center' }) }]"
        :disabled="!editor"
        @click="editor?.chain().focus().setTextAlign('center').run()"
      >
        居中
      </button>
      <button
        type="button"
        :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'right' }) }]"
        :disabled="!editor"
        @click="editor?.chain().focus().setTextAlign('right').run()"
      >
        居右
      </button>
      <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="insertHardBreak">
        换行
      </button>
    </div>

    <div v-if="importedDocuments.length" class="series-rich-text-editor__imports">
      <button
        v-for="document in importedDocuments"
        :key="document.id"
        type="button"
        :class="['series-rich-text-editor__tab', { 'is-active': activeImportedDocumentId === document.id }]"
        @click="activeImportedDocumentId = document.id"
      >
        <span class="series-rich-text-editor__tab-icon">
          <el-icon><DocumentAdd /></el-icon>
        </span>
        <span class="series-rich-text-editor__tab-name">{{ document.name }}</span>
      </button>
    </div>

    <section v-if="activeImportedDocument" class="series-rich-text-editor__import-panel">
      <div class="series-rich-text-editor__import-head">
        <div class="series-rich-text-editor__import-meta">
          <div class="series-rich-text-editor__import-name">{{ activeImportedDocument.name }}</div>
          <div class="series-rich-text-editor__import-size">{{ formatFileSize(activeImportedDocument.size) }}</div>
        </div>

        <div class="series-rich-text-editor__import-actions">
          <el-button-group>
            <el-button
              :type="importedDocMode === 'source' ? 'primary' : 'default'"
              @click="importedDocMode = 'source'"
            >
              源码
            </el-button>
            <el-button
              :type="importedDocMode === 'preview' ? 'primary' : 'default'"
              @click="importedDocMode = 'preview'"
            >
              预览
            </el-button>
          </el-button-group>
          <el-button plain @click="removeImportedDocument(activeImportedDocument.id)">移除</el-button>
          <el-button type="primary" @click="applyImportedDocument(activeImportedDocument)">载入到正文</el-button>
        </div>
      </div>

      <section
        v-show="importedDocMode === 'source'"
        class="series-rich-text-editor__surface series-rich-text-editor__surface--compact series-rich-text-editor__surface--readonly"
      >
        <pre class="series-rich-text-editor__source">{{ activeImportedDocument.content }}</pre>
      </section>

      <article
        v-show="importedDocMode === 'preview'"
        class="series-rich-text-editor__surface series-rich-text-editor__surface--compact series-rich-text-editor__preview"
      >
        <div
          v-if="importedPreviewHtml"
          class="series-rich-text-editor__preview-copy"
          v-html="importedPreviewHtml"
        />
        <div v-else class="series-rich-text-editor__empty">这个 Markdown 文件没有可预览的内容。</div>
      </article>
    </section>

    <section v-show="activeMode === 'rich'" class="series-rich-text-editor__surface">
      <EditorContent :editor="editor" />
    </section>

    <section v-show="activeMode === 'source'" class="series-rich-text-editor__surface">
      <el-input
        :model-value="internalMarkdown"
        type="textarea"
        resize="none"
        :rows="24"
        placeholder="在这里直接编辑 Markdown 源码。"
        @update:model-value="value => emitMarkdown(typeof value === 'string' ? value : '')"
      />
    </section>

    <article v-show="activeMode === 'preview'" class="series-rich-text-editor__surface series-rich-text-editor__preview">
      <div
        v-if="currentPreviewHtml"
        class="series-rich-text-editor__preview-copy"
        v-html="currentPreviewHtml"
      />
      <div v-else class="series-rich-text-editor__empty">当前正文为空，预览区暂时没有内容。</div>
    </article>
  </div>
</template>

<style scoped>
.series-rich-text-editor {
  display: grid;
  gap: 14px;
}

.series-rich-text-editor__topbar,
.series-rich-text-editor__formatbar,
.series-rich-text-editor__imports,
.series-rich-text-editor__import-head,
.series-rich-text-editor__import-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.series-rich-text-editor__topbar,
.series-rich-text-editor__import-head {
  justify-content: space-between;
}

.series-rich-text-editor__formatbar {
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.series-rich-text-editor__tool,
.series-rich-text-editor__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 90%, white 10%);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.series-rich-text-editor__tool:hover,
.series-rich-text-editor__tab:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border-soft));
}

.series-rich-text-editor__tool.is-active,
.series-rich-text-editor__tab.is-active {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.66)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
  color: var(--text-primary);
}

.series-rich-text-editor__tool:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}

.series-rich-text-editor__tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 78%, white 22%);
  color: var(--accent);
  flex: none;
}

.series-rich-text-editor__tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-rich-text-editor__import-panel {
  display: grid;
  gap: 12px;
}

.series-rich-text-editor__import-meta {
  display: grid;
  gap: 4px;
}

.series-rich-text-editor__import-name {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.series-rich-text-editor__import-size,
.series-rich-text-editor__empty {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.series-rich-text-editor__file-input {
  display: none;
}

.series-rich-text-editor__surface {
  min-height: 32rem;
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: 1.5rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.4), transparent 42%),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
  box-shadow: var(--shadow-sm);
}

.series-rich-text-editor__surface--compact {
  min-height: 14rem;
}

.series-rich-text-editor__surface :deep(.el-textarea__inner) {
  min-height: 32rem !important;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.8;
}

.series-rich-text-editor__surface :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}

.series-rich-text-editor__surface :deep(.tiptap) {
  min-height: 30rem;
  outline: none;
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.85;
}

.series-rich-text-editor__surface :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-muted);
  pointer-events: none;
  height: 0;
}

.series-rich-text-editor__surface :deep(.tiptap h1),
.series-rich-text-editor__surface :deep(.tiptap h2),
.series-rich-text-editor__surface :deep(.tiptap h3),
.series-rich-text-editor__preview-copy :deep(h1),
.series-rich-text-editor__preview-copy :deep(h2),
.series-rich-text-editor__preview-copy :deep(h3) {
  margin: 0 0 0.85em;
  font-family: var(--font-display);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.series-rich-text-editor__surface :deep(.tiptap p),
.series-rich-text-editor__preview-copy :deep(p),
.series-rich-text-editor__preview-copy :deep(li) {
  margin: 0 0 1em;
}

.series-rich-text-editor__surface :deep(.tiptap ul),
.series-rich-text-editor__surface :deep(.tiptap ol),
.series-rich-text-editor__preview-copy :deep(ul),
.series-rich-text-editor__preview-copy :deep(ol) {
  padding-left: 1.4rem;
}

.series-rich-text-editor__surface :deep(.tiptap blockquote),
.series-rich-text-editor__preview-copy :deep(blockquote) {
  margin: 0 0 1em;
  padding-left: 1rem;
  border-left: 3px solid color-mix(in srgb, var(--accent) 36%, transparent);
  color: var(--text-secondary);
}

.series-rich-text-editor__surface :deep(.tiptap img),
.series-rich-text-editor__preview-copy :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 1rem;
}

.series-rich-text-editor__surface :deep(.tiptap a),
.series-rich-text-editor__preview-copy :deep(a) {
  color: var(--accent);
}

.series-rich-text-editor__preview-copy {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.8;
}

.series-rich-text-editor__surface--readonly {
  overflow: auto;
}

.series-rich-text-editor__source {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 720px) {
  .series-rich-text-editor__topbar,
  .series-rich-text-editor__import-head,
  .series-rich-text-editor__import-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .series-rich-text-editor__topbar :deep(.el-button),
  .series-rich-text-editor__import-actions :deep(.el-button),
  .series-rich-text-editor__import-actions :deep(.el-button-group) {
    width: 100%;
  }

  .series-rich-text-editor__tool,
  .series-rich-text-editor__tab {
    width: 100%;
    justify-content: center;
  }
}
</style>
