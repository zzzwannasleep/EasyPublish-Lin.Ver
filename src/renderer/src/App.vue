<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useDark, useToggle } from '@vueuse/core'
import {
  Compass,
  Document,
  DocumentAdd,
  EditPen,
  FolderOpened,
  House,
  Key,
  Operation
} from '@element-plus/icons-vue'
import AppShell from './components/layout/AppShell.vue'
import { type LocaleCode, useI18n } from './i18n'

const route = useRoute()
const isDark = useDark()
const toggleDark = useToggle(isDark)
const sidebarOpen = ref(false)
const { locale, localeOptions, setLocale, t } = useI18n()

document.body.style.overflow = 'hidden'

const navItems = computed(() => [
  {
    to: '/',
    label: t('nav.dashboard.label'),
    caption: t('nav.dashboard.caption'),
    icon: House
  },
  {
    to: '/new-project',
    label: t('nav.newProject.label'),
    caption: t('nav.newProject.caption'),
    icon: DocumentAdd,
    matchPrefixes: ['/create_task']
  },
  {
    to: '/projects',
    label: t('nav.projects.label'),
    caption: t('nav.projects.caption'),
    icon: FolderOpened,
    matchPrefixes: ['/projects/', '/task/', '/task_list']
  },
  {
    to: '/accounts',
    label: t('nav.accounts.label'),
    caption: t('nav.accounts.caption'),
    icon: Key,
    matchPrefixes: ['/account']
  },
  {
    to: '/sites',
    label: t('nav.sites.label'),
    caption: t('nav.sites.caption'),
    icon: Operation
  },
  {
    to: '/logs',
    label: t('nav.logs.label'),
    caption: t('nav.logs.caption'),
    icon: Document
  },
  {
    to: '/legacy/modify',
    label: t('nav.tools.label'),
    caption: t('nav.tools.caption'),
    icon: EditPen,
    matchPrefixes: ['/modify']
  },
  {
    to: '/guide',
    label: t('nav.guide.label'),
    caption: t('nav.guide.caption'),
    icon: Compass,
    matchPrefixes: ['/quickstart']
  }
])

const pageTitle = computed(() => t((route.meta.titleKey as string) ?? 'app.defaultTitle'))
const pageSubtitle = computed(() => t((route.meta.subtitleKey as string) ?? 'app.defaultSubtitle'))

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
  },
)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function closeSidebar() {
  sidebarOpen.value = false
}

function winClose() {
  const command: Message.Global.WinHandle = { command: 'close' }
  window.globalAPI.winHandle(JSON.stringify(command))
}

function winMini() {
  const command: Message.Global.WinHandle = { command: 'mini' }
  window.globalAPI.winHandle(JSON.stringify(command))
}

function winMax() {
  const command: Message.Global.WinHandle = { command: 'max' }
  window.globalAPI.winHandle(JSON.stringify(command))
}

const proxyVisible = ref(false)
const proxyForm = reactive({
  status: false,
  type: '',
  host: '',
  port: 8080
})

function setProxyConfig() {
  const message: Message.Global.ProxyConfig = proxyForm
  window.globalAPI.setProxyConfig(JSON.stringify(message))
  proxyVisible.value = false
  ElMessage.success(t('app.proxy.saved'))
}

onMounted(async () => {
  const message: Message.Global.ProxyConfig = JSON.parse(await window.globalAPI.getProxyConfig())
  Object.assign(proxyForm, message)
})

const imageDialogVisible = ref(false)
const reCaptchaDialogVisibleNyaa = ref(false)
const turnstileDialogVisibleAcgnxA = ref(false)
const turnstileDialogVisibleAcgnxG = ref(false)
const turnstileValidationAcgnxG = useTemplateRef('turnstileValidationAcgnxG')
const turnstileValidationAcgnxA = useTemplateRef('turnstileValidationAcgnxA')
const imgSrc = ref('')
const imgCaptcha = ref('')
let reCaptcha = ''

async function refreshImage() {
  imageDialogVisible.value = true
  imgSrc.value = `https://www.dmhy.org/common/generate-captcha?code=${Date.now()}`
}

window.BTAPI.loadImageCaptcha(refreshImage)

async function setValidation(message: string) {
  const { type } = JSON.parse(message) as Message.BT.ValidationType
  if (type === 'nyaa') {
    reCaptchaDialogVisibleNyaa.value = true
    return
  }

  if (type === 'acgnx_g') {
    turnstileDialogVisibleAcgnxG.value = true
    return
  }

  turnstileDialogVisibleAcgnxA.value = true
}

window.BTAPI.loadValidation(setValidation)

window.addEventListener('message', event => {
  reCaptcha = event.data
})

window.BTAPI.closeValidation(() => {
  turnstileDialogVisibleAcgnxG.value = false
  turnstileDialogVisibleAcgnxA.value = false
})

async function submitCaptcha(type: string) {
  if (type === 'dmhy') {
    const message: Message.BT.ValidationInfo = { type: 'dmhy', key: imgCaptcha.value }
    window.BTAPI.loginAccount(JSON.stringify(message))
    imageDialogVisible.value = false
    return
  }

  const message: Message.BT.ValidationInfo = { type: 'nyaa', key: reCaptcha }
  window.BTAPI.loginAccount(JSON.stringify(message))
}

async function confirmNyaaCaptcha() {
  await submitCaptcha('nyaa')
  reCaptchaDialogVisibleNyaa.value = false
}

