# Kanata SQLite M6-01 便携备份格式与合成 Codec 交付报告 v1

- 任务编号：`KANATA-M6-01-REMEDIATION-START-2026-11-21`（延续 `KANATA-M6-01-IMPLEMENTATION-CONTINUATION-2026-11-20`）
- 实现分支：`m6/encrypted-backup-recovery`
- 工作树路径：`.worktrees/kanata-m5`
- 原始实现提交：`19ddb73de495888de34d78e86a727db2beb65052`（M6-00 关账基线：`a301436259663999bd1cd6424e6e04ecb4662dc7`）
- 状态：**`READY_FOR_GPT6_FINAL_REAUDIT`**（F01/F02/F03 审计整改与定向复核已完成并准备提交推送，等待 GPT-6 最终独立复审；未合入、未启动 M6-02/M6-03/Native 接入）

## 1. 冻结合同核对（SHA-256 未变更）

| 冻结文档 | SHA-256 |
| --- | --- |
| [M6-00 最终设计收口](m6-00-final-closeout-v1.md) | `f1f953a02c56805418f2da0cd166ed11fb763cadd5065ac127f495cab30d4012` |
| [M6-00 GPT-6 独立最终复核](m6-00-final-independent-review-v1.md) | `4150e81d7c324d5410e170ac36f1475e82e3a71451ed3e18b0c4ecf555239dd1` |
| [M6-01 实施任务书](../../20261120-kanata-sqlite-m6-01-portable-backup-format-task-v1.md) | `54284914d5e3ab3b952639f6d7d14b625cf0763729e99763bc402802e7ace930` |

Schema 001～005 指纹：`8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a`。

## 2. 交付文件清单与 SHA-256

### 2.1 纯协议层（无 `node:*` 依赖，未接入生产组合根）

| 文件 | 职责 | SHA-256 |
| --- | --- | --- |
| [constants.js](../../../src/features/chat/backup/portable/constants.js) | 魔数、版本、合成 profile `0xff01`、600000/64 KiB 候选上限与错误码体系 | `0aa3a190fe33a0de6941eae887873bb3784af9ceef07851a6dd5c23270d7ac27` |
| [bytes.js](../../../src/features/chat/backup/portable/bytes.js) | 大端读写、i64 极值、IEEE 754 binary64 `-0` 规范化/拒绝、严格 UTF-8（保留 BOM/NUL/NFD）、常时间比较 | `6f68f951d71432b88a8db982d84f683b6453328623e5395d2405a85e4edf6545` |
| [catalog.js](../../../src/features/chat/backup/portable/catalog.js) | 静态固定 53 表目录（45 业务 + 5 派生 + 3 运行）、列序/类型/`notnull`/PK 及 Schema 005 序列编码器 | `94983fd780f636565570d3fca44c898eedbd2cb1aca6a636b6737803440534fe` |
| [logicalCodec.js](../../../src/features/chat/backup/portable/logicalCodec.js) | `kanata-logical-v1` 行/流编解码器、`pause-sending-v1` 投影与校验、O(1) PK/`(world_id, ordinal)` 排序追踪器、单行有界流式解码器 | `c8c5bca4a22fa22f10cce1f7534a1810b9372d3944dffc487a443a9369d890e4` |
| [containerCodec.js](../../../src/features/chat/backup/portable/containerCodec.js) | 64 B 公开头 P、48 B 封套 W、40 B Manifest、64 KiB 分块 AEAD（1-block lookahead）、2152 B Footer、增量 transcript、`BoundedByteReader`（含 `close()` 释放迭代器）与统一取消/异常清理流程 | `ff5b6563545f58952b89043e536718ac35e38e283fcabe48283f3fd29fbbfe9b` |
| [contracts.d.ts](../../../src/features/chat/backup/portable/contracts.d.ts) | 便携备份协议 TypeScript 严格类型契约 | `2dbd54d3fc6adb3434515efa36486f90556ff982a669c54a91ce544a94b79a00` |
| [application/contracts.d.ts](../../../src/application/contracts.d.ts) | 仅暴露 type-only 导出，不引入运行时依赖 | `11eb8b7c30cd611725e1ae55553ab43a824e1d5d78a4883346f1d21eac29de89` |

### 2.2 合成适配、独立向量生成器与对抗构造器

| 文件 | 职责 | SHA-256 |
| --- | --- | --- |
| [envelope.mjs](portable/envelope.mjs) | 既有 M6-01 检查点封套模块（未修改，保留兼容） | `aa50f986432a4da97eff5fbaa72e44744eba1c73ad6e42261a44608bffb8b1cd` |
| [nodeCryptoProvider.mjs](portable/nodeCryptoProvider.mjs) | `node:crypto` 加解密/PBKDF2/HKDF/SHA-256 适配器（清理 `randomBytes`/`pbkdf2`/`aesGcmDecrypt` 临时 Buffer） | `26b6e962e77c9c5eff356e11e0f1d6d81acafada48b76456228f4463e449cd48` |
| [webCryptoProvider.mjs](portable/webCryptoProvider.mjs) | WebCrypto `subtle` 独立交叉校验适配器 | `db634c5d2c4942e0651b3fa1f0cb0b95018d010279b891ae3359fb4235c5d6d0` |
| [syntheticCodec.mjs](portable/syntheticCodec.mjs) | 流式导出/导入参考入口、有界计数 staging sink、隔离 Schema 005 SQLite 拓扑/两遍 FK staging sink | `58c2492256d8ca26cc62f0bf1b335a10337145969c24c86bac3d5181a11522fa` |
| [adversarialBuilder.mjs](portable/adversarialBuilder.mjs) | 独立构造有效 AEAD 但违反帧序/transcript/计数/表序/逻辑约束的测试包 | `cd8b81b64c3857a28912dabd1a4c79a528f011b4f065dce26ee00ddabdf58848` |
| [generate_vectors.py](portable/generate_vectors.py) | Python 3.13.5 + cryptography 50.0.1 独立 KAT 向量生成脚本 | `aaa359b8a77316a8cee2ffac01f18f1a4a6fbf6907b70d913409472b3a85c05f` |
| [vectors-v1.json](portable/vectors-v1.json) | 固定字节级 KAT 向量（全空包 2874 B + 填充包 3461 B） | `eabeb0da69a28227a0cff363e7689d2652c1c898457a78e39eb5723d1f596e08` |

