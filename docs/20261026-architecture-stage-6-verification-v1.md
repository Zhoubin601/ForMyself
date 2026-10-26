# P6 原生、Playwright 与整体交付验收

日期：2026-10-26（北京时间）。原生 WebView 验收执行中；本文件尚未标记最终通过。

本阶段让 JS Todo 领域与 Java TodoRepository 读取同一份独立预期 JSON，覆盖一次性、每天、每周、自定义间隔、跨月/闰日、历史保护、覆盖与完成状态。8 组夹具同时进入 Node 常规测试与 Android instrumentation。新增原生测试验证恢复日志存在时桌面写入明确拒绝，旧数据字节不变。提醒测试等待实际异步接收器结束后检查通知，避免把广播尚未执行误判为通知失败。

CI 保留 npm run check，并新增 SDK/JDK/KVM 准备、应用级 JVM/测试包构建、Android 14 隔离模拟器 instrumentation、真实 WebView Playwright 和报告/APK 上传。构建任务显式限定 :app，避免聚合任务意外构建外部 Cordova 库的测试包。新增测试依赖 playwright-core 固定为 1.62.1，既有依赖版本不变。先在 qa/architecture-p6 验证分支执行，远端实际运行状态另行记录，不能将本地通过写成远端 CI 通过。

## 已执行的检查

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| npm run check | 返回 0；Node 283/283、组件 154/154，Vue/strict 契约类型及构建通过，lint 0 错误/47 警告 | p6-verification.json |
| Android 应用构建 | :app:testDebugUnitTest、:app:assembleDebug、:app:assembleDebugAndroidTest 返回 0 | 构建摘要纳入 p6-verification.json |
| 实际 instrumentation | Android 14 专用模拟器，7/7 通过；包括 8 组共享规则、恢复保护及现有 Todo/通知/组件检查 | native/instrumentation-results.txt |
| Playwright 浏览器用户流程 | 页面巡检、320/390/1280 宽度、聊天发送与真实回复、完整加密备份下载/独立解密/文件导入通过 | web/results.json、截图及 verify.py |
| Playwright 实际界面增删改及单项备份 | 体重、省钱、心情、日程各完成新增、编辑、删除；体重单项加密备份下载、独立解密、文件导入通过；无 pageerror | web/crud-results.json、crud.py |
| Playwright 实际读写失败界面 | 在真实 Preferences Web 驱动的底层 Storage 注入读取/写入异常；旧字节不变，未保存修改留在内存，点击产品重试按钮后恢复 | web/faults-results.json、faults.py、390-save-error.png |
| Playwright 浏览器恢复中断 | 产品实际协调器写入后 reload 回滚；提交后清理失败再 reload 保留新快照 | web/results.json |
| APK 前端资源 | 54 个文件与本次 dist 逐字节一致，0 不匹配 | native/apk-assets.json |

证据目录均相对 [qa/architecture-20261026/](qa/architecture-20261026/)。instrumentation 的 7 项包含 Android Context/SharedPreferences 与真实通知检查，不冒充纯 JVM 领域单测；已有 JVM 模板仅为算术检查。

## 性能对照

在相同主机、Chromium 154、交替的新浏览器上下文中，对模块拆分前 ff4e0bc 与本次生产构建各预热 1 次、实测 3 次，比较中位数。小集合 100 条、历史集合 10,000 条；短操作使用多批次，避免亚毫秒测量噪声主导结论。

| 浏览器实际路径 | 拆分前 | 本次 | 变化 |
| --- | ---: | ---: | ---: |
| 启动到锁屏 | 305.3 ms | 340.9 ms | +11.7% |
| 保存 100 条集合 | 5.69 ms | 5.17 ms | -9.1% |
| 保存 10,000 条集合 | 408.0 ms | 274.6 ms | -32.7% |
| 100 条编解码 | 0.319 ms | 0.318 ms | -0.3% |
| 10,000 条编解码 | 35.94 ms | 32.24 ms | -10.3% |

证据 performance/browser-results.json 包含原始样本、批次数和环境。首次短操作测量有超过 20% 的噪声，保留 browser-results-first.json；增加批次后复测未触发预定调查线，没有隐藏首次结果。独立领域基准复测（domain-repeat-before/after.json）：100 条约 4.819→4.366 ms、万条 1148.09→687.87 ms，堆增量约 1.239→1.235 MB、13.590→13.075 MB；生产 JS 总字节 801432→820212（+2.34%）。这些是浏览器与进程内证据，不是实体手机性能、原生磁盘落盘耗时或所有设备体验承诺。

## 失败与执行边界

保留首次 Gradle 设备属性获取超时 XML，以及早期原生通知断言失败的输出。软件模拟器无 KVM，旧 API 30 镜像曾发生系统服务重启，未将这些轮次算作通过。最终原生规则结果使用新建 Android 14 AOSP ATD 模拟器直接执行实际 AndroidJUnitRunner；没有用改写事务的测试替身代替产品恢复。

实体手机、真实生物识别和不同厂商桌面的适配不由本机模拟器结论覆盖。正式包不加入测试故障入口；浏览器/原生 Playwright 只在独立合成会话内替换实际参与者方法制造中断，再由产品恢复代码读取真实持久化材料。

## 交付与回退

P1–P5 已分别推送：29fb70a、ff4e0bc、f073039、e92cf62、f3ced1c。P6 待全部必要验收完成后单独提交并推送。完整备份 v1–v12、业务存储键和数据格式沿用原兼容规则。若存在未完成恢复日志，应先用支持日志的版本完成恢复，再回退旧版本；不得直接让旧版本在混合状态下继续写入。
