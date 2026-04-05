<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { marked } from 'marked'
import PageShell from '../../components/layout/PageShell.vue'

interface GuideHeading {
  id: string
  level: number
  text: string
}

type GuideSource = 'github' | 'none'

const GITHUB_OWNER = 'zzzwannasleep'
const GITHUB_REPO = 'EasyPublish-Lin.Ver'
const GITHUB_BRANCH = 'main'
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`
const GITHUB_BLOB_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}`
const GITHUB_README_URL = `${GITHUB_RAW_BASE}/README.md`
const README_REFRESH_INTERVAL_MS = 30000

const isLoading = ref(true)
const errorMessage = ref('')
const readmeContent = ref('')
const readmeLocation = ref('')
const readmeUpdatedAt = ref('')
const guideSource = ref<GuideSource>('none')

let refreshTimer: number | null = null
let isRefreshing = false

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
}

function normalizeRepoRelativePath(input: string) {
  const matched = input.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/)
  const pathname = matched?.[1] ?? input
  const search = matched?.[2] ?? ''
  const hash = matched?.[3] ?? ''
  const segments: string[] = []

  pathname
    .split('/')
    .filter(Boolean)
    .forEach((segment) => {
      if (segment === '.') {
        return
      }
      if (segment === '..') {
        segments.pop()
        return
      }
      segments.push(segment)
    })

  return {
    pathname: segments.map((segment) => encodeURIComponent(segment)).join('/'),
    search,
    hash,
  }
}

function buildRepoBlobUrl(path: string) {
  const normalized = normalizeRepoRelativePath(path)
  return `${GITHUB_BLOB_BASE}/${normalized.pathname}${normalized.search}${normalized.hash}`
}

function buildRepoRawUrl(path: string) {
  const normalized = normalizeRepoRelativePath(path)
  return `${GITHUB_RAW_BASE}/${normalized.pathname}${normalized.search}${normalized.hash}`
}

function buildGuideDocument(markdown: string) {
  const headings: GuideHeading[] = []
  let headingIndex = 0

  const html = ((marked.parse(markdown, { async: false }) as string) || '')
    .replace(/<h([1-6])>(.*?)<\/h\1>/g, (fullMatch, levelValue, content) => {
      const level = Number(levelValue)
      const text = stripHtmlTags(content)
      if (!text) {
        return fullMatch
      }

      headingIndex += 1
      const id = `guide-heading-${headingIndex}`
      if (level <= 3) {
        headings.push({ id, level, text })
      }

      return `<h${level} id="${id}">${content}</h${level}>`
    })
    .replace(/<a href="([^"]+)">/g, (fullMatch, href) => {
      if (href.startsWith('#')) {
        return fullMatch
      }

      if (/^(https?:|mailto:)/i.test(href)) {
        return `<a href="${href}" target="_blank" rel="noreferrer">`
      }

      return `<a href="${buildRepoBlobUrl(href)}" target="_blank" rel="noreferrer">`
    })
    .replace(/<img([^>]*?)src="([^"]+)"([^>]*?)>/g, (_fullMatch, before, src, after) => {
      const resolvedSrc = /^(https?:|data:)/i.test(src) ? src : buildRepoRawUrl(src)
      return `<img${before}src="${resolvedSrc}"${after} loading="lazy">`
    })

  return { html, headings }
}

const guideDocument = computed(() => buildGuideDocument(readmeContent.value))
const guideHtml = computed(() => guideDocument.value.html)
const guideHeadings = computed(() => guideDocument.value.headings)
const primarySectionCount = computed(
  () => guideHeadings.value.filter((heading) => heading.level === 2).length
)
const sourceLabel = computed(() => {
  if (guideSource.value === 'github') {
    return 'GitHub 远端'
  }
  return '未加载'
})
const lastUpdatedLabel = computed(() => {
  if (!readmeUpdatedAt.value) {
    return '等待读取'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(readmeUpdatedAt.value))
})

async function fetchGithubReadme() {
  const response = await fetch(GITHUB_README_URL, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`GitHub README 拉取失败：HTTP ${response.status}`)
  }

  return {
    source: 'github' as const,
    location: GITHUB_README_URL,
    content: await response.text(),
    updatedAt: response.headers.get('last-modified') || new Date().toISOString(),
  }
}

