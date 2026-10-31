// @ts-check
import {cloneKanataJson,requireKanata as need} from './kanataJson.js'
/** @param {unknown} input @returns {import('./kanataTypes').ReplyTimingPolicy} */
export function validateReplyTimingPolicy(input){
  const value=/** @type {import('./kanataTypes').ReplyTimingPolicy} */(cloneKanataJson(input))
  need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.keys(value).every(key=>['enabled','waitMs'].includes(key))&&typeof value.enabled==='boolean'&&Number.isSafeInteger(value.waitMs)&&value.waitMs>=1000&&value.waitMs<=30000,'INVALID_REPLY_TIMING','conversation.replyTiming')
  return value
}
