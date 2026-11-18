import { sha256Text } from '../../../../../../src/shared/crypto/sha256Text.js'
import { withNativeActivityGuard, isNativeActivityGuardActive, resetNativeActivityGuard } from '../../../../../../src/services/nativeActivityGuard.js'

const check = (condition, code) => { if (!condition) throw Error(code) }
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
async function rejects(action, code) {
  try { await action() }
  catch (error) {
    const actual = error.code ?? error.message ?? String(error)
    check(code instanceof RegExp ? code.test(actual) : actual.includes(code), 'UNEXPECTED_' + actual)
    return
  }
  throw Error('EXPECTED_' + code)
}
const settle = async (predicate, code = 'M4_CLOSEOUT_TIMEOUT') => {
  const deadline = performance.now() + 15000
  while (!predicate()) {
    if (performance.now() > deadline) throw Error(code)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  return c >>> 0
})
const crc32 = data => {
  let c = 0xffffffff
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function buildSyntheticCardPng(cardObj) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13), ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 1); ihdrView.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 6
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])
  const enc = new TextEncoder()
  const jsonBytes = enc.encode(JSON.stringify(cardObj))
  let bin = ''; for (let i = 0; i < jsonBytes.length; i++) bin += String.fromCharCode(jsonBytes[i])
  const b64 = btoa(bin)
  const textPayload = enc.encode('chara\0' + b64)
  const parts = [new Uint8Array(sig), chunk('IHDR', ihdr), chunk('tEXt', textPayload), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

export async function runM4CloseoutDevice(context, fixture, commands, extras) {
  const {
    candidate, auth, pinia, createApp, h, nextTick,
    KanataCandidateWorkspace, KanataLifeCompanion, AppFeedbackHost,
    createKanataSqliteAutonomyRuntime, createKanataSqliteLifeCompanion, createKanataSqliteChatRuntime,
    setTrace, setDeferredFault,
  } = context
  const { grantOriginActors } = extras
  const heapStartBytes = performance.memory?.usedJSHeapSize ?? null

  const health = await candidate.run({ create: true }, async operation => {
    await operation.transaction(async tx => {
      for (const { sql, parameters } of commands) await tx.execute(sql, parameters)
    })
    return operation.health()
  })

  let lastWrite = null
  let traceState = { queries: 0, writes: 0, maxRows: 0, observeQuery: null, observeWrite: cmd => { lastWrite = cmd } }
  const startTrace = observer => {
    traceState = { queries: 0, writes: 0, maxRows: 0, observeQuery: observer ?? null, observeWrite: cmd => { lastWrite = cmd } }
    setTrace(traceState)
  }
  const stopTrace = () => {
    const snap = { queries: traceState.queries, writes: traceState.writes, maxRows: traceState.maxRows }
    traceState = { queries: 0, writes: 0, maxRows: 0, observeQuery: null, observeWrite: cmd => { lastWrite = cmd } }
    setTrace(traceState)
    return snap
  }
  setTrace(traceState)

  let clockNow = Date.UTC(2026, 10, 16, 2, 0, 0) // Monday 10:00 Asia/Shanghai
  let modelCalls = 0
  const worlds = candidate.createWorldRuntime()
  let lastAutoError = null
  const rawAutonomy = createKanataSqliteAutonomyRuntime({
    candidate, auth, clock: () => clockNow,
    completion: async ({ messages }) => { modelCalls++; return { content: '合成设备自治回应-' + messages.length } },
    notify: async () => ({ status: 'scheduled' }),
    requestPermission: async () => 'granted',
  })
  const autonomy = {
    ...rawAutonomy,
    select: id => {
      const ctl = rawAutonomy.select(id)
      return {
        ...ctl,
        runSocial: async guard => {
          try { return await ctl.runSocial(guard) }
          catch (err) { lastAutoError = { code: err?.code, message: err?.message, stack: err?.stack }; throw err }
        },
      }
    },
  }
  const lifecycle = { generation: candidate.generation, isAvailable: candidate.isAvailable, release: candidate.release }
  const createChat = () => createKanataSqliteChatRuntime({
    candidate, auth, releaseOnDispose: false,
    completion: async () => { modelCalls++; return { content: '合成对话回应' } },
  })

  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => [h(KanataCandidateWorkspace, { worlds, lifecycle, createChat, autonomy }), h(AppFeedbackHost)] }).use(pinia)
  const button = text => [...container.querySelectorAll('button')].find(n => n.textContent.trim() === text)
  const entry = id => container.querySelector('[data-entry-id="' + id + '"] button')
  const fill = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }

  const world1 = fixture.messages[0].worldId
  const world1Name = fixture.worlds.find(row => row.id === world1).name
  const world1Actors = fixture.instances.filter(row => row.worldId === world1).map(row => row.id)
  const actorA = world1Actors[0], actorB = world1Actors[1] || world1Actors[0]
  const conv1 = fixture.messages[0].conversationId
  let stage = 'mount'

  try {
    app.mount(container)
    await settle(() => Boolean(button(world1Name)), 'WORLD_DIR_LOAD')

    // === B1: Card Library File Picker (invalid/cancel/oversized avatar/PNG card + sync preview UI) ===
    stage = 'b1-open-lib'
    button('全局角色卡库').click()
    await settle(() => Boolean(button('导入 JSON 或 PNG 角色卡')), 'CARD_LIB_OPEN')
    const fileInputs = () => [...container.querySelectorAll('input[type="file"]')]
    const pickFile = (input, file) => {
      const dt = new DataTransfer()
      if (file) dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event(file ? 'change' : 'cancel', { bubbles: true }))
    }

    // Cancel chooser resets cleanly
    stage = 'b1-cancel'
    button('导入 JSON 或 PNG 角色卡').click()
    await nextTick()
    pickFile(fileInputs()[0], null)
    await settle(() => !button('导入 JSON 或 PNG 角色卡').disabled, 'B_PICKER_CANCEL_RESET')
    check(!button('确认导入角色卡'), 'B_PICKER_CANCEL_RETAINED')

    // Invalid JSON with script payload rejected safely
    stage = 'b1-bad-json'
    button('导入 JSON 或 PNG 角色卡').click()
    await nextTick()
    pickFile(fileInputs()[0], new File(['<script>alert(1)</script>'], 'bad.json', { type: 'application/json' }))
    await settle(() => container.textContent.includes('角色卡操作未完成') && !button('导入 JSON 或 PNG 角色卡').disabled, 'B_INVALID_JSON_REJECT')

    // Native activity guard stays active across file picker window and resets cleanly
    await withNativeActivityGuard(async () => {
      check(isNativeActivityGuardActive(), 'NATIVE_GUARD_ACTIVE')
    })
    resetNativeActivityGuard()
    check(!isNativeActivityGuardActive(), 'NATIVE_GUARD_RESET')

    // Valid JSON v1/v3 card import (>270KB extension payload tests native 262,144 param limit + rawData kept)
    stage = 'b1-json-v3'
    const v3Json = JSON.stringify({
      spec: 'chara_card_v3', spec_version: '3.0',
      data: { name: 'V3扩展卡', description: 'v3简介', personality: '直率', mes_example: '简洁', extensions: { vendor_m4: 'keep-v3-ext', largeBlob: 'x'.repeat(275000) } },
    })
    button('导入 JSON 或 PNG 角色卡').click()
    await nextTick()
    pickFile(fileInputs()[0], new File([v3Json], 'card-v3.json', { type: 'application/json' }))
    await settle(() => Boolean(button('确认导入角色卡')) && !button('确认导入角色卡').disabled, 'B_V3_PARSED')
    button('确认导入角色卡').click()
    await settle(() => Boolean(button('V3扩展卡')) && !button('V3扩展卡').disabled, 'B_V3_IMPORTED')
    const v3Saved = await candidate.withDomains({}, async d => {
      const list = await d.characters.summaries()
      const meta = list.entries.find(c => c.name === 'V3扩展卡')
      if (!meta) return null
      const vp = await d.characters.versions(meta.id)
      return vp.versions.find(v => v.id === meta.currentVersionId) ?? null
    })
    check(v3Saved?.rawData?.data?.extensions?.vendor_m4 === 'keep-v3-ext' && v3Saved?.rawData?.data?.extensions?.largeBlob?.length === 275000, 'B_V3_RAWDATA_KEPT')

    // Valid PNG v2 card with character_book & extensions
    stage = 'b1-png-card'
    const pngBytes = buildSyntheticCardPng({
      spec: 'chara_card_v2', spec_version: '2.0',
      data: {
        name: '设备导入卡', description: '设备PNG导入简介', personality: '沉着', mes_example: '简洁回应',
        extensions: { vendor_m4_png: 'keep-png-raw' },
        character_book: {
          entries: [
            { keys: ['灯塔'], content: '灯塔附带设定-1', constant: false, priority: 40, enabled: true },
            { keys: ['旧钥匙'], content: '附带冲突设定-2', constant: false, priority: 60, enabled: true },
          ],
        },
      },
    })
    button('导入 JSON 或 PNG 角色卡').click()
    await nextTick()
    pickFile(fileInputs()[0], new File([pngBytes], 'card.png', { type: 'image/png' }))
    await settle(() => Boolean(button('确认导入角色卡')) && !button('确认导入角色卡').disabled, 'B_PNG_PARSED')
    button('确认导入角色卡').click()
    await settle(() => Boolean(button('设备导入卡')) && !button('设备导入卡').disabled, 'B_PNG_IMPORTED')

    // Open imported card, test >2MB avatar rejection
    stage = 'b1-avatar'
    button('设备导入卡').click()
    await settle(() => Boolean(button('替换自定义 PNG 头像')) && !button('替换自定义 PNG 头像').disabled, 'B_OPEN_DRAFT')
    button('替换自定义 PNG 头像').click()
    await nextTick()
    const bigAvatar = new File([new Uint8Array(2 * 1024 * 1024 + 64)], 'huge.png', { type: 'image/png' })
    pickFile(fileInputs()[1], bigAvatar)
    await settle(() => container.textContent.includes('角色卡操作未完成') && !button('关闭卡详情').disabled, 'B_AVATAR_LIMIT')

    // Close library cleanly and select World 1
    stage = 'a-select-world1'
    button('关闭卡详情').click()
    button('关闭角色卡库').click()
    await settle(() => Boolean(button(world1Name)), 'B_CLOSE_LIB')
    button(world1Name).click()
    await settle(() => Boolean(button('复制设定') && button('角色与授权')), 'WORLD1_OPEN')

    // === A: UI Copy World ===
    stage = 'a-copy'
    button('复制设定').click()
    await settle(() => Boolean(button('确认复制为新世界')), 'A_COPY_FORM')
    const copyForm = container.querySelector('[aria-label="复制世界设定"]')
    const copyName = world1Name + ' · 设备副本'
    fill(copyForm.querySelector('input'), copyName)
    await nextTick()
    copyForm.requestSubmit()
    await settle(() => container.querySelector('h3')?.textContent.trim() === copyName, 'A_COPY_SELECTED')
    const copiedOverview = await candidate.withDomains({}, async domains => {
      const worldsPage = await domains.worlds.list()
      const copied = worldsPage.worlds.find(w => w.name === copyName)
      check(copied && copied.id !== world1, 'A_COPY_DISTINCT_ID')
      const mems = await domains.memories.listManaged(copied.id)
      const evs = await domains.events.list(copied.id)
      const lores = await domains.lorebook.list(copied.id)
      const actors = await domains.characters.listInstances(copied.id)
      const convs = await domains.conversations.list(copied.id)
      check(mems.entries.length === 0 && evs.events.length === 0, 'A_COPY_NO_HISTORY')
      check(lores.entries.length > 0 && actors.instances.length > 0, 'A_COPY_STATIC_PRESENT')
      check(!convs.conversations.some(c => c.type === 'character'), 'A_COPY_NO_CHAR_CHATS')
      return copied
    })
    stage = 'a-return-list'
    button('返回世界列表').click()
    await settle(() => Boolean(button(world1Name)), 'A_RETURN_LIST')

    // === B2: Add card into World 1, instance override, card sync UI with appConfirm, attach lore skipping conflict ===
    stage = 'b2-open-w1'
    await settle(() => Boolean(button(world1Name)) && !button(world1Name).disabled, 'A_RETURN_LIST_READY')
    button(world1Name).click()
    stage = 'b2-actors-tab'
    await settle(() => Boolean(button('角色与授权')) && Boolean(button('复制设定')) && !button('复制设定').disabled, 'B_REOPEN_W1')
    button('角色与授权').click()
    stage = 'b2-open-picker'
    await settle(() => Boolean(button('从全局库加入角色')) && !button('从全局库加入角色').disabled, 'B_ACTORS_TAB')
    button('从全局库加入角色').click()
    stage = 'b2-pick-card'
    await settle(() => Boolean(button('加入 设备导入卡')) && !button('加入 设备导入卡').disabled, 'B_PICKER_CARD')
    button('加入 设备导入卡').click()
    stage = 'b2-open-actor-detail'
    await settle(() => !button('加入 设备导入卡') && Boolean(button('设备导入卡')) && !button('设备导入卡').disabled, 'B_ACTOR_ADDED')
    button('设备导入卡').click()
    await settle(() => Boolean(button('实例设定') && button('附带世界书')), 'B_ACTOR_DETAIL')
    // Toggle grant checkbox in UI and verify workspace does NOT exit and refreshes revision
    const todoReadBox = container.querySelector('[data-module="todo"] input[type="checkbox"]')
    check(Boolean(todoReadBox), 'B_GRANT_BOX_PRESENT')
    todoReadBox.click()
    await nextTick()
    await settle(() => !container.textContent.includes('正在读取或保存…') && container.textContent.includes('生活资料授权')
      && Boolean(button('实例设定')) && !button('实例设定').disabled, 'B_GRANT_STAYS_IN_WORKSPACE')

    // Edit instance override (change speechStyle, retain custom override across sync)
    button('实例设定').click()
    await settle(() => Boolean(button('保存实例设定')), 'B_INSTANCE_FORM')
    const instForm = container.querySelector('[aria-label="角色实例覆盖"]')
    const instInputs = instForm.querySelectorAll('textarea')
    fill(instInputs[1], '设备实例独立说话习惯')
    await nextTick()
    instForm.requestSubmit()
    await settle(() => !container.querySelector('[aria-label="角色实例覆盖"]') && Boolean(button('设备导入卡')) && !button('设备导入卡').disabled, 'B_INSTANCE_SAVED')

    // Attach card lore with existing conflict skipped
    const importedInst = await candidate.withDomains({}, async d => {
      const p = await d.characters.listInstances(world1)
      return p.instances.find(i => !world1Actors.includes(i.id))
    })
    check(importedInst, 'B_ADDED_INSTANCE_FOUND')
    const uiGrant = await candidate.withDomains({}, d => d.autonomy.getGrant(world1, importedInst.id, 'todo'))
    check(Boolean(uiGrant && uiGrant.read === true), 'B_GRANT_UI_PERSISTED')
    await candidate.withDomains({}, domains => domains.lorebook.save({
      id: 'w1-conflict-lore', worldId: world1, scope: 'character', ownerId: importedInst.id,
      keys: ['旧钥匙'], content: '附带冲突设定-2', activationRule: 'keyword', visibility: 'private',
      knownBy: [importedInst.id], revision: 1, enabled: true, priority: 50, sourceTag: 'w1-conflict-tag',
    }, null))
    button('设备导入卡').click()
    await settle(() => Boolean(button('附带世界书')) && !button('附带世界书').disabled, 'B_ACTOR_FOR_LORE')
    button('附带世界书').click()
    await settle(() => Boolean(button('跳过冲突并导入')) && !button('跳过冲突并导入').disabled, 'B_LORE_PREVIEW')
    button('跳过冲突并导入').click()
    await settle(() => !button('跳过冲突并导入'), 'B_LORE_ATTACHED')

    // Add the same card into copiedOverview so multi-world applySync refresh is proven on device
    button('返回世界列表').click()
    await settle(() => Boolean(button(copyName)) && !button(copyName).disabled, 'B_OPEN_COPY_FOR_MULTI')
    button(copyName).click()
    await settle(() => Boolean(button('角色与授权')) && !button('角色与授权').disabled, 'B_COPY_ACTORS')
    button('角色与授权').click()
    await settle(() => Boolean(button('从全局库加入角色')) && !button('从全局库加入角色').disabled, 'B_COPY_ADD_BTN')
    button('从全局库加入角色').click()
    await settle(() => Boolean(button('加入 设备导入卡')) && !button('加入 设备导入卡').disabled, 'B_COPY_PICKER')
    button('加入 设备导入卡').click()
    await settle(() => !button('加入 设备导入卡') && Boolean(button('设备导入卡')), 'B_COPY_ADDED')

    // Publish card v2 and sync via KanataCandidateCardLibrary appConfirm (verify multi-world remaining list)
    button('返回世界列表').click()
    await settle(() => Boolean(button('全局角色卡库')) && !button('全局角色卡库').disabled, 'B_BACK_FOR_SYNC')
    button('全局角色卡库').click()
    await settle(() => Boolean(button('设备导入卡')) && !button('设备导入卡').disabled, 'B_SYNC_LIB')
    button('设备导入卡').click()
    await settle(() => Boolean(button('发布新卡版本')) && !button('发布新卡版本').disabled, 'B_SYNC_DRAFT')
    const cardForm = container.querySelector('article form.kanata-form')
    fill(cardForm.querySelector('textarea'), '设备PNG导入简介-v2')
    await nextTick()
    button('发布新卡版本').click()
    await settle(() => !button('发布新卡版本') && Boolean(button('设备导入卡')) && !button('设备导入卡').disabled, 'B_PUBLISHED_V2')
    const pngV2 = await candidate.withDomains({}, async d => {
      const list = await d.characters.summaries()
      const meta = list.entries.find(c => c.name === '设备导入卡')
      if (!meta) return null
      const vp = await d.characters.versions(meta.id)
      return vp.versions.find(v => v.id === meta.currentVersionId) ?? null
    })
    check(pngV2?.rawData?.data?.extensions?.vendor_m4_png === 'keep-png-raw', 'B_PNG_V2_RAWDATA_KEPT')
    button('设备导入卡').click()
    await settle(() => container.textContent.includes('版本 2') && Boolean(button('同步世界实例')) && !button('同步世界实例').disabled, 'B_SYNC_BTN')
    button('同步世界实例').click()
    await settle(() => [...container.querySelectorAll('button')].some(b => b.textContent.trim() === '同步 ' + world1Name), 'B_SYNC_LIST')
    const syncBtn = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === '同步 ' + world1Name)
    syncBtn.click()
    await settle(() => Boolean([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步这个实例')), 'B_CONFIRM_OPEN')
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步这个实例').click()
    await settle(() => container.textContent.includes('所选世界实例已同步'), 'B_SYNC_DONE')
    await settle(() => ![...container.querySelectorAll('button')].some(b => b.textContent.trim() === '同步 ' + world1Name)
      && [...container.querySelectorAll('button')].some(b => b.textContent.trim() === '同步 ' + copyName), 'B_MULTI_WORLD_SYNC_REMAINING')
    button('关闭卡详情').click()
    button('关闭角色卡库').click()
    await settle(() => Boolean(button(world1Name)), 'B_CLOSE_AFTER_SYNC')

    // === C-UI: Real LoreEditor UI create with keywords + priority ===
    stage = 'c-lore-ui'
    button(world1Name).click()
    await settle(() => Boolean(button('世界书')) && !button('世界书').disabled, 'C_OPEN_W1')
    button('世界书').click()
    await settle(() => Boolean(button('新建世界书设定')) && !button('新建世界书设定').disabled, 'C_LORE_TAB')
    button('新建世界书设定').click()
    await settle(() => Boolean(container.querySelector('[aria-label="候选世界书编辑"] textarea')), 'C_LORE_EDITOR')
    const loreSec = container.querySelector('[aria-label="候选世界书编辑"]')
    fill(loreSec.querySelector('textarea'), '设备UI世界书正文')
    const loreInputs = loreSec.querySelectorAll('form input')
    fill(loreInputs[0], '星港、灯塔')
    fill(loreInputs[1], '潮汐')
    fill(loreSec.querySelector('input[type="number"]'), '88')
    await nextTick()
    loreSec.querySelector('form').requestSubmit()
    await settle(() => !container.querySelector('[aria-label="候选世界书编辑"]') && container.textContent.includes('世界书'), 'C_LORE_UI_SAVED')
    button('返回世界列表').click()
    await settle(() => Boolean(button(world1Name)), 'C_BACK_FROM_LORE')

    // === C: Lorebook >50 knownBy bounded SQL read ===
    stage = 'c-wide-lorebook'
    const wideActors = Array.from({ length: 65 }, (_, i) => i === 0 ? actorA : `w1-wide-c-${i - 1}`)
    await candidate.run({}, operation => operation.transaction(async tx => {
      await tx.execute(grantOriginActors, [63, 'w1-wide-c-', world1, actorA])
    }))
    await candidate.withDomains({}, domains => domains.lorebook.save({
      id: 'device-wide-lore', worldId: world1, scope: 'world', ownerId: world1,
      keys: ['宽知晓'], content: '超过50人知晓的设定正文', activationRule: 'keyword', visibility: 'public',
      enabled: true, priority: 75, revision: 1, sourceTag: 'device-wide-tag', knownBy: wideActors,
    }, null))
    startTrace()
    const wideLorePage = await candidate.withDomains({}, domains => domains.lorebook.list(world1))
    const loreTrace = stopTrace()
    const fetchedWide = wideLorePage.entries.find(e => e.id === 'device-wide-lore')
    check(fetchedWide && fetchedWide.knownBy.length === 65 && loreTrace.maxRows <= 51, 'C_WIDE_KNOWNBY_BOUNDED')

    // === D: Descendant Share Withdrawal + Memory Policy + Stale/Orphan Reject ===
    stage = 'd-memory-share'
    const w1Record = await candidate.withDomains({}, d => d.worlds.get(world1))
    await candidate.withRepositories({}, messages => messages.insert({
      id: 'device-d-src', worldId: world1, conversationId: conv1, role: 'user', senderType: 'user',
      senderId: w1Record.identity.id, senderNameSnapshot: w1Record.identity.displayName, content: 'D源消息',
      createdAt: clockNow - 10 * 60000, revision: 1, status: 'complete', turnId: 'd-turn', batchId: 'd-turn', lifeSources: [],
    }))
    for (const aid of [actorA, actorB, 'w1-wide-c-1']) {
      const g = await candidate.withDomains({}, d => d.autonomy.getGrant(world1, aid, 'todo'))
      await candidate.withDomains({}, d => d.autonomy.setGrant(world1, aid, 'todo', g?.revision ?? null, { read: true, remember: true, share: true }))
    }
    const mRoot = await candidate.withDomains({}, d => d.memories.save({
      id: 'device-root-mem', worldId: world1, ownerType: 'character', ownerId: actorA, layer: 'L3', key: '设备分享链',
      content: '秘密回忆内容', sourceRefs: [{ messageId: 'device-d-src', revision: 1 }], status: 'active', revision: 1,
      visibility: 'private', knownBy: [actorA], confidence: 'confirmed',
    }, null))
    const mS1 = await candidate.withDomains({}, d => d.memories.shareManaged({ worldId: world1, instanceId: actorA }, mRoot.id, 1, actorB, 'dev-sh-1'))
    const mS2 = await candidate.withDomains({}, d => d.memories.shareManaged({ worldId: world1, instanceId: actorB }, mS1.id, 1, 'w1-wide-c-1', 'dev-sh-2'))
    await candidate.withDomains({}, d => d.memories.withdrawShare({ worldId: world1, instanceId: actorA }, mRoot.id, mS1.id, 1, 'dev-wd-1'))
    let dRevokedReads = 0
    startTrace(rows => { for (const r of rows) if (Object.hasOwn(r, 'content')) dRevokedReads++ })
    await rejects(() => candidate.withDomains({}, d => d.memories.readFor({ worldId: world1, instanceId: 'w1-wide-c-1' }, mS2.id)), /MEMORY_UNAVAILABLE|CONTEXT_DENIED/)
    stopTrace()
    check(dRevokedReads === 0, 'D_REVOKED_BODY_ZERO')

    // === E: All 6 Event Kinds on SQLCipher ===
    stage = 'e-six-events'
    const relRow = await candidate.withDomains({}, async d => {
      const p = await d.events.relationshipContext(world1, { instanceId: actorA, group: false }, 24000)
      return p.relationships[0]
    })
    check(relRow, 'E_REL_EXISTS')
    for (const [idx, kind] of ['note', 'promise', 'support', 'conflict', 'rest', 'move'].entries()) {
      const useRel = kind === 'support' || kind === 'conflict'
      const action = useRel ? { relationshipId: relRow.id } : kind === 'move' ? { instanceId: actorA, location: '设备地点-' + idx } : { instanceId: actorA }
      const participants = useRel ? [relRow.fromId, relRow.toId] : [actorA]
      const { id } = await candidate.withDomains({}, d => d.events.proposeAcknowledged({
        worldId: world1, participantIds: participants, sourceRefs: [], causedByEventIds: [], visibility: 'public',
        summary: '设备事件-' + kind, effectiveAt: clockNow + idx, causality: 'explicit', kind, action,
      }, 'dev-ev-' + kind))
      await candidate.withDomains({}, d => d.events.commitAcknowledged(world1, id, 1))
    }

    // === F: Autonomy UI + Social + Contact + LifeCompanion UI & Grants ===
    stage = 'f-autonomy-ui'
    button(world1Name).click()
    await settle(() => Boolean(button('自治任务')), 'F_OPEN_WORLD')
    button('自治任务').click()
    await settle(() => Boolean(button('保存世界开关') && !button('保存世界开关').disabled && button('添加虚拟日程')), 'F_PANEL_READY')
    const actForm = container.querySelector('[aria-label="候选世界自治管理"] fieldset.kanata-permission-fields')
    const actBoxes = actForm.querySelectorAll('input[type="checkbox"]')
    for (const box of actBoxes) if (!box.checked) box.click()
    button('保存世界开关').click()
    await nextTick()
    await settle(() => Boolean(button('现在有限补算') && !button('现在有限补算').disabled), 'F_FLAGS_SAVED')

    await candidate.withDomains({}, async d => {
      const gA = await d.autonomy.getGrant(world1, actorA, 'todo')
      await d.autonomy.setGrant(world1, actorA, 'todo', gA?.revision ?? null, { read: true, remember: true, share: true })
      const gB = await d.autonomy.getGrant(world1, actorB, 'todo')
      await d.autonomy.setGrant(world1, actorB, 'todo', gB?.revision ?? null, { read: true, remember: true, share: true })
      const latestGA = await d.autonomy.getGrant(world1, actorA, 'todo')
      const sharedEv = await d.events.proposeAcknowledged({
        worldId: world1, participantIds: [actorA, actorB], sourceRefs: [], causedByEventIds: [], visibility: 'public',
        summary: '设备共享共同事件', effectiveAt: clockNow - 1000, causality: 'explicit', kind: 'note', action: { instanceId: actorA },
        lifeSources: [{ grantId: latestGA.id, revision: latestGA.revision, moduleId: 'todo', instanceId: actorA, fingerprint: 'b'.repeat(64) }],
      }, 'dev-social-shared-ev')
      await d.events.commitAcknowledged(world1, sharedEv.id, 1)
    })
    // Configure via real ActivityPanel UI form (limit + actor flags + two schedules) + quiet hours alignment
    const panelForm = container.querySelector('[aria-label="自治策略与虚拟日程"]')
    const limitInput = panelForm.querySelector('input[type="number"]')
    fill(limitInput, '2')
    for (const aid of [actorA, actorB]) {
      const row = panelForm.querySelector(`[data-autonomy-actor="${aid}"]`)
      check(Boolean(row), 'F_ACTOR_ROW_' + aid)
      for (const box of row.querySelectorAll('input[type="checkbox"]')) if (!box.checked) box.click()
    }
    for (const [aid, act] of [[actorA, '喝咖啡'], [actorB, '看时刻表']]) {
      button('添加虚拟日程').click()
      await settle(() => Boolean(container.querySelector('[aria-label="编辑虚拟日程"]')), 'F_SCHED_DRAFT_OPEN')
      const sdForm = container.querySelector('[aria-label="编辑虚拟日程"]')
      const roleBtns = [...sdForm.querySelectorAll('[role="radiogroup"][aria-label="角色"] button')]
      const idx = aid === actorA ? 0 : 1
      if (roleBtns[idx]) roleBtns[idx].click()
      const sdInputs = sdForm.querySelectorAll('input:not([type="checkbox"])')
      fill(sdInputs[0], '中央车站')
      fill(sdInputs[1], act)
      sdForm.requestSubmit()
      await settle(() => !container.querySelector('[aria-label="编辑虚拟日程"]'), 'F_SCHED_DRAFT_KEPT')
    }
    panelForm.requestSubmit()
    await settle(() => container.textContent.includes('角色开关与虚拟日程已保存。') && !button('保存角色与日程').disabled, 'F_CONFIG_UI_SAVED')
    await candidate.withDomains({}, async d => {
      const cfg = await d.autonomy.readConfig(world1)
      await d.autonomy.configure(world1, cfg.world.revision, {
        policy: { ...cfg.policy, quietStartMinute: 0, quietEndMinute: 0, dailyDialogueLimit: 2 },
        instanceFlags: [{ id: actorA, autonomyEnabled: true, proactiveEnabled: true }, { id: actorB, autonomyEnabled: true, proactiveEnabled: true }],
        schedules: [
          { id: 'dev-sc-a', worldId: world1, instanceId: actorA, days: [1], startMinute: 0, endMinute: 1439, location: '中央车站', activity: '喝咖啡', resting: false, revision: 1 },
          { id: 'dev-sc-b', worldId: world1, instanceId: actorB, days: [1], startMinute: 0, endMinute: 1439, location: '中央车站', activity: '看时刻表', resting: false, revision: 1 },
        ],
      }, clockNow)
    })
    clockNow += 35 * 60000
    button('现在有限补算').click()
    await settle(() => container.textContent.includes('已有限补算 1 个时间窗口。') && !button('现在有限补算').disabled, 'F_ADVANCE_UI')
    button('生成角色交流').click()
    await nextTick()
    try {
      await settle(() => container.textContent.includes('已完成一场角色间交流。') && !button('生成角色交流').disabled, 'F_SOCIAL_UI')
    } catch (socialErr) {
      const planDiag = await candidate.withDomains({}, d => d.autonomy.planSocial(world1, clockNow)).catch(e => String(e))
      const cfgDiag = await candidate.withDomains({}, d => d.autonomy.readConfig(world1)).catch(e => String(e))
      throw Error(socialErr.message + '::' + JSON.stringify({
        lastAutoError,
        panelText: container.querySelector('[aria-label="候选世界自治管理"]')?.textContent?.slice(0, 300),
        planDiag,
        cfgDiag,
        clockNow,
      }))
    }
    clockNow += 7 * 3600000
    button('现在有限补算').click()
    await settle(() => !container.textContent.includes('已完成一场角色间交流。') && container.textContent.includes('个时间窗口。') && !button('现在有限补算').disabled, 'F_BEFORE_CONTACT')
    button('检查主动联系').click()
    await settle(() => container.textContent.includes('未到联系时间') && !button('检查主动联系').disabled, 'F_CONTACT_PLANNED')
    clockNow += 180000
    button('检查主动联系').click()
    await settle(() => container.textContent.includes('已生成并发送一次主动联系。') && !button('检查主动联系').disabled, 'F_CONTACT_UI')

    // Candidate LifeCompanion UI test: exact binding + remember=false vs true + cross-module isolation + private history
    stage = 'f-life-ui'
    const lifeBox = document.createElement('div')
    document.body.append(lifeBox)
    const seenLifePrompts = []
    let replyTag = '设备陪伴回应成功'
    const companionFactory = {
      create: () => createKanataSqliteLifeCompanion({
        candidate, auth, clock: () => clockNow,
        readers: {
          todo: async () => ({ todayItems: [{ id: 'dev-todo-1', title: '设备合成待办' }] }),
          mood: async () => ({ recent: [{ id: 'dev-mood-1', label: '平静' }] }),
        },
        completion: async ({ messages: reqMsgs }) => {
          modelCalls++
          seenLifePrompts.push(reqMsgs.map(m => String(m.content)).join('\n'))
          return { content: replyTag }
        },
      }),
    }
    const lifeApp = createApp({ render: () => [h(KanataLifeCompanion, { moduleId: 'todo', candidate: companionFactory })] }).use(pinia)
    const moodBox = document.createElement('div')
    document.body.append(moodBox)
    const moodApp = createApp({ render: () => [h(KanataLifeCompanion, { moduleId: 'mood', candidate: companionFactory })] }).use(pinia)
    const homeBox = document.createElement('div')
    document.body.append(homeBox)
    const homeApp = createApp({ render: () => [h(KanataLifeCompanion, { moduleId: 'home', candidate: companionFactory })] }).use(pinia)
    try {
      await candidate.withRepositories({}, messages => messages.insert({
        id: 'dev-life-priv-hist', worldId: world1, conversationId: conv1, role: 'user', senderType: 'user',
        senderId: w1Record.identity.id, senderNameSnapshot: w1Record.identity.displayName, content: '设备私聊历史-保留',
        createdAt: clockNow - 5000, revision: 1, status: 'complete', turnId: 'dev-hist-t', batchId: 'dev-hist-t', lifeSources: [],
      }))
      await candidate.withDomains({}, async d => {
        const rb = await d.roleBindings.read()
        await d.roleBindings.set('todo', { worldId: world1, instanceId: actorA }, rb.revision)
        const rb2 = await d.roleBindings.read()
        await d.roleBindings.set('mood', { worldId: world1, instanceId: actorA }, rb2.revision)
        const rb3 = await d.roleBindings.read()
        await d.roleBindings.set('home', { worldId: world1, instanceId: actorA }, rb3.revision)
        const gr = await d.autonomy.getGrant(world1, actorA, 'todo')
        await d.autonomy.setGrant(world1, actorA, 'todo', gr.revision, { read: true, remember: false, share: false })
        const gMood = await d.autonomy.getGrant(world1, actorA, 'mood')
        await d.autonomy.setGrant(world1, actorA, 'mood', gMood?.revision ?? null, { read: true, remember: false, share: false })
        const gHome = await d.autonomy.getGrant(world1, actorA, 'home')
        await d.autonomy.setGrant(world1, actorA, 'home', gHome?.revision ?? null, { read: true, remember: true, share: false })
      })
      lifeApp.mount(lifeBox)
      const askBtn = () => [...lifeBox.querySelectorAll('button')].find(b => b.textContent.trim() === '让所选角色回应')
      const beforeLifeMems = await candidate.withDomains({}, d => d.memories.listManaged(world1)).then(p => p.entries.length)
      askBtn().click()
      await settle(() => lifeBox.textContent.includes('设备陪伴回应成功'), 'F_LIFE_UI_REPLY')
      const afterNoRemember = await candidate.withDomains({}, d => d.memories.listManaged(world1)).then(p => p.entries.length)
      check(afterNoRemember === beforeLifeMems, 'F_LIFE_NO_REMEMBER_RESPECTED')
      check(seenLifePrompts.at(-1).includes('设备私聊历史-保留'), 'F_LIFE_HISTORY_INCLUDED')

      // Aggregated 'home' reads granted 'todo' submodule while skipping memory persistence when 'todo' remember=false
      homeApp.mount(homeBox)
      replyTag = '首页聚合实机回应'
      ;[...homeBox.querySelectorAll('button')].find(b => b.textContent.trim() === '让所选角色回应').click()
      await settle(() => homeBox.textContent.includes('首页聚合实机回应'), 'F_LIFE_HOME_AGGREGATE')
      check(seenLifePrompts.at(-1).includes('设备合成待办'), 'F_LIFE_HOME_READS_TODO')
      check((await candidate.withDomains({}, d => d.memories.listManaged(world1)).then(p => p.entries.length)) === beforeLifeMems, 'F_LIFE_HOME_RESPECTS_CHILD_REMEMBER')

      // Enable remember on todo, generate active todo-scoped memory, verify mood request does NOT receive todo secret
      replyTag = '设备TODO秘密-ONLY'
      await candidate.withDomains({}, async d => {
        const gr = await d.autonomy.getGrant(world1, actorA, 'todo')
        await d.autonomy.setGrant(world1, actorA, 'todo', gr.revision, { read: true, remember: true, share: false })
      })
      askBtn().click()
      await settle(() => lifeBox.textContent.includes('设备TODO秘密-ONLY'), 'F_LIFE_REMEMBER_TODO')
      await candidate.withDomains({}, async d => {
        let todoMem = null
        let cur = ''
        do {
          const page = await d.memories.listManaged(world1, cur)
          todoMem = page.entries.find(m => m.key.startsWith('life:todo:')) ?? todoMem
          cur = page.cursor ?? ''
        } while (!todoMem && cur)
        check(Boolean(todoMem), 'F_LIFE_CANDIDATE_FOUND')
        const preview = await d.memories.previewConflicts({ worldId: world1, instanceId: actorA }, todoMem.id)
        await d.memories.confirmConflicts({ worldId: world1, instanceId: actorA }, preview.plan, 'dev-adopt-todo-' + todoMem.id)
      })
      replyTag = '心情回应完成'
      moodApp.mount(moodBox)
      ;[...moodBox.querySelectorAll('button')].find(b => b.textContent.trim() === '让所选角色回应').click()
      await settle(() => moodBox.textContent.includes('心情回应完成'), 'F_LIFE_MOOD_REPLY')
      check(!seenLifePrompts.at(-1).includes('设备TODO秘密-ONLY'), 'F_LIFE_CROSS_MODULE_ISOLATION')

      // Archive world1 -> no same-name fallback to copied world!
      const w1Cur = await candidate.withDomains({}, d => d.worlds.get(world1))
      await candidate.withDomains({}, d => d.worlds.archive(world1, w1Cur.world.revision, true))
      askBtn().click()
      await settle(() => lifeBox.textContent.includes('已绑定角色不可用，请重新选择。'), 'F_LIFE_NO_NAME_FALLBACK')
      await candidate.withDomains({}, d => d.worlds.archive(world1, w1Cur.world.revision + 1, false))
    } finally {
      homeApp.unmount()
      homeBox.remove()
      moodApp.unmount()
      moodBox.remove()
      lifeApp.unmount()
      lifeBox.remove()
    }

    // Contact notify-failure recovery & AbortSignal-ignored rejection on SQLCipher
    stage = 'f-contact-faults'
    clockNow = Date.UTC(2026, 10, 18, 4, 0, 0)
    await candidate.withDomains({}, async d => {
      const cfg = await d.autonomy.readConfig(world1)
      await d.autonomy.setActivity(world1, cfg.world.revision, { autonomyEnabled: true, proactiveEnabled: true, notificationsEnabled: true }, clockNow)
      const cfg2 = await d.autonomy.readConfig(world1)
      const scheds = await d.autonomy.schedulesPage(world1)
      await d.autonomy.configure(world1, cfg2.world.revision, {
        policy: cfg2.policy,
        instanceFlags: [{ id: actorA, autonomyEnabled: true, proactiveEnabled: true }, { id: actorB, autonomyEnabled: true, proactiveEnabled: true }],
        schedules: scheds.entries,
      }, clockNow)
    })
    const notifyFailAuto = createKanataSqliteAutonomyRuntime({
      candidate, auth, clock: () => clockNow,
      completion: async () => { modelCalls++; return { content: '通知失败但接触保留' } },
      notify: async () => { throw new Error('DEV_NOTIFY_DENIED') },
    })
    try {
      const plannedFail = await candidate.withDomains({}, d => d.autonomy.planContact(world1, clockNow))
      check(plannedFail && plannedFail.hasContact, 'F_NOTIFY_FAIL_PLAN')
      clockNow += 130000
      const resFail = await notifyFailAuto.select(world1).runContact()
      check(resFail.status === 'succeeded', 'F_NOTIFY_FAIL_SUCCEEDED')
      const metaJson = await candidate.withDomains({}, async d => {
        let buf = ''
        let cur
        do {
          const res = await d.autonomy.taskJsonChunk(world1, plannedFail.id, 'metadata', cur)
          buf += res.part
          cur = res.cursor
        } while (cur)
        return buf
      })
      check(JSON.parse(metaJson)?.contact?.notificationState === 'failed', 'F_NOTIFY_FAIL_STATE_RECORDED')
    } finally {
      notifyFailAuto.dispose()
    }
    clockNow = Date.UTC(2026, 10, 19, 4, 0, 0)
    const abortIgnoredAuto = createKanataSqliteAutonomyRuntime({
      candidate, auth, clock: () => clockNow,
      completion: async () => { abortIgnoredAuto.cancel(); return { content: '绝不提交到SQLCipher' } },
    })
    try {
      const plannedAbort = await candidate.withDomains({}, d => d.autonomy.planContact(world1, clockNow))
      check(plannedAbort && plannedAbort.hasContact, 'F_ABORT_IGNORED_PLAN')
      clockNow += 130000
      await rejects(() => abortIgnoredAuto.select(world1).runContact(), /ABORTED|EXPIRED/)
      const { abortedHeader, runningCount } = await candidate.withDomains({}, async d => {
        const hdr = await d.autonomy.taskHeader(world1, plannedAbort.id)
        let running = 0
        let cur
        do {
          const page = await d.autonomy.listTasks(world1, cur)
          for (const t of page.tasks) if (t.kind === 'proactive' && t.state === 'running') running++
          cur = page.cursor
        } while (cur)
        return { abortedHeader: hdr, runningCount: running }
      })
      check(abortedHeader?.state === 'failed' && runningCount === 0, 'F_ABORT_FAILTASK_CLEAN')
    } finally {
      abortIgnoredAuto.dispose()
    }

    // === G / MR6: Fault Matrix (COMMIT failure + corrupt cursor) & 1000-row bounded pagination ===
    stage = 'g-fault-scale'
    await rejects(() => candidate.withDomains({}, d => d.lorebook.list(world1, { bad: 'cursor' })), 'INVALID')
    const pBefore = await candidate.withDomains({}, d => d.memories.policy(world1))
    setDeferredFault()
    await rejects(() => candidate.withDomains({}, d => d.memories.savePolicy(world1, pBefore?.revision ?? null, {
      strategy: 'custom', enabled: true, recentMessages: 6, summarizeAfter: 12, extractAfter: 4, contextBudget: 12000,
    }, 'dev-fault-policy')), 'TRANSACTION_FAILED')
    setDeferredFault(null)
    const pAfter = await candidate.withDomains({}, d => d.memories.policy(world1))
    check((pAfter?.revision ?? null) === (pBefore?.revision ?? null), 'MR6_COMMIT_FAULT_ROLLBACK')

    // 1000-entry bounded lorebook scan on SQLCipher
    await candidate.withDomains({}, async d => {
      for (let i = 0; i < 1000; i++) {
        await d.lorebook.save({
          id: 'scale-lore-' + i, worldId: world1, scope: 'world', ownerId: world1,
          keys: ['规模-' + i], content: '正文-' + i, activationRule: 'keyword', visibility: 'public',
          enabled: true, priority: 50, revision: 1, sourceTag: 'scale-lore-' + i, knownBy: [],
        }, null)
      }
    })
    startTrace()
    let cur = '', totalLore = 0
    for (;;) {
      const p = await candidate.withDomains({}, d => d.lorebook.list(world1, cur))
      totalLore += p.entries.length
      if (!p.cursor) break
      cur = p.cursor
    }
    const scaleTrace = stopTrace()
    check(totalLore >= 1000 && scaleTrace.maxRows <= 51, 'MR6_BOUNDED_PAGE_CAP')
    const heapAfterScaleBytes = performance.memory?.usedJSHeapSize ?? null

    check(modelCalls > 0, 'SYNTHETIC_CALLS_ZERO')
    setTrace(undefined)
    setDeferredFault(null)
    app.unmount()
    container.remove()
    autonomy.dispose()
    worlds.dispose()
    auth.expireSession()
    await candidate.release()
    const heapAfterReleaseBytes = performance.memory?.usedJSHeapSize ?? null
    return {
      status: 'PASS',
      health,
      copiedWorldId: copiedOverview.id,
      wideKnownByCount: fetchedWide.knownBy.length,
      loreScaleCount: totalLore,
      loreMaxSqlRows: scaleTrace.maxRows,
      dRevokedBodyReads: dRevokedReads,
      syntheticModelCalls: modelCalls,
      realModelCalls: 0,
      jsHeapUsedBytes: heapAfterReleaseBytes,
      memoryClassification: {
        heapStartBytes,
        heapAfterScaleBytes,
        heapAfterReleaseBytes,
        storeCount: pinia._s.size,
        domNodesAfterUnmount: container.childNodes.length,
      },
    }
  } catch (error) {
    return { error: error.code ?? error.message ?? String(error), stage, lastWrite, stack: error.stack }
  } finally {
    setTrace(undefined)
    setDeferredFault(null)
    app.unmount()
    container.remove()
    autonomy.dispose()
    worlds.dispose()
    auth.expireSession()
    await candidate.release()
  }
}
