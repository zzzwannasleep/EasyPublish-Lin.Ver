<script setup lang="ts" name="ForumPublish">
    import { onMounted, ref, watch } from "vue"
    import { useDark } from '@vueuse/core'
    import { useRouter } from 'vue-router'
    import { Codemirror } from 'vue-codemirror'
    import { html } from '@codemirror/lang-html'
    import { oneDark } from '@codemirror/theme-one-dark'
    import { Upload, Search, View, Edit } from '@element-plus/icons-vue'

    const props = defineProps<{id: number}>()
    const router = useRouter()

    //设置滚动条区域高度
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

    //数据
    type Tabledata = {
        id: number
        title: string
        content: string
        raw: string
    }
    const isRS = ref<boolean>(false)
    const rsTitle = ref<string>('')
    const rsID = ref<number>(0)
    const tableData = ref<Tabledata[]>([])
    const publishInfo = ref<string[]>([])
    const content = ref<string>('')
    const title = ref<string>('')
    const imagePath = ref<string>('')
    const category = ref<number[]>([2, 21])
    const credit_name = ref<string>('')
    const credit_link = ref<string>('')
    const mediaInfo = ref<string>('')
    const oldLinks = ref<string>('')
    const oldComment = ref<string>('')
    const options = [
        {
            label: '1080p Full HD',
            value: 2
        },
        {
            label: '作品项目',
            value: 21
        },
        {
            label: '4K UHD',
            value: 3
        },
        {
            label: '720p HD',
            value: 5
        },
        {
            label: '音乐/专题',
            value: 24
        },
    ]

    //编辑器设置
    const isDark = useDark()
    let extensions
    function changeTheme() {
        if (isDark.value)
            extensions = [html(), oneDark]
        else extensions = [html()]
    }
    watch(isDark, changeTheme)

    //添加Credit信息
    function addCredit() {
        if (credit_link.value == '') return
        let credit = `Image Credit: <a href="${credit_link.value}" rel="noopener" target="_blank">${credit_name.value}</a>\n\n<label`
        content.value = content.value.replace('<label', credit)
        ElMessage({
            message: '添加Credit成功',
            type: 'success'
        })
    }
    //添加MediaInfo
    function addMediaInfo() {
        if (mediaInfo.value == '') return
        if (!content.value.includes('请将MediaInfo放置于此')) return
        content.value = content.value.replace('请将MediaInfo放置于此', mediaInfo.value)
        ElMessage({
            message: '添加MediaInfo成功',
            type: 'success'
        })
    }
    //添加旧链
    function addLinks() {
        if (oldLinks.value == '') return
        if (!content.value.includes('请将旧链放于此')) return
        content.value = content.value.replace('请将旧链放于此', oldLinks.value.replace(/(<a[\s\S]*?<\/a>)/g, '<del>$1</del>'))
        ElMessage({
            message: '添加旧链成功',
            type: 'success'
        })
    }
    //添加过往修正
    function addComments() {
        if (oldComment.value == '') return
        let newContent = content.value.replace(/(\[box\sstyle="info"\][\s\S]*?重发修正[\s\S]*?\[\/box\])/, '$1\n\n' + oldComment.value)
        if (content.value === newContent) return
        content.value = newContent
        ElMessage({
            message: '添加过往修正成功',
            type: 'success'
        })
    }

    //整理BT链接
    function generateLinks() {
        let content: string = ''
        for (let i = 0; i < publishInfo.value.length; i++) {
            let link = publishInfo.value[i].split('：')[1]
            if (link != '未找到链接' && link != 'undefined')
                content += `<a href="${link}" rel="noopener" target="_blank">${link}</a>\n\n`
        }
        return content
    }
    //复制BT链接
    function copyLinks() {
        let msg: Message.Global.Clipboard = { str: generateLinks() }
        window.globalAPI.writeClipboard(JSON.stringify(msg))
    }

    //RS搜索文章
    async function searchPosts() {
        let msg: Message.Forum.Title = { title: rsTitle.value}
        const result: Message.Forum.Posts = JSON.parse(await window.forumAPI.searchPosts(JSON.stringify(msg)))
        tableData.value = result.posts
    }

    //RS选择文章
    function handleCurrentChange(val: Tabledata | undefined) {
        if (val) {
            rsID.value = val.id
            let raw = tableData.value.find(item => item.id == rsID.value)!.raw
            let info = raw.match(/<pre[\s\S]*?>[\s]*([\s\S]*?)\s<\/pre>/)
            if (info) {
                mediaInfo.value = info[1]
            }
            let credit = raw.match(/Image\sCredit[\s\S]*?href="([\s\S]*?)"[\s\S]*?>([\s\S]*?)<\/a>/)
            if (credit)
                [,credit_link.value,credit_name.value] = credit
            let links = raw.match(/\[box\sstyle="download"\][\s\S]*?\[\/box\]/g)
            let comments = raw.match(/\[box\sstyle="info"\][\s\S]*?重发修正[\s\S]*?\[\/box\]/g)
            oldComment.value = ''
            oldLinks.value = ''
            if (links) {
                links.forEach((_item, index) => {
                    oldLinks.value += links[index]
                    if (index < links.length - 1)
                        oldLinks.value += '\n\n'
                });
            }
            if (comments) {
                comments.forEach((_item, index) => {
                    oldComment.value += comments[index]
                    if (index < comments.length - 1)
                        oldComment.value += '\n\n'
                });
            }
            ElMessageBox.confirm('是否立即填入？', '提示', {
                confirmButtonText: '填入',
                cancelButtonText: '取消',
                type: 'info',
            }).then(() => {
                addComments()
                addCredit()
                addLinks()
            })
        }
        else {
            rsID.value = 0
        }
    }

    //上传文件
    const isLoading = ref(false)
    async function readFileContent() {
        isLoading.value = true
        const result: Message.Global.FileContent = JSON.parse(await window.globalAPI.readFileContent())
        content.value = result.content
        isLoading.value = false
    }
    //选择发布图
    async function loadImage() {
        isLoading.value = true
        let msg: Message.Global.FileType = { type: 'webp' }
        let { path }: Message.Global.Path = JSON.parse(await window.globalAPI.getFilePath(JSON.stringify(msg)))
        imagePath.value = path
        isLoading.value = false
    }

    //路由跳转
    function back() {
        router.push({
            name: 'bt_publish',
            params: {id: props.id}
        })
    }
    function next() {
        router.push({
            name: 'finish',
            params: {id: props.id}
        })
    }

    //控制对话框显示
    const editContent = ref(false)
    const editMediaInfo = ref(false)
    const editOldLinks = ref(false)
    const editComments = ref(false)

    //提交发布内容
    const isPublishing = ref(false)
    async function submit() {
        let result: string
        isPublishing.value = true
        if (isRS.value) {
            let msg: Message.Forum.RSConfig = {
                id: props.id,
                rsID: rsID.value,
                title: title.value,
                content: content.value
            }
            let message: Message.Task.Result = JSON.parse(await window.forumAPI.rsPublish(JSON.stringify(msg)))
            result = message.result
        }
        else {
            let msg: Message.Forum.PublishConfig = {
                id: props.id,
                categories: JSON.stringify(category.value),
                imagePath: imagePath.value,
                title: title.value,
                content: content.value
            }
            let message: Message.Task.Result = JSON.parse(await window.forumAPI.publish(JSON.stringify(msg)))
            result = message.result
        }
        if (result == 'empty')
            ElMessage.error('标题或内容为空')
        else if (result == 'forbidden') 
            ElMessage.error('防火墙阻止')
        else if (result == 'unauthorized') 
            ElMessage.error('认证失败，请检查账号密码')
        else if (result == 'failed')
            ElMessage.error('发布失败，详见日志')
        else if (result == 'noSuchFile_webp')
            ElMessage.error('未找到图片文件')
        else if (result == 'success') {
            ElMessage({
                message: '发布成功，即将跳转',
                type: 'success',
                plain: true,
            })
            setTimeout(() => {
                router.push({
                    name: 'finish',
                    params: { id: props.id }
                })
            }, 500);
        }
        isPublishing.value = false
    }

    //加载信息
    async function loadData() {
        let msg: Message.Task.TaskID = { id: props.id }
        const result: Message.Forum.Contents = JSON.parse(await window.taskAPI.getForumConfig(JSON.stringify(msg)))
        if (result.title) title.value = result.title
        if (result.content) content.value = result.content
        if (result.imagePath) imagePath.value = result.imagePath
    }
    const loadingBT = ref(true)
    async function loadBT() {
        loadingBT.value = true
        let msg: Message.Task.TaskID = { id: props.id }
        const result: Message.Task.PublishStatus = JSON.parse(await window.BTAPI.getBTLinks(JSON.stringify(msg)))
        publishInfo.value = []
        publishInfo.value.push('Mikan：' + result.mikan)
        publishInfo.value.push('MioBT：' + result.miobt)
        publishInfo.value.push('萌番组：' + result.bangumi)
        publishInfo.value.push('末日动漫：' + result.acgnx_a)
        publishInfo.value.push('Acgnx：' + result.acgnx_g)
        publishInfo.value.push('Acgrip：' + result.acgrip)
        publishInfo.value.push('动漫花园：' + result.dmhy)
        publishInfo.value.push('Nyaa：' + result.nyaa)
        loadingBT.value = false
        if (result.bangumi_all == 'true') {
            content.value = content.value.replace('链接加载中', generateLinks())
            ElMessage({
                message: 'BT链接加载完成',
                type: 'success'
            })
        }
        else
            ElMessage('缺少部分链接')
    }

    //右键复制事件
    function handleRightClick(str: string) {
        let msg: Message.Global.Clipboard = { str }
        window.globalAPI.writeClipboard(JSON.stringify(msg))
        ElMessage('复制成功')
    }

    onMounted(async () => {
        setscrollbar()
        changeTheme()
        await loadData()
        let message: Message.Task.TaskStatus = { id: props.id, step: 'forum_publish' }
        window.taskAPI.setTaskProcess(JSON.stringify(message))
        loadBT()
    })

