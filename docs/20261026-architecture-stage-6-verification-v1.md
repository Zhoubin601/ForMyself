# P6 原生、Playwright 与整体交付验收

验收批次始于2026-10-26，完成于2026-10-27（北京时间）。P1–P6必要检查全部完成；本阶段随独立阶段提交推送origin/main。

实际源码与合成资料是本轮依据；raw/和memory-bank/未提供，没有读取私人备份或真实API Key。阶段范围和标准见[原计划](20261026-architecture-remediation-plan-v1.md)，P1–P5实现与结果保留在各阶段记录中。

## 交付与架构结果

普通数据读写失败保护、完整恢复协调和认证加密日志、集中模块清单/导航/生命周期、备份与敏感模块能力接口、可替换仓库和渐进严格类型已完成。新增普通模块在模块描述与组合根接入，敏感模块通过能力注册参与加载、释放、改密和备份；业务协议适配仍显式维护，未宣称零配置插件化或整体迁移数据库。存储键、记录ID和完整备份v1–v12兼容规则保留。

P6将JS Todo领域与Java TodoRepository接到同一份8组独立预期夹具，增加原生恢复写保护、真实widget BroadcastReceiver完成/撤销和异步通知接收器检查。质量门禁包含Web完整检查、JDK21/SDK36构建、Android14隔离设备instrumentation及真实WebView Playwright。playwright-core固定1.62.1，既有锁定依赖没有顺带升级。

设备使用Emulator33.1.24、KVM、API34 AOSP ATD、WebView113.0.5672.136、480×800/density160。ATD显式启用真实绘制；Playwright根据DOM按钮位置与实际WebView边界执行Android触控。后台场景切换到仅存在于测试APK的独立Activity，经过真正Android生命周期事件；主APK不含该Activity或测试故障入口。

## 实际检查结果

