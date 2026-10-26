<script setup>
import { toRefs } from 'vue'
const props = defineProps({ currentTime: { type: Date, required: true }, nextSchedule: { type: Object, default: null }, nextScheduleDateLabel: { type: String, required: true }, todaySchedules: { type: Array, required: true } })
const { currentTime, nextSchedule, nextScheduleDateLabel, todaySchedules } = toRefs(props)
defineEmits(["open"])

</script>

<template>
    <button class="schedule-home-card dashboard-card" @click="$emit('open')">
      <div class="schedule-date-tile">
        <strong>{{ currentTime.getDate() }}</strong>
        <span>{{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][currentTime.getDay()] }}</span>
      </div>
      <div class="schedule-home-copy">
        <span class="section-kicker">今日日程</span>
        <h2>{{ nextSchedule ? nextSchedule.title : '今日暂无日程' }}</h2>
        <p>{{ nextScheduleDateLabel }}</p>
      </div>
      <div class="schedule-count">
        <strong>{{ todaySchedules.length }}</strong>
        <span>剩余</span>
      </div>
    </button>
</template>
