<script setup lang="ts" name="AccountWorkspace">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Connection,
  Delete,
  FolderOpened,
  Key,
  Lock,
  RefreshRight,
  Timer,
  Tools,
  UserFilled,
} from '@element-plus/icons-vue'
import StatusChip from './feedback/StatusChip.vue'
import { useI18n } from '../i18n'
import { getSiteLabel } from '../services/project/presentation'
import { siteBridge } from '../services/bridge/site'
import type { SiteCatalogEntry, SiteId } from '../types/site'
import { legacyApiStatusText, normalizeLegacyAccountStatus } from '../../../shared/utils/legacy-account-status'

type LegacyAccountType = Exclude<SiteId, 'forum'>

const props = withDefaults(
  defineProps<{
    siteIds?: LegacyAccountType[]
    showSettings?: boolean
    titleKey?: string
    descriptionKey?: string
  }>(),
  {
    siteIds: undefined,
    showSettings: true,
    titleKey: 'accounts.bt.title',
    descriptionKey: 'accounts.bt.description',
  },
)

type SiteAccount = {
  siteId: LegacyAccountType
  type: LegacyAccountType
  time: string
  status: string
  index: number
  username: string
  password: string
  apiToken?: string
  enable: boolean
}

const { t } = useI18n()
const isLoading = ref(false)
const forumSite = ref<SiteCatalogEntry | null>(null)
const forumAccountLoading = ref(false)

const siteAccounts = reactive<SiteAccount[]>([
  {
    siteId: 'bangumi',
    type: 'bangumi',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 1,
  },
  {
    siteId: 'mikan',
    type: 'mikan',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 2,
  },
  {
    siteId: 'anibt',
    type: 'anibt',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 3,
  },
  {
    siteId: 'miobt',
    type: 'miobt',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 4,
  },
  {
    siteId: 'nyaa',
    type: 'nyaa',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 5,
  },
  {
    siteId: 'acgrip',
    type: 'acgrip',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 6,
  },
  {
    siteId: 'dmhy',
    type: 'dmhy',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 7,
  },
  {
    siteId: 'acgnx_g',
    type: 'acgnx_g',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 8,
  },
  {
    siteId: 'acgnx_a',
    type: 'acgnx_a',
    time: '',
    status: '',
    username: '',
    password: '',
    apiToken: '',
    enable: true,
    index: 9,
  },
])

const acgnxAPIConfig = ref<Config.AcgnXAPIConfig>({
  enable: false,
  asia: {
    uid: '',
    token: '',
  },
  global: {
    uid: '',
    token: '',
  },
})

const username = ref('')
const password = ref('')
const configName = ref('')

function usesApiToken(siteId: LegacyAccountType) {
  return siteId === 'mikan' || siteId === 'anibt' || siteId === 'miobt'
}

function supportsBrowserLogin(siteId: LegacyAccountType) {
  return siteId === 'mikan' || !usesApiToken(siteId)
}

function usesApiUid(siteId: LegacyAccountType) {
  return siteId === 'miobt'
}

function getUsernameLabel(siteId: LegacyAccountType) {
  return usesApiUid(siteId) ? t('accounts.fields.apiUid') : t('accounts.fields.username')
}

function getApiTokenLabel(siteId: LegacyAccountType) {
  return siteId === 'miobt' ? t('accounts.fields.apiKey') : t('accounts.fields.apiToken')
}

function isConfiguredOnlyStatus(status: string) {
  return (
    status === legacyApiStatusText.tokenConfigured ||
    status === legacyApiStatusText.credentialsConfigured
  )
}

function getDisplayAccountStatus(status: string, enabled: boolean) {
  if (!enabled) {
    return 'disabled'
  }

  if (isConfiguredOnlyStatus(status)) {
    return 'unknown'
  }

  return normalizeLegacyAccountStatus(status, enabled)
}

const visibleSiteAccounts = computed(() =>
  props.siteIds?.length ? siteAccounts.filter(item => props.siteIds!.includes(item.siteId)) : siteAccounts,
)

const overviewItems = computed(() => [
  {
    label: t('accounts.summary.total'),
    value: visibleSiteAccounts.value.length,
    tone: 'neutral' as const,
  },
  {
    label: t('accounts.summary.enabled'),
    value: visibleSiteAccounts.value.filter(item => item.enable).length,
    tone: 'info' as const,
  },
  {
    label: t('accounts.summary.authenticated'),
    value: visibleSiteAccounts.value.filter(item => getDisplayAccountStatus(item.status, item.enable) === 'loggedIn').length,
    tone: 'success' as const,
  },
  {
    label: t('accounts.summary.attention'),
    value: visibleSiteAccounts.value.filter(item =>
      ['blocked', 'failed', 'passwordError', 'captchaError', 'validationFailed'].includes(
        getDisplayAccountStatus(item.status, item.enable),
      ),
    ).length,
    tone: 'warning' as const,
  },
])

