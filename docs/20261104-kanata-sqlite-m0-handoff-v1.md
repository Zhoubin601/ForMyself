# Kanata SQLite M0 提交与交接 v1

## 放行后接续（2026-11-04）

**M0 隔离技术验证通过，M1 尚未开始。** 当前结论以 [M0 放行报告](20261104-kanata-sqlite-m0-direct-gate-v1.md) 为准。用户授权把 M0 原型、冻结参数和验证证据提交到远端 M。云端接续时从 `origin/M` 取本次放行提交，读 [迁移计划](20261103-kanata-sqlite-migration-plan-v1.md) 的 M1 门禁。

云端可继续 Schema、Repository、迁移器与故障测试。Android 会话、Keystore、进程中断和最终容量对照使用已确认的本地隔离 AVD 配置。设备和生成文件位于本机忽略目录，可按 [QA 复现说明](qa/kanata-sqlite-m0/README.md) 重建。M0 结果限定于隔离探针，产品接入与 M7/P7 门禁按各阶段验收。

## 历史检查点（`98fd0a3`）

日期：2026-11-04（北京时间）。用户本次明确授权“提交远端”。目标仅 **M**，保存 M0 原型、脚本、报告与证据，不代表 M0 验收通过，不进入 M1，不合并 Kanata/main 或发布 APK。

提交前本地与远端 M 均为 `ac74f0b817ac32f65d9f5e506f094b1515477cc6`，差异0/0。工作区已有修改均为本会话 M0 产物；未改生产 src、android、根 package/lock。当前 checkpoint 的实际提交号查看 Git 历史，无需将尚未生成的提交 hash 填入自身文件。

## 入口与当前结论

- [M0 主报告](20261103-kanata-sqlite-m0-report-v1.md)：真实源码调查、插件/许可证、密钥方案、1k/10k/100k 对照、备份恢复影响、两轮自查。
- [模拟器补测](20261103-kanata-sqlite-m0-emulator-verification-v1.md)：Android14软件模拟器实际安装/完整启动、两版本原生加密检查及独立HTMLViewer崩溃对照。
- [QA 说明与复现](qa/kanata-sqlite-m0/README.md)、[原始命令](qa/kanata-sqlite-m0/evidence/commands.md)、[模拟器命令](qa/kanata-sqlite-m0/evidence/emulator/commands.md)。

**M0：BLOCKED；M1：NO。** 原生 SQLCipher4.17.0 检查在 Capacitor8.3.1/8.4.1 QA包中通过；插件桥接被 WebView113 renderer SIGTRAP 阻塞，系统自带无SQLite的HTMLViewer也复现。具体底层根因仍待定位，不能据此声称SQLite插件存在已证实缺陷，也不能声称桥接通过。

主机正式对照已保留30组运行、360个操作样本；SQLCipher主机4.12与Android4.17不同，不互代成绩。原插件持久secret API不满足严格主密码会话生命周期，仍需M0安全接口/替代Driver验证。真实手机性能、Android KDF/Keystore/完整故障恢复未闭合。原P7 Android512MiB/完整改密120秒、Web768MiB与全部需求门槛保留。

## 复现与本次提交核验

此前已实际执行：根 `npm run check`（590 Node、392组件、lint/typecheck/build）；两版本App/Test构建；两版本模拟器原生JUnit；主机加密/故障/envelope与五次性能对照。它们是有原始证据的已执行检查，本次推送不虚报重新运行完整设备/性能测试。

提交前重新核验：`node docs/qa/kanata-sqlite-m0/validate-results.mjs`、脚本语法/本地报告链接、`git diff --check`、文件范围与凭据模式检查；生产路径diff为空。修正设备驱动跨环境复现入口，新增`--build-dir`，校验work路径、QA包身份和Capacitor版本；它只选择APK所在目录，不改变既有设备测试逻辑或之前实测结果。

首次将原始日志纳入暂存区时，空白检查识别出终端 CRLF/尾随空格及上游 changelog 的原始尾随空格；保留证据字节，以 evidence 局部 `.gitattributes` 仅对 `.txt` 和 `upstream-changelog.md` 禁止换行转换并豁免空白排版检查，未改变测试内容/结果或项目源码检查。随后对完整提交范围复核通过。

新构建目录有随机后缀，复现时显式传入构建脚本输出：

```sh
node docs/qa/kanata-sqlite-m0/build-android.mjs 8.3.1
node docs/qa/kanata-sqlite-m0/verify-emulator.mjs 8.3.1 --build-dir work/m0/android-8.3.1-REPLACE
```

先按README准备根锁定依赖、JDK/SDK及专用合成AVD；设备脚本固定拒绝其他AVD/未完整启动状态。`--bridge-only`明确不执行native，不冒充全套通过。

Git交付不包含work、node_modules、SDK/JDK、模拟器镜像/用户数据、APK、二进制库或私密凭据。当前云环境的SDK/AVD保留但已关闭，QA App合成数据已清理；换环境需要重建这些临时工具，不能把本机临时路径当远端已有文件。

## 接续范围

继续M0：定位稳定WebView桥接、验证会话密钥入口/Keystore清理、补目标手机同机性能和密钥/日志取证；解决后再复核M0门禁。仅提交推送不构成用户允许进入M1的确认。历史失败和探索轮保留，不删改为PASS。
