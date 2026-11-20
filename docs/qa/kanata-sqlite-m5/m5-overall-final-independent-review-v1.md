# Kanata SQLite M5 Overall Final Independent Review

**Task ID:** `KANATA-M5-FINAL-AUDIT-2026-11-20`\
**Auditor:** GPT-6 Independent Technical Audit\
**Audit date:** 2026-11-20\
**Audit mode:** Read-only\
**Decision:** **PASS**\
**Closeout recommendation:** M5 may be marked `CLOSED` after explicit
owner authorization.\
**Audited repository:** https://github.com/Zhoubin601/ForMyself\
**Audited branch:** `m5/json-archive-migration`\
**Audited commit:** `4913ef68ec99bb49b7da611400855fe5f88fa52d`

> This sign-off applies to the M5 synthetic migration and acceptance
> scope at the exact SHA above. It does not authorize production storage
> switching, real-user-data migration, old-file cleanup, APK release, or
> any M6/M7 activity.

------------------------------------------------------------------------

## 1. Executive decision

### 1.1 Final conclusion

**M5 Overall: PASS.**

The reviewed implementation and available acceptance evidence satisfy
the M5 synthetic migration requirements:

-   The migration path maps 43 logical collections, including the
    archive-message stream, into a 50-table target verification set.
-   The migration journal, per-batch transaction boundary, cursor
    update, and manifest update are atomic.
-   Resume, retry, idempotency, source-fingerprint rejection, target
    preflight, foreign-key checks, and integrity checks are implemented
    and covered by tests.
-   M5-05 uses the existing encrypted Kanata Repository and archive
    Repository code paths through a synthetic read-only source adapter.
-   M5-06 records successful Android SQLCipher execution on a
    Windows/WHPX Android emulator, including 50-table receipts, four
    process-kill recovery points, negative cases, and capacity runs.
-   The production Store remains on the legacy Repository. Schema
    001--005 and schema version 5 are unchanged. The ordinary SQL
    catalog remains on its default build path.
-   The final SHA has a successful GitHub Actions Web CI run.

No unresolved Blocker, High, or Medium issue was found.

### 1.2 Accepted Low risks

The following Low risks remain documented and do not block M5 closeout:

1.  `run-android.mjs` can throw a raw `TypeError` when the manifest
    lacks `sdk`; the exception occurs before any ADB command or
    destructive operation.
2.  `verify-remediation-evidence.mjs` omits several cross-field checks
    and can accept internally inconsistent evidence if the unvalidated
    fields are altered. The current committed evidence was independently
    cross-checked and is internally consistent.
3.  The Android CI job exclusion is push-branch-specific; a future pull
    request originating from the M5 branch would not be excluded by the
    current `github.ref` condition. No M5 pull request currently exists.
4.  Several relation mappings have no non-empty positive fixture case,
    including event replacements, memory links, relationship events, and
    task social participants. The mapping code and schema constraints
    were reviewed; no implementation defect was found.
5.  Original local APK and raw Android logs are not committed to GitHub.
    GPT-6 could not re-hash or replay those local artifacts.
6.  The 100k host-side independent row comparison covers 47 of 50
    tables; the Android SQLCipher target receipt covers all 50 tables.

These are reproducibility, test-coverage, or QA-tool hardening items.
They do not establish a current data-loss or production-isolation
defect.

### 1.3 What this audit did not do

-   No business code, schema, CI workflow, or production configuration
    was modified.
-   No local Node test suite was re-executed by GPT-6. GitHub Actions
    logs were inspected directly.
-   No Android emulator or physical device was started, modified, or
    tested by GPT-6.
-   No APK was built, installed, released, or published by GPT-6.
-   No production database, user data, canonical pointer, or legacy file
    was accessed.
-   No branch was merged, no commit was pushed, and no `CLOSED` status
    was written.

The Android execution conclusion is therefore an evidence-based review
of the committed machine record, QA runner implementation,
instrumentation source, and prior local review record---not a claim that
GPT-6 personally reran the emulator.

------------------------------------------------------------------------

## 2. Audit baseline and repository state

