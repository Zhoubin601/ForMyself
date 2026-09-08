<script setup>
import { toRefs } from 'vue'
import AppTimeField from '../AppTimeField.vue'
const props = defineProps({ model: { type: Object, required: true } })
const { addChatMemory, addSocialCharacter, buildCompanionWorldFromHistory, chatStore, clearChatMemories, clearChatMessages, clearCompanionAvatar, companionAvatarInputRef, companionNameInput, confirmWorldDraft, deleteChatMemory, deleteSocialCharacter, deleteVirtualEvent, editChatMemory, editSelfProfileList, editSelfSummary, editSocialCharacter, editWorldDraftCharacter, editWorldDraftEvent, editWorldDraftList, editWorldDraftSummary, handleCompanionAvatarUpload, isGeneratingWorldDraft, isProcessingCompanionAvatar, isRegeneratingCompanionState, isSavingChatProactive, isWorldExpanded, memoryPage, memoryPageCount, memoryRangeLabel, memoryScopeFilter, memoryScopeOptions, newMemoryCategory, newMemoryContent, pagedChatMemories, proactiveForm, regenerateCompanionState, removeWorldDraftCharacter, removeWorldDraftEvent, resetChatHome, resetCompanionWorld, revertEvolution, saveChatProactiveSettings, saveCompanionName, scopedChatMemories, selfProfileSections, setDailyMaximum, setDailyMinimum, setFollowupEnabled, settingsScope, triggerCompanionAvatarUpload, worldDraft } = toRefs(props.model)
</script>

