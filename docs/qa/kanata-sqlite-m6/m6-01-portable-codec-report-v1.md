# Kanata SQLite M6-01 便携备份格式与合成 Codec 交付报告 v1

- 任务编号：`KANATA-M6-01-IMPLEMENTATION-CONTINUATION-2026-11-20`
- 实现分支：`m6/encrypted-backup-recovery`
- 工作树路径：`.worktrees/kanata-m5`
- 基线提交（HEAD）：`a301436259663999bd1cd6424e6e04ecb4662dc7`
- 状态：**M6-01 合成 Codec 实现与测试完成，等待 GPT-6 独立验收**（未提交、未推送、未合入、未启动 M6-02/M6-03/Native 接入）

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
| [containerCodec.js](../../../src/features/chat/backup/portable/containerCodec.js) | 64 B 公开头 P、48 B 封套 W、40 B Manifest、64 KiB 分块 AEAD（1-block lookahead）、2152 B Footer、增量 transcript、`BoundedByteReader` 与先验后提交解码流程 | `8f523869f56889990aae7bda3d71c2cc7e52743e9db8449a6c75265e9d0d0086` |
| [contracts.d.ts](../../../src/features/chat/backup/portable/contracts.d.ts) | 便携备份协议 TypeScript 严格类型契约 | `2dbd54d3fc6adb3434515efa36486f90556ff982a669c54a91ce544a94b79a00` |
| [application/contracts.d.ts](../../../src/application/contracts.d.ts) | 仅暴露 type-only 导出，不引入运行时依赖 | `11eb8b7c30cd611725e1ae55553ab43a824e1d5d78a4883346f1d21eac29de89` |

### 2.2 合成适配、独立向量生成器与对抗构造器

| 文件 | 职责 | SHA-256 |
| --- | --- | --- |
| [envelope.mjs](portable/envelope.mjs) | 既有 M6-01 检查点封套模块（未修改，保留兼容） | `aa50f986432a4da97eff5fbaa72e44744eba1c73ad6e42261a44608bffb8b1cd` |
| [nodeCryptoProvider.mjs](portable/nodeCryptoProvider.mjs) | `node:crypto` 加解密/PBKDF2/HKDF/SHA-256 适配器 | `bf6e01fabfdf8b0b84b10754ecd8b1f9cd50b00fa70df88bc4a1d22e6eebaf81` |
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
| [kanataPortableBackupCodec.test.js](../../../tests/kanataPortableBackupCodec.test.js) | 6 | `9fb207bf8bbca0c2b02434aa1e1c46a5866962522e4ebab0a783843ba98aa6a4` |
| [kanataPortableBackup.ts](../../../tests/types/kanataPortableBackup.ts) | 1 正向 + 6 `@ts-expect-error` | `fc97e8592fd3969290298bfefc382383500ed107704be2efc69549741d72084b` |

## 3. 验收命令与实测结果

- `node --test tests/kanataPortableBackupEnvelope.test.js tests/kanataPortableBackupLogical.test.js tests/kanataPortableBackupCodec.test.js`：16/16 通过，0 失败，0 跳过。
- `npm run check`（包含 `eslint`、`npm test`、`npm run test:component`、`npm run typecheck`、`npm run build`）：退出码 0。
  - ESLint：0 errors，61 warnings（全为既有代码告警，本轮无新增告警）。
  - Node 全量测试（`npm test`）：812/812 通过（0 failed，0 skipped）。
  - Vitest 组件测试（`npm run test:component`）：45 文件，420/420 通过。
  - TypeScript 严格检查（`vue-tsc` + `tsc -p tsconfig.contracts.json`）：通过。
  - Vite 构建（`npm run build`）：通过；检查 `dist/assets/*` 未检出 `KPB1/`、`KANATA1` 或 `ff01`。
- `git diff --exit-code a301436259663999bd1cd6424e6e04ecb4662dc7 -- android src/main.js src/application/fullBackupRuntime.js src/application/kanataBackupRuntime.js src/features/chat/backup/kanataBackup.js src/features/chat/storage/sqlite/kanataSchema.js src/features/chat/storage/sqlite/kanataSchemaHardening.js src/features/chat/storage/sqlite/kanataSchemaArrayOrder.js src/services/fullBackup.js`：退出码 0（生产代码、Native、Schema 001～005、canonical 入口与历史备份路径无差异）。

## 4. 边界声明与未覆盖项

- 600000 次 PBKDF2 与 64 KiB 分块上限仍为 M6-01 发行候选参数，本实现通过独立常量/Profile `0xff01` 与生产 Profile `0x0001` 隔离，拒绝在参考层接收生产 Profile。
- 未执行 Android 真机/模拟器测试、N-01～N-06 Native 探针及 M6-02 A/C 对照实验；不得宣称 Android API 24/25 兼容或实机性能/RSS 已验证。
- 未接入生产 Store、Settings UI、恢复协调器或主密码变更流程。
