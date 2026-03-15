<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CirclePlus, Connection, Delete, Key, Link, Lock, RefreshRight, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import StatusChip from './feedback/StatusChip.vue'
import { useI18n } from '../i18n'
import { siteBridge } from '../services/bridge/site'
import type { PtSiteAdapterKind, PtSiteDraft, PtSiteRecord } from '../types/pt-site'
import type { SiteAccountValidationPayload, SiteId, SiteMetadataRecord } from '../types/site'

interface PtSiteForm {
  name: string
  adapter: PtSiteAdapterKind
  baseUrl: string
  enabled: boolean
  username: string
  password: string
  apiToken: string
}

const { t } = useI18n()
const isLoading = ref(false)
const showCreator = ref(false)
const sites = ref<PtSiteRecord[]>([])
const forms = ref<Record<string, PtSiteForm>>({})
const accountValidationBySite = ref<Partial<Record<SiteId, SiteAccountValidationPayload>>>({})
const accountLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const metadataBySite = ref<Partial<Record<SiteId, SiteMetadataRecord>>>({})
const metadataLoadingBySite = ref<Partial<Record<SiteId, boolean>>>({})
const metadataErrorBySite = ref<Partial<Record<SiteId, string>>>({})
const creator = ref<PtSiteForm>(createEmptyForm())

function createEmptyForm(): PtSiteForm {
  return {
    name: '',
    adapter: 'nexusphp',
    baseUrl: '',
    enabled: true,
    username: '',
    password: '',
    apiToken: '',
  }
}

function toForm(site: PtSiteRecord): PtSiteForm {
  return {
    name: site.name,
    adapter: site.adapter as PtSiteAdapterKind,
    baseUrl: site.baseUrl,
    enabled: site.enabled,
    username: site.username ?? '',
    password: site.password ?? '',
    apiToken: site.apiToken ?? '',
  }
}

function syncForms(nextSites: PtSiteRecord[]) {
  forms.value = Object.fromEntries(nextSites.map(site => [site.id, toForm(site)]))
}

const summaryItems = computed(() => [
  {
    label: t('accounts.pt.summary.total'),
    value: sites.value.length,
    tone: 'neutral' as const,
  },
  {
    label: t('accounts.pt.summary.enabled'),
    value: sites.value.filter(site => forms.value[site.id]?.enabled ?? site.enabled).length,
    tone: 'info' as const,
  },
  {
    label: t('accounts.pt.summary.authenticated'),
    value: sites.value.filter(site => getAccountStatus(site).state === 'authenticated').length,
    tone: 'success' as const,
  },
])

function getForm(siteId: SiteId) {
  return forms.value[siteId]
}

function buildDraft(siteId?: SiteId): PtSiteDraft {
  const source = siteId ? getForm(siteId) : creator.value
  if (!source) {
    throw new Error('PT site form is not ready')
  }

  return {
    id: siteId,
    name: source.name.trim(),
    adapter: source.adapter,
    baseUrl: source.baseUrl.trim(),
    enabled: source.enabled,
    username: source.username.trim(),
    password: source.password,
    apiToken: source.apiToken.trim(),
  }
}

async function loadSites() {
  isLoading.value = true

  try {
    const result = await siteBridge.listManagedPtSites()
    if (!result.ok) {
      ElMessage.error(result.error.message)
      sites.value = []
      return
    }

    sites.value = result.data.sites
    syncForms(result.data.sites)
  } catch (error) {
    ElMessage.error((error as Error).message)
    sites.value = []
  } finally {
    isLoading.value = false
  }
}

async function saveSite(siteId?: SiteId, silent = false) {
  try {
    const result = await siteBridge.saveManagedPtSite(buildDraft(siteId))
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return false
    }

    await loadSites()
    if (!siteId) {
      creator.value = createEmptyForm()
      showCreator.value = false
    }
    if (!silent) {
      ElMessage.success(t(siteId ? 'accounts.pt.messages.saved' : 'accounts.pt.messages.created'))
    }
    return true
  } catch (error) {
    ElMessage.error((error as Error).message)
    return false
  }
}

