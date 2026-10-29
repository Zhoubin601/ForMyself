<script setup>
import {useKanataLifeCompanion} from '../composables/useKanataLifeCompanion.js'
const props=defineProps({moduleId:{type:String,required:true}})
const companion=useKanataLifeCompanion(/** @type {import('../features/chat/domain/kanataTypes').LifeModule} */(props.moduleId))
const prompts={home:'结合已授权资料，给今天一个简短、有本人风格的陪伴回应。',mood:'回应我近期已授权的心情记录，先理解感受，不给诊断。',weight:'温和回应已授权的体重记录，不评价身材，不给医疗结论。',savings:'回应已授权的省钱计划，尊重实际进度，不编造金额。',schedule:'根据已授权日程做简短提醒与鼓励，不声称已经完成现实动作。',todo:'根据已授权待办给出简短建议与鼓励，不擅自替我完成任务。',reports:'根据已授权资料概括近况，历史不足就说明未知，不推断长期趋势。'}
</script>
<template>
  <section class="kanata-life-companion" aria-label="所选角色的生活回应"><button type="button" :disabled="companion.busy.value" @click="companion.request(prompts[moduleId],true)">{{ companion.busy.value?'角色正在回应…':'让所选角色回应' }}</button><p v-if="companion.error.value" role="status">{{ companion.error.value }}</p><div v-if="companion.text.value"><strong>{{ companion.speaker.value }}</strong><p>{{ companion.text.value }}</p></div><button v-if="companion.busy.value" type="button" @click="companion.cancel">停止回应</button></section>
</template>
<style scoped>
.kanata-life-companion{margin:1rem 0;padding:1rem;border:1px solid var(--theme-border);border-radius:var(--radius-card);color:var(--ink);background:var(--component-panel);overflow-wrap:anywhere}.kanata-life-companion button{min-height:48px;min-width:48px;padding:.65rem 1rem;font:inherit;color:var(--theme-primary-strong);border:1px solid var(--theme-border);border-radius:var(--radius-input);background:var(--theme-primary-soft)}.kanata-life-companion p{white-space:pre-wrap;line-height:1.7}.kanata-life-companion button:focus-visible{outline:3px solid var(--theme-primary);outline-offset:3px}
</style>
