// @ts-check
import {ownImmutableKanataData,validateKanataData} from './kanataValidation.js'
/** @typedef {import('./kanataTypes').KanataData} Data */
/** Private process-local identities; no wire flag can authorize adoption. */
const images=new WeakSet()
/** Internal factory for already detached canonical images. Freezes every descendant, then
 * validates the immutable result before registering it. It cannot register a mutable or invalid
 * graph, even if called with an external object. Ordinary import/callers still clone separately.
 * @param {Data} data @returns {Data}
 */
export function ownKanataRestoreImage(data){
  ownImmutableKanataData(data)
  images.add(data)
  return data
}
/** A normal input is detached. A privately registered, deeply frozen image can safely share
 * immutable descendants; only its top-level draft and message/descriptor arrays are changed.
 * Store mutations continue cloning before editing, so no mutable alias escapes either path.
 * @param {unknown} input @returns {Data}
 */
export function kanataRestoreDraft(input){
  if(input&&typeof input==='object'&&images.has(input)){
    const data=/** @type {Data} */(input)
    return{...data,messages:[...data.messages],...(data.messageArchives?{messageArchives:[...data.messageArchives]}:{})}
  }
  return validateKanataData(input)
}
