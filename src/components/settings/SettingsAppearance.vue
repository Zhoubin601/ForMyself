<script setup>
import { toRefs } from 'vue'
import BackgroundCropper from '../BackgroundCropper.vue'
const props = defineProps({ model: { type: Object, required: true } })
const { pendingBackground, isSavingBackground, cancelBackgroundCrop, confirmBackgroundCrop } = toRefs(props.model)
const { updateComponentTransparency, saveComponentTransparency, resetComponentTransparency } = toRefs(props.model)
const { backgroundScope, backgroundEffect, backgroundPreviewEffect, isUploadingBackground, isSavingWarmHome, updateBackgroundEffect, saveBackgroundEffects, resetBackgroundEffects, toggleWarmHome } = toRefs(props.model)
const { activateCustomTheme, applyThemePickerColor, bgInputRef, clearBg, handleBgUpload, isGeneralSection, selectThemePreset, settingsStore, themeColorBoardRef, themeColorBoardStyle, themeColorCursorStyle, themeColorHue, themePresets, triggerBgUpload, updateThemeColorFromBoard, updateThemeColorFromHex } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('appearance')" class="setting-section">
      <h3 class="caption body-muted section-title">温馨小家</h3>
      <div class="store-utility-card warm-home-setting">
        <div class="warm-home-toggle-row">
          <div class="warm-home-toggle-copy">
            <strong class="body-strong">开启温馨小家</strong>
            <p class="caption body-muted">关闭后暂停聊天及消息通知，保留聊天记录和记忆。首页鼓励语继续显示。</p>
          </div>
          <label class="switch-control">
            <input type="checkbox" :checked="settingsStore.warmHomeEnabled" :disabled="isSavingWarmHome" aria-label="开启温馨小家" @change="toggleWarmHome" />
            <span></span>
          </label>
        </div>
        <button v-if="settingsStore.warmHomeEnabled" type="button" class="list-item text-link" @click="settingsStore.openModuleSettings('chat')">管理陪伴档案与聊天设置</button>
      </div>
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

      <h3 class="caption body-muted section-title theme-background-title">组件透明度</h3>
      <div class="store-utility-card component-transparency-card">
        <p id="component-transparency-help" class="caption body-muted">统一调整首页和其他页面的卡片、列表与导航底色，拖动即可预览。数值越高，壁纸越明显。</p>
        <div class="background-effect-controls">
          <label for="component-transparency"><span>组件透明度</span><output for="component-transparency">{{ settingsStore.componentTransparency }}%</output></label>
          <input id="component-transparency" type="range" min="0" max="100" step="1" :value="settingsStore.componentTransparency" :aria-valuetext="`透明度 ${settingsStore.componentTransparency}%`" aria-describedby="component-transparency-help" @input="updateComponentTransparency($event.target.value)" @change="saveComponentTransparency" />
          <div class="background-range-hints"><span>不透明</span><span>全透明</span></div>
          <button type="button" class="background-reset-effect text-link" @click="resetComponentTransparency">恢复默认透明度</button>
        </div>
      </div>

      <h3 class="caption body-muted section-title theme-background-title">环境背景</h3>
      <div class="store-utility-card background-settings-card">
        <p class="caption body-muted background-settings-note">共用一张背景图片，解锁页和其他页面分别调整效果。</p>
        <div class="background-scope-picker" role="group" aria-label="选择背景效果适用页面">
          <button type="button" :aria-pressed="backgroundScope === 'lock'" @click="backgroundScope = 'lock'">解锁页</button>
          <button type="button" :aria-pressed="backgroundScope === 'pages'" @click="backgroundScope = 'pages'">其他页面</button>
        </div>
        <div class="background-preview" :style="settingsStore.customBg ? { backgroundImage: `url(${settingsStore.customBg})` } : {}" :aria-label="`${backgroundScope === 'lock' ? '解锁页' : '其他页面'}背景效果预览`" role="img">
          <div v-if="settingsStore.customBg" class="background-preview-filter" :style="backgroundPreviewEffect"></div>
          <span class="background-preview-caption">{{ settingsStore.customBg ? (backgroundScope === 'lock' ? '解锁页效果' : '其他页面效果') : '选择图片后预览背景效果' }}</span>
        </div>
        <fieldset class="background-effect-controls" :disabled="!settingsStore.customBg">
          <label for="background-blur"><span>模糊程度</span><output>{{ backgroundEffect.blur }}%</output></label>
          <input id="background-blur" type="range" min="0" max="100" step="1" :value="backgroundEffect.blur" :aria-valuetext="`${backgroundEffect.blur}%`" @input="updateBackgroundEffect('blur', $event.target.value)" @change="saveBackgroundEffects" />
          <div class="background-range-hints"><span>清晰</span><span>朦胧</span></div>
          <label for="background-fade"><span>背景淡化</span><output>{{ backgroundEffect.fade }}%</output></label>
          <input id="background-fade" type="range" min="0" max="100" step="1" :value="backgroundEffect.fade" :aria-valuetext="`${backgroundEffect.fade}%`" @input="updateBackgroundEffect('fade', $event.target.value)" @change="saveBackgroundEffects" />
          <div class="background-range-hints"><span>原图</span><span>淡化</span></div>
          <button type="button" class="background-reset-effect text-link" @click="resetBackgroundEffects">恢复当前页面的默认效果</button>
        </fieldset>
        <button class="list-item text-link" style="text-align: left;" :disabled="isUploadingBackground" @click="triggerBgUpload">{{ isUploadingBackground ? '正在处理图片…' : '更换环境背景图片' }}</button>
        <input ref="bgInputRef" type="file" accept="image/*" style="display: none" @change="handleBgUpload" />
        <button v-if="settingsStore.customBg" class="list-item text-link destructive" style="text-align: left;" @click="clearBg">恢复默认背景</button>
      </div>
      <BackgroundCropper v-if="pendingBackground" :source="pendingBackground" :saving="isSavingBackground" @cancel="cancelBackgroundCrop" @confirm="confirmBackgroundCrop" />
    </div>
</template>