async function removeSite(siteId: SiteId) {
  try {
    const result = await siteBridge.removeManagedPtSite(siteId)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      return
    }

    delete metadataBySite.value[siteId]
    delete metadataErrorBySite.value[siteId]
    delete accountValidationBySite.value[siteId]
    await loadSites()
    ElMessage.success(t('accounts.pt.messages.removed'))
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}

async function validateAccount(site: PtSiteRecord) {
  const saved = await saveSite(site.id, true)
  if (!saved) {
    return
  }

  accountLoadingBySite.value[site.id] = true

  try {
    const result = await siteBridge.validateAccount(site.id)
    if (!result.ok) {
      ElMessage.error(result.error.message)
      accountValidationBySite.value[site.id] = undefined
      return
    }

    accountValidationBySite.value[site.id] = result.data
    await loadSites()
  } catch (error) {
    accountValidationBySite.value[site.id] = undefined
    ElMessage.error((error as Error).message)
  } finally {
    accountLoadingBySite.value[site.id] = false
  }
}

async function loadMetadata(site: PtSiteRecord) {
  const saved = await saveSite(site.id, true)
  if (!saved) {
    return
  }

  metadataLoadingBySite.value[site.id] = true
  metadataErrorBySite.value[site.id] = ''

  try {
    const result = await siteBridge.loadMetadata(site.id)
    if (!result.ok) {
      metadataBySite.value[site.id] = undefined
      metadataErrorBySite.value[site.id] = result.error.message
      return
    }

    metadataBySite.value[site.id] = result.data.metadata
  } catch (error) {
    metadataBySite.value[site.id] = undefined
    metadataErrorBySite.value[site.id] = (error as Error).message
  } finally {
    metadataLoadingBySite.value[site.id] = false
  }
}

function getAccountStatus(site: PtSiteRecord) {
  const checked = accountValidationBySite.value[site.id]
  if (checked) {
    if (checked.status === 'authenticated') {
      return {
        state: 'authenticated',
        tone: 'success' as const,
        label: t('accounts.pt.account.authenticated'),
        text: checked.message || t('accounts.pt.account.authenticatedText'),
      }
    }

    if (checked.status === 'unauthenticated') {
      return {
        state: 'unauthenticated',
        tone: 'warning' as const,
        label: t('accounts.pt.account.unauthenticated'),
        text: checked.message || t('accounts.pt.account.unauthenticatedText'),
      }
    }

    return {
      state: 'error',
      tone: 'danger' as const,
      label: t('accounts.pt.account.error'),
      text: checked.message || t('accounts.pt.account.errorText'),
    }
  }

  switch (site.accountStatus) {
    case 'authenticated':
      return {
        state: 'authenticated',
        tone: 'success' as const,
        label: t('accounts.pt.account.authenticated'),
        text: site.accountMessage || t('accounts.pt.account.authenticatedText'),
      }
    case 'unauthenticated':
      return {
        state: 'unauthenticated',
        tone: 'warning' as const,
        label: t('accounts.pt.account.unauthenticated'),
        text: site.accountMessage || t('accounts.pt.account.unauthenticatedText'),
      }
    case 'blocked':
      return {
        state: 'blocked',
        tone: 'warning' as const,
        label: t('accounts.pt.account.blocked'),
        text: site.accountMessage || t('accounts.pt.account.blockedText'),
      }
    case 'error':
      return {
        state: 'error',
        tone: 'danger' as const,
        label: t('accounts.pt.account.error'),
        text: site.accountMessage || t('accounts.pt.account.errorText'),
      }
    case 'checking':
      return {
        state: 'checking',
        tone: 'info' as const,
        label: t('accounts.pt.account.checking'),
        text: site.accountMessage || t('accounts.pt.account.checkingText'),
      }
    case 'disabled':
      return {
        state: 'disabled',
        tone: 'neutral' as const,
        label: t('accounts.pt.account.disabled'),
        text: site.accountMessage || t('accounts.pt.account.disabledText'),
      }
    default:
      return {
        state: 'unknown',
        tone: 'neutral' as const,
        label: t('accounts.pt.account.unknown'),
        text: site.accountMessage || t('accounts.pt.account.unknownText'),
      }
  }
}

