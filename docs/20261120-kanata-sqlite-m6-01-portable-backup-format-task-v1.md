# Kanata SQLite M6-01 便携备份格式与合成 Codec 实施任务书 v1

- 任务来源：KANATA-M6-00-CLOSEOUT-2026-11-20，基线 `a301436259663999bd1cd6424e6e04ecb4662dc7`。
- 启动门禁：GPT-6 对同一份 [M6-00 收口](qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md) 和本任务书给出最终 PASS。通过后按本任务书启动。实际状态和复核证据以 [M6 路线](20261119-kanata-sqlite-m6-encrypted-backup-recovery-plan-v1.md) 首节为准。
- 目标：以 Node/JS 验证 Scheme C 的单项容器、数据编码、增量认证和拒绝边界，产出 Native 可独立对照的固定字节及测试向量。

## 1. 实施顺序和交付

1. 在 `m6/encrypted-backup-recovery` 的独立 worktree 核对远端、HEAD、独立签核及工作区。用纯 JS 定义常量、目录和有界读取接口，可在 `src/features/chat/backup/portable/` 放纯协议与类型，Node 加密适配和测试置于合成 QA/测试入口。模块不得被生产组合根导入。
2. 从固定 DDL 核对 53 表与列描述，提供随仓库可重现的目录校验和结构化合成记录。随后实现容器的头、封套、Manifest、DATA、Footer，再接逻辑流。编码器以字节流和背压接口输出。解码器用一次性 staging sink，可 `write/verify/commit/abort`。读取、认证或语义失败时中止并清理本次 sink，只有全包、表摘要、EOF 均验证才能提交，发布失败无成功结果。参考测试入口可对 sink 逐步计数。
3. 固定合成随机输入，保存小包及独立已知答案向量、正反测试和运行说明。Node 流式参考以标准 crypto 原语为基准，JS 参考 API 以 `Uint8Array`、精确整数和可注入原语表达，可用 Node WebCrypto 独立交叉验证。
4. 交付协议文档、可导入的参考 Codec、固定目录与合成向量、行为及负向测试、命令/基线/实际结果。新公开接口须有实际类型入口、对应契约及负向样例，按仓库适用的 import/strict 检查通过。验证 `npm run check` 和定向测试，记录实现 SHA 或可核对的文件指纹。Native 压测、发行参数和产品接入分别服从 [M6-00 的 Native 门禁](qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md#native-前置验证)。

## 2. 外层字节合同

所有整数大端，无结构填充。字节计数以实际字节为准，u64 在 JS 使用 BigInt。标识字符串为 ASCII，文中 `NUL` 指一个零字节。哈希为 SHA-256 原始 32 字节，拼接按定义顺序。v1 拒绝未知版、枚举、位、编码和压缩。

| 结构 | 字节布局及约束 |
| --- | --- |
| 公开头 P，64 B | magic 8 B（hex `4b414e4154413100`），format u16=1，suite u16=1，profile u16，flags u16=0，iterations u32，salt 16 B，backupId 16 B，scope u8=1（Kanata 单项），payload u8=1（kanata-logical-v1），frameLimit u32=65536，reserved 6 B=0。 |
| 封套 W，48 B | BEK 密文 32 B，加 GCM tag 16 B。每包 salt、backupId、BEK 和下面的 96-bit 封套 nonce 由独立 CSPRNG 抽取。文件次序为 P、封套 nonce 12 B、W、帧。独立包随机碰撞依赖熵质量，禁止复用 writer 或其随机材料。 |
| 帧头 F，20 B | streamId u16、type u8、flags u8、index u64、plaintextLen u32、ciphertextLen u32。后接密文及 16 B tag。ciphertextLen 必须等于 plaintextLen+16。 |
| MANIFEST | 第一帧，streamId=0、type=1、flags=0、index=0。明文 40 B。applicationId u32=`0x4b4e5441`、schema u16=5、schemaFingerprint 32 B、taskPolicy u8=1（pause-sending-v1）、profileReserved u8=0。唯一 DATA 流固定为 1。 |
| DATA | streamId=1、type=2、index 从 0 连续递增。flags=0 时明文恰 65536 B，flags=1 表示唯一尾块，长 1～65536 B。恰好整块的末块也置 1。要求至少一块，MANIFEST 后消费完整逻辑流再读 Footer。 |
| FOOTER | 末帧，streamId=0、type=3、flags=0、index=0。明文 2152 B。依次 u32 DATA 帧数、u64 DATA 明文字节总量、u64 DATA 密文加标签总量、transcript 32 B、50 条 table verifier。每条是 tableId u16、rowCount u64、digest 32 B，按目录 ID 严格升序，排除 3 张运行表。之后必须是精确 EOF。 |

### 2.1 派生和认证

- 口令采用严格 Unicode 标量 UTF-8。保持空格、NUL、BOM 字符及原始正规化形式，拒绝空及孤立代理项，先限制字符串长度再严格编码为 1～1024 B。对同一个包每次尝试最多做一次 KDF，参考 runner 同时最多 1 个任务，取消后丢弃结果、释放缓冲。Native 需单独验证取消时延。
- `baseKEK = PBKDF2-HMAC-SHA256(passwordBytes, ASCII("KPB1/KEK") || NUL || salt || backupId, iterations, 32)`。profile `0xff01` 在合成 Codec 精确匹配候选 600000 并明确标成测试用途。早于 KDF 拒绝其他 profile 或任何迭代数差异。发行 profile `0x0001` 的迭代数与资源上限须由 N-01/N-03 校准及评审后生效，仅承认批准的精确组合。参考产物禁接产品读取。发行读写器拒绝合成 profile。
- `wrapKey = HKDF-SHA256(IKM=baseKEK, salt=backupId, info=ASCII("KPB1/wrap") || NUL || P, L=32)`，AES-256-GCM 的 nonce 为封套前 12 B，AAD 是 `P`。HKDF 指 RFC 5869 的 Extract 加 Expand。随机源故障即停止。取消、故障或重启后重新导出须生成新包材料，完整密文字节可直接重传。
- 各帧的 `key = HKDF-SHA256(IKM=BEK, salt=backupId, info=ASCII("KPB1/frame") || NUL || u16(streamId) || u8(type), L=32)`。Nonce 是 `u16(streamId) || u8(type) || 00 || u64(index)`，单包元组不得重复。AES-256-GCM 标签 16 B，帧 AAD 是 `SHA256(P || wrapNonce || W) || F`。控制帧用途各有独立派生键。帧验签前禁止向逻辑读取器输出该帧的明文。
- `transcript = SHA256(ASCII("KPB1/transcript") || NUL || SHA256(P || wrapNonce || W) || concat(F || ciphertextAndTag))`，覆盖 MANIFEST 和所有 DATA，按实际顺序增量累加，Footer 自身由独立 GCM 认证。读端验各计数、摘要、唯一尾块和实际 EOF。
- 包密码、包 KEK、随机 BEK、帧子键、本机口令/KEK/DEK 与本机事务密钥用途分离。持包密码者可重制合法容器，完整性不等于作者身份或新鲜度。操作结束尽力清理可变密钥缓冲，托管运行时不承诺物理擦除。

### 2.2 限制、错误和取消

合成上限为 DATA 帧数 65536、DATA 明文 4 GiB、最终包 4 GiB + 2361684 B、单 TEXT 字段 2 MiB、完整行体 4 MiB、业务总行数 2^24。总长度上限含公开头、封套、控制帧、全部帧头与 tag。数据解析实行逐帧、逐行有界缓存，队列深度不超过 2 帧和 1 行，包含写端尾块判定的 lookahead。64 KiB 及字段/行限额均为初始候选，N-03 核定发行 profile 的 wire 资源参数和平台预算，完整覆盖现有可合法生成的数据。若离线 oracle 模拟更大计数，避免为测试创建巨文件。

错误分层使用稳定标识 `UNSUPPORTED_FORMAT`（未知枚举、版本或 profile）、`RESOURCE_LIMIT`（上限、非法长度上界）、`AUTH_FAILED`（合法头的错密或标签错误）、`INVALID_CONTAINER`（顺序/缺块/计数/transcript/EOF）、`INVALID_LOGICAL`（行、目录和逻辑摘要）、`INVALID_PASSWORD_INPUT`、`IO_FAILED`、`CANCELLED`。先做头和帧结构、上限、溢出检查再分配或派生。仅读足固定小头，再按校验通过的长度有界读；短读继续，零进展需由适配器映射至可信 EOF 或有界 I/O 错误。完成后拒绝 1 字节尾随或另一整包。两次尝试不共享 KDF 新旧结果、流状态和随机材料。错误只记录分类与阶段，屏蔽秘密及正文。

## 3. kanata-logical-v1 字节合同

- 固定 Schema 005。schemaFingerprint = SHA256(ASCII("KPB1/schema-005") || NUL || DDL 序列)，对 migration version 1..5 依次编码 u16 version、u32 statementCount，再对每条现有 statement 以 u32 byteLength + UTF-8 原始字节编码，无额外换行。对应指纹 `8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a`。Native 安装的可信目录取上述迁移与已核定的列顺序，禁止使用包提供的 DDL 或 SQL。
- ID 由完整 53 表按 ASCII 表名升序从 1 编号。各表列顺序取上述迁移后 `PRAGMA table_info` 的 cid，主键列顺序取 pk 序号。声明类型固定为 TEXT、INTEGER、REAL，schema nullable 信息结合主键及 notnull。目录和业务/派生/运行分类见 [收口 G-05](qa/kanata-sqlite-m6/m6-00-final-closeout-v1.md#g-05-数据目录与语义)。目录从受信 DDL 生成后固定到 Codec，禁止运行时用包驱动列解析。
- DATA 明文拼接后是 45 个表段，按业务表 tableId 严格升序且各出现一次，每个为 `tableId:u16 || rowCount:u64 || row[0..rowCount)`。每个 row 为 `bodyLength:u32 || body`。缺段、重复段、乱序、未列入表和重复主键拒绝。空表有表头且 rowCount=0。记录允许跨帧任意字节边界。
- body 依 cid 逐列编码 `nullFlag:u8`（0 为 NULL 无后续，1 有值，其他拒绝）及值。INTEGER 为 i64 二补数，业务域遵循 SQLite 约束。REAL 为 IEEE 754 binary64，写端统一负零为正零，读端拒绝负零及非有限数。TEXT 为 u32 byteLength + 严格 UTF-8，禁止隐式转换、截断、正规化。JSON 列仍按原始 TEXT 编码，保留空白、键顺序、数值词法与扩展；按可信 DDL 或领域约束校验，不能用 parse/stringify 结果替换原字节。M6-01 验字节与行级契约，跨行 FK/图与 SQLite 检查留给 M6-03。
- `world_events`、`world_effects`、`effect_baselines` 的 body **开头**另带 u64 ordinal，业务行按 `(world_id, ordinal)` 严格排序，各 world 从 0 起连续。其他表按 PK 各列依次比较，TEXT 按 UTF-8 无符号字节字典序、数值按精确数值排序。读取排序需要保留上行 PK，计入有界内存。三张有序表的跨 ordinal 重复 ID 由 staging 的唯一索引验证。参考实现用可拒绝重复 ID 的有界 staging 接口或合成唯一性 oracle，禁止在 Codec 堆中积累所有键。
- 每表 digest = `SHA256(ASCII("KPB1/table") || NUL || u16(tableId) || concat(u32(bodyLength) || body))`；空表也持域分隔摘要。业务表按实际输入流顺序及投影核对。5 张派生表无 DATA 段，按同样列编码与 PK 排序给 Footer 的计数/摘要。合成 Codec 用独立派生行 oracle 校验派生摘要，产品在隔离库用触发器重建后比较。派生摘要仅是认证承诺，包方提供摘要本身不能代替重建核验。
- 包的 dataset identity 取受认证 `dataset_metadata` 等业务行。前置验证、目标关联、通知/租约、收据与完整图检查均用 G-05 的策略。容器级空数据测试用 45 张零行表头及五个空派生摘要，产品恢复还需通过数据集语义。

## 4. 必须通过的验收

| ID | 验收与判据 |
| --- | --- |
| C01-01 | 固定小包整文件 SHA-256、逐字段偏移、单帧 tag、KDF/HKDF 输入/输出、封套及各 nonce/AAD、Footer transcript 和表摘要均可单独重算。用公开 primitive 已知答案和独立实现（例如 node:crypto 与 WebCrypto）互证，不用同一 encoder 当唯一 oracle。 |
| C01-02 | 完整 45 段、50 项 table verifier、53 表可信目录一致，空表/多帧/恰好单块与全块尾/记录跨帧，复合键与 005 顺序、任务投影、收据/归档行往返稳定。合成内容含中文、补充平面字符、预组/分解、空格、NUL、BOM、负零、i64 极值、长 JSON 和非法 UTF-8/代理项。比较原始字节与类型。 |
| C01-03 | 错密；每类头和帧字段、封套、tag、Manifest、Footer 改动；跨包/帧替换，重复、乱序、缺首/中/尾块、提前结束、任意前缀截断、尾随数据或第二包。另用持测试键的独立构造器制造有效 AEAD 但错误 transcript、计数、表段顺序、表/列/摘要的包。失败无 commit，staging 必 abort。 |
| C01-04 | 字段、行、帧、行数和文件长度的边界及 +1；u64 回绕、声明大长度后短流、未知保留位、恶意 KDF（空、0、最大 u32、600001、未知 profile）、短读与取消、失败后重试。未通过头/profile 检查的 KDF 调用为 0，超限在申请内存前拒绝，流式水位有实测或受控计数。 |
| C01-05 | 固定 SQL 目录的版本、列、PK、DDL 指纹与源码一致。类型和负向入口、定向测试、`npm run check` 均通过。检查生产 bundle/依赖图、Schema 001–005、备份 v1–v12 / v13、canonical 入口均没有阶段差异。Native 互操作/参数仍需 N-01/N-03 的另行合成证据。 |

## 5. 禁止事项

仅使用合成记录和一次性密钥。禁止接生产 Store、Native 桥、设置页、主密码、真实备份/数据库、真实用户资料、迁移或任何 canonical 变更。禁止修改 Schema 001～005、放宽 strict/依赖边界、导出源 DEK、复用测试随机源、把未经完整认证的记录发布给调用者。禁止 APK 发布、分支合并、force-push、覆盖其他 worktree。发行参数、Native/SAF 和后续阶段硬门禁依 M6-00 执行。