function getAccountStatusTone(
  status: string,
  enabled: boolean,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (isConfiguredOnlyStatus(status)) {
    return 'info'
  }

  switch (getDisplayAccountStatus(status, enabled)) {
    case 'loggedIn':
      return 'success'
    case 'loggedOut':
      return 'info'
    case 'loggingIn':
    case 'blocked':
    case 'captchaError':
    case 'validationFailed':
      return 'warning'
    case 'failed':
    case 'passwordError':
      return 'danger'
    case 'disabled':
    case 'unknown':
    default:
      return 'neutral'
  }
}

function getAccountStatusLabel(status: string, enabled: boolean) {
  if (isConfiguredOnlyStatus(status)) {
    return status
  }

  switch (getDisplayAccountStatus(status, enabled)) {
    case 'disabled':
      return t('accounts.status.disabled')
    case 'loggedIn':
      return t('accounts.status.loggedIn')
    case 'loggedOut':
      return t('accounts.status.loggedOut')
    case 'blocked':
      return t('accounts.status.blocked')
    case 'failed':
      return t('accounts.status.failed')
    case 'loggingIn':
      return t('accounts.status.loggingIn')
    case 'passwordError':
      return t('accounts.status.passwordError')
    case 'captchaError':
      return t('accounts.status.captchaError')
    case 'validationFailed':
      return t('accounts.status.validationFailed')
    case 'unknown':
    default:
      return status || t('accounts.status.unknown')
  }
}

function getAccountTimeLabel(value: string) {
  return value || t('accounts.status.never')
}

async function loadData() {
  isLoading.value = true
  try {
    await Promise.all(
      siteAccounts.map(async (item, index) => {
        const msg: Message.BT.AccountType = { type: item.type }
        const result = await window.BTAPI.getAccountInfo(JSON.stringify(msg))
        const info: Message.BT.AccountInfo = JSON.parse(result)
        Object.assign(siteAccounts[index], info)
      }),
    )
  } finally {
    isLoading.value = false
  }
}

window.BTAPI.refreshLoginData(loadData)

async function getAcgnXAPIConfig() {
  const config: Message.BT.AcgnXAPIConfig = JSON.parse(await window.BTAPI.getAcgnXAPIConfig())
  if (config) {
    acgnxAPIConfig.value = config
  }
}

async function saveAcgnXAPIConfig() {
  const msg: Message.BT.AcgnXAPIConfig = acgnxAPIConfig.value
  window.BTAPI.saveAcgnXAPIConfig(JSON.stringify(msg))
  ElMessage.success(t('accounts.api.saved'))
}

function exportCookies(type: LegacyAccountType) {
  const msg: Message.BT.AccountType = { type }
  window.BTAPI.exportCookies(JSON.stringify(msg))
}

function importCookies(type: LegacyAccountType) {
  const msg: Message.BT.AccountType = { type }
  window.BTAPI.importCookies(JSON.stringify(msg))
}

async function checkLoginStatus(type: LegacyAccountType | 'all') {
  const msg: Message.BT.AccountType = { type }
  const raw = await window.BTAPI.checkLoginStatus(JSON.stringify(msg))
  if (!raw || type === 'all') {
    return
  }

  const result: Message.BT.LoginStatus = JSON.parse(raw)
  const toastSiteLabel = getSiteLabel(type)
  if (result.errorCode) {
    ElMessage.error(`${toastSiteLabel} check failed: ${result.errorCode}`)
    return
  }
  if (result.errorCode) {
    ElMessage.error(`${getSiteLabel(type)} 检查失败，错误代码：${result.errorCode}`)
    return
  }

  const account = siteAccounts.find(item => item.type === type)
  const normalizedStatus: string = getDisplayAccountStatus(result.status, account?.enable ?? true)
  if (type === 'nyaa' && normalizedStatus === 'loggedOut') {
    openLoginWindow(type)
    ElMessage.info(t('accounts.messages.nyaaBrowserLogin'))
    return
  }
  if (type === 'acgrip' && normalizedStatus === 'loggedOut') {
    openLoginWindow(type)
    ElMessage.info(t('accounts.messages.acgripBrowserLogin'))
    return
  }
  if (normalizedStatus === 'failed' || normalizedStatus === 'passwordError') {
    ElMessage.error(`${toastSiteLabel}: ${result.status}`)
    return
  }
  if (normalizedStatus === 'blocked' || normalizedStatus === 'captchaError' || normalizedStatus === 'validationFailed') {
    ElMessage.warning(`${toastSiteLabel}: ${result.status}`)
    return
  }
  if (normalizedStatus === 'failed' || normalizedStatus === 'passwordError') {
    ElMessage.error(`${getSiteLabel(type)}：${result.status}`)
  } else if (normalizedStatus === 'blocked' || normalizedStatus === 'captchaError' || normalizedStatus === 'validationFailed') {
    ElMessage.warning(`${getSiteLabel(type)}：${result.status}`)
  }
}

