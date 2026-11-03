import CryptoJS from 'crypto-js'
import {utf8Words,utf8Bytes} from './utf8Words.js'
const MAX_PLATFORM_HASH_CHARS=256*1024
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
/** Identical UTF8 SHA256 for bounded archive ciphertexts. Oversize inputs use the
 * existing chunked algorithm before allocating native bytes. An available platform
 * failure on a bounded input must reach the caller, never trigger a silent retry.
 * @param {string} value @returns {Promise<string>} */
export async function sha256TextAsync(value){
  if(typeof value!=='string')throw new TypeError('SHA256_TEXT_REQUIRED')
  const subtle=globalThis.crypto?.subtle
  if(!subtle||value.length>MAX_PLATFORM_HASH_CHARS)return sha256Text(value)
  const bytes=utf8Bytes(value)
  try{
    const digest=new Uint8Array(await subtle.digest('SHA-256',bytes))
    let result=''
    for(let i=0;i<digest.length;++i)result+=digest[i].toString(16).padStart(2,'0')
    return result
  }catch{
    throw Object.assign(new Error('SHA256_PLATFORM_FAILED'),{code:'SHA256_PLATFORM_FAILED'})
  }
}
