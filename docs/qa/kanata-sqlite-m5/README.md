# Kanata SQLite M5 Synthetic Acceptance

- Status: **BLOCKED — latest Web CI failed; M5 is not accepted**
- Baseline: `9bfff0867b4024d8d3a2aea2787ac2493164810b`
- Branch: `m5/json-archive-migration`
- Scope: synthetic fixture only; no real user data.

## Latest CI checkpoint (2026-11-18)

- Implementation checkpoint: `6a858948ce95c6e9de938c0e19e7eaa2e5bef307`
- [GitHub Actions run 44266119902](https://github.com/Zhoubin601/ForMyself/actions/runs/44266119902): Web job failed in `npm run check`; Android job was skipped by the M5 branch-only workflow guard.
- Failures: M5-01 count mismatch; M5-02 resume count mismatch; M5-04 failure journal remained `pending`; coordinator test imported a symbol from the old module path.
- Do not mark M5 PASS until these failures are fixed and the full check passes.
- Next task: [M5-05 encrypted legacy source integration](../../20261118-kanata-sqlite-m5-05-encrypted-source-integration-task-v1.md).

## Test cases

| Case | Expected evidence |
|---|---|
| M5-01 | Schema 005 empty target; import active + encrypted-page-shaped synthetic history; preserve archive marks, life-source links and unknown JSON extensions; verify every migration table digest, FK and integrity; repeat run without duplicate rows. |
| M5-02 | Inject failure during a two-row archive batch; prove full transaction rollback and unchanged cursor; reject changed source fingerprint; restore fingerprint and resume to complete. |
| M5-03 | Reject recovered and missing sources; reject a non-empty target before creating migration journal rows; reject pending/failed source snapshot flags before target journal creation; reject a wrong SQLite application_id before journal creation. |
| M5-04 | Tamper with archive page content after descriptor index creation; reject the page before writing any message rows. |

## CI safety

On `m5/json-archive-migration`, the Quality workflow runs the web job (`npm run check`) and skips the Android job. No APK is assembled or uploaded by this branch's CI.

## Commands

```bash
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js
npm run check
```

## Acceptance conditions

1. All M5 tests pass.
2. Full project check exits 0.
3. Journal rows end in `complete`; target table counts and exact-value digests match the manifest.
4. `PRAGMA foreign_key_check` is empty and `PRAGMA integrity_check` returns `ok`.
5. The source fixture remains byte-for-byte unchanged.
6. No production Store wiring, storage switch, legacy-file cleanup, APK release, or real-data operation occurs.

This report will be updated with exact CI run/commit evidence after the isolated branch check completes. A passing synthetic suite is not production migration authorization.
