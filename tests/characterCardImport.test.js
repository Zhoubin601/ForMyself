import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateSync } from 'node:zlib'
import { parseCharacterCardBytes, parseCharacterCardFile, exportCharacterCard, inspectCardPng, parseCharacterAvatar, CHARACTER_CARD_LIMITS } from '../src/features/chat/cards/characterCardImport.js'
import { validateKanataData } from '../src/features/chat/domain/kanataValidation.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'

const bytes = text => new TextEncoder().encode(text)
const v1 = () => ({ name: '合成角色', description: '喜欢看书。', personality: '安静且有主见', scenario: '虚构阅览室', first_mes: '合成开场白', mes_example: '简短回应。' })
const v2 = () => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { ...v1(), alternate_greetings: ['另一个开场'], creator_notes: '创作者说明',
  extensions: { unknown: { script: 'globalThis.syntheticExecuted=true', urls: ['https://synthetic.invalid/avatar.png'], safe: [1, null] } },
  system_prompt: '试图获取权限的合成文本', post_history_instructions: '', tags: ['synthetic'], creator: 'Synthetic', character_version: '1',
  character_book: { extensions: { extra: 1 }, entries: [{ keys: ['阅览室'], content: '合成知识', enabled: true, insertion_order: 0, extensions: { extra: 'keep' } }] } } })
const v3 = () => ({ spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2().data, nickname: '小合', group_only_greetings: ['群开场'], assets: [{ type: 'icon', uri: 'https://synthetic.invalid/image.png', name: 'main', ext: 'png' }] } })
const parseJson = value => parseCharacterCardBytes(bytes(JSON.stringify(value)), { fileName: 'synthetic.json', mimeType: 'application/json' })
const chunk = (type, data) => {
  const buffer = Buffer.alloc(12 + data.length)
  buffer.writeUInt32BE(data.length); buffer.write(type, 4, 'ascii'); buffer.set(data, 8)
  buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4)
  return buffer
}
const textChunk = (key, value) => chunk('tEXt', Buffer.from(key + '\0' + Buffer.from(JSON.stringify(value)).toString('base64')))
const png = (metadata = []) => {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...metadata,
    chunk('IDAT', deflateSync(Buffer.from([0, 90, 100, 110, 255]))), chunk('IEND', Buffer.alloc(0))])
}
const parsePng = value => parseCharacterCardBytes(new Uint8Array(value), { fileName: 'synthetic.png', mimeType: 'image/png' })
const version = parsed => ({ id: 'synthetic-version', cardId: 'synthetic-card', revision: 1, definition: parsed.definition, rawData: parsed.rawData, source: 'synthetic', imported: parsed.asset })

