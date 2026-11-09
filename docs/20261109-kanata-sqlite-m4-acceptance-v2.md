# Kanata SQLite M4 验收 v2

**2026-11-09，北京时间。M4 BLOCKED，M5 NO。** 本轮补齐并实测了来源链与部分管理路径，未达到 A–G 全范围等价及 G1–G11 全部门禁。历史 [验收 v1](20261109-kanata-sqlite-m4-acceptance-v1.md) 作为原始检查点保留。

仓库 `Zhoubin601/ForMyself`，仅 `M`。原代码 `301ad81e851f65cd5b73f883833052e7e5d1a2fb`，接管文档 HEAD `4191d7fd72723afab35f77bb9b85970f29f0f43f`。主工作树的修改、删除和未跟踪文件保留。生产 canonical 为 legacy，普通 Android 候选激活位 false。没有真实数据导入、发布、强推、合并或 M5–M7 工作。

## C0–C7

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| C0 | PASS | Git、代码和旧证据范围核对，Windows/WHPX API 34 新建合成设备，基线 check 实跑。 |
| C1 | BLOCKED | A–G 已分类，新增可失败的增长和事务测试。完整操作的端到端矩阵尚有缺口。 |
| C2 | BLOCKED | 消息深链、共享记忆授权和事件因果浏览已分批，旧事件预览/撤销和 Effects 重放仍有无界集合。混合深宽与全部取消负例未跑。 |
| C3 | BLOCKED | 身份编辑、独立建群、卡片库、世界书编辑、记忆来源、事件因果浏览与全局角色绑定已接入，剩余管理流程见下表。 |
| C4 | BLOCKED | 新详情和草稿按 owner 与 scope 隔离。完整后台、锁屏、卸载、解绑、任务矩阵尚未关闭。 |
| C5 | BLOCKED | 已接线场景按 QA 复测。未覆盖 A–G 全部场景和混合增长。 |
| C6 | BLOCKED | 两轮反例自检覆盖现有增量，完整 M4 反例矩阵仍待复测。 |
| C7 | BLOCKED | 已交付 v2、QA 与 Git 检查点。整阶段未放行。 |

## A–G 实施范围

| 范围 | 已实施 | 待补或待验证 |
| --- | --- | --- |
| A | 世界身份按 ID 查看、revision CAS 保存，独立建群保留成员顺序、作用域和命令回执，原可逆归档保留 | 完整世界配置、创建/复制候选交互。群聊成员变更已确认采用方案 1，候选编辑入口、提交分流和完整验收仍待完成。见 [成员变更用例](qa/kanata-sqlite-m4/completion/README.md#群聊成员变更验收用例) |
| B | 卡片标题页、单卡定义、版本标题页、导入预览、发布及归档入口 | Android 原生文件选择后台往返、PNG/JSON 完整导入验证、指定实例加入和同步 |
| C | 世界书按 ID 详情、创建/编辑/启停/删除、角色分页选择 | 完整候选预览、编辑与删除设备矩阵 |
| D | 按角色授权读取单条详情、分页来源、原文按 ID+revision 解析 | 整理、合并、冲突与分享管理交互，宽来源及撤权组合增长 |
| E | 事件前因与后续的去重 keyset 页 | 预览确认集合、审计详情、候选撤销操作和有界 Effects 重放 |
| F | 全局和模块角色绑定，区分继承与明确无绑定，CAS 和归档后不可用，保留原自治窗口 | 联系/社交完整调度、活动设置、重试、生活模块消费者 |
| G | 既有历史检索、引用和定位回归 | 候选历史整理和预览确认 |

## G1–G11

| 门禁 | 判定 | 证据或缺口 |
| --- | --- | --- |
| G1 | BLOCKED | A–G 管理消费者未全部接线。 |
| G2 | BLOCKED | 已接线列表及因果页上限 50，聊天窗口实测 100。单卡草稿、单条记忆正文、单来源正文按生命周期清理。旧关联与撤销暂存仍未全部有界。 |
| G3 | BLOCKED | 按 scope、ID、revision、keyset 和 CAS 的新增路径有证据。事件预览/执行及其它领域的批次合同未关闭。 |
| G4 | PASS | 已接线的聊天增长探针整图调用 0，消息原功能回归。 |
| G5 | BLOCKED | 未完成 A–G 的完整候选业务等价。 |
| G6 | BLOCKED | 深链授权前置及既有恢复/撤权证据。新增页面的完整生命周期矩阵未跑。 |
| G7 | PASS | 候选 SQLCipher 密钥、版本、真实 COMMIT 失败与强停重开覆盖既有回归。 |
| G8 | BLOCKED | 聊天、气泡、锚点、延期和部分管理 UI 已在设备实跑。剩余管理和跨模块消费待补。 |
| G9 | PASS | 本轮实际定向、strict、完整 check 与已实施的真设备场景。 |
| G10 | PASS | legacy 保留、普通 APK 激活位 false，001–004 校验和一致，M5–M7 未实施。 |
| G11 | BLOCKED | 有原始失败、重测、两轮切片复核与指纹，未达完整 M4 全范围自检。 |

## 数据与实测

- 主机消息深链 1k/10k 两档各 2 次 SQL 查询。共享记忆深链的兼容入口两档各 13 次，授权后只读当前正文，末端过期时正文读取数为 0。因果分页验证汇合去重、游标方向与世界和根绑定、循环约束。
- Android WHPX API 34 的 SQLCipher 4.17.0 实跑通过。1k/10k 关系数据上，记忆授权详情均为 8 次查询，单次最多 1 行。事件双向扫描分别为 40/400 次查询，单次最多 51 行，含下一页探测行。聊天两档均为 179 次查询、26 次写入，查询最多 51 行，窗口保留 100 条，整图调用 0。设备覆盖两次真实强停、事务故障、恢复门禁与撤权后迟到结果。增长样本以深链为主，JS 堆峰值和宽关系矩阵未测。[设备证据](qa/kanata-sqlite-m4/completion/evidence/android-final-result.txt)
- 定向 106 项、完整 check 的 660 个 Node 用例和 392 个 Vue 用例全部通过，strict 和构建通过。候选与普通 APK 构建通过。普通 APK 激活 false、无合成页面和合成 SQL 种子，schema 4。[命令与证据索引](qa/kanata-sqlite-m4/completion/README.md)
- [补齐 Preflight](20261109-kanata-sqlite-m4-completion-preflight-v1.md)、[技术增量](20261109-kanata-sqlite-m4-completion-design-v1.md)、[两轮自检](qa/kanata-sqlite-m4/completion/reviews.md) 和 QA 保留命令、退出码、APK/catalog/数据与源码指纹。代码位于 `src/features/chat` 和 `src/application`，测试在 `tests` 与合成设备 QA。来源登记于 [source notes](source-notes.md)。

未跑全范围 UI、宽扇出混合数据、所有 owner 失效组合、完整效果撤销与联系社交回归，故 M5 继续关闭。
