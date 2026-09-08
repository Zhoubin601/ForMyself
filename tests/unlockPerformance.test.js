import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = path => readFileSync(join(process.cwd(), 'src', path), 'utf8')

test('解锁先绘制忙碌状态并防止重复提交', () => {
  const app = read('App.vue')
  const controller = read('composables/useAppController.js')
  assert.match(app, /:disabled="isUnlocking"/)
  assert.match(app, /正在解锁…/)
  assert.match(controller, /if \(isUnlocking\.value\) return false/)
  assert.match(controller, /await afterNextPaint\(\)/)
})

test('主密码通过后主页先绘制且受保护数据在随后加载', () => {
  const controller = read('composables/useAppController.js')
  const app = read('App.vue')
  assert.match(controller, /if \(ok\) await finishUnlock\(\)/)
  assert.match(controller, /afterTwoPaints\(start\)/)
  assert.match(controller, /protectedDataStatus\.value = 'loading'/)
  assert.match(app, /protectedDataStatus !== 'ready'/)
  assert.match(app, /正在安全载入密码库/)
})

test('非首页组件和受保护 Store 不进入首屏静态依赖', () => {
  const app = read('App.vue')
  const controller = read('composables/useAppController.js')
  const home = read('components/HomeView.vue')
  assert.match(app, /const ChatView = defineAsyncComponent/)
  assert.match(app, /const MoodView = defineAsyncComponent/)
  assert.match(controller, /import\('\.\.\/features\/chat\/chatStore\.js'\)/)
  assert.doesNotMatch(controller, /^import .*chatStore/m)
  assert.doesNotMatch(home, /useChatStore/)
})

test('首次指纹启用在主页主动触发而不阻塞密码解锁', () => {
  const auth = read('stores/auth.js')
  const home = read('components/HomeView.vue')
  assert.doesNotMatch(auth.match(/const unlockWithPassword[\s\S]*?const unlockWithBiometric/)?.[0] || '', /provisionBiometricCredential\(password\)/)
  assert.match(auth, /const enableBiometricUnlock = async/)
  assert.match(home, /启用指纹快捷解锁/)
  assert.match(home, /emit\('dismiss-biometric'\)/)
})