<template>
    <div v-if="settingsScope === 'chat'" class="setting-section chat-settings-section">
      <h3 class="caption body-muted section-title">陪伴档案</h3>
      <div class="store-utility-card chat-profile-card">
        <div class="chat-stat-row">
          <div><strong>{{ chatStore.messages.length }}</strong><span>聊天消息</span></div>
          <div><strong>{{ chatStore.memories.length }}</strong><span>长期记忆</span></div>
        </div>
        <div class="companion-avatar-setting">
          <div class="companion-avatar-preview" aria-hidden="true">
            <img
              v-if="chatStore.profile.companionAvatar"
              :src="chatStore.profile.companionAvatar"
              alt=""
            />
            <span v-else>♡</span>
          </div>
          <div class="companion-avatar-copy">
            <strong>女朋友头像</strong>
            <span>选择图片后会自动居中裁剪，聊天与备份都会保留。</span>
          </div>
          <button
            class="avatar-upload-button"
            type="button"
            :disabled="isProcessingCompanionAvatar"
            @click="triggerCompanionAvatarUpload"
          >{{ isProcessingCompanionAvatar ? '处理中…' : '上传' }}</button>
          <button
            v-if="chatStore.profile.companionAvatar"
            class="avatar-clear-button"
            type="button"
            aria-label="恢复默认头像"
            @click="clearCompanionAvatar"
          >恢复默认</button>
          <input
            ref="companionAvatarInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style="display: none"
            @change="handleCompanionAvatarUpload"
          />
        </div>
        <label class="input-group chat-name-field">
          <span class="caption">女朋友名字</span>
          <input
            v-model="companionNameInput"
            class="apple-input"
            maxlength="20"
            placeholder="例如：小暖"
            @keyup.enter="saveCompanionName"
          />
        </label>
        <button class="button-primary full-width" @click="saveCompanionName">保存名字</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">她今天的状态</h3>
      <div class="store-utility-card companion-state-card">
        <div class="companion-state-heading">
          <div>
            <span>{{ chatStore.companionState.mood || '安静' }}</span>
            <strong>{{ chatStore.companionState.statusText || '陪着你' }}</strong>
          </div>
          <em>精力 {{ chatStore.companionState.energy || '平稳' }}</em>
        </div>
        <p>{{ chatStore.companionState.currentThought || '想等哥哥来温馨小家说说话。' }}</p>
        <p class="companion-virtual-moment">{{ chatStore.companionState.virtualMoment || '在温馨小家里安静待着。' }}</p>
        <div v-if="chatStore.openLoops.length" class="open-loop-summary">
          <strong>还惦记着</strong>
          <span v-for="loop in chatStore.openLoops.slice(0, 3)" :key="loop.id">{{ loop.content }}</span>
        </div>
        <button
          class="button-secondary-pill full-width"
          type="button"
          :disabled="isRegeneratingCompanionState"
          @click="regenerateCompanionState"
        >{{ isRegeneratingCompanionState ? '正在换个心情…' : '重新生成今天状态' }}</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">她的世界</h3>
      <div class="store-utility-card companion-world-card">
        <button class="world-disclosure-button" type="button" @click="isWorldExpanded = !isWorldExpanded">
          <span>
            <strong>{{ chatStore.selfProfile.summary || '还没有建立稳定的自我档案' }}</strong>
            <small>{{ chatStore.socialCast.length }} 个固定人物 · {{ chatStore.virtualEvents.length }} 个近期事件</small>
          </span>
          <b :class="{ expanded: isWorldExpanded }">⌄</b>
        </button>

        <div v-if="isWorldExpanded" class="world-content">
          <section class="world-block">
            <header><strong>自我档案</strong><button class="text-link" type="button" @click="editSelfSummary">编辑简介</button></header>
            <p class="world-summary">{{ chatStore.selfProfile.summary || '可以手动编辑，也可以根据已有聊天先生成一份草案。' }}</p>
            <div class="world-profile-grid">
              <button
                v-for="section in selfProfileSections"
                :key="section.field"
                type="button"
                @click="editSelfProfileList(section)"
              >
                <strong>{{ section.label }}</strong>
                <span>{{ chatStore.selfProfile[section.field]?.join('、') || '点此补充' }}</span>
              </button>
            </div>
          </section>

          <section class="world-block">
            <header>
              <strong>固定虚拟人物（1–3 个）</strong>
              <button class="text-link" type="button" :disabled="chatStore.socialCast.length >= 3" @click="addSocialCharacter">添加</button>
            </header>
            <p v-if="!chatStore.socialCast.length" class="world-empty">尚未启用固定人物；AI 不会临时创造名单外人物。</p>
            <article v-for="character in chatStore.socialCast" :key="character.id" class="world-list-item">
              <div><strong>{{ character.name }}</strong><span>{{ character.relationship }}</span><small v-if="character.notes">{{ character.notes }}</small></div>
              <aside><button class="text-link" type="button" @click="editSocialCharacter(character)">编辑</button><button class="text-link danger-text" type="button" @click="deleteSocialCharacter(character)">删除</button></aside>
            </article>
          </section>

          <section class="world-block">
            <header><strong>近期虚拟事件</strong><small>每天最多 1 个</small></header>
            <p v-if="!chatStore.virtualEvents.length" class="world-empty">聊天后会逐日形成温馨小家里的生活事件。</p>
            <article v-for="event in chatStore.virtualEvents.slice(0, 8)" :key="event.id" class="world-list-item">
              <div><strong>{{ event.title }}</strong><span>{{ event.detail }}</span><small>{{ event.date }}</small></div>
              <aside><button class="text-link danger-text" type="button" @click="deleteVirtualEvent(event)">删除</button></aside>
            </article>
          </section>

          <section class="world-block">
            <header><strong>自我变化</strong><small>至少 3 轮、跨 2 天才生效</small></header>
            <p v-if="!chatStore.evolutionLog.length" class="world-empty">还没有达到生效条件的变化。</p>
            <article v-for="entry in chatStore.evolutionLog.slice(0, 8)" :key="entry.id" class="world-list-item">
              <div><strong>{{ entry.nextValue }}</strong><span>{{ entry.reason || '来自多轮一致表现' }}</span></div>
              <aside><span v-if="entry.revertedAt" class="world-reverted">已撤销</span><button v-else class="text-link" type="button" @click="revertEvolution(entry)">撤销</button></aside>
            </article>
          </section>

          <div class="proactive-toggle-row followup-toggle-row">
            <div><strong>允许偶尔延迟补一句</strong><span>合适轮次约占 10–20%；你插话后旧补话会取消并重新判断。</span></div>
            <label class="switch-control"><input :checked="chatStore.realismSettings.followupEnabled" type="checkbox" @change="setFollowupEnabled($event.target.checked)" /><span></span></label>
          </div>

          <div class="world-actions">
            <button class="button-secondary-pill" type="button" :disabled="isGeneratingWorldDraft" @click="buildCompanionWorldFromHistory">{{ isGeneratingWorldDraft ? '正在分块分析…' : '根据已有聊天建立她的自我' }}</button>
            <button class="text-link danger-text" type="button" @click="resetCompanionWorld">重置她的世界</button>
          </div>
        </div>
      </div>

      <div v-if="worldDraft" class="store-utility-card world-draft-card">
        <header><div><strong>待确认的世界草案</strong><span>尚未写入聊天数据</span></div><button class="text-link" type="button" @click="worldDraft = null">取消</button></header>
        <button class="world-draft-summary" type="button" @click="editWorldDraftSummary">{{ worldDraft.selfProfile.summary || '点此补充她的自我简介' }}</button>
        <div class="world-profile-grid">
          <button v-for="section in selfProfileSections" :key="section.field" type="button" @click="editWorldDraftList(section)"><strong>{{ section.label }}</strong><span>{{ worldDraft.selfProfile[section.field]?.join('、') || '空' }}</span></button>
        </div>
        <div class="draft-chip-list"><span v-for="character in worldDraft.socialCast" :key="character.id">{{ character.name }} · {{ character.relationship }}<button type="button" aria-label="编辑草案人物" @click="editWorldDraftCharacter(character)">编辑</button><button type="button" aria-label="从草案移除人物" @click="removeWorldDraftCharacter(character.id)">×</button></span></div>
        <div class="draft-event-list"><div v-for="event in worldDraft.virtualEvents" :key="event.id"><span>{{ event.date }} · {{ event.title }}</span><aside><button type="button" @click="editWorldDraftEvent(event)">编辑</button><button type="button" @click="removeWorldDraftEvent(event.id)">移除</button></aside></div></div>
        <button class="button-primary full-width" type="button" @click="confirmWorldDraft">确认并启用草案</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">主动联系</h3>
      <div class="store-utility-card chat-proactive-card">
        <div class="proactive-toggle-row">
          <div>
            <strong>让她偶尔主动来找你</strong>
            <span>没有回应时当天不会追问，也不会在刚聊完后打扰。</span>
          </div>
          <label class="switch-control">
            <input v-model="proactiveForm.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>
        <div class="proactive-range-grid">
          <label>
            <span class="caption">每天期望最少 <b>{{ proactiveForm.dailyMin }} 条</b></span>
            <input :value="proactiveForm.dailyMin" type="range" min="0" max="5" step="1" :disabled="!proactiveForm.enabled" @input="setDailyMinimum($event.target.value)" />
          </label>
          <label>
            <span class="caption">每天期望最多 <b>{{ proactiveForm.dailyMax }} 条</b></span>
            <input :value="proactiveForm.dailyMax" type="range" min="0" max="5" step="1" :disabled="!proactiveForm.enabled" @input="setDailyMaximum($event.target.value)" />
          </label>
        </div>
        <p class="caption body-muted proactive-expectation-note">这是期望范围；未回复、刚聊完、安全抑制或通知权限不足时，实际次数可能更少。</p>
        <div class="proactive-time-grid">
          <label>
            <span class="caption">开始时间</span>
            <AppTimeField
              v-model="proactiveForm.activeStart"
              class="proactive-time-field"
              :disabled="!proactiveForm.enabled"
            />
          </label>
          <label>
            <span class="caption">结束时间</span>
            <AppTimeField
              v-model="proactiveForm.activeEnd"
              class="proactive-time-field"
              :disabled="!proactiveForm.enabled"
            />
          </label>
        </div>
        <button
          class="button-primary full-width"
          type="button"
          :disabled="isSavingChatProactive"
          @click="saveChatProactiveSettings"
        >{{ isSavingChatProactive ? '正在安排…' : '保存主动联系设置' }}</button>
        <p class="caption body-muted virtual-role-note">小暖是“温馨小家”中的虚拟女朋友角色。她可以有连续的小情绪和想法，但不会冒充现实真人。</p>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">长期记忆</h3>
      <div class="store-utility-card chat-memory-card">
        <p class="caption body-muted chat-memory-note">可手动补充她要记住的事情。账号、密码、密钥和验证码不会保存。</p>
        <div class="memory-scope-tabs" aria-label="长期记忆归属">
          <button
            v-for="scope in memoryScopeOptions"
            :key="scope.value"
            type="button"
            :class="{ active: memoryScopeFilter === scope.value }"
            @click="memoryScopeFilter = scope.value"
          >
            <strong>{{ scope.label }}</strong>
            <span>{{ scope.description }}</span>
          </button>
        </div>
        <div class="memory-category-grid" aria-label="长期记忆分类">
          <button
            v-for="category in CHAT_MEMORY_CATEGORIES"
            :key="category"
            :class="{ active: newMemoryCategory === category }"
            @click="newMemoryCategory = category"
          >{{ category }}</button>
        </div>
        <div class="taxonomy-add-row">
          <input
            v-model="newMemoryContent"
            class="apple-input"
            maxlength="500"
            placeholder="例如：哥哥不喜欢太甜的咖啡"
            @keyup.enter="addChatMemory"
          />
          <button class="button-primary taxonomy-add-button" @click="addChatMemory">添加</button>
        </div>
        <div v-if="scopedChatMemories.length" class="chat-memory-list">
          <article v-for="memory in pagedChatMemories" :key="memory.id" class="chat-memory-row">
            <div>
              <span class="memory-category">{{ memory.category }}</span>
              <p>{{ memory.content }}</p>
            </div>
            <div class="chat-memory-actions">
              <button class="text-link" @click="editChatMemory(memory)">编辑</button>
              <button class="text-link danger-text" @click="deleteChatMemory(memory)">删除</button>
            </div>
          </article>
          <nav v-if="memoryPageCount > 1" class="chat-memory-pagination" aria-label="长期记忆分页">
            <button
              type="button"
              :disabled="memoryPage <= 1"
              aria-label="上一页"
              @click="memoryPage -= 1"
            >‹</button>
            <span>第 {{ memoryPage }} / {{ memoryPageCount }} 页 · {{ memoryRangeLabel }}</span>
            <button
              type="button"
              :disabled="memoryPage >= memoryPageCount"
              aria-label="下一页"
              @click="memoryPage += 1"
            >›</button>
          </nav>
        </div>
        <p v-else class="caption body-muted taxonomy-empty">这一栏还没有长期记忆。完整对话结束后，她会把真正值得记住的内容放到合适的归属中。</p>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">数据清理</h3>
      <div class="ios-list">
        <button class="list-item text-link destructive" style="text-align: left;" @click="clearChatMessages">清空聊天记录</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="clearChatMemories">清空长期记忆</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="resetChatHome">全部重置温馨小家</button>
      </div>
    </div>
</template>
