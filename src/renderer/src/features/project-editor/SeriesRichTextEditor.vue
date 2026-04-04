<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentAdd } from '@element-plus/icons-vue'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
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
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
    }),
    Underline,
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
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: null,
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

function setParagraph() {
  editor.value?.chain().focus().setParagraph().run()
}

function setHeading(level: 1 | 2 | 3) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function clearFormatting() {
  editor.value?.chain().focus().unsetAllMarks().clearNodes().run()
}

function insertHorizontalRule() {
  editor.value?.chain().focus().setHorizontalRule().run()
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
      <div class="series-rich-text-editor__mode-switch">
        <button
          type="button"
          :class="['series-rich-text-editor__mode-button', { 'is-active': activeMode === 'rich' }]"
          @click="activeMode = 'rich'"
        >
          <span class="series-rich-text-editor__tool-icon">Aa</span>
          <span class="series-rich-text-editor__tool-label">富文本</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__mode-button', { 'is-active': activeMode === 'source' }]"
          @click="activeMode = 'source'"
        >
          <span class="series-rich-text-editor__tool-icon">MD</span>
          <span class="series-rich-text-editor__tool-label">源码</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__mode-button', { 'is-active': activeMode === 'preview' }]"
          @click="activeMode = 'preview'"
        >
          <span class="series-rich-text-editor__tool-icon">Eye</span>
          <span class="series-rich-text-editor__tool-label">预览</span>
        </button>
      </div>

      <div class="series-rich-text-editor__topbar-actions">
        <button type="button" class="series-rich-text-editor__action-button" @click="openFilePicker">
          <span class="series-rich-text-editor__tool-icon">IN</span>
          <span class="series-rich-text-editor__tool-label">导入 Markdown</span>
        </button>
      </div>

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
      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">结构</span>
        <button
          type="button"
          :class="[
            'series-rich-text-editor__tool',
            {
              'is-active':
                editor?.isActive('paragraph') && !editor?.isActive('blockquote') && !editor?.isActive('codeBlock'),
            },
          ]"
          :disabled="!editor"
          @click="setParagraph"
        >
          <span class="series-rich-text-editor__tool-icon">P</span>
          <span class="series-rich-text-editor__tool-label">正文</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('heading', { level: 1 }) }]"
          :disabled="!editor"
          @click="setHeading(1)"
        >
          <span class="series-rich-text-editor__tool-icon">H1</span>
          <span class="series-rich-text-editor__tool-label">标题 1</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('heading', { level: 2 }) }]"
          :disabled="!editor"
          @click="setHeading(2)"
        >
          <span class="series-rich-text-editor__tool-icon">H2</span>
          <span class="series-rich-text-editor__tool-label">标题 2</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('heading', { level: 3 }) }]"
          :disabled="!editor"
          @click="setHeading(3)"
        >
          <span class="series-rich-text-editor__tool-icon">H3</span>
          <span class="series-rich-text-editor__tool-label">标题 3</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('blockquote') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleBlockquote().run()"
        >
          <span class="series-rich-text-editor__tool-icon">""</span>
          <span class="series-rich-text-editor__tool-label">引用</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('codeBlock') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleCodeBlock().run()"
        >
          <span class="series-rich-text-editor__tool-icon">{ }</span>
          <span class="series-rich-text-editor__tool-label">代码块</span>
        </button>
      </div>

      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">文字</span>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('bold') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleBold().run()"
        >
          <span class="series-rich-text-editor__tool-icon">B</span>
          <span class="series-rich-text-editor__tool-label">粗体</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('italic') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleItalic().run()"
        >
          <span class="series-rich-text-editor__tool-icon">I</span>
          <span class="series-rich-text-editor__tool-label">斜体</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('underline') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleUnderline().run()"
        >
          <span class="series-rich-text-editor__tool-icon">U</span>
          <span class="series-rich-text-editor__tool-label">下划线</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('strike') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleStrike().run()"
        >
          <span class="series-rich-text-editor__tool-icon">S</span>
          <span class="series-rich-text-editor__tool-label">删除线</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('code') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleCode().run()"
        >
          <span class="series-rich-text-editor__tool-icon">&lt;/&gt;</span>
          <span class="series-rich-text-editor__tool-label">行内代码</span>
        </button>
        <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="clearFormatting">
          <span class="series-rich-text-editor__tool-icon">Tx</span>
          <span class="series-rich-text-editor__tool-label">清除格式</span>
        </button>
      </div>

      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">列表</span>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('bulletList') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleBulletList().run()"
        >
          <span class="series-rich-text-editor__tool-icon">[]</span>
          <span class="series-rich-text-editor__tool-label">无序列表</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('orderedList') }]"
          :disabled="!editor"
          @click="editor?.chain().focus().toggleOrderedList().run()"
        >
          <span class="series-rich-text-editor__tool-icon">1.</span>
          <span class="series-rich-text-editor__tool-label">有序列表</span>
        </button>
        <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="insertHorizontalRule">
          <span class="series-rich-text-editor__tool-icon">HR</span>
          <span class="series-rich-text-editor__tool-label">分割线</span>
        </button>
        <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="insertHardBreak">
          <span class="series-rich-text-editor__tool-icon">BR</span>
          <span class="series-rich-text-editor__tool-label">换行</span>
        </button>
      </div>

      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">对齐</span>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'left' }) }]"
          :disabled="!editor"
          @click="editor?.chain().focus().setTextAlign('left').run()"
        >
          <span class="series-rich-text-editor__tool-icon">L</span>
          <span class="series-rich-text-editor__tool-label">居左</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'center' }) }]"
          :disabled="!editor"
          @click="editor?.chain().focus().setTextAlign('center').run()"
        >
          <span class="series-rich-text-editor__tool-icon">C</span>
          <span class="series-rich-text-editor__tool-label">居中</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'right' }) }]"
          :disabled="!editor"
          @click="editor?.chain().focus().setTextAlign('right').run()"
        >
          <span class="series-rich-text-editor__tool-icon">R</span>
          <span class="series-rich-text-editor__tool-label">居右</span>
        </button>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive({ textAlign: 'justify' }) }]"
          :disabled="!editor"
          @click="editor?.chain().focus().setTextAlign('justify').run()"
        >
          <span class="series-rich-text-editor__tool-icon">J</span>
          <span class="series-rich-text-editor__tool-label">两端对齐</span>
        </button>
      </div>

      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">插入</span>
        <button
          type="button"
          :class="['series-rich-text-editor__tool', { 'is-active': editor?.isActive('link') }]"
          :disabled="!editor"
          @click="promptForLink"
        >
          <span class="series-rich-text-editor__tool-icon">URL</span>
          <span class="series-rich-text-editor__tool-label">超链接</span>
        </button>
        <button type="button" class="series-rich-text-editor__tool" :disabled="!editor" @click="promptForImage">
          <span class="series-rich-text-editor__tool-icon">IMG</span>
          <span class="series-rich-text-editor__tool-label">插入图片</span>
        </button>
      </div>

      <div class="series-rich-text-editor__toolgroup">
        <span class="series-rich-text-editor__group-label">操作</span>
        <button
          type="button"
          class="series-rich-text-editor__tool"
          :disabled="!editor || !editor.can().chain().focus().undo().run()"
          @click="editor?.chain().focus().undo().run()"
        >
          <span class="series-rich-text-editor__tool-icon">Z-</span>
          <span class="series-rich-text-editor__tool-label">撤销</span>
        </button>
        <button
          type="button"
          class="series-rich-text-editor__tool"
          :disabled="!editor || !editor.can().chain().focus().redo().run()"
          @click="editor?.chain().focus().redo().run()"
        >
          <span class="series-rich-text-editor__tool-icon">Z+</span>
          <span class="series-rich-text-editor__tool-label">重做</span>
        </button>
      </div>
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
          <button
            type="button"
            :class="['series-rich-text-editor__action-button', { 'is-active': importedDocMode === 'source' }]"
            @click="importedDocMode = 'source'"
          >
            <span class="series-rich-text-editor__tool-icon">MD</span>
            <span class="series-rich-text-editor__tool-label">源码</span>
          </button>
          <button
            type="button"
            :class="['series-rich-text-editor__action-button', { 'is-active': importedDocMode === 'preview' }]"
            @click="importedDocMode = 'preview'"
          >
            <span class="series-rich-text-editor__tool-icon">Eye</span>
            <span class="series-rich-text-editor__tool-label">预览</span>
          </button>
          <button
            type="button"
            class="series-rich-text-editor__action-button"
            @click="removeImportedDocument(activeImportedDocument.id)"
          >
            <span class="series-rich-text-editor__tool-icon">DEL</span>
            <span class="series-rich-text-editor__tool-label">移除</span>
          </button>
          <button
            type="button"
            class="series-rich-text-editor__action-button is-primary"
            @click="applyImportedDocument(activeImportedDocument)"
          >
            <span class="series-rich-text-editor__tool-icon">USE</span>
            <span class="series-rich-text-editor__tool-label">载入到正文</span>
          </button>
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
  min-width: 0;
}

