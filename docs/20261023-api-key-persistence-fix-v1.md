# Android API Key 持久化修复与验收

日期：2026-10-23。授权：用户在诊断后明确要求“修复”。

## 交付结果

修复了已确认的保存与读取缺陷，生成安装包：

- `output/20261023-ForMyself-api-key-fix-debug-v1.apk`
- 大小：12,194,052 字节。
- SHA256：`0B1D22168340566392801C4B358D95CB8C451DF3FFAFF879FFBA19C2B13A435B`。

安装包基于当前工作区，包含此前保留的未提交修改；没有提交或推送 Git，没有覆盖旧交付物。已验证包内全部 49 个前端资源与当前 dist 一致，原生 DEX 包含本轮凭据提交失败处理，模拟器所装 APK 与交付包摘要相同。

## 修改内容

| 文件 | 作用 |
| --- | --- |
| `src/stores/settings.js` | Key 与 URL/模型独立监听；去除 Key 的500ms防抖，立即开始串行写入并合并期间的新输入；失败保留最新待写值；提供保存/读取状态与重试；读取错误不当成未配置；旧配置迁移成功前保留副本；恢复备份前完成旧Key写入；未成功读取AI配置时禁止将其当空配置备份 |
| `src/platform/security/secureCredentials.js` | 凭据存在性检查、读取错误向上传递；校验用户名与返回格式；写入后读回核对，清空时也校验；沿用Android Keystore加密与独立命名空间，不调用整表清空的deleteCredentials |
| `scripts/patch-capacitor-native-biometric.mjs`、`package.json` | 安装依赖时自动修补Android原生凭据写入：由apply改为检查commit成功后才返回；幂等执行，不支持的依赖源码明确报错 |
| `src/components/settings/SettingsAi.vue` | 显示正在读取、保存中、已保存、读取/保存失败；提供保存配置、重新读取与重新保存按钮；读取失败时阻止误编辑；状态支持屏幕阅读器，沿用项目按钮样式 |
| `src/composables/settings/useReminderSettings.js` | AI握手先等待配置保存，保存失败时不发送请求 |
| `src/composables/settings/useSettingsNavigation.js` | AI设置入口显示读取/保存失败，避免误称未配置 |
| `tests/ApiKeyPersistence.spec.js`、`tests/masterPasswordSecurity.test.js` | 20项新增持久化/组件/连接测试回归，更新原安全适配器测试以覆盖写后读回 |

原生补充问题：依赖的 `setCredentials()` 使用 `SharedPreferences.Editor.apply()` 后立即返回；此时紧接着的get只能证明内存缓存有值，不能证明磁盘提交成功。本轮改成检查 `commit()` 返回值后才确认保存，再由JS适配器读回验证。此补丁只作用于依赖中不要求生物认证的凭据保存分支；受生物认证保护的主密码流程保持既有实现。

## 测试结果

`npm run check` 通过：

- ESLint：0错误、55项既有警告。
- Node：260项通过。
- Vitest：99项通过，其中新增API Key回归20项。
- 类型检查与生产构建通过。
- Android离线Debug构建通过。

Android 12模拟器、WebView 113.0.5672.136，在独立临时用户中完成13项原生场景：

1. 真实UI输入后，通过Android原生凭据接口核验值；普通偏好不含Key。
2. 强制停止、冷启动恢复。
3. 连续三次修改、保存成功后立即强停、重开，值均保持最新。
4. 仅修改模型不触发凭据写入。
5. 原生写失败有可见提示，重试无需重新输入。
6. 重试成功后实际进程重启仍能恢复。
7. 在实际启动加载函数中注入原生读取失败：保留原凭据；修改模型不覆盖；重试恢复。
8. 凭据存在性检查失败可见并可重试。
9. 保存失败时握手请求数为0；保存成功后使用本地合成响应完成握手，未访问真实服务。
10. 明确清空Key后，重开保持未配置。
11. 实际冷启动迁移旧配置，验证原生凭据后清理旧副本。
12. 原生迁移失败保留旧副本，重试后恢复。
13. 粘贴后立即HOME切后台、250ms后关闭并冷启动，Key保留。

测试脚本：`docs/qa/api-key-20261023/native-verification.mjs`。原生结果：`native-results.json`。汇总及交付摘要：`verification.json`。已检查 `native-saved.png` 与 `native-save-error.png` 的真实页面布局。

执行结束已恢复Android用户0，移除本轮临时用户及9371端口转发；未读取原用户业务资料。测试全部使用合成标记和临时主密码，没有读取、保存真实API Key或私人备份。

## 过程异常与结果边界

保留两次非通过记录，不将其计入最终通过结果：

- `native-repeat-failure.json`：一次重复原生验证在旧配置迁移处未恢复。该次没有旧测试资料的磁盘证据，不能唯一追溯原因。测试原先通过Preferences.apply注入旧资料后立即强停；后续增加读取测试用户实际偏好XML的检查，确认夹具已上盘再测试冷启动迁移。该原始失败记录保留，不宣称已确定其唯一原因。
- `native-fixture-command-error.json`：新增夹具检查时run-as参数顺序错误；按本机usage修正为 `run-as <package> --user <id> ...`。属于测试执行器错误，该轮不算全量通过。

最终原生结果是修正执行器、增加夹具磁盘检查并打入commit补丁后，完整13场景通过的 `native-results.json`；失败原始记录保留供复核。

待用户复核：实体手机安装修复包后，配置Key并确认“API Key 已安全保存”，关闭再打开验证。尚未取得用户手机当次原生日志，因此无法追溯其唯一原始触发异常；没有在实体手机、所有Android版本或iOS上复验。之前已被空值覆盖的Key无法由代码修复找回，需要重新填写。保存尚未完成或存储持续失败时，不能承诺强杀进程后保留输入；界面会保留错误与重试入口。

## 来源与目录规则

来源：项目源码、现有诊断记录、本机NativeBiometric 8.4.11与Capacitor Preferences源码、上述自动化及隔离Android验证。未联网引入外部资料；raw仅清点目录，私人加密备份未读取、未修改。

界面反馈使用 `C:/Users/a3185/.agents/skills/ui-ux-pro-max/SKILL.md`，本地检索选用“提交状态反馈”和“可访问状态消息”建议。本轮不是Office/PDF任务，无需文件生成类Skill。

过程文档及测试证据均在docs；output只放通过验证的最终APK；memory-bank未写入一次性分析。
