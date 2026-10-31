import {appData} from '../p3/management-scenarios.mjs'
const assert=(value,code)=>{if(!value)throw Error(code)}
export async function verifyCustomGroups(page,record,network){
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  const before=await appData(page)
  let worldId,firstId,scope
  await record('blank-world-zero-and-one-role-cannot-create-a-group',async()=>{
    await click('创建空白世界');await page.locator('.feedback-input').fill('合成自定义群世界');await click('创建世界')
    await page.getByText('当前世界称谓：旅人',{exact:false}).waitFor()
    assert(await page.getByRole('button',{name:'创建群聊',exact:true}).isDisabled(),'EMPTY_WORLD_GROUP_ENABLED')
    await click('加入角色');await page.locator('.feedback-options button').nth(0).click()
    await page.waitForFunction(()=>document.querySelectorAll('.kanata-character-grid article').length===1)
    assert(await page.getByRole('button',{name:'创建群聊',exact:true}).isDisabled(),'ONE_ROLE_GROUP_ENABLED')
    for(const index of [1,2]){
      await click('加入角色');await page.locator('.feedback-options button').nth(index).click()
      await page.waitForFunction(count=>document.querySelectorAll('.kanata-character-grid article').length===count,index+1)
    }
    worldId=(await appData(page)).worlds.find(w=>w.name==='合成自定义群世界').id
    assert(network.requests===0,'WORLD_OR_MEMBERS_CALLED_MODEL')
    return{emptyAndOneRoleBlocked:true,independentInstances:3,modelRequests:0}
  })
  await record('member-selection-validation-and-a-fresh-two-role-group',async()=>{
    await click('创建群聊')
    const form=page.getByRole('form',{name:'创建世界群聊',exact:true})
    assert(await form.getByRole('checkbox').count()===3,'OTHER_WORLD_ROLES_EXPOSED')
    await click('建立群聊')
    assert(await form.getByRole('alert').textContent()==='请选择至少两名本世界角色。','NO_MEMBER_ERROR_MISSING')
    assert(await form.locator('fieldset').evaluate(node=>node===document.activeElement),'MEMBER_ERROR_NOT_FOCUSED')
    await form.getByLabel('群聊名称',{exact:true}).fill('合成群 <scope>')
    await form.getByRole('checkbox').nth(0).check();await form.getByRole('checkbox').nth(1).check()
    await click('建立群聊');await page.getByRole('button',{name:'返回世界',exact:true}).waitFor()
    const data=await appData(page),group=data.conversations.find(c=>c.worldId===worldId&&c.type==='group')
    firstId=group.id
    const roles=data.instances.filter(i=>i.worldId===worldId)
    assert(group.title==='合成群 <scope>'&&group.participantIds.length===3&&roles.slice(0,2).every(i=>group.participantIds.includes(i.id)),'GROUP_MEMBERS_OR_TITLE_LOST')
    for(const key of ['messages','memories','events','tasks','lifeGrants'])assert(data[key].filter(row=>row.worldId===worldId).length===0,'CREATION_SEEDED_'+key)
    assert(network.requests===0,'CREATION_CALLED_MODEL')
    return{newConversation:firstId,roles:2,onlyCurrentWorld:true,noHistoryOrGrants:true,literalTitle:true}
  })
  await record('a-second-custom-group-has-its-own-identity-and-no-prior-history',async()=>{
    await click('返回世界');await click('创建群聊')
    const form=page.getByRole('form',{name:'创建世界群聊',exact:true})
    await form.getByLabel('群聊名称',{exact:true}).fill('合成群 · 三人')
    for(const checkbox of await form.getByRole('checkbox').all())await checkbox.check()
    await click('建立群聊');await page.getByRole('button',{name:'返回世界',exact:true}).waitFor()
    const data=await appData(page),group=data.conversations.find(c=>c.worldId===worldId&&c.type==='group'&&c.id!==firstId)
    assert(group&&group.participantIds.length===4,'SECOND_GROUP_MISSING')
    scope={worldId,conversationId:group.id,title:group.title,firstId}
    for(const key of ['worlds','identities','instances','conversations','messages','memories','events','tasks','lifeGrants','relationships','lorebookEntries']){
      const original=before[key].filter(row=>row.worldId!==worldId),after=data[key].filter(row=>row.worldId!==worldId&&row.id!==worldId)
      assert(JSON.stringify(after)===JSON.stringify(original),'OTHER_WORLD_CHANGED_'+key)
    }
    assert(network.requests===0,'SECOND_GROUP_CALLED_MODEL')
    return{differentGroupId:true,roles:3,otherWorldsExact:true,modelRequests:0}
  })
  return scope
}
