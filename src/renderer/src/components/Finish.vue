<script setup lang="ts" name="Finish">
    import { computed, onMounted, ref } from "vue"
    import { useRouter } from 'vue-router'
    import { projectBridge } from '../services/bridge/project'
    import { getProjectCompletionBackRouteName } from '../services/project/presentation'
    import type { PublishProject } from '../types/project'

    const props = defineProps<{id: number}>()
    const router = useRouter()

    const src = ref('')
    const project = ref<PublishProject | null>(null)
    const backRouteName = computed(() => project.value ? getProjectCompletionBackRouteName(project.value) : 'forum_publish')

    function back() {
        router.push({
            name: backRouteName.value,
            params: {id: props.id}
        })
    }

    async function loadData() {
        let msg: Message.Task.TaskID = { id: props.id }
        const projectResult = await projectBridge.getProject(props.id)
        if (projectResult.ok) {
            project.value = projectResult.data.project
        }
        let forumLink: Message.Task.ForumLink = JSON.parse(await window.taskAPI.getForumLink(JSON.stringify(msg)))
        if (forumLink.link) src.value = forumLink.link
    }

    onMounted(() => {
        let message: Message.Task.TaskStatus = { id: props.id, step: 'finish' }
        window.taskAPI.setTaskProcess(JSON.stringify(message))
        loadData()
    })

</script>

<template>
    <el-row style="height: 30px;" />
    <el-result
        icon="success"
        title="发布完成"
        sub-title="返回上一步或打开主站发布链接"
    >
        <template #extra>
            <div v-if="src != ''">
                <el-link :href="src" type="primary">{{ src }}</el-link>
                <el-row style="height: 20px;" />
            </div>
            <div>
                <el-button @click="back" type="primary" plain>返回</el-button>
            </div>
        </template>
    </el-result>
</template>

<style scoped>
</style>
