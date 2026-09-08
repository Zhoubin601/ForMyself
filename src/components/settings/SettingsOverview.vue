<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { generalSettingsCategories, openGeneralSettingsCategory, scopeMeta, showGeneralSettingsHome } = toRefs(props.model)
</script>

<template>
    <div v-if="scopeMeta" class="module-settings-intro">
      <span>{{ scopeMeta.icon }}</span>
      <div>
        <strong>{{ scopeMeta.title }}</strong>
        <p>{{ scopeMeta.description }}</p>
      </div>
    </div>

    <section v-if="showGeneralSettingsHome" class="general-settings-home">
      <div class="general-settings-heading">
        <span>按类别管理</span>
        <h2>需要调整什么？</h2>
        <p>设置已按用途整理；进入分类后，返回键会回到这里。</p>
      </div>
      <div class="general-settings-grid">
        <button
          v-for="category in generalSettingsCategories"
          :key="category.id"
          type="button"
          class="general-settings-card"
          @click="openGeneralSettingsCategory(category.id)"
        >
          <span class="general-settings-icon" aria-hidden="true">{{ category.icon }}</span>
          <span class="general-settings-copy">
            <strong>{{ category.title }}</strong>
            <small>{{ category.description }}</small>
          </span>
          <b aria-hidden="true">›</b>
        </button>
      </div>
    </section>
</template>