function getSiteStatus(site: PtSiteRecord) {
  if (!site.capabilitySet.metadata.sections) {
    const accountReady = getAccountStatus(site).state === 'authenticated'
    return {
      tone: accountReady ? ('success' as const) : ('neutral' as const),
      label: accountReady ? t('accounts.pt.siteStatus.ready') : t('accounts.pt.siteStatus.untested'),
      text: site.notes[site.notes.length - 1] || t('accounts.pt.siteStatus.untestedText'),
    }
  }

  if (metadataLoadingBySite.value[site.id]) {
    return {
      tone: 'info' as const,
      label: t('accounts.pt.siteStatus.checking'),
      text: t('accounts.pt.siteStatus.checkingText'),
    }
  }

  if (metadataBySite.value[site.id]) {
    return {
      tone: 'success' as const,
      label: t('accounts.pt.siteStatus.ready'),
      text: t('accounts.pt.siteStatus.readyText', { count: metadataBySite.value[site.id]!.sections.length }),
    }
  }

  if (metadataErrorBySite.value[site.id]) {
    return {
      tone: 'danger' as const,
      label: t('accounts.pt.siteStatus.error'),
      text: metadataErrorBySite.value[site.id]!,
    }
  }

  return {
    tone: 'neutral' as const,
    label: t('accounts.pt.siteStatus.untested'),
    text: t('accounts.pt.siteStatus.untestedText'),
  }
}

function getAdapterLabel(adapter: PtSiteAdapterKind) {
  return adapter === 'unit3d' ? t('accounts.pt.adapter.unit3d') : t('accounts.pt.adapter.nexusphp')
}

function getMetadata(siteId: SiteId) {
  return metadataBySite.value[siteId]
}

onMounted(() => {
  void loadSites()
})
</script>