async function loadReadme(force = false) {
  if (isRefreshing) {
    return
  }

  isRefreshing = true

  try {
    let nextReadme: {
      source: GuideSource
      location: string
      content: string
      updatedAt: string
    } = await fetchGithubReadme()

    const hasChanged =
      force ||
      nextReadme.location !== readmeLocation.value ||
      nextReadme.updatedAt !== readmeUpdatedAt.value ||
      nextReadme.content !== readmeContent.value ||
      nextReadme.source !== guideSource.value

    if (hasChanged) {
      readmeLocation.value = nextReadme.location
      readmeUpdatedAt.value = nextReadme.updatedAt
      readmeContent.value = nextReadme.content
      guideSource.value = nextReadme.source
    }

    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = (error as Error).message
    guideSource.value = 'none'
    if (force) {
      readmeLocation.value = ''
      readmeUpdatedAt.value = ''
      readmeContent.value = ''
    }
  } finally {
    isLoading.value = false
    isRefreshing = false
  }
}

function startReadmeRefreshLoop() {
  refreshTimer = window.setInterval(() => {
    void loadReadme()
  }, README_REFRESH_INTERVAL_MS)
}

function stopReadmeRefreshLoop() {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function scrollToHeading(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function handleWindowFocus() {
  void loadReadme(true)
}

onMounted(() => {
  void loadReadme(true)
  startReadmeRefreshLoop()
  window.addEventListener('focus', handleWindowFocus)
})

onBeforeUnmount(() => {
  stopReadmeRefreshLoop()
  window.removeEventListener('focus', handleWindowFocus)
})
</script>

<template>
  <PageShell>
    <div class="guide-page">
      <section class="guide-hero surface-panel">
        <div class="guide-hero__content">
          <div class="eyebrow-text">使用说明</div>
          <h1 class="guide-hero__title">GitHub README 说明页</h1>
          <p class="guide-hero__summary">
            页面优先直接读取 GitHub 上的 <code>README.md</code>，因此普通使用者就算本地没有文档，也能看到你已经推送到仓库的最新说明内容。
          </p>
        </div>

        <div class="guide-hero__meta">
          <span class="guide-chip">{{ sourceLabel }}</span>
          <span class="guide-chip">自动同步 30s</span>
          <span class="guide-chip">{{ primarySectionCount }} 个主章节</span>
          <span class="guide-chip">最近同步 {{ lastUpdatedLabel }}</span>
        </div>

        <div v-if="readmeLocation" class="guide-source-path">{{ readmeLocation }}</div>
      </section>

      <section class="guide-layout">
        <aside class="guide-nav surface-panel">
          <div class="eyebrow-text">目录</div>
          <div class="guide-nav__hint">
            README 里的外部链接和仓库内相对链接都会直接跳到 GitHub 对应页面，普通使用者不需要依赖任何本地文档。
          </div>

          <div v-if="guideHeadings.length" class="guide-nav__list">
            <button
              v-for="heading in guideHeadings"
              :key="heading.id"
              :class="[
                'guide-nav__button',
                heading.level >= 3 ? 'guide-nav__button--nested' : ''
              ]"
              type="button"
              @click="scrollToHeading(heading.id)"
            >
              {{ heading.text }}
            </button>
          </div>

          <div v-else class="guide-empty">
            {{ isLoading ? '正在读取 README 目录…' : 'README 还没有可导航的章节。' }}
          </div>
        </aside>

        <article class="guide-doc surface-panel">
          <div class="guide-doc__source">
            <div class="eyebrow-text">README.md</div>
            <p class="guide-doc__hint">
              当前页面只读取 GitHub 远端文档，所以这里展示的就是你已经推送到仓库的 README 内容。
            </p>
          </div>

          <div
            v-if="errorMessage && !readmeContent"
            class="guide-state surface-subtle text-center text-sm leading-6 text-danger"
          >
            {{ errorMessage }}
          </div>

          <div
            v-else-if="isLoading && !readmeContent"
            class="guide-state surface-subtle text-center text-sm leading-6 text-copy-secondary"
          >
            正在读取 README.md...
          </div>

          <div
            v-else-if="!readmeContent"
            class="guide-state surface-subtle text-center text-sm leading-6 text-copy-secondary"
          >
            README.md 当前没有可显示内容。
          </div>

          <div v-else>
            <div
              v-if="errorMessage"
              class="guide-inline-notice surface-subtle text-sm leading-6 text-warning"
            >
              {{ errorMessage }}
            </div>
            <div class="guide-doc__markdown" v-html="guideHtml"></div>
          </div>
        </article>
      </section>
    </div>
  </PageShell>
</template>

<style scoped>
.guide-page {
  display: grid;
  gap: 18px;
}

.guide-hero,
.guide-nav,
.guide-doc {
  padding: 22px;
}

.guide-hero {
  display: grid;
  gap: 16px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--brand-soft) 82%, white 18%), transparent 34%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--accent-soft) 76%, white 24%), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 42%),
    var(--bg-panel);
}

.guide-hero__content {
  display: grid;
  gap: 10px;
}

.guide-hero__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.8rem, 3.2vw, 2.7rem);
  line-height: 1.02;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.guide-hero__summary,
.guide-nav__hint,
.guide-doc__hint,
.guide-source-path,
.guide-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.8;
}

