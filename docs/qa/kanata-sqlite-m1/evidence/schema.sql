-- migration 1: kanata-core

CREATE TABLE schema_migrations (version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991) PRIMARY KEY,
name TEXT NOT NULL CHECK(length(trim(name)) > 0),
checksum TEXT NOT NULL CHECK(length(checksum)=64)) STRICT;

CREATE TABLE entity_ids (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
table_name TEXT NOT NULL CHECK(length(trim(table_name)) > 0)) STRICT;

CREATE TABLE dataset_metadata (singleton INTEGER NOT NULL CHECK(singleton BETWEEN 1 AND 1) PRIMARY KEY,
user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 200 AND substr(user_id,1,1) GLOB '[A-Za-z0-9]' AND user_id NOT GLOB '*[^A-Za-z0-9._:-]*') UNIQUE,
data_version INTEGER NOT NULL CHECK(data_version BETWEEN 1 AND 2),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}') STRICT;

CREATE TABLE worlds (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
name TEXT NOT NULL CHECK(length(trim(name)) > 0),
rules TEXT NOT NULL,
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
time_zone TEXT NOT NULL CHECK(length(trim(time_zone)) > 0),
created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
last_simulated_at INTEGER NOT NULL CHECK(last_simulated_at BETWEEN 0 AND 9007199254740991),
autonomy_enabled INTEGER NOT NULL CHECK(autonomy_enabled BETWEEN 0 AND 1),
proactive_enabled INTEGER NOT NULL CHECK(proactive_enabled BETWEEN 0 AND 1),
notifications_enabled INTEGER NOT NULL CHECK(notifications_enabled BETWEEN 0 AND 1),
default_chat_mode TEXT NOT NULL CHECK(default_chat_mode IN ('daily','roleplay')),
archived INTEGER CHECK(archived IS NULL OR archived IN (0,1)),
identity_id TEXT NOT NULL CHECK(length(identity_id) BETWEEN 1 AND 200 AND substr(identity_id,1,1) GLOB '[A-Za-z0-9]' AND identity_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(last_simulated_at>=created_at),
FOREIGN KEY(id,identity_id) REFERENCES world_identities(world_id,id) DEFERRABLE INITIALLY DEFERRED) STRICT;

CREATE TABLE character_cards (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
current_version_id TEXT NOT NULL CHECK(length(current_version_id) BETWEEN 1 AND 200 AND substr(current_version_id,1,1) GLOB '[A-Za-z0-9]' AND current_version_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
archived INTEGER NOT NULL CHECK(archived BETWEEN 0 AND 1),
preset_key TEXT UNIQUE,
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
FOREIGN KEY(id,current_version_id) REFERENCES card_versions(card_id,id) DEFERRABLE INITIALLY DEFERRED) STRICT;

CREATE TABLE card_versions (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
card_id TEXT NOT NULL CHECK(length(card_id) BETWEEN 1 AND 200 AND substr(card_id,1,1) GLOB '[A-Za-z0-9]' AND card_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES character_cards(id) DEFERRABLE INITIALLY DEFERRED,
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
definition_json TEXT NOT NULL CHECK(CASE WHEN json_valid(definition_json) THEN json_type(definition_json) = 'object' ELSE 0 END),
raw_data_json TEXT NOT NULL CHECK(CASE WHEN json_valid(raw_data_json) THEN 1 ELSE 0 END),
source TEXT NOT NULL CHECK(length(trim(source)) > 0),
imported_json TEXT CHECK(imported_json IS NULL OR (json_valid(imported_json) AND json_type(imported_json)='object')),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
UNIQUE(card_id,revision),
UNIQUE(card_id,id)) STRICT;

CREATE TABLE world_identities (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 200 AND substr(user_id,1,1) GLOB '[A-Za-z0-9]' AND user_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES dataset_metadata(user_id),
display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0),
background TEXT NOT NULL,
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
UNIQUE(world_id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE character_instances (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
card_id TEXT NOT NULL CHECK(length(card_id) BETWEEN 1 AND 200 AND substr(card_id,1,1) GLOB '[A-Za-z0-9]' AND card_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
card_version_id TEXT NOT NULL CHECK(length(card_version_id) BETWEEN 1 AND 200 AND substr(card_version_id,1,1) GLOB '[A-Za-z0-9]' AND card_version_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
overrides_json TEXT NOT NULL CHECK(CASE WHEN json_valid(overrides_json) THEN json_type(overrides_json) = 'object' ELSE 0 END),
mood TEXT NOT NULL CHECK(length(trim(mood)) > 0),
energy REAL NOT NULL CHECK(energy BETWEEN 0 AND 1),
location TEXT NOT NULL,
autonomy_enabled INTEGER NOT NULL CHECK(autonomy_enabled BETWEEN 0 AND 1),
proactive_enabled INTEGER NOT NULL CHECK(proactive_enabled BETWEEN 0 AND 1),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
FOREIGN KEY(card_id,card_version_id) REFERENCES card_versions(card_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE participants (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*'),
kind TEXT NOT NULL CHECK(kind IN ('user','character')),
identity_id TEXT,
instance_id TEXT,
PRIMARY KEY(world_id,id),
UNIQUE(world_id,id,kind),
CHECK((kind='user' AND identity_id IS NOT NULL AND identity_id=id AND instance_id IS NULL) OR (kind='character' AND instance_id IS NOT NULL AND instance_id=id AND identity_id IS NULL)),
FOREIGN KEY(world_id,identity_id) REFERENCES world_identities(world_id,id),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id)) STRICT;

CREATE TABLE conversations (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
type TEXT NOT NULL CHECK(type IN ('private','group','character')),
title TEXT NOT NULL CHECK(length(trim(title)) > 0),
mode TEXT NOT NULL CHECK(mode IN ('daily','roleplay','inherit')),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
last_read_at INTEGER NOT NULL CHECK(last_read_at BETWEEN 0 AND 9007199254740991),
max_speakers INTEGER,
max_messages INTEGER,
reply_timing_enabled INTEGER,
reply_wait_ms INTEGER,
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((max_speakers IS NULL AND max_messages IS NULL) OR (type='group' AND max_speakers IS NOT NULL AND max_messages IS NOT NULL AND max_speakers BETWEEN 1 AND 8 AND max_messages BETWEEN max_speakers AND 32)),
CHECK((reply_timing_enabled IS NULL AND reply_wait_ms IS NULL) OR (type<>'character' AND reply_timing_enabled IS NOT NULL AND reply_wait_ms IS NOT NULL AND reply_timing_enabled IN (0,1) AND reply_wait_ms BETWEEN 1000 AND 30000)),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE conversation_participants (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 200 AND substr(conversation_id,1,1) GLOB '[A-Za-z0-9]' AND conversation_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
participant_id TEXT NOT NULL CHECK(length(participant_id) BETWEEN 1 AND 200 AND substr(participant_id,1,1) GLOB '[A-Za-z0-9]' AND participant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
kind TEXT NOT NULL CHECK(kind IN ('user','character')),
ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 9007199254740991),
PRIMARY KEY(world_id,conversation_id,participant_id),
UNIQUE(world_id,conversation_id,ordinal),
UNIQUE(world_id,conversation_id,participant_id,kind),
FOREIGN KEY(world_id,conversation_id) REFERENCES conversations(world_id,id),
FOREIGN KEY(world_id,participant_id,kind) REFERENCES participants(world_id,id,kind)) STRICT;

CREATE TABLE messages (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 200 AND substr(conversation_id,1,1) GLOB '[A-Za-z0-9]' AND conversation_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
role TEXT NOT NULL CHECK(role IN ('user','assistant')),
sender_type TEXT NOT NULL CHECK(sender_type IN ('user','character')),
sender_id TEXT NOT NULL CHECK(length(sender_id) BETWEEN 1 AND 200 AND substr(sender_id,1,1) GLOB '[A-Za-z0-9]' AND sender_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
sender_name_snapshot TEXT NOT NULL CHECK(length(trim(sender_name_snapshot)) > 0),
content TEXT NOT NULL,
created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
status TEXT NOT NULL CHECK(status IN ('complete','stopped')),
turn_id TEXT NOT NULL CHECK(length(turn_id) BETWEEN 1 AND 200 AND substr(turn_id,1,1) GLOB '[A-Za-z0-9]' AND turn_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 200 AND substr(batch_id,1,1) GLOB '[A-Za-z0-9]' AND batch_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
deleted INTEGER CHECK(deleted IS NULL OR deleted IN (0,1)),
reply_to_message_id TEXT,
reply_to_revision INTEGER CHECK(reply_to_revision IS NULL OR reply_to_revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((sender_type='user' AND role='user') OR (sender_type='character' AND role='assistant')),
CHECK(length(trim(content))>0 OR COALESCE(deleted,0)=1),
CHECK(reply_to_message_id IS NULL OR reply_to_message_id<>id),
CHECK(reply_to_revision IS NULL OR reply_to_message_id IS NOT NULL),
UNIQUE(world_id,conversation_id,id),
FOREIGN KEY(world_id,conversation_id) REFERENCES conversations(world_id,id),
FOREIGN KEY(world_id,conversation_id,sender_id,sender_type) REFERENCES conversation_participants(world_id,conversation_id,participant_id,kind),
FOREIGN KEY(world_id,conversation_id,reply_to_message_id) REFERENCES messages(world_id,conversation_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE lorebook_entries (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
scope TEXT NOT NULL CHECK(scope IN ('world','character','system')),
owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200 AND substr(owner_id,1,1) GLOB '[A-Za-z0-9]' AND owner_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
owner_instance_id TEXT,
keys_json TEXT NOT NULL CHECK(CASE WHEN json_valid(keys_json) THEN json_type(keys_json) = 'array' ELSE 0 END),
secondary_keys_json TEXT CHECK(secondary_keys_json IS NULL OR CASE WHEN json_valid(secondary_keys_json) THEN json_type(secondary_keys_json)='array' ELSE 0 END),
content TEXT NOT NULL CHECK(length(trim(content)) > 0),
priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 9007199254740991),
activation_rule TEXT NOT NULL CHECK(activation_rule IN ('keyword','always')),
visibility TEXT NOT NULL CHECK(visibility IN ('public','private','participants')),
source_tag TEXT NOT NULL CHECK(length(trim(source_tag)) > 0),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
enabled INTEGER CHECK(enabled IS NULL OR enabled IN (0,1)),
case_sensitive INTEGER CHECK(case_sensitive IS NULL OR case_sensitive IN (0,1)),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((scope='character' AND owner_instance_id IS NOT NULL AND owner_id=owner_instance_id) OR (scope<>'character' AND owner_instance_id IS NULL AND owner_id=world_id)),
FOREIGN KEY(world_id,owner_instance_id) REFERENCES character_instances(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE memories (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
owner_type TEXT NOT NULL CHECK(owner_type IN ('world','character')),
owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200 AND substr(owner_id,1,1) GLOB '[A-Za-z0-9]' AND owner_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
owner_instance_id TEXT,
layer TEXT NOT NULL CHECK(layer IN ('L2','L3')),
memory_key TEXT NOT NULL CHECK(length(trim(memory_key)) > 0),
content TEXT NOT NULL CHECK(length(trim(content)) > 0),
status TEXT NOT NULL CHECK(status IN ('candidate','active','stale','deleted')),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
visibility TEXT NOT NULL CHECK(visibility IN ('public','private','participants')),
conversation_id TEXT,
confidence TEXT CHECK(confidence IS NULL OR confidence IN ('statement','inference','confirmed','joke')),
generation_key TEXT CHECK(generation_key IS NULL OR length(generation_key)<=64000),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((owner_type='character' AND owner_instance_id IS NOT NULL AND owner_id=owner_instance_id) OR (owner_type='world' AND owner_instance_id IS NULL AND owner_id=world_id)),
FOREIGN KEY(world_id,owner_instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,conversation_id) REFERENCES conversations(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE relationships (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
from_id TEXT NOT NULL CHECK(length(from_id) BETWEEN 1 AND 200 AND substr(from_id,1,1) GLOB '[A-Za-z0-9]' AND from_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
to_id TEXT NOT NULL CHECK(length(to_id) BETWEEN 1 AND 200 AND substr(to_id,1,1) GLOB '[A-Za-z0-9]' AND to_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
kind TEXT NOT NULL CHECK(kind IN ('teammate','teacher','acquaintance','friend','conflict','romantic')),
trust_baseline TEXT NOT NULL CHECK(trust_baseline IN ('new','established')),
public_summary TEXT NOT NULL CHECK(length(trim(public_summary)) > 0),
trust REAL NOT NULL CHECK(trust BETWEEN -1 AND 1),
intimacy REAL NOT NULL CHECK(intimacy BETWEEN -1 AND 1),
understanding REAL NOT NULL CHECK(understanding BETWEEN -1 AND 1),
dimension_rule_version INTEGER NOT NULL CHECK(dimension_rule_version BETWEEN 1 AND 9007199254740991),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(from_id<>to_id),
UNIQUE(world_id,from_id,to_id),
FOREIGN KEY(world_id,from_id) REFERENCES participants(world_id,id),
FOREIGN KEY(world_id,to_id) REFERENCES participants(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE world_events (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
status TEXT NOT NULL CHECK(status IN ('candidate','committed','revoked','needsReview')),
visibility TEXT NOT NULL CHECK(visibility IN ('public','private','participants')),
summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
effective_at INTEGER NOT NULL CHECK(effective_at BETWEEN 0 AND 9007199254740991),
recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN 0 AND 9007199254740991),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
causality TEXT CHECK(causality IS NULL OR causality IN ('explicit','unknown')),
kind TEXT CHECK(kind IS NULL OR kind IN ('note','support','conflict','rest','move','promise')),
action_instance_id TEXT,
action_relationship_id TEXT,
action_location TEXT CHECK(action_location IS NULL OR length(action_location)<=200),
replaces_event_id TEXT,
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(replaces_event_id IS NULL OR replaces_event_id<>id),
FOREIGN KEY(world_id,action_instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,action_relationship_id) REFERENCES relationships(world_id,id),
FOREIGN KEY(world_id,replaces_event_id) REFERENCES world_events(world_id,id) DEFERRABLE INITIALLY DEFERRED,
UNIQUE(world_id,id)) STRICT;

CREATE TABLE world_effects (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
target_type TEXT NOT NULL CHECK(target_type IN ('world','instance','relationship')),
target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND substr(target_id,1,1) GLOB '[A-Za-z0-9]' AND target_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
target_instance_id TEXT,
target_relationship_id TEXT,
operation TEXT NOT NULL CHECK(operation IN ('set','increment')),
path TEXT NOT NULL CHECK(length(trim(path)) > 0),
value_json TEXT NOT NULL CHECK(CASE WHEN json_valid(value_json) THEN 1 ELSE 0 END),
rule_version INTEGER NOT NULL CHECK(rule_version BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((target_type='world' AND target_id=world_id AND target_instance_id IS NULL AND target_relationship_id IS NULL) OR (target_type='instance' AND target_instance_id IS NOT NULL AND target_id=target_instance_id AND target_relationship_id IS NULL) OR (target_type='relationship' AND target_relationship_id IS NOT NULL AND target_id=target_relationship_id AND target_instance_id IS NULL)),
FOREIGN KEY(world_id,target_instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,target_relationship_id) REFERENCES relationships(world_id,id),
CHECK(operation<>'increment' OR json_type(value_json) IN ('integer','real')),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE effect_baselines (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
target_type TEXT NOT NULL CHECK(target_type IN ('world','instance','relationship')),
target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 200 AND substr(target_id,1,1) GLOB '[A-Za-z0-9]' AND target_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
target_instance_id TEXT,
target_relationship_id TEXT,
path TEXT NOT NULL CHECK(length(trim(path)) > 0),
value_json TEXT NOT NULL CHECK(CASE WHEN json_valid(value_json) THEN 1 ELSE 0 END),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((target_type='world' AND target_id=world_id AND target_instance_id IS NULL AND target_relationship_id IS NULL) OR (target_type='instance' AND target_instance_id IS NOT NULL AND target_id=target_instance_id AND target_relationship_id IS NULL) OR (target_type='relationship' AND target_relationship_id IS NOT NULL AND target_id=target_relationship_id AND target_instance_id IS NULL)),
FOREIGN KEY(world_id,target_instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,target_relationship_id) REFERENCES relationships(world_id,id),
UNIQUE(world_id,target_type,target_id,path),
CHECK((target_type='instance' AND path IN ('state.mood','state.energy','state.location')) OR (target_type='relationship' AND path IN ('dimensions.trust','dimensions.intimacy','dimensions.understanding'))),
CHECK(CASE WHEN path='state.energy' OR target_type='relationship' THEN json_type(value_json) IN ('integer','real') AND json_extract(value_json,'$') BETWEEN (CASE WHEN path='state.energy' THEN 0 ELSE -1 END) AND 1 ELSE json_type(value_json)='text' AND length(json_extract(value_json,'$'))<=2000 END),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE background_tasks (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
kind TEXT NOT NULL CHECK(kind IN ('reply','memory','summary','world','proactive','followup')),
state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed','cancelled')),
idempotency_key TEXT NOT NULL CHECK(length(trim(idempotency_key)) > 0),
source_revision INTEGER NOT NULL CHECK(source_revision BETWEEN 1 AND 9007199254740991),
attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 9007199254740991),
not_before INTEGER NOT NULL CHECK(not_before BETWEEN 0 AND 9007199254740991),
lease_until INTEGER NOT NULL CHECK(lease_until BETWEEN 0 AND 9007199254740991),
conversation_id TEXT,
instance_id TEXT,
error_code TEXT CHECK(error_code IS NULL OR error_code NOT GLOB '*[^A-Z0-9_]*'),
metadata_json TEXT NOT NULL CHECK(CASE WHEN json_valid(metadata_json) THEN json_type(metadata_json) = 'object' ELSE 0 END) DEFAULT '{}',
window_task_id TEXT,
deferred_message_id TEXT,
deferred_revision INTEGER,
deferred_expires_at INTEGER,
notification_id INTEGER UNIQUE CHECK(notification_id IS NULL OR notification_id BETWEEN 910000000 AND 910999999),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((deferred_message_id IS NULL AND deferred_revision IS NULL AND deferred_expires_at IS NULL) OR (kind='reply' AND conversation_id IS NOT NULL AND deferred_message_id IS NOT NULL AND deferred_revision IS NOT NULL AND deferred_revision BETWEEN 1 AND 9007199254740991 AND deferred_expires_at IS NOT NULL AND deferred_expires_at BETWEEN not_before AND 9007199254740991)),
CHECK(window_task_id IS NULL OR (kind='world' AND window_task_id<>id)),
CHECK(notification_id IS NULL OR (kind='proactive' AND instance_id IS NOT NULL AND conversation_id IS NOT NULL)),
UNIQUE(world_id,id,conversation_id),
UNIQUE(world_id,kind,idempotency_key),
FOREIGN KEY(world_id,conversation_id) REFERENCES conversations(world_id,id),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,window_task_id) REFERENCES background_tasks(world_id,id),
FOREIGN KEY(world_id,conversation_id,deferred_message_id) REFERENCES messages(world_id,conversation_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE life_grants (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
module_id TEXT NOT NULL CHECK(module_id IN ('home','mood','weight','savings','schedule','todo','reports')),
can_read INTEGER NOT NULL CHECK(can_read BETWEEN 0 AND 1),
can_remember INTEGER NOT NULL CHECK(can_remember BETWEEN 0 AND 1),
can_share INTEGER NOT NULL CHECK(can_share BETWEEN 0 AND 1),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
UNIQUE(world_id,instance_id,module_id),
UNIQUE(world_id,id,instance_id,module_id),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE preset_applications (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
initialization_key TEXT NOT NULL CHECK(length(trim(initialization_key)) > 0) UNIQUE,
preset_source_id TEXT NOT NULL CHECK(length(trim(preset_source_id)) > 0),
preset_version INTEGER NOT NULL CHECK(preset_version BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
UNIQUE(world_id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE usage_events (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 200 AND substr(conversation_id,1,1) GLOB '[A-Za-z0-9]' AND conversation_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
participant_kind TEXT NOT NULL DEFAULT 'character' CHECK(participant_kind='character'),
turn_id TEXT NOT NULL CHECK(length(turn_id) BETWEEN 1 AND 200 AND substr(turn_id,1,1) GLOB '[A-Za-z0-9]' AND turn_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
model TEXT NOT NULL CHECK(length(trim(model)) > 0),
official_provider INTEGER NOT NULL CHECK(official_provider BETWEEN 0 AND 1),
started_at INTEGER NOT NULL CHECK(started_at BETWEEN 0 AND 9007199254740991),
finished_at INTEGER CHECK(finished_at IS NULL OR finished_at BETWEEN 0 AND 9007199254740991),
transport TEXT NOT NULL CHECK(transport IN ('stream','json')),
status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed')),
error_code TEXT NOT NULL CHECK(error_code NOT GLOB '*[^A-Z0-9_]*'),
finish_reason TEXT NOT NULL CHECK(finish_reason NOT GLOB '*[^a-z_]*'),
estimated_input_tokens INTEGER NOT NULL CHECK(estimated_input_tokens BETWEEN 0 AND 9007199254740991),
estimated_output_tokens INTEGER NOT NULL CHECK(estimated_output_tokens BETWEEN 0 AND 9007199254740991),
prompt_tokens INTEGER,
completion_tokens INTEGER,
cache_hit_tokens INTEGER,
purpose TEXT CHECK(purpose IS NULL OR purpose IN ('chat','memory','summary','world','proactive','life')),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((status='pending')=(finished_at IS NULL)),
CHECK((prompt_tokens IS NULL AND completion_tokens IS NULL AND cache_hit_tokens IS NULL) OR (prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL AND prompt_tokens BETWEEN 0 AND 9007199254740991 AND completion_tokens BETWEEN 0 AND 9007199254740991 AND (cache_hit_tokens IS NULL OR cache_hit_tokens BETWEEN 0 AND prompt_tokens))),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id),
FOREIGN KEY(world_id,conversation_id,instance_id,participant_kind) REFERENCES conversation_participants(world_id,conversation_id,participant_id,kind),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE virtual_schedules (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
location TEXT NOT NULL CHECK(length(trim(location)) > 0),
activity TEXT NOT NULL CHECK(length(trim(activity)) > 0),
resting INTEGER NOT NULL CHECK(resting BETWEEN 0 AND 1),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(start_minute<end_minute),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE virtual_schedule_days (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
schedule_id TEXT NOT NULL CHECK(length(schedule_id) BETWEEN 1 AND 200 AND substr(schedule_id,1,1) GLOB '[A-Za-z0-9]' AND schedule_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
PRIMARY KEY(world_id,schedule_id,day),
FOREIGN KEY(world_id,schedule_id) REFERENCES virtual_schedules(world_id,id)) STRICT;

CREATE TABLE task_social_participants (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 200 AND substr(task_id,1,1) GLOB '[A-Za-z0-9]' AND task_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 200 AND substr(conversation_id,1,1) GLOB '[A-Za-z0-9]' AND conversation_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
kind TEXT NOT NULL DEFAULT 'character' CHECK(kind='character'),
PRIMARY KEY(world_id,task_id,instance_id),
FOREIGN KEY(world_id,task_id,conversation_id) REFERENCES background_tasks(world_id,id,conversation_id),
FOREIGN KEY(world_id,conversation_id,instance_id,kind) REFERENCES conversation_participants(world_id,conversation_id,participant_id,kind)) STRICT;

CREATE TABLE memory_policies (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id) PRIMARY KEY,
strategy TEXT NOT NULL CHECK(strategy IN ('economical','standard','deep','custom')),
enabled INTEGER NOT NULL CHECK(enabled BETWEEN 0 AND 1),
recent_messages INTEGER NOT NULL CHECK(recent_messages BETWEEN 2 AND 40),
summarize_after INTEGER NOT NULL CHECK(summarize_after BETWEEN 4 AND 200),
extract_after INTEGER NOT NULL CHECK(extract_after BETWEEN 2 AND 100),
context_budget INTEGER NOT NULL CHECK(context_budget BETWEEN 2000 AND 64000),
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(summarize_after>recent_messages)) STRICT;

CREATE TABLE autonomy_policies (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id) PRIMARY KEY,
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
daily_dialogue_limit INTEGER NOT NULL CHECK(daily_dialogue_limit BETWEEN 0 AND 4),
max_catch_up_hours INTEGER NOT NULL CHECK(max_catch_up_hours BETWEEN 1 AND 24),
freedom TEXT NOT NULL CHECK(freedom IN ('strict','standard','free','unrestricted')),
quiet_start_minute INTEGER NOT NULL CHECK(quiet_start_minute BETWEEN 0 AND 1439),
quiet_end_minute INTEGER NOT NULL CHECK(quiet_end_minute BETWEEN 0 AND 1439),
social_channel TEXT CHECK(social_channel IS NULL OR social_channel IN ('private','group')),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}') STRICT;

CREATE TABLE role_binding_state (singleton INTEGER NOT NULL CHECK(singleton BETWEEN 1 AND 1) PRIMARY KEY,
revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}') STRICT;

CREATE TABLE role_bindings (scope TEXT NOT NULL PRIMARY KEY CHECK(scope IN ('global','home','mood','weight','savings','schedule','todo','reports')),
state_id INTEGER NOT NULL DEFAULT 1 CHECK(state_id=1) REFERENCES role_binding_state(singleton),
world_id TEXT,
instance_id TEXT,
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK((world_id IS NULL)=(instance_id IS NULL))) STRICT;

CREATE TABLE data_migrations (id TEXT NOT NULL CHECK(length(trim(id)) > 0) PRIMARY KEY,
target_schema_version INTEGER NOT NULL CHECK(target_schema_version BETWEEN 1 AND 9007199254740991),
source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64 AND source_fingerprint NOT GLOB '*[^a-f0-9]*'),
collection TEXT NOT NULL CHECK(length(trim(collection)) > 0),
cursor_json TEXT NOT NULL CHECK(CASE WHEN json_valid(cursor_json) THEN 1 ELSE 0 END),
imported_count INTEGER NOT NULL CHECK(imported_count BETWEEN 0 AND 9007199254740991),
state TEXT NOT NULL CHECK(state IN ('pending','running','complete','failed')),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}') STRICT;

CREATE TABLE lorebook_known_by (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
entry_id TEXT NOT NULL CHECK(length(entry_id) BETWEEN 1 AND 200 AND substr(entry_id,1,1) GLOB '[A-Za-z0-9]' AND entry_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
participant_id TEXT NOT NULL CHECK(length(participant_id) BETWEEN 1 AND 200 AND substr(participant_id,1,1) GLOB '[A-Za-z0-9]' AND participant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,entry_id,participant_id),
FOREIGN KEY(world_id,entry_id) REFERENCES lorebook_entries(world_id,id),
FOREIGN KEY(world_id,participant_id) REFERENCES participants(world_id,id)) STRICT;

CREATE TABLE memory_known_by (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,memory_id,instance_id),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id),
FOREIGN KEY(world_id,instance_id) REFERENCES character_instances(world_id,id)) STRICT;

CREATE TABLE event_participants (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
participant_id TEXT NOT NULL CHECK(length(participant_id) BETWEEN 1 AND 200 AND substr(participant_id,1,1) GLOB '[A-Za-z0-9]' AND participant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,event_id,participant_id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
FOREIGN KEY(world_id,participant_id) REFERENCES participants(world_id,id)) STRICT;

CREATE TABLE event_causes (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
cause_event_id TEXT NOT NULL CHECK(length(cause_event_id) BETWEEN 1 AND 200 AND substr(cause_event_id,1,1) GLOB '[A-Za-z0-9]' AND cause_event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
CHECK(event_id<>cause_event_id),
PRIMARY KEY(world_id,event_id,cause_event_id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
FOREIGN KEY(world_id,cause_event_id) REFERENCES world_events(world_id,id)) STRICT;

CREATE TABLE relationship_events (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
relationship_id TEXT NOT NULL CHECK(length(relationship_id) BETWEEN 1 AND 200 AND substr(relationship_id,1,1) GLOB '[A-Za-z0-9]' AND relationship_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,relationship_id,event_id),
FOREIGN KEY(world_id,relationship_id) REFERENCES relationships(world_id,id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id)) STRICT;

CREATE TABLE memory_events (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,memory_id,event_id),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id)) STRICT;

CREATE TABLE task_result_events (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 200 AND substr(task_id,1,1) GLOB '[A-Za-z0-9]' AND task_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,task_id,event_id),
FOREIGN KEY(world_id,task_id) REFERENCES background_tasks(world_id,id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id)) STRICT;

CREATE TABLE task_result_memories (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 200 AND substr(task_id,1,1) GLOB '[A-Za-z0-9]' AND task_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
PRIMARY KEY(world_id,task_id,memory_id),
FOREIGN KEY(world_id,task_id) REFERENCES background_tasks(world_id,id),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id)) STRICT;

CREATE TABLE memory_links (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
target_memory_id TEXT NOT NULL CHECK(length(target_memory_id) BETWEEN 1 AND 200 AND substr(target_memory_id,1,1) GLOB '[A-Za-z0-9]' AND target_memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
kind TEXT NOT NULL CHECK(kind IN ('conflict','shared','superseded')),
PRIMARY KEY(world_id,memory_id,kind,target_memory_id),
CHECK(memory_id<>target_memory_id),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id),
FOREIGN KEY(world_id,target_memory_id) REFERENCES memories(world_id,id)) STRICT;

CREATE TABLE memory_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200 AND substr(message_id,1,1) GLOB '[A-Za-z0-9]' AND message_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_revision INTEGER NOT NULL CHECK(message_revision BETWEEN 1 AND 9007199254740991),
PRIMARY KEY(world_id,memory_id,message_id),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id),
FOREIGN KEY(world_id,message_id) REFERENCES messages(world_id,id)) STRICT;

CREATE TABLE event_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200 AND substr(message_id,1,1) GLOB '[A-Za-z0-9]' AND message_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_revision INTEGER NOT NULL CHECK(message_revision BETWEEN 1 AND 9007199254740991),
PRIMARY KEY(world_id,event_id,message_id),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
FOREIGN KEY(world_id,message_id) REFERENCES messages(world_id,id)) STRICT;

CREATE TABLE task_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 200 AND substr(task_id,1,1) GLOB '[A-Za-z0-9]' AND task_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200 AND substr(message_id,1,1) GLOB '[A-Za-z0-9]' AND message_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
message_revision INTEGER NOT NULL CHECK(message_revision BETWEEN 1 AND 9007199254740991),
PRIMARY KEY(world_id,task_id,message_id),
FOREIGN KEY(world_id,task_id) REFERENCES background_tasks(world_id,id),
FOREIGN KEY(world_id,message_id) REFERENCES messages(world_id,id)) STRICT;

CREATE TABLE message_life_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200 AND substr(message_id,1,1) GLOB '[A-Za-z0-9]' AND message_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
grant_id TEXT NOT NULL CHECK(length(grant_id) BETWEEN 1 AND 200 AND substr(grant_id,1,1) GLOB '[A-Za-z0-9]' AND grant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
module_id TEXT NOT NULL CHECK(module_id IN ('home','mood','weight','savings','schedule','todo','reports')),
grant_revision INTEGER NOT NULL CHECK(grant_revision BETWEEN 1 AND 9007199254740991),
fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
PRIMARY KEY(world_id,message_id,grant_id,grant_revision,fingerprint),
FOREIGN KEY(world_id,message_id) REFERENCES messages(world_id,id),
FOREIGN KEY(world_id,grant_id,instance_id,module_id) REFERENCES life_grants(world_id,id,instance_id,module_id)) STRICT;

CREATE TABLE memory_life_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 200 AND substr(memory_id,1,1) GLOB '[A-Za-z0-9]' AND memory_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
grant_id TEXT NOT NULL CHECK(length(grant_id) BETWEEN 1 AND 200 AND substr(grant_id,1,1) GLOB '[A-Za-z0-9]' AND grant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
module_id TEXT NOT NULL CHECK(module_id IN ('home','mood','weight','savings','schedule','todo','reports')),
grant_revision INTEGER NOT NULL CHECK(grant_revision BETWEEN 1 AND 9007199254740991),
fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
PRIMARY KEY(world_id,memory_id,grant_id,grant_revision,fingerprint),
FOREIGN KEY(world_id,memory_id) REFERENCES memories(world_id,id),
FOREIGN KEY(world_id,grant_id,instance_id,module_id) REFERENCES life_grants(world_id,id,instance_id,module_id)) STRICT;

CREATE TABLE event_life_sources (world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
grant_id TEXT NOT NULL CHECK(length(grant_id) BETWEEN 1 AND 200 AND substr(grant_id,1,1) GLOB '[A-Za-z0-9]' AND grant_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 200 AND substr(instance_id,1,1) GLOB '[A-Za-z0-9]' AND instance_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
module_id TEXT NOT NULL CHECK(module_id IN ('home','mood','weight','savings','schedule','todo','reports')),
grant_revision INTEGER NOT NULL CHECK(grant_revision BETWEEN 1 AND 9007199254740991),
fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
PRIMARY KEY(world_id,event_id,grant_id,grant_revision,fingerprint),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
FOREIGN KEY(world_id,grant_id,instance_id,module_id) REFERENCES life_grants(world_id,id,instance_id,module_id)) STRICT;

CREATE TABLE message_audits (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200 AND substr(message_id,1,1) GLOB '[A-Za-z0-9]' AND message_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
at INTEGER NOT NULL CHECK(at BETWEEN 0 AND 9007199254740991),
previous_revision INTEGER NOT NULL CHECK(previous_revision BETWEEN 1 AND 9007199254740991),
next_revision INTEGER NOT NULL CHECK(next_revision BETWEEN 1 AND 9007199254740991),
previous_json TEXT NOT NULL CHECK(CASE WHEN json_valid(previous_json) THEN json_type(previous_json) = 'object' ELSE 0 END),
next_json TEXT NOT NULL CHECK(CASE WHEN json_valid(next_json) THEN json_type(next_json) = 'object' ELSE 0 END),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(next_revision>previous_revision),
FOREIGN KEY(world_id,message_id) REFERENCES messages(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TABLE event_audits (id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND substr(id,1,1) GLOB '[A-Za-z0-9]' AND id NOT GLOB '*[^A-Za-z0-9._:-]*') PRIMARY KEY,
world_id TEXT NOT NULL CHECK(length(world_id) BETWEEN 1 AND 200 AND substr(world_id,1,1) GLOB '[A-Za-z0-9]' AND world_id NOT GLOB '*[^A-Za-z0-9._:-]*') REFERENCES worlds(id),
event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200 AND substr(event_id,1,1) GLOB '[A-Za-z0-9]' AND event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
at INTEGER NOT NULL CHECK(at BETWEEN 0 AND 9007199254740991),
previous_revision INTEGER NOT NULL CHECK(previous_revision BETWEEN 1 AND 9007199254740991),
next_revision INTEGER NOT NULL CHECK(next_revision BETWEEN 1 AND 9007199254740991),
previous_json TEXT NOT NULL CHECK(CASE WHEN json_valid(previous_json) THEN json_type(previous_json) = 'object' ELSE 0 END),
next_json TEXT NOT NULL CHECK(CASE WHEN json_valid(next_json) THEN json_type(next_json) = 'object' ELSE 0 END),
extensions_json TEXT NOT NULL CHECK(CASE WHEN json_valid(extensions_json) THEN json_type(extensions_json) = 'object' ELSE 0 END) DEFAULT '{}',
CHECK(next_revision>previous_revision),
FOREIGN KEY(world_id,event_id) REFERENCES world_events(world_id,id),
UNIQUE(world_id,id)) STRICT;

CREATE TRIGGER worlds_unique_id BEFORE INSERT ON worlds BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER worlds_register AFTER INSERT ON worlds BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'worlds'); END;

CREATE TRIGGER worlds_unregister AFTER DELETE ON worlds BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='worlds'; END;

CREATE TRIGGER worlds_immutable_scope BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id; END;

CREATE TRIGGER character_cards_unique_id BEFORE INSERT ON character_cards BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER character_cards_register AFTER INSERT ON character_cards BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'character_cards'); END;

CREATE TRIGGER character_cards_unregister AFTER DELETE ON character_cards BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='character_cards'; END;

CREATE TRIGGER character_cards_immutable_scope BEFORE UPDATE ON character_cards BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id; END;

CREATE TRIGGER card_versions_unique_id BEFORE INSERT ON card_versions BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER card_versions_register AFTER INSERT ON card_versions BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'card_versions'); END;

CREATE TRIGGER card_versions_unregister AFTER DELETE ON card_versions BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='card_versions'; END;

CREATE TRIGGER card_versions_immutable_scope BEFORE UPDATE ON card_versions BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id; END;

CREATE TRIGGER world_identities_unique_id BEFORE INSERT ON world_identities BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER world_identities_register AFTER INSERT ON world_identities BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'world_identities'); END;

CREATE TRIGGER world_identities_unregister AFTER DELETE ON world_identities BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='world_identities'; END;

CREATE TRIGGER world_identities_immutable_scope BEFORE UPDATE ON world_identities BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER character_instances_unique_id BEFORE INSERT ON character_instances BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER character_instances_register AFTER INSERT ON character_instances BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'character_instances'); END;

CREATE TRIGGER character_instances_unregister AFTER DELETE ON character_instances BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='character_instances'; END;

CREATE TRIGGER character_instances_immutable_scope BEFORE UPDATE ON character_instances BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER conversations_unique_id BEFORE INSERT ON conversations BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER conversations_register AFTER INSERT ON conversations BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'conversations'); END;

CREATE TRIGGER conversations_unregister AFTER DELETE ON conversations BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='conversations'; END;

CREATE TRIGGER conversations_immutable_scope BEFORE UPDATE ON conversations BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER messages_unique_id BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER messages_register AFTER INSERT ON messages BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'messages'); END;

CREATE TRIGGER messages_unregister AFTER DELETE ON messages BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='messages'; END;

CREATE TRIGGER messages_immutable_scope BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER lorebook_entries_unique_id BEFORE INSERT ON lorebook_entries BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER lorebook_entries_register AFTER INSERT ON lorebook_entries BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'lorebook_entries'); END;

CREATE TRIGGER lorebook_entries_unregister AFTER DELETE ON lorebook_entries BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='lorebook_entries'; END;

CREATE TRIGGER lorebook_entries_immutable_scope BEFORE UPDATE ON lorebook_entries BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER memories_unique_id BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER memories_register AFTER INSERT ON memories BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'memories'); END;

CREATE TRIGGER memories_unregister AFTER DELETE ON memories BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='memories'; END;

CREATE TRIGGER memories_immutable_scope BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER relationships_unique_id BEFORE INSERT ON relationships BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER relationships_register AFTER INSERT ON relationships BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'relationships'); END;

CREATE TRIGGER relationships_unregister AFTER DELETE ON relationships BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='relationships'; END;

CREATE TRIGGER relationships_immutable_scope BEFORE UPDATE ON relationships BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER world_events_unique_id BEFORE INSERT ON world_events BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER world_events_register AFTER INSERT ON world_events BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'world_events'); END;

CREATE TRIGGER world_events_unregister AFTER DELETE ON world_events BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='world_events'; END;

CREATE TRIGGER world_events_immutable_scope BEFORE UPDATE ON world_events BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER world_effects_unique_id BEFORE INSERT ON world_effects BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER world_effects_register AFTER INSERT ON world_effects BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'world_effects'); END;

CREATE TRIGGER world_effects_unregister AFTER DELETE ON world_effects BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='world_effects'; END;

CREATE TRIGGER world_effects_immutable_scope BEFORE UPDATE ON world_effects BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER effect_baselines_unique_id BEFORE INSERT ON effect_baselines BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER effect_baselines_register AFTER INSERT ON effect_baselines BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'effect_baselines'); END;

CREATE TRIGGER effect_baselines_unregister AFTER DELETE ON effect_baselines BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='effect_baselines'; END;

CREATE TRIGGER effect_baselines_immutable_scope BEFORE UPDATE ON effect_baselines BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER background_tasks_unique_id BEFORE INSERT ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER background_tasks_register AFTER INSERT ON background_tasks BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'background_tasks'); END;

CREATE TRIGGER background_tasks_unregister AFTER DELETE ON background_tasks BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='background_tasks'; END;

CREATE TRIGGER background_tasks_immutable_scope BEFORE UPDATE ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER life_grants_unique_id BEFORE INSERT ON life_grants BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER life_grants_register AFTER INSERT ON life_grants BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'life_grants'); END;

CREATE TRIGGER life_grants_unregister AFTER DELETE ON life_grants BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='life_grants'; END;

CREATE TRIGGER life_grants_immutable_scope BEFORE UPDATE ON life_grants BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER preset_applications_unique_id BEFORE INSERT ON preset_applications BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER preset_applications_register AFTER INSERT ON preset_applications BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'preset_applications'); END;

CREATE TRIGGER preset_applications_unregister AFTER DELETE ON preset_applications BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='preset_applications'; END;

CREATE TRIGGER preset_applications_immutable_scope BEFORE UPDATE ON preset_applications BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER usage_events_unique_id BEFORE INSERT ON usage_events BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER usage_events_register AFTER INSERT ON usage_events BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'usage_events'); END;

CREATE TRIGGER usage_events_unregister AFTER DELETE ON usage_events BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='usage_events'; END;

CREATE TRIGGER usage_events_immutable_scope BEFORE UPDATE ON usage_events BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER virtual_schedules_unique_id BEFORE INSERT ON virtual_schedules BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER virtual_schedules_register AFTER INSERT ON virtual_schedules BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'virtual_schedules'); END;

CREATE TRIGGER virtual_schedules_unregister AFTER DELETE ON virtual_schedules BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='virtual_schedules'; END;

CREATE TRIGGER virtual_schedules_immutable_scope BEFORE UPDATE ON virtual_schedules BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER message_audits_unique_id BEFORE INSERT ON message_audits BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER message_audits_register AFTER INSERT ON message_audits BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'message_audits'); END;

CREATE TRIGGER message_audits_unregister AFTER DELETE ON message_audits BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='message_audits'; END;

CREATE TRIGGER message_audits_immutable_scope BEFORE UPDATE ON message_audits BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER event_audits_unique_id BEFORE INSERT ON event_audits BEGIN SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id); END;

CREATE TRIGGER event_audits_register AFTER INSERT ON event_audits BEGIN INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'event_audits'); END;

CREATE TRIGGER event_audits_unregister AFTER DELETE ON event_audits BEGIN DELETE FROM entity_ids WHERE id=OLD.id AND table_name='event_audits'; END;

CREATE TRIGGER event_audits_immutable_scope BEFORE UPDATE ON event_audits BEGIN SELECT RAISE(ABORT,'KANATA_IMMUTABLE_SCOPE') WHERE NEW.id<>OLD.id OR NEW.world_id<>OLD.world_id; END;

CREATE TRIGGER world_identities_participant AFTER INSERT ON world_identities BEGIN INSERT INTO participants(world_id,id,kind,identity_id) VALUES(NEW.world_id,NEW.id,'user',NEW.id); END;

CREATE TRIGGER character_instances_participant AFTER INSERT ON character_instances BEGIN INSERT INTO participants(world_id,id,kind,instance_id) VALUES(NEW.world_id,NEW.id,'character',NEW.id); END;

CREATE TRIGGER messages_revision BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'KANATA_REVISION_REGRESSION') WHERE NEW.revision<OLD.revision; END;

