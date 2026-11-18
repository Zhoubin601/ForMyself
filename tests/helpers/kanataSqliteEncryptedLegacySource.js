import { createKanataRepository, KANATA_RECOVERY_KEY } from '../../src/features/chat/storage/kanataRepository.js'
import { KANATA_ARCHIVE_DIRECTORY } from '../../src/features/chat/storage/messageArchiveRepository.js'
import { archiveFilesystem } from './kanataArchiveFixture.js'

const directory = 'M5_SYNTHETIC_MEMORY'
const readOperations = new Set(['stat', 'readFile', 'readdir'])
const requireSource = (condition, code) => { if (!condition) throw new Error(code) }

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
      requireSource(options.directory === directory, 'M5_SOURCE_WRONG_DIRECTORY')
      requireSource(!sealed || readOperations.has(method), 'M5_SOURCE_FILESYSTEM_MUTATION')
      if (sealed && method === 'readdir') requireSource(options.path === KANATA_ARCHIVE_DIRECTORY, 'M5_SOURCE_UNEXPECTED_LIST')
      return invoke(options)
    },
  ]))
  const injectedJournal = Object.fromEntries(Object.entries(journal).map(([method, invoke]) => [
    method, async options => {
      journalCalls.push(method)
      requireSource(options.key === KANATA_RECOVERY_KEY, 'M5_SOURCE_WRONG_JOURNAL')
      requireSource(!sealed || method === 'get', 'M5_SOURCE_JOURNAL_MUTATION')
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
    // Files in this driver are UTF-8 strings, and ciphertext is ASCII. Exact
    // string equality proves byte equality without duplicating the fixture bytes.
    files: [...files],
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
      const assertReadOnly = () => {
        const after = snapshotBytes()
        requireSource(after.journal === before.journal && after.files.length === before.files.length
          && after.files.every(([path, value], i) => path === before.files[i][0] && value === before.files[i][1]),
        'M5_SOURCE_BYTES_CHANGED')
        requireSource(filesystemCalls.every(method => readOperations.has(method)), 'M5_SOURCE_FILESYSTEM_MUTATION')
        requireSource(journalCalls.every(method => method === 'get'), 'M5_SOURCE_JOURNAL_MUTATION')
      }
      t?.after(assertReadOnly)
      return assertReadOnly
    },
  }
}
