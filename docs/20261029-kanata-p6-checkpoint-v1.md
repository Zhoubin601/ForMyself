# Kanata P6 接续检查点（阶段未验收）

2026-10-29，分支Kanata，工作树`.worktrees/kanata`，前置P5已PASS并普通本地提交`be9ebc3dbe1a08e14575e044875426f0648c0179`。当前用户继续开发，无须阶段间重复确认；本次没有推送授权扩展、PR、发布或真实资料清理。

## 当前实际实现

第一批可运行修改为时间窗口纯规则、可选配置/虚拟日程校验与受保护持久化门面，尚未接入用户开关/组合根恢复事件，也没有自动执行。schema1/full v13兼容，不增数据库/存储键/加密协议。

- `src/features/chat/autonomy/kanataAutonomy.js`：三开关独立setter；自治开关变更从当前水位起算，不追补关闭期间。30分钟UTC窗口、最多6窗口/次、最大3小时默认补算，旧时间跳过显式记录。时钟倒退不降低水位，时区/DST不拿本地时刻作为唯一键。启用角色的显式虚拟日程可以通过P5已确认规则生成move/rest，明确标注恢复后规则补算，不捏造聊天原文。没有日程不虚构活动。
- `autonomyValidation.js`：自主配置范围、精确实例世界、周日程、重叠地点冲突、重复/全局ID冲突、任务窗口记录。先逐行校验再检查交叉冲突，畸形后行得到稳定错误码。
- `src/application/kanataWorldRuntime.js`：只暴露受保护advance/setActivity/dispose；无后台定时器、AI或直接文件写。runOperation租约/会话/恢复门禁；每窗口Store.update实际持久化后才取下一窗口。失败草稿在内存保留，但磁盘水位不变，saveError/hasPendingSave阻止继续补算；过期/dispose不写。
- `kanataTypes.d.ts`新增可选autonomyPolicies/virtualSchedules、task.simulationWindow；实际校验/contract ReturnType/负向类型样例同步。

## 实际测试与本批自查

证据目录`docs/qa/kanata-continuous/p6/`。

1. `node --test tests/kanataAutonomy.test.js`：初次10通过；自查后12通过，core-reviewed.txt。覆盖关闭/重开、纯函数无副作用、重复计划、30天离线六窗口/跳过时间、倒退/时区/DST、每日0对话只规则事件、日程作用域/重叠/边界、状态变化使旧计划失效、非法时区、畸形后行、伪造未来窗口。
2. `npx vitest run tests/KanataWorldRuntime.spec.js`：初次4通过1测试适配器名称错误，runtime-first.txt保留；按真实buildKanataChatBackupSnapshot/readKanataChatBackupSnapshot修正，5通过，runtime-after-adapter-fix.txt。真实Store覆盖六窗口磁盘保存、再次恢复零工作、写失败磁盘水位不变/待写保留且禁止推进、会话过期、dispose、真实备份适配器窗口信息往返。未发AI。
3. `npm run typecheck`：退出0，types-first.txt；负向例之后包含在全check。
4. `npm run check`：初批退出0，check-slice.txt；修复后最终退出0：Node500/500、Vitest278/278（31文件）、类型/strict负向/生产构建通过，lint0错误41警告，check-slice-final.txt。不能用P5 Android结果标本批通过，当前Android/Web新自治交互未运行。

第一轮架构/安全自查：发现Store保留失败草稿时，单看内存lastSimulatedAt可能误推进；加入pending/error显式门禁，真实Store测试检查磁盘仍旧水位且任务0，内存保留1项待写，再推进拒绝。计划包含实例/日程签名，状态变化或世界/时区/策略revision变化不写旧计划；未来/伪造窗口被拒绝。

第二轮需求/异常自查：发现日程冲突检查会先访问尚未校验的后行，畸形导入可能抛泛型TypeError；改两轮结构/交叉检查并加入稳定错误码断言。关闭期间不补算、上限0不生成完整对话、DST重复小时和跨日均有行为检查。尚无社交/UI，不能据此宣称P6需求全覆盖。

## P6门禁状态与下一批真实文件

P6 **IN PROGRESS / No-Go**；P7尚未开始。此为连续开发上下文检查点，不是环境阻塞或产品降级。

- 门禁1时间/水位已有纯规则及Store证明；还需真实组合根恢复与设备中断验证。
- 门禁2目前只有配置默认0及无聊天的规则补算；角色间完整对话、每日次数/每场消息/AI请求技术上限、总事件量与多世界公平调度尚未接入。
- 门禁3已有虚拟日程冲突校验和原子move/rest；社交候选、共同地点/用户群聊事件关联及重复演出防护尚未实现。
- 门禁4三开关setter独立，但主动联系、持久化延迟任务、本地通知适配器/免打扰/拒绝/过期丢弃尚未实现。
- 门禁5普通/上帝视角尚未实现；当前P5经历管理是用户管理入口，不能当成正式双视角验收。NPC上下文仍用P5授权规则，禁止把管理查询的全图交给模型。

下一步按v3继续小批实现：autonomy内社交/知识投影与任务规则→application受保护社会请求/每attempt记录→新平台本地通知适配器→生命周期参与者注册（复用moduleLifecycle/组合根，不添按模块条件分支）→WorldManager的世界活动/双视角UI→实际Web/Android/真实模型有限合成验收。需要先读这些真实接口，尤其kanataConversation当前主动拒绝character会话，不能绕过它传全图或编造用户消息。所有新通知只能用新的明确ID命名空间，不能影响现有Todo/日程/生活提醒或未经确认触碰旧chat通知。

不提交“已完成P6”的检查点、不推送；保留工作树未提交源码和证据供下一段直接接续。真实用户资料未读写，raw不改，main原64行修改及APK删除继续保留。P5报告/证据仍对应其已提交APK；当前dist经P6构建已变化，后续原生测试必须重新cap sync/build/SHA校验，不能使用P5的verification.json作为新包证明。

## 后续状态覆盖（2026-10-29）
P6已完成后续社交/主动/通知/延迟/双视角及最终Android17验证并PASS，见20261029-kanata-stage-p6-verification-v1.md。用户明确接受raw指向本地模拟器作为本轮P7设备目标，缺少真机不再是本轮阻塞；P7仍需容量/真分页和完整需求收口。本文件保留早先首批记录，不按其中旧“未实现”状态重复开发。
