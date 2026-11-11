# ER1 两轮独立审查

两个独立 Agent 均先因服务额度中断；恢复后重新派发并完成当前源码/变更审查。首次中断不记 PASS。审查完成不等于 ER1 完整验收通过，也不替代设备/Heap 矩阵。

## 第一轮：安全、权限、数据、事务

独立审查者：/root/er1_security_review。只读，未操作设备或真实数据。

- 全范围检查 EventRepository、EventRead、EventSnapshot、EventRevocation、MessageDependents、World Runtime、candidate 的 guard 与 query/execute、Schema 和测试 Oracle。
- 独立合成 SQLite 复现 revoked 后代漏出、无关事件签名不变、字符串 action 撤销审计不展开、混合 disposition 的审计顺序不同。
- 独立 rest/uncertain 探针：旧 adapter confirmed 后 uncertain，compact 按混合 ID 顺序；最终 mood/energy 相同但不能据此宣称 revision/audit 与纯领域等价。纯领域分两次 changeEventStatus 的 revision 差异未由该探针实跑。
- 复现 revocationEffectAudit 可返回含 10,000 个“界”的 value，无字段分块；ER1-4 保持 BLOCKED。
- 新 Runtime 包装删除无真实产品调用；新 Ledger request sequence/scope 未发现新增权限绕过。candidate 每条 I/O 前后复核 guard。
- 审查发现成功撤销后仅隐藏 audits、effectAudit 仍可能被引用。改为 closeAudits() 清理；16 组件复测检查实际局部 ref，7/7 通过。
- 一次独立探针未将 fixture seed 放入事务，外键失败；改为已有 fixture 整体事务后复现成功。此为探针修复，不是产品修复，主 Agent 的可复现反例另保留在 06/13。

结论：当前安全变更可保留；语义与有界性仍 BLOCKED。没有验证 Android 全故障/Heap 矩阵。

## 第二轮：产品、兼容、页面、平台与证据

独立审查者：/root/er1_compat_review。只读，未操作设备或修改文件。

- 核对 raw 事件/历史修正要求、纯领域 Oracle 与历史 adapter 分离；确认 QA legacy 消费者没有被漏当生产入口或无消费者。
- 独立复跑 Oracle 新增测试的早期 3 项、组件 6 项通过；兼容探针退出 1/BLOCKED，顺序探针退出 1/BLOCKED。后续权威测试增至 4/5 项，由本轮最终 check 覆盖，不将早期计数冒充最终数。
- 检查四个关闭 scope 的迟到页不会重开或覆盖新请求。剩余完整 Event/Audit materializer 调用明确保留。
- 指出独立历史 extensions Oracle 最初只 JSON.parse，未保留 64 层和非有限数拒绝。已补独立 historicalExtensions（未导入生产 clone/materializer）及深度边界、Infinity、-0、__proto__ 数据属性回归。
- 指出旧文档仍“待确认权威”；已按用户决定覆盖为纯领域唯一权威。rowid 结论仅为尚无恢复证明，未夸大为所有插入丢序。
- 核对 Android 原生 Spike 只断言 raw 保留，decodedEqual 是测量字段；本次设备日志均为 true，但不推广到 JS/native 业务路径。1k/10k 是混合字符串重复次数，不冒充事件四条写路径矩阵。

结论：ER1 BLOCKED；完整设备生命周期、retained Heap、Store/局部对象峰值、字段级业务实现和顺序恢复证明均未完成。

## 最终增量复核

两位原独立审查者均再次只读复核 closeAudits() 和 historicalExtensions 修复，未发现新增问题。第一轮独立运行 Oracle 5/5 通过；第二轮独立运行 Oracle 5/5、组件 7/7 通过。两者都未操作设备或重跑全量 check；693 Node / 402 Vue 的完整 check 来自主 Agent 的 15-final-check.txt，不归给独立审查者。此前语义/完整物化/宽字段和内存阻塞不变。
