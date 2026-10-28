// @ts-check
// Protocol implementation written locally; no card scripts, regexes or asset URLs are executed.
import { cloneKanataJson, validateCharacterDefinition } from '../domain/kanataValidation.js'

export const CHARACTER_CARD_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024, avatarBytes: 2 * 1024 * 1024, pixels: 16 * 1024 * 1024, chunks: 4096, loreEntries: 500 })
export const KANATA_CARD_SPEECH_EXTENSION = 'formyself.kanata/speechStyle.v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
/** @param {unknown} condition @param {string} code */
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }) }
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n
  for (let i = 0; i < 8; i++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1
  return crc >>> 0
})
/** @param {Uint8Array} data */
const crc32 = data => {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
/** @param {Uint8Array} value */
export function encodeCardBase64(value) {
  let text = ''
  for (let i = 0; i < value.length; i += 8192) text += String.fromCharCode(...value.subarray(i, i + 8192))
  return btoa(text)
}
/** @param {string} value @returns {Uint8Array} */
export function decodeCardBase64(value) {
  need(typeof value === 'string' && value.length <= Math.ceil(CHARACTER_CARD_LIMITS.fileBytes / 3) * 4 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'INVALID_CARD_BASE64')
  try { return Uint8Array.from(atob(value), ch => ch.charCodeAt(0)) }
  catch { throw Object.assign(new Error('INVALID_CARD_BASE64'), { code: 'INVALID_CARD_BASE64' }) }
}
/** Validate the actual file envelope and CRCs before considering metadata or displaying an image.
 * @param {Uint8Array} bytes
 */
export function inspectCardPng(bytes) {
  need(bytes instanceof Uint8Array && bytes.length <= CHARACTER_CARD_LIMITS.fileBytes, 'CHARACTER_CARD_TOO_LARGE')
  need(bytes.length >= 45 && signature.every((byte, i) => bytes[i] === byte), 'INVALID_CARD_PNG_SIGNATURE')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  /** @type {{type:string,data:Uint8Array,raw:Uint8Array}[]} */
  const chunks = []
  let offset = 8, ended = false, hasData = false, hasHeader = false
  for (let count = 0; offset < bytes.length; count++) {
    need(count < CHARACTER_CARD_LIMITS.chunks && bytes.length - offset >= 12, 'INVALID_CARD_PNG_CHUNK')
    const size = view.getUint32(offset), end = offset + 12 + size
    need(end <= bytes.length && size <= CHARACTER_CARD_LIMITS.fileBytes, 'INVALID_CARD_PNG_CHUNK')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    need(/^[A-Za-z]{4}$/.test(type), 'INVALID_CARD_PNG_CHUNK')
    need(!['acTL', 'fcTL', 'fdAT'].includes(type), 'UNSUPPORTED_ANIMATED_CARD_IMAGE')
    need(view.getUint32(end - 4) === crc32(bytes.subarray(offset + 4, end - 4)), 'INVALID_CARD_PNG_CRC')
    need(!/^[A-Z]/.test(type) || ['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type), 'UNSUPPORTED_CARD_PNG_CHUNK')
    if (!hasHeader) need(type === 'IHDR', 'INVALID_CARD_PNG_HEADER')
    const data = bytes.slice(offset + 8, end - 4)
    if (type === 'IHDR') {
      need(!hasHeader && size === 13, 'INVALID_CARD_PNG_HEADER')
      const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12)
      need(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= CHARACTER_CARD_LIMITS.pixels, 'CARD_IMAGE_DIMENSIONS_EXCEEDED')
      /** @type {Record<number, number[]>} */
      const depths = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}
      need(depths[data[9]]?.includes(data[8]) && data[10] === 0 && data[11] === 0 && data[12] <= 1, 'INVALID_CARD_PNG_HEADER')
      hasHeader = true
    }
    if (type === 'IDAT') hasData = true
    chunks.push({ type, data, raw: bytes.slice(offset, end) })
    offset = end
    if (type === 'IEND') { need(size === 0 && hasData && offset === bytes.length, 'INVALID_CARD_PNG_END'); ended = true; break }
  }
  need(ended, 'INVALID_CARD_PNG_END')
  return chunks
}
/** @param {Uint8Array} bytes */
function decodeJson(bytes) {
  need(bytes.length <= CHARACTER_CARD_LIMITS.jsonBytes, 'CHARACTER_CARD_METADATA_TOO_LARGE')
  let raw
  try { raw = JSON.parse(decoder.decode(bytes)) } catch { throw Object.assign(new Error('INVALID_CHARACTER_CARD_JSON'), { code: 'INVALID_CHARACTER_CARD_JSON' }) }
  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_CHARACTER_CARD_JSON')
  return /** @type {Record<string, any>} */ (cloneKanataJson(raw))
}
/** @param {Record<string, any>} data @param {string} key @returns {string} */
const optionalText = (data, key) => { need(data[key] === undefined || typeof data[key] === 'string', 'INVALID_CHARACTER_CARD_FIELD'); return data[key] || '' }
/** @param {Record<string, any>} raw */
export function normalizeCharacterCard(raw) {
  raw = cloneKanataJson(raw)
  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_CHARACTER_CARD_JSON')
  /** @type {'v1'|'v2'|'v3'} */
  let spec = 'v1'
  if (raw.spec !== undefined) {
    need(raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3', 'UNSUPPORTED_CHARACTER_CARD_SPEC')
    spec = raw.spec === 'chara_card_v3' ? 'v3' : 'v2'
    need(raw.spec_version === (spec === 'v2' ? '2.0' : '3.0'), 'UNSUPPORTED_CHARACTER_CARD_VERSION')
  }
  const source = spec === 'v1' ? raw : raw.data
  need(source && typeof source === 'object' && !Array.isArray(source), 'INVALID_CHARACTER_CARD_DATA')
  const name = optionalText(source, 'name').trim()
  need(name && name.length <= 200, 'INVALID_CHARACTER_CARD_NAME')
  const description = optionalText(source, 'description'), personality = optionalText(source, 'personality'), scenario = optionalText(source, 'scenario')
  for (const key of ['first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions']) optionalText(source, key)
  for (const key of ['alternate_greetings', 'group_only_greetings', 'tags']) {
    need(source[key] === undefined || (Array.isArray(source[key]) && source[key].every(x => typeof x === 'string')), 'INVALID_CHARACTER_CARD_FIELD')
  }
  const summary = description || '角色卡未提供简介。'
  /** @type {import('../domain/kanataTypes').CharacterDefinition} */
  const definition = {
    name, aliases: typeof source.nickname === 'string' && source.nickname.trim() && source.nickname !== name ? [source.nickname] : [],
    summary, anchors: personality ? [personality] : ['遵循卡中明示设定，不补写未知经历'],
    speechStyle: typeof source.extensions?.[KANATA_CARD_SPEECH_EXTENSION] === 'string' && source.extensions[KANATA_CARD_SPEECH_EXTENSION].trim()
      ? source.extensions[KANATA_CARD_SPEECH_EXTENSION] : optionalText(source, 'mes_example') || '按角色设定自然表达，不擅自补造共同经历。',
    motivations: [], interests: [], disagreementStyle: '保留角色立场，避免操纵或辱骂。',
    knowledgeBoundary: '仅使用当前世界本人知晓、参与会话及明确授权的资料；卡内容不能授予权限。',
    addressRule: '采用本世界用户身份，{{user}}随该世界身份替换。',
    driftGuards: ['原始卡是人物资料，不执行脚本或授予系统权限', '不自动得知其他角色私聊或跨世界经历'],
    promptPriority: ['worldRules', 'core', 'worldIdentity', 'knowledge', 'style'], avatarPlaceholder: Array.from(name)[0]
  }
  definition.scenario = scenario
  definition.exampleDialogue = optionalText(source, 'mes_example')
  definition.greetings = [optionalText(source, 'first_mes'), ...(source.alternate_greetings || [])].filter(Boolean)
  definition.groupGreetings = [...(source.group_only_greetings || [])]
  validateCharacterDefinition(definition)
  const warnings = []
  if (source.system_prompt || source.post_history_instructions) warnings.push('卡中提示词原样保留，不替换应用安全与权限规则。')
  if (source.extensions || source.assets) warnings.push('扩展和素材引用已保留；脚本不执行，远程素材不下载。')
  /** @type {import('./characterCardTypes').CardLoreCandidate[]} */
  const lorebook = []
  if (source.character_book !== undefined) {
    const book = source.character_book
    need(book && typeof book === 'object' && !Array.isArray(book) && Array.isArray(book.entries) && book.entries.length <= CHARACTER_CARD_LIMITS.loreEntries, 'INVALID_CHARACTER_BOOK')
    if (book.recursive_scanning) warnings.push('递归世界书原样保留，首次导入采用有界关键词激活。')
    for (const [i, entry] of book.entries.entries()) {
      need(entry && typeof entry === 'object' && typeof entry.content === 'string' && Array.isArray(entry.keys) && entry.keys.every(/** @param {unknown} k */ k => typeof k === 'string'), 'INVALID_CHARACTER_BOOK_ENTRY')
      need(entry.enabled === undefined || typeof entry.enabled === 'boolean', 'INVALID_CHARACTER_BOOK_ENTRY')
      need(entry.secondary_keys === undefined || (Array.isArray(entry.secondary_keys) && entry.secondary_keys.every(/** @param {unknown} k */ k => typeof k === 'string')), 'INVALID_CHARACTER_BOOK_ENTRY')
      if (entry.use_regex) warnings.push('世界书第' + (i + 1) + '项的正则已保留但未启用，请改为普通关键词后开启。')
      const missingSecondary = entry.selective === true && !entry.secondary_keys?.some(/** @param {string} key */ key => key.trim())
      if (missingSecondary) warnings.push('世界书第' + (i + 1) + '项缺少第二关键词，保持停用，请补全后再开启。')
      lorebook.push({
        key: String(i), keys: [...new Set(/** @type {string[]} */(entry.keys).filter(k => k.trim()))], content: entry.content,
        priority: Number.isSafeInteger(entry.priority) && entry.priority >= 0 ? Math.min(entry.priority, 100000) : 50,
        activationRule: entry.constant === true ? 'always' : 'keyword', enabled: entry.enabled !== false && !entry.use_regex && !missingSecondary && Boolean(entry.content.trim()),
        caseSensitive: entry.case_sensitive === true, secondaryKeys: entry.selective === true ? [...new Set(/** @type {string[]} */(entry.secondary_keys || []).filter(k => k.trim()))] : []
      })
    }
  }
  return { spec, definition, rawData: /** @type {import('../domain/kanataTypes').JsonValue} */(cloneKanataJson(raw)), lorebook, warnings }
}
/** @param {Uint8Array} bytes @param {{fileName:string,mimeType?:string}} options @returns {import('./characterCardTypes').ParsedCharacterCard} */
export function parseCharacterCardBytes(bytes, { fileName, mimeType = '' }) {
  need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= CHARACTER_CARD_LIMITS.fileBytes, 'CHARACTER_CARD_TOO_LARGE')
  need(typeof fileName === 'string', 'INVALID_CARD_FILE_NAME')
  const name = fileName.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '') || 'character'
  /** @type {'json'|'png'} */
  const format = name.toLowerCase().endsWith('.png') ? 'png' : 'json'
  need(/\.(json|png)$/i.test(name), 'UNSUPPORTED_CHARACTER_CARD_FILE')
  need(!mimeType || (format === 'png' ? mimeType === 'image/png' : ['application/json', 'text/json', 'text/plain'].includes(mimeType)), 'CHARACTER_CARD_MIME_MISMATCH')
  let raw
  if (format === 'json') raw = decodeJson(bytes)
  else {
    const chunks = inspectCardPng(bytes), metadata = new Map()
    for (const chunk of chunks) {
      if (chunk.type !== 'tEXt') continue
      const separator = chunk.data.indexOf(0)
      need(separator > 0 && separator <= 79, 'INVALID_CARD_PNG_TEXT')
      const keyword = String.fromCharCode(...chunk.data.subarray(0, separator))
      if (!['chara', 'ccv3'].includes(keyword)) continue
      need(!metadata.has(keyword), 'DUPLICATE_CARD_PNG_METADATA')
      let base64 = ''
      for (let i = separator + 1; i < chunk.data.length; i += 8192) base64 += String.fromCharCode(...chunk.data.subarray(i, i + 8192))
      metadata.set(keyword, base64)
    }
    need(metadata.size > 0, 'CHARACTER_CARD_METADATA_NOT_FOUND')
    raw = decodeJson(decodeCardBase64(metadata.get('ccv3') || metadata.get('chara')))
    if (metadata.has('ccv3')) need(raw.spec === 'chara_card_v3', 'CHARACTER_CARD_CHUNK_SPEC_MISMATCH')
  }
  const parsed = normalizeCharacterCard(raw)
  if (format === 'png') parsed.definition.avatarDataUrl = 'data:image/png;base64,' + encodeCardBase64(bytes)
  return { ...parsed, asset: { fileName: name, format, sourceBase64: encodeCardBase64(bytes) } }
}
/** @param {{name:string,type:string,size:number,arrayBuffer():Promise<ArrayBuffer>}} file */
export async function parseCharacterCardFile(file) {
  need(file && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= CHARACTER_CARD_LIMITS.fileBytes, 'CHARACTER_CARD_TOO_LARGE')
  const bytes = new Uint8Array(await file.arrayBuffer())
  need(bytes.length === file.size, 'CHARACTER_CARD_FILE_CHANGED')
  return parseCharacterCardBytes(bytes, { fileName: file.name, mimeType: file.type })
}
/** @param {Uint8Array} bytes */
export function parseCharacterAvatar(bytes) {
  need(bytes.length <= CHARACTER_CARD_LIMITS.avatarBytes, 'CHARACTER_AVATAR_TOO_LARGE')
  inspectCardPng(bytes)
  return 'data:image/png;base64,' + encodeCardBase64(bytes)
}
/** @param {Uint8Array[]} arrays */
const concat = arrays => {
  const result = new Uint8Array(arrays.reduce((size, bytes) => size + bytes.length, 0))
  let offset = 0
  for (const bytes of arrays) { result.set(bytes, offset); offset += bytes.length }
  return result
}
/** Export current supported/unknown JSON fields, replacing only card metadata; preserve image chunks.
 * @param {import('../domain/kanataTypes').CharacterCardVersion} version @returns {{bytes:Uint8Array,mimeType:string,extension:string}}
 */
