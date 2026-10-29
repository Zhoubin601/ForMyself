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

import { createKanataRepository } from '../../src/features/chat/storage/kanataRepository.js'
import { buildKanataChatBackupSnapshot, prepareKanataFullRestore } from '../../src/features/chat/backup/kanataBackup.js'
import type { KanataChatBackup, KanataFullBackup, KanataRestoreSnapshot, KanataRepository } from '../../src/application/contracts'
const repository: KanataRepository = createKanataRepository()
const queueSettlement: Promise<void> = repository.wait()
void queueSettlement
const wire: KanataChatBackup = buildKanataChatBackupSnapshot(empty)
const operation: KanataRestoreSnapshot = prepareKanataFullRestore(wire, { legacyChat: 'discard' })
void operation
repository.read('synthetic-password').then(result => {
  if (result.status === 'missing') {
    const absent: null = result.data
    void absent
  } else {
    const present: KanataData = result.data
    void present
  }
})
// @ts-expect-error no implicit password coercion
repository.read(12)
// @ts-expect-error the old v4 namespace is not a writable Kanata graph
repository.write({ version: 4 }, 'synthetic-password')
// @ts-expect-error explicit acknowledgement has a single allowed value
prepareKanataFullRestore(wire, { legacyChat: 'migrate' })
// @ts-expect-error a single legacy backup version is not the new full-backup wire version
const unsafeFullVersion: KanataFullBackup['version'] = 12
void unsafeFullVersion
// @ts-expect-error only internal canonical modes are supported
const unsafeRestoreMode: KanataRestoreSnapshot['mode'] = 'merge'
void unsafeRestoreMode

import { parseCharacterCardBytes, parseCharacterCardFile } from '../../src/features/chat/cards/characterCardImport.js'
import { createKanataWorld, previewKanataCardSync, syncKanataCard, updateKanataCharacter } from '../../src/features/chat/domain/kanataManagementCore.js'
import { selectKanataLorebook } from '../../src/features/chat/lorebook/kanataLorebook.js'
import type { ParsedCharacterCard, KanataManagement } from '../../src/application/contracts'
declare const management: KanataManagement
const parsed: ParsedCharacterCard = parseCharacterCardBytes(new Uint8Array(), {fileName:'synthetic.json'})
management.importCard(parsed)
const creation = {key:'manual',now:1000,timeZone:'Asia/Shanghai',idFactory:options.idFactory}
createKanataWorld(empty,{name:'World',rules:'',displayName:'User',background:''},creation)
syncKanataCard(empty,'card',previewKanataCardSync(empty,'card'))
// @ts-expect-error card files are binary data, not path strings
parseCharacterCardBytes('unsafe-path', {fileName:'synthetic.json'})
// @ts-expect-error async file reader must return binary, not arbitrary text
parseCharacterCardFile({name:'x.json',size:1,type:'application/json',arrayBuffer:async()=> 'text'})
// @ts-expect-error a world requires an explicitly supplied identity
createKanataWorld(empty,{name:'World',rules:''},creation)
// @ts-expect-error synchronization requires a revision-checked preview, not raw IDs
syncKanataCard(empty,'card',['instance'])
// @ts-expect-error overrides cannot mutate instance state or grant permissions
updateKanataCharacter(empty,'instance',{state:{mood:'unsafe'}})
// @ts-expect-error context budget is a number with runtime bounds
selectKanataLorebook(empty,{worldId:'world',instanceId:'instance',text:'',tokenBudget:'100'})
// @ts-expect-error archive is an independent boolean
const unsafeArchived: NonNullable<KanataData['worlds'][number]['archived']> = 'yes'
void unsafeArchived

import { cancelOwnedFeedbackDialog } from '../../src/services/uiFeedback.js'
import type { KanataFeedbackOwner } from '../../src/application/contracts'
const feedbackOwner: KanataFeedbackOwner = Symbol('synthetic-owner')
cancelOwnedFeedbackDialog(feedbackOwner)
// @ts-expect-error a text label cannot cancel an owned dialog
cancelOwnedFeedbackDialog('other-owner')