| 检查 | 结果与范围 | 证据 |
| --- | --- | --- |
| npm run check | 返回0；Node285/285、组件156/156，Vue及strict契约类型、构建通过，lint0错误/47项既有警告 | p6-verification.json |
| Android构建 | :app:testDebugUnitTest、:app:assembleDebug、:app:assembleDebugAndroidTest通过；已有JVM模板仅为算术检查 | 实际CI日志 |
| instrumentation | 8项常规测试通过，1项需手动开启的launcherFixture跳过；包括8组共享规则、真实SharedPreferences、widget接收器与通知状态 | native/instrumentation-ci-results.txt；完整XML由Actions artifact提供 |
| 浏览器常规流程 | 页面巡检、320/390/1280宽度、实际聊天发送/回复、完整加密备份下载/独立解密/文件导入、两种恢复中断通过 | web/results.json、verify.py |
| 浏览器增删改与单项备份 | 体重、省钱、心情、日程新增/编辑/删除，体重加密单项备份下载/解密/导入通过，无pageerror | web/crud-results.json |
| 浏览器实际存储故障 | Storage底层读/写异常保留旧字节与内存修改，点击产品重试后恢复 | web/faults-results.json |
| 浏览器敏感数据与平台事件 | 认证并加载敏感模块后，真实AppWeb事件触发导航及会话释放；非空密码库/聊天/待办参与备份及两类恢复通过 | web/events-results.json、web/with-vault/results.json |
| 减少动效回归 | 320/390/480/1280宽度卡片处于正常布局并可真实点击；修复前失败与截图单独保留 | web/reduced-motion-results.json、reduced-motion-before-fix.json |
| 真实Android Playwright | 20项必需检查全部为true：初始化、主密码持久化、两种入口冷启动、API Key保持、仅请求模块解密、密码库新增、真实聊天回复、深链、后台释放与重新认证、未提交强停回滚、已提交强停保留、改密后聊天/密码库/API Key保持、三张有效截图及减少动效首页布局 | native/playwright-results.json、playwright-cleanup.json、native-*.png |
| 远端CI | Web与Android作业均success，实际测试驱动状态0退出并保存验收包 | [运行40453981333](https://github.com/Zhoubin601/ForMyself/actions/runs/40453981333)，源码1fa44d1 |
| APK核验 | 54个前端资源逐字节相同，0不匹配；ZIP完整、签名有效；无测试故障字面值或instrumentation类进入主包 | native/apk-assets-ci.json、delivery-verification.json、check-delivery.py |

证据路径均相对[qa/architecture-20261026/](qa/architecture-20261026/)。原生恢复直接执行产品协调器、真实存储及真正am force-stop/冷启动；没有另写测试事务代替产品。截图已人工确认分别为首页、聊天和密码库，测试包内只有合成资料，AI回复由受控接口返回，没有验证真实服务商可用性。

## 过程中发现并修复的问题

WebView113把formyself://open/todo解析为空hostname及//open/todo路径，导致合法深链被拒绝。现先校验协议，再按标准HTTPS authority解析；新增待办参数、错误主机/协议及旧WebView行为回归。证据native/legacy-url-diagnostics.json。

平台事件独立、提前注册，单个失败或迟到注册不阻断其他监听，卸载后的迟到句柄仍移除。Capacitor Web首次并发工厂会产生多个实例，浏览器先初始化一次再订阅，实际事件集成验证通过。

视觉复核发现既有减少动效CSS错误地把装饰伪元素的绝对定位、负inset、斜移和pointer-events:none应用到全部首页卡片；旧ff4e0bc源码也存在。已改为仅停用动画，保持布局和交互，浏览器与Android增加实际布局/点击门禁。

保留环境与驱动失败：无KVM软件模拟器异常、Google字体提供者退出、System UI ANR遮挡、ATD默认关闭绘制、WebView CDP能力差异、首次设置未完成即强停、字符串函数/异步Promise谓词提前结束等待，以及SDK清理后轮询句柄保活。当前等待只使用同步布尔谓词，真实浏览器负测拒绝函数和Promise；先确认上次恢复日志已清理再注入下一场景。退出先完成证据写入与有界清理，再按主测试结果结束CLI，失败断言不会变成0退出。完整记录见native/ci-attempts.json、ci-failures/及wait-contract-results.json，失败或取消轮次不算最终验收通过。

## 性能对照

相同主机/Chromium154，拆分前ff4e0bc与最终生产构建交替使用新上下文，预热1次、测3次取中位数。100条保存用10批，编解码分别100批/50批；万条保存单批。当前无项目超过预设20%调查线。

| 浏览器实际路径 | 拆分前 | 本次 | 变化 |
| --- | ---: | ---: | ---: |
| 启动到锁屏 | 314.700 ms | 313.500 ms | -0.4% |
| 保存100条集合 | 6.660 ms | 4.730 ms | -29.0% |
| 保存10,000条集合 | 394.600 ms | 317.200 ms | -19.6% |
| 100条编解码 | 0.335 ms | 0.305 ms | -9.0% |
| 10,000条编解码 | 33.502 ms | 37.348 ms | +11.5% |

performance/browser-results.json保留原始样本、构建哈希和批次。早期万条编解码有1.248比值，已保留原始结果并核对序列化表达式、恢复函数及数据规模；增加批次复测未复现稳定超线，不能唯一归因为GC或主机负载。调查及各轮样本见codec-investigation.json与browser-results-*.json。

独立进程内领域基准domain-repeat-before/after.json：100条4.819→4.366ms、万条1148.09→687.87ms，堆增量中位数约1.239→1.235MB、13.590→13.075MB。最终生产JS总字节801432→820484（+2.38%）。这些不是实体手机性能、Native落盘前后对照或完整进程启动承诺；Native performance marker只供当次WebView观察。

## 安装包与执行边界

[20261027-ForMyself-architecture-p6-debug-v1.apk](../output/20261027-ForMyself-architecture-p6-debug-v1.apk)，11070300字节，SHA256：

`e020dc65c24fef390807ed647998327169ca2dc70c1ef1e1c72368e89b863abd`

APK使用CI默认Android Debug签名，v2签名验证通过。用户原设备的签名与发布密钥未提供，覆盖安装兼容性未核对；保留现有应用和备份，不通过卸载现有应用解决签名不匹配。实体手机、真实生物识别、厂商桌面触控/动画及用户私人备份仍需实际复核。widget自动化验证的是实际接收器与原生布局契约，不冒充物理启动器触控。

P1–P5阶段提交分别为29fb70a、ff4e0bc、f073039、e92cf62、f3ced1c，均已推送。P6作为独立阶段提交推送，验证候选历史保留qa/architecture-p6。若存在未完成恢复日志，必须先用支持日志的版本完成恢复并确认一致，再回退旧代码；不得让旧版本在混合状态下继续写入。
