import { createEmptyKanataData } from '../../src/features/chat/domain/kanataCore.js'
import { validateKanataData } from '../../src/features/chat/domain/kanataValidation.js'
import { instantiateWorldPreset } from '../../src/features/chat/domain/presetCore.js'
import type { KanataData, WorldPreset, Message, LifeGrant } from '../../src/application/contracts'
declare const preset: WorldPreset
const empty: KanataData = createEmptyKanataData('local-user')
const options = { initializationKey: 'first', now: 1000, timeZone: 'Asia/Shanghai', idFactory: (kind: string, key: string) => kind + key }
const seeded: KanataData = instantiateWorldPreset(empty, preset, options)
const roundtrip: KanataData = validateKanataData(seeded)
void roundtrip
// @ts-expect-error the factory is mandatory; seeding must not hide a random generator
instantiateWorldPreset(empty, preset, { initializationKey: 'first', now: 1000, timeZone: 'Asia/Shanghai' })
// @ts-expect-error a legacy chat v4 cannot masquerade as the new namespace
const legacyVersion: KanataData['version'] = 4
void legacyVersion
// @ts-expect-error model system/tool roles cannot impersonate a character
const invalidRole: Message['role'] = 'system'
void invalidRole
// @ts-expect-error actual sender identity is distinct from transport role
const invalidSender: Message['senderType'] = 'assistant'
void invalidSender
// @ts-expect-error permissions must be independent booleans, not truthy strings
const unsafeGrant: LifeGrant['share'] = 'false'
void unsafeGrant
// @ts-expect-error no numeric user identity coercion
createEmptyKanataData(42)
// @ts-expect-error a factory must return a stable string ID
instantiateWorldPreset(empty, preset, { ...options, idFactory: () => 42 })