</script>

<template>
     <div class="forum-publish" :style="{height: slbHeight}">
        <el-scrollbar class="forum-publish__scroll">
            <section class="surface-hero forum-publish__hero">
                <div class="forum-publish__copy">
                    <div class="eyebrow-text">主站帖子</div>
                    <h3 class="forum-publish__title">整理发布稿、BT 链接和 RS 信息，再统一提交到主站。</h3>
                    <p class="forum-publish__description">
                        这里保留旧发布逻辑，但把发帖表单、辅助信息和编辑器整理成更顺手的工作区。
                    </p>
                </div>
                <div class="forum-publish__hero-actions">
                    <el-button plain @click="back">上一步</el-button>
                    <el-button plain @click="next">跳过</el-button>
                    <el-button type="primary" @click="editContent = true">发布</el-button>
                </div>
            </section>

            <section class="forum-publish__grid">
                <section class="surface-panel forum-publish__panel">
                    <el-form class="forum-publish__form" label-width="auto">
                        <el-form-item label="标题">
                            <el-input v-model="title" placeholder="请填写标题"/>
                        </el-form-item>
                        <el-form-item label="RS选项">
                            <el-checkbox v-model="isRS" label="RS覆盖原帖" />
                        </el-form-item>
                        <el-form-item v-show="isRS" label="选择RS文章">
                            <el-input placeholder="输入标题以进行搜索" v-model="rsTitle">
                                <template #append>
                                    <el-button :icon="Search" @click="searchPosts()" />
                                </template>
                            </el-input>
                            <el-table :data="tableData" highlight-current-row @current-change="handleCurrentChange" style="margin-top: 10px;">
                                <el-table-column prop="id" label="ID" width="70" />
                                <el-table-column label="文章标题">
                                    <template #default="scope">
                                        <el-popover
                                            placement="bottom"
                                            title="文章内容"
                                            :width="800"
                                            trigger="hover"
                                            raw-content
                                        >
                                            <template #reference>
                                                {{ scope.row.title }}
                                            </template>
                                            <template #default>
                                                <div v-html="scope.row.content" />
                                            </template>
                                        </el-popover>
                                    </template>
                                </el-table-column>
                            </el-table>
                        </el-form-item>
                        <el-form-item v-if="!isRS" label="主站发布图">
                            <el-input placeholder="选择一张图片，RS项目可留空" v-model="imagePath">
                                <template #append>
                                    <el-button @click="loadImage" v-loading.fullscreen.lock="isLoading">
                                        <el-icon><FolderOpened /></el-icon>
                                    </el-button>
                                </template>
                            </el-input>
                        </el-form-item>
                        <el-form-item v-if="!isRS" label="分类">
                            <el-select-v2 v-model="category" :options="options"
                                multiple placeholder="选择类别" style="width: 250px" />
                        </el-form-item>
                        <el-form-item label="主站发布稿">
                            <div class="forum-publish__inline-actions">
                                <el-button @click="editContent = true" type="primary" link :icon="View">查看和编辑发布稿</el-button>
                                <el-button :icon="Upload" type="primary" @click="readFileContent()" link v-loading.fullscreen.lock="isLoading">
                                    选择一个文件
                                </el-button>
                            </div>
                            <el-dialog v-model="editContent" width="900" title="查看和编辑发布稿">
                                <div v-loading="isPublishing">
                                    <codemirror v-model="content" :style="{ minHeight: '400px' }" placeholder="主站发布稿" :extensions="extensions" />
                                    <div class="forum-publish__dialog-actions">
                                        <el-button size="large" type="primary" @click="submit">确认并继续发布</el-button>
                                    </div>
                                </div>
                            </el-dialog>
                        </el-form-item>
                    </el-form>
                </section>

                <aside class="surface-panel forum-publish__panel forum-publish__panel--aside">
                    <el-collapse>
                        <el-collapse-item title="BT链接">
                            <div v-loading="loadingBT" class="forum-publish__aside-block">
                                <div class="forum-publish__inline-actions">
                                    <el-button link type="primary" @click="loadBT()">刷新<el-icon><Refresh /></el-icon></el-button>
                                    <el-button link type="primary" @click="copyLinks()">复制<el-icon><DocumentCopy /></el-icon></el-button>
                                </div>
                                <div class="forum-publish__link-list">
                                    <p v-for="item in publishInfo" :key="item" class="forum-publish__link-item" @contextmenu.prevent="handleRightClick(item.split('：')[1])">
                                        {{ item }}
                                    </p>
                                </div>
                            </div>
                        </el-collapse-item>
                        <el-collapse-item title="填写模板（仅从模版创建时有效）">
                            <div class="forum-publish__aside-block">
                                <div class="forum-publish__helper-head">
                                    <h3>Credit信息</h3>
                                    <el-button link @click="addCredit()" :icon="Edit" >添加Credit信息</el-button>
                                </div>
                                <div class="forum-publish__helper-grid">
                                    <div>
                                        <div class="forum-publish__helper-label">署名</div>
                                        <el-input v-model="credit_name" />
                                    </div>
                                    <div>
                                        <div class="forum-publish__helper-label">链接</div>
                                        <el-input v-model="credit_link" />
                                    </div>
                                </div>

                                <div class="forum-publish__helper-head">
                                    <h3>MediaInfo</h3>
                                    <div class="forum-publish__inline-actions">
                                        <el-button @click="editMediaInfo = true" type="primary" link :icon="View">查看MediaInfo</el-button>
                                        <el-button link @click="addMediaInfo()" :icon="Edit" >添加MediaInfo</el-button>
                                    </div>
                                </div>
                                <el-dialog v-model="editMediaInfo" width="900" title="查看和编辑MediaInfo">
                                    <codemirror v-model="mediaInfo" :style="{ minHeight: '400px' }" placeholder="请填写MediaInfo" :extensions="extensions" />
                                </el-dialog>

                                <template v-if="isRS">
                                    <div class="forum-publish__helper-head">
                                        <h3>RS旧链</h3>
                                        <div class="forum-publish__inline-actions">
                                            <el-button @click="editOldLinks = true" type="primary" link :icon="View">查看Reseed旧链接</el-button>
                                            <el-button link @click="addLinks()" :icon="Edit" >添加旧链</el-button>
                                        </div>
                                    </div>
                                    <el-dialog v-model="editOldLinks" width="900" title="查看和编辑Reseed旧链接">
                                        <el-input v-model="oldLinks" :autosize="{minRows:10}" type="textarea" placeholder="请填写旧链" />
                                    </el-dialog>

                                    <div class="forum-publish__helper-head">
                                        <h3>过往修正</h3>
                                        <div class="forum-publish__inline-actions">
                                            <el-button @click="editComments = true" type="primary" link :icon="View">查看过往修正</el-button>
                                            <el-button link @click="addComments()" :icon="Edit" >添加过往修正</el-button>
                                        </div>
                                    </div>
                                    <el-dialog v-model="editComments" width="900" title="查看和编辑过往修正">
                                        <el-input v-model="oldComment" :autosize="{minRows:10}" type="textarea" placeholder="填写过往修正" />
                                    </el-dialog>
                                </template>
                            </div>
                        </el-collapse-item>
                    </el-collapse>
                </aside>
            </section>

            <footer class="forum-publish__footer">
                <el-button class="forum-publish__footer-button" @click="back">
                    上一步
                </el-button>
                <el-button class="forum-publish__footer-button" @click="next" type="primary" plain>
                    跳过
                </el-button>
                <el-button class="forum-publish__footer-button" @click="editContent = true" type="primary">
                    发布
                </el-button>
            </footer>
        </el-scrollbar>
    </div>
