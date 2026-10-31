import test from 'node:test'
import assert from 'node:assert/strict'
import {compareMoodBaseline} from '../docs/qa/kanata-continuous/p7/mood-baseline-comparison.mjs'
const original={id:'synthetic-original',date:'2026-10-29',mood:'good',note:'合成原文',tags:[],autoFilled:false,createdAt:1}
const automatic={id:'synthetic-auto',date:'2026-10-30',mood:'normal',note:'',tags:[],autoFilled:true,createdAt:3}
const context={trackingStartDate:'2026-10-29',today:'2026-10-31',defaultMoodId:'normal',minimumCreatedAt:2,now:4}
test('P7 a later cold start preserves every original and reports only the exact existing auto-fill rule',()=>{
  assert.deepEqual(compareMoodBaseline([original],[original,automatic],context).automaticMoodRows,[{id:'synthetic-auto',date:'2026-10-30'}])
})
test('P7 genuine edits, deletion, duplication or manual extra entries never pass as a clock rollover',()=>{
  for(const actual of [[{...original,note:'changed'},automatic],[automatic],[original,original],[original,{...automatic,autoFilled:false}],[original,{...automatic,note:'new note'}],[original,{...automatic,tags:['manual']}]])assert.throws(()=>compareMoodBaseline([original],actual,context))
})
test('P7 future/today dates, missing expected days, wrong mood, extra fields or impossible timestamps are rejected',()=>{
  for(const change of [{date:'2026-10-31'},{date:'2026-10-28'},{mood:'good'},{unknown:true},{createdAt:1},{createdAt:5}])assert.throws(()=>compareMoodBaseline([original],[original,{...automatic,...change}],context))
  assert.throws(()=>compareMoodBaseline([original],[original],context))
})
test('P7 no tracking start authorises no new placeholders and never changes the caller arrays',()=>{
  const expected=[original],actual=[original],before=JSON.stringify({expected,actual})
  assert.equal(compareMoodBaseline(expected,actual,{...context,trackingStartDate:''}).automaticMoodRows.length,0)
  assert.equal(JSON.stringify({expected,actual}),before)
  assert.throws(()=>compareMoodBaseline(expected,[original,automatic],{...context,trackingStartDate:''}))
})