import type { KanataChatRuntime, CompletionOptions } from '../../src/application/contracts'
declare const chatRuntime: KanataChatRuntime
chatRuntime.send('conversation', { text:'Synthetic', stream:true, delayMs:2000 })
chatRuntime.setMode('conversation','roleplay')
// @ts-expect-error roleplay is an explicit mode rather than arbitrary text
chatRuntime.setMode('conversation','romance')
// @ts-expect-error stream must be a boolean
chatRuntime.send('conversation',{text:'Synthetic',stream:'yes'})
// @ts-expect-error numeric delay only
chatRuntime.send('conversation',{delayMs:'2000'})
declare const request: CompletionOptions
// @ts-expect-error accounting cannot be omitted or made synchronous
request.onAttempt = () => undefined
// @ts-expect-error hidden tool instructions cannot enter this text-only interface
request.messages = [{role:'tool',content:'Synthetic'}]

import type {KanataExperienceRuntime,MemoryPolicy} from '../../src/application/contracts'
declare const experience:KanataExperienceRuntime
experience.setGrant('world','instance','todo',{read:true,remember:false,share:false})
experience.setBinding('mood',{worldId:'world',instanceId:'instance'})
experience.organize('conversation','instance','summary')
// @ts-expect-error three permissions are independent required flags
experience.setGrant('world','instance','todo',{read:true})
// @ts-expect-error binding must identify an exact world and instance, not a name
experience.setBinding('mood','星野')
// @ts-expect-error unknown inference tasks cannot execute through the memory interface
experience.organize('conversation','instance','relationship')
// @ts-expect-error no automatic event truth changes through candidate fields
experience.proposeEvent({worldId:'world',effects:[]})
// @ts-expect-error an event commit must specify its observed revision
experience.commitEvent('event')
// @ts-expect-error numeric memory thresholds only
const invalidMemoryPolicy:MemoryPolicy={worldId:'world',strategy:'custom',enabled:true,recentMessages:'20',summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1}
void invalidMemoryPolicy

import type {KanataLifeCompanion,KanataLifeReaders} from '../../src/application/contracts'
declare const lifeCompanion:KanataLifeCompanion
lifeCompanion.request('todo','Synthetic task',{allowPrompt:true})
const lifeReaders:KanataLifeReaders={mood:async()=>[{id:'synthetic'}]}
void lifeReaders
// @ts-expect-error password vault is never a role-readable life module
lifeCompanion.request('passwords','unsafe')
// @ts-expect-error reader must be lazy, never pre-read private data
const eagerLifeReaders:KanataLifeReaders={mood:[{id:'unsafe'}]}
void eagerLifeReaders
// @ts-expect-error message revisions require an explicit deletion/content decision
experience.reviseMessage('message',1,{deleted:true})

import type {KanataWorldRuntime,AutonomyPolicy,VirtualSchedule} from '../../src/application/contracts'
declare const worldRuntime:KanataWorldRuntime
worldRuntime.advance('world')
// @ts-expect-error all three world switches remain independent, explicit booleans
worldRuntime.setActivity('world',1,{autonomyEnabled:true})
// @ts-expect-error dialogue limit must be numeric
const badAutonomy:AutonomyPolicy={worldId:'world',revision:1,dailyDialogueLimit:'0',maxCatchUpHours:3,freedom:'strict',quietStartMinute:1320,quietEndMinute:480}
void badAutonomy
// @ts-expect-error a virtual schedule requires its own world and instance scope
const badSchedule:VirtualSchedule={id:'schedule',days:[1],startMinute:0,endMinute:1440,location:'room',activity:'rest',resting:true,revision:1}
void badSchedule

import type {KanataSocialRuntime,KanataContactRuntime,KanataDeferredRuntime} from '../../src/application/contracts'
declare const socialRuntime:KanataSocialRuntime
declare const contactRuntime:KanataContactRuntime
declare const deferredRuntime:KanataDeferredRuntime
socialRuntime.run('world');contactRuntime.run('world');deferredRuntime.run()
// @ts-expect-error world identity is a string, never an unscoped numeric row
socialRuntime.run(123)
// @ts-expect-error proactive contact needs an explicit world
contactRuntime.run()
// @ts-expect-error deferred executor chooses only persisted scoped tasks, not arbitrary caller worlds
deferredRuntime.run('other-world')
// @ts-expect-error configuration requires explicit per-instance flags as well as policy and schedules
worldRuntime.configure('world',1,{policy:{},schedules:[]})