CREATE TRIGGER world_events_revision BEFORE UPDATE ON world_events BEGIN SELECT RAISE(ABORT,'KANATA_REVISION_REGRESSION') WHERE NEW.revision<OLD.revision; END;

CREATE TRIGGER life_grants_revision BEFORE UPDATE ON life_grants BEGIN SELECT RAISE(ABORT,'KANATA_REVISION_REGRESSION') WHERE NEW.revision<OLD.revision; END;

CREATE TRIGGER memory_sources_insert BEFORE INSERT ON memory_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER memory_sources_update BEFORE UPDATE ON memory_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER event_sources_insert BEFORE INSERT ON event_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER event_sources_update BEFORE UPDATE ON event_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER task_sources_insert BEFORE INSERT ON task_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER task_sources_update BEFORE UPDATE ON task_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_SOURCE_REVISION') WHERE NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id); END;

CREATE TRIGGER message_life_sources_insert BEFORE INSERT ON message_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER message_life_sources_update BEFORE UPDATE ON message_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER memory_life_sources_insert BEFORE INSERT ON memory_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER memory_life_sources_update BEFORE UPDATE ON memory_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER event_life_sources_insert BEFORE INSERT ON event_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER event_life_sources_update BEFORE UPDATE ON event_life_sources BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_GRANT_REVISION') WHERE NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id); END;

