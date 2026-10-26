<script setup>
import { toRefs } from 'vue'
const props = defineProps({ todayRecordCount: { type: Number, required: true }, todayTasks: { type: Array, required: true } })
const { todayRecordCount, todayTasks } = toRefs(props)
defineEmits(["open"])

</script>

<template>
    <section class="dashboard-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">今日</span>
          <h2>今日记录</h2>
        </div>
        <span class="section-summary">{{ todayRecordCount }}/3 有动态</span>
      </div>

      <div class="today-grid">
        <button
          v-for="task in todayTasks"
          :key="task.key"
          class="today-action"
          :class="{ completed: task.done }"
          @click="$emit('open', task.view)"
        >
          <span class="today-icon">{{ task.icon }}</span>
          <span class="today-label">{{ task.label }}</span>
          <span class="today-detail">{{ task.detail }}</span>
          <span class="today-state">{{ task.done ? '已记录' : '去记录' }} <b>›</b></span>
        </button>
      </div>
    </section>
</template>
