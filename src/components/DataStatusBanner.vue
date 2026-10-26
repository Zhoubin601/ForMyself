<script setup>
defineProps({ issues: { type: Array, default: () => [] } })
const retry = issue => Promise.resolve().then(issue.retry).catch(() => {})
</script>

<template>
  <div v-for="issue in issues" :key="issue.id" class="data-status-banner" :role="issue.retry ? 'alert' : 'status'">
    <p>{{ issue.title }}：{{ issue.message }}</p>
    <button v-if="issue.retry" type="button" class="button-secondary-pill" @click="retry(issue)">{{ issue.action }}</button>
  </div>
</template>

<style scoped>
.data-status-banner { margin: 12px; padding: 14px; border-radius: 16px; background: #fff1e8; color: #66351b; }
.data-status-banner p { margin: 0 0 8px; }
</style>