<template>
  <div class="pt-workspace">
    <section class="pt-overview">
      <article v-for="item in summaryItems" :key="item.label" class="pt-metric">
        <div class="pt-metric__label">{{ item.label }}</div>
        <div class="pt-metric__value">{{ item.value }}</div>
        <StatusChip :tone="item.tone">{{ item.label }}</StatusChip>
      </article>
    </section>

    <section class="pt-toolbar">
      <div class="pt-toolbar__copy">
        <div class="pt-toolbar__title">{{ t('accounts.pt.title') }}</div>
        <div class="pt-toolbar__text">{{ t('accounts.pt.description') }}</div>
      </div>

      <div class="pt-toolbar__actions">
        <el-button plain @click="loadSites">
          <el-icon><RefreshRight /></el-icon>
          <span>{{ t('accounts.actions.refresh') }}</span>
        </el-button>
        <el-button type="primary" plain @click="showCreator = !showCreator">
          <el-icon><CirclePlus /></el-icon>
          <span>{{ showCreator ? t('accounts.pt.actions.hideCreate') : t('accounts.pt.actions.showCreate') }}</span>
        </el-button>
      </div>
    </section>

    <section v-if="showCreator" class="pt-create-card">
      <header class="pt-card__head">
        <div class="pt-card__title-group">
          <div class="pt-card__eyebrow">{{ t('accounts.pt.kind.custom') }}</div>
          <h3 class="pt-card__title">{{ t('accounts.pt.create.title') }}</h3>
        </div>
        <StatusChip tone="info">{{ t('accounts.pt.create.badge') }}</StatusChip>
      </header>

      <p class="pt-card__text">{{ t('accounts.pt.create.description') }}</p>

      <div class="pt-fields">
        <label class="pt-field">
          <span class="pt-field__label">{{ t('accounts.pt.fields.siteName') }}</span>
          <el-input v-model="creator.name" />
        </label>

        <label class="pt-field">
          <span class="pt-field__label">{{ t('accounts.pt.fields.adapter') }}</span>
          <el-select v-model="creator.adapter">
            <el-option value="nexusphp" :label="t('accounts.pt.adapter.nexusphp')" />
            <el-option value="unit3d" :label="t('accounts.pt.adapter.unit3d')" />
          </el-select>
        </label>

        <label class="pt-field pt-field--wide">
          <span class="pt-field__label">{{ t('accounts.pt.fields.siteUrl') }}</span>
          <el-input v-model="creator.baseUrl" :placeholder="t('accounts.pt.fields.siteUrlPlaceholder')" />
        </label>

        <label class="pt-field">
          <span class="pt-field__label">{{ t('accounts.fields.username') }}</span>
          <el-input v-model="creator.username">
            <template #prefix>
              <el-icon><UserFilled /></el-icon>
            </template>
          </el-input>
        </label>

        <label class="pt-field">
          <span class="pt-field__label">{{ t('accounts.fields.password') }}</span>
          <el-input v-model="creator.password" show-password type="password">
            <template #prefix>
              <el-icon><Lock /></el-icon>
            </template>
          </el-input>
        </label>

        <label class="pt-field">
          <span class="pt-field__label">{{ t('accounts.fields.apiToken') }}</span>
          <el-input v-model="creator.apiToken">
            <template #prefix>
              <el-icon><Key /></el-icon>
            </template>
          </el-input>
        </label>

        <div class="pt-switch">
          <span>{{ creator.enabled ? t('accounts.state.enabled') : t('accounts.state.disabled') }}</span>
          <el-switch v-model="creator.enabled" />
        </div>
      </div>

      <footer class="pt-card__actions">
        <el-button type="primary" @click="saveSite()">{{ t('accounts.pt.actions.create') }}</el-button>
      </footer>
    </section>

    <section v-if="!isLoading && !sites.length && !showCreator" class="pt-empty">
      <div class="pt-empty__icon">
        <el-icon><CirclePlus /></el-icon>
      </div>
      <div class="pt-empty__title">{{ t('accounts.pt.empty.title') }}</div>
      <div class="pt-empty__text">{{ t('accounts.pt.empty.description') }}</div>
      <el-button type="primary" @click="showCreator = true">
        {{ t('accounts.pt.empty.action') }}
      </el-button>
    </section>

    <section class="pt-grid" v-loading="isLoading">
      <article v-for="site in sites" :key="site.id" class="pt-card">
        <header class="pt-card__head">
          <div class="pt-card__title-group">
            <div class="pt-card__eyebrow">{{ site.id }}</div>
            <h3 class="pt-card__title">{{ site.name }}</h3>
          </div>

          <div class="pt-card__status">
            <StatusChip tone="info">{{ getAdapterLabel(site.adapter as PtSiteAdapterKind) }}</StatusChip>
            <StatusChip :tone="site.builtIn ? 'neutral' : 'warning'">
              {{ site.builtIn ? t('accounts.pt.kind.builtIn') : t('accounts.pt.kind.custom') }}
            </StatusChip>
            <StatusChip :tone="getAccountStatus(site).tone">
              {{ getAccountStatus(site).label }}
            </StatusChip>
          </div>
        </header>

        <div class="pt-meta">
          <article class="pt-meta__card">
            <div class="pt-meta__label">
              <el-icon><Link /></el-icon>
              <span>{{ t('accounts.pt.fields.siteUrl') }}</span>
            </div>
            <div class="pt-meta__value">{{ getForm(site.id)?.baseUrl || site.baseUrl }}</div>
          </article>

          <article class="pt-meta__card">
            <div class="pt-meta__label">
              <el-icon><Connection /></el-icon>
              <span>{{ t('accounts.pt.fields.siteStatus') }}</span>
            </div>
            <div class="pt-meta__status">
              <StatusChip :tone="getSiteStatus(site).tone">{{ getSiteStatus(site).label }}</StatusChip>
              <span>{{ getSiteStatus(site).text }}</span>
            </div>
          </article>

          <article class="pt-meta__card">
            <div class="pt-meta__label">
              <el-icon><SwitchButton /></el-icon>
              <span>{{ t('accounts.pt.fields.accountStatus') }}</span>
            </div>
            <div class="pt-meta__status">
              <StatusChip :tone="getAccountStatus(site).tone">{{ getAccountStatus(site).label }}</StatusChip>
              <span>{{ getAccountStatus(site).text }}</span>
            </div>
          </article>
        </div>

        <div class="pt-fields">
          <label class="pt-field">
            <span class="pt-field__label">{{ t('accounts.pt.fields.siteName') }}</span>
            <el-input v-model="forms[site.id].name" :disabled="site.builtIn" />
          </label>

          <label class="pt-field">
            <span class="pt-field__label">{{ t('accounts.pt.fields.adapter') }}</span>
            <el-select v-model="forms[site.id].adapter" :disabled="site.builtIn">
              <el-option value="nexusphp" :label="t('accounts.pt.adapter.nexusphp')" />
              <el-option value="unit3d" :label="t('accounts.pt.adapter.unit3d')" />
            </el-select>
          </label>

          <label class="pt-field pt-field--wide">
            <span class="pt-field__label">{{ t('accounts.pt.fields.siteUrl') }}</span>
            <el-input v-model="forms[site.id].baseUrl" :disabled="site.builtIn" />
          </label>

          <label class="pt-field">
            <span class="pt-field__label">{{ t('accounts.fields.username') }}</span>
            <el-input v-model="forms[site.id].username">
              <template #prefix>
                <el-icon><UserFilled /></el-icon>
              </template>
            </el-input>
          </label>

          <label class="pt-field">
            <span class="pt-field__label">{{ t('accounts.fields.password') }}</span>
            <el-input v-model="forms[site.id].password" show-password type="password">
              <template #prefix>
                <el-icon><Lock /></el-icon>
              </template>
            </el-input>
          </label>

          <label v-if="!site.builtIn" class="pt-field">
            <span class="pt-field__label">{{ t('accounts.fields.apiToken') }}</span>
            <el-input v-model="forms[site.id].apiToken">
              <template #prefix>
                <el-icon><Key /></el-icon>
              </template>
            </el-input>
          </label>

          <div class="pt-switch">
            <span>{{ forms[site.id].enabled ? t('accounts.state.enabled') : t('accounts.state.disabled') }}</span>
            <el-switch v-model="forms[site.id].enabled" />
          </div>
        </div>

        <div class="pt-notes">
          <span v-for="note in site.notes" :key="note" class="pt-note">{{ note }}</span>
        </div>

        <div v-if="site.apiBaseUrl || getMetadata(site.id)?.apiBaseUrl" class="pt-api">
          <span class="pt-field__label">{{ t('accounts.pt.fields.apiBase') }}</span>
          <code>{{ getMetadata(site.id)?.apiBaseUrl || site.apiBaseUrl }}</code>
        </div>

        <div v-if="getMetadata(site.id)" class="pt-result">
          <span class="pt-field__label">{{ t('accounts.pt.fields.sections') }}</span>
          <strong>{{ getMetadata(site.id)!.sections.length }}</strong>
        </div>

        <footer class="pt-card__actions">
          <el-button type="primary" plain @click="saveSite(site.id)">
            {{ t('accounts.pt.actions.save') }}
          </el-button>
          <el-button
            type="primary"
            :loading="accountLoadingBySite[site.id]"
            @click="validateAccount(site)"
          >
            {{ t('accounts.pt.actions.checkAccount') }}
          </el-button>
          <el-button
            v-if="site.capabilitySet.metadata.sections"
            plain
            :loading="metadataLoadingBySite[site.id]"
            @click="loadMetadata(site)"
          >
            {{ t('accounts.pt.actions.checkSite') }}
          </el-button>
          <el-button v-if="!site.builtIn" plain type="danger" @click="removeSite(site.id)">
            <el-icon><Delete /></el-icon>
            <span>{{ t('accounts.pt.actions.remove') }}</span>
          </el-button>
        </footer>
      </article>
    </section>
  </div>