### 2.3 测试与类型契约

| 文件 | 用例数 | SHA-256 |
| --- | --- | --- |
| [kanataPortableBackupEnvelope.test.js](../../../tests/kanataPortableBackupEnvelope.test.js) | 5 | `5bf0e0611cd6ef3707b076ebfad2a2738a393ad7045d4dfb2d24ed6a41958f2a` |
| [kanataPortableBackupLogical.test.js](../../../tests/kanataPortableBackupLogical.test.js) | 5 | `3369c3081b23d4b502faae8c4817b6cdff6481bfe877813dba144da130cbcd14` |
| [kanataPortableBackupCodec.test.js](../../../tests/kanataPortableBackupCodec.test.js) | 10 | `3c3818b0f102d77b125da81ad571d976d5bae14acf3bb1e612a532a920500f47` |
| [kanataPortableBackup.ts](../../../tests/types/kanataPortableBackup.ts) | 1 正向 + 6 `@ts-expect-error` | `fc97e8592fd3969290298bfefc382383500ed107704be2efc69549741d72084b` |

## 3. 验收命令与实测结果

- `node --test tests/kanataPortableBackupEnvelope.test.js tests/kanataPortableBackupLogical.test.js tests/kanataPortableBackupCodec.test.js`：20/20 通过，0 失败，0 跳过（新增 F01 编码器最终取消窗口、F02 解码器统一清理与迭代器释放、F03 `deriveWrapKey` 所有权与清理、三张有序表跨 ordinal/跨 world 重复 ID 拒绝测试）。
- `npm run check`（包含 `eslint`、`npm test`、`npm run test:component`、`npm run typecheck`、`npm run build`）：退出码 0。
  - ESLint：0 errors，61 warnings（全为既有代码告警，本轮无新增告警）。
  - Node 全量测试（`npm test`）：816/816 通过（0 failed，0 skipped）。
  - Vitest 组件测试（`npm run test:component`）：45 文件，420/420 通过。
  - TypeScript 严格检查（`vue-tsc` + `tsc -p tsconfig.contracts.json`）：通过。
  - Vite 构建（`npm run build`）：通过；检查 `dist/assets/*` 未检出 `KPB1/`、`KANATA1`、`ff01` 或 `backup/portable`。
- `git diff --exit-code a301436259663999bd1cd6424e6e04ecb4662dc7 -- android src/main.js src/application/fullBackupRuntime.js src/application/kanataBackupRuntime.js src/features/chat/backup/kanataBackup.js src/features/chat/storage/sqlite/kanataSchema.js src/features/chat/storage/sqlite/kanataSchemaHardening.js src/features/chat/storage/sqlite/kanataSchemaArrayOrder.js src/services/fullBackup.js package.json package-lock.json`：退出码 0（生产代码、Native、Schema 001～005、依赖清单、canonical 入口与历史备份路径无差异）。

## 4. 审计整改与边界声明

- **F01 编码器最终取消检查**：`encodePortableContainer()` 在每次 `yield`（含最后 DATA 帧头/密文、Footer 帧头/密文）后、Footer AEAD 加密前后以及最终 `return` 前均检查 `AbortSignal`；`finally` 统一清理 `mat.*`、`wrapKey`、`manifestKey`、`dataKey`、`footerKey` 及未加密 `pendingPlain`。
- **F02 解码器统一异常清理**：`decodePortableContainer()` 将初始 `checkCancelled(signal)` 与 `createBoundedByteReader(source, signal)` 纳入统一 `try/finally`；`BoundedByteReader` 新增 `close()` 在提前退出/异常时调用 `iterator.return()`；未提交路径保证最多调用一次 `stagingSink.abort()` 并保留原始业务异常，已 `commit()` 状态不被覆盖。
- **F03 HKDF 输出密钥清理**：`deriveWrapKey()` 显式追踪 `transferred` 所有权，仅在验证长度与最终 `checkCancelled(signal)` 通过后才转移 `wrapKey` 所有权，否则在 `finally` 中连同 `passBytes`、`baseKey` 一并清零；`nodeCryptoProvider.mjs` 对 `randomBytes`、`pbkdf2Sha256`、`aesGcmDecrypt` 的临时 `Buffer` 执行清零。
- **附加流式与输入界定**：`createBoundedByteReader` 仅以 `subarray` 保留当前单个未消费 chunk 尾片并按校验后长度分配 `<= 65552 B` 读取缓冲；若上层 `AsyncIterable` 自行分配超大单 chunk，有界读入依赖平台流适配器缓冲上限（M6-02 N-03/N-04 负责）。
- 600000 次 PBKDF2 与 64 KiB 分块上限仍为 M6-01 发行候选参数，本实现通过独立常量/Profile `0xff01` 与生产 Profile `0x0001` 隔离，拒绝在参考层接收生产 Profile。
- 未执行 Android 真机/模拟器测试、N-01～N-06 Native 探针及 M6-02 A/C 对照实验；不得宣称 Android API 24/25 兼容或实机性能/RSS 已验证。
- 未接入生产 Store、Settings UI、恢复协调器或主密码变更流程。
