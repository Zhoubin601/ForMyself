import CryptoJS from 'crypto-js'
import {utf8Words} from './utf8Words.js'

// Byte-compatible with CryptoJS.AES.encrypt(text, password): OpenSSL Salted__, 8-byte salt,
// EVP/MD5 key+IV derivation, AES-256-CBC, PKCS7, Base64. Only the processing memory changes.
const BLOCK_CHARS = 8192
const invalid = () => Object.assign(new Error('PASSPHRASE_AES_INVALID_CIPHERTEXT'), {code:'PASSPHRASE_AES_INVALID_CIPHERTEXT'})
const checkPassword = password => { if(typeof password !== 'string' || !password)throw Object.assign(new Error('PASSPHRASE_AES_PASSWORD_REQUIRED'),{code:'PASSPHRASE_AES_PASSWORD_REQUIRED'}) }
const wordBytes = value => {
  if(!Number.isSafeInteger(value.sigBytes)||value.sigBytes<0)throw invalid()
  const bytes=new Uint8Array(value.sigBytes)
  for(let i=0;i<bytes.length;i++)bytes[i]=(value.words[i>>>2] >>> (24-(i&3)*8))&255
  return bytes
}
const derive = (password,salt) => CryptoJS.kdf.OpenSSL.execute(password,8,4,salt)
const decodeBase64 = text => {
  const binary=atob(text),words=new Array(Math.ceil(binary.length/4)).fill(0)
  for(let i=0;i<binary.length;i++)words[i>>>2]|=binary.charCodeAt(i)<<(24-(i&3)*8)
  return CryptoJS.lib.WordArray.create(words,binary.length)
}

/** @param {string} plaintext @param {string} password @returns {string} */
export function encryptPassphraseAes(plaintext,password){
  checkPassword(password)
  if(typeof plaintext!=='string')throw invalid()
  const salt=CryptoJS.lib.WordArray.random(8),derived=derive(password,salt)
  const cipher=CryptoJS.algo.AES.createEncryptor(derived.key,{iv:derived.iv})
  let pending=CryptoJS.lib.WordArray.create([0x53616c74,0x65645f5f],8).concat(salt)
  const chunks=[]
  const append=part=>{
    pending.concat(part)
    const complete=pending.sigBytes-pending.sigBytes%3,bytes=wordBytes(pending),tail=bytes.slice(complete)
    // 8190 is divisible by three: native Base64 needs no inter-chunk padding or giant character arrays.
    for(let start=0;start<complete;start+=8190)chunks.push(btoa(String.fromCharCode(...bytes.subarray(start,Math.min(start+8190,complete)))))
    pending=CryptoJS.lib.WordArray.create(tail)
  }
  for(let start=0;start<plaintext.length;){
    let end=Math.min(start+BLOCK_CHARS,plaintext.length)
    if(end<plaintext.length&&plaintext.charCodeAt(end-1)>=0xd800&&plaintext.charCodeAt(end-1)<=0xdbff)--end
    append(cipher.process(utf8Words(plaintext.slice(start,end))));start=end
  }
  append(cipher.finalize())
  if(pending.sigBytes)chunks.push(btoa(String.fromCharCode(...wordBytes(pending))))
  return chunks.join('')
}