</template>

<style scoped>
.pt-workspace {
  display: grid;
  gap: 18px;
  width: 100%;
}

.pt-overview,
.pt-grid,
.pt-meta,
.pt-fields {
  display: grid;
  gap: 14px;
}

.pt-empty {
  display: grid;
  justify-items: start;
  gap: 14px;
  padding: 24px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at top right, rgba(255, 190, 92, 0.12), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.32), transparent 40%),
    var(--bg-panel);
}

.pt-empty__icon {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(230, 156, 28, 0.14);
  color: var(--accent-strong);
  font-size: 20px;
}

.pt-empty__title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.pt-empty__text {
  max-width: 44rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.pt-overview {
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}

.pt-metric,
.pt-toolbar,
.pt-card,
.pt-create-card,
.pt-meta__card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at top right, rgba(255, 190, 92, 0.16), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.44), transparent 38%),
    var(--bg-panel);
}

.pt-metric {
  display: grid;
  gap: 10px;
  padding: 18px;
}

.pt-metric__label,
.pt-field__label,
.pt-card__eyebrow,
.pt-meta__label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.pt-metric__value {
  font-family: var(--font-display);
  font-size: clamp(28px, 4vw, 36px);
  font-weight: 700;
  letter-spacing: -0.05em;
}

.pt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.pt-toolbar__title,
.pt-card__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  letter-spacing: -0.04em;
}

