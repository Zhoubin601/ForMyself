import { BACKUP_TYPE_OPTIONS, moduleRegistry } from '../src/application/moduleRegistry.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readSourceContract as read } from './sourceContractReader.js'

test('侧栏与首页陪伴卡复用 chat 路由进入受保护的彼方入口', () => {
  const app = read('App.vue')
  const home = read('components/HomeView.vue')
  const chat = moduleRegistry.get('chat')
  assert.equal(chat.title, '彼方 · Kanata')
  assert.equal(chat.name, 'KanataSetupView')
  assert.equal(chat.cache, false)
  assert.equal(chat.access, 'protected')
  assert.equal(moduleRegistry.menu({ warmHomeEnabled: true }).some(m => m.id === 'chat'), true)
  assert.equal(moduleRegistry.menu({ warmHomeEnabled: false }).some(m => m.id === 'chat'), false)
  assert.match(app, /<KeepAlive/)
  assert.match(home, /@click="switchView\('chat'\)"/)

})

test('聊天界面包含全高布局、100 条分批加载、流式停止、重试和单条操作', () => {
  const view = read('features/chat/ChatView.vue')
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
  const view = read('features/chat/ChatView.vue')
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
  const view = read('features/chat/ChatView.vue')
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
  const view = read('features/chat/ChatView.vue')

  assert.match(view, /timeline\.scrollTop = timeline\.scrollHeight/)
  assert.match(view, /requestAnimationFrame/)
  assert.match(view, /onMounted\(async \(\) => \{[\s\S]*chatStore\.materializeDueProactive\(Date\.now\(\)\)[\s\S]*await scrollToBottom\(true\)/)
  assert.match(view, /timelineReady\.value = true/)
  assert.match(view, /:class="\{ 'timeline-ready': timelineReady \}"/)
  assert.match(view, /scroll-behavior: auto/)
  assert.doesNotMatch(view, /scroll-behavior: smooth/)
  assert.match(view, /\.chat-timeline:not\(\.timeline-ready\) \{ visibility: hidden; \}/)
  assert.match(view, /class="chat-bottom-anchor"/)
})

test('流式回复会按节奏拆成连续气泡并在完整一轮后只更新一次关系状态', () => {
  const view = read('features/chat/ChatView.vue')

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
  const view = read('features/chat/ChatView.vue')

  assert.match(view, /let smartEntryRun = 0/)
  assert.match(view, /const entryRun = \+\+smartEntryRun/)
  assert.match(view, /entryRun === smartEntryRun/)
  assert.match(view, /chatStore\.messages\.length === entryMessageCount/)
  assert.match(view, /pendingReplyMessageIds\.size === 0/)
  assert.match(view, /smartEntryRun \+= 1/)
})

test('彼方入口不缓存；历史聊天的中断恢复实现保留但不作为产品入口', () => {
  const app = read('App.vue')
  const view = read('features/chat/ChatView.vue')

  assert.match(app, /v-if="hasEnteredApp" v-show="!authStore\.isLocked" class="main-app/)
  assert.equal(moduleRegistry.get('chat').cache, false)
  assert.notEqual(moduleRegistry.get('chat').name, 'ChatView')
  assert.equal(moduleRegistry.get('chat').bindings({ isVisible: false }).isVisible, false)
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
  const view = read('features/chat/ChatView.vue')

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

test('彼方设置通过统一导航进入受保护入口，备份保留独立选项', () => {
  assert.equal(BACKUP_TYPE_OPTIONS.find(option => option.value === 'chat').label, '彼方数据')
  const section = read('components/settings/SettingsChat.vue')
  assert.match(section, /switchView\('chat'\)/)
  assert.match(section, /@click="openKanata"/)
  assert.match(section, /旧温馨小家不会被导入新世界/)
  assert.doesNotMatch(section, /@click="(?:saveCompanionName|clearChatMessages|clearChatMemories|resetChatHome)/)
  assert.equal(moduleRegistry.get('chat').backup.prefix, 'Kanata')
})

test('聊天上下文只组合生活 Store，不读取密码库、主密码或 API Key 内容', () => {
  const view = read('features/chat/ChatView.vue')
  const companion = read('features/chat/chatCompanion.js')
  const contextBlock = view.slice(view.indexOf('const buildLifeContext'), view.indexOf('const currentSystemPrompt'))

  assert.doesNotMatch(contextBlock, /vaultStore|savedMasterPwd|aiApiKey/)
  assert.doesNotMatch(companion, /usePasswordVaultStore|useAuthStore|aiApiKey/)
  assert.match(companion, /不得索取、复述或记忆密码/)
})