CREATE TRIGGER messages_reply_insert BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_REPLY_REVISION') WHERE NEW.reply_to_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.reply_to_message_id); END;

CREATE TRIGGER effects_committed_insert BEFORE INSERT ON world_effects BEGIN SELECT RAISE(ABORT,'KANATA_UNCOMMITTED_EFFECT') WHERE (SELECT status FROM world_events WHERE world_id=NEW.world_id AND id=NEW.event_id)='candidate'; END;

CREATE TRIGGER tasks_speaker_insert BEFORE INSERT ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_TASK_SPEAKER_DENIED') WHERE NEW.conversation_id IS NOT NULL AND NEW.instance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND participant_id=NEW.instance_id AND kind='character'); END;

CREATE TRIGGER tasks_deferred_insert BEFORE INSERT ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_DEFERRED_SOURCE_DENIED') WHERE NEW.deferred_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND id=NEW.deferred_message_id AND sender_type='user' AND revision>=NEW.deferred_revision); END;

CREATE TRIGGER messages_reply_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'KANATA_FUTURE_REPLY_REVISION') WHERE NEW.reply_to_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.reply_to_message_id); END;

CREATE TRIGGER effects_committed_update BEFORE UPDATE ON world_effects BEGIN SELECT RAISE(ABORT,'KANATA_UNCOMMITTED_EFFECT') WHERE (SELECT status FROM world_events WHERE world_id=NEW.world_id AND id=NEW.event_id)='candidate'; END;

