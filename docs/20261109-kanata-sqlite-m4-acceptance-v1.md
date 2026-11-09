# Kanata SQLite M4 阶段验收 v1

**2026-11-09，北京时间。M4 BLOCKED，M5 NO。** 已实施并验证隔离候选的有界聊天、会话历史、领域摘要工作区、角色授权和自治窗口切片。完整管理交互与深层溯源有界性未收口。生产 canonical 为 legacy，普通 Android Debug 的 SQLite 激活位为 false。未切流、迁移或修改真实资料。

仓库为 `Zhoubin601/ForMyself`，仅在 `M` 开发。起始本地 M3 源码是 `751da40149404deb8bc1562851a91e699c60c1e5`，预检远端及快进后 HEAD 为 `1e1d04fd9f7072d84e2c0289816502a104ffb2d2`。本次提交的受测源码、脚本、APK 和 SQL 目录见 [指纹](qa/kanata-sqlite-m4/evidence/tested-files-sha256.json) 与 [QA](qa/kanata-sqlite-m4/README.md)。

## 分阶段

| 阶段 | 状态 | 实际范围 |
| --- | --- | --- |
| M4-0 | PASS | 已核对 Git、M3 源码基线、调用链、Windows 工具链和新建合成 AVD。基线 check 与 39 项定向退出 0。 |
| M4-1 | BLOCKED | 已形成访问矩阵、技术设计和可运行探针。完整管理接口及全部验收用例仍需补齐。 |
| M4-2 | BLOCKED | 聊天、历史、用量、AI 知识投影、权限、自治窗口已实施。事件因果、记忆关联及剩余管理命令的有界合同未全部完成。 |
| M4-3 | BLOCKED | 真实候选聊天和工作区接线通过设备子集。世界书、记忆、事件和自治任务当前为摘要入口，完整管理语义未接齐。 |
| M4-4 | BLOCKED | 已实施场景的锁定、后台原生租约、切换、恢复门禁、授权撤销均有证据。剩余候选管理页生命周期尚未接线和验证。 |
| M4-5 | BLOCKED | 本轮所有定向、strict、全项目及实际 Android 复测退出 0。未覆盖完整管理工作流及其数据增长。 |
| M4-6 | BLOCKED | 已实施切片完成两轮不同侧重的反例检查和复测。完整候选的实现后复审仍待完成。 |
| M4-7 | BLOCKED | 已整理本阶段报告、源码指纹、复现命令和证据。总验收不放行。 |

## G1–G11

| 门禁 | 状态 | 证据及缺口 |
| --- | --- | --- |
| G1 调用覆盖 | BLOCKED | 聊天外部 metadata 注入和候选全量知识页聚合已移除。剩余完整管理消费者及深层溯源材料见 [调用矩阵](20261109-kanata-sqlite-m4-preflight-v1.md)。 |
| G2 状态有界 | BLOCKED | 设备实测聊天窗口 100 条、单次桥接业务查询至多 51 行（含探测下一页的第 51 行）。工作区替换式分页。全部管理状态、关联来源和其余尺寸证据尚未覆盖。 |
| G3 Repository | BLOCKED | 聊天作用域、分页、聚合、按 ID、CAS、事务和自治分批已验证。剩余领域的有界跨实体操作仍待验证。 |
| G4 普通聊天无全图 | PASS | 两档 Android 增长探针覆盖发送、故障后重试、流式、修订、删除及窗口，整图探针计数 0。主机真实 SQLite 亦有独立定向。 |
| G5 领域正确 | BLOCKED | M3 领域事务回归通过。完整角色卡、世界书、记忆、事件及自治管理交互和旧历史整理的候选等价仍有缺口。 |
| G6 权限与租约 | BLOCKED | 已覆盖的场景包含角色 read/remember/share 负例、恢复门禁零访问、快切/锁定、实际后台原生租约，以及撤权期间故意忽略取消的模型返回。剩余管理入口的正文缓存和租约待验。 |
| G7 错误与故障 | PASS | 已接线路径实跑错误密钥、未来 Schema、权限、事务失败、真实 COMMIT 失败及两次强停重开。主机有源消息与延期关联写入失败的事务回滚反例。 |
| G8 UI/AI | PASS | 已接线的聊天路径实跑私聊、群聊、character 拒绝、气泡、锚点、quote、历史定位、延期、失败重试和迟到取消。实际模型 API 0。 |
| G9 全项目 | PASS | 本轮 101 项定向、655 Node、392 组件、两套类型检查及生产 Web 构建退出 0。真实 API 34 JS→Native→SQLCipher 完整运行脚本退出 0。 |
| G10 兼容与边界 | PASS | 生产 legacy、普通 Debug 包 `com.yubin.formyself` 激活 false，APK 无合成页/种子语句，Schema 001–004 校验一致。M5、M6、M7 未实施。 |
| G11 证据与审计 | BLOCKED | 当前切片有两轮自检、失败和复测、合成种子与 SHA。完整 M4 的未跑场景仍待补齐。 |

## 实测和未跑项

- **Windows 主机。** `npm.cmd run check` 退出 0，655 Node、392 Vue（42 文件）、`vue-tsc`、strict `tsc`、Vite。Lint 0 错误和 42 条既有警告。M4 定向 101 项退出 0。命令与原始输出见 [QA](qa/kanata-sqlite-m4/README.md)。
- **真实 Android。** WHPX API 34、x86_64、SELinux Enforcing、SQLCipher 4.17.0 community。Instrumentation 1/1。1k 和 10k 两档各 179 次业务查询、26 次写入、最多 51 行返回、保留 100 条聊天消息。仅该明确场景实测，未测堆内存/RSS门槛。M4 工作区与聊天使用 10 次受控调用、0 次真实模型调用。SQLCipher 的 FK、WAL、实际 COMMIT 失败及强停已实测。见 [Android 原始结果](qa/kanata-sqlite-m4/evidence/android-final-result.txt)。
- **未跑。** 全部候选管理等价流程、世界/角色等多集合规模增长、深层溯源和事件图的峰值、完整管理页面卸载矩阵。M5 导入、M6 生产便携备份/改密/恢复、M7/P7 整应用容量仍按各自阶段执行。
- **需要复核。** 按 [设计末节](20261109-kanata-sqlite-m4-design-v1.md) 补齐候选完整管理操作、生命周期及其验收。已有历史业务状态和备份协议依照 M3 与 legacy 测试继续保留。两轮自检具体反例见 [记录](qa/kanata-sqlite-m4/reviews.md)。

## 交付位置

Preflight、设计和验收在 `docs/`，原始证据、复现脚本及指纹在 `docs/qa/kanata-sqlite-m4/`。代码位于 `src/features/chat/`、`src/application/`、SQL 固定目录脚本、Android 构建和测试目录。资料来源登记于 [source notes](source-notes.md)。APK 和合成 AVD 不入 Git。Git 仅普通提交至 M。进入 M5 需先完成其余 M4 门禁。
