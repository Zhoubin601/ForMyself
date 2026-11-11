# ER1 生命周期证据

| 实际入口 / 场景 | 本轮证据 | 未覆盖 |
| --- | --- | --- |
| Ledger 预览翻页时关闭 | 01 失败、02/16 组件复测；旧 guard 抛 EXPIRED、迟到页不发布，新请求不被旧 finally 覆盖 | 独立 Android 1k/10k UI 查询计数 NOT RUN |
| 角色/关系/前因选择翻页关闭 | scope 请求失效，迟到页不复开 | Android 专用矩阵 NOT RUN |
| Audit / Effect Audit 请求中关闭 | 16 组件实际状态与 guard；新增关闭 Audit 入口，可在 busy 时取消 | Android 独立关页/取消矩阵 NOT RUN |
| 撤销成功关闭旧审计 | 16 检查 setupState.audits/effectAudit 均 null，隐藏对象被释放 | Heap retained object 分类 NOT RUN |
| Ledger 卸载时确认框未完成 | 组件既有回归保留；unmount 取消 owned dialog，confirmRevocation 未执行 | Android 系统返回与锁屏组合 NOT RUN |
| Workspace 因果入口 | 静态核对 loadEventGraph → Runtime.eventGraph → graphPage；关闭/切 section/clear 的 generation 机制仍在 | 独立 Android 请求中关闭矩阵 NOT RUN |
| owner / cursor / world / role / session | 既有 Runtime 测试进入本轮全 check；旧 Runtime legacyEvents 无消费者并已删除 | 本轮专用 UI 全组合 NOT RUN，不能继承历史 PASS |
| grant 撤权 / 解绑 / 世界归档 / 恢复门禁 | 当前受保护 candidate query/execute 前后复核租约；普通回归有各自范围 | 完整事件页面组合 NOT RUN |
| 事件页 provider 迟到 | 事件读取本身无 provider | N/A；未虚构 provider 场景 |

页面实际使用 managedEvent、compact revocation、revocationAudits、revocationEffectAudit。没有发现页面使用 eventReadFor/eventRelations/eventEffects/eventAudits/eventJsonChunk，后者按 Runtime/Repository 测试归类。

独立审查复现 revocationEffectAudit 返回 10,000 字符 value；该专用 UI API 尚无长值 chunk 标志。每页最多 50 条不能证明字段有界。完整 Event 回退及旧 Facade 同样尚在，ER1-4 不得 PASS。

本轮没有用单次 heapUsed/performance.memory/RSS 冒充 retained 证据。Heap snapshot、强制 GC 后对象类别、Pinia/局部状态逐类峰值和 1k/10k 分阶段量化见 memory-summary.json，未测值为 null/NOT RUN。