async function setTurnstilePosition(type: 'acgnx_g' | 'acgnx_a') {
  const rect =
    type === 'acgnx_g'
      ? turnstileValidationAcgnxG.value!.getBoundingClientRect()
      : turnstileValidationAcgnxA.value!.getBoundingClientRect()

  const position: Message.BT.TurnstilePosition = { x: rect.x, y: rect.y }
  const message: Message.BT.ValidationInfo = { type, position }
  window.BTAPI.loginAccount(JSON.stringify(message))
}

async function removeValidation() {
  window.BTAPI.removeValidation()
}
</script>

<template>
  <div class="app-root">
    <el-dialog
      v-model="imageDialogVisible"
      align-center
      destroy-on-close
      :title="t('app.captcha.dmhyTitle')"
      width="260"
    >
      <div class="captcha-row">
        <img :src="imgSrc" alt="captcha" class="captcha-image" />
        <el-button link type="primary" size="small" @click="refreshImage">{{ t('app.captcha.refresh') }}</el-button>
      </div>
      <div class="captcha-input">
        <el-input v-model="imgCaptcha" />
        <el-button type="primary" @click="submitCaptcha('dmhy')">{{ t('app.captcha.submit') }}</el-button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="reCaptchaDialogVisibleNyaa"
      align-center
      destroy-on-close
      :title="t('app.captcha.nyaaTitle')"
      width="390"
    >
      <iframe class="validation-frame" src="https://nyaa.si/grecaptcha" />
      <div class="dialog-actions">
        <el-button type="primary" @click="confirmNyaaCaptcha">{{ t('app.captcha.confirm') }}</el-button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="turnstileDialogVisibleAcgnxG"
      :z-index="3000"
      align-center
      destroy-on-close
      :title="t('app.captcha.acgnxGlobalTitle')"
      width="380"
      @opened="setTurnstilePosition('acgnx_g')"
      @close="removeValidation"
    >
      <div class="turnstile-box">
        <div ref="turnstileValidationAcgnxG" class="turnstile-anchor">cloudflare-turnstile</div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="turnstileDialogVisibleAcgnxA"
      :z-index="3001"
      align-center
      destroy-on-close
      :title="t('app.captcha.acgnxAsiaTitle')"
      width="380"
      @opened="setTurnstilePosition('acgnx_a')"
      @close="removeValidation"
    >
      <div class="turnstile-box">
        <div ref="turnstileValidationAcgnxA" class="turnstile-anchor">cloudflare-turnstile</div>
      </div>
    </el-dialog>

    <AppShell
      :nav-items="navItems"
      :current-path="route.path"
      :title="pageTitle"
      :subtitle="pageSubtitle"
      :dark="isDark"
      :sidebar-open="sidebarOpen"
      :locale="locale"
      :locale-options="localeOptions"
      @close="winClose"
      @maximize="winMax"
      @minimize="winMini"
      @toggle-theme="toggleDark()"
      @toggle-sidebar="toggleSidebar"
      @close-sidebar="closeSidebar"
      @change-locale="(value) => setLocale(value as LocaleCode)"
    >
      <template #utility>
        <el-popover :visible="proxyVisible" :width="320" placement="bottom-end">
          <el-form :model="proxyForm" label-position="top" class="proxy-form">
            <el-form-item :label="t('app.proxy.enabled')">
              <el-switch v-model="proxyForm.status" />
            </el-form-item>
            <el-form-item :label="t('app.proxy.type')">
              <el-select v-model="proxyForm.type" :placeholder="t('common.selectProtocol')">
                <el-option label="HTTP" value="http" />
                <el-option label="HTTPS" value="https" />
                <el-option label="SOCKS5" value="socks" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('app.proxy.host')">
              <el-input v-model="proxyForm.host" />
            </el-form-item>
            <el-form-item :label="t('app.proxy.port')">
              <el-input-number v-model="proxyForm.port" />
            </el-form-item>
            <el-form-item class="proxy-form__actions">
              <el-button type="primary" @click="setProxyConfig">{{ t('common.save') }}</el-button>
              <el-button @click="proxyVisible = false">{{ t('common.cancel') }}</el-button>
            </el-form-item>
          </el-form>
          <template #reference>
            <button class="proxy-button" type="button" @click="proxyVisible = !proxyVisible">
              <el-icon><Operation /></el-icon>
              <span>{{ t('common.proxy') }}</span>
            </button>
          </template>
        </el-popover>
      </template>

      <RouterView v-slot="{ Component, route: viewRoute }">
        <transition name="app-route" mode="out-in">
          <component :is="Component" :key="viewRoute.fullPath" />
        </transition>
      </RouterView>
    </AppShell>
  </div>
</template>

<style scoped>
.app-root {
  width: 100%;
  height: 100%;
}

.captcha-row,
.captcha-input,
.dialog-actions,
.turnstile-box {
  display: flex;
}

.captcha-row {
  align-items: center;
  gap: 12px;
}

.captcha-image {
  width: 120px;
  border-radius: 12px;
}

.captcha-input {
  gap: 12px;
  margin-top: 18px;
}

.dialog-actions {
  justify-content: flex-end;
  margin-top: 18px;
}

.validation-frame {
  width: 100%;
  height: 500px;
  border: 0;
  border-radius: 14px;
}

.turnstile-box {
  align-items: center;
  justify-content: center;
}

.turnstile-anchor {
  width: 300px;
  height: 65px;
}

.proxy-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease;
}

.proxy-button:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.proxy-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.proxy-form__actions {
  margin-bottom: 0;
}

:deep(.app-route-enter-active),
:deep(.app-route-leave-active) {
  transition:
    opacity 240ms ease,
    transform 240ms ease,
    filter 240ms ease;
}

:deep(.app-route-enter-from),
:deep(.app-route-leave-to) {
  opacity: 0;
  transform: translateY(10px) scale(0.992);
  filter: blur(4px);
}
</style>
