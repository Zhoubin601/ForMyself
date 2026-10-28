import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelOwnedFeedbackDialog, appChoose, appPrompt, resolveFeedbackDialog, uiFeedbackState } from '../src/services/uiFeedback.js'

test('P3-review2 sensitive role/world dialogs release all private text and options after resolution',async()=>{
  const pending=appChoose({sensitive:true,title:'Synthetic private world',message:'Synthetic private explanation',options:[{value:'instance',label:'Synthetic private role'}]})
  resolveFeedbackDialog('instance')
  assert.equal(await pending,'instance')
  assert.equal(uiFeedbackState.dialog.open,false)
  assert.equal(uiFeedbackState.dialog.message,'')
  assert.equal(uiFeedbackState.dialog.title,'')
  assert.deepEqual(uiFeedbackState.dialog.options,[])
  const prompt=appPrompt('Synthetic identity','Synthetic private alias',{sensitive:true})
  resolveFeedbackDialog(null);assert.equal(await prompt,null)
  assert.equal(uiFeedbackState.dialog.inputValue,'')
})


test('P3-review2 component disposal cannot dismiss a newer owner dialog', async () => {
  const previousOwner = Symbol('previous'), nextOwner = Symbol('next')
  const previous = appChoose({ sensitive: true, owner: previousOwner, options: [{ value: 'old', label: 'Private old role' }] })
  const next = appPrompt('Private new world', 'Private alias', { sensitive: true, owner: nextOwner })
  assert.equal(await previous, null)
  assert.equal(cancelOwnedFeedbackDialog(previousOwner), false)
  assert.equal(uiFeedbackState.dialog.open, true)
  assert.equal(uiFeedbackState.dialog.inputValue, 'Private alias')
  assert.equal(cancelOwnedFeedbackDialog(nextOwner), true)
  assert.equal(await next, null)
  assert.equal(uiFeedbackState.dialog.inputValue, '')
  assert.equal(uiFeedbackState.dialog.message, '')
})

test('P3-review2 ordinary return values and password clearing remain compatible', async () => {
  const ordinary = appChoose({ options: [{ value: 'ok', label: 'Public choice' }] })
  resolveFeedbackDialog('ok')
  assert.equal(await ordinary, 'ok')
  const password = appPrompt('Password', 'Synthetic password', { inputType: 'password' })
  resolveFeedbackDialog(null)
  assert.equal(await password, null)
  assert.equal(uiFeedbackState.dialog.inputValue, '')
})
