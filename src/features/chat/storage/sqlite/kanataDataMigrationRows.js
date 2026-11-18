// @ts-check
// M5 only: deterministic, bounded row mapping for the isolated JSON -> SQLite importer.
// No production Store, driver registration, source writes, or legacy cleanup lives here.
import { messageOrder } from '../messageArchiveCore.js'

const known = (row, keys) => JSON.stringify(Object.fromEntries(
  Object.entries(row).filter(([key]) => !keys.includes(key)),
))
const json = value => JSON.stringify(value)
const flag = value => value === undefined ? null : Number(value)
const array = value => Array.isArray(value) ? value : []
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0
const fail = code => Object.assign(new Error(code), { code })

/** SQL identifiers come only from this module's fixed maps; every value is bound. */
export function kanataMigrationInsert(table, row) {
  if (!/^[a-z_]+$/.test(table)) throw fail('KANATA_MIGRATION_TABLE_INVALID')
  const columns = Object.keys(row)
  if (!columns.length || !columns.every(column => /^[a-z_]+$/.test(column))) throw fail('KANATA_MIGRATION_COLUMN_INVALID')
  const values = columns.map(column => {
    const value = row[column]
    if (value === undefined || (typeof value !== 'string' && typeof value !== 'number' && value !== null)) {
      throw fail('KANATA_MIGRATION_VALUE_INVALID')
    }
    return value
  })
  return {
    kind: 'insert', table, columns, values, row,
    sql: 'INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')',
  }
}

function arrayCollection(name, values, map) {
  const rows = array(values)
  return {
    name,
    expectedCount: rows.length,
    initialCursor: { offset: 0 },
    readBatch(cursor, limit) {
      const offset = Number(cursor?.offset ?? 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) throw fail('KANATA_MIGRATION_CURSOR_INVALID')
      const end = Math.min(rows.length, offset + limit)
      const items = rows.slice(offset, end)
      return { items, nextCursor: { offset: end }, done: end === rows.length }
    },
    map(items) { return items.flatMap(item => map(item)) },
  }
}

function nestedCollection(name, sources, children, map) {
  const lists = sources.map(source => array(source))
  const expectedCount = lists.reduce((total, list) =>
    total + list.reduce((count, owner) => count + children(owner).length, 0), 0)
  return {
    name, expectedCount,
    initialCursor: { source: 0, row: 0, child: 0 },
    readBatch(cursor, limit) {
      let source = Number(cursor?.source ?? 0)
      let row = Number(cursor?.row ?? 0)
      let child = Number(cursor?.child ?? 0)
      if (![source, row, child].every(Number.isSafeInteger) || source < 0 || row < 0 || child < 0) {
        throw fail('KANATA_MIGRATION_CURSOR_INVALID')
      }
      const items = []
      while (source < lists.length && items.length < limit) {
        if (row >= lists[source].length) { source++; row = 0; child = 0; continue }
        const owner = lists[source][row]
        const values = children(owner)
        if (child >= values.length) { row++; child = 0; continue }
        items.push(map(owner, values[child]))
        child++
      }
      while (source < lists.length && row >= lists[source].length) { source++; row = 0; child = 0 }
      return { items, nextCursor: { source, row, child }, done: source >= lists.length }
    },
    map(items) { return items.map(item => item) },
  }
}

const cardVersionRow = version => ({
  card_id: version.cardId, id: version.id, revision: version.revision,
  definition_json: json(version.definition), raw_data_json: json(version.rawData),
  source: version.source, imported_json: version.imported === undefined ? null : json(version.imported),
  extensions_json: known(version, ['id','cardId','revision','definition','rawData','source','imported']),
})

const messageRow = message => ({
  world_id: message.worldId, id: message.id, conversation_id: message.conversationId,
  role: message.role, sender_type: message.senderType, sender_id: message.senderId,
  sender_name_snapshot: message.senderNameSnapshot, content: message.content, created_at: message.createdAt,
  revision: message.revision, status: message.status, turn_id: message.turnId, batch_id: message.batchId,
  deleted: flag(message.deleted), reply_to_message_id: message.replyToMessageId ?? null,
  reply_to_revision: message.replyToRevision ?? null,
  extensions_json: known(message, ['id','worldId','conversationId','role','senderType','senderId','senderNameSnapshot',
    'content','createdAt','revision','status','turnId','batchId','deleted','replyToMessageId','replyToRevision','lifeSources']),
})

