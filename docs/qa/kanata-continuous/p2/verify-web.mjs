// Synthetic, isolated browser context only. Never attach to a user browser/profile.
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = process.env.KANATA_QA_OUTPUT ? resolve(process.env.KANATA_QA_OUTPUT) : dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch({ executablePath: process.env.KANATA_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: {width: 390, height: 844}, reducedMotion: 'reduce' })
const page = await context.newPage()
const results = { startedAt: new Date().toISOString(), browser: browser.version(), pageErrors: [], samples: [] }
page.on('pageerror', error => results.pageErrors.push(error.message))
try {
  await page.goto(process.env.KANATA_WEB_URL || 'http://127.0.0.1:4173')
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
  await page.evaluate(async () => {
    const {useAuthStore} = await import('/src/stores/auth.js')
    const {useProtectedAccessStore} = await import('/src/stores/protectedAccess.js')
    const {useSettingsStore} = await import('/src/stores/settings.js')
    const {Filesystem, Directory, Encoding} = await import('/node_modules/.vite/deps/@capacitor_filesystem.js')
    const {Preferences} = await import('/node_modules/.vite/deps/@capacitor_preferences.js')
    for (const suffix of ['enc','tmp','bak']) await Filesystem.writeFile({path:'formyself/warm-home-v1.'+suffix,data:'Synthetic obsolete bytes '+suffix,directory:Directory.Data,encoding:Encoding.UTF8,recursive:true})
    await Filesystem.writeFile({path:'formyself/p2-nonchat-synthetic.txt',data:'Synthetic nonchat must stay',directory:Directory.Data,encoding:Encoding.UTF8})
    await Preferences.set({key:'my_chat_recovery_encrypted_v1',value:'Synthetic obsolete recovery'})
    await useAuthStore().setMasterPassword('Synthetic-P2-web-only')
    await useProtectedAccessStore().ensureModule('chat')
    useSettingsStore().switchView('chat')
  })
  await page.getByRole('button', { name: '开始准备彼方', exact: true }).click()
  await page.getByRole('button', { name: '暂不准备', exact: true }).click()
  await page.getByText('已取消本次准备。', {exact:true}).waitFor()
  results.cancelZeroSeed = await page.evaluate(async () => {
    const { useKanataStore } = await import('/src/features/chat/kanataStore.js')
    const { Filesystem, Directory } = await import('/node_modules/.vite/deps/@capacitor_filesystem.js')
    let absent = false
    try { await Filesystem.stat({path:'formyself/kanata-v1.enc', directory:Directory.Data}) } catch { absent = true }
    const oldCopies = await Promise.all(['enc','tmp','bak'].map(suffix => Filesystem.stat({path:'formyself/warm-home-v1.'+suffix,directory:Directory.Data})))
    return absent && oldCopies.length === 3 && useKanataStore().snapshot.worlds.length === 0
  })
  if (!results.cancelZeroSeed) throw Error('Cancel must not seed/write')
  await page.getByRole('button', { name: '开始准备彼方', exact: true }).click()
  await page.getByRole('button', { name: '确认清理并准备', exact: true }).click()
  await page.getByText('世界已准备好', {exact:true}).waitFor()
  results.seed = await page.evaluate(async () => {
    const { useKanataStore } = await import('/src/features/chat/kanataStore.js')
    const d = useKanataStore().snapshot
    return {worlds:d.worlds.length, instances:d.instances.length, private:d.conversations.filter(c=>c.type==='private').length, group:d.conversations.filter(c=>c.type==='group').length, messages:d.messages.length, memories:d.memories.length,events:d.events.length}
  })
  if (JSON.stringify(results.seed) !== JSON.stringify({worlds:1,instances:5,private:5,group:1,messages:0,memories:0,events:0})) throw Error('Seed counts')
  results.cleanupWhitelist = await page.evaluate(async () => {
    const {Filesystem, Directory, Encoding} = await import('/node_modules/.vite/deps/@capacitor_filesystem.js')
    const {Preferences} = await import('/node_modules/.vite/deps/@capacitor_preferences.js')
    for (const suffix of ['enc','tmp','bak']) {
      try {await Filesystem.stat({path:'formyself/warm-home-v1.'+suffix,directory:Directory.Data}); return false} catch { /* confirmed synthetic old copy is absent */ }
    }
    return (await Preferences.get({key:'my_chat_recovery_encrypted_v1'})).value === null &&
      (await Filesystem.readFile({path:'formyself/p2-nonchat-synthetic.txt',directory:Directory.Data,encoding:Encoding.UTF8})).data === 'Synthetic nonchat must stay'
  })
  if (!results.cleanupWhitelist) throw Error('Cleanup whitelist failed')
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
  results.coldReload = await page.evaluate(async () => {
    const {useAuthStore} = await import('/src/stores/auth.js')
    const {useProtectedAccessStore} = await import('/src/stores/protectedAccess.js')
    const {useKanataStore} = await import('/src/features/chat/kanataStore.js')
    const {useSettingsStore} = await import('/src/stores/settings.js')
    if (!await useAuthStore().unlockWithPassword('Synthetic-P2-web-only')) return false
    if (!await useProtectedAccessStore().ensureModule('chat')) return false
    useSettingsStore().switchView('chat')
    return useKanataStore().snapshot.instances.length === 5 && useKanataStore().snapshot.worlds.length === 1
  })
  if (!results.coldReload) throw Error('Cold reload failed')
  await page.getByText('世界已准备好', {exact:true}).waitFor()
  await page.screenshot({path:resolve(directory,'web-initialized.png'), fullPage:true})
  results.layout = await page.locator('.kanata-setup').evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1 && el.getBoundingClientRect().width > 0)
  results.samples = await page.evaluate(async () => {
    const { useKanataStore } = await import('/src/features/chat/kanataStore.js')
    const { createKanataRepository } = await import('/src/features/chat/storage/kanataRepository.js')
    const { Filesystem, Directory } = await import('/node_modules/.vite/deps/@capacitor_filesystem.js')
    const { buildKanataChatBackupSnapshot } = await import('/src/features/chat/backup/kanataBackup.js')
    const source = JSON.parse(JSON.stringify(useKanataStore().snapshot)), samples = []
    for (const count of [1000, 10000]) {
      const data = JSON.parse(JSON.stringify(source)), c = data.conversations[0], w = data.worlds[0]
      data.messages = Array.from({length:count}, (_,i) => ({id:'synthetic-message-'+i,worldId:w.id,conversationId:c.id,senderType:'user',senderId:data.identities[0].id,senderNameSnapshot:'合成用户',turnId:'turn-'+i,batchId:'batch-'+i,role:'user',content:'合成容量测量。'.repeat(24),status:'complete',createdAt:i+1,revision:1}))
      const repo = createKanataRepository(); await repo.read('Synthetic-P2-web-only')
      let start = performance.now(); await repo.write(data,'Synthetic-P2-web-only'); await repo.flush(); const saveMs = performance.now()-start
      const stat = await Filesystem.stat({path:'formyself/kanata-v1.enc',directory:Directory.Data})
      await repo.release()
      start=performance.now(); const reloaded = await createKanataRepository().read('Synthetic-P2-web-only'); const coldReadMs=performance.now()-start
      if(reloaded.data.messages.length!==count) throw Error('Roundtrip count')
      start=performance.now(); const backup=buildKanataChatBackupSnapshot(reloaded.data); const backupMs=performance.now()-start
      samples.push({count,jsonBytes:new Blob([JSON.stringify(data)]).size,ciphertextBytes:stat.size,saveMs,coldReadMs,backupMs,backupMessages:backup.data.messages.length,heapAfter:performance.memory?.usedJSHeapSize??null})
    }
    return samples
  })
  results.status='PASS'
} catch(error) { results.status='FAIL'; results.error=error.message; process.exitCode=1 }
finally { await writeFile(resolve(directory,'web-results.json'),JSON.stringify(results,null,2)+'\n'); console.log(JSON.stringify(results,null,2)); await browser.close() }