.series-rich-text-editor__topbar,
.series-rich-text-editor__mode-switch,
.series-rich-text-editor__topbar-actions,
.series-rich-text-editor__toolgroup,
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
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 1rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(248, 250, 255, 0.72)),
    color-mix(in srgb, var(--bg-panel) 94%, white 6%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 8px 24px rgba(15, 23, 42, 0.04);
}

.series-rich-text-editor__group-label {
  flex: none;
  margin-right: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.series-rich-text-editor__mode-button,
.series-rich-text-editor__action-button,
.series-rich-text-editor__tool,
.series-rich-text-editor__tab {
  appearance: none;
  border: 0;
  border-radius: 0.9rem;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    transform 160ms ease,
    background 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

.series-rich-text-editor__mode-button,
.series-rich-text-editor__action-button,
.series-rich-text-editor__tool {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 14px;
}

.series-rich-text-editor__tool {
  background: transparent;
}

.series-rich-text-editor__mode-button:hover,
.series-rich-text-editor__action-button:hover,
.series-rich-text-editor__tool:hover,
.series-rich-text-editor__tab:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.96);
  color: var(--text-primary);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06);
}

.series-rich-text-editor__mode-button.is-active,
.series-rich-text-editor__action-button.is-active,
.series-rich-text-editor__action-button.is-primary,
.series-rich-text-editor__tool.is-active,
.series-rich-text-editor__tab.is-active {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 74%, white 26%), rgba(255, 255, 255, 0.78)),
    rgba(255, 255, 255, 0.98);
  color: var(--text-primary);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent),
    0 10px 24px rgba(15, 23, 42, 0.08);
}

