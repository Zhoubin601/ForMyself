# Kanata SQLite M5 Synthetic Acceptance

- Status: **CLOSED — M5 Overall: PASS (GPT-6 Independent Audit PASS on `4913ef68ec99bb49b7da611400855fe5f88fa52d`; synthetic acceptance only).**
- Baseline: `9bfff0867b4024d8d3a2aea2787ac2493164810b`
- Branch: `m5/json-archive-migration`
- Scope: synthetic fixture only; no real user data.

## CI checkpoint and local reproduction (2026-11-18)

- Implementation checkpoint: `6a858948ce95c6e9de938c0e19e7eaa2e5bef307`
- [GitHub Actions run 44266119902](https://github.com/Zhoubin601/ForMyself/actions/runs/44266119902): Web job failed in `npm run check`; Android job was skipped by the M5 branch-only workflow guard.
- Failures: M5-01 count mismatch; M5-02 resume count mismatch; M5-04 failure journal remained `pending`; coordinator test imported a symbol from the old module path.
- The same command on the planning commit `26b5028e7a5bd3ed4bfcc7f3208f8e21efb091d6` reproduced all four failures (3 passed, 4 failed). The import error counted as one failed test file.
- The regression fix is `d963a31b561da8af7596089dd6be8eaba4d07155`. The encrypted source integration and final local test evidence correspond to `8ee4f4bf521ef44a1e3271bc253cf7e5d8d24883`.
- Matching GitHub Web CI for the final implementation SHA passed in [Quality run 44279607211](https://github.com/Zhoubin601/ForMyself/actions/runs/44279607211). The older failed run remains historical evidence only.

## Test cases

| Case | Expected evidence |
|---|---|
| M5-01 | Schema 005 empty target; import active + encrypted-page-shaped synthetic history; preserve archive marks, life-source links and unknown JSON extensions; verify every migration table digest, FK and integrity; repeat run without duplicate rows. |
| M5-02 | Inject failure during a two-row archive batch; prove full transaction rollback and unchanged cursor; reject changed source fingerprint; restore fingerprint and resume to complete. |
| M5-03 | Reject recovered and missing sources; reject a non-empty target before creating migration journal rows; reject pending/failed source snapshot flags before target journal creation; reject a wrong SQLite application_id before journal creation. |
| M5-04 | Tamper with archive page content after descriptor index creation; reject the page before writing any message rows. |
| M5-05 | Use the actual Kanata Repository and encryption code for a v1 main file and a v2 main file with two encrypted history pages. Exercise active and archived message order, page hash and length, Bloom index, descriptor metadata, invalid credentials, malformed payloads, future versions, invalid references, missing or tampered pages, scope errors, recovery, failed saves, cancellation and retry. |

## CI safety

On `m5/json-archive-migration`, the Quality workflow runs the web job (`npm run check`) and skips the Android job. No APK is assembled or uploaded by this branch's CI.

## Commands

```bash
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js
node --test tests/kanataSqliteDataMigration.test.js tests/kanataSqliteMigration.test.js tests/kanataSqliteEncryptedLegacySource.test.js
npm run check
```

## Local evidence

Windows, Node `v24.14.1`, npm `11.11.0`, and in-memory Node SQLite with Schema 005.

| Check | Outcome |
|---|---|
| Original two test files after the regression fix | Exit 0, 10 passed, 0 failed, 0 skipped. |
| Final three test files | Exit 0, 41 passed (31 new M5-05 cases), 0 failed, 0 skipped. |
| Final `npm run check` | Exit 0. ESLint 0 errors / 61 warnings. Node 784 passed, 0 failed, 0 skipped. Vitest 420 passed in 45 files. Both type checks and the Web build passed. |

The local Windows dependency install first hit `EXDEV` in a transitive Sharp prebuild download and could not compile the fallback without a VC++ toolset. A run of the tests while installation was incomplete also failed to load `crypto-js`. The final checks used `npm ci --ignore-scripts --no-audit --no-fund` followed by the repository's `npm run postinstall` to apply the normal Capacitor patches. No dependency files or scripts were changed.

A development check passed 753 Node and 420 component tests, then failed type checking. A concurrent edit had omitted the resume preflight's data parameter. The combined collection type did not yet account for the async archive reader, and the coordinator had not narrowed the SQL journal ID to text. A strict draft importing the checked implementation directly also exposed pre-existing implicit types. The final strict sample checks the option types used by the implementation through `contracts.d.ts`. Two intermediate targeted runs failed (34/39 and 37/39) before the preflight parameter was restored and the target tamper test used a valid revision increment.

Each M5-05 case seals the source after setup and compares every fixture file as UTF-8 bytes plus the original recovery journal value. It records file and journal method calls, permits file reads, stats and the injected archive directory listing, and permits only journal reads. Invalid sources attempt zero target writes. Cancellation during source validation stops further page reads. Cancellation in the second archive batch leaves two committed messages, marks and life-source links and retains the last committed cursor for retry.

Successful imports verify row counts across all 50 migration tables and exact bound-value digests for populated tables, including trigger-created rows, as well as archive marks and extension values. The tests check an empty `PRAGMA foreign_key_check` and `ok` from `PRAGMA integrity_check`. A repeat import performs no target writes, and a same-count change to stored message values is rejected by digest verification.

## Acceptance conditions

1. All M5 tests pass.
2. Full project check exits 0.
3. Journal rows end in `complete`; target table counts and exact-value digests match the manifest.
4. `PRAGMA foreign_key_check` is empty and `PRAGMA integrity_check` returns `ok`.
5. The source fixture remains byte-for-byte unchanged.
6. No production Store wiring, storage switch, legacy-file cleanup, APK release, or real-data operation occurs.

Native SQLCipher, Android/device interruption and capacity checks, and production integration were outside this run. Same-SHA Web CI remains required for the M5-05 task gate. M5 overall remains open.


## M5-05 remote CI closeout (2026-11-18)

- **Result: PASS for M5-05 only.** The pushed branch head and CI head both equal `838635ac6084ecd7e9a02b383c5e79789a8eb472`.
- Push: `26b5028..838635a m5/json-archive-migration -> m5/json-archive-migration`.
- [GitHub Actions Quality run 44279607211](https://github.com/Zhoubin601/ForMyself/actions/runs/44279607211): completed with conclusion `success`; Web job `success`; Android job `skipped` by the M5 branch policy.
- Web job ran `npm run check`; the run is tied to the exact implementation SHA above. Android was intentionally not built or run.
- Remote branch head verified as `838635ac6084ecd7e9a02b383c5e79789a8eb472`.
- This closes the same-SHA CI blocker in M5-05. It does **not** establish native SQLCipher/device interruption/capacity acceptance, production integration, real-data migration, canonical switch, cleanup, or APK release.
- M5-06 was separately authorized on 2026-11-18. See the [M5-06 Android SQLCipher execution record](m5-06-android-v1.md) for the tested implementation SHA, local evidence, and outstanding acceptance gates.

## M5-06 & M5 Overall Closeout Index (2026-11-19 ~ 2026-11-20)

- M5-06 closeout (PASS): [M5-06 最终关账记录](../../20261119-kanata-sqlite-m5-06-closeout-v1.md), [M5-06 最终独立代码审查报告](m5-06-final-independent-review-v1.md), [M5-06 五项专项整改记录](m5-06-remediation-v1.md), [整改机器证据](m5-06-remediation-evidence-v1.json)（原始 `BLOCKED` 历史快照 [m5-06-android-v1.md](m5-06-android-v1.md)、[m5-06-evidence-v1.json](m5-06-evidence-v1.json) 与 [m5-06-independent-review-v1.md](m5-06-independent-review-v1.md) 均原样保留）。
- M5 Overall closeout (**`CLOSED`** — `M5 Overall: PASS`): [Kanata SQLite M5 总体关账报告 v1](../../20261120-kanata-sqlite-m5-overall-closeout-v1.md), [M5 最终独立审计报告](m5-overall-final-independent-review-v1.md)（SHA-256 `782cdfb697d0cd61221e54a818334c32b138965588ce2cebcaabaa5ce4721b7c`）。
  - Auditor: GPT-6 Independent Technical Audit (`KANATA-M5-FINAL-AUDIT-2026-11-20`, 2026-11-20)
  - Decision: `PASS`（0 Blocker / 0 High / 0 Medium；`L-REV-03` 由后续同 SHA Web CI 关闭并保留历史快照；保留 `L-REV-01`、`L-REV-02`、`L-REV-04`、`L-REV-05`、`EVID-01`、`EVID-02` 计 6 项已接受 Low 遗留风险及后续整改要求）
  - Audited SHA: `4913ef68ec99bb49b7da611400855fe5f88fa52d`
  - Audited CI Run: [Quality #148 (44697060149)](https://github.com/Zhoubin601/ForMyself/actions/runs/44697060149)（Web `success`，Android `skipped`）
  - Scope limit: 仅覆盖 M5 合成迁移与合成验收；不授权生产 Store 切换、真实用户数据迁移、旧文件清理、APK 发布、实体机验收或 M6/M7 实施。

