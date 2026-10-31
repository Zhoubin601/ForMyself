import assert from 'node:assert/strict'
import test from 'node:test'
import CryptoJS from 'crypto-js'
import {encryptPassphraseAes,decryptPassphraseAes,encryptPassphraseAesAsync,decryptPassphraseAesAsync} from '../src/shared/crypto/passphraseAes.js'
import {sha256Text} from '../src/shared/crypto/sha256Text.js'
const password='synthetic-streaming-password'

test('P7 platform AES backend keeps the exact old OpenSSL envelope for a fixed salt and bidirectional legacy compatibility',async()=>{
  const salt=CryptoJS.enc.Hex.parse('0011223344556677'),original=CryptoJS.lib.WordArray.random
  try{
    CryptoJS.lib.WordArray.random=()=>salt.clone()
    for(const text of ['', '\ufeff合成BOM','合成中文🚀\n',...[15,16,17,8191,8192,8193,32769].map(n=>'a'.repeat(n)), 'a'.repeat(8191)+'🚀中文'.repeat(3000),JSON.stringify({unpaired:'\ud800'})]){
      const wire=CryptoJS.AES.encrypt(text,password,{salt}).toString()
      assert.equal(await encryptPassphraseAesAsync(text,password),wire)
      assert.equal(await decryptPassphraseAesAsync(wire,password),text)
      assert.equal(decryptPassphraseAes(await encryptPassphraseAesAsync(text,password),password),text)
      assert.equal(CryptoJS.AES.decrypt(await encryptPassphraseAesAsync(text,password),password).toString(CryptoJS.enc.Utf8),text)
    }
  }finally{CryptoJS.lib.WordArray.random=original}
})

test('P7 platform AES uses fresh salt and rejects wrong passwords, truncated headers, invalid padding and UTF8',async()=>{
  const text='合成资料'.repeat(6000),wire=await encryptPassphraseAesAsync(text,password)
  assert.notEqual(await encryptPassphraseAesAsync(text,password),wire)
  for(const invalid of ['',wire.slice(0,-4),wire+'!',wire.slice(0,-8)+'AAAAAAAA',Buffer.alloc(32).toString('base64')])await assert.rejects(decryptPassphraseAesAsync(invalid,password))
  await assert.rejects(decryptPassphraseAesAsync(wire,'wrong-synthetic-password'))
  await assert.rejects(encryptPassphraseAesAsync(text,''));await assert.rejects(decryptPassphraseAesAsync(wire,''))
  for(const unpaired of ['\ud800','\udfff','a\ud800z'])await assert.rejects(encryptPassphraseAesAsync(unpaired,password),URIError)
  const salt=CryptoJS.enc.Hex.parse('0011223344556677'),derived=CryptoJS.kdf.OpenSSL.execute(password,8,4,salt)
  const invalidUtf8=CryptoJS.AES.encrypt(CryptoJS.lib.WordArray.create([0xff000000],1),derived.key,{iv:derived.iv}).ciphertext
  const invalidWire=CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.create([0x53616c74,0x65645f5f],8).concat(salt).concat(invalidUtf8))
  await assert.rejects(decryptPassphraseAesAsync(invalidWire,password))
})

test('P7 absence of platform crypto falls back byte-compatibly; available platform errors never silently switch backends',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto'),plain='合成能力回退',wire=encryptPassphraseAes(plain,password)
  try{
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}})
    assert.equal(decryptPassphraseAes(await encryptPassphraseAesAsync(plain,password),password),plain)
    assert.equal(await decryptPassphraseAesAsync(wire,password),plain)
    let calls=0
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{importKey:async()=>{calls++;throw Error('synthetic-native-error')}}}})
    await assert.rejects(encryptPassphraseAesAsync(plain,password),error=>error.code==='PASSPHRASE_AES_INVALID_CIPHERTEXT'&&!error.message.includes('synthetic-native-error'))
    await assert.rejects(decryptPassphraseAesAsync(wire,password),error=>error.code==='PASSPHRASE_AES_INVALID_CIPHERTEXT')
    assert.equal(calls,2)
  }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto}
})
test('P7 incremental UTF8 SHA256 preserves existing recovery fingerprints including surrogate chunk boundaries',()=>{
  for(const value of ['', '合成哈希', '\ufeff头部BOM','a'.repeat(8191)+'🚀'.repeat(8192),'0'.repeat(250000)])assert.equal(sha256Text(value),CryptoJS.SHA256(value).toString())
})
test('P7 chunked AES emits exactly the existing CryptoJS passphrase wire bytes for the same synthetic salt',()=>{
  const salt=CryptoJS.enc.Hex.parse('0011223344556677'),original=CryptoJS.lib.WordArray.random
  try{
    CryptoJS.lib.WordArray.random=()=>salt.clone()
    for(const plaintext of ['', 'a','\ufeff合成开头BOM','合成中文🚀\n', ...[15,16,17,8191,8192,8193,16383,32769].map(n=>'a'.repeat(n)), 'a'.repeat(8191)+'🚀中文'.repeat(3000),JSON.stringify({unpaired:'\ud800',text:'𠮷野家'})]){
      const legacy=CryptoJS.AES.encrypt(plaintext,password,{salt}).toString(),chunked=encryptPassphraseAes(plaintext,password)
      assert.equal(chunked,legacy)
      assert.equal(decryptPassphraseAes(legacy,password),plaintext)
      assert.equal(CryptoJS.AES.decrypt(chunked,password).toString(CryptoJS.enc.Utf8),plaintext)
    }
  }finally{CryptoJS.lib.WordArray.random=original}
})
test('P7 native UTF8 conversion rejects malformed surrogate input exactly as the legacy encoder',()=>{
  for(const text of ['\ud800','\udfff','a\ud800z','a'.repeat(8191)+'\ud800']){
    assert.throws(()=>CryptoJS.enc.Utf8.parse(text),URIError)
    assert.throws(()=>encryptPassphraseAes(text,password),URIError)
    assert.throws(()=>sha256Text(text),URIError)
  }
})
test('P7 chunked AES uses fresh random salt and rejects wrong password, malformed/truncated ciphertext and corrupt padding',()=>{
  const data=JSON.stringify({body:'仅合成资料。'.repeat(6000)}),first=encryptPassphraseAes(data,password),second=encryptPassphraseAes(data,password)
  assert.notEqual(first,second);assert.equal(decryptPassphraseAes(first,password),data)
  for(const bad of ['','invalid',first.slice(0,-4),first+'!',first.slice(0,-8)+'AAAAAAAA'])assert.throws(()=>decryptPassphraseAes(bad,password))
  assert.throws(()=>decryptPassphraseAes(first,'wrong-synthetic-password'))
  assert.throws(()=>decryptPassphraseAes(first,''));assert.throws(()=>encryptPassphraseAes(data,''))
})
test('P7 UTF8 decoding retains multibyte characters across AES blocks and Base64 chunk boundaries',()=>{
  for(let offset=0;offset<32;offset++){
    const text='a'.repeat(offset)+('合成🚀𠮷é\n'.repeat(1300)),wire=CryptoJS.AES.encrypt(text,password).toString()
    assert.equal(decryptPassphraseAes(wire,password),text)
  }
})
