<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { addMoodDefinition, addScheduleCategory, addVaultCategory, applySchedulePickerColor, archiveMoodDefinition, beginEditMoodDefinition, deleteMoodDefinition, deleteMoodTag, deleteScheduleCategory, deleteVaultCategory, draggedMoodId, dropMoodDefinition, editMoodColor, editMoodEmoji, editMoodLabel, editingMoodId, isGeneralSection, moodDefinitionUsageCount, moodStore, moveMoodDefinition, newMoodColor, newMoodEmoji, newMoodLabel, newScheduleCategory, newScheduleCategoryColor, newVaultCategory, restoreMoodDefinition, saveMoodDefinition, scheduleColorBoardRef, scheduleColorBoardStyle, scheduleColorCursorStyle, scheduleColorHue, scheduleStore, setDefaultMoodDefinition, settingsScope, updateScheduleColorFromBoard, updateScheduleColorFromHex, vaultCategoryUsageCount, vaultStore } = toRefs(props.model)
</script>

<template>
    <div v-if="['schedule', 'mood', 'passwords'].includes(settingsScope) || isGeneralSection('labels')" class="setting-section">
      <h3 class="caption body-muted section-title">内容标签与分类</h3>

      <div v-if="settingsScope === 'schedule' || isGeneralSection('labels')" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">日程标签</h4>
        <p class="caption body-muted taxonomy-description">仅保留系统标签“学习”。输入名称并从调色盘选择颜色即可；与密码库分类一致，只有没有日程内容的标签才可删除。</p>
        <div class="taxonomy-add-row">
          <input
            v-model="newScheduleCategory"
            class="apple-input"
            maxlength="12"
            placeholder="输入日程标签名称"
            @keyup.enter="addScheduleCategory"
          />
          <button class="button-primary taxonomy-add-button" @click="addScheduleCategory">添加</button>
        </div>
        <div class="schedule-color-picker">
          <div class="schedule-color-picker-heading">
            <span class="body-strong">标签颜色</span>
            <span class="schedule-color-preview" :style="{ background: newScheduleCategoryColor }"></span>
          </div>
          <div
            ref="scheduleColorBoardRef"
            class="schedule-color-board"
            :style="scheduleColorBoardStyle"
            role="slider"
            aria-label="选择标签颜色的饱和度与亮度"
            :aria-valuetext="newScheduleCategoryColor"
            tabindex="0"
            @pointerdown="updateScheduleColorFromBoard"
            @pointermove="event => event.buttons && updateScheduleColorFromBoard(event)"
          >
            <span class="schedule-color-cursor" :style="scheduleColorCursorStyle"></span>
          </div>
          <input
            v-model.number="scheduleColorHue"
            class="schedule-hue-slider"
            :style="{ '--schedule-hue': scheduleColorHue }"
            type="range"
            min="0"
            max="359"
            aria-label="选择标签颜色的色相"
            @input="applySchedulePickerColor"
          />
          <label class="schedule-color-code">
            <span class="caption body-muted">HEX</span>
            <input
              v-model="newScheduleCategoryColor"
              class="apple-input"
              maxlength="7"
              inputmode="text"
              aria-label="标签颜色十六进制值"
              @change="updateScheduleColorFromHex"
              @blur="updateScheduleColorFromHex"
            />
          </label>
        </div>
        <div class="taxonomy-list">
          <div v-for="category in scheduleStore.categories" :key="category.id" class="taxonomy-row">
            <span class="schedule-category-name">
              <i :style="{ background: category.color }"></i>
              {{ category.name }}
            </span>
            <span class="taxonomy-row-meta">
              <span v-if="scheduleStore.categoryUsageCount(category.id)" class="caption body-muted">已使用 {{ scheduleStore.categoryUsageCount(category.id) }} 条</span>
              <span v-else-if="category.builtIn" class="caption body-muted">系统保留</span>
              <button v-else class="text-link danger-text taxonomy-action" @click="deleteScheduleCategory(category)">删除</button>
            </span>
          </div>
        </div>
      </div>

      <div v-if="settingsScope === 'mood' || isGeneralSection('labels')" class="store-utility-card taxonomy-card mood-definition-card">
        <h4 class="body-strong taxonomy-title">心情等级</h4>
        <p class="caption body-muted taxonomy-description">从积极到低落排列。拖动或使用箭头调整顺序；归档不会改写历史记录。</p>
        <div class="mood-definition-add">
          <input v-model="newMoodEmoji" class="apple-input mood-emoji-input" maxlength="12" aria-label="新心情 Emoji" />
          <input v-model="newMoodLabel" class="apple-input" maxlength="12" placeholder="心情名称" @keyup.enter="addMoodDefinition" />
          <input v-model="newMoodColor" class="apple-input mood-color-text" maxlength="7" aria-label="新心情颜色 HEX" />
          <button class="button-primary taxonomy-add-button" @click="addMoodDefinition">添加</button>
        </div>

        <div class="taxonomy-list mood-definition-list">
          <div
            v-for="(definition, index) in moodStore.activeMoodDefinitions"
            :key="definition.id"
            class="taxonomy-row mood-definition-row"
            draggable="true"
            @dragstart="draggedMoodId = definition.id"
            @dragend="draggedMoodId = ''"
            @dragover.prevent
            @drop.prevent="dropMoodDefinition(definition.id)"
          >
            <template v-if="editingMoodId === definition.id">
              <div class="mood-definition-editor">
                <input v-model="editMoodEmoji" class="apple-input mood-emoji-input" maxlength="12" aria-label="编辑心情 Emoji" />
                <input v-model="editMoodLabel" class="apple-input" maxlength="12" aria-label="编辑心情名称" />
                <input v-model="editMoodColor" class="apple-input mood-color-text" maxlength="7" aria-label="编辑心情颜色 HEX" />
                <button class="text-link" @click="saveMoodDefinition">保存</button>
                <button class="text-link" @click="editingMoodId = ''">取消</button>
              </div>
            </template>
            <template v-else>
              <span class="mood-drag-handle" aria-hidden="true">⋮⋮</span>
              <span class="mood-definition-preview">
                <b>{{ definition.emoji }}</b>
                <i :style="{ background: definition.color }"></i>
                <span>{{ definition.label }}</span>
                <small v-if="definition.isDefault">默认</small>
              </span>
              <span class="mood-definition-actions">
                <button class="mood-order-button" :disabled="index === 0" aria-label="上移" @click="moveMoodDefinition(definition.id, -1)">↑</button>
                <button class="mood-order-button" :disabled="index === moodStore.activeMoodDefinitions.length - 1" aria-label="下移" @click="moveMoodDefinition(definition.id, 1)">↓</button>
                <button v-if="!definition.isDefault" class="text-link" @click="setDefaultMoodDefinition(definition)">设默认</button>
                <button class="text-link" @click="beginEditMoodDefinition(definition)">编辑</button>
                <button class="text-link" @click="archiveMoodDefinition(definition)">归档</button>
                <button v-if="!moodDefinitionUsageCount(definition.id)" class="text-link danger-text" @click="deleteMoodDefinition(definition)">删除</button>
              </span>
            </template>
          </div>
        </div>

        <div v-if="moodStore.moodDefinitions.some(item => item.archived)" class="mood-archive-section">
          <p class="caption body-muted">已归档</p>
          <div class="taxonomy-list">
            <div v-for="definition in moodStore.moodDefinitions.filter(item => item.archived)" :key="definition.id" class="taxonomy-row">
              <span class="mood-definition-preview archived">
                <b>{{ definition.emoji }}</b><i :style="{ background: definition.color }"></i><span>{{ definition.label }}</span>
                <small>{{ moodDefinitionUsageCount(definition.id) }} 条历史记录</small>
              </span>
              <span class="mood-definition-actions">
                <button class="text-link" @click="restoreMoodDefinition(definition)">恢复</button>
                <button v-if="!moodDefinitionUsageCount(definition.id)" class="text-link danger-text" @click="deleteMoodDefinition(definition)">删除</button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="settingsScope === 'mood' || isGeneralSection('labels')" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">心情日记自定义标签</h4>
        <p class="caption body-muted taxonomy-description">删除标签时会同时从历史心情记录中移除；内置标签“工作、学习、家庭、睡眠”固定保留。</p>
        <div v-if="moodStore.customTags.length" class="taxonomy-list">
          <div v-for="tag in moodStore.customTags" :key="tag" class="taxonomy-row">
            <span>{{ tag }}</span>
            <button class="text-link danger-text taxonomy-action" @click="deleteMoodTag(tag)">删除</button>
          </div>
        </div>
        <p v-else class="caption body-muted taxonomy-empty">暂无自定义心情标签</p>
      </div>

      <div v-if="settingsScope === 'passwords' || isGeneralSection('labels')" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">密码库分类</h4>
        <p class="caption body-muted taxonomy-description">可在这里统一添加和删除分类。仍被密码记录使用的分类不能删除，“未分类”固定保留。</p>
        <div class="taxonomy-add-row">
          <input
            v-model="newVaultCategory"
            class="apple-input"
            maxlength="20"
            placeholder="输入新分类名称"
            @keyup.enter="addVaultCategory"
          />
          <button class="button-primary taxonomy-add-button" @click="addVaultCategory">添加</button>
        </div>
        <div class="taxonomy-list">
          <div v-for="category in vaultStore.categories" :key="category" class="taxonomy-row">
            <span>{{ category }}</span>
            <span class="taxonomy-row-meta">
              <span v-if="vaultCategoryUsageCount(category)" class="caption body-muted">已使用 {{ vaultCategoryUsageCount(category) }} 条</span>
              <span v-else-if="category === '未分类'" class="caption body-muted">系统保留</span>
              <button
                v-else
                class="text-link danger-text taxonomy-action"
                @click="deleteVaultCategory(category)"
              >删除</button>
            </span>
          </div>
        </div>
      </div>
    </div>
</template>
