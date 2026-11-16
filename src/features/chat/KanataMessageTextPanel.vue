<script setup>
import {nextTick,ref,watch} from 'vue'
const props=defineProps({text:{type:Object,required:true}})
const emit=defineEmits(['close'])
const heading=ref(null)
watch(()=>[props.text.detail.value?.id,props.text.detail.value?.field,props.text.detail.value?.start.offset,
  props.text.detailBusy.value],async()=>{
  if(!props.text.detail.value||props.text.detailBusy.value)return
  await nextTick();heading.value?.focus({preventScroll:true})
},{flush:'post'})
</script>

<template>
  <section v-if="text.detail.value" class="kanata-panel" aria-label="消息分段阅读">
    <header class="kanata-section-heading">
      <h4 ref="heading" tabindex="-1">{{ text.detail.value.field==='content'?'消息正文':'发送时名称' }}</h4>
      <button type="button" @click="emit('close')">关闭分段阅读</button>
    </header>
    <p class="kanata-help">正在分段阅读原文，可逐段查看或回到开头。</p>
    <p v-if="text.detailBusy.value" role="status">正在读取这一段…</p>
    <p v-else-if="text.detailError.value" class="kanata-error" role="alert">这一段未能读取。原文可能已变化，请重试或关闭后重新打开。</p>
    <p v-else class="kanata-text">{{ text.detail.value.fragment }}</p>
    <div class="kanata-actions">
      <button v-if="text.detailError.value" type="button" :disabled="text.detailBusy.value" @click="text.retryText()">重试这一段</button>
      <button type="button" :disabled="text.detailBusy.value||!text.detail.value.next" @click="text.nextText()">下一段</button>
      <button type="button" :disabled="text.detailBusy.value||text.detail.value.start.offset===0" @click="text.restartText()">从头阅读</button>
    </div>
  </section>
</template>
