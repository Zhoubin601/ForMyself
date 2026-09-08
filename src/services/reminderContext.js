import {
  buildMoodHistory,
  buildReminderCompanionPrompt,
  buildSavingsHistory,
  buildWeightHistory
} from '../features/chat/companionPrompts.js'

export function buildMoodReminderContext(records = [], referenceDate = new Date(), definitions = []) {
  return buildMoodHistory(records, referenceDate, '', definitions)
}

export function buildWeightReminderContext(records = [], referenceDate = new Date()) {
  return buildWeightHistory(records, referenceDate)
}

export function buildSavingsReminderContext(plans = [], referenceDate = new Date()) {
  return buildSavingsHistory(plans, referenceDate)
}

export function buildReminderContexts({
  moodRecords = [],
  moodDefinitions = [],
  weightRecords = [],
  savedDebts = []
} = {}, referenceDate = new Date()) {
  return {
    mood: buildMoodReminderContext(moodRecords, referenceDate, moodDefinitions),
    weight: buildWeightReminderContext(weightRecords, referenceDate),
    savings: buildSavingsReminderContext(savedDebts, referenceDate)
  }
}

export function getReminderContextFingerprint(context) {
  return JSON.stringify(context)
}

export function buildReminderPrompt(type, context) {
  return buildReminderCompanionPrompt(type, context)
}
