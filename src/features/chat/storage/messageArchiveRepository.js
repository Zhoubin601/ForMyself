import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import {encryptPassphraseAesAsync,decryptPassphraseAesAsync} from '../../../shared/crypto/passphraseAes.js'
import {sha256Text} from '../../../shared/crypto/sha256Text.js'
import {mapInBatches} from '../../../shared/async/mapInBatches.js'
import { createArchiveIndex, validateArchivePage, messageOrder, archiveMayMatch, normalizeArchiveQuery } from './messageArchiveCore.js'

export const KANATA_ARCHIVE_DIRECTORY = 'formyself/kanata-pages-v1'
const fail = code => Object.assign(new Error(code), { code })
const fingerprint = value => sha256Text(value)
const pathOf = key => {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw fail('KANATA_ARCHIVE_PATH_INVALID')
  return KANATA_ARCHIVE_DIRECTORY + '/' + key + '.enc'
}
const assertPassword = password => { if (typeof password !== 'string' || !password) throw fail('KANATA_PASSWORD_REQUIRED') }
const checkScope = (page, scope) => {
  if (page.worldId !== scope.worldId || page.conversationId !== scope.conversationId) throw fail('KANATA_ARCHIVE_SCOPE_DENIED')
}

/** Immutable encrypted files; no password, plaintext cache or second source of truth is retained. */
export function createMessageArchiveRepository({ filesystem = Filesystem, directory = Directory.Data } = {}) {
  const options = path => ({ path, directory, encoding: Encoding.UTF8 })
  /** Non-sensitive directory readiness only; failures are never cached as success.
   * @type {Promise<void>|null} */
  let directoryCreation=null
  const ensureDirectory=()=>{
    if(directoryCreation)return directoryCreation
    const task=(async()=>{
      try{await filesystem.mkdir({path:KANATA_ARCHIVE_DIRECTORY,directory,recursive:true})}
      catch(error){if(!['EEXIST','OS-PLUG-FILE-0010'].includes(error?.code)&&!/already exist/i.test(error?.message??''))throw fail('KANATA_ARCHIVE_WRITE_FAILED')}
    })()
    directoryCreation=task
    void task.catch(()=>{if(directoryCreation===task)directoryCreation=null})
    return task
  }
  const readCipher = async descriptor => {
    const path = pathOf(descriptor.key)
    let result
    try { result = await filesystem.readFile(options(path)) }
    catch { throw fail('KANATA_ARCHIVE_READ_FAILED') }
    if (typeof result.data !== 'string' || result.data.length !== descriptor.bytes || fingerprint(result.data) !== descriptor.key) throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
    return result.data
  }
  /** Returns privately detached verified DTOs, with no retained plaintext reference.
   * @param {import('../domain/kanataTypes').MessageArchiveDescriptor} descriptor @param {string} password
   * @param {{worldId:string,conversationId:string}} scope @param {() => void} [assertCurrent] */
  const read = async (descriptor, password, scope, assertCurrent = () => {}) => {
    assertPassword(password); checkScope(descriptor, scope); assertCurrent()
    const ciphertext = await readCipher(descriptor)
    assertCurrent()
    let plaintext,value
    try { plaintext = await decryptPassphraseAesAsync(ciphertext,password) }
    catch { throw fail('KANATA_ARCHIVE_DECRYPT_FAILED') }
    assertCurrent()
    try{value=JSON.parse(plaintext)}catch{throw fail('KANATA_ARCHIVE_DECRYPT_FAILED')}
    const messages = validateArchivePage(value, descriptor)
    assertCurrent()
    return messages
  }
  /** Copy-on-write rekey preserves the exact verified plaintext, including unknown fields.
   * No repeated JSON encoding/index construction or mkdir bridge call is needed after a
   * successful old-page read. New bytes and their decrypted plaintext are both read back.
   * The owner must still commit both canonical headers before retiring any previous page.
   * @param {import('../domain/kanataTypes').MessageArchiveDescriptor} descriptor
   * @param {string} previousPassword @param {string} nextPassword
   * @param {{worldId:string,conversationId:string}} scope @param {() => void} [assertCurrent] */
  const reencrypt = async (descriptor, previousPassword, nextPassword, scope, assertCurrent = () => {}) => {
    assertPassword(previousPassword);assertPassword(nextPassword);checkScope(descriptor,scope);assertCurrent()
    const oldCiphertext=await readCipher(descriptor)
    assertCurrent()
    let plaintext,value
    try{plaintext=await decryptPassphraseAesAsync(oldCiphertext,previousPassword);value=JSON.parse(plaintext)}
    catch{throw fail('KANATA_ARCHIVE_DECRYPT_FAILED')}
    assertCurrent()
    validateArchivePage(value,descriptor)
    assertCurrent()
    const ciphertext=await encryptPassphraseAesAsync(plaintext,nextPassword)
    assertCurrent()
    // Derive metadata from the validated page, rather than sharing mutable caller rows.
    const next={version:1,key:fingerprint(ciphertext),worldId:descriptor.worldId,conversationId:descriptor.conversationId,bytes:ciphertext.length,index:descriptor.index,messages:value.messages.map(({id,revision,createdAt})=>({id,revision,createdAt}))}
    assertCurrent()
    try{await filesystem.writeFile({...options(pathOf(next.key)),data:ciphertext})}
    catch{throw fail('KANATA_ARCHIVE_WRITE_FAILED')}
    assertCurrent()
    const written=await readCipher(next)
    assertCurrent()
    if(written!==ciphertext)throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
    let restored
    try{restored=await decryptPassphraseAesAsync(written,nextPassword)}catch{throw fail('KANATA_ARCHIVE_DECRYPT_FAILED')}
    assertCurrent()
    if(restored!==plaintext)throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
    assertCurrent()
    return /** @type {import('../domain/kanataTypes').MessageArchiveDescriptor} */(next)
  }
  /** @param {import('../domain/kanataTypes').Message[]} messages @param {string} password
   * @param {{worldId:string,conversationId:string}} requestedScope @param {() => void} [assertCurrent] */
  const write = async (messages, password, requestedScope, assertCurrent = () => {}) => {
    assertPassword(password); assertCurrent()
    const scope = { worldId: requestedScope.worldId, conversationId: requestedScope.conversationId }
    if (!Array.isArray(messages) || !messages.length || messages.length > 50) throw fail('KANATA_ARCHIVE_PAGE_SIZE_INVALID')
    const ordered = [...messages].sort(messageOrder)
    const ciphertext = await encryptPassphraseAesAsync(JSON.stringify({ type: 'kanata-message-page', version: 1, ...scope, messages: ordered }),password)
    assertCurrent()
    /** @type {import('../domain/kanataTypes').MessageArchiveDescriptor} */
    const descriptor = { version: 1, key: fingerprint(ciphertext), ...scope, bytes: ciphertext.length, index: createArchiveIndex(ordered), messages: ordered.map(({ id, revision, createdAt }) => ({ id, revision, createdAt })) }
    // Shape/scope proof before I/O. New files are unreferenced until their owner commits its header.
    validateArchivePage({ type: 'kanata-message-page', version: 1, ...scope, messages: ordered }, descriptor)
    await ensureDirectory()
    assertCurrent()
    try { await filesystem.writeFile({ ...options(pathOf(descriptor.key)), data: ciphertext }) }
    catch { directoryCreation=null;throw fail('KANATA_ARCHIVE_WRITE_FAILED') }
    await read(descriptor, password, scope, assertCurrent)
    return descriptor
  }
  const inspect = async descriptor => {
    let result
    try { result = await filesystem.stat({ path: pathOf(descriptor.key), directory }) }
    catch { throw fail('KANATA_ARCHIVE_MISSING') }
    if (result.type !== 'file' || result.size !== descriptor.bytes) throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
  }
  /** Directory metadata avoids one native bridge round-trip per historical page.
   * Bodies remain unloaded; read() still verifies ciphertext/hash/scope/index on use.
   * Drivers that omit FileInfo.size receive the same strict per-file stat fallback.
   * @param {import('../domain/kanataTypes').MessageArchiveDescriptor[]} descriptors
   */
  const inspectAll = async descriptors => {
    if(!descriptors.length)return
    descriptors.forEach(page=>pathOf(page.key))
    let result
    try{result=await filesystem.readdir({path:KANATA_ARCHIVE_DIRECTORY,directory})}
    catch{throw fail('KANATA_ARCHIVE_MISSING')}
    if(!Array.isArray(result.files))throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
    const entries=new Map()
    for(const file of result.files){
      if(entries.has(file.name))throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
      entries.set(file.name,file)
    }
    for(const descriptor of descriptors){
      const file=entries.get(descriptor.key+'.enc')
      if(!file)throw fail('KANATA_ARCHIVE_MISSING')
      if(file.type!=='file')throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
      if(file.size===undefined)await inspect(descriptor)
      else if(file.size!==descriptor.bytes)throw fail('KANATA_ARCHIVE_VERIFY_FAILED')
    }
  }
  /** Index chooses bounded reads. Cursor scope/revision is owned and checked by the Store.
   * @param {import('../domain/kanataTypes').MessageArchiveDescriptor[]} descriptors
   * @param {import('../domain/kanataTypes').Message[]} active
   * @param {string} password
   * @param {{worldId:string,conversationId:string,text?:string,before?:{id:string,createdAt:number}|null,limit?:number,maxPages?:number}} request
   * @param {() => void} [assertCurrent]
   */
  const query = async (descriptors, active, password, { worldId, conversationId, text = '', before = null, limit = 50, maxPages = 32 }, assertCurrent = () => {}) => {
    assertPassword(password); assertCurrent()
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 64 || typeof text !== 'string' || text.length > 200) throw fail('KANATA_ARCHIVE_QUERY_INVALID')
    if (before && (typeof before.id !== 'string' || !Number.isSafeInteger(before.createdAt) || before.createdAt < 0)) throw fail('KANATA_ARCHIVE_QUERY_INVALID')
    const normalized = normalizeArchiveQuery(text)
    const matches = row => (!before || messageOrder(row, before) < 0) && !row.deleted && normalizeArchiveQuery(row.content).includes(normalized)
    const rows = active.filter(row => row.worldId === worldId && row.conversationId === conversationId && matches(row)).sort((a,b) => messageOrder(b,a)).slice(0, limit + 1)
    const candidates = descriptors.filter(page => page.worldId === worldId && page.conversationId === conversationId && (!before || messageOrder(page.messages[0], before) < 0) && archiveMayMatch(page.index, normalized)).sort((a,b) => messageOrder(b.messages.at(-1), a.messages.at(-1)))
    let pagesRead = 0, bytesRead = 0, complete = true
    for (const page of candidates) {
      if (rows.length > limit && messageOrder(page.messages.at(-1), rows[limit]) < 0) break
      if (pagesRead >= maxPages) { complete = false; break }
      const values = await read(page, password, { worldId, conversationId }, assertCurrent)
      ++pagesRead; bytesRead += page.bytes
      rows.push(...values.filter(matches)); rows.sort((a,b) => messageOrder(b,a)); rows.splice(limit + 1)
    }
    assertCurrent()
    // Budget exhaustion never silently returns a partial page with a cursor that skips unchecked rows.
    if (!complete) throw fail('KANATA_ARCHIVE_QUERY_BUDGET_EXCEEDED')
    return { messages: rows.slice(0, limit), hasMore: rows.length > limit, pagesRead, bytesRead }
  }
  /** Called only after both canonical copies have been verified with the new password.
   * Files outside this feature's strict hash namespace are never removed.
   */
  const retire = async descriptors => {
    await mapInBatches(descriptors,async descriptor=>{
      try { await filesystem.deleteFile({ path: pathOf(descriptor.key), directory }) }
      catch (error) { if (!['ENOENT','OS-PLUG-FILE-0008'].includes(error?.code)) throw fail('KANATA_ARCHIVE_RETIRE_FAILED') }
    })
  }
  /** @param {string[]} [keepKeys] */
  const retireExcept = async (keepKeys = []) => {
    keepKeys.forEach(pathOf)
    const keep = new Set(keepKeys)
    let result
    try { result = await filesystem.readdir({ path: KANATA_ARCHIVE_DIRECTORY, directory }) }
    catch (error) {
      if (!keep.size && (['ENOENT','OS-PLUG-FILE-0008'].includes(error?.code) || ['Folder does not exist.','Directory does not exist.'].includes(error?.message))) return
      throw fail('KANATA_ARCHIVE_RETIRE_FAILED')
    }
    // Enumerate before deleting anything. Unexpected content is an error, never permission for recursive cleanup.
    if (result.files.some(file => file.type !== 'file' || !/^[a-f0-9]{64}\.enc$/.test(file.name))) throw fail('KANATA_ARCHIVE_RETIRE_FAILED')
    const present = new Set(result.files.map(file=>file.name.slice(0,-4)))
    if (keepKeys.some(key=>!present.has(key))) throw fail('KANATA_ARCHIVE_RETIRE_FAILED')
    await retire(result.files.map(file => ({key:file.name.slice(0,-4)})).filter(page=>!keep.has(page.key)))
  }
  return { read, write, reencrypt, inspect, inspectAll, query, retire, retireExcept, retireAll: () => retireExcept() }
}