CREATE TRIGGER tasks_speaker_update BEFORE UPDATE ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_TASK_SPEAKER_DENIED') WHERE NEW.conversation_id IS NOT NULL AND NEW.instance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND participant_id=NEW.instance_id AND kind='character'); END;

CREATE TRIGGER tasks_deferred_update BEFORE UPDATE ON background_tasks BEGIN SELECT RAISE(ABORT,'KANATA_DEFERRED_SOURCE_DENIED') WHERE NEW.deferred_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND id=NEW.deferred_message_id AND sender_type='user' AND revision>=NEW.deferred_revision); END;

CREATE TRIGGER messages_edit_revision BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'KANATA_MESSAGE_REVISION_REQUIRED') WHERE (NEW.content IS NOT OLD.content OR NEW.deleted IS NOT OLD.deleted) AND NEW.revision<=OLD.revision;SELECT RAISE(ABORT,'KANATA_MESSAGE_IDENTITY_IMMUTABLE') WHERE NEW.conversation_id<>OLD.conversation_id OR NEW.sender_id<>OLD.sender_id OR NEW.sender_type<>OLD.sender_type OR NEW.created_at<>OLD.created_at; END;

CREATE TRIGGER message_audits_insert BEFORE INSERT ON message_audits BEGIN SELECT RAISE(ABORT,'KANATA_INVALID_AUDIT_REVISION') WHERE json_extract(NEW.previous_json,'$.id') IS NOT NEW.message_id OR json_extract(NEW.previous_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.previous_json,'$.revision') IS NOT NEW.previous_revision OR json_extract(NEW.next_json,'$.id') IS NOT NEW.message_id OR json_extract(NEW.next_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.next_json,'$.revision') IS NOT NEW.next_revision OR NEW.next_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id);SELECT RAISE(ABORT,'KANATA_AUDIT_SENDER_DENIED') WHERE NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=json_extract(NEW.previous_json,'$.conversationId') AND participant_id=json_extract(NEW.previous_json,'$.senderId') AND kind=json_extract(NEW.previous_json,'$.senderType'));SELECT RAISE(ABORT,'KANATA_AUDIT_SENDER_DENIED') WHERE NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=json_extract(NEW.next_json,'$.conversationId') AND participant_id=json_extract(NEW.next_json,'$.senderId') AND kind=json_extract(NEW.next_json,'$.senderType')); END;

