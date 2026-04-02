<script setup lang="ts" name="Check">
    import { onMounted, ref, computed, watch } from "vue"
    import { useDark } from '@vueuse/core'
    import { Edit, RefreshRight, Upload } from '@element-plus/icons-vue'
    import { Codemirror } from 'vue-codemirror'
    import { html as codemirror_html } from '@codemirror/lang-html'
    import { markdown as codemirror_md } from '@codemirror/lang-markdown'
    import { oneDark } from '@codemirror/theme-one-dark'
    import { marked } from 'marked'
    import bbobHTML from '@bbob/html'
    import presetHTML5 from '@bbob/preset-html5'
    import { useRouter } from 'vue-router'

    const props = defineProps<{id: number}>()
    const router = useRouter()

    const slbHeight = ref('')
    const clientHeight = ref(0)
    function setHeight() {
        clientHeight.value =  document.documentElement.clientHeight;
        slbHeight.value = clientHeight.value - 137 + 'px';
    }
    function setscrollbar() {
        setHeight()
        window.onresize = setHeight
    }

    const isDark = useDark()
    let extensions_html
    let extensions_md
    let extensions_bbcode
    function changeTheme() {
        if (isDark.value) {
            extensions_html = [codemirror_html(), oneDark]
            extensions_md = [codemirror_md(), oneDark]
            extensions_bbcode = [oneDark]
        }
        else {
            extensions_html = [codemirror_html()]
            extensions_md = [codemirror_md()]
            extensions_bbcode = []
        }
    }
    watch(isDark, changeTheme)

    const empty = '<div style="height: 200px; align-items: center; display: flex; font-size: xx-large; justify-content: center;"><div>无内容</div></div>';
    const html = ref('')
    const md = ref('')
    const bbcode = ref('')
    const title = ref('')
    const html_rendered = computed(() => {
        if (html.value == '') return empty
        else return html.value
    })
    const md_rendered = computed(() => {
        if (md.value == '') return empty
        else return marked.parse(md.value, { async: false })
    })
    const bbcode_rendered = computed(() => {
        if (bbcode.value == '') return empty
        let value = bbcode.value.replace(/\n/g, '<br/>')
        return bbobHTML(value, presetHTML5())
    })
    const fileType = ref('html')
    const isRender = ref('true')
    const type = computed<number>(()=>{
        if (fileType.value == 'html' && isRender.value == 'true') return 1
        if (fileType.value == 'html' && isRender.value == 'false') return 2
        if (fileType.value == 'md' && isRender.value == 'true') return 3
        if (fileType.value == 'md' && isRender.value == 'false') return 4
        if (fileType.value == 'bbcode' && isRender.value == 'true') return 5
        if (fileType.value == 'bbcode' && isRender.value == 'false') return 6
        return 0
    })

    async function loadData() {
        let msg: Message.Task.TaskID = { id: props.id }
        const result = JSON.parse(await window.taskAPI.getContent(JSON.stringify(msg)))
        html.value = result.html
        md.value = result.md
        bbcode.value = result.bbcode
        title.value = result.title
    }

    async function saveContent() {
        let content: string
        if (fileType.value == 'html') content = html.value
        else if (fileType.value == 'md') content = md.value
        else content = bbcode.value
        let msg: Message.Task.ModifiedContent = {
            id: props.id,
            type: fileType.value,
            content
        }
        window.taskAPI.saveContent(JSON.stringify(msg))
    }

    async function saveTitle() {
        let msg: Message.Task.ModifiedTitle = {
            id: props.id,
            title: title.value
        }
        window.taskAPI.saveTitle(JSON.stringify(msg))
    }

    async function exportContent() {
        let msg: Message.Task.ContentType = {
            id: props.id,
            type: fileType.value
        }
        window.taskAPI.exportContent(JSON.stringify(msg))
    }

    function back() {
        router.push({
            name: 'edit',
            params: {id: props.id}
        })
    }
    function next() {
        router.push({
            name: 'bt_publish',
            params: {id: props.id}
        })
    }

    onMounted(() => {
        setscrollbar()
        changeTheme()
        let message: Message.Task.TaskStatus = { id: props.id, step: 'check' }
        window.taskAPI.setTaskProcess(JSON.stringify(message))
        loadData()
    })

</script>

