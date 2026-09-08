<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { activateCustomTheme, applyThemePickerColor, bgInputRef, clearBg, handleBgUpload, isGeneralSection, selectThemePreset, settingsStore, themeColorBoardRef, themeColorBoardStyle, themeColorCursorStyle, themeColorHue, themePresets, triggerBgUpload, updateThemeColorFromBoard, updateThemeColorFromHex } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('appearance')" class="setting-section">
      <h3 class="caption body-muted section-title">外观与主题</h3>
      <div class="store-utility-card theme-settings-card">
        <div class="theme-heading">
          <div>
            <strong class="body-strong">治愈主题色</strong>
            <p class="caption body-muted">主题会同步应用到按钮、卡片、柔光和强调信息。</p>
          </div>
          <span class="theme-live-swatch" aria-hidden="true"></span>
        </div>

        <div class="theme-preset-grid" aria-label="选择主题预设">
          <button
            v-for="preset in themePresets"
            :key="preset.id"
            class="theme-preset"
            :class="{ active: settingsStore.themeSettings.mode === 'preset' && settingsStore.themeSettings.presetId === preset.id }"
            @click="selectThemePreset(preset.id)"
          >
            <span class="theme-preset-color" :style="{ background: preset.primary }"></span>
            <span>{{ preset.name }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 12.5 3 3 6-7" /></svg>
          </button>
          <button
            class="theme-preset theme-custom-trigger"
            :class="{ active: settingsStore.themeSettings.mode === 'custom' }"
            @click="activateCustomTheme"
          >
            <span class="theme-preset-color custom-color-preview"></span>
            <span>自定义</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 12.5 3 3 6-7" /></svg>
          </button>
        </div>

        <div v-if="settingsStore.themeSettings.mode === 'custom'" class="theme-color-picker">
          <div
            ref="themeColorBoardRef"
            class="theme-color-board"
            :style="themeColorBoardStyle"
            @pointerdown="updateThemeColorFromBoard"
            @pointermove.prevent="event => event.buttons && updateThemeColorFromBoard(event)"
          >
            <span class="theme-color-cursor" :style="themeColorCursorStyle"></span>
          </div>
          <input
            v-model.number="themeColorHue"
            class="theme-hue-slider"
            type="range"
            min="0"
            max="359"
            aria-label="主题颜色色相"
            @input="applyThemePickerColor"
          />
          <label class="theme-hex-field">
            <span>HEX</span>
            <input
              :value="settingsStore.themeSettings.customPrimary"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
              @change="updateThemeColorFromHex"
            />
          </label>
        </div>
      </div>

      <h3 class="caption body-muted section-title theme-background-title">环境背景</h3>
      <div class="ios-list">
        <button class="list-item text-link" style="text-align: left;" @click="triggerBgUpload">更换环境背景图片</button>
        <input type="file" accept="image/*" ref="bgInputRef" style="display: none" @change="handleBgUpload" />
        <button v-if="settingsStore.customBg" class="list-item text-link destructive" style="text-align: left;" @click="clearBg">重置回出厂设定背景</button>
      </div>
    </div>
</template>