function saveAccountInfo(type: LegacyAccountType) {
  const msg: Message.BT.AccountInfo = siteAccounts.find(item => item.type === type)!
  window.BTAPI.saveAccountInfo(JSON.stringify(msg))
}

function openLoginWindow(type: LegacyAccountType) {
  const msg: Message.BT.AccountType = { type }
  window.BTAPI.openLoginWindow(JSON.stringify(msg))
}

function clearStorage() {
  window.BTAPI.clearStorage()
}

async function loadForumSite() {
  try {
    const result = await siteBridge.getSite('forum')
    forumSite.value = result.ok ? result.data.site : null
  } catch {
    forumSite.value = null
  }
}

function getForumAccountTone(): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (forumSite.value?.accountStatus) {
    case 'authenticated':
      return 'success'
    case 'checking':
      return 'info'
    case 'unauthenticated':
    case 'blocked':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'neutral'
  }
}

function getForumAccountLabel() {
  switch (forumSite.value?.accountStatus) {
    case 'authenticated':
      return t('accounts.pt.account.authenticated')
    case 'checking':
      return t('accounts.pt.account.checking')
    case 'unauthenticated':
      return t('accounts.pt.account.unauthenticated')
    case 'blocked':
      return t('accounts.pt.account.blocked')
    case 'error':
      return t('accounts.pt.account.error')
    default:
      return t('accounts.pt.account.unknown')
  }
}

function getForumAccountText() {
  switch (forumSite.value?.accountStatus) {
    case 'authenticated':
      return forumSite.value.accountMessage || t('accounts.pt.account.authenticatedText')
    case 'checking':
      return forumSite.value.accountMessage || t('accounts.pt.account.checkingText')
    case 'unauthenticated':
      return forumSite.value.accountMessage || t('accounts.pt.account.unauthenticatedText')
    case 'blocked':
      return forumSite.value.accountMessage || t('accounts.pt.account.blockedText')
    case 'error':
      return forumSite.value.accountMessage || t('accounts.pt.account.errorText')
    default:
      return forumSite.value?.accountMessage || t('accounts.pt.account.unknownText')
  }
}

function getForumLastCheckedLabel() {
  return forumSite.value?.lastCheckAt || t('accounts.status.never')
}

async function saveForumAccountInfo(refreshStatus = true) {
  const msg: Message.Forum.AccountInfo = {
    username: username.value,
    password: password.value,
  }
  await window.forumAPI.saveAccountInfo(JSON.stringify(msg))
  if (refreshStatus) {
    await loadForumSite()
  }
}

async function getForumAccountInfo() {
  const msg: Message.Forum.AccountInfo = JSON.parse(await window.forumAPI.getAccountInfo())
  username.value = msg.username
  password.value = msg.password
}

async function checkForumAccount() {
  forumAccountLoading.value = true
  try {
    await saveForumAccountInfo(false)
    const result = await siteBridge.validateAccount('forum')
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    await loadForumSite()
    if (result.data.status === 'authenticated') {
      ElMessage.success(result.data.message || t('accounts.pt.account.authenticatedText'))
      return
    }

    if (result.data.status === 'unauthenticated') {
      ElMessage.warning(result.data.message || t('accounts.pt.account.unauthenticatedText'))
      return
    }

    ElMessage.error(result.data.message || t('accounts.pt.account.errorText'))
  } catch (error) {
    ElMessage.error((error as Error).message)
  } finally {
    forumAccountLoading.value = false
  }
}

async function getConfigName() {
  const { name }: Message.Global.ConfigName = JSON.parse(await window.globalAPI.getConfigName())
  configName.value = name
}

