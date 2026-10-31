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
import type {MessageArchiveDescriptor,MessageHistoryRequest,KanataArchiveRepository} from '../../src/application/contracts'
declare const archiveRepository: KanataArchiveRepository
declare const archivePage: MessageArchiveDescriptor
archiveRepository.read(archivePage, 'synthetic-only', {worldId:'world',conversationId:'conversation'})
// @ts-expect-error file paths cannot replace validated page descriptors
archiveRepository.read('../../outside', 'synthetic-only', {worldId:'world',conversationId:'conversation'})
// @ts-expect-error both world and conversation are mandatory for disk reads
archiveRepository.read(archivePage, 'synthetic-only', {worldId:'world'})
// @ts-expect-error native and UI cursors cannot coerce generation strings
const unsafeHistory: MessageHistoryRequest = {worldId:'world',conversationId:'conversation',cursor:{worldId:'world',conversationId:'conversation',text:'',generation:'1',before:{id:'message',createdAt:1}}}
void unsafeHistory
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

import type {KanataFilesystem} from '../../src/features/chat/storage/kanataRepositoryTypes'
declare const filesystem:KanataFilesystem
filesystem.readdir({path:'formyself/kanata-pages-v1',directory:'DATA'}).then(result=>{
  const size:number|undefined=result.files[0]?.size
  void size
})
// @ts-expect-error byte size metadata cannot be a text value
const badFileInfo:Awaited<ReturnType<KanataFilesystem['readdir']>>={files:[{name:'page.enc',type:'file',size:'unknown'}]}
void badFileInfo

import {ownKanataRestoreImage} from '../../src/features/chat/domain/kanataOwnedImage.js'
// @ts-expect-error an internal immutable image factory still requires the complete Kanata graph
ownKanataRestoreImage({version:1})

import type {GroupReplyLimits} from '../../src/application/contracts'
const groupLimits:GroupReplyLimits={maxSpeakers:3,maxMessages:4}
chatRuntime.setGroupLimits('conversation',1,groupLimits)
// @ts-expect-error limits require both numeric fields
chatRuntime.setGroupLimits('conversation',1,{maxSpeakers:3})
// @ts-expect-error a revision cannot be a text value
chatRuntime.setGroupLimits('conversation','1',groupLimits)
// @ts-expect-error speaker limit cannot be text
const invalidGroupLimit:GroupReplyLimits={maxSpeakers:'3',maxMessages:4}
void invalidGroupLimit
management.createGroup('world',{title:'Synthetic group',instanceIds:['one','two']})
// @ts-expect-error group membership requires an explicit list of IDs
management.createGroup('world',{title:'Synthetic',instanceIds:'one,two'})
// @ts-expect-error title cannot be omitted
management.createGroup('world',{instanceIds:['one','two']})
import type {ReplyTimingPolicy} from '../../src/application/contracts'
const timing:ReplyTimingPolicy={enabled:true,waitMs:5000}
chatRuntime.setReplyTiming('conversation',1,timing)
chatRuntime.send('conversation',{text:'synthetic',timing:'immediate'})
// @ts-expect-error a timing policy needs an explicit boolean
chatRuntime.setReplyTiming('conversation',1,{enabled:'true',waitMs:5000})
// @ts-expect-error optimistic conversation revision is required
chatRuntime.setReplyTiming('conversation',timing)
// @ts-expect-error caller cannot supply an unrecognised timing mode
chatRuntime.send('conversation',{timing:'background'})
archiveRepository.reencrypt(archivePage,'synthetic-old','synthetic-next',{worldId:'world',conversationId:'conversation'})
// @ts-expect-error rekey requires an explicit scope, never an inferred/global page
archiveRepository.reencrypt(archivePage,'synthetic-old','synthetic-next')
// @ts-expect-error plaintext passwords are text parameters, never a numeric device credential
archiveRepository.reencrypt(archivePage,123,'synthetic-next',{worldId:'world',conversationId:'conversation'})
import {encryptPassphraseAesAsync,decryptPassphraseAesAsync} from '../../src/shared/crypto/passphraseAes.js'
const encryptedPage:Promise<string>=encryptPassphraseAesAsync('synthetic','synthetic-password')
void encryptedPage
// @ts-expect-error asynchronous native crypto cannot be consumed as a synchronous plaintext result
const insecureSynchronousPage:string=decryptPassphraseAesAsync('synthetic','synthetic-password')
void insecureSynchronousPage
