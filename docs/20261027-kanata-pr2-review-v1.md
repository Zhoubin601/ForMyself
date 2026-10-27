# Kanata PR #2 文档审查与修订记录

日期：2026-10-27（北京时间）。范围：文档完整性、原文忠实度及架构边界；不实施 Kanata 业务，不重新生成开发计划，不合并 main。

## 结论

[PR #2](https://github.com/Zhoubin601/ForMyself/pull/2) 原稿有需要修正的文档缺陷：P0–P7 八条验收句各缺首字，JSON 示例不能解析，feature 占位符未转义。主体七章和六组总控提示词没有整段遗漏。修订后，原始七章正文经过明确的格式归一与 TXT 一致，八条验收句逐字一致，JSON 示例可解析。设计方向与现有架构说明没有直接冲突；对易被误读为已实现的能力增加了边界说明。

建议：**修订版可以作为纯文档 PR 交由用户决定是否合并**，本轮未发现阻塞该文档合并的剩余问题。此结论不等于需求冻结、P1 实施授权、应用功能完成或应用测试通过。Q01–Q12 产品/实现问题继续保留在 [questions](questions.md)。

## 审查对象与来源

- 原 PR HEAD：`19fd232790a1ea9022fd25eeb2d3d8418a43e638`。
- 原 PR base/main：`41cbb66053bd5b9995b358c0c4846669e626bcc0`。
- PR head 分支：`docs/kanata-technical-design-v1-20261027`；原始改动只有 `docs/20261027-kanata-technical-design-v1.md`，新增371行、无删除。GitHub 返回 open、merged=false；无业务代码改动。
- 已提交并推送的文档修订：`f13dee7e849dadcf1cd1520d95334bf6ae138f0a`，仅修改同一技术设计文档；原PR继续只涉及这一个文件。
- 原始对照：[技术设计 TXT](<../raw/彼方 · Kanata 技术设计.txt>)，SHA-256 `da0ee3216239779cebc9b1737b8ff6952bf3b6ae053b286d1bbcf1ece1e80cc5`；另读完整需求清单以区分“技术骨架完整”与“全部产品验收覆盖”。
- 规范依据：[AGENTS](../AGENTS.md)、[架构接口与Agent开发说明书](../架构接口与Agent开发说明书.md)、[长期背景](../memory-bank/development-context.md)。
- 本轮当前分支仍为 `Kanata`。通过 `git merge --ff-only origin/docs/kanata-technical-design-v1-20261027` 将原PR提交加入本地Kanata历史；这只是本地功能分支快进，没有把PR合并到main，也没有产生合并提交。之前P0修改和raw文件完整保留。
- 用户后续明确授权“完成后提交远端”，因此本轮允许文档提交和推送；原始TXT/历史P0里的禁止提交提示仍作为当时任务记录保留，不改写其原文。

## 已发现并修正的问题

| 编号 | 原稿证据 | 修订与判断 |
| --- | --- | --- |
| R01 | 原稿221/230/239/248/257/266/275/284行分别为“划”“世界”“备份”“式”“换”“复任务”“复打开”“规质量” | 按TXT恢复“计划”“跨世界”“旧备份”“格式”“切换”“重复任务”“重复打开”“常规质量”。其中“跨世界”“旧备份”丢字会弱化验收范围，应在合并前修复。 |
| R02 | 原稿110行开始的json代码块使用未加引号的id/worldId等键，json.loads失败 | 补全JSON键引号，字段值与示例意义保持不变；现可实际解析。 |
| R03 | 原稿300行 `src/features/<feature>/` 为裸文本 | 加行内代码标记，避免feature被当作HTML标签隐藏；总控提示词内容未改。 |
| R04 | 原文“新数据模型v5”和“继续使用恢复日志”缺少明确的实施边界 | 增加独立第八节：v5是候选；数据/单项备份/全备/日志独立版本化；世界事件撤销不等于存储恢复；正文原文保留。 |
| R05 | 页面/生命周期/备份/敏感能力分开注册、旧队列排除、AI返回契约等不在原骨架中展开 | 第八节按实际规范补充约束，不另起P0–P7计划，不把补充写成已实现。 |

## P0–P7 与总控提示词完整性

| 阶段 | 原始主题 | 对照结果 |
| --- | --- | --- |
| P0 | 需求冻结与架构基线 | 主题/过程保留，恢复验收首字“计” |
| P1 | 纯数据模型与迁移测试 | 主题/过程保留，恢复“跨世界” |
| P2 | 存储与备份兼容 | 主题/过程保留，恢复“旧备份” |
| P3 | 角色卡与世界书 | 主题/过程保留，恢复“格式” |
| P4 | 多世界私聊与群聊 | 主题/过程保留，恢复“切换” |
| P5 | 长期记忆与事件账本 | 主题/过程保留，恢复“重复任务” |
| P6 | 虚拟生活与离线恢复 | 主题/过程保留，恢复“重复打开” |
| P7 | 安全、性能与交付 | 主题/过程保留，恢复“常规质量” |

第七节六组提示词逐组存在：必须保留的架构、必须先阅读、工作前检查、目标领域模型、数据安全、当前只执行P0。归一比较确认其正文与原TXT一致，包括十种目标实体、v4迁移、错误保全、合成资料、不得虚报测试、六项P0输出及等待确认后进入P1。

比较方法仅消除空白、Markdown标题/粗体/行内代码、表格边界、代码围栏、重复在标题显示的阶段名称，并将JSON键的格式引号还原后比对。没有消除中文汉字、阶段描述或验收要求；八条验收另作逐字比较，避免归一规则掩盖丢字。

## 与实际架构规范的核对

| 规范/源码事实 | 设计关系与补充 |
| --- | --- |
| 模块化单体；业务features、跨业务application、平台platform | 原文一致，不迁完整外部运行时；新增能力分别注册 |
| chat数据/单项v4、全备v12；normalizeChatData只保留固定字段 | 原文版本事实正确，v5明确为建议；迁移不得先过旧normalize剥新字段 |
| 全备参与者/文件格式显式映射；旧v1–v12继续兼容 | P2方向一致；升级需同步DTO、participants、fullBackup及设置分派 |
| 完整恢复走实际协调器和AES-GCM日志，回滚失败保持门禁 | 原文一致；明确不是世界事件因果撤销，也不是底层数据库ACID事务 |
| 敏感模块懒加载、租约、释放、重加密和失败flush | 原文要求保留；补全真实能力接口与结果检查 |
| AI客户端参数注入、旧接口返回字符串；askAI无signal/usage | 原文“统计/超时”是目标；不写成已有能力，不用改返回值破坏旧调用 |
| 旧备份清空proactive/followup outbox；UI100条切片仍全量内存 | 这些现状本轮只记录；任务恢复策略和真分页性能须后续实施验收 |
| 纯文档只需检查链接、接口、示例、忽略和差异 | 本轮按此检查；没有执行或声称通过应用构建、Node/Vitest、Android/E2E |

核对了chatRecords/chatStorage/chatPersistence、chatStore门禁、backupParticipants/fullBackup、fullBackupRuntime/restoreCoordinator、protectedModules/protectedAccess、AI客户端及设置页分派；未修改这些文件。完整需求中的生活授权、统计、自治和原文清理等仍按已有P0覆盖表和Q清单进入后续阶段，本文的忠实转录不能替代全部需求验收。

## 实际命令与检查结果

- GitHub连接器：search_prs、fetch_pr、list_pr_changed_filenames、fetch_file，定位并读取PR正文、状态、文件清单和内容；首次两个调用字段名错误被schema拒绝，改为repo_full_name后成功，没有远端写入。
- `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`、`git diff --stat`、`git diff --cached --stat`：确认Kanata及先前5个已跟踪修改/3份raw。
- `git ls-remote --heads origin main Kanata docs/kanata-technical-design-v1-20261027`；`git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main refs/heads/docs/kanata-technical-design-v1-20261027:refs/remotes/origin/docs/kanata-technical-design-v1-20261027`：只取目标分支；初始远端尚无Kanata。
- `git diff --name-status origin/main...origin/docs/kanata-technical-design-v1-20261027`：只有技术设计文档；受限业务路径diff为空。`git merge --ff-only ...`快进成功，原有工作保留。
- `cat/sed/rg/nl`读取原始TXT、设计文档、架构规范、源码定位；原文和修订版的七章、P0–P7、总控提示词程序比对通过。
- `python3 /workspace/work/kanata-pr2/verify_review.py` 返回0：8阶段/8条验收/6组提示词、1段JSON、10个本地链接；对本轮开始时845个文件核验（四docs仅追加），原始资料和业务代码不变。
- 原PR修订的 `git diff --check`及暂存差异核对通过；仅stage技术设计后提交 `f13dee7`，已普通push到原PR分支，未force。Kanata加入raw原始TXT后，全量暂存格式检查会报告原文CRLF、尾空格和尾空行；保留原始字节，不将该次记为通过。修订Markdown/忽略规则单独检查通过，附件另以哈希和逐字节比较验收。
- 后续Kanata提交会包含先前P0记录、三附件的原样副本/精确忽略例外，以及本次审查记录。最终提交和远端指针以交付时git核对为准。

本次审查没有发布PR评论或代替用户提交批准审查，没有调用merge接口，没有push main，没有开始P1。后续是否合并由用户决定。