export function kanataMigrationMessageCommands(message, archived = false) {
  const commands = [kanataMigrationInsert('messages', messageRow(message))]
  for (const source of array(message.lifeSources)) commands.push(kanataMigrationInsert('message_life_sources', {
    world_id: message.worldId, message_id: message.id, grant_id: source.grantId, instance_id: source.instanceId,
    module_id: source.moduleId, grant_revision: source.revision, fingerprint: source.fingerprint,
  }))
  if (archived) commands.push(kanataMigrationInsert('archived_message_marks', {
    world_id: message.worldId, conversation_id: message.conversationId, message_id: message.id,
  }))
  return commands
}

const targetColumns = row => ({
  target_type: row.targetType, target_id: row.targetId,
  target_instance_id: row.targetType === 'instance' ? row.targetId : null,
  target_relationship_id: row.targetType === 'relationship' ? row.targetId : null,
})

function taskRow(task) {
  const deferred = task.deferredReply
  const metadata = {
    ...(task.simulationWindow && { simulationWindow: task.simulationWindow }),
    ...(task.social && { social: task.social }),
    ...(task.contact && { contact: task.contact }),
    ...(deferred && { deferredReply: { activityDelay: deferred.activityDelay === true } }),
  }
  return {
    world_id: task.worldId, id: task.id, kind: task.kind, state: task.state,
    idempotency_key: task.idempotencyKey, source_revision: task.sourceRevision, attempt: task.attempt,
    not_before: task.notBefore, lease_until: task.leaseUntil, conversation_id: task.conversationId ?? null,
    instance_id: task.instanceId ?? null, error_code: task.errorCode ?? null, metadata_json: json(metadata),
    window_task_id: task.social?.windowTaskId ?? null,
    deferred_message_id: deferred?.sourceMessageId ?? null, deferred_revision: deferred?.sourceRevision ?? null,
    deferred_expires_at: deferred?.expiresAt ?? null, notification_id: task.contact?.notificationId ?? null,
    extensions_json: known(task, ['id','worldId','kind','state','idempotencyKey','sourceRefs','sourceRevision','attempt',
      'notBefore','leaseUntil','conversationId','instanceId','resultEventIds','resultMemoryIds','errorCode',
      'simulationWindow','social','contact','deferredReply']),
  }
}

/**
 * Returns source-ordered, resumable collection readers. The large message body stream is
 * supplied separately by the migrator from one verified archive page at a time.
 * @param {import('../../domain/kanataTypes').KanataData} data
 */
