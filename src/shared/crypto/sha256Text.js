import CryptoJS from 'crypto-js'
import {utf8Words} from './utf8Words.js'
/** Same UTF8 SHA256 digest, with bounded WordArray buffers. @param {string} value @returns {string} */
export function sha256Text(value){
  if(typeof value!=='string')throw new TypeError('SHA256_TEXT_REQUIRED')
  const digest=CryptoJS.algo.SHA256.create()
  for(let start=0;start<value.length;){
    let end=Math.min(start+8192,value.length)
    if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)--end
    digest.update(utf8Words(value.slice(start,end)));start=end
  }
  return digest.finalize().toString()
}
