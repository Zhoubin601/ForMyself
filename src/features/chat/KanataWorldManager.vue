<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DataStatusBanner from '../../components/DataStatusBanner.vue'
import { appChoose, appConfirm, appPrompt, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
import { restoreState } from '../../platform/storage/restoreState.js'
import { createKanataManagement } from '../../application/kanataManagement.js'
import { resolveKanataCharacter } from './domain/kanataManagementCore.js'
import { previewKanataCardLore } from './lorebook/kanataLorebook.js'
import { builtinKanataPresets } from './presets/presetCatalog.js'
import { useKanataStore } from './kanataStore.js'
import KanataCardLibrary from './cards/KanataCardLibrary.vue'
import KanataLorebookPanel from './lorebook/KanataLorebookPanel.vue'

const store = useKanataStore(), management = createKanataManagement()
const data = computed(() => store.snapshot), section = ref('world'), selectedWorldId = ref(''), notice = ref(''), error = ref(''), busy = ref(false)
const identityDraft = ref(null), instanceDraft = ref(null)
const dialogOwner = Symbol('kanata-management-dialog')
let mounted = true, confirming = false
const worlds = computed(() => data.value?.worlds || [])
const world = computed(() => worlds.value.find(w => w.id === selectedWorldId.value))
watch(() => worlds.value.map(w => w.id).join('|'), () => {
  if (!world.value) selectedWorldId.value = worlds.value.find(w => !w.archived)?.id || worlds.value[0]?.id || ''
}, { immediate: true })
watch(selectedWorldId, () => { identityDraft.value = null; instanceDraft.value = null; error.value = ''; notice.value = '' })
const instances = computed(() => data.value?.instances.filter(i => i.worldId === world.value?.id) || [])
const conversations = computed(() => data.value?.conversations.filter(c => c.worldId === world.value?.id && c.type !== 'character') || [])
const identity = computed(() => data.value?.identities.find(i => i.worldId === world.value?.id))
const blocked = computed(() => restoreState.blocked || !store.isDataLoaded || Boolean(store.saveError) || store.hasPendingSave)
const worldBlocked = computed(() => blocked.value || Boolean(world.value?.archived))
const issues = computed(() => [
  ...(store.saveError ? [{id:'save',title:'更改尚未安全保存',message:'最新资料和待写数据已保留，请先重试保存。',action:'重试保存',retry:management.retrySave}] : []),
  ...(restoreState.blocked ? [{id:'restore',title:'恢复尚未完成',message:'请通过应用恢复流程处理，当前禁止修改。'}] : [])
])
const definition = id => resolveKanataCharacter(data.value, id)
const ask = async action => { confirming = true; try { return await action() } finally { confirming = false } }
const perform = async (action, message) => {
  if (busy.value || blocked.value) return false
  busy.value = true; error.value = ''
  try { await action(); if (mounted) notice.value = message; return true }
  catch { if (mounted) error.value = '这次更改未完成。请核对输入，或通过上方提示重试保存；已有资料会保留。'; return false }
  finally { if (mounted) busy.value = false }
}
const chooseWorld = async () => {
  const id = await ask(() => appChoose({ sensitive: true, owner: dialogOwner,title:'选择世界',message:'每个世界的实例、聊天与记忆独立。',options:worlds.value.map(w=>({value:w.id,label:w.name+(w.archived?' · 已归档':'')}))}))
  if (mounted && id) selectedWorldId.value = id
}
const createWorld = async () => {
  const name = await ask(() => appPrompt('为新世界起一个名字（最多 200 字）。', '', {sensitive:true,owner:dialogOwner,title:'创建空白世界',confirmText:'创建世界'}))
  if (!mounted || name === null) return
  if (!name.trim() || name.length > 200) { error.value = '世界名称需要填写，且不超过 200 字。'; return }
  const before = new Set(worlds.value.map(w=>w.id))
  if (await perform(() => management.createWorld({name,rules:'',displayName:'旅人',background:''}), '空白世界已创建；你可以从全局库加入角色。') && mounted) selectedWorldId.value = worlds.value.find(w=>!before.has(w.id))?.id || selectedWorldId.value
}
const addPreset = async () => {
  const presetId = await ask(() => appChoose({ sensitive: true, owner: dialogOwner,title:'选择世界预设',options:builtinKanataPresets.map(p=>({value:p.id,label:`${p.name} · ${p.characterCount} 位角色`}))}))
  const preset = builtinKanataPresets.find(p=>p.id===presetId)
  if (!mounted || !preset) return
  const accepted = await ask(() => appConfirm(`创建「${preset.name}」，建立 ${preset.characterCount} 个独立角色实例及各自的私聊与共同群聊。不会复制其他世界的经历或现实授权。`, {sensitive:true,owner:dialogOwner,title:'从预设创建世界',confirmText:'创建独立世界'}))
  if (!mounted || accepted !== true) return
  const before = new Set(worlds.value.map(w=>w.id))
  if (await perform(()=>management.createPresetWorld(preset.id), '新的预设世界已建立。') && mounted) selectedWorldId.value = worlds.value.find(w=>!before.has(w.id))?.id || selectedWorldId.value
}
const rename = async () => {
  const target = world.value
  const name = await ask(() => appPrompt('世界名称（最多 200 字）', target.name, {sensitive:true,owner:dialogOwner,title:'重命名世界'}))
  if (!mounted || name === null) return
  if (!name.trim() || name.length > 200) { error.value = '世界名称需要填写，且不超过 200 字。'; return }
  await perform(() => management.renameWorld(target.id,name),'世界已重命名。')
}
const copyWorld = async () => {
  const target = world.value
  const name = await ask(() => appPrompt('只复制成员、静态设定和初始组织关系；不复制聊天、记忆、事件、情绪或现实授权。', target.name+' · 新篇', {sensitive:true,owner:dialogOwner,title:'复制世界设定',confirmText:'复制为新世界'}))
  if (!mounted || name === null) return
  if (!name.trim() || name.length > 200) { error.value = '请填写不超过 200 字的新世界名称。'; return }
  const before = new Set(worlds.value.map(w=>w.id))
  if (await perform(() => management.copyWorld(target.id,name),'设定已复制，新世界没有历史经历。') && mounted) selectedWorldId.value = worlds.value.find(w=>!before.has(w.id))?.id || selectedWorldId.value
}
const archive = async () => {
  const target = world.value
  const accepted = await ask(() => appConfirm(target.archived ? '取消归档不会自动开启自主生成、主动联系或通知。' : '归档会暂停自动活动，保留全部角色、聊天和经历；可以随时取消归档。', {sensitive:true,owner:dialogOwner,title:target.archived?'取消归档世界':'归档世界',confirmText:target.archived?'取消归档':'归档并保留资料'}))
  if (mounted && accepted === true) await perform(() => management.archiveWorld(target.id,!target.archived),target.archived?'世界已取消归档。':'世界已归档，资料已保留。')
}
const addCharacter = async () => {
  const worldId = world.value.id
  const cardId = await ask(() => appChoose({ sensitive: true, owner: dialogOwner,title:'从全局角色库加入',message:'建立新的独立实例，不共享其他世界经历。',options:data.value.cards.filter(c=>!c.archived).map(c=>({value:c.id,label:data.value.cardVersions.find(v=>v.id===c.currentVersionId)?.definition.name||'角色'}))}))
  if (mounted && cardId) await perform(() => management.addCharacter(worldId,cardId),'角色实例与独立私聊已建立。')
}
const editIdentity = () => { identityDraft.value = {displayName:identity.value.displayName,background:identity.value.background} }
const saveIdentity = async () => {
  const target = world.value.id
  if (!identityDraft.value?.displayName.trim()) { error.value='请填写本世界中的称谓。'; return }
  if (await perform(() => management.updateIdentity(target,identityDraft.value),'这个世界中的用户身份已更新，其他世界保持原样。') && mounted) identityDraft.value=null
}
const editInstance = instance => {
  const d=definition(instance.id)
  instanceDraft.value={id:instance.id,name:d.name,summary:d.summary,speechStyle:d.speechStyle,original:{name:d.name,summary:d.summary,speechStyle:d.speechStyle}}
}
const saveInstance = async () => {
  const draft=instanceDraft.value,instance=data.value.instances.find(i=>i.id===draft.id)
  if (!draft.name.trim()||!draft.summary.trim()||!draft.speechStyle.trim()) {error.value='称呼、人物概要和说话习惯需要填写。';return}
  const overrides={...instance.overrides}
  for(const key of ['name','summary','speechStyle']) if(draft[key]!==draft.original[key]) overrides[key]=draft[key]
  if (await perform(() => management.updateCharacter(draft.id,overrides),'仅这个世界实例的设定已更新。') && mounted) instanceDraft.value=null
}
const attachLore = async instance => {
  const entries=previewKanataCardLore(data.value,instance.id)
  if (!entries.length) {notice.value='这张卡没有附带可导入的世界书。';return}
  const conflicts=entries.filter(e=>e.conflictId).length
  const accepted=await ask(()=>appConfirm(`共 ${entries.length} 条，${conflicts} 条与现有设定冲突。新条目默认仅 ${definition(instance.id).name} 知晓；${conflicts?'冲突项会跳过，原条目保留。':'不会覆盖已有设定。'}`,{sensitive:true,owner:dialogOwner,title:'预览角色附带世界书',confirmText:conflicts?'跳过冲突并导入':'导入私有设定'}))
  if(mounted&&accepted===true) await perform(()=>management.attachCardLore(instance.id,conflicts>0),'附带世界书已按角色私有范围导入。')
}
const unregister=registerBackHandler(()=>{
  if(instanceDraft.value||identityDraft.value){instanceDraft.value=null;identityDraft.value=null;return true}
  if(section.value!=='world'){section.value='world';return true}
  return false
},{priority:500,isActive:()=>Boolean(instanceDraft.value||identityDraft.value||section.value!=='world')})
onBeforeUnmount(()=>{mounted=false;identityDraft.value=null;instanceDraft.value=null;unregister();if(confirming)cancelOwnedFeedbackDialog(dialogOwner)})
</script>

<template>
  <div v-if="data" class="kanata-manager">
    <header class="kanata-page-heading"><div><p class="kanata-eyebrow">彼方 · Kanata</p><h2>在这里，开始另一种日常</h2><p class="kanata-help">世界已准备好</p></div><span class="kanata-badge">文字世界</span></header>
    <DataStatusBanner :issues="issues" />
    <p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p><p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <nav class="kanata-sections" aria-label="彼方管理分区"><button type="button" :aria-pressed="section==='world'" @click="section='world'">我的世界</button><button type="button" :aria-pressed="section==='cards'" @click="section='cards'">全局角色库</button><button type="button" :aria-pressed="section==='lore'" @click="section='lore'">世界书</button></nav>
    <div class="kanata-world-toolbar"><button type="button" class="kanata-selection" :disabled="busy" @click="chooseWorld">{{ world?.name || '选择世界' }}<span>{{ world?.archived?'已归档':`${worlds.length} 个独立世界` }}</span></button></div>
    <template v-if="section==='world' && world">
      <section class="kanata-panel" aria-label="世界管理"><header class="kanata-section-heading"><h3>{{ world.name }}</h3><span v-if="world.archived" class="kanata-badge">已归档 · 自动活动关闭</span></header>
        <div class="kanata-count-grid"><div><strong>{{ instances.length }}</strong><span>角色实例</span></div><div><strong>{{ conversations.filter(c=>c.type==='private').length }}</strong><span>独立私聊</span></div><div><strong>{{ conversations.filter(c=>c.type==='group').length }}</strong><span>群聊</span></div></div>
        <p class="kanata-help">当前世界称谓：{{ identity?.displayName }} · 现实时间同步 · {{ world.timeZone }}</p>
        <div class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="rename">重命名世界</button><button type="button" :disabled="blocked||busy" @click="copyWorld">复制设定</button><button type="button" :disabled="worldBlocked||busy" @click="editIdentity">编辑世界身份</button><button type="button" :disabled="blocked||busy" @click="archive">{{ world.archived?'取消归档世界':'归档世界' }}</button></div>
        <form v-if="identityDraft" class="kanata-form" novalidate @submit.prevent="saveIdentity"><h4>只在这个世界中的身份</h4><label>称谓<input v-model="identityDraft.displayName" maxlength="100" /></label><label>世界内背景<textarea v-model="identityDraft.background" rows="3" maxlength="4000"></textarea></label><div class="kanata-actions"><button type="submit" :disabled="worldBlocked||busy">保存世界身份</button><button type="button" @click="identityDraft=null">取消身份编辑</button></div></form>
      </section>
      <section class="kanata-panel" aria-label="世界中的角色"><header class="kanata-section-heading"><h3>在这个世界相遇</h3><button type="button" :disabled="worldBlocked||busy" @click="addCharacter">加入角色</button></header>
        <div class="kanata-character-grid"><article v-for="instance in instances" :key="instance.id"><header class="kanata-avatar-heading"><img v-if="definition(instance.id).avatarDataUrl" :src="definition(instance.id).avatarDataUrl" alt="" /><span v-else class="kanata-avatar" aria-hidden="true">{{ definition(instance.id).avatarPlaceholder }}</span><h4>{{ definition(instance.id).name }}</h4></header><p class="kanata-help">{{ definition(instance.id).speechStyle }}</p><div class="kanata-actions"><button type="button" :disabled="worldBlocked||busy" @click="editInstance(instance)">实例设置</button><button type="button" :disabled="worldBlocked||busy" @click="attachLore(instance)">附带世界书</button></div></article></div>
        <p v-if="!instances.length" class="kanata-help">还没有角色。从全局库加入后，会建立这个世界中的独立私聊。</p>
        <form v-if="instanceDraft" class="kanata-form" novalidate @submit.prevent="saveInstance"><h4>{{ instanceDraft.name }} · 本世界独立覆盖</h4><label>本世界中的称呼<input v-model="instanceDraft.name" maxlength="200" /></label><label>人物概要<textarea v-model="instanceDraft.summary" rows="4" maxlength="20000"></textarea></label><label>说话习惯<textarea v-model="instanceDraft.speechStyle" rows="3" maxlength="10000"></textarea></label><div class="kanata-actions"><button type="submit" :disabled="worldBlocked||busy">保存实例设定</button><button type="button" @click="instanceDraft=null">取消实例编辑</button></div></form>
      </section>
      <section class="kanata-panel" aria-label="世界会话预览">
        <h3>会话 · 独立保存的相遇</h3><ul class="kanata-conversation-list"><li v-for="conversation in conversations" :key="conversation.id"><strong>{{ conversation.title }}</strong><span>{{ conversation.type==='group'?'群聊':'私聊' }} · {{ conversation.participantIds.length-1 }} 位角色</span></li></ul><p class="kanata-help">角色和会话已准备，当前可管理世界与设定。文字对话暂未开放，不会自动生成聊天或发起 AI 请求。</p></section>
      <section class="kanata-panel">
        <h3>另一个世界，从零开始</h3><div class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="createWorld">创建空白世界</button><button type="button" :disabled="blocked||busy" @click="addPreset">从预设创建世界</button></div></section>
    </template>
    <KanataCardLibrary v-if="section==='cards'" :data="data" :management="management" :blocked="blocked" @message="notice=$event" />
    <KanataLorebookPanel v-if="section==='lore' && world" :key="world.id" :data="data" :world-id="world.id" :management="management" :blocked="worldBlocked" @message="notice=$event" />
    <footer class="kanata-footer">阿拜多斯为非官方同人文字预设。头像为文字占位或用户自行导入；没有官方图片、完整台词和虚构的历史聊天。</footer>
  </div>
</template>
