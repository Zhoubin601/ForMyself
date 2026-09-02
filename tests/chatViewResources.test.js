import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const sourceRoot = join(process.cwd(), 'src')
const read = path => readFileSync(join(sourceRoot, path), 'utf8')

test('侧栏与首页陪伴卡都可以进入温馨小家', () => {
  const app = read('App.vue')
  const home = read('components/HomeView.vue')
  const settings = read('stores/settings.js')

  assert.match(app, /\{ id: 'chat', label: '温馨小家', meta: '陪伴'/)
  assert.match(app, /<KeepAlive :max="7">[\s\S]*<ChatView[\s\S]*v-else-if="settingsStore\.currentView === 'chat'"/)
  assert.match(home, /@click="switchView\('chat'\)"/)
  assert.match(settings, /chat: '温馨小家'/)
})

test('聊天界面包含全高布局、100 条分批加载、流式停止、重试和单条操作', () => {
  const view = read('components/ChatView.vue')
  const app = read('App.vue')

  assert.match(view, /const visibleCount = ref\(100\)/)
  assert.match(view, /visibleCount \+= 100/)
  assert.match(view, /class="warm-home"/)
  assert.match(view, /\.warm-home \{[\s\S]*flex: 1 1 0/)
  assert.match(view, /\.warm-home \{[\s\S]*overflow: hidden/)
  assert.match(view, /\.chat-timeline \{[\s\S]*flex: 1 1 0/)
  assert.match(view, /\.chat-composer \{[\s\S]*flex: 0 0 auto/)
  assert.match(app, /\.app-wrapper\.chat-active \{[\s\S]*height: 100dvh/)
  assert.match(app, /\.content-area\.chat-content-area \{[\s\S]*height: 0/)
  assert.match(view, /停止生成/)
  assert.match(view, /retryLastReply/)
  assert.match(view, /@click="copyMessage\(actionMessage\)"/)
  assert.match(view, /@click="deleteMessage\(actionMessage\)"/)
  assert.match(view, /:aria-label="`打开\$\{item\.role === 'assistant'/)
  assert.match(view, /startMessageGesture\(item, \$event\)/)
  assert.match(view, /swipeOffset\.value >= 56/)
  assert.match(view, /quoteMessage\(actionMessage\)/)
  assert.match(view, /class="composer-quote"/)
  assert.match(view, /item\.replyTo/)
  assert.match(view, /env\(safe-area-inset-bottom/)
})

test('聊天支持双向微信式互动、拍一拍和未读定位', () => {
  const view = read('components/ChatView.vue')
  const app = read('App.vue')
  const home = read('components/HomeView.vue')

  assert.match(view, /planCompanionInteraction/)
  assert.match(view, /interaction\.action === 'quote'/)
  assert.match(view, /setMessageReaction\(targetMessage\.id, 'assistant'/)
  assert.match(view, /CHAT_REACTION_EMOJIS/)
  assert.match(view, /selectMessageReaction/)
  assert.match(view, /handleCompanionAvatarTap/)
  assert.match(view, /now - lastPokeAt < 3000/)
  assert.match(view, /class="unread-divider"/)
  assert.match(view, /class="new-message-jump"/)
  assert.match(app, /drawer-unread-badge/)
  assert.match(home, /companion-unread/)
})

test('消息表情使用独立轻量表情条，不以负边距穿插相邻气泡', () => {
  const view = read('components/ChatView.vue')
  const reactionBlock = view.match(/\.message-reactions \{([\s\S]*?)\n\}/)?.[1] || ''
  const reactionItemBlock = view.match(/\.message-reactions span \{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(reactionBlock, /display:\s*inline-flex/)
  assert.match(reactionBlock, /margin:\s*4px 11px 2px/)
  assert.doesNotMatch(reactionBlock, /margin:\s*-/)
  assert.match(reactionBlock, /border:\s*0/)
  assert.match(reactionBlock, /box-shadow:\s*none/)
  assert.match(reactionItemBlock, /background:\s*transparent/)
  assert.doesNotMatch(reactionItemBlock, /border:\s*2px/)
})

test('聊天每次进入和内容更新后强制定位最底部', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /timeline\.scrollTop = timeline\.scrollHeight/)
  assert.match(view, /requestAnimationFrame/)
  assert.match(view, /onMounted\(async \(\) => \{[\s\S]*chatStore\.materializeDueProactive\(Date\.now\(\)\)[\s\S]*await scrollToBottom\(true\)/)
  assert.match(view, /timelineReady\.value = true/)
  assert.match(view, /:class="\{ 'timeline-ready': timelineReady \}"/)
  assert.match(view, /scroll-behavior: auto/)
  assert.doesNotMatch(view, /scroll-behavior: smooth/)
  assert.match(view, /\.chat-timeline:not\(\.timeline-ready\) \{ visibility: hidden; \}/)
  assert.match(view, /ref="timelineBottomRef" class="chat-bottom-anchor"/)
})

test('流式回复会按节奏拆成连续气泡并在完整一轮后只更新一次关系状态', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /sanitizeCompanionReply\(content/)
  assert.match(view, /const parts = splitCompanionReply\(normalizedContent/)
  assert.match(view, /buildCompanionTurnContext/)
  assert.match(view, /maxTokens: turnContext\.replyPolicy\.maxTokens/)
  assert.match(view, /await wait\(bubblePacingDelay\(parts\[index\]\)\)/)
  assert.match(view, /planChatBehavior/)
  assert.match(view, /naturalPacingTarget/)
  assert.match(view, /const assistantMessages = await appendAssistantReply\(plannedReply\.main, 'complete', \{[\s\S]*runId,[\s\S]*replyTo:/)
  assert.match(view, /updateRelationship\(batch, assistantMessages\)/)
  assert.match(view, /extractRelationshipUpdateForExchange/)
  assert.match(view, /chatStore\.upsertOpenLoops/)
})

test('用户发送新消息后会使尚未落地的智能开场失效', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /let smartEntryRun = 0/)
  assert.match(view, /const entryRun = \+\+smartEntryRun/)
  assert.match(view, /entryRun === smartEntryRun/)
  assert.match(view, /chatStore\.messages\.length === entryMessageCount/)
  assert.match(view, /pendingReplyMessageIds\.size === 0/)
  assert.match(view, /smartEntryRun \+= 1/)
})

test('切换应用页面或进入锁屏时保留聊天生成任务，并在进程重建后恢复未回复消息', () => {
  const app = read('App.vue')
  const view = read('components/ChatView.vue')

  assert.match(app, /v-if="hasEnteredApp" v-show="!authStore\.isLocked" class="main-app/)
  assert.match(app, /<KeepAlive :max="7">[\s\S]*<ChatView/)
  assert.match(app, /:is-visible="!authStore\.isLocked && settingsStore\.currentView === 'chat'"/)
  assert.match(view, /const findRecentUnansweredUserMessages/)
  assert.match(view, /24 \* 60 \* 60 \* 1000/)
  assert.match(view, /if \(!resumeInterruptedReply\(\)\) initializeCompanionContinuity\(\)/)
  assert.match(view, /onActivated\(async \(\) =>/)
  assert.match(view, /onDeactivated\(\(\) =>/)
  assert.match(view, /viewActive\.value && userNearBottom\.value/)
})

test('温馨小家设置页在窄屏使用紧凑字号和完整宽度输入布局', () => {
  const settings = read('components/SettingsView.vue')

  assert.match(settings, /\.module-settings-intro > div \{ flex: 1; min-width: 0; \}/)
  assert.match(settings, /\.chat-settings-section \.full-width \{ width: 100%; \}/)
  assert.match(settings, /\.chat-name-field \{ display: block; margin-bottom: 18px; \}/)
  assert.match(settings, /@media \(max-width: 480px\)[\s\S]*\.chat-memory-card \.taxonomy-add-row \{ display: grid; grid-template-columns: 1fr/)
  assert.match(settings, /@media \(max-width: 480px\)[\s\S]*\.module-settings-intro p \{[\s\S]*font-size: 12px/)
  assert.match(settings, /\.world-list-item > div \{ min-width: 0; \}/)
  assert.match(settings, /\.world-list-item span \{[\s\S]*overflow-wrap: anywhere/)
  assert.match(settings, /\.world-actions \{ align-items: stretch; flex-direction: column; \}/)
  assert.match(settings, /\.proactive-toggle-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 52px/)
  assert.match(settings, /\.proactive-toggle-row > \.switch-control \{[\s\S]*justify-self: end;[\s\S]*margin-right: -13px/)
  assert.match(settings, /\.proactive-toggle-row > div span \{[\s\S]*margin-top: 4px/)
  assert.doesNotMatch(settings, /\.proactive-toggle-row span \{[^}]*margin-top: 4px/)
  assert.match(settings, /\.switch-control \{[\s\S]*justify-self: center/)
  assert.match(settings, /\.switch-control input \{[\s\S]*inset: 0;[\s\S]*width: 100%; height: 100%/)
})

test('进入页面使用六小时智能主动消息并持久化，反复进出不再固定欢迎', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /onMounted\(async \(\) =>/)
  assert.match(view, /initializeCompanionContinuity\(\)/)
  assert.match(view, /shouldCreateSmartEntry/)
  assert.match(view, /generateSmartEntryMessage/)
  assert.match(view, /origin: 'entry'/)
  assert.match(view, /componentActive = false/)
  assert.match(view, /replyController\?\.abort\('unmount'\)/)
  assert.doesNotMatch(view, /generateWelcome/)
  assert.doesNotMatch(view, /sessionWelcome/)
})

test('设置页提供名字、长期记忆、三种清理行为与独立备份入口', () => {
  const settings = read('components/SettingsView.vue')

  assert.match(settings, /value: 'chat', label: '温馨小家数据'/)
  assert.match(settings, /saveCompanionName/)
  assert.match(settings, /CHAT_MEMORY_CATEGORIES/)
  assert.match(settings, /clearChatMessages/)
  assert.match(settings, /clearChatMemories/)
  assert.match(settings, /resetChatHome/)
  assert.match(settings, /prepareCompanionAvatar/)
  assert.match(settings, /setCompanionAvatar/)
  assert.match(settings, /const MEMORY_PAGE_SIZE = 3/)
  assert.match(settings, /v-for="memory in pagedChatMemories"/)
  assert.match(settings, /第 \{\{ memoryPage \}\} \/ \{\{ memoryPageCount \}\} 页/)
  assert.match(settings, /聊天与长期记忆/)
  assert.match(settings, /根据已有聊天建立她的自我/)
  assert.match(settings, /最近 200 个合并角色消息/)
  assert.match(settings, /每天期望最少/)
  assert.match(settings, /每天期望最多/)
  assert.match(settings, /允许偶尔延迟补一句/)
})

test('聊天上下文只组合生活 Store，不读取密码库、主密码或 API Key 内容', () => {
  const view = read('components/ChatView.vue')
  const companion = read('services/chatCompanion.js')
  const contextBlock = view.slice(view.indexOf('const buildLifeContext'), view.indexOf('const currentSystemPrompt'))

  assert.doesNotMatch(contextBlock, /vaultStore|savedMasterPwd|aiApiKey/)
  assert.doesNotMatch(companion, /usePasswordVaultStore|useAuthStore|aiApiKey/)
  assert.match(companion, /不得索取、复述或记忆密码/)
})