function setConfigName() {
  const msg: Message.Global.ConfigName = { name: configName.value }
  window.globalAPI.setConfigName(JSON.stringify(msg))
}

function changeConfig() {
  window.globalAPI.changeConfig()
}

function createConfig() {
  window.globalAPI.createConfig()
}

onMounted(() => {
  void Promise.all([loadData(), getForumAccountInfo(), getConfigName(), getAcgnXAPIConfig(), loadForumSite()])
})
</script>

<template>
  <div class="account-workspace">
    <section class="account-overview">
      <article v-for="item in overviewItems" :key="item.label" class="account-metric">
        <div class="account-metric__label">{{ item.label }}</div>
        <div class="account-metric__value">{{ item.value }}</div>
        <StatusChip :tone="item.tone">{{ item.label }}</StatusChip>
      </article>
    </section>

    <section class="account-toolbar">
      <div class="account-toolbar__copy">
        <div class="account-toolbar__title">{{ t(props.titleKey) }}</div>
        <div class="account-toolbar__text">{{ t(props.descriptionKey) }}</div>
      </div>

      <div class="account-toolbar__actions">
        <el-button plain @click="loadData">
          <el-icon><RefreshRight /></el-icon>
          <span>{{ t('accounts.actions.refresh') }}</span>
        </el-button>
        <el-button plain type="primary" @click="checkLoginStatus('all')">
          <el-icon><Key /></el-icon>
          <span>{{ t('accounts.actions.checkAll') }}</span>
        </el-button>
        <el-button plain type="danger" @click="clearStorage">
          <el-icon><Delete /></el-icon>
          <span>{{ t('accounts.actions.clearCache') }}</span>
        </el-button>
      </div>
    </section>

    <section class="account-grid" v-loading="isLoading">
      <article v-for="account in visibleSiteAccounts" :key="account.siteId" class="account-card">
        <header class="account-card__head">
          <div class="account-card__title-group">
            <div class="account-card__eyebrow">{{ account.type }}</div>
            <h3 class="account-card__title">{{ getSiteLabel(account.siteId) }}</h3>
          </div>
          <StatusChip :tone="getAccountStatusTone(account.status, account.enable)">
            {{ getAccountStatusLabel(account.status, account.enable) }}
          </StatusChip>
        </header>

        <div class="account-card__meta">
          <article class="account-card__meta-card">
            <div class="account-card__meta-label">
              <el-icon><Timer /></el-icon>
              <span>{{ t('accounts.fields.lastChecked') }}</span>
            </div>
            <div class="account-card__meta-value">{{ getAccountTimeLabel(account.time) }}</div>
          </article>
          <article class="account-card__meta-card">
            <div class="account-card__meta-label">
              <el-icon><Connection /></el-icon>
              <span>{{ t('accounts.fields.enabled') }}</span>
            </div>
            <div class="account-card__switch">
              <span>{{ account.enable ? t('accounts.state.enabled') : t('accounts.state.disabled') }}</span>
              <el-switch v-model="account.enable" @change="saveAccountInfo(account.type)" />
            </div>
          </article>
        </div>

        <div class="account-card__fields">
          <label v-if="!usesApiToken(account.type)" class="account-field">
            <span class="account-field__label">{{ t('accounts.fields.username') }}</span>
            <el-input v-model="account.username" @blur="saveAccountInfo(account.type)">
              <template #prefix>
                <el-icon><UserFilled /></el-icon>
              </template>
            </el-input>
          </label>

          <label v-if="usesApiUid(account.type)" class="account-field">
            <span class="account-field__label">{{ getUsernameLabel(account.type) }}</span>
            <el-input v-model="account.username" @blur="saveAccountInfo(account.type)">
              <template #prefix>
                <el-icon><UserFilled /></el-icon>
              </template>
            </el-input>
          </label>

          <label v-if="!usesApiToken(account.type)" class="account-field">
            <span class="account-field__label">{{ t('accounts.fields.password') }}</span>
            <el-input v-model="account.password" show-password type="password" @blur="saveAccountInfo(account.type)">
              <template #prefix>
                <el-icon><Lock /></el-icon>
              </template>
            </el-input>
          </label>

          <label v-if="usesApiToken(account.type)" class="account-field">
            <span class="account-field__label">{{ getApiTokenLabel(account.type) }}</span>
            <el-input v-model="account.apiToken" show-password type="password" @blur="saveAccountInfo(account.type)">
              <template #prefix>
                <el-icon><Key /></el-icon>
              </template>
            </el-input>
          </label>
        </div>

        <footer class="account-card__actions">
          <el-button type="primary" @click="checkLoginStatus(account.type)">
            {{ t('accounts.actions.check') }}
          </el-button>
          <el-button v-if="supportsBrowserLogin(account.type)" plain @click="openLoginWindow(account.type)">
            {{ t('accounts.actions.manualLogin') }}
          </el-button>
          <el-button v-if="!usesApiToken(account.type)" plain @click="importCookies(account.type)">
            {{ t('accounts.actions.import') }}
          </el-button>
          <el-button v-if="!usesApiToken(account.type)" plain @click="exportCookies(account.type)">
            {{ t('accounts.actions.export') }}
          </el-button>
        </footer>
      </article>
    </section>

    <section v-if="showSettings" class="account-settings">
      <article class="account-settings__card">
        <header class="account-settings__header">
          <div class="account-settings__header-main">
            <div class="account-settings__icon">
              <el-icon><UserFilled /></el-icon>
            </div>
            <div>
              <h3 class="account-settings__title">{{ t('accounts.mainSite.title') }}</h3>
              <p class="account-settings__text">{{ t('accounts.mainSite.description') }}</p>
            </div>
          </div>
          <StatusChip :tone="getForumAccountTone()">
            {{ getForumAccountLabel() }}
          </StatusChip>
        </header>

        <div class="account-card__meta">
          <article class="account-card__meta-card">
            <div class="account-card__meta-label">
              <el-icon><Timer /></el-icon>
              <span>{{ t('accounts.fields.lastChecked') }}</span>
            </div>
            <div class="account-card__meta-value">{{ getForumLastCheckedLabel() }}</div>
          </article>
          <article class="account-card__meta-card">
            <div class="account-card__meta-label">
              <el-icon><Connection /></el-icon>
              <span>{{ t('accounts.pt.fields.accountStatus') }}</span>
            </div>
            <div class="account-settings__text">{{ getForumAccountText() }}</div>
          </article>
        </div>

        <div class="account-settings__form">
          <label class="account-field">
            <span class="account-field__label">{{ t('accounts.fields.username') }}</span>
            <el-input
              v-model="username"
              :placeholder="t('accounts.mainSite.usernamePlaceholder')"
              @blur="saveForumAccountInfo"
            />
          </label>

          <label class="account-field">
            <span class="account-field__label">{{ t('accounts.fields.appPassword') }}</span>
            <el-input
              v-model="password"
              show-password
              type="password"
              :placeholder="t('accounts.mainSite.passwordPlaceholder')"
              @blur="saveForumAccountInfo"
            />
          </label>
        </div>

        <footer class="account-settings__actions">
          <el-button type="primary" :loading="forumAccountLoading" @click="checkForumAccount">
            {{ t('accounts.pt.actions.checkAccount') }}
          </el-button>
        </footer>
      </article>

      <article class="account-settings__card">
        <header class="account-settings__header">
          <div class="account-settings__icon">
            <el-icon><FolderOpened /></el-icon>
          </div>
          <div>
            <h3 class="account-settings__title">{{ t('accounts.config.title') }}</h3>
            <p class="account-settings__text">{{ t('accounts.config.description') }}</p>
          </div>
        </header>

        <div class="account-settings__form">
          <label class="account-field">
            <span class="account-field__label">{{ t('accounts.fields.currentConfig') }}</span>
            <el-input v-model="configName" :placeholder="t('accounts.config.placeholder')" @blur="setConfigName" />
          </label>
        </div>

        <footer class="account-settings__actions">
          <el-button plain @click="changeConfig">{{ t('accounts.actions.switchConfig') }}</el-button>
          <el-button type="primary" plain @click="createConfig">
            {{ t('accounts.actions.createConfig') }}
          </el-button>
        </footer>
      </article>

      <article class="account-settings__card account-settings__card--wide">
        <header class="account-settings__header">
          <div class="account-settings__icon">
            <el-icon><Tools /></el-icon>
          </div>
          <div>
            <h3 class="account-settings__title">{{ t('accounts.api.title') }}</h3>
            <p class="account-settings__text">{{ t('accounts.api.description') }}</p>
          </div>
        </header>

        <div class="account-settings__toggle">
          <el-checkbox v-model="acgnxAPIConfig.enable" border @change="saveAcgnXAPIConfig">
            {{ t('accounts.api.enable') }}
          </el-checkbox>
        </div>

        <div v-if="acgnxAPIConfig.enable" class="account-settings__nested-grid">
          <section class="account-settings__subcard">
            <h4 class="account-settings__subcard-title">{{ t('accounts.api.asia') }}</h4>
            <div class="account-settings__form">
              <label class="account-field">
                <span class="account-field__label">{{ t('accounts.fields.apiUid') }}</span>
                <el-input v-model="acgnxAPIConfig.asia.uid" />
              </label>
              <label class="account-field">
                <span class="account-field__label">{{ t('accounts.fields.apiToken') }}</span>
                <el-input v-model="acgnxAPIConfig.asia.token" />
              </label>
            </div>
          </section>

          <section class="account-settings__subcard">
            <h4 class="account-settings__subcard-title">{{ t('accounts.api.global') }}</h4>
            <div class="account-settings__form">
              <label class="account-field">
                <span class="account-field__label">{{ t('accounts.fields.apiUid') }}</span>
                <el-input v-model="acgnxAPIConfig.global.uid" />
              </label>
              <label class="account-field">
                <span class="account-field__label">{{ t('accounts.fields.apiToken') }}</span>
                <el-input v-model="acgnxAPIConfig.global.token" />
              </label>
            </div>
          </section>
        </div>

        <footer v-if="acgnxAPIConfig.enable" class="account-settings__actions">
          <el-button type="primary" @click="saveAcgnXAPIConfig">{{ t('common.save') }}</el-button>
        </footer>
      </article>
    </section>
  </div>