</template>

<style scoped>
.forum-publish {
  min-height: 0;
}

.forum-publish__scroll {
  height: 100%;
}

.forum-publish :deep(.el-scrollbar__view) {
  display: grid;
  gap: 20px;
}

.forum-publish__hero,
.forum-publish__grid,
.forum-publish__footer {
  width: min(100%, 1160px);
  margin: 0 auto;
}

.forum-publish__hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
}

.forum-publish__copy {
  max-width: 760px;
}

.forum-publish__title {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.1rem, 1.8vw, 1.45rem);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.forum-publish__description {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.forum-publish__hero-actions,
.forum-publish__inline-actions,
.forum-publish__helper-head,
.forum-publish__footer {
  display: flex;
  gap: 12px;
}

.forum-publish__hero-actions {
  align-items: flex-end;
}

.forum-publish__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.85fr);
}

.forum-publish__panel {
  padding: 16px;
}

.forum-publish__panel--aside {
  align-self: start;
}

.forum-publish__form :deep(.el-form-item) {
  align-items: flex-start;
}

.forum-publish__form :deep(.el-form-item__content) {
  min-width: 0;
}

.forum-publish__aside-block {
  display: grid;
  gap: 14px;
}

.forum-publish__link-list {
  display: grid;
  gap: 8px;
}

.forum-publish__link-item {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--bg-panel) 94%, white 6%);
  color: var(--text-secondary);
  line-height: 1.7;
  cursor: pointer;
}

.forum-publish__helper-head {
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 8px;
}

.forum-publish__helper-head:first-child {
  margin-top: 0;
}

.forum-publish__helper-head h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  letter-spacing: -0.04em;
}

.forum-publish__helper-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 160px minmax(0, 1fr);
}

.forum-publish__helper-label {
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.forum-publish__dialog-actions {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.forum-publish__footer {
  justify-content: center;
  padding-bottom: 6px;
}

.forum-publish__footer-button {
  width: 160px;
}

@media (max-width: 1080px) {
  .forum-publish__hero,
  .forum-publish__grid,
  .forum-publish__footer {
    width: 100%;
  }

  .forum-publish__hero,
  .forum-publish__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .forum-publish__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .forum-publish__helper-grid {
    grid-template-columns: 1fr;
  }
}
</style>