CREATE TRIGGER message_audits_update BEFORE UPDATE ON message_audits BEGIN SELECT RAISE(ABORT,'KANATA_INVALID_AUDIT_REVISION') WHERE json_extract(NEW.previous_json,'$.id') IS NOT NEW.message_id OR json_extract(NEW.previous_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.previous_json,'$.revision') IS NOT NEW.previous_revision OR json_extract(NEW.next_json,'$.id') IS NOT NEW.message_id OR json_extract(NEW.next_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.next_json,'$.revision') IS NOT NEW.next_revision OR NEW.next_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id);SELECT RAISE(ABORT,'KANATA_AUDIT_SENDER_DENIED') WHERE NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=json_extract(NEW.previous_json,'$.conversationId') AND participant_id=json_extract(NEW.previous_json,'$.senderId') AND kind=json_extract(NEW.previous_json,'$.senderType'));SELECT RAISE(ABORT,'KANATA_AUDIT_SENDER_DENIED') WHERE NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=json_extract(NEW.next_json,'$.conversationId') AND participant_id=json_extract(NEW.next_json,'$.senderId') AND kind=json_extract(NEW.next_json,'$.senderType')); END;

CREATE TRIGGER event_audits_insert BEFORE INSERT ON event_audits BEGIN SELECT RAISE(ABORT,'KANATA_INVALID_AUDIT_REVISION') WHERE json_extract(NEW.previous_json,'$.id') IS NOT NEW.event_id OR json_extract(NEW.previous_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.previous_json,'$.revision') IS NOT NEW.previous_revision OR json_extract(NEW.next_json,'$.id') IS NOT NEW.event_id OR json_extract(NEW.next_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.next_json,'$.revision') IS NOT NEW.next_revision OR NEW.next_revision>(SELECT revision FROM world_events WHERE world_id=NEW.world_id AND id=NEW.event_id); END;