.series-rich-text-editor__tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.series-rich-text-editor__tool-icon,
.series-rich-text-editor__tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--accent-soft) 72%, white 28%);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  flex: none;
}

.series-rich-text-editor__tool-label,
.series-rich-text-editor__tab-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.series-rich-text-editor__tab {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  max-width: 100%;
  padding: 0 14px;
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
  padding: 22px 24px;
  border-radius: 1rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(249, 250, 252, 0.94)),
    white;
  box-shadow:
    inset 0 0 0 1px rgba(148, 163, 184, 0.12),
    0 12px 28px rgba(15, 23, 42, 0.04);
}

.series-rich-text-editor__surface--compact {
  min-height: 14rem;
}

.series-rich-text-editor__surface--readonly {
  overflow: auto;
}

.series-rich-text-editor__surface :deep(.el-textarea),
.series-rich-text-editor__surface :deep(.el-textarea__inner) {
  height: 100%;
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

.series-rich-text-editor__surface :deep(.tiptap pre),
.series-rich-text-editor__preview-copy :deep(pre) {
  margin: 0 0 1em;
  padding: 14px 16px;
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--accent-soft) 22%, #0f172a 78%);
  color: #e2e8f0;
  overflow: auto;
}

.series-rich-text-editor__surface :deep(.tiptap code),
.series-rich-text-editor__preview-copy :deep(code) {
  padding: 0.12rem 0.35rem;
  border-radius: 0.4rem;
  background: rgba(15, 23, 42, 0.08);
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.series-rich-text-editor__surface :deep(.tiptap pre code),
.series-rich-text-editor__preview-copy :deep(pre code) {
  padding: 0;
  background: transparent;
}

.series-rich-text-editor__surface :deep(.tiptap hr),
.series-rich-text-editor__preview-copy :deep(hr) {
  margin: 1.4rem 0;
  border: 0;
  border-top: 1px dashed color-mix(in srgb, var(--border-soft) 88%, var(--accent) 12%);
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

.series-rich-text-editor__surface :deep(.tiptap table),
.series-rich-text-editor__preview-copy :deep(table) {
  width: 100%;
  margin: 0 0 1rem;
  border-collapse: collapse;
}

.series-rich-text-editor__surface :deep(.tiptap th),
.series-rich-text-editor__surface :deep(.tiptap td),
.series-rich-text-editor__preview-copy :deep(th),
.series-rich-text-editor__preview-copy :deep(td) {
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  text-align: left;
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

  .series-rich-text-editor__mode-button,
  .series-rich-text-editor__action-button,
  .series-rich-text-editor__tool,
  .series-rich-text-editor__tab {
    width: 100%;
    justify-content: center;
  }

  .series-rich-text-editor__surface {
    padding: 18px;
  }
}
</style>
