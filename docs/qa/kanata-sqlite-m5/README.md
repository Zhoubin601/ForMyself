# Kanata SQLite M5 Synthetic Acceptance

- Status: **PENDING AUTOMATED RUN**
- Baseline: `9bfff0867b4024d8d3a2aea2787ac2493164810b`
- Branch: `m5/json-archive-migration`
- Scope: synthetic fixture only; no real user data.

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
