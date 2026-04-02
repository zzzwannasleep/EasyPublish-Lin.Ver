<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useI18n } from '../../i18n'

const props = defineProps<{
  title: string
  subtitle: string
  dark: boolean
  activeToolbarMenu: 'proxy' | 'theme' | 'language' | null
  themePalette: string
  themePaletteOptions: readonly { value: string; label: string; swatches: readonly string[] }[]
  locale: string
  localeOptions: readonly { value: string; label: string }[]
}>()

const emit = defineEmits<{
  minimize: []
  maximize: []
  close: []
  toggleToolbarMenu: [menu: 'proxy' | 'theme' | 'language']
  closeToolbarMenu: []
  setThemeMode: [mode: 'light' | 'dark']
  selectThemePalette: [palette: string]
  changeLocale: [locale: string]
}>()

const { t } = useI18n()
const topbarRef = ref<HTMLElement | null>(null)

const currentLocaleLabel = computed(
  () => props.localeOptions.find(option => option.value === props.locale)?.label ?? props.locale,
)

const localeBadge = computed(() => {
  const currentOption = props.localeOptions.find(option => option.value === props.locale)
  if (!currentOption) {
    return props.locale
  }

  if (currentOption.label.length <= 5) {
    return currentOption.label
  }

  return currentOption.value
})

onClickOutside(topbarRef, () => {
  if (props.activeToolbarMenu) {
    emit('closeToolbarMenu')
  }
})
</script>

<template>
  <header ref="topbarRef" class="topbar [-webkit-app-region:drag]">
    <div class="topbar__row">
      <div class="topbar__title-wrap">
        <h1 class="topbar__title">{{ title }}</h1>
      </div>

      <div class="topbar__actions [-webkit-app-region:no-drag]">
        <div class="topbar__window-controls">
          <button
            class="soft-pill inline-flex h-8 w-8 items-center justify-center text-copy-secondary transition duration-200 hover:border-border-strong hover:text-copy-primary"
            type="button"
            @click="$emit('minimize')"
          >
            <el-icon><Minus /></el-icon>
          </button>
          <button
            class="soft-pill inline-flex h-8 w-8 items-center justify-center text-copy-secondary transition duration-200 hover:border-border-strong hover:text-copy-primary"
            type="button"
            @click="$emit('maximize')"
          >
            <el-icon><FullScreen /></el-icon>
          </button>
          <button
            class="soft-pill inline-flex h-8 w-8 items-center justify-center text-copy-secondary transition duration-200 hover:border-border-strong hover:bg-danger-soft hover:text-danger"
            type="button"
            @click="$emit('close')"
          >
            <el-icon><CloseBold /></el-icon>
          </button>
        </div>

        <div class="topbar__toolbar">
          <button
            :class="[
              'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
              activeToolbarMenu === 'theme' ? 'topbar__toolbar-button is-active' : 'text-copy-secondary',
            ]"
            type="button"
            @click="$emit('toggleToolbarMenu', 'theme')"
          >
            <el-icon :size="15"><Brush /></el-icon>
            <span>{{ t('common.theme.label') }}</span>
          </button>

          <slot name="utility" />

          <button
            :class="[
              'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
              activeToolbarMenu === 'language' ? 'topbar__toolbar-button is-active' : 'text-copy-secondary',
            ]"
            type="button"
            :title="`${t('common.language')}: ${currentLocaleLabel}`"
            @click="$emit('toggleToolbarMenu', 'language')"
          >
            <el-icon :size="15"><Reading /></el-icon>
            <span>{{ localeBadge }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="activeToolbarMenu" class="topbar__tray [-webkit-app-region:no-drag]">
      <div v-if="activeToolbarMenu === 'theme'" class="toolbar-panel">
        <section class="toolbar-panel__section">
          <div class="toolbar-panel__label">{{ t('common.theme.mode') }}</div>
          <div class="toolbar-panel__mode-grid">
            <button
              :class="['toolbar-panel__choice', !dark ? 'is-active' : '']"
              type="button"
              @click="$emit('setThemeMode', 'light')"
            >
              <el-icon><Sunny /></el-icon>
              <span>{{ t('common.theme.light') }}</span>
            </button>
            <button
              :class="['toolbar-panel__choice', dark ? 'is-active' : '']"
              type="button"
              @click="$emit('setThemeMode', 'dark')"
            >
              <el-icon><Moon /></el-icon>
              <span>{{ t('common.theme.dark') }}</span>
            </button>
          </div>
        </section>

        <section class="toolbar-panel__section">
          <div class="toolbar-panel__label">{{ t('common.theme.palette') }}</div>
          <div class="toolbar-panel__palette-grid">
            <button
              v-for="option in themePaletteOptions"
              :key="option.value"
              :class="['toolbar-panel__palette', themePalette === option.value ? 'is-active' : '']"
              type="button"
              @click="$emit('selectThemePalette', option.value)"
            >
              <span class="toolbar-panel__swatches">
                <span
                  v-for="swatch in option.swatches"
                  :key="swatch"
                  class="toolbar-panel__swatch"
                  :style="{ background: swatch }"
                />
              </span>
              <span class="toolbar-panel__palette-name">{{ option.label }}</span>
            </button>
          </div>
        </section>
      </div>

      <div v-else-if="activeToolbarMenu === 'language'" class="toolbar-panel toolbar-panel--narrow">
        <section class="toolbar-panel__section">
          <div class="toolbar-panel__label">{{ t('common.language') }}</div>
          <div class="toolbar-panel__list">
            <button
              v-for="option in localeOptions"
              :key="option.value"
              :class="[
                'toolbar-panel__choice toolbar-panel__choice--wide',
                option.value === locale ? 'is-active' : '',
              ]"
              type="button"
              @click="$emit('changeLocale', option.value)"
            >
              <span>{{ option.label }}</span>
              <el-icon v-if="option.value === locale"><Check /></el-icon>
            </button>
          </div>
        </section>
      </div>

      <div v-else class="toolbar-panel toolbar-panel--proxy">
        <slot name="utility-panel" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: relative;
  z-index: 240;
  isolation: isolate;
  display: grid;
  gap: 10px;
  padding: 10px 14px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.topbar__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
}

