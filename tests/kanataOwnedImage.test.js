import assert from 'node:assert/strict'
import test from 'node:test'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {ownKanataRestoreImage,kanataRestoreDraft} from '../src/features/chat/domain/kanataOwnedImage.js'
import {assertKanataData,validateKanataData,ownImmutableKanataData} from '../src/features/chat/domain/kanataValidation.js'
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

test('validation reuse is restricted to fully checked recursively immutable identities; assertions and wire-shaped copies cannot acquire it',()=>{
  const mutable=archiveData(10);assertKanataData(mutable)
  mutable.messages[1].replyToRevision=999
  assert.throws(()=>assertKanataData(mutable),/INVALID_REPLY_SOURCE_REVISION/)
  Object.freeze(mutable)
  assert.throws(()=>assertKanataData(mutable),/INVALID_REPLY_SOURCE_REVISION/)
  const image=ownImmutableKanataData(archiveData(10))
  assert.equal(assertKanataData(image),image);assert.equal(ownImmutableKanataData(image),image)
  assert.throws(()=>{image.messages[1].replyToRevision=999},TypeError)
  assert.throws(()=>Object.setPrototypeOf(image.messages[1],{}),TypeError)
  const detached=validateKanataData(image)
  assert.notEqual(detached.messages[1],image.messages[1])
  detached.messages[1].replyToRevision=999;detached.validated=true
  assert.throws(()=>assertKanataData(detached),/INVALID_REPLY_SOURCE_REVISION/)
  assert.equal(image.messages[1].replyToRevision,1)
})