CREATE TRIGGER event_audits_update BEFORE UPDATE ON event_audits BEGIN SELECT RAISE(ABORT,'KANATA_INVALID_AUDIT_REVISION') WHERE json_extract(NEW.previous_json,'$.id') IS NOT NEW.event_id OR json_extract(NEW.previous_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.previous_json,'$.revision') IS NOT NEW.previous_revision OR json_extract(NEW.next_json,'$.id') IS NOT NEW.event_id OR json_extract(NEW.next_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.next_json,'$.revision') IS NOT NEW.next_revision OR NEW.next_revision>(SELECT revision FROM world_events WHERE world_id=NEW.world_id AND id=NEW.event_id); END;

CREATE TRIGGER event_causes_cycle_insert AFTER INSERT ON event_causes BEGIN SELECT RAISE(ABORT,'KANATA_EVENT_CAUSAL_CYCLE') WHERE EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.cause_event_id UNION SELECT c.cause_event_id FROM event_causes c JOIN ancestors a ON c.event_id=a.id WHERE c.world_id=NEW.world_id) SELECT 1 FROM ancestors WHERE id=NEW.event_id); END;

CREATE TRIGGER memory_links_cycle_insert AFTER INSERT ON memory_links BEGIN SELECT RAISE(ABORT,'KANATA_MEMORY_SHARE_CYCLE') WHERE NEW.kind='shared' AND EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.target_memory_id UNION SELECT l.target_memory_id FROM memory_links l JOIN ancestors a ON l.memory_id=a.id WHERE l.world_id=NEW.world_id AND l.kind='shared') SELECT 1 FROM ancestors WHERE id=NEW.memory_id); END;

