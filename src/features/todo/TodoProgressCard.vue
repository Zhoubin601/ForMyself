<script setup>
import { computed } from 'vue'
import { todoProgress, TODO_ANIMATION_ENABLED } from './todoCore.js'
const props = defineProps({ items: { type: Array, default: () => [] }, label: { type: String, default: '今日待办' }, targetTaskId: {type:String,default:''}, compact: Boolean, disabled: Boolean })
const emit = defineEmits(['complete', 'open', 'edit'])
const progress = computed(() => todoProgress(props.items))
const shown = computed(() => props.compact ? props.items.slice(0, 3) : props.items)
</script>

<template>
  <section class="todo-progress-card" :class="{ animated: TODO_ANIMATION_ENABLED }">
    <div class="todo-fill" :style="{ width: `${progress.ratio * 100}%` }" aria-hidden="true"></div>
    <div class="todo-card-content">
      <header><span>{{ label }}</span><span class="todo-badge">{{ progress.done }} / {{ progress.total }} 已完成</span></header>
      <div class="todo-percent" role="progressbar" :aria-label="label" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100"><strong>{{ progress.percent }}</strong><span>%</span></div>
      <p class="todo-subtitle">{{ !progress.total ? '今天还没有安排，留一点空间给自己' : progress.done === progress.total ? '今天的小计划，全部完成了' : `还有 ${progress.total - progress.done} 件小事，慢慢来` }}</p>
      <div v-for="item in shown" :key="item.key" :data-task-id="item.taskId" class="todo-task-row" :class="{ completed: item.completed, targeted:item.taskId===targetTaskId }">
        <button class="todo-checkbox" :disabled="disabled" :aria-label="`${item.completed ? '撤销完成' : '完成'}${item.title}`" :aria-pressed="item.completed" @click="emit('complete', item)">{{ item.completed ? '✓' : '' }}</button>
        <button class="todo-task-title" @click="compact ? emit('open') : emit('edit', item)"><strong>{{ item.title }}</strong><small v-if="item.note && !compact">{{ item.note }}</small></button>
        <span class="todo-task-time">{{ item.time || '' }}</span>
      </div>
      <button v-if="compact || !progress.total" class="todo-card-open" @click="emit('open')">{{ !progress.total ? '安排一件小事' : '查看全部待办' }} <span>→</span></button>
    </div>
  </section>
</template>

<style scoped>
.todo-progress-card { position:relative; overflow:hidden; isolation:isolate; border-radius:26px; background:#19191f; color:#fff; border:1px solid #ffffff14; box-shadow:0 12px 28px #14282518; }
.todo-fill { position:absolute; inset:0 auto 0 0; background:#315956; border-right:2px solid #72d1bd; z-index:-1; pointer-events:none; }
.animated .todo-fill { transition:width 400ms cubic-bezier(.22,.68,.3,1); }
.todo-card-content { padding:22px; }
header { display:flex; justify-content:space-between; align-items:center; gap:10px; color:#a8bab6; font-size:12px; letter-spacing:.8px; }
.todo-badge { background:#f5faf8; color:#142423; padding:7px 11px; border-radius:20px; font-size:11px; font-weight:700; letter-spacing:0; white-space:nowrap; }
.todo-percent { display:flex; align-items:baseline; gap:5px; margin-top:14px; }
.todo-percent strong { font-size:70px; line-height:1.1; letter-spacing:-3px; }.todo-percent span { font-size:25px; font-weight:700; }
.todo-subtitle { color:#c0cfcc; font-size:12px; margin:9px 0 17px; line-height:1.6; }
.todo-task-row { min-height:56px; display:flex; align-items:center; gap:12px; border-top:1px solid #ffffff14; }
.todo-task-row.targeted { outline:2px solid #72d1bd; outline-offset:3px; border-radius:10px; }
.todo-checkbox { flex:0 0 44px; width:44px; height:44px; border-radius:13px; border:1.5px solid #89aaa780; background:transparent; color:#14332c; font-size:24px; font-weight:700; }
.completed .todo-checkbox { background:#72d1bd; border-color:#72d1bd; }
.todo-task-title { text-align:left; flex:1; min-width:0; background:none; border:0; color:inherit; padding:10px 0; }.todo-task-title strong { display:block; font-size:14px; overflow-wrap:anywhere; }.todo-task-title small { display:block; font-size:11px; color:#b9c7c3; margin-top:5px; white-space:pre-wrap; }
.completed .todo-task-title strong { text-decoration:line-through; opacity:.5; }.todo-task-time { color:#b0bbb8; font-size:12px; white-space:nowrap; }
.todo-card-open { display:flex; align-items:center; justify-content:space-between; margin-top:12px; min-height:44px; width:100%; color:#a7e7d7; background:none; border:0; text-align:left; }
@media (prefers-reduced-motion:reduce) { .animated .todo-fill { transition:none; } }
</style>