export function createKanataDataMigrationCollections(data) {
  const identitiesByWorld = new Map(data.identities.map(identity => [identity.worldId, identity]))
  const versionsById = new Map(data.cardVersions.map(version => [version.id, version]))
  const currentVersionIds = new Set(data.cards.map(card => card.currentVersionId))
  const activeMessages = [...data.messages].sort((a, b) =>
    compareText(a.worldId, b.worldId) || compareText(a.conversationId, b.conversationId) || messageOrder(a, b))
  const rootTasks = data.tasks.filter(task => !task.social?.windowTaskId)
  const dependentTasks = data.tasks.filter(task => Boolean(task.social?.windowTaskId))
  const policies = array(data.memoryPolicies)
  const autonomyPolicies = array(data.autonomyPolicies)
  const roleBindings = data.roleBindings ? [data.roleBindings] : []

  const collections = [
    arrayCollection('dataset_metadata', [{ userId: data.userId, version: data.version }], item => [
      kanataMigrationInsert('dataset_metadata', {
        singleton: 1, user_id: item.userId, data_version: item.version, extensions_json: '{}',
      }),
    ]),
    arrayCollection('worlds', data.worlds, world => {
      const identity = identitiesByWorld.get(world.id)
      if (!identity) throw fail('KANATA_MIGRATION_WORLD_IDENTITY_MISSING')
      return [
        // worlds -> identities is a deferred FK; identities -> worlds is immediate.
        kanataMigrationInsert('worlds', {
          id: world.id, name: world.name, rules: world.rules, revision: world.revision, time_zone: world.timeZone,
          created_at: world.createdAt, last_simulated_at: world.lastSimulatedAt,
          autonomy_enabled: Number(world.autonomyEnabled), proactive_enabled: Number(world.proactiveEnabled),
          notifications_enabled: Number(world.notificationsEnabled), default_chat_mode: world.defaultChatMode,
          archived: flag(world.archived), identity_id: identity.id,
          extensions_json: known(world, ['id','name','rules','revision','timeZone','createdAt','lastSimulatedAt',
            'autonomyEnabled','proactiveEnabled','notificationsEnabled','defaultChatMode','archived']),
        }),
        kanataMigrationInsert('world_identities', {
          world_id: identity.worldId, id: identity.id, user_id: identity.userId,
          display_name: identity.displayName, background: identity.background, revision: identity.revision,
          extensions_json: known(identity, ['id','worldId','userId','displayName','background','revision']),
        }),
      ]
    }),
    arrayCollection('cards', data.cards, card => {
      const current = versionsById.get(card.currentVersionId)
      if (!current || current.cardId !== card.id) throw fail('KANATA_MIGRATION_CARD_VERSION_MISSING')
      return [
        kanataMigrationInsert('character_cards', {
          id: card.id, current_version_id: card.currentVersionId, archived: Number(card.archived),
          preset_key: card.presetKey ?? null,
          extensions_json: known(card, ['id','currentVersionId','archived','presetKey']),
        }),
        kanataMigrationInsert('card_versions', cardVersionRow(current)),
      ]
    }),
    arrayCollection('card_versions', data.cardVersions.filter(version => !currentVersionIds.has(version.id)),
      version => [kanataMigrationInsert('card_versions', cardVersionRow(version))]),
    arrayCollection('instances', data.instances, instance => [kanataMigrationInsert('character_instances', {
      world_id: instance.worldId, id: instance.id, card_id: instance.cardId, card_version_id: instance.cardVersionId,
      revision: instance.revision, overrides_json: json(instance.overrides), mood: instance.state.mood,
      energy: instance.state.energy, location: instance.state.location,
      autonomy_enabled: Number(instance.autonomyEnabled), proactive_enabled: Number(instance.proactiveEnabled),
      extensions_json: known(instance, ['id','worldId','cardId','cardVersionId','revision','overrides','state','autonomyEnabled','proactiveEnabled']),
    })]),
    arrayCollection('conversations', data.conversations, conversation => [kanataMigrationInsert('conversations', {
      world_id: conversation.worldId, id: conversation.id, type: conversation.type, title: conversation.title,
      mode: conversation.mode, revision: conversation.revision, last_read_at: conversation.lastReadAt,
      max_speakers: conversation.replyLimits?.maxSpeakers ?? null,
      max_messages: conversation.replyLimits?.maxMessages ?? null,
      reply_timing_enabled: conversation.replyTiming === undefined ? null : Number(conversation.replyTiming.enabled),
      reply_wait_ms: conversation.replyTiming?.waitMs ?? null,
      extensions_json: known(conversation, ['id','worldId','type','title','participantIds','mode','revision','lastReadAt','replyLimits','replyTiming']),
    })]),
    nestedCollection('conversation_participants', [data.conversations],
      conversation => conversation.participantIds,
      (conversation, participantId) => kanataMigrationInsert('conversation_participants', {
        world_id: conversation.worldId, conversation_id: conversation.id, participant_id: participantId,
        kind: data.identities.some(identity => identity.id === participantId) ? 'user' : 'character',
        ordinal: conversation.participantIds.indexOf(participantId),
      })),
    arrayCollection('life_grants', data.lifeGrants, grant => [kanataMigrationInsert('life_grants', {
      world_id: grant.worldId, id: grant.id, instance_id: grant.instanceId, module_id: grant.moduleId,
      can_read: Number(grant.read), can_remember: Number(grant.remember), can_share: Number(grant.share),
      revision: grant.revision, extensions_json: known(grant, ['id','worldId','instanceId','moduleId','read','remember','share','revision']),
    })]),
    arrayCollection('messages.active', activeMessages, kanataMigrationMessageCommands),
    arrayCollection('lorebook_entries', data.lorebookEntries, entry => [kanataMigrationInsert('lorebook_entries', {
      world_id: entry.worldId, id: entry.id, scope: entry.scope, owner_id: entry.ownerId,
      owner_instance_id: entry.scope === 'character' ? entry.ownerId : null,
      keys_json: json(entry.keys), secondary_keys_json: entry.secondaryKeys === undefined ? null : json(entry.secondaryKeys),
      content: entry.content, priority: entry.priority, activation_rule: entry.activationRule,
      visibility: entry.visibility, source_tag: entry.sourceTag, revision: entry.revision,
      enabled: flag(entry.enabled), case_sensitive: flag(entry.caseSensitive),
      extensions_json: known(entry, ['id','worldId','scope','ownerId','keys','secondaryKeys','content','priority',
        'activationRule','visibility','knownBy','sourceTag','revision','enabled','caseSensitive']),
    })]),
    nestedCollection('lorebook_known_by', [data.lorebookEntries],
      entry => entry.knownBy,
      (entry, participantId) => kanataMigrationInsert('lorebook_known_by', {
        world_id: entry.worldId, entry_id: entry.id, participant_id: participantId,
      })),
    arrayCollection('memories', data.memories, memory => [kanataMigrationInsert('memories', {
      world_id: memory.worldId, id: memory.id, owner_type: memory.ownerType, owner_id: memory.ownerId,
      owner_instance_id: memory.ownerType === 'character' ? memory.ownerId : null,
      layer: memory.layer, memory_key: memory.key, content: memory.content, status: memory.status,
      revision: memory.revision, visibility: memory.visibility, conversation_id: memory.conversationId ?? null,
      confidence: memory.confidence ?? null, generation_key: memory.generationKey ?? null,
      extensions_json: known(memory, ['id','worldId','ownerType','ownerId','layer','key','content','sourceRefs','status',
        'revision','visibility','knownBy','conversationId','sourceEventIds','lifeSources','confidence','conflictWith',
        'generationKey','sharedFromId','supersededById']),
    })]),
    nestedCollection('memory_known_by', [data.memories], memory => array(memory.knownBy),
      (memory, instanceId) => kanataMigrationInsert('memory_known_by', {
        world_id: memory.worldId, memory_id: memory.id, instance_id: instanceId,
      })),
    arrayCollection('relationships', data.relationships, relation => [kanataMigrationInsert('relationships', {
      world_id: relation.worldId, id: relation.id, from_id: relation.fromId, to_id: relation.toId,
      kind: relation.kind, trust_baseline: relation.trustBaseline, public_summary: relation.publicSummary,
      trust: relation.dimensions.trust, intimacy: relation.dimensions.intimacy,
      understanding: relation.dimensions.understanding, dimension_rule_version: relation.dimensionRuleVersion,
      revision: relation.revision,
      extensions_json: known(relation, ['id','worldId','fromId','toId','kind','trustBaseline','publicSummary',
        'dimensions','dimensionRuleVersion','sourceEventIds']),
    })]),
    arrayCollection('events', data.events, event => [kanataMigrationInsert('world_events', {
      world_id: event.worldId, id: event.id, status: event.status, visibility: event.visibility,
      summary: event.summary, effective_at: event.effectiveAt, recorded_at: event.recordedAt, revision: event.revision,
      causality: event.causality ?? null, kind: event.kind ?? null,
      action_instance_id: event.action?.instanceId ?? null, action_relationship_id: event.action?.relationshipId ?? null,
      action_location: event.action?.location ?? null,
      // Replacements are restored in a later collection after every event exists.
      extensions_json: known(event, ['id','worldId','participantIds','sourceRefs','causedByEventIds','status','visibility',
        'summary','effectiveAt','recordedAt','revision','causality','kind','action','lifeSources','replacesEventId']),
    })]),
    arrayCollection('effects', data.effects, effect => [kanataMigrationInsert('world_effects', {
      world_id: effect.worldId, id: effect.id, event_id: effect.eventId, ...targetColumns(effect),
      operation: effect.operation, path: effect.path, value_json: json(effect.value), rule_version: effect.ruleVersion,
      extensions_json: known(effect, ['id','worldId','eventId','targetType','targetId','operation','path','value','ruleVersion']),
    })]),
    arrayCollection('effect_baselines', array(data.effectBaselines), baseline => [kanataMigrationInsert('effect_baselines', {
      world_id: baseline.worldId, id: baseline.id, ...targetColumns(baseline), path: baseline.path,
      value_json: json(baseline.value),
      extensions_json: known(baseline, ['id','worldId','targetType','targetId','path','value']),
    })]),
    arrayCollection('tasks.root', rootTasks, task => [kanataMigrationInsert('background_tasks', taskRow(task))]),
    arrayCollection('tasks.dependent', dependentTasks, task => [kanataMigrationInsert('background_tasks', taskRow(task))]),
    arrayCollection('preset_applications', data.presetApplications, preset => [kanataMigrationInsert('preset_applications', {
      world_id: preset.worldId, id: preset.id, initialization_key: preset.initializationKey,
      preset_source_id: preset.presetSourceId, preset_version: preset.presetVersion,
      extensions_json: known(preset, ['id','worldId','initializationKey','presetSourceId','presetVersion']),
    })]),
    arrayCollection('usage_events', array(data.usageEvents), event => [kanataMigrationInsert('usage_events', {
      world_id: event.worldId, id: event.id, conversation_id: event.conversationId, instance_id: event.instanceId,
      participant_kind: 'character', turn_id: event.turnId, model: event.model, official_provider: Number(event.officialProvider),
      started_at: event.startedAt, finished_at: event.finishedAt ?? null, transport: event.transport, status: event.status,
      error_code: event.errorCode, finish_reason: event.finishReason,
      estimated_input_tokens: event.estimatedInputTokens, estimated_output_tokens: event.estimatedOutputTokens,
      prompt_tokens: event.usage?.promptTokens ?? null, completion_tokens: event.usage?.completionTokens ?? null,
      cache_hit_tokens: event.usage?.cacheHitTokens ?? null, purpose: event.purpose ?? null,
      extensions_json: known(event, ['id','worldId','conversationId','instanceId','turnId','model','officialProvider',
        'startedAt','finishedAt','transport','status','errorCode','finishReason','usage','estimatedInputTokens',
        'estimatedOutputTokens','purpose']),
    })]),
    arrayCollection('virtual_schedules', array(data.virtualSchedules), schedule => [kanataMigrationInsert('virtual_schedules', {
      world_id: schedule.worldId, id: schedule.id, instance_id: schedule.instanceId,
      start_minute: schedule.startMinute, end_minute: schedule.endMinute, location: schedule.location,
      activity: schedule.activity, resting: Number(schedule.resting), revision: schedule.revision,
      extensions_json: known(schedule, ['id','worldId','instanceId','days','startMinute','endMinute','location','activity','resting','revision']),
    })]),
    arrayCollection('memory_policies', policies, policy => [kanataMigrationInsert('memory_policies', {
      world_id: policy.worldId, strategy: policy.strategy, enabled: Number(policy.enabled),
      recent_messages: policy.recentMessages, summarize_after: policy.summarizeAfter,
      extract_after: policy.extractAfter, context_budget: policy.contextBudget, revision: policy.revision,
      extensions_json: known(policy, ['worldId','strategy','enabled','recentMessages','summarizeAfter','extractAfter','contextBudget','revision']),
    })]),
    arrayCollection('autonomy_policies', autonomyPolicies, policy => [kanataMigrationInsert('autonomy_policies', {
      world_id: policy.worldId, revision: policy.revision, daily_dialogue_limit: policy.dailyDialogueLimit,
      max_catch_up_hours: policy.maxCatchUpHours, freedom: policy.freedom,
      quiet_start_minute: policy.quietStartMinute, quiet_end_minute: policy.quietEndMinute,
      social_channel: policy.socialChannel ?? null,
      extensions_json: known(policy, ['worldId','revision','dailyDialogueLimit','maxCatchUpHours','freedom',
        'quietStartMinute','quietEndMinute','socialChannel']),
    })]),
    arrayCollection('role_bindings', roleBindings, binding => {
      const rows = [kanataMigrationInsert('role_binding_state', {
        singleton: 1, revision: binding.revision, extensions_json: '{}',
      })]
      const scopes = ['global', ...Object.keys(binding.modules ?? {})]
      for (const scope of scopes) {
        const value = scope === 'global' ? binding.global : binding.modules?.[scope]
        rows.push(kanataMigrationInsert('role_bindings', {
          scope, state_id: 1, world_id: value?.worldId ?? null, instance_id: value?.instanceId ?? null,
          extensions_json: '{}',
        }))
      }
      return rows
    }),
    arrayCollection('message_audits', array(data.messageAudits), audit => [kanataMigrationInsert('message_audits', {
      world_id: audit.worldId, id: audit.id, message_id: audit.messageId, at: audit.at,
      previous_revision: audit.previous.revision, next_revision: audit.next.revision,
      previous_json: json(audit.previous), next_json: json(audit.next),
      extensions_json: known(audit, ['id','worldId','messageId','at','previous','next']),
    })]),
    arrayCollection('event_audits', array(data.eventAudits), audit => [kanataMigrationInsert('event_audits', {
      world_id: audit.worldId, id: audit.id, event_id: audit.eventId, at: audit.at,
      previous_revision: audit.previous.revision, next_revision: audit.next.revision,
      previous_json: json(audit.previous), next_json: json(audit.next),
      extensions_json: known(audit, ['id','worldId','eventId','at','previous','next']),
    })]),
    nestedCollection('virtual_schedule_days', [array(data.virtualSchedules)], schedule => schedule.days,
      (schedule, day) => kanataMigrationInsert('virtual_schedule_days', {
        world_id: schedule.worldId, schedule_id: schedule.id, day,
      })),
    nestedCollection('event_participants', [data.events], event => event.participantIds,
      (event, participantId) => kanataMigrationInsert('event_participants', {
        world_id: event.worldId, event_id: event.id, participant_id: participantId,
      })),
    nestedCollection('event_causes', [data.events], event => event.causedByEventIds,
      (event, causeEventId) => kanataMigrationInsert('event_causes', {
        world_id: event.worldId, event_id: event.id, cause_event_id: causeEventId,
      })),
    arrayCollection('event_replacements', data.events.filter(event => Boolean(event.replacesEventId)), event => [{
      kind: 'update', table: 'world_events',
      sql: 'UPDATE world_events SET replaces_event_id=? WHERE world_id=? AND id=?',
      values: [event.replacesEventId, event.worldId, event.id],
      audit: [event.worldId, event.id, event.replacesEventId],
    }]),
    nestedCollection('relationship_events', [data.relationships], relation => relation.sourceEventIds,
      (relation, eventId) => kanataMigrationInsert('relationship_events', {
        world_id: relation.worldId, relationship_id: relation.id, event_id: eventId,
      })),
    nestedCollection('memory_events', [data.memories], memory => array(memory.sourceEventIds),
      (memory, eventId) => kanataMigrationInsert('memory_events', {
        world_id: memory.worldId, memory_id: memory.id, event_id: eventId,
      })),
    nestedCollection('memory_links', [data.memories], memory => {
      const links = []
      if (memory.sharedFromId) links.push({ kind: 'shared', id: memory.sharedFromId })
      if (memory.supersededById) links.push({ kind: 'superseded', id: memory.supersededById })
      for (const id of array(memory.conflictWith)) links.push({ kind: 'conflict', id })
      return links
    }, (memory, link) => kanataMigrationInsert('memory_links', {
      world_id: memory.worldId, memory_id: memory.id, kind: link.kind, target_memory_id: link.id,
    })),
    nestedCollection('memory_sources', [data.memories], memory => memory.sourceRefs,
      (memory, source) => kanataMigrationInsert('memory_sources', {
        world_id: memory.worldId, memory_id: memory.id, message_id: source.messageId, message_revision: source.revision,
      })),
    nestedCollection('event_sources', [data.events], event => event.sourceRefs,
      (event, source) => kanataMigrationInsert('event_sources', {
        world_id: event.worldId, event_id: event.id, message_id: source.messageId, message_revision: source.revision,
      })),
    nestedCollection('task_sources', [data.tasks], task => {
      const refs = [...array(task.sourceRefs)]
      if (task.deferredReply && !refs.some(ref => ref.messageId === task.deferredReply.sourceMessageId
        && ref.revision === task.deferredReply.sourceRevision)) {
        refs.push({ messageId: task.deferredReply.sourceMessageId, revision: task.deferredReply.sourceRevision })
      }
      return refs
    }, (task, source) => kanataMigrationInsert('task_sources', {
      world_id: task.worldId, task_id: task.id, message_id: source.messageId, message_revision: source.revision,
    })),
    nestedCollection('task_result_events', [data.tasks], task => task.resultEventIds,
      (task, eventId) => kanataMigrationInsert('task_result_events', {
        world_id: task.worldId, task_id: task.id, event_id: eventId,
      })),
    nestedCollection('task_result_memories', [data.tasks], task => array(task.resultMemoryIds),
      (task, memoryId) => kanataMigrationInsert('task_result_memories', {
        world_id: task.worldId, task_id: task.id, memory_id: memoryId,
      })),
    nestedCollection('task_social_participants', [data.tasks], task => array(task.social?.participantIds),
      (task, instanceId) => kanataMigrationInsert('task_social_participants', {
        world_id: task.worldId, task_id: task.id, conversation_id: task.conversationId, instance_id: instanceId,
      })),
    nestedCollection('memory_life_sources', [data.memories], memory => array(memory.lifeSources),
      (memory, source) => kanataMigrationInsert('memory_life_sources', {
        world_id: memory.worldId, memory_id: memory.id, grant_id: source.grantId, instance_id: source.instanceId,
        module_id: source.moduleId, grant_revision: source.revision, fingerprint: source.fingerprint,
      })),
    nestedCollection('event_life_sources', [data.events], event => array(event.lifeSources),
      (event, source) => kanataMigrationInsert('event_life_sources', {
        world_id: event.worldId, event_id: event.id, grant_id: source.grantId, instance_id: source.instanceId,
        module_id: source.moduleId, grant_revision: source.revision, fingerprint: source.fingerprint,
      })),
  ]
  return collections
}

export const KANATA_MIGRATION_TABLES = Object.freeze([
  'dataset_metadata','entity_ids','participants','worlds','world_identities','character_cards','card_versions',
  'character_instances','conversations','conversation_participants','messages','lorebook_entries','lorebook_known_by',
  'memories','memory_known_by','memory_sources','memory_events','memory_links','relationships','relationship_events',
  'world_events','event_participants','event_causes','event_sources','world_effects','effect_baselines',
  'background_tasks','task_sources','task_result_events','task_result_memories','task_social_participants',
  'life_grants','message_life_sources','memory_life_sources','event_life_sources','preset_applications',
  'usage_events','virtual_schedules','virtual_schedule_days','memory_policies','autonomy_policies',
  'role_binding_state','role_bindings','message_audits','event_audits',
  'event_array_order','effect_array_order','baseline_array_order','domain_command_receipts','archived_message_marks',
])

export const KANATA_MIGRATION_ENTITY_TABLES = Object.freeze([
  'worlds','character_cards','card_versions','world_identities','character_instances','conversations','messages',
  'lorebook_entries','memories','relationships','world_events','world_effects','effect_baselines','background_tasks',
  'life_grants','preset_applications','usage_events','virtual_schedules','message_audits','event_audits',
])
