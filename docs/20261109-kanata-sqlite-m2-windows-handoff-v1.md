# Kanata SQLite M2 Windows/WHPX 接续 v1

2026-11-09（Asia/Shanghai）。用户已在本轮明确选择“使用此前已验证的Windows/WHPX合成AVD”，不需要再询问平台选择。当前云会话只连接Linux，没有Windows执行通道；本页用于将已完成工作完整带到所选环境，不表示M2实现或验收完成。

正式状态：[M2 BLOCKED报告](20261107-kanata-sqlite-m2-acceptance-v1.md)。基线`de3164b8de569f57a250d0592eae5a21345e5264`；本轮普通检查点/推送SHA见[发布回执](qa/kanata-sqlite-m2/evidence/publication.json)及Git历史。未修改生产源码/Android/根锁，生产仍legacy。

## 已完成，不要丢失

- [Preflight](20261107-kanata-sqlite-m2-preflight-v1.md)：来源/调用链/依赖/数据状态与安全边界。
- [技术设计](20261107-kanata-sqlite-m2-design-v1.md)：已冻结并完成编码前源码自审；后续与最新M差异核对后实施。
- [QA](qa/kanata-sqlite-m2/README.md)：两次完整check624/392、34项定向、主机SQLCipher4.12的9组检查/2个真实SIGKILL，均已实际通过。它们只属既有基线复核，不是M2通过。
- Linux全新API34 TCG的静态WebView与最小Capacitor8.4.1两上下文均真实code5/SIGTRAP；原始失败、晚到观察、图形绘制尝试、工具链修复及APK读回SHA均保留，不覆盖成PASS。
- 生产Driver/Repository/UI未开始，任务书§8两轮实现后自检未运行，M3不得开始。

## Windows接手顺序

在Windows本地Codex中打开ForMyself仓库并带入原始完整M2任务书，继续执行本任务。先读AGENTS/根开发说明/完整任务书、本页与设计；核对已有工作区修改并保留，不reset/clean、不覆盖已存在M2工作。

```powershell
git status --short --branch
git diff --stat
git rev-parse HEAD
git fetch origin refs/heads/M:refs/remotes/origin/M
git ls-remote origin refs/heads/M
git rev-parse refs/remotes/origin/M
```

只在M工作。工作区有其他修改时先隔离/审阅；干净且可快进才沿普通ff-only更新，不能为拉取本检查点抹掉Windows原有工作。若远端HEAD比本检查点新，重新核对设计/源码，不盲用本页SHA。

历史Windows环境来自[M0目标记录](20261104-kanata-sqlite-m0-target-emulator-v1.md)：SDK `E:\Android`，WHPX，API34 Google APIs x86_64 AVD `kanata_m0_api34`，历史serial emulator-5580。**这些只是历史定位，不是当前设备安全凭证。** 先核对本机SDK路径、AVD名/API、启动状态、安装包及syntheticOnly标记；不能因为名字或历史记录就clear/install到当前设备。不要读取用户聊天/真实主密码/API Key。

先验证Node24、完整JDK21（含javac）、根lock对应npm ci/postinstall和当前Android Gradle依赖，保持根Capacitor lock8.4.1。复测最小的独立合成WebView/Capacitor ping，确认真实JS→Native→JS可用后，从任务书§11第3步开始生产候选Native Driver。

## 必须继续的工作

1. 最小生产Native Driver：M0兼容DEK字节密钥/信封/lease、FK池/WAL/FULL、参数化固定SQL、事务/affectedRows、JS migrateKanataSchema；001/002/003不改。
2. 消息/会话Repository：增量单条/≤256批次、scope keyset≤50、CAS/审计、按ID/quote、完整删除派生同事务；与纯函数逐项对照。先通过故障测试才接UI。
3. Runtime/UI合成注入：≤100窗口、翻页锚点、群聊speaker/气泡/retry、character原权限、按需AI/迟到保护。生产legacy不切换，不双写，不导入/清理旧数据。
4. 真实Android SQLCipher4.17：生产候选桥接注册后JS调用升级器与Repository，错密/challenge/旧lease/FK/WAL、close/reopen、事务未提交强停重开。不能只跑原生JUnit或编译。
5. 实现后两轮独立自检；再跑最终完整npm run check、定向/strict、主机SQLCipher、Android构建/设备JS E2E。保留所有实际失败/修复/复测及代码/DDL/夹具/APK指纹。
6. 全部门禁PASS后才更新正式验收为新版本并建议进入M3；本轮BLOCKED报告和Linux原始证据保留。普通commit/push M，禁强推/main合并/发布。

用户当前授权持续有效：完整执行M2，必要普通提交推送M，保护已有修改，只用合成数据；无需为例行开发、测试或本阶段普通推送再次确认。遇到跨阶段切流/安全语义冲突或新的真实外部阻塞才停下说明。