### 2.1 Immutable baseline

  --------------------------------------------------------------------------------
  Item                                Value
  ----------------------------------- --------------------------------------------
  Repository                          `Zhoubin601/ForMyself`

  Branch                              `m5/json-archive-migration`

  Branch HEAD                         `4913ef68ec99bb49b7da611400855fe5f88fa52d`

  Audited SHA                         `4913ef68ec99bb49b7da611400855fe5f88fa52d`

  Parent of audited SHA               `b695226e...`

  M5 original baseline                `9bfff0867b4024d8d3a2aea2787ac2493164810b`

  M5-06 remediation implementation    `97718ee6a4067a479e4ebe285778876d835c95fa`
  --------------------------------------------------------------------------------

The branch ref resolves to the exact requested SHA. The final commit is
a documentation closeout commit whose parent is `b695226`; its changes
are the overall closeout report and QA README update. The M5-06
remediation implementation SHA is an ancestor of the final audited SHA.
The comparison from `97718ee6` to the final SHA contains documentation
changes, not subsequent business-code changes.

GitHub repository metadata, branch ref, commit metadata, recursive tree,
target documents, source files, and Actions runs were accessible.

**Repository visibility and governance notes:**

-   The repository is public.
-   The M5 branch is not protected by GitHub branch protection.
-   No open pull request from `m5/json-archive-migration` was found.
-   No M5 release was found.
-   The audited commit is unsigned. The content SHA pins the audited
    tree, but the commit does not provide a cryptographic author
    signature.
-   GitHub does not expose Hydrogen's local working-tree cleanliness.
    This audit confirms the remote branch ref, not a local workstation
    status.

### 2.2 Repository structure inspected

The relevant repository areas are:

``` text
.github/workflows/
android/app/
docs/
  20261120-kanata-sqlite-m5-overall-closeout-v1.md
  20261118-kanata-sqlite-m5-migration-task-v1.md
  20261118-kanata-sqlite-m5-05-encrypted-source-integration-task-v1.md
  20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md
  qa/kanata-sqlite-m5/
scripts/
src/
  application/
  features/chat/storage/sqlite/
  platform/security/
  platform/storage/
tests/
  helpers/
```

### 2.3 GitHub Actions evidence