</template>

<style scoped>
.account-workspace {
  display: grid;
  gap: 18px;
  width: 100%;
}

.account-overview,
.account-grid,
.account-settings,
.account-card__meta,
.account-card__fields,
.account-settings__form,
.account-settings__nested-grid {
  display: grid;
  gap: 14px;
}

.account-overview {
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}

.account-metric,
.account-toolbar,
.account-card,
.account-settings__card,
.account-card__meta-card,
.account-settings__subcard {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    var(--surface-panel-wash),
    var(--bg-panel);
}

.account-metric {
  display: grid;
  gap: 10px;
  padding: 18px;
}

.account-metric__label,
.account-field__label,
.account-card__eyebrow,
.account-card__meta-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.account-metric__value {
  font-family: var(--font-display);
  font-size: clamp(28px, 4vw, 36px);
  font-weight: 700;
  letter-spacing: -0.05em;
}

.account-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.account-toolbar__copy {
  min-width: 0;
}

.account-toolbar__title,
.account-settings__title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.account-toolbar__text,
.account-settings__text {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.account-toolbar__actions,
.account-card__actions,
.account-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.account-grid {
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}

.account-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  box-shadow: var(--shadow-md);
}

.account-card__head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.account-card__title-group {
  min-width: 0;
}

.account-card__title {
  margin: 8px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
  word-break: break-word;
}