<template>
    <div class="review-check" :style="{height: slbHeight}">
        <el-scrollbar class="review-check__scroll">
            <section class="surface-hero review-check__hero">
                <div class="review-check__copy">
                    <div class="eyebrow-text">内容复核</div>
                    <h3 class="review-check__title">在进入种子发布前，统一检查标题、源码和渲染结果。</h3>
                    <p class="review-check__description">
                        可以在这里切换 `HTML / Markdown / BBCode`，并在预览和源码之间快速来回确认。
                    </p>
                </div>
                <div class="review-check__hero-actions">
                    <el-button plain @click="back">上一步</el-button>
                    <el-button type="primary" @click="next">下一步</el-button>
                </div>
            </section>

            <section class="surface-panel review-check__toolbar">
                <div class="review-check__modes">
                    <el-radio-group v-model="fileType">
                        <el-radio-button label="Html" value="html" />
                        <el-radio-button label="Markdown" value="md" />
                        <el-radio-button label="BBCode" value="bbcode" />
                    </el-radio-group>
                    <el-radio-group v-model="isRender">
                        <el-radio-button label="预览" value="true" />
                        <el-radio-button label="源码" value="false" />
                    </el-radio-group>
                </div>

                <el-button-group>
                    <el-tooltip content="保存" placement="top">
                        <el-button @click="saveContent()" type="primary" :icon="Edit" plain />
                    </el-tooltip>
                    <el-tooltip content="重新加载" placement="top">
                        <el-button @click="loadData()" type="primary" :icon="RefreshRight" plain />
                    </el-tooltip>
                    <el-tooltip content="导出" placement="top">
                        <el-button @click="exportContent()" type="primary" :icon="Upload" plain />
                    </el-tooltip>
                </el-button-group>
            </section>

            <section class="surface-panel review-check__title-panel">
                <div class="review-check__field-label">发布标题</div>
                <el-input v-model="title" maxlength="128" show-word-limit @blur="saveTitle"/>
            </section>

            <section class="surface-panel review-check__viewer">
                <div v-if="type == 1" class="review-check__rendered">
                    <div v-html="html_rendered"></div>
                </div>
                <div v-else-if="type == 2" class="review-check__editor">
                    <codemirror v-model="html" :style="{ minHeight: '400px' }" placeholder="未找到html文件" :extensions="extensions_html" />
                </div>
                <div v-else-if="type == 3" class="review-check__rendered">
                    <div v-html="md_rendered"></div>
                </div>
                <div v-else-if="type == 4" class="review-check__editor">
                    <codemirror v-model="md" :style="{ minHeight: '400px' }" placeholder="未找到md文件" :extensions="extensions_md" />
                </div>
                <div v-else-if="type == 5" class="review-check__rendered">
                    <div v-html="bbcode_rendered"></div>
                </div>
                <div v-else class="review-check__editor">
                    <codemirror v-model="bbcode" :style="{ minHeight: '400px' }" placeholder="未找到bbcode文件" :extensions="extensions_bbcode" />
                </div>
            </section>

            <footer class="review-check__footer">
                <el-button class="review-check__footer-button" @click="back" type="primary" plain>
                    上一步
                </el-button>
                <el-button class="review-check__footer-button" @click="next" type="primary">
                    下一步
                </el-button>
            </footer>
        </el-scrollbar>
    </div>
</template>

<style scoped>
.review-check {
  min-height: 0;
}

.review-check__scroll {
  height: 100%;
}

.review-check :deep(.el-scrollbar__view) {
  display: grid;
  gap: 20px;
}

.review-check__hero,
.review-check__toolbar,
.review-check__title-panel,
.review-check__viewer,
.review-check__footer {
  width: min(100%, 1160px);
  margin: 0 auto;
}

.review-check__hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
}

.review-check__copy {
  max-width: 760px;
}

.review-check__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.1rem, 1.8vw, 1.45rem);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.review-check__description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.review-check__hero-actions,
.review-check__modes,
.review-check__toolbar,
.review-check__footer {
  display: flex;
  gap: 12px;
}

.review-check__hero-actions {
  align-items: flex-end;
}

.review-check__toolbar {
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}

.review-check__modes {
  flex-wrap: wrap;
}

.review-check__title-panel {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
}

.review-check__field-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.review-check__viewer {
  padding: 14px 16px;
}

.review-check__rendered {
  min-height: 420px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 1.4rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent 100%),
    color-mix(in srgb, var(--bg-panel) 94%, white 6%);
  overflow: auto;
}

.review-check__editor :deep(.cm-editor) {
  border: 1px solid var(--border-soft);
  border-radius: 1.4rem;
  overflow: hidden;
  box-shadow: 0 14px 30px rgba(39, 26, 13, 0.06);
}

.review-check__editor :deep(.cm-scroller) {
  min-height: 420px;
  font-family: var(--font-sans);
}

.review-check__footer {
  justify-content: center;
  padding-bottom: 6px;
}

.review-check__footer-button {
  width: 160px;
}

@media (max-width: 960px) {
  .review-check__hero,
  .review-check__toolbar,
  .review-check__footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
