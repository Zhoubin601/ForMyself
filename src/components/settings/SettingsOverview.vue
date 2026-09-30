<script setup>
import { toRefs } from 'vue'
import { Sparkles, Bell, ShieldCheck, Tags, HeartPulse, DatabaseBackup, Bot, PanelsTopLeft, Wallet, Scale, Heart, CalendarDays, LockKeyhole, HouseHeart, ChevronRight } from 'lucide-vue-next'
const props = defineProps({ model: { type: Object, required: true } })
const { generalSettingsCategories, openGeneralSettingsCategory, scopeMeta, settingsScope, showGeneralSettingsHome } = toRefs(props.model)
const generalIcons = { appearance: Sparkles, notifications: Bell, security: ShieldCheck, labels: Tags, health: HeartPulse, data: DatabaseBackup, ai: Bot, widgets: PanelsTopLeft }
const moduleIcons = { debts: Wallet, weight: Scale, mood: Heart, schedule: CalendarDays, passwords: LockKeyhole, chat: HouseHeart }
</script>

<template>
    <div v-if="scopeMeta" class="module-settings-intro">
      <span><component :is="moduleIcons[settingsScope]" :size="24" :stroke-width="1.8" aria-hidden="true" /></span>
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
          <span class="general-settings-icon" aria-hidden="true"><component :is="generalIcons[category.id]" :size="21" :stroke-width="1.8" /></span>
          <span class="general-settings-copy">
            <strong>{{ category.title }}</strong>
            <small>{{ category.description }}</small>
          </span>
          <ChevronRight class="settings-card-chevron" :size="18" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </div>
    </section>
</template>
