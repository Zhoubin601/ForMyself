<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { isGeneralSection, requestWidgetPin } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('widgets')" class="setting-section">
      <h3 class="caption body-muted section-title">桌面小组件</h3>
      <div class="ios-list">
        <button class="list-item text-link" style="text-align: left;" @click="requestWidgetPin('info')">
          添加 2×2 今日信息组件
        </button>
        <button class="list-item text-link" style="text-align: left;" @click="requestWidgetPin('schedule')">
          添加 2×2 临近日程组件
        </button>
      </div>
      <p class="caption body-muted" style="padding: 10px 16px 0; margin: 0;">若桌面不支持应用内添加，可长按桌面并从“小组件”列表选择 ForMyself。</p>
    </div>
</template>