.topbar__title-wrap {
  min-width: 0;
  align-self: center;
}

.topbar__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.15rem, 1.35vw, 1.45rem);
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.topbar__actions {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.topbar__window-controls,
.topbar__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.topbar__toolbar-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.topbar__tray {
  position: absolute;
  inset-inline: 14px;
  top: calc(100% + 6px);
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.topbar__tray > * {
  pointer-events: auto;
}

.toolbar-panel {
  width: min(100%, 420px);
  padding: 14px;
  border: 1px solid var(--border-soft);
  border-radius: 0.85rem;
  background: var(--bg-panel);
  box-shadow: var(--shadow-md);
}

.toolbar-panel--narrow {
  width: min(100%, 240px);
}

.toolbar-panel--proxy {
  width: min(100%, 340px);
}

.toolbar-panel,
.toolbar-panel__section,
.toolbar-panel__mode-grid,
.toolbar-panel__palette-grid,
.toolbar-panel__list {
  display: grid;
  gap: 8px;
}

.toolbar-panel__label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.toolbar-panel__mode-grid,
.toolbar-panel__palette-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.toolbar-panel__choice,
.toolbar-panel__palette {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--surface-soft-fill);
  color: var(--text-secondary);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.toolbar-panel__choice--wide,
.toolbar-panel__palette {
  justify-content: space-between;
}

.toolbar-panel__choice:hover,
.toolbar-panel__palette:hover,
.toolbar-panel__choice.is-active,
.toolbar-panel__palette.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  box-shadow: var(--shadow-sm);
  color: var(--text-primary);
}

.toolbar-panel__swatches {
  display: inline-flex;
  gap: 6px;
}

.toolbar-panel__swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}

.toolbar-panel__palette-name {
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 860px) {
  .topbar__row {
    grid-template-columns: 1fr;
  }

  .topbar__actions {
    justify-items: stretch;
  }

  .topbar__window-controls,
  .topbar__toolbar,
  .topbar__tray {
    justify-content: flex-start;
  }

  .toolbar-panel {
    width: 100%;
  }
}
</style>