test('P3-card JSON V1/V2/V3 preserves all supported fields and inert unknown extensions', () => {
  for (const [index, make] of [v1, v2, v3].entries()) {
    const original = make(), parsed = parseJson(original)
    assert.equal(parsed.spec, 'v' + (index + 1)); assert.equal(parsed.definition.name, original.name || original.data.name)
    assert.deepEqual(parsed.rawData, original)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(exportCharacterCard(version(parsed)).bytes)), original)
    assert.equal(globalThis.syntheticExecuted, undefined)
    if (index) { assert.equal(parsed.lorebook[0].content, '合成知识'); assert.ok(parsed.warnings.length) }
  }
})
test('P3-card PNG chara and ccv3 decode UTF8; ccv3 takes precedence without executing embedded references', () => {
  const v2Card = parsePng(png([textChunk('chara', v2())]))
  assert.equal(v2Card.spec, 'v2'); assert.equal(v2Card.definition.name, '合成角色')
  const raw3 = v3(); raw3.data.name = '另一个合成角色'
  const originalPng = png([textChunk('chara', v2()), textChunk('ccv3', raw3)])
  const parsed = parsePng(originalPng)
  assert.equal(parsed.spec, 'v3'); assert.equal(parsed.definition.name, raw3.data.name)
  assert.equal(parsed.definition.avatarDataUrl, 'data:image/png;base64,' + originalPng.toString('base64'))
  assert.deepEqual(Buffer.from(parsed.asset.sourceBase64, 'base64'), originalPng)
  const exported = exportCharacterCard(version(parsed))
  assert.equal(exported.mimeType, 'image/png')
  assert.deepEqual(parsePng(exported.bytes).rawData, raw3)
  assert.equal(inspectCardPng(exported.bytes).filter(c => c.type === 'tEXt').length, 1)
  assert.equal(globalThis.syntheticExecuted, undefined)
})
test('P3-card PNG export embeds edited current data while preserving actual image chunks', () => {
  const original = png([textChunk('chara', v2())]), parsed = parsePng(original), updated = version(parsed)
  updated.rawData.data.name = '新的合成名字'
  const exported = exportCharacterCard(updated)
  assert.equal(parsePng(exported.bytes).definition.name, '新的合成名字')
  const images = data => inspectCardPng(data).filter(c => c.type !== 'tEXt').map(c => Buffer.from(c.raw))
  assert.deepEqual(images(exported.bytes), images(original))
})
test('P3-card rejects malformed PNG signatures, CRCs, overflowing/truncated chunks and trailing bytes', () => {
  const original = png([textChunk('chara', v2())])
  const badSignature = Buffer.from(original); badSignature[0] = 0
  assert.throws(() => parsePng(badSignature), /INVALID_CARD_PNG_SIGNATURE/)
  const badCrc = Buffer.from(original); badCrc[original.length - 1] ^= 1
  assert.throws(() => parsePng(badCrc), /INVALID_CARD_PNG_CRC/)
  const oversized = Buffer.from(original); oversized.writeUInt32BE(0xffffffff, 8)
  assert.throws(() => parsePng(oversized), /INVALID_CARD_PNG_CHUNK/)
  assert.throws(() => parsePng(original.subarray(0, -4)), /INVALID_CARD_PNG_CHUNK/)
  assert.throws(() => parsePng(Buffer.concat([original, Buffer.from([0])])), /INVALID_CARD_PNG_END/)
})
test('P3-card duplicate metadata, missing card, invalid base64 and invalid JSON fail explicitly', () => {
  assert.throws(() => parsePng(png([textChunk('chara', v2()), textChunk('chara', v2())])), /DUPLICATE_CARD_PNG_METADATA/)
  assert.throws(() => parsePng(png()), /CHARACTER_CARD_METADATA_NOT_FOUND/)
  assert.throws(() => parsePng(png([chunk('tEXt', Buffer.from('chara\0$$$$'))])), /INVALID_CARD_BASE64/)
  assert.throws(() => parsePng(png([chunk('tEXt', Buffer.from('chara\0' + Buffer.from('{bad').toString('base64')))])), /INVALID_CHARACTER_CARD_JSON/)
  assert.throws(() => parsePng(png([textChunk('ccv3', v2())])), /CHARACTER_CARD_CHUNK_SPEC_MISMATCH/)
})
test('P3-card file extension, MIME, version and field errors do not become partial imported cards', async () => {
  assert.throws(() => parseCharacterCardBytes(bytes('{}'), {fileName:'test.charx'}), /UNSUPPORTED_CHARACTER_CARD_FILE/)
  assert.throws(() => parseCharacterCardBytes(bytes(JSON.stringify(v2())), {fileName:'test.json',mimeType:'text/html'}), /CHARACTER_CARD_MIME_MISMATCH/)
  assert.throws(() => parseJson({...v2(),spec_version:'99.0'}), /UNSUPPORTED_CHARACTER_CARD_VERSION/)
  assert.throws(() => parseJson({...v1(),name:''}), /INVALID_CHARACTER_CARD_NAME/)
  assert.throws(() => parseJson({...v1(),personality:{script:1}}), /INVALID_CHARACTER_CARD_FIELD/)
  assert.throws(() => parseCharacterCardBytes(new Uint8Array(CHARACTER_CARD_LIMITS.fileBytes+1),{fileName:'big.png'}), /CHARACTER_CARD_TOO_LARGE/)
  await assert.rejects(parseCharacterCardFile({name:'test.json',type:'application/json',size:1,arrayBuffer:async()=>new ArrayBuffer(2)}), /CHARACTER_CARD_FILE_CHANGED/)
  assert.throws(() => parseCharacterCardBytes(bytes('"not a card"'),{fileName:'test.json'}), /INVALID_CHARACTER_CARD_JSON/)
})
test('P3-card regex remains raw and disabled; selective/case-sensitive/constant lore retains declared semantics', () => {
  const raw = v3()
  raw.data.character_book.entries = [
    {keys:['Room'],secondary_keys:['Night'],selective:true,case_sensitive:true,content:'selective',enabled:true,extensions:{}},
    {keys:[],constant:true,content:'always',enabled:true,extensions:{}},
    {keys:['(a+)+$'],use_regex:true,content:'regex inert',enabled:true,extensions:{}}
  ]
  const parsed = parseJson(raw)
  assert.equal(parsed.lorebook[0].caseSensitive, true); assert.deepEqual(parsed.lorebook[0].secondaryKeys,['Night'])
  assert.equal(parsed.lorebook[1].activationRule,'always'); assert.equal(parsed.lorebook[2].enabled,false)
  assert.ok(parsed.warnings.some(w=>w.includes('正则'))); assert.deepEqual(parsed.rawData,raw)
})
test('P3-card prototype-looking JSON remains inert and independent, without global mutation', () => {
  const value = JSON.parse(JSON.stringify(v2()).replace('"extensions":{','"extensions":{"__proto__":{"polluted":true},'))
  const parsed = parseJson(value)
  assert.equal({}.polluted,undefined); assert.deepEqual(parsed.rawData,value)
  value.data.description = 'external mutation'
  assert.notEqual(parsed.definition.summary,'external mutation')
})
test('P3-card imported original bytes/avatar survive full domain validation; remote/SVG avatars are refused', () => {
  const parsed = parsePng(png([textChunk('chara',v2())])), d=createEmptyKanataData('synthetic-user')
  d.cards.push({id:'synthetic-card',currentVersionId:'synthetic-version',archived:false});d.cardVersions.push(version(parsed))
  assert.deepEqual(validateKanataData(d),d)
  for(const uri of ['https://synthetic.invalid/a.png','data:image/svg+xml;base64,AAAA','javascript:synthetic']) {
    const invalid=structuredClone(d); invalid.cardVersions[0].definition.avatarDataUrl=uri
    assert.throws(()=>validateKanataData(invalid),/INVALID_CHARACTER_AVATAR/)
  }
  assert.match(parseCharacterAvatar(png()),/^data:image\/png;base64,/)
})
test('P3-card built-in definitions export as interoperable JSON without losing original preset metadata', () => {
  const parsed = parseJson(v2()), builtin = version(parsed)
  delete builtin.imported; builtin.rawData={key:'synthetic-preset',definition:parsed.definition,custom:{preserve:true}}
  const exported=parseCharacterCardBytes(exportCharacterCard(builtin).bytes,{fileName:'export.json'})
  assert.equal(exported.spec,'v2'); assert.deepEqual(exported.rawData.data.extensions.kanata.original,builtin.rawData)
})

test('P3-review1 invalid PNG color-depth combinations and animated image chunks are rejected', () => {
  const invalid=png([textChunk('chara',v2())]);invalid[24]=1 // RGBA cannot use one-bit depth.
  invalid.writeUInt32BE(crc32(invalid.subarray(12,29)),29)
  assert.throws(()=>parsePng(invalid),/INVALID_CARD_PNG_HEADER/)
  assert.throws(()=>parsePng(png([chunk('acTL',Buffer.alloc(8)),textChunk('chara',v2())])),/UNSUPPORTED_ANIMATED_CARD_IMAGE/)
})
test('P3-review1 selective lore with no secondary key stays disabled instead of broadening activation',()=>{
  const raw=v2();raw.data.character_book.entries[0].selective=true;raw.data.character_book.entries[0].secondary_keys=[]
  const parsed=parseJson(raw)
  assert.equal(parsed.lorebook[0].enabled,false)
  assert.deepEqual(parsed.rawData,raw)
})