.pt-toolbar__text,
.pt-card__text {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.pt-toolbar__actions,
.pt-card__actions,
.pt-card__status {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pt-grid {
  grid-template-columns: repeat(auto-fit, minmax(23rem, 1fr));
}

.pt-card,
.pt-create-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  box-shadow: var(--shadow-md);
}

.pt-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.pt-card__title-group {
  min-width: 0;
}

.pt-meta {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.pt-meta__card {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.pt-meta__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.pt-meta__value,
.pt-meta__status,
.pt-switch,
.pt-api,
.pt-result {
  display: grid;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.pt-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.pt-field,
.pt-switch {
  display: grid;
  gap: 8px;
}

.pt-field--wide {
  grid-column: span 2;
}

.pt-field :deep(.el-input__wrapper),
.pt-field :deep(.el-select__wrapper) {
  min-height: 44px;
  border-radius: 14px;
  background: var(--field-bg);
  box-shadow: var(--field-shadow);
}

.pt-switch {
  align-content: end;
}

.pt-notes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pt-note {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(12, 24, 45, 0.06);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.pt-api code {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(12, 24, 45, 0.06);
  color: var(--text-primary);
  word-break: break-all;
}

@media (max-width: 980px) {
  .pt-toolbar,
  .pt-card__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .pt-toolbar__actions,
  .pt-card__status,
  .pt-card__actions {
    width: 100%;
  }
}

@media (max-width: 720px) {
  .pt-metric,
  .pt-toolbar,
  .pt-card,
  .pt-create-card {
    padding: 14px;
  }

  .pt-meta__card {
    padding: 12px;
  }

  .pt-fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .pt-field--wide {
    grid-column: span 1;
  }

  .pt-toolbar__actions :deep(.el-button),
  .pt-card__actions :deep(.el-button) {
    flex: 1 1 auto;
  }
}
</style>
