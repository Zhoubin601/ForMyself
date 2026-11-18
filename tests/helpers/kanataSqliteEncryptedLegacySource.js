import assert from 'node:assert/strict'
import { createKanataRepository, KANATA_RECOVERY_KEY } from '../../src/features/chat/storage/kanataRepository.js'
import { KANATA_ARCHIVE_DIRECTORY } from '../../src/features/chat/storage/messageArchiveRepository.js'
import { archiveFilesystem } from './kanataArchiveFixture.js'

const directory = 'M5_SYNTHETIC_MEMORY'
const readOperations = new Set(['stat', 'readFile', 'readdir'])

export const archivePath = descriptor => KANATA_ARCHIVE_DIRECTORY + '/' + descriptor.key + '.enc'

/** Test-only bridge. The repository owns the IO and this closure retains neither a password nor a plaintext graph. */
export function kanataSqliteEncryptedLegacySource() {
  const { filesystem, journal, files, values, calls, control } = archiveFilesystem()
  const filesystemCalls = []
  const journalCalls = []
  let sealed = false
  const injectedFilesystem = Object.fromEntries(Object.entries(filesystem).map(([method, invoke]) => [
    method, async options => {
      filesystemCalls.push(method)
      assert.equal(options.directory, directory)
      assert.ok(!sealed || readOperations.has(method), 'source filesystem mutation: ' + method)
      if (sealed && method === 'readdir') assert.equal(options.path, KANATA_ARCHIVE_DIRECTORY)
      return invoke(options)
    },
  ]))
  const injectedJournal = Object.fromEntries(Object.entries(journal).map(([method, invoke]) => [
    method, async options => {
      journalCalls.push(method)
      assert.equal(options.key, KANATA_RECOVERY_KEY)
      assert.ok(!sealed || method === 'get', 'source journal mutation: ' + method)
      return invoke(options)
    },
  ]))
  const repository = createKanataRepository({ filesystem: injectedFilesystem, journal: injectedJournal, directory })
  const readArchive = (descriptor, password, assertCurrent) => {
    const { worldId, conversationId } = descriptor
    return repository.archives.read(descriptor, password, { worldId, conversationId }, assertCurrent)
  }
  const source = {
    async read(password) {
      const snapshot = await repository.read(password)
      const { hasPendingSave, saveError } = repository.getState()
      return { ...snapshot, hasPendingSave, saveError }
    },
    async inspectArchives(descriptors, password, assertCurrent) {
      await repository.archives.inspectAll(descriptors)
      // Validate every page before the target journal exists. Discard each verified
      // body immediately. The normal importer rechecks each page when consuming it.
      for (const descriptor of descriptors) {
        assertCurrent()
        await readArchive(descriptor, password, assertCurrent)
      }
    },
    readArchive,
  }
  const snapshotBytes = () => ({
    files: [...files].map(([path, value]) => [path, Buffer.from(value, 'utf8')]),
    journal: values.get(KANATA_RECOVERY_KEY) ?? null,
  })
  return {
    repository, source, files, values, calls, control, release: repository.release,
    seal(t) {
      const before = snapshotBytes()
      calls.length = 0
      filesystemCalls.length = 0
      journalCalls.length = 0
      sealed = true
      t.after(() => {
        assert.deepEqual(snapshotBytes(), before)
        assert.ok(filesystemCalls.every(method => readOperations.has(method)))
        assert.ok(journalCalls.every(method => method === 'get'))
      })
    },
  }
}