.account-card__meta {
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
}

.account-card__meta-card {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.account-card__meta-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.account-card__meta-value {
  font-size: 14px;
  line-height: 1.6;
}

.account-card__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 14px;
}

.account-field {
  display: grid;
  gap: 8px;
}

.account-field :deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 14px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.account-settings {
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
}

.account-settings__card {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.account-settings__card--wide {
  grid-column: span 2;
}

.account-settings__header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.account-settings__header-main {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.account-settings__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--surface-brand-fill-strong);
  color: var(--brand);
  font-size: 18px;
  flex: none;
}

.account-settings__toggle {
  display: flex;
  justify-content: flex-start;
}

.account-settings__nested-grid {
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.account-settings__subcard {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.account-settings__subcard-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

@media (max-width: 1100px) {
  .account-settings__card--wide {
    grid-column: span 1;
  }
}

@media (max-width: 980px) {
  .account-toolbar,
  .account-card__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .account-toolbar__actions {
    width: 100%;
  }
}

@media (max-width: 720px) {
  .account-metric,
  .account-toolbar,
  .account-card,
  .account-settings__card {
    padding: 14px;
  }

  .account-card__meta-card,
  .account-settings__subcard {
    padding: 12px;
  }

  .account-toolbar__actions,
  .account-card__actions,
  .account-settings__actions {
    width: 100%;
  }

  .account-toolbar__actions :deep(.el-button),
  .account-card__actions :deep(.el-button),
  .account-settings__actions :deep(.el-button) {
    flex: 1 1 auto;
  }
}
</style>
