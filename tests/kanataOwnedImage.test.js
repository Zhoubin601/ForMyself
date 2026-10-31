import assert from 'node:assert/strict'
import test from 'node:test'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {ownKanataRestoreImage,kanataRestoreDraft} from '../src/features/chat/domain/kanataOwnedImage.js'
test('canonical image adoption shares only recursively frozen validated descendants; draft arrays remain independent',()=>{
  const data=archiveData(100),image=ownKanataRestoreImage(data),draft=kanataRestoreDraft(image)
  assert.notEqual(draft,image);assert.notEqual(draft.messages,image.messages)
  assert.equal(draft.messages[0],image.messages[0]);assert(Object.isFrozen(image.messages[0]))
  assert(Object.isFrozen(image.worlds));assert(Object.isFrozen(image.worlds[0]))
  assert.throws(()=>{draft.messages[0].content='late mutation'},TypeError)
  assert.throws(()=>{draft.worlds[0].name='late mutation'},TypeError)
  draft.messages.length=0;assert.equal(image.messages.length,100)
})
test('external mutable or shallow-frozen objects never obtain adoption through a flag or frozen root',()=>{
  for(const freezeRoot of [false,true]){
    const data=archiveData(10);data.trusted=true
    if(freezeRoot)Object.freeze(data)
    const draft=kanataRestoreDraft(data)
    assert.notEqual(draft.messages[0],data.messages[0])
    draft.messages[0].content='external draft mutation';draft.worlds[0].name='external world mutation'
    assert.notEqual(data.messages[0].content,draft.messages[0].content)
    assert.notEqual(data.worlds[0].name,draft.worlds[0].name)
  }
})
test('immutable image factory rejects invalid references or accessors before registering/freezing bad data',()=>{
  const data=archiveData(10);data.instances[0].worldId='missing'
  assert.throws(()=>ownKanataRestoreImage(data),/ORPHAN_WORLD/)
  assert.equal(Object.isFrozen(data),false)
  assert.throws(()=>kanataRestoreDraft(data),/ORPHAN_WORLD/)
  let called=false
  Object.defineProperty(data,'messages',{enumerable:true,get(){called=true;return[]}})
  assert.throws(()=>ownKanataRestoreImage(data),/INVALID_JSON_PROPERTY/)
  assert.equal(called,false)
})
