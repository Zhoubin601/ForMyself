import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const directory=new URL('./',import.meta.url)
const results=JSON.parse(await readFile(new URL('live-results.json',directory),'utf8'))
assert.equal(results.syntheticOnly,true)
assert.equal(results.attempts.length,3)
for(const attempt of results.attempts){assert.equal(attempt.status,'succeeded');assert.ok(Number.isSafeInteger(attempt.usage?.promptTokens));assert.ok(Number.isSafeInteger(attempt.usage?.completionTokens))}
const facts=JSON.parse(results.responses.find(r=>r.kind==='memory').content).memories
assert.ok(facts.some(f=>f.content.includes('薄荷茶')&&f.confidence==='statement'))
assert.ok(facts.some(f=>f.content.includes('不是真实资产')&&f.confidence==='joke'))
assert.ok(facts.some(f=>f.content.includes('未确认')&&f.content.includes('晨跑')))
const summary=JSON.parse(results.responses.find(r=>r.kind==='summary').content).summary
assert.ok(summary.includes('并非真实资产')&&summary.includes('没有确认喜欢晨跑')&&summary.includes('猜测'))
assert.ok(results.responses.find(r=>r.kind==='authorized-life-read').content.includes('复习合成测试章节'))
assert.equal(results.counts.events,0);assert.equal(results.counts.tasks,2)
const review={status:'PASS',reviewedAt:new Date().toISOString(),source:'live-results.json',newNetworkRequests:0,
  assertions:'3 actual completed requests with provider usage; synthetic-only; valid JSON; preference, joke and explicit uncertainty kept distinct; no world events',
  manualReview:['逐条阅读三条提取事实：薄荷茶为陈述，星星为玩笑且不是资产，晨跑未确认。没有将候选自动提升为世界真值。','逐条阅读摘要：保留白子的猜测与用户明确否定，普通闲聊未被编造成事件。','阅读星野的授权待办回复：准确提及合成任务，以放松但不纵容拖延的表达鼓励，没有声称已经替用户完成任务。'],
  usage:results.attempts.reduce((sum,a)=>({promptTokens:sum.promptTokens+a.usage.promptTokens,completionTokens:sum.completionTokens+a.usage.completionTokens,cacheHitTokens:sum.cacheHitTokens+(a.usage.cacheHitTokens||0)}),{promptTokens:0,completionTokens:0,cacheHitTokens:0}),
  limits:'仅本轮三个合成交流；真实模型不得作为确定性权限控制。权限、撤权、来源修订、跨世界与异常由独立代码及受控测试验证。后续来源过滤加固不改变本轮模型提示词；本脚本不重新联网。'}
await writeFile(new URL('live-quality-review.json',directory),JSON.stringify(review,null,2)+'\n')
console.log('PASS: actual recorded live exchanges verified; no new network requests')