CREATE TRIGGER event_causes_cycle_update AFTER UPDATE ON event_causes BEGIN SELECT RAISE(ABORT,'KANATA_EVENT_CAUSAL_CYCLE') WHERE EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.cause_event_id UNION SELECT c.cause_event_id FROM event_causes c JOIN ancestors a ON c.event_id=a.id WHERE c.world_id=NEW.world_id) SELECT 1 FROM ancestors WHERE id=NEW.event_id); END;

CREATE TRIGGER memory_links_cycle_update AFTER UPDATE ON memory_links BEGIN SELECT RAISE(ABORT,'KANATA_MEMORY_SHARE_CYCLE') WHERE NEW.kind='shared' AND EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.target_memory_id UNION SELECT l.target_memory_id FROM memory_links l JOIN ancestors a ON l.memory_id=a.id WHERE l.world_id=NEW.world_id AND l.kind='shared') SELECT 1 FROM ancestors WHERE id=NEW.memory_id); END;

-- migration 2: kanata-access-indexes

CREATE INDEX lorebook_known_by_reverse ON lorebook_known_by(world_id,participant_id,entry_id);

CREATE INDEX memory_known_by_reverse ON memory_known_by(world_id,instance_id,memory_id);

CREATE INDEX event_participants_reverse ON event_participants(world_id,participant_id,event_id);

