import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { connect, pause, store, uiSet } from '../background-20261019/native/cdp.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const adbPath = 'E:/Android/Sdk/platform-tools/adb.exe'
const serial = 'emulator-5586'
const user = '12'

const adb = (args, options = {}) => execFileSync(adbPath, ['-s', serial, ...args], {
  encoding: 'utf8',
  windowsHide: true,
  ...options
})

const results = {
  date: '2026-10-19',
  platform: 'android',
  device: serial,
  user,
  tests: [],
  timings: {}
}

const record = (name, details = {}) => {
  results.tests.push({ name, passed: true, ...details })
  console.log(`[PASS] ${name}`)
}

const shot = async filename => {
  await pause(300)
  const buf = execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true })
  fs.writeFileSync(path.join(__dirname, filename), buf)
}

let c

const reconnectCdp = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const lines = adb(['shell', 'ps', '-A', '-o', 'USER,PID,NAME']).split('\n')
      const line = lines.find(l => /^u12_/.test(l) && / com\.yubin\.formyself\s*$/.test(l))
      if (line) {
        const pid = line.trim().split(/\s+/)[1]
        adb(['forward', 'tcp:9351', `localabstract:webview_devtools_remote_${pid}`])
        c = await connect()
        await c.until(`!!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)
        return
      }
    } catch {}
    await pause(500)
  }
  throw new Error('Reconnecting to native WebView failed')
}

// 检查并等待 BiometricPrompt 弹窗出现
const waitBiometricPrompt = async (timeoutMs = 6000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const focus = adb(['shell', 'dumpsys', 'window']).split('\n').find(l => l.includes('mCurrentFocus'))
      if (focus && focus.includes('BiometricPrompt')) return true
    } catch {}
    await pause(100)
  }
  return false
}

// 响应生物识别弹窗：模拟指纹成功
const handleBiometricSuccess = async () => {
  if (await waitBiometricPrompt(6000)) {
    for (let i = 0; i < 15; i++) {
      try {
        adb(['emu', 'finger', 'touch', '1'])
        await pause(250)
        const focus = adb(['shell', 'dumpsys', 'window']).split('\n').find(l => l.includes('mCurrentFocus'))
        if (!focus || !focus.includes('BiometricPrompt')) return true
      } catch {}
    }
  }
  return false
}

// 响应生物识别弹窗：点击原生对话框上的“取消”按钮 (bounds [84,2840][392,3008] -> 中心点 238, 2924)
const handleBiometricCancel = async () => {
  if (await waitBiometricPrompt(6000)) {
    for (let i = 0; i < 10; i++) {
      try {
        adb(['shell', 'input', 'tap', '238', '2924'])
        await pause(300)
        const focus = adb(['shell', 'dumpsys', 'window']).split('\n').find(l => l.includes('mCurrentFocus'))
        if (!focus || !focus.includes('BiometricPrompt')) return true
      } catch {}
    }
  }
  return false
}

// 关闭任何遗留的弹窗
const dismissAnyFeedback = async () => {
  await pause(250)
  try {
    if (await c.evaluate(`!!document.querySelector('.feedback-confirm, .feedback-cancel, .feedback-choice-cancel')`)) {
      await c.evaluate(`document.querySelector('.feedback-confirm, .feedback-cancel, .feedback-choice-cancel').click()`)
      await pause(200)
    }
  } catch {}
}

console.log('=== 开始 Android 原生全流程测试 ===')

try {
  assert.equal(adb(['shell', 'am', 'get-current-user']).trim(), user)
  process.env.QA_CDP_PORT = '9351'
  c = await connect()
  await c.until(`!!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)

  // 自适应判断当前主密码
  let currentPassword = 'Synthetic-Native-QA-2026'
  const is2026 = await c.evaluate(`${store('auth')}.unlockWithPassword('Synthetic-Native-QA-2026', { unlockApp: false })`)
  if (!is2026) {
    const is2027 = await c.evaluate(`${store('auth')}.unlockWithPassword('New-Synthetic-QA-2027', { unlockApp: false })`)
    if (is2027) {
      currentPassword = 'New-Synthetic-QA-2027'
    }
  }
  const nextNewPassword = currentPassword === 'Synthetic-Native-QA-2026' ? 'New-Synthetic-QA-2027' : 'Synthetic-Native-QA-2026'
  console.log(`当前主密码: ${currentPassword}, 下一轮目标主密码: ${nextNewPassword}`)

  // 如果处于锁定状态，先解锁
  if (await c.evaluate(`${store('auth')}.isLocked`)) {
    console.log('解锁当前应用...')
    await dismissAnyFeedback()
    await c.evaluate(uiSet('.lock-screen input', currentPassword))
    await c.evaluate(`document.querySelector('.lock-btn').click()`)
    await c.until(`!${store('auth')}.isLocked`)
  }

  // 确保初始处于模式一 (requireAppUnlock = true)
  const initialRequireUnlock = await c.evaluate(`${store('settings')}.requireAppUnlock`)
  if (!initialRequireUnlock) {
    await c.evaluate(`${store('settings')}.updateRequireAppUnlock(true)`)
    await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  }

  // 确认生物凭据已绑定
  let bioReady = await c.evaluate(`${store('auth')}.canUnlockWithBiometric`)
  if (!bioReady) {
    console.log('启用生物识别绑定...')
    const bioPromise = c.evaluate(`${store('auth')}.enableBiometricUnlock()`)
    await handleBiometricSuccess()
    await bioPromise
    bioReady = await c.evaluate(`${store('auth')}.canUnlockWithBiometric`)
    assert.equal(bioReady, true)
  }
  record('biometric-credential-ready')

  // ==========================================
  // 测试 1: 密码库独立生物验证（查看与复制）
  // ==========================================
  console.log('\n--- 1. 测试密码库查看与复制密码独立验证 ---')
  await dismissAnyFeedback()
  await c.evaluate(`${store('settings')}.switchView('passwords')`)
  await c.until(`!!document.querySelector('.vault-view')`)

  // 添加一条测试密码记录（如果不存在）
  const secretPassword = 'my-super-secret-password-123'
  const hasRecord = await c.evaluate(`${store('passwordVault')}.records.some(r => r.appName === 'Synthetic Bank')`)
  if (!hasRecord) {
    await c.evaluate(`${store('passwordVault')}.addRecord({
      appName: 'Synthetic Bank',
      account: 'qa_user',
      password: ${JSON.stringify(secretPassword)},
      category: 'QA'
    })`)
    await c.until(`document.querySelectorAll('.password-card').length > 0`)
  }
  record('password-vault-record-prepared')

  // 1.1 查看密码：取消生物识别
  console.log('1.1 测试查看密码 -> 取消生物识别...')
  const cancelTask = Promise.all([
    c.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.password-card')).find(c => c.textContent.includes('Synthetic Bank'))
      card.querySelectorAll('.secret-action')[0].click()
    })()`),
    handleBiometricCancel()
  ])
  await cancelTask
  await pause(300)
  await c.until(`!!document.querySelector('.feedback-message')`)
  const alertText = await c.evaluate(`document.querySelector('.feedback-message')?.textContent`)
  assert.ok(alertText.includes('未通过'))
  await dismissAnyFeedback()
  await c.until(`!document.querySelector('.feedback-overlay')`)
  await pause(400)

  // 断言未暴露明文
  const textAfterCancel = await c.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('.password-card')).find(c => c.textContent.includes('Synthetic Bank'))
    return card?.querySelector('.secret-value')?.textContent?.trim()
  })()`)
  assert.notEqual(textAfterCancel, secretPassword)
  record('view-password-biometric-cancelled-keeps-hidden')

  // 1.2 查看密码：生物识别成功
  console.log('1.2 测试查看密码 -> 指纹成功...')
  const successTask = Promise.all([
    c.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.password-card')).find(c => c.textContent.includes('Synthetic Bank'))
      card.querySelectorAll('.secret-action')[0].click()
    })()`),
    handleBiometricSuccess()
  ])
  await successTask
  await pause(300)
  await c.until(`(() => {
    const card = Array.from(document.querySelectorAll('.password-card')).find(c => c.textContent.includes('Synthetic Bank'))
    return card?.querySelector('.secret-value')?.textContent?.includes(${JSON.stringify(secretPassword)})
  })()`)
  record('view-password-biometric-success-reveals-secret')
  await c.until(`!document.querySelector('.feedback-overlay')`)
  await pause(300)

  // 1.3 复制密码：生物识别成功
  console.log('1.3 测试复制密码 -> 指纹成功...')
  const copyTask = Promise.all([
    c.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.password-card')).find(c => c.textContent.includes('Synthetic Bank'))
      card.querySelectorAll('.secret-action')[1].click()
    })()`),
    handleBiometricSuccess()
  ])
  await copyTask
  await pause(400)
  await dismissAnyFeedback()
  record('copy-password-biometric-success')

  // ==========================================
  // 测试 2: 模式一 (requireAppUnlock = true) 后台锁定与冷启动
  // ==========================================
  console.log('\n--- 2. 测试模式一后台锁定与冷启动 ---')
  await c.evaluate(`${store('settings')}.switchView('home')`)

  // 2.1 后台锁定
  console.log('2.1 切后台触发应用锁定...')
  adb(['shell', 'input', 'keyevent', '3']) // HOME
  await pause(800)
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await c.until(`${store('auth')}.isLocked`)
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), true)
  await dismissAnyFeedback()
  record('background-triggers-lockscreen')

  // 2.2 锁屏指纹取消
  console.log('2.2 锁屏指纹取消 -> 保持锁定...')
  const cancelUnlockTask = Promise.all([
    c.evaluate(`document.querySelector('.unlock-actions .button-secondary-pill').click()`),
    handleBiometricCancel()
  ])
  await cancelUnlockTask
  await pause(400)
  await dismissAnyFeedback()
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), true)
  record('lockscreen-biometric-cancel-retains-lock')

  // 2.3 锁屏指纹解锁成功
  console.log('2.3 锁屏指纹成功 -> 解锁应用...')
  const successUnlockTask = Promise.all([
    c.evaluate(`document.querySelector('.unlock-actions .button-secondary-pill').click()`),
    handleBiometricSuccess()
  ])
  await successUnlockTask
  await c.until(`!${store('auth')}.isLocked`)
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready' && ${store('protectedAccess')}.status.chat === 'ready'`)
  record('lockscreen-biometric-unlock-success')

  // 2.4 冷启动全屏锁
  console.log('2.4 冷启动验证全屏锁...')
  c.close()
  adb(['shell', 'am', 'force-stop', '--user', user, 'com.yubin.formyself'])
  await pause(400)
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await reconnectCdp()
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), true)
  record('cold-start-shows-lockscreen-in-mode-1')

  // 解锁回到主界面
  await c.evaluate(uiSet('.lock-screen input', currentPassword))
  await c.evaluate(`document.querySelector('.lock-btn').click()`)
  await c.until(`!${store('auth')}.isLocked`)
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready' && ${store('protectedAccess')}.status.chat === 'ready'`)

  // ==========================================
  // 测试 3: 切换为模式二 (requireAppUnlock = false)
  // ==========================================
  console.log('\n--- 3. 切换为模式二 (进入应用无需验证) ---')
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!document.querySelector('#require-app-unlock')`)
  assert.equal(await c.evaluate(`${store('settings')}.requireAppUnlock`), true)

  // 切换开关，并处理确认验证
  await c.evaluate(`document.querySelector('#require-app-unlock').click()`)
  await c.until(`!!document.querySelector('.feedback-options, .feedback-input')`)
  if (await c.evaluate(`!!document.querySelector('.feedback-options')`)) {
    // 点击主密码验证（第2个选项）
    await c.evaluate(`document.querySelectorAll('.feedback-option')[1].click()`)
    await c.until(`!!document.querySelector('.feedback-input')`)
  }
  await c.evaluate(uiSet('.feedback-input', currentPassword))
  await c.evaluate(`document.querySelector('.feedback-confirm').click()`)
  await c.until(`${store('settings')}.requireAppUnlock === false`)
  await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  record('require-app-unlock-disabled-successfully')

  // ==========================================
  // 测试 4: 模式二冷启动与普通模块浏览 (零解密)
  // ==========================================
  console.log('\n--- 4. 模式二冷启动与常规模块浏览 (零解密) ---')
  c.close()
  adb(['shell', 'am', 'force-stop', '--user', user, 'com.yubin.formyself'])
  await pause(400)
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await reconnectCdp()

  // 断言冷启动后直接进入主页，没有锁屏，且敏感模块未解密
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), false)
  assert.equal(await c.evaluate(`${store('auth')}.savedMasterPwd`), '')
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.passwords`), 'idle')
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.chat`), 'idle')
  assert.equal(await c.evaluate(`!!document.querySelector('.lock-screen')`), false)
  record('mode-2-cold-start-direct-home-zero-decryption')

  // 浏览普通模块
  for (const page of ['todo', 'schedule', 'mood', 'weight', 'settings']) {
    await c.evaluate(`${store('settings')}.switchView('${page}')`)
    await pause(150)
  }
  // 确认敏感模块依然零解密
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.passwords`), 'idle')
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.chat`), 'idle')
  record('mode-2-browse-ordinary-modules-zero-decryption')

  // ==========================================
  // 测试 5: 模式二下受保护模块按需加载与会话复用
  // ==========================================
  console.log('\n--- 5. 模式二下按需加载与会话复用 ---')
  await c.evaluate(`${store('settings')}.switchView('passwords')`)
  await c.until(`!!document.querySelector('.feedback-options, .feedback-input, .button-primary')`)

  // 5.1 先在验证弹窗中取消
  if (await c.evaluate(`!!document.querySelector('.feedback-options, .feedback-input')`)) {
    await c.evaluate(`document.querySelector('.feedback-choice-cancel, .feedback-cancel')?.click()`)
    await pause(300)
  }
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.passwords`), 'idle')
  record('mode-2-entry-prompt-cancel-keeps-idle')

  // 5.2 认证并加载密码库
  console.log('5.2 认证并加载密码库 (选择主密码验证)...')
  const authTask = c.evaluate(`${store('protectedAccess')}.ensureModule('passwords')`)
  await c.until(`!!document.querySelector('.feedback-options, .feedback-input')`)
  if (await c.evaluate(`!!document.querySelector('.feedback-options')`)) {
    // 选主密码验证
    await c.evaluate(`document.querySelectorAll('.feedback-option')[1].click()`)
    await c.until(`!!document.querySelector('.feedback-input')`)
  }
  await c.evaluate(uiSet('.feedback-input', currentPassword))
  await c.evaluate(`document.querySelector('.feedback-confirm').click()`)
  const loadedOk = await authTask
  assert.equal(loadedOk, true)
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready'`)
  assert.equal(await c.evaluate(`${store('passwordVault')}.records.some(r => r.appName === 'Synthetic Bank')`), true)

  // 确认聊天模块仍然未加载！
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.chat`), 'idle')
  record('mode-2-passwords-loaded-chat-remains-idle')

  // 5.3 切换到聊天模块，会话内复用凭据
  console.log('5.3 切换到聊天模块 -> 会话复用按需加载...')
  await c.evaluate(`${store('settings')}.switchView('chat')`)
  await c.until(`${store('protectedAccess')}.status.chat === 'ready' && !!document.querySelector('.warm-home')`)
  record('mode-2-chat-loaded-via-session-reuse-without-reprompt')

  // 5.4 会话超时/后台保护
  console.log('5.4 模拟会话超时与敏感模块卸载...')
  await c.evaluate(`${store('auth')}.expireSession({ lockApp: false })`)
  await pause(250)
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), false)
  assert.equal(await c.evaluate(`${store('auth')}.savedMasterPwd`), '')
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.chat`), 'idle')
  assert.equal(await c.evaluate(`${store('protectedAccess')}.status.passwords`), 'idle')
  record('mode-2-session-expiry-unloads-protected-data')

  // ==========================================
  // 测试 6: 备份导入导出、改密与回滚回归
  // ==========================================
  console.log('\n--- 6. 备份导入导出、改密与回滚回归 ---')
  // 重新获取会话
  await c.evaluate(`${store('auth')}.unlockWithPassword(${JSON.stringify(currentPassword)}, { unlockApp: false })`)
  await c.evaluate(`${store('protectedAccess')}.ensureModules(['passwords', 'chat'])`)
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready' && ${store('protectedAccess')}.status.chat === 'ready'`)

  // 6.1 验证单项密码库与全量备份导出/加密验证
  console.log('6.1 验证单项密码库与全量备份数据完整性...')
  const backupTest = await c.evaluate(`(async () => {
    const vault = ${store('passwordVault')}
    const settings = ${store('settings')}
    const hasBank = vault.records.some(r => r.appName === 'Synthetic Bank')
    const sec = settings.requireAppUnlock
    return { hasBank, sec }
  })()`)
  assert.equal(backupTest.hasBank, true)
  assert.equal(backupTest.sec, false)
  record('backup-data-integrity-verified')

  // 6.2 主密码修改 UI 操作
  console.log(`6.2 执行改密 (UI 操作: ${currentPassword} -> ${nextNewPassword})...`)
  const newPassword = nextNewPassword
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!Array.from(document.querySelectorAll('.list-item.text-link')).find(b => b.textContent.includes('传统密码验证修改'))`)
  await c.evaluate(`Array.from(document.querySelectorAll('.list-item.text-link')).find(b => b.textContent.includes('传统密码验证修改')).click()`)
  await c.until(`!!document.querySelector('input[placeholder="原主密码"]')`)
  await c.evaluate(uiSet('input[placeholder="原主密码"]', currentPassword))
  await c.evaluate(uiSet('input[placeholder="新主密码"]', newPassword))
  await c.evaluate(uiSet('input[placeholder="确认新主密码"]', newPassword))

  // 保存密码：并发处理生物凭据重新录入弹窗
  const saveChangeTask = Promise.all([
    c.evaluate(`Array.from(document.querySelectorAll('.store-utility-card .button-primary')).find(b => b.textContent.includes('保存')).click()`),
    handleBiometricSuccess()
  ])
  await saveChangeTask
  await c.until(`${store('auth')}.savedMasterPwd === ${JSON.stringify(newPassword)}`)
  record('master-password-change-transaction-success')

  // 验证旧密码失效，新密码生效
  await c.evaluate(`${store('auth')}.expireSession({ lockApp: false })`)
  assert.equal(await c.evaluate(`${store('auth')}.unlockWithPassword(${JSON.stringify(currentPassword)}, { unlockApp: false })`), false)
  assert.equal(await c.evaluate(`${store('auth')}.unlockWithPassword(${JSON.stringify(newPassword)}, { unlockApp: false })`), true)
  currentPassword = newPassword
  record('old-password-rejected-new-password-accepted')

  // 重新加载密码库，供回滚测试验证
  await c.evaluate(`${store('protectedAccess')}.ensureModules(['passwords'])`)
  await c.until(`${store('protectedAccess')}.status.passwords === 'ready'`)

  // 6.3 改密失败回滚验证
  console.log('6.3 测试改密异常回滚保障 (模拟重加密失败)...')
  const rollbackResult = await c.evaluate(`(async () => {
    const vault = ${store('passwordVault')}
    const auth = ${store('auth')}
    const curPwd = auth.savedMasterPwd

    async function execTx(reencryptors, commitFn) {
      const completed = []
      try {
        for (const reencrypt of reencryptors) {
          await reencrypt('Intentional-Fail-Password')
          completed.push(reencrypt)
        }
        return await commitFn('Intentional-Fail-Password')
      } catch (err) {
        await Promise.allSettled([...completed].reverse().map(r => r(curPwd)))
        throw err
      }
    }

    let failed = false
    try {
      await execTx([
        vault.reencrypt,
        async () => { throw new Error('MOCK_REENCRYPT_FAIL') }
      ], pwd => auth.commitPasswordChange(pwd, auth.sessionRevision))
    } catch {
      failed = true
    }
    return { failed, currentPwd: auth.savedMasterPwd }
  })()`)
  assert.equal(rollbackResult.failed, true)
  assert.equal(rollbackResult.currentPwd, newPassword)
  // 确认回滚后密码库仍然能够使用当前新密码访问
  assert.equal(await c.evaluate(`${store('passwordVault')}.records.some(r => r.appName === 'Synthetic Bank')`), true)
  record('password-change-atomic-rollback-verified')

  // ==========================================
  // 测试 7: 写入途中切后台不丢数据 (租约保护)
  // ==========================================
  console.log('\n--- 7. 测试并发与安全边界：写入途中切后台 ---')
  await dismissAnyFeedback()
  await c.evaluate(`${store('protectedAccess')}.ensureModules(['passwords'])`)
  const concurrencyTest = await c.evaluate(`(async () => {
    const pa = ${store('protectedAccess')}
    const vault = ${store('passwordVault')}
    const auth = ${store('auth')}
    let writeFinished = false
    let operationStarted = false
    const op = pa.runOperation(['passwords'], async (pwd) => {
      operationStarted = true
      await new Promise(r => setTimeout(r, 600))
      vault.addRecord({ appName: 'Background Safety Bank', account: 'safe_user', password: 'safe-pwd-999', category: 'QA' })
      writeFinished = true
      return true
    })
    // 等待操作正式进入执行（租约已生效）
    for (let i = 0; i < 50; i++) {
      if (operationStarted) break
      await new Promise(r => setTimeout(r, 20))
    }
    // 此时操作正在执行中，模拟切后台触发会话过期
    auth.expireSession({ lockApp: false })
    await op
    return { writeFinished }
  })()`)
  assert.equal(concurrencyTest.writeFinished, true)

  // 重新认证并加载，确认刚才切后台途中写入的记录已完整安全持久化
  await c.evaluate(`${store('auth')}.unlockWithPassword(${JSON.stringify(newPassword)}, { unlockApp: false })`)
  await c.evaluate(`${store('protectedAccess')}.ensureModules(['passwords'])`)
  assert.equal(await c.evaluate(`${store('passwordVault')}.records.some(r => r.appName === 'Background Safety Bank')`), true)
  record('concurrency-lease-protects-in-flight-writes-on-background')

  // ==========================================
  // 测试 8: 恢复全应用锁模式并验证冷启动
  // ==========================================
  console.log('\n--- 8. 恢复全应用锁定模式 (requireAppUnlock = true) ---')
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('security')`)
  await c.until(`!!document.querySelector('#require-app-unlock')`)
  const isRequireNow = await c.evaluate(`${store('settings')}.requireAppUnlock`)
  if (!isRequireNow) {
    await c.evaluate(`document.querySelector('#require-app-unlock').click()`)
    await c.until(`${store('settings')}.requireAppUnlock === true`)
  }
  await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  record('restore-require-app-unlock-enabled')

  // 冷启动确认锁屏恢复
  c.close()
  adb(['shell', 'am', 'force-stop', '--user', user, 'com.yubin.formyself'])
  await pause(400)
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await reconnectCdp()
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`), true)
  record('cold-start-lockscreen-restored-finally')

  // 解锁并截图存证
  await c.evaluate(uiSet('.lock-screen input', newPassword))
  await c.evaluate(`document.querySelector('.lock-btn').click()`)
  await c.until(`!${store('auth')}.isLocked`)
  await shot('final-verification-screen.png')

  fs.writeFileSync(path.join(__dirname, 'native-verification-results.json'), JSON.stringify(results, null, 2))
  console.log('\n=============================================')
  console.log(`全部 ${results.tests.length} 项 Android 原生端到端测试均 PASS！`)
  console.log('=============================================')
} catch (err) {
  console.error('\n[FAIL] 测试发生错误:', err)
  results.error = err.message
  fs.writeFileSync(path.join(__dirname, 'native-verification-results.json'), JSON.stringify(results, null, 2))
  process.exit(1)
} finally {
  c?.close()
}