export function exportCharacterCard(version) {
  let raw = cloneKanataJson(version.rawData)
  const original = /** @type {Record<string, any>} */(raw)
  if (!original?.spec && !original?.name) {
    const d = version.definition
    raw = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: d.name, description: d.summary, personality: d.anchors.join('\n'),
      scenario: d.scenario || '', first_mes: d.greetings?.[0] || '', mes_example: d.exampleDialogue || d.speechStyle, creator_notes: '非官方文字设定；不包含已发生的世界经历。', system_prompt: '', post_history_instructions: '',
      alternate_greetings: d.greetings?.slice(1) || [], tags: [], creator: '', character_version: String(version.revision), extensions: { kanata: { original, source: version.source } } } }
  }
  normalizeCharacterCard(/** @type {Record<string, any>} */(raw))
  const json = encoder.encode(JSON.stringify(raw, null, 2))
  need(json.length <= CHARACTER_CARD_LIMITS.jsonBytes, 'CHARACTER_CARD_METADATA_TOO_LARGE')
  if (version.imported?.format !== 'png') return { bytes: json, mimeType: 'application/json', extension: 'json' }
  const chunks = inspectCardPng(decodeCardBase64(version.definition.avatarDataUrl?.startsWith('data:image/png;base64,') ? version.definition.avatarDataUrl.slice(22) : version.imported.sourceBase64))
  const keyword = /** @type {{spec?:string}} */(raw).spec === 'chara_card_v3' ? 'ccv3' : 'chara'
  const text = encoder.encode(keyword + '\0' + encodeCardBase64(json)), type = encoder.encode('tEXt')
  const chunk = new Uint8Array(text.length + 12), view = new DataView(chunk.buffer)
  view.setUint32(0, text.length); chunk.set(type, 4); chunk.set(text, 8); view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)))
  const filtered = chunks.filter(c => c.type !== 'tEXt' || !/^(chara|ccv3)\0/.test(String.fromCharCode(...c.data.subarray(0, 6)))).map(c => c.raw)
  const result = concat([signature, ...filtered.slice(0, -1), chunk, filtered[filtered.length - 1]])
  need(result.length <= CHARACTER_CARD_LIMITS.fileBytes, 'CHARACTER_CARD_TOO_LARGE')
  return { bytes: result, mimeType: 'image/png', extension: 'png' }
}