/** @param {string} ciphertext @param {string} password @returns {string} */
export function decryptPassphraseAes(ciphertext,password){
  checkPassword(password)
  if(typeof ciphertext!=='string'||ciphertext.length<44||ciphertext.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(ciphertext))throw invalid()
  const header=decodeBase64(ciphertext.slice(0,24))
  if(header.words[0]!==0x53616c74||header.words[1]!==0x65645f5f)throw invalid()
  const salt=CryptoJS.lib.WordArray.create(header.words.slice(2,4),8),derived=derive(password,salt)
  // Keep the final block to verify every PKCS7 padding byte before emitting it.
  const cipher=CryptoJS.algo.AES.createDecryptor(derived.key,{iv:derived.iv,padding:CryptoJS.pad.NoPadding})
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),chunks=[]
  let payloadBytes=0
  try{
    for(let start=0;start<ciphertext.length;start+=BLOCK_CHARS){
      let value=decodeBase64(ciphertext.slice(start,start+BLOCK_CHARS))
      if(start===0)value=CryptoJS.lib.WordArray.create(value.words.slice(4),value.sigBytes-16)
      payloadBytes+=value.sigBytes
      chunks.push(decoder.decode(wordBytes(cipher.process(value)),{stream:true}))
    }
    if(!payloadBytes||payloadBytes%16)throw invalid()
    const final=wordBytes(cipher.finalize()),padding=final.at(-1)
    if(!padding||padding>16||padding>final.length||!final.slice(-padding).every(byte=>byte===padding))throw invalid()
    chunks.push(decoder.decode(final.slice(0,-padding),{stream:true}),decoder.decode())
    return chunks.join('')
  }catch{throw invalid()}
}

// The wire protocol above is unchanged. Archive pages can use the platform AES kernel
// asynchronously; no password/key/plaintext cache or business dependency is introduced.
const encodeBytes=bytes=>{
  const parts=[]
  for(let start=0;start<bytes.length;start+=8190)parts.push(btoa(String.fromCharCode(...bytes.subarray(start,start+8190))))
  return parts.join('')
}
/** Byte-compatible asynchronous backend; missing capability uses the existing implementation.
 * @param {string} plaintext @param {string} password @returns {Promise<string>} */
export async function encryptPassphraseAesAsync(plaintext,password){
  checkPassword(password)
  if(typeof plaintext!=='string')throw invalid()
  const subtle=globalThis.crypto?.subtle
  if(!subtle)return encryptPassphraseAes(plaintext,password)
  // Preserve strict rejection of unpaired UTF16 rather than TextEncoder replacement.
  const plain=wordBytes(utf8Words(plaintext)),salt=CryptoJS.lib.WordArray.random(8),derived=derive(password,salt)
  try{
    const key=await subtle.importKey('raw',wordBytes(derived.key),'AES-CBC',false,['encrypt'])
    const cipher=new Uint8Array(await subtle.encrypt({name:'AES-CBC',iv:wordBytes(derived.iv)},key,plain))
    const header=wordBytes(CryptoJS.lib.WordArray.create([0x53616c74,0x65645f5f],8).concat(salt)),wire=new Uint8Array(header.length+cipher.length)
    wire.set(header);wire.set(cipher,header.length)
    return encodeBytes(wire)
  }catch{throw invalid()}
}
/** @param {string} ciphertext @param {string} password @returns {Promise<string>} */
export async function decryptPassphraseAesAsync(ciphertext,password){
  checkPassword(password)
  const subtle=globalThis.crypto?.subtle
  if(!subtle)return decryptPassphraseAes(ciphertext,password)
  if(typeof ciphertext!=='string'||ciphertext.length<44||ciphertext.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(ciphertext))throw invalid()
  try{
    const binary=atob(ciphertext),wire=Uint8Array.from(binary,ch=>ch.charCodeAt(0))
    if(wire.length<=16||(wire.length-16)%16||wire[0]!==0x53||wire[1]!==0x61||wire[2]!==0x6c||wire[3]!==0x74||wire[4]!==0x65||wire[5]!==0x64||wire[6]!==0x5f||wire[7]!==0x5f)throw invalid()
    const derived=derive(password,CryptoJS.lib.WordArray.create(wire.subarray(8,16)))
    const key=await subtle.importKey('raw',wordBytes(derived.key),'AES-CBC',false,['decrypt'])
    const plaintext=await subtle.decrypt({name:'AES-CBC',iv:wordBytes(derived.iv)},key,wire.subarray(16))
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(plaintext)
  }catch{throw invalid()}
}