.guide-source-path {
  overflow-wrap: anywhere;
  border-top: 1px solid var(--border-soft);
  padding-top: 12px;
  font-family:
    'SFMono-Regular',
    Consolas,
    'Liberation Mono',
    Menlo,
    monospace;
}

.guide-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.guide-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 88%, white 12%);
  padding: 0.45rem 0.9rem;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.guide-layout {
  display: grid;
  gap: 18px;
}

.guide-nav {
  display: grid;
  gap: 14px;
  align-content: start;
}

.guide-nav__list {
  display: grid;
  gap: 8px;
}

.guide-nav__button {
  width: 100%;
  border: 1px solid var(--border-soft);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--bg-panel) 92%, white 8%);
  padding: 0.8rem 0.95rem;
  text-align: left;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.55;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease;
}

.guide-nav__button:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--brand-soft) 76%, white 24%), rgba(255, 255, 255, 0.64)),
    color-mix(in srgb, var(--bg-panel) 92%, white 8%);
}

.guide-nav__button--nested {
  padding-left: 1.35rem;
  color: var(--text-secondary);
}

.guide-doc {
  display: grid;
  gap: 18px;
}

.guide-doc__source {
  display: grid;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 16px;
}

.guide-state {
  display: flex;
  min-height: 12rem;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.guide-inline-notice {
  margin-bottom: 1rem;
  border-radius: 1rem;
  padding: 0.9rem 1rem;
}

.guide-doc__markdown {
  min-width: 0;
}

.guide-doc__markdown :deep(*) {
  max-width: 100%;
}

.guide-doc__markdown :deep(h1),
.guide-doc__markdown :deep(h2),
.guide-doc__markdown :deep(h3) {
  scroll-margin-top: 1.5rem;
  margin: 0;
  font-family: var(--font-display);
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.guide-doc__markdown :deep(h1) {
  font-size: clamp(1.6rem, 2.8vw, 2.3rem);
}

.guide-doc__markdown :deep(h2) {
  margin-top: 1.75rem;
  font-size: 1.35rem;
}

.guide-doc__markdown :deep(h3) {
  margin-top: 1.25rem;
  font-size: 1.08rem;
}

.guide-doc__markdown :deep(p),
.guide-doc__markdown :deep(li),
.guide-doc__markdown :deep(blockquote) {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.85;
}

.guide-doc__markdown :deep(p),
.guide-doc__markdown :deep(ul),
.guide-doc__markdown :deep(ol),
.guide-doc__markdown :deep(pre),
.guide-doc__markdown :deep(blockquote) {
  margin-top: 0.9rem;
  margin-bottom: 0;
}

.guide-doc__markdown :deep(ul),
.guide-doc__markdown :deep(ol) {
  padding-left: 1.25rem;
}

.guide-doc__markdown :deep(li + li) {
  margin-top: 0.35rem;
}

.guide-doc__markdown :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  text-underline-offset: 0.18em;
}

.guide-doc__markdown :deep(img) {
  display: block;
  margin-top: 1rem;
  border-radius: 1rem;
  box-shadow: var(--shadow-sm);
}

.guide-doc__markdown :deep(code) {
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--surface-code-fill) 92%, white 8%);
  padding: 0.1rem 0.45rem;
  color: var(--text-primary);
  font-size: 0.92em;
  font-family:
    'SFMono-Regular',
    Consolas,
    'Liberation Mono',
    Menlo,
    monospace;
}

.guide-doc__markdown :deep(pre) {
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: 1.2rem;
  background: var(--surface-code-fill);
  padding: 1rem 1.05rem;
}

.guide-doc__markdown :deep(pre code) {
  display: block;
  background: transparent;
  padding: 0;
}

.guide-doc__markdown :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, var(--accent) 30%, var(--border-soft));
  border-radius: 0 1rem 1rem 0;
  background: color-mix(in srgb, var(--bg-panel) 94%, white 6%);
  padding: 0.85rem 1rem;
}

.guide-doc__markdown :deep(table) {
  display: block;
  overflow: auto;
  margin-top: 1rem;
  border-collapse: collapse;
}

.guide-doc__markdown :deep(th),
.guide-doc__markdown :deep(td) {
  border: 1px solid var(--border-soft);
  padding: 0.75rem 0.9rem;
  text-align: left;
  white-space: nowrap;
}

@media (min-width: 1280px) {
  .guide-layout {
    grid-template-columns: minmax(16rem, 18rem) minmax(0, 1fr);
    align-items: start;
  }

  .guide-nav {
    position: sticky;
    top: 0.5rem;
  }
}

@media (max-width: 720px) {
  .guide-hero,
  .guide-nav,
  .guide-doc {
    padding: 18px;
  }
}
</style>
