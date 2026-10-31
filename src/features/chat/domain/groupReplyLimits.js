// @ts-check
import {cloneKanataJson,requireKanata as need} from './kanataJson.js'
/** @typedef {import('./kanataTypes').GroupReplyLimits} Limits */
/** @param {unknown} input @returns {Limits} */
export function validateGroupReplyLimits(input){
  const value=cloneKanataJson(input)
  need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_GROUP_REPLY_LIMITS','conversation.replyLimits')
  const limits=/** @type {Limits} */(value)
  need(Object.keys(limits).length===2&&Object.keys(limits).every(key=>['maxSpeakers','maxMessages'].includes(key)),'INVALID_GROUP_REPLY_LIMITS','conversation.replyLimits')
  need(Number.isSafeInteger(limits.maxSpeakers)&&limits.maxSpeakers>=1&&limits.maxSpeakers<=8,'INVALID_GROUP_REPLY_LIMITS','conversation.replyLimits.maxSpeakers')
  need(Number.isSafeInteger(limits.maxMessages)&&limits.maxMessages>=limits.maxSpeakers&&limits.maxMessages<=32,'INVALID_GROUP_REPLY_LIMITS','conversation.replyLimits.maxMessages')
  return limits
}
/** Defaults do not mutate old conversations or create billing tasks.
 * @param {import('./kanataTypes').Conversation} conversation @returns {Limits} */
export function kanataReplyLimits(conversation){
  if(conversation.type!=='group')return{maxSpeakers:1,maxMessages:4}
  return conversation.replyLimits===undefined?{maxSpeakers:2,maxMessages:8}:validateGroupReplyLimits(conversation.replyLimits)
}
