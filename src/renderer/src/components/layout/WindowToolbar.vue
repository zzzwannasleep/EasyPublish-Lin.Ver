<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from '../../i18n'

const props = defineProps<{
  currentPath: string
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
const toolbarRef = ref<HTMLElement | null>(null)

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

const showProjectsLink = computed(
  () => props.currentPath.startsWith('/projects/') && props.currentPath !== '/projects',
)

onClickOutside(toolbarRef, () => {
  if (props.activeToolbarMenu) {
    emit('closeToolbarMenu')
  }
})
</script>

<template>
  <div class="window-toolbar">
    <button
      v-if="activeToolbarMenu"
      class="window-toolbar__scrim"
      type="button"
      aria-label="Close toolbar menu"
      @wheel.prevent
      @touchmove.prevent
      @click="$emit('closeToolbarMenu')"
    />

    <header ref="toolbarRef" class="window-toolbar__bar [-webkit-app-region:drag]">
      <div class="window-toolbar__row">
        <div class="window-toolbar__nav [-webkit-app-region:no-drag]">
          <RouterLink class="window-toolbar__brand" to="/">
            {{ t('nav.title') }}
          </RouterLink>
          <RouterLink v-if="showProjectsLink" class="window-toolbar__crumb" to="/projects">
            {{ t('nav.projects.label') }}
          </RouterLink>
        </div>

        <div class="window-toolbar__actions [-webkit-app-region:no-drag]">
          <div class="window-toolbar__toolbar">
            <button
              :class="[
                'soft-pill inline-flex h-9 items-center gap-2 px-3 text-[13px] transition duration-200 hover:border-border-strong hover:text-copy-primary',
                activeToolbarMenu === 'theme' ? 'window-toolbar__toolbar-button is-active' : 'text-copy-secondary',
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
                activeToolbarMenu === 'language' ? 'window-toolbar__toolbar-button is-active' : 'text-copy-secondary',
              ]"
              type="button"
              :title="`${t('common.language')}: ${currentLocaleLabel}`"
              @click="$emit('toggleToolbarMenu', 'language')"
            >
              <el-icon :size="15"><Reading /></el-icon>
              <span>{{ localeBadge }}</span>
            </button>
          </div>

          <div class="window-toolbar__window-controls">
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
        </div>
      </div>

      <div
        v-if="activeToolbarMenu"
        class="window-toolbar__tray [-webkit-app-region:no-drag]"
        @wheel.prevent
        @touchmove.prevent
      >
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
  </div>
</template>

<style scoped>
.window-toolbar {
  position: relative;
  z-index: 40;
}

.window-toolbar__scrim {
  position: fixed;
  inset: 0;
  z-index: 30;
  border: 0;
  padding: 0;
  background: rgba(17, 12, 9, 0.12);
  cursor: default;
}

.window-toolbar__bar {
  position: relative;
  z-index: 40;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 100%),
    color-mix(in srgb, var(--bg-base) 96%, #120d09);
}

.window-toolbar__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
  align-items: start;
}

.window-toolbar__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.window-toolbar__brand,
.window-toolbar__crumb {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: var(--surface-soft-fill);
  color: var(--text-primary);
  text-decoration: none;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.window-toolbar__brand {
  font-family: var(--font-display);
  font-size: 0.95rem;
  letter-spacing: -0.03em;
}

.window-toolbar__crumb {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.window-toolbar__brand:hover,
.window-toolbar__crumb:hover {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.window-toolbar__actions,
.window-toolbar__toolbar,
.window-toolbar__window-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.window-toolbar__toolbar-button.is-active {
  border-color: var(--border-strong);
  background: var(--surface-brand-fill);
  color: var(--text-primary);
}

.window-toolbar__tray {
  position: absolute;
  inset-inline: 14px;
  top: calc(100% + 6px);
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.window-toolbar__tray > * {
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
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.toolbar-panel__palette-name {
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 920px) {
  .window-toolbar__row {
    grid-template-columns: 1fr;
  }

  .window-toolbar__actions,
  .window-toolbar__toolbar,
  .window-toolbar__window-controls,
  .window-toolbar__tray {
    justify-content: flex-start;
  }
}
</style>
