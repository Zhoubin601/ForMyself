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
  assert.match(app, /<ChatView v-if="settingsStore\.currentView === 'chat'"/)
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
  assert.match(view, /copyMessage\(item\)/)
  assert.match(view, /deleteMessage\(item\)/)
  assert.match(view, /startMessageLongPress\(item, \$event\)/)
  assert.match(view, /quoteMessage\(actionMessage\)/)
  assert.match(view, /class="composer-quote"/)
  assert.match(view, /item\.replyTo/)
  assert.match(view, /env\(safe-area-inset-bottom/)
})

test('聊天每次进入和内容更新后强制定位最底部', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /timeline\.scrollTop = timeline\.scrollHeight/)
  assert.match(view, /requestAnimationFrame/)
  assert.match(view, /onMounted\(async \(\) => \{\s*await scrollToBottom\(true\)/)
  assert.match(view, /timelineReady\.value = true/)
  assert.match(view, /:class="\{ 'timeline-ready': timelineReady \}"/)
  assert.match(view, /scroll-behavior: auto/)
  assert.doesNotMatch(view, /scroll-behavior: smooth/)
  assert.match(view, /\.chat-timeline:not\(\.timeline-ready\) \{ visibility: hidden; \}/)
  assert.match(view, /ref="timelineBottomRef" class="chat-bottom-anchor"/)
})

test('流式回复会拆成连续气泡并在完整一轮后只触发一次记忆提取', () => {
  const view = read('components/ChatView.vue')

  assert.match(view, /const parts = splitCompanionReply\(streamingText\.value\)/)
  assert.match(view, /id: `streaming-reply-\$\{index\}`/)
  assert.match(view, /const assistantMessages = appendAssistantReply\(answer\)/)
  assert.match(view, /rememberExchange\(userMessage, assistantMessages\)/)
  assert.match(view, /assistantMessages\.map\(item => item\.content\)\.join\('\\n'\)/)
})

test('温馨小家设置页在窄屏使用紧凑字号和完整宽度输入布局', () => {
  const settings = read('components/SettingsView.vue')

  assert.match(settings, /\.module-settings-intro > div \{ flex: 1; min-width: 0; \}/)
  assert.match(settings, /\.chat-settings-section \.full-width \{ width: 100%; \}/)
  assert.match(settings, /\.chat-name-field \{ display: block; margin-bottom: 18px; \}/)
  assert.match(settings, /@media \(max-width: 480px\)[\s\S]*\.chat-memory-card \.taxonomy-add-row \{ display: grid; grid-template-columns: 1fr/)
  assert.match(settings, /@media \(max-width: 480px\)[\s\S]*\.module-settings-intro p \{[\s\S]*font-size: 12px/)
})

test('每次进入会生成临时欢迎语，退出会中止迟到请求且欢迎语不写入 Store', () => {
  const view = read('components/ChatView.vue')
  const generateWelcomeBlock = view.slice(
    view.indexOf('const generateWelcome'),
    view.indexOf('const appendAssistantReply')
  )

  assert.match(view, /onMounted\(async \(\) =>/)
  assert.match(view, /generateWelcome\(\)/)
  assert.match(view, /componentActive = false/)
  assert.match(view, /welcomeController\?\.abort\(\)/)
  assert.doesNotMatch(generateWelcomeBlock, /chatStore\.appendMessage/)
  assert.match(view, /sessionWelcome: sessionWelcome\.value/)
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
})

test('聊天上下文只组合生活 Store，不读取密码库、主密码或 API Key 内容', () => {
  const view = read('components/ChatView.vue')
  const companion = read('services/chatCompanion.js')
  const contextBlock = view.slice(view.indexOf('const buildLifeContext'), view.indexOf('const currentSystemPrompt'))

  assert.doesNotMatch(contextBlock, /vaultStore|savedMasterPwd|aiApiKey/)
  assert.doesNotMatch(companion, /usePasswordVaultStore|useAuthStore|aiApiKey/)
  assert.match(companion, /不得索取、复述或记忆密码/)
})
