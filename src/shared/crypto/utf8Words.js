import CryptoJS from 'crypto-js'
const encoder=new TextEncoder()
// Native UTF8 conversion with the same malformed-surrogate rejection as CryptoJS.enc.Utf8.parse.
// The returned WordArray is owned by this call; the encoder retains no plaintext buffers.
/** Strict UTF8 bytes for native kernels; no WordArray round trip or retained buffer.
 * @param {string} text @returns {Uint8Array} */
export function utf8Bytes(text){
  if(typeof text!=='string')throw new TypeError('UTF8_TEXT_REQUIRED')
  if(/[\ud800-\udfff]/.test(text))for(let i=0;i<text.length;i++){
    const unit=text.charCodeAt(i)
    if(unit>=0xd800&&unit<=0xdbff){
      const low=text.charCodeAt(++i)
      if(!(low>=0xdc00&&low<=0xdfff))throw new URIError('URI malformed')
    }else if(unit>=0xdc00&&unit<=0xdfff)throw new URIError('URI malformed')
  }
  return encoder.encode(text)
}
/** @param {string} text */
export function utf8Words(text){
  const bytes=utf8Bytes(text),words=new Array(Math.ceil(bytes.length/4)).fill(0)
  for(let i=0;i<bytes.length;i++)words[i>>>2]|=bytes[i]<<(24-(i&3)*8)
  return CryptoJS.lib.WordArray.create(words,bytes.length)
}