CREATE INDEX event_causes_reverse ON event_causes(world_id,cause_event_id,event_id);

CREATE INDEX relationship_events_reverse ON relationship_events(world_id,event_id,relationship_id);

CREATE INDEX memory_events_reverse ON memory_events(world_id,event_id,memory_id);

CREATE INDEX task_result_events_reverse ON task_result_events(world_id,event_id,task_id);

CREATE INDEX task_result_memories_reverse ON task_result_memories(world_id,memory_id,task_id);

CREATE INDEX memory_sources_reverse ON memory_sources(world_id,message_id,memory_id);

CREATE INDEX event_sources_reverse ON event_sources(world_id,message_id,event_id);

CREATE INDEX task_sources_reverse ON task_sources(world_id,message_id,task_id);

CREATE INDEX memory_sources_by_message ON memory_sources(world_id,message_id,message_revision);

CREATE INDEX event_sources_by_message ON event_sources(world_id,message_id,message_revision);

CREATE INDEX task_sources_by_message ON task_sources(world_id,message_id,message_revision);

CREATE INDEX message_life_sources_by_grant ON message_life_sources(world_id,grant_id,grant_revision);

CREATE INDEX memory_life_sources_by_grant ON memory_life_sources(world_id,grant_id,grant_revision);

CREATE INDEX event_life_sources_by_grant ON event_life_sources(world_id,grant_id,grant_revision);

CREATE INDEX message_audits_by_owner ON message_audits(world_id,message_id,at,id);

CREATE INDEX event_audits_by_owner ON event_audits(world_id,event_id,at,id);

CREATE UNIQUE INDEX memory_single_parent ON memory_links(world_id,memory_id,kind) WHERE kind IN ('shared','superseded');

CREATE INDEX messages_scope_time ON messages(world_id,conversation_id,created_at DESC,id DESC);

CREATE INDEX messages_by_sender ON messages(world_id,sender_id,created_at,id);

CREATE INDEX messages_replies ON messages(world_id,conversation_id,reply_to_message_id);

CREATE INDEX participants_by_member ON conversation_participants(world_id,participant_id,conversation_id);

CREATE INDEX instances_by_card ON character_instances(card_id,card_version_id);

CREATE INDEX memories_owner_status ON memories(world_id,owner_type,owner_id,status,layer);

CREATE INDEX memories_conversation ON memories(world_id,conversation_id,status);

CREATE INDEX lorebook_owner ON lorebook_entries(world_id,scope,owner_id,enabled,priority);

CREATE INDEX events_effective ON world_events(world_id,status,effective_at,id);

CREATE INDEX effects_by_event ON world_effects(world_id,event_id);

CREATE INDEX effects_by_target ON world_effects(world_id,target_type,target_id,path);

CREATE INDEX tasks_due ON background_tasks(world_id,state,not_before,id);

CREATE INDEX tasks_conversation ON background_tasks(world_id,conversation_id,instance_id,kind,state);

CREATE INDEX usage_conversation_time ON usage_events(world_id,conversation_id,started_at,id);

CREATE INDEX usage_instance_time ON usage_events(world_id,instance_id,started_at,id);

CREATE INDEX schedules_instance ON virtual_schedules(world_id,instance_id,start_minute,end_minute);
