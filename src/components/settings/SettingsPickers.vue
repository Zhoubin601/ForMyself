<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { autoLockOptions, autoLockPickerOpen, backupPickerOpen, backupTypeOptions, exportDataType, settingsStore } = toRefs(props.model)
</script>

<template>
    <Teleport to="body">
      <div v-if="autoLockPickerOpen" class="settings-picker-mask" @click="autoLockPickerOpen = false">
        <div class="settings-picker" @click.stop>
          <div class="settings-picker-handle"></div>
          <header>
            <strong>进入后台后自动锁定</strong>
            <button @click="autoLockPickerOpen = false">取消</button>
          </header>
          <button
            v-for="option in autoLockOptions"
            :key="option.value"
            :class="{ selected: settingsStore.autoLockDelaySeconds === option.value }"
            @click="settingsStore.autoLockDelaySeconds = option.value; autoLockPickerOpen = false"
          >
            <span>{{ option.label }}</span><b>✓</b>
          </button>
        </div>
      </div>
      <div v-if="backupPickerOpen" class="settings-picker-mask" @click="backupPickerOpen = false">
        <div class="settings-picker" @click.stop>
          <div class="settings-picker-handle"></div>
          <header>
            <strong>选择备份数据</strong>
            <button @click="backupPickerOpen = false">取消</button>
          </header>
          <button
            v-for="option in backupTypeOptions"
            :key="option.value"
            :class="{ selected: exportDataType === option.value }"
            @click="exportDataType = option.value; backupPickerOpen = false"
          >
            <span>{{ option.label }}</span><b>✓</b>
          </button>
        </div>
      </div>
    </Teleport>
</template>
