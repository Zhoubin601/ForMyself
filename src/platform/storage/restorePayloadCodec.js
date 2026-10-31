// Data encoding inside the unchanged authenticated restore envelope. No storage, credentials or stores.
export const RESTORE_COMPRESSION_THRESHOLD_BYTES = 256 * 1024
export const MAX_RESTORE_PLAIN_BYTES = 256 * 1024 * 1024
const TYPE = 'formyself-restore-payload'
const failure = code => Object.assign(new Error(code), {code})
const jsonFailure = () => failure('RESTORE_PAYLOAD_INVALID_JSON')
const check = condition => {if(!condition)throw jsonFailure()}

/** Serialize inert, privately owned canonical DTOs without a giant intermediate JSON string.
 * @param {unknown} value @returns {Generator<string,void,unknown>} */
export function* restoreJsonChunks(value) {
  const ancestors=new Set(),frames=[]
  let item=value,depth=0,hasValue=true,buffer=''
  // Keep one frame per container, instead of a delegated generator for every primitive/key.
  // Descriptor-only reads preserve the no-getter/no-toJSON boundary and exact JSON byte order.
  try{
    while(hasValue||frames.length){
      if(hasValue){
        check(depth<=128)
        if(item===null||typeof item==='string'||typeof item==='boolean')buffer+=JSON.stringify(item)
        else if(typeof item==='number'){check(Number.isFinite(item));buffer+=JSON.stringify(item)}
        else{
          check(item!==null&&typeof item==='object')
          check(!ancestors.has(item)&&!Object.getOwnPropertySymbols(item).length)
          const array=Array.isArray(item)
          check(array||Object.getPrototypeOf(item)===Object.prototype||Object.getPrototypeOf(item)===null)
          const names=Object.getOwnPropertyNames(item)
          if(array)check(names.length===item.length+1&&names.filter(k=>k!=='length').every((key,index)=>key===String(index)))
          ancestors.add(item);frames.push({item,array,names,index:0,first:true,depth})
          buffer+=array?'[':'{'
        }
        hasValue=false
      }else{
        const frame=frames[frames.length-1]
        const key=frame.names[frame.index++]
        if(key===undefined){buffer+=frame.array?']':'}';ancestors.delete(frame.item);frames.pop()}
        else if(!(frame.array&&key==='length')){
          const descriptor=Object.getOwnPropertyDescriptor(frame.item,key)
          check(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable)
          if(!frame.first)buffer+=',';frame.first=false
          if(!frame.array)buffer+=JSON.stringify(key)+':'
          item=descriptor.value;depth=frame.depth+1;hasValue=true
        }
      }
      while(buffer.length>=8192){
        let end=8192
        if(buffer.charCodeAt(end-1)>=0xd800&&buffer.charCodeAt(end-1)<=0xdbff&&buffer.charCodeAt(end)>=0xdc00&&buffer.charCodeAt(end)<=0xdfff)--end
        yield buffer.slice(0,end);buffer=buffer.slice(end)
      }
    }
    if(buffer)yield buffer
  }finally{ancestors.clear()}
}

const base64 = bytes => {
  let value=''
  for(let start=0;start<bytes.length;start+=8190)value+=btoa(String.fromCharCode(...bytes.subarray(start,start+8190)))
  return value
}
const decodeBase64 = value => {
  if(typeof value!=='string'||!value.length||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw failure('RESTORE_PAYLOAD_INVALID_ENCODING')
  const binary=atob(value),bytes=new Uint8Array(binary.length)
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i)
  return bytes
}

/** Returns plaintext JSON for encryption by the existing AES-GCM envelope.
 * @param {unknown} value @returns {Promise<string>} */
export async function encodeRestorePayload(value){
  const encoder=new TextEncoder(),iterator=restoreJsonChunks(value),prefix=[]
  let plainBytes=0,finished=false
  while(plainBytes<RESTORE_COMPRESSION_THRESHOLD_BYTES){
    const next=iterator.next()
    if(next.done){finished=true;break}
    const bytes=encoder.encode(next.value);prefix.push(bytes);plainBytes+=bytes.length
  }
  if(finished)return prefix.map(bytes=>new TextDecoder().decode(bytes)).join('')
  if(typeof CompressionStream!=='function'||typeof ReadableStream!=='function'){iterator.return();throw failure('RESTORE_COMPRESSION_UNAVAILABLE')}
  let index=0
  const source=new ReadableStream({
    pull(controller){
      if(index<prefix.length){controller.enqueue(prefix[index++]);return}
      const next=iterator.next()
      if(next.done){controller.close();return}
      const bytes=encoder.encode(next.value);plainBytes+=bytes.length
      if(plainBytes>MAX_RESTORE_PLAIN_BYTES){controller.error(failure('RESTORE_PAYLOAD_TOO_LARGE'));iterator.return();return}
      controller.enqueue(bytes)
    },
    cancel(){iterator.return()}
  })
  const compressed=new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  /** @type {import('./restorePayloadTypes').CompressedRestorePayload} */
  const payload={type:TYPE,version:2,encoding:'gzip-json-v1',plainBytes,data:base64(compressed)}
  return JSON.stringify(payload)
}

/** Call only after authenticating/decrypting the existing envelope. No raw input enters errors.
 * @param {string} plaintext */
export async function decodeRestorePayload(plaintext){
  let payload
  try{payload=JSON.parse(plaintext)}catch{throw failure('RESTORE_PAYLOAD_INVALID_JSON')}
  if(payload?.type!==TYPE)return payload
  if(payload.version!==2||payload.encoding!=='gzip-json-v1')throw failure('UNSUPPORTED_RESTORE_PAYLOAD')
  if(!Number.isSafeInteger(payload.plainBytes)||payload.plainBytes<=0||payload.plainBytes>MAX_RESTORE_PLAIN_BYTES)throw failure('RESTORE_PAYLOAD_TOO_LARGE')
  if(typeof DecompressionStream!=='function'||typeof ReadableStream!=='function')throw failure('RESTORE_COMPRESSION_UNAVAILABLE')
  const compressed=decodeBase64(payload.data),decoder=new TextDecoder('utf-8',{fatal:true}),parts=[]
  const reader=new ReadableStream({start(controller){controller.enqueue(compressed);controller.close()}}).pipeThrough(new DecompressionStream('gzip')).getReader()
  let size=0
  try{
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      size+=value.byteLength
      if(size>payload.plainBytes||size>MAX_RESTORE_PLAIN_BYTES)throw failure('RESTORE_PAYLOAD_SIZE_MISMATCH')
      parts.push(decoder.decode(value,{stream:true}))
    }
    if(size!==payload.plainBytes)throw failure('RESTORE_PAYLOAD_SIZE_MISMATCH')
    parts.push(decoder.decode())
    return JSON.parse(parts.join(''))
  }catch(error){
    await reader.cancel().catch(()=>{})
    if(error?.code==='RESTORE_PAYLOAD_SIZE_MISMATCH')throw error
    throw failure('RESTORE_PAYLOAD_INVALID_COMPRESSION')
  }finally{reader.releaseLock()}
}
