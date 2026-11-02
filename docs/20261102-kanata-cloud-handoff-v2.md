# Kanata P7 续作与远端检查点 v2（2026-11-02）

**从 Kanata 分支继续；P7 仍 IN PROGRESS / No-Go。** 用户最新明确要求“你先推送吧”，本次据此普通提交并推送本轮未完成检查点，不代表 P7 放行或安装包发布。此前“未获得新推送授权/未提交”的段落是开发结束时的历史状态，由本节的新授权覆盖。实际提交 SHA 以包含本文件的 Git 提交及远端核对结果为准。

## Git 与阅读入口

- 推送前基线：`ddd3f10e2daf1c3675dbd05bac3425157d1a2ef4`；本次 fetch 后与 origin/Kanata 一致，未合并 main、强推、reset 或 clean。
- 业务工作区：`.worktrees/kanata` 的 Kanata。main 原有四份过程文档修改、旧 output APK 删除和未跟踪资料保持。
- 先读根目录 AGENTS、架构接口规范，再读[本轮详细检查点最终节](20261102-kanata-p7-archive-planner-v1.md)、[结构化摘要](qa/kanata-continuous/p7/verification-summary-latest.json)、[完整文件清单](qa/kanata-continuous/p7/changed-files-20261102.json)。阶段门禁仍为[连续执行计划 v3](20261028-kanata-continuous-execution-plan-v3.md)，原需求和五人预设继续有效。
- [上次云端交接](20261031-kanata-cloud-handoff-v1.md)仍可用于环境与历史背景；其最新候选/测试数及本地停止说明由本文件覆盖。

## 本轮实际实现

1. 归档规划使用紧凑索引并查集，保持50条页上限、完整回复组件、近期记录、所有来源及跨世界边界，未解除密集来源保留。
2. AES/恢复日志的字节转换减少逐字节迭代分配；固定盐与旧 CryptoJS 密文逐字节相同，原加密/派生/填充/UTF8/BOM与恢复协议不变。
3. `scripts/patch-capacitor-filesystem.mjs`由postinstall幂等修补Filesystem 8.1.2 Web目录读取，最多4条一批，失败整批settle再拒绝；ESM/CJS/browser全覆盖，未知版本/残缺补丁拒绝。不更改DB、存储键或原生Java。
4. 修复真实Android强停保存后冷启动读到pending恢复记录，却停在setup的问题：全图与归档metadata检查成功后完成已授权密文待写，再发布ready；失败保留旧主/恢复材料，完整恢复blocked/busy时仍由协调器处理。会话过期不接受晚到结果，load本身不调用AI。
5. 增加算法对照、兼容和真实仓库异常测试，修复QA cold()已换WebView但失败清理仍用旧页面的缺陷。保留最初失败及守卫恢复证据。

## 最近完成的验证

- `npm run check`：575 Node、388组件/41文件，lint0错误42既有警告，strict/build退出0；日志`check-pending-recovery-20261102.txt`。本次提交推送准备只更新交接/交付元数据，未重跑或改写这些业务测试结果。
- 最新生产APK：`04e427d7cce23ecdb2d69f732f3f3cb232507b6477aa5250ec1cd1365a58c220`，78资源匹配，无QA入口。构建与实际原生8通过/1 Assume跳过/0失败已执行。
- 最新Web/隔离Android各13项生产回归通过；每端7次受控HTTP尝试（含故意500），0真实模型调用/页面错误。Android明确`recoveredFromBackup=true`且pending/error清零，真实前台生命周期续接一次。
- 608条合成消息/审计及七模块、设置、metadata已归还并独立核对；Todo仅按原CAS递增，心情自动补记按原规则逐项验证；真实Home后台明文释放通过。没有待续接的改密、恢复或测试事务。

证据均在`docs/qa/kanata-continuous/p7/`。SDK、AVD、APK、冻结dist和用户外部Key不推送。仓库内`.enc`仅为明确隔离的合成夹具。

## 未通过与下一步

- **最新04e4候选未重新跑三档容量，必须标NOT RUN。** 不把其他候选结果套到当前APK。
- 最近完整Android容量为3f39候选：1k/10k通过；100k峰值496.6MiB、恢复103.7s通过，首次改密207.9s失败，改回101.7s通过，不能只挑较快方向。
- 最近完整Web容量为2789候选：1k/10k通过；100k恢复22.85s/改密16.36s通过，最终进程峰值883.0MiB超过768MiB失败。所有旧失败及诊断保留，累计采样分配不是RSS门禁。
- 继续先分阶段诊断原生改密/文件退休I/O与Web完整恢复/导出图生命周期，再实现有界改进；不强制GC、不提高阈值、不删来源或绕过读回验证。
- 密集来源分页、旧生活AI/提醒角色链、全应用统计/日期趋势、高级情绪关系决策及最终15场景/预设/旧备份清理综合回放仍未收口。P1–P6为既有阶段验收，不能据此把P7标完成。

云端先`npm ci`（保留全部postinstall补丁）再按变更运行check和定向测试。Windows Chrome/SDK/JDK/AVD路径与Linux适配说明见旧交接；没有设备时如实记相应项NOT RUN，继续独立工作。用户已允许隔离模拟器，缺真机不单独阻断；真实模型需要私密配置，不能把Key发聊天/写仓库。

真实旧温馨小家资料仍只能在实际应用流程当次确认后清理，本次没有清理真实数据。普通提交与推送仅针对本次明确授权，不合并main、不建PR、不发布APK。
