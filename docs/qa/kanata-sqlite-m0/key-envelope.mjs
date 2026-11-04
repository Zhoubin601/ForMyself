// QA-only portable envelope. Not wired into auth/protectedModules/Preferences.
import {webcrypto,randomBytes} from 'node:crypto'
const subtle=webcrypto.subtle
export const iterations=600000 // provisional; Android calibration remains BLOCKED
const encode=b=>Buffer.from(b).toString('base64')
const decode=s=>new Uint8Array(Buffer.from(s,'base64'))
const aad=e=>new TextEncoder().encode(JSON.stringify({version:e.version,purpose:e.purpose,kdf:e.kdf,cipher:e.cipher,salt:e.salt,nonce:e.nonce}))
async function kek(password,salt,usages){
  const raw=new TextEncoder().encode(password)
  try {
    const material=await subtle.importKey('raw',raw,'PBKDF2',false,['deriveKey'])
    const prefix=new TextEncoder().encode('ForMyself/Kanata/KEK/v1\u0000'),domainSalt=new Uint8Array(prefix.length+salt.length)
    domainSalt.set(prefix);domainSalt.set(salt,prefix.length)
    return await subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:domainSalt,iterations},material,{name:'AES-GCM',length:256},false,usages)
  } finally{raw.fill(0)}
}
export async function wrapKey(password,key){
  if(!(key instanceof Uint8Array)||key.length!==32)throw Error('QA_INVALID_DEK')
  const salt=randomBytes(16),nonce=randomBytes(12)
  const envelope={version:1,purpose:'kanata-sqlcipher-dek-wrap',kdf:{name:'PBKDF2-SHA256',iterations,length:256},cipher:'AES-256-GCM',salt:encode(salt),nonce:encode(nonce)}
  const encryptionKey=await kek(password,salt,['encrypt'])
  envelope.ciphertext=encode(await subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(envelope),tagLength:128},encryptionKey,key))
  return envelope
}
export async function unwrapKey(password,envelope){
  try {
    if(envelope.version!==1||envelope.purpose!=='kanata-sqlcipher-dek-wrap'||envelope.cipher!=='AES-256-GCM'||JSON.stringify(envelope.kdf)!==JSON.stringify({name:'PBKDF2-SHA256',iterations,length:256}))throw Error()
    const salt=decode(envelope.salt),nonce=decode(envelope.nonce),cipher=decode(envelope.ciphertext)
    if(salt.length!==16||nonce.length!==12||cipher.length!==48)throw Error()
    const key=await kek(password,salt,['decrypt'])
    return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad(envelope),tagLength:128},key,cipher))
  } catch {throw Error('QA_ENVELOPE_AUTH_FAILED')}
}
