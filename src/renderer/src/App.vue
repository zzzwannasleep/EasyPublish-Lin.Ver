<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useDark } from '@vueuse/core'
import {
  Compass,
  Document,
  DocumentAdd,
  FolderOpened,
  House,
  Key,
} from '@element-plus/icons-vue'
import AppShell from './components/layout/AppShell.vue'
import { type LocaleCode, useI18n } from './i18n'
import {
  THEME_PALETTE_DEFINITIONS,
  applyThemePalette,
  isThemePaletteId,
  persistThemePalette,
  readStoredThemePalette,
  type ThemePaletteId,
} from './theme/palette'

const route = useRoute()
const isDark = useDark()
const sidebarExpanded = ref(true)
const { locale, localeOptions, setLocale, t } = useI18n()
const activeThemePalette = ref<ThemePaletteId>(readStoredThemePalette())
const activeToolbarMenu = ref<'proxy' | 'theme' | 'language' | null>(null)

applyThemePalette(activeThemePalette.value)

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
    to: '/logs',
    label: t('nav.logs.label'),
    caption: t('nav.logs.caption'),
    icon: Document
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
const themePaletteOptions = computed(() =>
  THEME_PALETTE_DEFINITIONS.map(option => ({
    ...option,
    label: t(option.labelKey),
  })),
)

function toggleSidebar() {
  sidebarExpanded.value = !sidebarExpanded.value
}

function toggleToolbarMenu(menu: 'proxy' | 'theme' | 'language') {
  activeToolbarMenu.value = activeToolbarMenu.value === menu ? null : menu
}

function closeToolbarMenu() {
  activeToolbarMenu.value = null
}

function setThemeMode(mode: 'light' | 'dark') {
  isDark.value = mode === 'dark'
  closeToolbarMenu()
}

function setThemePalette(value: string) {
  if (!isThemePaletteId(value)) {
    return
  }

  activeThemePalette.value = value
  persistThemePalette(value)
  applyThemePalette(value)
  closeToolbarMenu()
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

const proxyForm = reactive({
  status: false,
  type: '',
  host: '',
  port: 8080
})

function setProxyConfig() {
  const message: Message.Global.ProxyConfig = proxyForm
  window.globalAPI.setProxyConfig(JSON.stringify(message))
  closeToolbarMenu()
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
  <div class="h-full w-full">
    <el-dialog
      v-model="imageDialogVisible"
      align-center
      destroy-on-close
      :title="t('app.captcha.dmhyTitle')"
      width="260"
    >
      <div class="flex items-center gap-3">
        <img :src="imgSrc" alt="captcha" class="w-[120px] rounded-2xl" />
        <el-button link type="primary" size="small" @click="refreshImage">{{ t('app.captcha.refresh') }}</el-button>
      </div>
      <div class="mt-[18px] flex gap-3">
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
      <iframe class="h-[500px] w-full rounded-[14px] border-0" src="https://nyaa.si/grecaptcha" />
      <div class="mt-[18px] flex justify-end">
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
      <div class="flex items-center justify-center">
        <div ref="turnstileValidationAcgnxG" class="h-[65px] w-[300px]">cloudflare-turnstile</div>
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
      <div class="flex items-center justify-center">
        <div ref="turnstileValidationAcgnxA" class="h-[65px] w-[300px]">cloudflare-turnstile</div>
      </div>
    </el-dialog>

    <AppShell
      :nav-items="navItems"
      :current-path="route.path"
      :title="pageTitle"
      :subtitle="pageSubtitle"
      :dark="isDark"
      :active-toolbar-menu="activeToolbarMenu"
      :theme-palette="activeThemePalette"
      :theme-palette-options="themePaletteOptions"
      :sidebar-expanded="sidebarExpanded"
      :locale="locale"
      :locale-options="localeOptions"
      @close="winClose"
      @maximize="winMax"
      @minimize="winMini"
      @toggle-toolbar-menu="toggleToolbarMenu"
      @close-toolbar-menu="closeToolbarMenu"
      @set-theme-mode="setThemeMode"
      @select-theme-palette="setThemePalette"
      @toggle-sidebar="toggleSidebar"
      @change-locale="
        (value) => {
          setLocale(value as LocaleCode)
          closeToolbarMenu()
        }
      "
    >
      <template #utility>
        <button
          :class="[
            'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
            activeToolbarMenu === 'proxy' ? 'topbar-utility-button is-active' : 'text-copy-secondary',
          ]"
          type="button"
          @click="toggleToolbarMenu('proxy')"
        >
          <el-icon><Operation /></el-icon>
          <span>{{ t('common.proxy') }}</span>
        </button>
      </template>

      <template #utility-panel>
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
            <el-button @click="closeToolbarMenu">{{ t('common.cancel') }}</el-button>
          </el-form-item>
        </el-form>
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
.topbar-utility-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
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
    opacity 180ms ease,
    transform 180ms ease;
}

:deep(.app-route-enter-from),
:deep(.app-route-leave-to) {
  opacity: 0;
  transform: translateY(6px);
}
</style>
