import { crc32, deflateSync } from 'node:zlib'

export const PASSWORD='Synthetic-Kanata-P3-only'
const assert=(value,label)=>{if(!value)throw Error('P3_ASSERT:'+label)}
const rawCard=name=>({spec:'chara_card_v3',spec_version:'3.0',data:{name,description:'只属于合成卡的基础设定。',personality:'独立、谨慎',scenario:'合成阅览室',first_mes:'合成开场，不会自动发送',mes_example:'简短、有主见。',alternate_greetings:['另一开场'],group_only_greetings:[],creator_notes:'合成测试资料',extensions:{unknown:{script:'globalThis.p3Executed=true',keep:[1,null]}},character_book:{entries:[{keys:['私密关键词'],content:'合成的角色私有知识',enabled:true,extensions:{keep:'original'}}]}}})
const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4,'ascii');b.set(data,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b}
export const syntheticCardPng=()=>{
  const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('tEXt',Buffer.from('ccv3\0'+Buffer.from(JSON.stringify(rawCard('合成PNG角色'))).toString('base64'))),chunk('IDAT',deflateSync(Buffer.from([0,80,100,120,255]))),chunk('IEND',Buffer.alloc(0))])
}
export const appData=page=>page.evaluate(()=>JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot)))
export async function waitApp(page){
  await page.waitForFunction(()=>{
    const stores=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s
    return stores?.get('auth')?.isDataLoaded&&stores?.get('settings')?.isDataLoaded
  })
}
export async function initializeApp(page){
  await waitApp(page)
  await page.evaluate(async password=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
    if(s.get('auth').hasMasterPassword)throw Error('Fresh synthetic app required')
    await s.get('auth').setMasterPassword(password)
    if(!await s.get('protectedAccess').ensureModule('chat'))throw Error('Protected load failed')
    s.get('settings').switchView('chat')
  },PASSWORD)
  await page.getByRole('button',{name:'开始准备彼方',exact:true}).click()
  await page.getByRole('button',{name:'确认清理并准备',exact:true}).click()
  await page.locator('.kanata-manager').waitFor()
}
export async function unlockApp(page){
  await waitApp(page)
  await page.evaluate(async password=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
    if(!await s.get('auth').unlockWithPassword(password))throw Error('Cold password verification failed')
    if(!await s.get('protectedAccess').ensureModule('chat'))throw Error('Cold protected load failed')
    s.get('settings').switchView('chat')
  },PASSWORD)
  await page.locator('.kanata-manager').waitFor()
}
export async function verifyManagement(page,record){
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  const pick=name=>page.locator('.feedback-options').getByText(name,{exact:true}).click()
  const chooseWorld=async name=>{await page.locator('.kanata-world-toolbar button').click();await pick(name)}
  const upload=async payload=>{
    const chosen=page.waitForEvent('filechooser')
    await click('导入角色卡');await (await chosen).setFiles(payload)
  }
  let initial
  await record('first-seed-exact-and-no-key',async()=>{
    initial=await appData(page)
    assert(initial.worlds.length===1&&initial.cards.length===5&&initial.instances.length===5,'seed roles')
    assert(initial.conversations.filter(c=>c.type==='private').length===5&&initial.conversations.filter(c=>c.type==='group').length===1,'seed conversations')
    assert(initial.messages.length===0&&initial.memories.length===0&&initial.events.length===0&&initial.tasks.length===0&&initial.lifeGrants.length===0,'no invented history or grants')
    assert(initial.lorebookEntries.length>=8&&initial.relationships.filter(r=>r.kind==='teammate').length===20&&initial.relationships.filter(r=>r.kind==='teacher').length===5,'complete preset')
    const noKey=await page.evaluate(()=>!document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').aiApiKey)
    assert(noKey,'no API key needed');return{worlds:1,cards:5,instances:5,private:5,group:1,lore:initial.lorebookEntries.length,relationships:initial.relationships.length,messages:0,memories:0,events:0}
  })
  await record('world-create-and-independent-instance',async()=>{
    await click('创建空白世界');await page.locator('.feedback-input').fill('合成第二世界');await click('创建世界')
    await page.getByText('当前世界称谓：旅人',{exact:false}).waitFor()
    await click('加入角色');await pick('小鸟游星野')
    await page.locator('.kanata-character-grid article').waitFor()
    const d=await appData(page),second=d.worlds.find(w=>w.name==='合成第二世界'),instance=d.instances.find(i=>i.worldId===second.id)
    assert(d.worlds.length===2&&d.instances.length===6&&instance.cardId===initial.cards[0].id&&instance.id!==initial.instances[0].id,'same card isolated instance')
    return{worlds:2,instances:6}
  })
  await record('world-identity-and-instance-overrides',async()=>{
    await click('编辑世界身份');await page.getByLabel('称谓',{exact:true}).fill('旅行者');await click('保存世界身份')
    await page.getByText('当前世界称谓：旅行者',{exact:false}).waitFor()
    await click('实例设置');await page.getByLabel('本世界中的称呼',{exact:true}).fill('合成世界星野')
    await page.getByLabel('说话习惯',{exact:true}).fill('本世界独立表达');await click('保存实例设定')
    await page.getByRole('heading',{name:'合成世界星野',exact:true}).waitFor()
    const d=await appData(page),instance=d.instances.find(i=>i.worldId!==initial.worlds[0].id)
    assert(instance.overrides.speechStyle==='本世界独立表达'&&Object.keys(d.instances[0].overrides).length===0,'instance override isolation')
    assert(d.identities[0].displayName==='老师','original identity preserved');return true
  })
  await record('global-version-preview-selective-sync',async()=>{
    await click('全局角色库');await click('编辑基础卡')
    await page.getByLabel('角色姓名',{exact:true}).fill('星野 · 合成卡版本')
    await click('保存新版本')
    await page.getByRole('heading',{name:'星野 · 合成卡版本',exact:true}).waitFor()
    let d=await appData(page),card=d.cards[0]
    assert(d.instances.filter(i=>i.cardId===card.id).every(i=>i.cardVersionId===initial.cards[0].currentVersionId),'no implicit sync')
    await click('预览同步实例');await pick(initial.worlds[0].name+' · 沿用基础卡')
    await page.getByRole('heading',{name:'预览卡版本同步',exact:true}).waitFor();await click('同步这个实例')
    await page.getByText('所选实例已同步，独立覆盖和经历已保留。',{exact:true}).waitFor()
    d=await appData(page)
    assert(d.instances[0].cardVersionId===card.currentVersionId,'selected original instance updated')
    const other=d.instances.find(i=>i.worldId!==initial.worlds[0].id)
    assert(other.cardVersionId===initial.cards[0].currentVersionId&&other.overrides.speechStyle==='本世界独立表达','other world unchanged')
    return true
  })
  await record('json-preview-cancel-and-confirm',async()=>{
    const payload={name:'synthetic-v3.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(rawCard('合成导入者')))}
    await upload(payload);await page.getByRole('heading',{name:'合成导入者 · V3',exact:true}).waitFor()
    await click('取消导入');assert((await appData(page)).cards.length===5,'cancel no import')
    await upload(payload);await click('确认导入全局库')
    await page.getByText('角色卡已加入全局库，尚未加入任何世界。',{exact:true}).waitFor()
    const d=await appData(page)
    assert(d.cards.length===6&&d.instances.length===6&&d.messages.length===0,'import no instance/history')
    assert(await page.evaluate(()=>globalThis.p3Executed===undefined),'card scripts inert');return true
  })
  await record('png-v3-import-and-corrupt-rejection',async()=>{
    const png=syntheticCardPng()
    await upload({name:'synthetic-v3.png',mimeType:'image/png',buffer:png});await page.getByRole('heading',{name:'合成PNG角色 · V3',exact:true}).waitFor();await click('确认导入全局库')
    await page.getByRole('heading',{name:'合成PNG角色',exact:true}).waitFor()
    const before=(await appData(page)).cards.length
    const invalid=Buffer.from(png);invalid[invalid.length-1]^=1
    await upload({name:'corrupt.png',mimeType:'image/png',buffer:invalid})
    await page.getByText('无法导入此卡',{exact:false}).waitFor()
    assert((await appData(page)).cards.length===before,'corruption zero write')
    return{cards:before,crcRejected:true}
  })
  await record('attached-lore-private-and-conflict-skip',async()=>{
    await click('我的世界');await click('加入角色');await pick('合成导入者')
    const article=page.locator('.kanata-character-grid article').filter({has:page.getByRole('heading',{name:'合成导入者',exact:true})})
    await article.getByRole('button',{name:'附带世界书',exact:true}).click();await click('导入私有设定')
    await page.getByText('附带世界书已按角色私有范围导入。',{exact:true}).waitFor()
    const first=await appData(page),entry=first.lorebookEntries.find(l=>l.content==='合成的角色私有知识')
    assert(entry.visibility==='private'&&entry.knownBy.length===1&&entry.knownBy[0]===entry.ownerId,'private knowledge default')
    await article.getByRole('button',{name:'附带世界书',exact:true}).click();await click('跳过冲突并导入')
    await page.getByText('附带世界书已按角色私有范围导入。',{exact:true}).waitFor()
    assert((await appData(page)).lorebookEntries.length===first.lorebookEntries.length,'conflict no duplicate or overwrite');return true
  })
  await record('role-knowledge-filter-and-world-switch',async()=>{
    await click('世界书');await page.locator('.kanata-preview summary').click()
    await click('选择预览角色');await pick('合成导入者')
    await page.getByLabel('测试关键词',{exact:true}).fill('私密关键词')
    await page.locator('.kanata-preview li').getByText('合成的角色私有知识',{exact:true}).waitFor()
    await page.locator('.kanata-preview').getByRole('button',{name:'合成导入者',exact:true}).click();await pick('合成世界星野')
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.kanata-preview li')).some(e=>e.textContent.includes('合成的角色私有知识')))
    await chooseWorld(initial.worlds[0].name)
    await page.waitForFunction(()=>!document.querySelector('.kanata-panel[aria-label="世界书管理"]')?.textContent.includes('合成的角色私有知识'))
    return true
  })
  await record('world-copy-and-reversible-archive',async()=>{
    await click('我的世界');await click('复制设定');await page.locator('.feedback-input').fill('合成副本世界');await click('复制为新世界')
    await page.getByRole('heading',{name:'合成副本世界',exact:true}).waitFor()
    const d=await appData(page),copy=d.worlds.find(w=>w.name==='合成副本世界')
    assert(d.instances.filter(i=>i.worldId===copy.id).length===5&&d.conversations.filter(c=>c.worldId===copy.id).length===6,'copy static roles')
    assert(['messages','memories','events','lifeGrants','tasks'].every(k=>!d[k].some(e=>e.worldId===copy.id)),'copy has no experience or grants')
    await click('归档世界');await click('归档并保留资料')
    await page.getByText('已归档 · 自动活动关闭',{exact:true}).waitFor()
    assert(await page.getByRole('button',{name:'加入角色',exact:true}).isDisabled(),'archived world readonly')
    await click('取消归档世界');await click('取消归档')
    await page.getByText('世界已取消归档。',{exact:true}).waitFor()
    const final=(await appData(page)).worlds.find(w=>w.id===copy.id)
    assert(!final.archived&&!final.autonomyEnabled&&!final.notificationsEnabled&&!final.proactiveEnabled,'unarchive no automatic AI');return true
  })
  await record('navigation-scroll-restoration',async()=>{
    await page.locator('.kanata-frame').evaluate(el=>{el.scrollTop=200})
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').currentRoute.scrollTop===200)
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').switchView('weight'))
    await page.waitForFunction(()=>!document.querySelector('.kanata-manager'))
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').goBack())
    await page.locator('.kanata-manager').waitFor()
    await page.waitForFunction(()=>Math.abs(document.querySelector('.kanata-frame').scrollTop-200)<=1)
    return true
  })
  const final=await appData(page)
  assert(final.worlds.length===3&&final.cards.length===7&&final.instances.length===12,'final counts')
  assert(final.messages.length===0&&final.memories.length===0&&final.events.length===0,'no fake generated history')
  return{worlds:final.worlds.length,cards:final.cards.length,instances:final.instances.length,conversations:final.conversations.length,lorebook:final.lorebookEntries.length,messages:0,memories:0,events:0}
}