Two Actions runs were independently inspected:

  -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  Run                                                                              Head SHA                                     Web job           Android job
  -------------------------------------------------------------------------------- -------------------------------------------- ----------------- -----------------
  [#127 ---                                                                        `97718ee6a4067a479e4ebe285778876d835c95fa`   success           skipped
  44463304279](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279)                                                                  

  [#148 ---                                                                        `4913ef68ec99bb49b7da611400855fe5f88fa52d`   success           skipped
  44697060149](https://github.com/Zhoubin601/ForMyself/actions/runs/44697060149)                                                                  
  -----------------------------------------------------------------------------------------------------------------------------------------------------------------

The final SHA run #148 log confirms:

-   Node test suite: **791 passed, 0 failed**.
-   Vitest: **420 passed across 45 files**.
-   ESLint: **0 errors**, 61 warnings.
-   Type checks: passed.
-   Vite production build: passed.

The Combined Status API returned no status contexts. The Actions run and
job logs---not the empty Combined Status response---are used as the CI
evidence.

**Important distinction:** neither #127 nor #148 ran Android
instrumentation in GitHub Actions. The Android job was skipped. Android
SQLCipher evidence is a separate local Windows/WHPX emulator run
recorded in the M5-06 machine evidence.

------------------------------------------------------------------------

## 3. Files reviewed

### 3.1 Required closeout and task documents

-   [Overall
    closeout](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261120-kanata-sqlite-m5-overall-closeout-v1.md)
-   [M5 QA
    README](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/README.md)
-   [M5-06 final independent
    review](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/m5-06-final-independent-review-v1.md)
-   [M5-06
    closeout](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261119-kanata-sqlite-m5-06-closeout-v1.md)
-   [M5-01--04 migration
    task](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261118-kanata-sqlite-m5-migration-task-v1.md)
-   [M5-05 encrypted source
    task](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261118-kanata-sqlite-m5-05-encrypted-source-integration-task-v1.md)
-   [M5-06 Android SQLCipher
    task](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261118-kanata-sqlite-m5-06-android-sqlcipher-synthetic-acceptance-task-v1.md)

### 3.2 Migration implementation and tests

-   `src/features/chat/storage/sqlite/kanataDataMigrator.js`
-   `src/features/chat/storage/sqlite/kanataDataMigrationRows.js`
-   `src/features/chat/storage/sqlite/kanataMigrationCoordinator.js`
-   `src/features/chat/storage/sqlite/kanataMigrationTypes.d.ts`
-   `src/features/chat/storage/sqlite/kanataSchema.js`
-   `src/features/chat/storage/sqlite/kanataSchemaMigrator.js`
-   `tests/kanataSqliteDataMigration.test.js`
-   `tests/kanataSqliteMigration.test.js`
-   `tests/helpers/kanataSqliteFixture.js`
-   `tests/helpers/kanataSqliteHarness.js`

### 3.3 M5-05 encrypted source integration

-   `tests/helpers/kanataSqliteEncryptedLegacySource.js`
-   `tests/kanataSqliteEncryptedLegacySource.test.js`
-   `src/features/chat/storage/kanataRepository.js`
-   `src/features/chat/storage/messageArchiveRepository.js`

### 3.4 M5-06 Android QA and evidence

-   `docs/qa/kanata-sqlite-m5/run-android.mjs`
-   `docs/qa/kanata-sqlite-m5/runner-guard.mjs`
-   `docs/qa/kanata-sqlite-m5/device.mjs`
-   `docs/qa/kanata-sqlite-m5/catalog.mjs`
-   `docs/qa/kanata-sqlite-m5/fixture.mjs`
-   `docs/qa/kanata-sqlite-m5/evidence.mjs`
-   `docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs`
-   `docs/qa/kanata-sqlite-m5/m5-06-evidence-v1.json`
-   `docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json`
-   `docs/qa/kanata-sqlite-m5/androidTest/com/yubin/formyself/KanataM5CipherTest.java`
-   `tests/kanataM506Remediation.test.js`

### 3.5 Production isolation, native driver, build and CI

-   `src/application/kanataRuntime.js`
-   `src/features/chat/kanataStore.js`
-   `src/application/kanataSqliteCandidate.js`
-   `src/platform/storage/androidKanataSqliteDriver.js`
-   `src/platform/security/kanataSqliteKek.js`
-   `android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java`
-   `android/app/build.gradle`
-   `scripts/build-kanata-sqlite-catalog.mjs`
-   `.github/workflows/quality.yml`

------------------------------------------------------------------------

## 4. Stage B --- M5-01 to M5-04 migration engine

**Conclusion: PASS, with Low test-coverage observations.**

### 4.1 Collection and table mapping

The data migration path contains 42 base collection factories plus the
archive-message stream when archive descriptors are present, yielding 43
logical collections for the audited fixture.

The migration verification set contains 50 target tables:

-   49 tables receive mapped or trigger-generated data.
-   `domain_command_receipts` has no legacy JSON source and is expected
    to remain empty.
-   The final verifier checks this table's row count rather than
    silently omitting it.

The table set includes domain tables, relation tables, trigger-generated
`entity_ids`, `participants`, and the event/effect/baseline array-order
tables.

Relevant implementation:

-   `kanataDataMigrationRows.js`: collection definitions and row
    mapping.
-   `kanataDataMigrator.js`: target-table plan, journal and
    verification.
-   [Migration row
    mapping](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/src/features/chat/storage/sqlite/kanataDataMigrationRows.js)
-   [Migration
    engine](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/src/features/chat/storage/sqlite/kanataDataMigrator.js)

### 4.2 Foreign-key dependency order

The collection order is consistent with the target schema's foreign-key
relationships:

-   Worlds and their world identities are inserted in the same
    source-item transaction; deferred constraints allow the parent row
    to reference the identity row inserted in that transaction.
-   Cards and card versions are created in a compatible order.
-   Instances and conversations are available before dependent records.
-   Events are inserted before event causes, event participants, event
    sources, event replacements, and relationship-event links.
-   Memories are inserted before memory links and memory-event
    relations.
-   Tasks are inserted before task source, result, and
    social-participant relations.
-   Life grants are available before life-source relations.
-   Archived messages are imported through the archive stream, and
    archive marks are written with the message batch.

The schema uses deferred foreign keys where same-transaction
parent/child ordering requires them. Final `foreign_key_check` catches
unresolved references.

### 4.3 Transaction, journal and cursor atomicity

The main data migrator implements its own specialized journal loop. It
does not delegate to the separate generic
`kanataMigrationCoordinator.js`; that file is an independently tested
generic coordinator slice.

The main migrator:

1.  Preflights schema version, application ID, foreign-key enforcement,
    existing journal state, source fingerprint, and all 50 target-table
    counts.
2.  Rejects a non-empty target when no valid migration journal exists.
3.  Writes each batch and updates the collection cursor, imported count,
    and manifest in the same transaction.
4.  Uses prior cursor/imported-count/source state in conditional updates
    to detect concurrent or unexpected journal changes.
5.  Rolls back the current batch if a write, cursor update, cancellation
    check, or manifest update fails.
6.  Marks the collection failed outside the rolled-back batch
    transaction.
7.  Resumes from the last committed cursor.
8.  Revalidates a completed migration rather than blindly returning
    success.

The configured message/archive batch limit is 50. The archive reader
keeps a bounded page cache and validates each page when read.

Relevant locations:

-   `kanataDataMigrator.js` around lines 231--260: preflight.
-   `kanataDataMigrator.js` around lines 285--344: transactional batch
    and journal update.
-   `kanataDataMigrator.js` around lines 350--415: target verification.
-   `kanataDataMigrationRows.js`: archive collection and row mapping.

### 4.4 Source fingerprint and recovery

The source fingerprint binds the primary encrypted-source fingerprint,
data version, and archive descriptor metadata. Archive page reads are
validated against their descriptors again during import.

A changed source fingerprint on retry is rejected. A recovered source,
pending save/recovery state, missing source, invalid archive descriptor,
wrong credentials, or corrupted archive page fails closed rather than
becoming an empty dataset.

### 4.5 Integrity and idempotency

The final verification checks:

-   All 50 target tables.
-   Row counts and exact value digests for mapped/trigger-generated
    rows.
-   Event replacement count and digest separately from the ordinary
    `world_events` insert digest.
-   Foreign-key violations.
-   SQLite integrity.
-   Dataset identity and schema version.
-   Journal collection states and manifest completion.

The manifest is an internal consistency receipt: it proves that the
committed target rows match the values emitted by the mapper. It does
not, by itself, independently prove that every source-to-target semantic
mapping is correct. That second question is addressed through code
review and explicit fixture assertions.

### 4.6 Mapping and test-coverage observations

No mapping defect was found in the reviewed implementation. The
following positive-case coverage is limited:

-   `event_replacements` has a mapping and a dedicated final
    verification digest, but the current fixture contains no replacement
    edge.
-   `memory_links`, `relationship_events`, and
    `task_social_participants` are present in the target plan and
    mapping code, but their final smoke counts are zero.
-   The fixture has two world events in the final smoke, exercising
    event-array ordinal 0 and 1. It has only one world effect and one
    effect baseline, so those two array-order tables do not exercise
    ordinal greater than zero.
-   Top-level unknown entity fields are preserved through the `known()`
    helper and `extensions_json`; explicit fixture assertions cover
    world, message, and memory extensions. This is not a per-entity-type
    positive test.
-   The task contract is entity-level extension preservation. Dataset
    metadata and role-binding singleton rows use empty extension
    objects; nested unknown keys inside typed subobjects are not
    recursively preserved. No unsupported nested field in the declared
    v1/v2 contract was found in the reviewed fixtures.

These are Low test-coverage/contract-boundary observations. The relation
mapping code, SQL constraints, and final integrity checks were reviewed;
no evidence of current silent loss was found.

------------------------------------------------------------------------

## 5. Stage C --- M5-05 encrypted legacy source integration

**Conclusion: PASS.**

The test adapter uses the existing Kanata Repository and message-archive
Repository implementations, together with the real encryption/decryption
code paths. It does not substitute a second plaintext parser or a mock
cryptographic implementation.

The synthetic fixture uses an injected in-memory filesystem and journal.
After fixture creation, the adapter seals the source and permits only
read operations. The test wrapper rejects write, rename, and delete
calls and compares source-file/journal bytes before and after the
migration.

The committed remediation evidence records:

-   Primary ciphertext hash unchanged.
-   Archive ciphertext aggregate hash unchanged.
-   Recovery-journal hash unchanged.
-   Two archive descriptors.
-   Read operations only.
-   `write=0`, `rename=0`, `delete=0`.

The test cases cover successful encrypted reads, archive page reads,
wrong credentials, archive-password mismatch, malformed/corrupt/missing
archive pages, recovered source, pending save/recovery state,
cancellation, and failure/retry behavior.

The source adapter exposes read operations to the migrator; it does not
expose a source-write method. Archive inspection and archive reads use
the existing repository path.

**Evidence boundary:** this is a real encrypted Repository integration
test using synthetic in-memory files. It is not a test against real user
files or a production filesystem adapter, and M5 does not claim
production cutover.

------------------------------------------------------------------------

## 6. Stage D --- M5-06 Android SQLCipher synthetic acceptance

**Conclusion: PASS on committed machine evidence; not independently
replayed by GPT-6.**

### 6.1 Actual execution environment

The remediation evidence records:

-   Windows host with WHPX emulator.
-   Android API 34 / Android 14 AVD.
-   SQLCipher Android 4.17.0.
-   QA package isolated with the `.m2qa` application ID suffix.
-   Candidate database under the QA application's `noBackupFilesDir`.
-   Native plugin and instrumentation execution.

This was an Android emulator run, **not a physical-device test**.

The Android runner opens the actual native SQLCipher driver and performs
migration and verification through the Capacitor/native plugin.
`KanataM5CipherTest` verifies correct-key access, wrong-key rejection,
plaintext SQLite rejection, and closed-handle behavior. The native
plugin uses the packaged SQL statement catalog and rejects statements
outside its allowlist.

### 6.2 50-table and causality evidence

The final remediation evidence contains 50 table receipts. The smoke
dataset has:

-   55 messages, including 53 archived messages.
-   2 worlds and 2 world identities.
-   180 `entity_ids`.
-   12 participants.
-   2 world events.
-   1 `event_causes` edge.
-   2 event-array-order rows.
-   1 world effect and 1 effect baseline.
-   1 effect-array-order row and 1 baseline-array-order row.

The four empty tables are:

-   `memory_links`
-   `relationship_events`
-   `task_social_participants`
-   `domain_command_receipts`

The first three are empty because the synthetic fixture does not contain
those relations. `domain_command_receipts` is intentionally empty
because there is no legacy JSON source for it.

The `eventCausesHostOracle` count and row hash match the smoke
causal-field hash, and its table hash matches the `event_causes` table
receipt.

### 6.3 Four process-kill recovery points

The machine evidence records four kill points:

1.  `before-first-commit`
2.  `during-batch`
3.  `after-batch-commit`
4.  `before-verification`

For each point, the evidence records old PID exit, CDP disconnection,
unchanged source receipt, candidate DB identity, post-restart
verification, and repeated already-complete behavior. The candidate
database path/inode/package identity is consistent before and after
restart. Each recovered receipt contains all 50 table proofs.

The runner performs a cleanup force-stop and records successful exit and
PID disappearance.

### 6.4 Negative cases

The final evidence records rejection of:

-   Wrong SQLCipher key.
-   Changed source fingerprint.
-   Non-empty target.
-   Corrupt archive page.
-   Recovered source.

The failures do not proceed as successful migrations.

### 6.5 Capacity runs

  -----------------------------------------------------------------------
    Synthetic       Total     DB size    Peak RSS     Message   Max batch
      message     elapsed                             batches 
        count                                                 
  ----------- ----------- ----------- ----------- ----------- -----------
        1,000     16.79 s    2.01 MiB   424.6 MiB          21          50

       10,000    109.92 s   11.72 MiB   421.6 MiB         201          50

      100,000    912.31 s  109.91 MiB   561.5 MiB       2,001          50
  -----------------------------------------------------------------------

For the 100k run, recorded message-batch timing was min 55.4 ms, mean
410.1 ms, max 1,805 ms. The 100k native target receipt covers all 50
tables. The independent host-side row comparison covers 47 of 50 tables,
with the remaining high-volume table counts separately recorded. The
task did not define a strict M5 time/RSS threshold; the 100k run
completed.

### 6.6 Catalog and artifact cross-checks

The remediation JSON records:

-   Ordinary catalog: 723 statements.
-   M5 QA catalog: 954 statements.
-   Ordinary catalog byte-identical flag: true.
-   SQLite schema version: 5.
-   SQLite application ID: `1263424577` (`0x4b4e5441`).
-   Schema journal entries for versions 1--5.

GPT-6 independently checked the current JSON cross-fields:

-   Each run's catalog SHA matches the top-level QA catalog SHA.
-   Each run's app/test APK SHA matches the top-level app/test APK SHA.
-   Each run's catalog artifact SHA matches the top-level QA catalog
    SHA.
-   Artifact sets are consistent across runs.
-   All four interruption table proofs equal the smoke table proof.
-   All capacity proofs contain 50 tables.
-   The event-causality host oracle matches the smoke causal hash and
    table hash.
-   All recorded min/mean/max timing relationships are ordered
    correctly.
-   Source before/after hashes match and source write/rename/delete
    counters are zero.
-   All three run exits are zero and cleanup reports PID gone.

These checks were performed independently against the committed JSON.
GPT-6 did not execute the remediation verifier itself.

### 6.7 Evidence limits

The GitHub tree contains the Markdown reports and JSON evidence, but no
M5 APK or raw Android log files. The evidence JSON records their hashes
and run metadata. A prior review record states that local artifacts were
retained, but those files were not supplied to GPT-6 and could not be
re-hashed here.

Accordingly:

-   The Android result is accepted as committed machine evidence
    supported by source review and cross-field checks.
-   GPT-6 does not claim to have independently replayed the AVD run or
    inspected the original APK bytes.
-   The emulator result must not be described as a physical-device
    result.
-   The initial `m5-06-evidence-v1.json` is a historical pre-remediation
    `BLOCKED` snapshot. The final evidence for this audit is
    `m5-06-remediation-evidence-v1.json`.

------------------------------------------------------------------------

## 7. Stage E --- Overall production and security boundary

**Conclusion: PASS. No production storage switch or real-user-data
migration was found.**

### 7.1 Schema and application identity

-   Schema migrations 001--005 are unchanged relative to the M5
    baseline.
-   `KANATA_SCHEMA_VERSION` remains 5.
-   SQLite `application_id` remains `0x4b4e5441` / `1263424577`.
-   No schema 006 migration was introduced by M5.
-   The schema migrator validates schema journal checksums and schema
    objects.

### 7.2 Store, Repository and canonical

The production runtime continues to create/use the legacy Kanata
Repository through `kanataStore.js` and `kanataRuntime.js`.

The SQLite candidate path remains explicitly synthetic-only, and the
canonical storage designation remains `legacy`. The M5 data migrator is
not imported by the production runtime Store or Repository path.

The following files are unchanged from the M5 baseline:

-   `src/features/chat/kanataStore.js`
-   `src/features/chat/storage/kanataRepository.js`
-   `src/features/chat/storage/messageArchiveRepository.js`
-   `src/application/kanataRuntime.js`
-   `src/application/kanataSqliteCandidate.js`
-   `src/features/chat/storage/sqlite/kanataSchema.js`
-   `src/features/chat/storage/sqlite/kanataSchemaMigrator.js`

### 7.3 Android build and SQL catalog isolation

-   The M5 catalog path requires the explicit synthetic build flags.
-   M5 synthetic mode requires the M2 synthetic mode.
-   M5 synthetic mode disables release variants.
-   The native plugin activation gate requires the synthetic BuildConfig
    flag and QA package identity.
-   The ordinary build path remains the default path.
-   The evidence records 723 ordinary SQL statements and 954 M5 QA
    statements; the build-script change is conditional and additive.

The ordinary catalog SHA and byte-identical claim are recorded in the
machine evidence. GPT-6 reviewed the build-script gating and diff but
did not regenerate the catalog locally.

### 7.4 Data and release boundaries

No evidence was found of:

-   Production Store switching to SQLite.
-   Canonical pointer switching away from legacy.
-   Real user-data migration.
-   Legacy source-file deletion or cleanup.
-   Production database replacement.
-   APK release or M5 release publication.

The local QA runner builds/installs a synthetic debug APK in an isolated
AVD package as part of M5-06 acceptance. That is distinct from a
production release.

------------------------------------------------------------------------

## 8. Stage F --- Independent risk reassessment

  --------------------------------------------------------------------------------------
  ID                Severity          Independent assessment           M5 disposition
  ----------------- ----------------- -------------------------------- -----------------
  L-REV-01 ---      Low               Missing `sdk` can cause a raw    Accepted;
  Manifest `sdk`                      `TypeError` at                   normalize
  input boundary                      `path.join(manifest.sdk, ...)`   manifest
                                      before the runner guard. No ADB  validation before
                                      command or destructive action    path
                                      has occurred at that point.      construction.
                                      Fail-closed behavior remains     
                                      intact.                          

  L-REV-02 ---      Low               The verifier validates           Accepted for M5
  Evidence verifier                   individual table proofs but does because the
  cross-check gaps                    not cross-check interruption     current JSON was
                                      proofs against smoke, catalog    independently
                                      against run artifacts,           cross-checked and
                                      `eventCausesHostOracle`,         is consistent.
                                      `issues`, CI state, or           Harden before
                                      min/mean/max ordering. It can    reusing the
                                      therefore return `verified=true` verifier for M6
                                      for some internally inconsistent or later
                                      records.                         acceptance.

  L-REV-03 ---      Resolved          The evidence JSON retains        Closed by later
  Historical CI                       `ci=NOT RUN` and `B-01=BLOCKED`  same-SHA Web CI
  snapshot timing                     from its creation time. Later    evidence.
                                      run #127 passed on the exact     Preserve the old
                                      implementation SHA `97718...`;   snapshot as
                                      run #148 passed on final SHA     history.
                                      `4913...`.                       

  L-REV-04 ---      Low               `quality.yml` excludes Android   Accepted; tighten
  Pull-request                        when `github.ref` equals the M5  the condition
  Android exclusion                   branch ref. For a pull request,  before any
                                      `github.ref` is                  M5-originating
                                      `refs/pull/.../merge`, so an     PR.
                                      M5-originating PR would run the  
                                      Android job. No M5 PR currently  
                                      exists; default PR build flags   
                                      do not enable the M5 synthetic   
                                      catalog.                         

  L-REV-05 ---      Low               Event replacements, memory       Accepted for
  Positive relation                   links, relationship events, and  synthetic M5
  fixture coverage                    task social participants have no closeout; add
                                      non-empty positive fixture case. positive cases
                                      Effect and baseline order tables before production
                                      have only one row each. Mapping  migration use.
                                      code and schema constraints were 
                                      reviewed without finding a       
                                      defect.                          

  EVID-01 --- Local Low               APK and raw logs are not in the  Accepted with
  APK/raw logs                        Git tree. JSON hashes and a      explicit evidence
  unavailable to                      prior review record exist, but   limitation.
  GPT-6                               GPT-6 could not re-hash the      
                                      local artifacts.                 

  EVID-02 --- 100k  Low               Host-side row comparison covers  Accepted; no M5
  host comparison                     47/50 tables; Android SQLCipher  capacity failure
  partial                             target receipt covers all 50.    found.
  --------------------------------------------------------------------------------------

### 8.1 No unresolved Medium or higher issue

No evidence of a current Blocker, High, or Medium defect was found in
the M5 implementation or isolation boundary.

The Low items above are not silently discarded. They should remain
visible in the closeout record, and the verifier/fixture improvements
should be completed before any later production migration acceptance
that depends on them.

------------------------------------------------------------------------

## 9. Stage G --- Final sign-off

### 9.1 M5 sub-stage decisions

  -----------------------------------------------------------------------
  Stage                   Decision                Basis
  ----------------------- ----------------------- -----------------------
  M5-01 --- Mapping and   PASS                    Collection mapping,
  migration foundation                            target plan, typed
                                                  rows, schema and base
                                                  fixtures reviewed.

  M5-02 --- Transaction,  PASS                    Atomic batch/journal
  journal and cursor                              updates, rollback,
                                                  cursor resume and
                                                  source-fingerprint
                                                  rejection reviewed and
                                                  covered by passing
                                                  tests.

  M5-03 --- Recovery and  PASS                    Fail-closed preflight,
  idempotency                                     repeated migration
                                                  verification, recovery
                                                  and tamper cases
                                                  covered.

  M5-04 --- 50-table      PASS                    50-table target
  integrity verification                          receipts, digests, FK
                                                  check and integrity
                                                  check reviewed.

  M5-05 --- Encrypted     PASS                    Existing encrypted
  legacy source                                   Repository/archive
  integration                                     paths, source read-only
                                                  guard,
                                                  failure/cancellation
                                                  tests.

  M5-06 --- Android       PASS                    Committed emulator
  SQLCipher synthetic                             evidence, 50-table
  acceptance                                      receipts, four
                                                  kill/recovery points,
                                                  negative cases and
                                                  capacity data
                                                  cross-checked.
  -----------------------------------------------------------------------

### 9.2 Final answer

**Kanata SQLite M5 is eligible for formal `CLOSED` status.**

**Final independent decision: `PASS`.**

This is a scope-limited M5 sign-off. It does not authorize production
storage switching, real-user-data migration, old-file cleanup, APK
release, physical-device acceptance, or M6/M7 implementation.

### 9.3 Recommended documentation changes after authorization

1.  Add this report as
    `docs/qa/kanata-sqlite-m5/m5-overall-final-independent-review-v1.md`.
2.  Update `docs/qa/kanata-sqlite-m5/README.md` from
    `READY_FOR_CLOSEOUT` to `CLOSED`, recording:
    -   Auditor: GPT-6
    -   Decision: PASS
    -   Audited SHA: `4913ef68ec99bb49b7da611400855fe5f88fa52d`
    -   CI run: `44697060149`
3.  Add a short independent-signoff section to
    `docs/20261120-kanata-sqlite-m5-overall-closeout-v1.md`.
4.  Record L-REV-03 as resolved by the later same-SHA CI run; retain the
    original JSON and old status snapshots as historical evidence.
5.  Record L-REV-01, L-REV-02, L-REV-04, L-REV-05, EVID-01 and EVID-02
    as accepted Low risks with their follow-up notes.
6.  Do not change business code, Schema 001--005, production
    configuration, canonical storage, or historical machine evidence as
    part of the closeout documentation update.
7.  After the documentation-only commit is authorized and pushed, rerun
    Web CI on the new final SHA and append its run link.

**No repository state was changed by this audit.** The `CLOSED` update,
documentation commit, and push remain pending explicit owner
authorization.

------------------------------------------------------------------------

## 10. Evidence reference index

-   [Audited
    commit](https://github.com/Zhoubin601/ForMyself/commit/4913ef68ec99bb49b7da611400855fe5f88fa52d)
-   [M5-06 implementation
    commit](https://github.com/Zhoubin601/ForMyself/commit/97718ee6a4067a479e4ebe285778876d835c95fa)
-   [M5-06 same-implementation-SHA Web CI
    #127](https://github.com/Zhoubin601/ForMyself/actions/runs/44463304279)
-   [Final-SHA Web CI
    #148](https://github.com/Zhoubin601/ForMyself/actions/runs/44697060149)
-   [M5 overall closeout
    report](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/20261120-kanata-sqlite-m5-overall-closeout-v1.md)
-   [M5 QA evidence
    index](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/README.md)
-   [Final remediation machine
    evidence](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/m5-06-remediation-evidence-v1.json)
-   [Evidence verifier
    source](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs)
-   [Android runner
    source](https://github.com/Zhoubin601/ForMyself/blob/4913ef68ec99bb49b7da611400855fe5f88fa52d/docs/qa/kanata-sqlite-m5/run-android.mjs)

------------------------------------------------------------------------

**End of independent review.**
