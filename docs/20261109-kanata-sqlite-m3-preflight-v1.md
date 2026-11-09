# Kanata SQLite M3 接管与 Preflight v1

2026-11-09，北京时间。工作树 `.worktrees/kanata-m0`，分支 M。接管时 M 干净。本地与 `git ls-remote --symref origin HEAD refs/heads/M` 返回的 M 均为 `b36bbe65ec05dea0b408867dd7acdc627ca983f2`。远端默认 HEAD 为 main（`41cbb66053bd5b9995b358c0c4846669e626bcc0`）。`git merge-base --is-ancestor b0be26f2f26d66abe7720625ca9afeb84d32f301 HEAD` 返回 0。主工作树的既有修改、删除和未跟踪项留在原位。

来源为用户附件《已粘贴的文本.txt》、[完整需求清单](../raw/完整需求清单.txt)、[原技术设计](../raw/彼方%20·%20Kanata%20技术设计.txt)、[M0 直接桥接放行](20261104-kanata-sqlite-m0-direct-gate-v1.md)、[M1 验收 v2](20261106-kanata-sqlite-m1-report-v2.md)、[M1-R 审计](20261107-kanata-sqlite-m1-r-audit-v1.md)、[M2 任务书](20261107-kanata-sqlite-m2-task-v1.md)、[M2 设计](20261107-kanata-sqlite-m2-design-v1.md)、[M2 验收 v2](20261109-kanata-sqlite-m2-acceptance-v2.md) 和 [M2 QA](qa/kanata-sqlite-m2/README.md)。

| 调用链 | 实际基线 |
| --- | --- |
| `kanataSqliteCandidate.js` → `androidKanataSqliteDriver.js` → `KanataSqlitePlugin.java` | 复用受保护操作、owner guard、前台租约、直接字节 DEK、固定语句目录和回滚毒化。 |
| `kanataSchemaMigrator.js` | 现有 Schema 三版，严格校验历史目录、日志、应用时间与外键。 |
| `kanataManagementCore.js`、`kanataLorebook.js` | 独立世界身份、可逆归档、不可变角色卡版本、显式同步实例、世界书范围与已知者。 |
| `kanataMemory.js`、`kanataKnowledge.js`、`messageArchiveRepository.js` | 记忆保留消息 ID 与 revision；授权沿消息、事件祖先及共享父链追溯；旧归档仍是加密页。M2 已可按 scope 和 ID 查消息。 |
| `kanataEvents.js`、`kanataMessageDependents.js` | 事件撤销使用已确认集合、真实归属和持久基线。M2 消息编辑删除已联动事件、记忆、任务和审计。 |
| `kanataAutonomy.js`、`kanataWorldRuntime.js` | UTC 窗口、稳定幂等键、启停和配置重划范围；前次窗口保存失败时禁止处理下一窗口。 |

用户确认采用可逆归档实现世界删除。事件撤销保留预览确认的批量流程，每条事件只停用自己拥有的 Effects。

本轮 Windows / Node v24.14.1 运行 `node --test tests/kanataSqliteDriver.test.js tests/kanataSqliteRepository.test.js tests/kanataSqliteSchema.test.js tests/kanataSqliteRemediation.test.js tests/kanataSqliteMapping.test.js tests/kanataExperience.test.js tests/kanataAutonomy.test.js tests/kanataManagement.test.js`，退出 0，103 PASS、0 FAIL、0 SKIP。M2 Android 结果为历史基线。

用 M2 提交的 Git blobs 对照 QA manifest，核对 79 份证据、40 项源码 SHA-256、20 份 gzip 原始与压缩指纹，均匹配。该检查只验证 M2 证据的身份和完整性。
