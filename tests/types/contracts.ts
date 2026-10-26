import { createModuleRegistry } from '../../src/application/moduleRegistry.js'
import { createBackupRegistry } from '../../src/application/backupRegistry.js'
import { createModuleLifecycle } from '../../src/application/moduleLifecycle.js'
import { createPreferenceRepository } from '../../src/platform/storage/preferenceRepository.js'
import { createRestoreCoordinator } from '../../src/application/restoreCoordinator.js'
import type { FullBackupDTO, RestoreRecord } from '../../src/application/contracts'

createModuleRegistry([{ id: 'valid', title: 'Valid', loadView: async () => ({}) }])
// @ts-expect-error a module without a view loader cannot be registered
createModuleRegistry([{ id: 'missing-view', title: 'Invalid' }])
// @ts-expect-error unknown access levels cannot silently bypass protection
createModuleRegistry([{ id: 'invalid-access', title: 'Invalid', access: 'public-secret', loadView: async () => ({}) }])
// @ts-expect-error a participant must define restore and flush
createBackupRegistry([{ id: 'missing-restore', ready: () => true, export: () => ({ data: [] }) }])
// @ts-expect-error lifecycle flush must be a callable hook
createModuleLifecycle([{ id: 'bad-flush', flush: true }])
// @ts-expect-error storage drivers must return string or null, never an untyped record object
createPreferenceRepository(['key'], { get: async () => ({ value: {} }), set: async () => {} })
const pending: RestoreRecord<{ records: string[] }> = { version: 1, previous: { records: [] }, target: { records: ['synthetic'] } }
void pending
// @ts-expect-error incomplete recovery records must not typecheck
const incomplete: RestoreRecord<object> = { version: 1, target: {} }
void incomplete
// @ts-expect-error restore coordinator requires its durable journal and real apply adapter
createRestoreCoordinator({ state: { blocked: false, busy: false, message: '', syncError: '' } })
// @ts-expect-error backup versions are validated integers, not strings
const wrongVersion: FullBackupDTO['version'] = '12'
void wrongVersion
// @ts-expect-error the full backup cannot silently omit required business arrays
const incompleteData: FullBackupDTO['data'] = { savings: [] }
void incompleteData

// @ts-expect-error module identifiers cannot be numeric
createModuleRegistry([{ id: 42, title: 'Invalid', loadView: async () => ({}) }])
// @ts-expect-error business record arrays cannot contain primitives
const primitiveRecords: FullBackupDTO['data']['weight'] = [42]
void primitiveRecords
