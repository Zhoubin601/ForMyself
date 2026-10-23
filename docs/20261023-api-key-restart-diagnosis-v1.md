# Android API Key 关闭重开后消失：诊断记录

日期：2026-10-23。

## 范围与结论

用户要求“拉取最新，当前项目的apikey配置了之后重启会消失，查明原因”，补充为 Android App 关闭后重新打开，尚未测试 AI。本次只诊断，未修改业务代码、未构建 APK。

执行 `git fetch origin`、`git pull --ff-only` 后返回 Already up to date；HEAD 与 origin/main 均为 `1a00b21`，提交差异为 0/0。工作区已有大量未提交功能修改，本轮全部保留。下述复现针对当前工作区的实际设置 Store 与安全凭据适配器；API Key 相关关键逻辑在远端 HEAD 中也存在。

已证实的代码问题是：界面输入值与持久化成功没有绑定，保存失败不向用户反馈；启动时将读取异常当成“没有 Key”。此外，读取失败后修改接口地址或模型，会把空 Key 写回安全存储，造成原 Key 真正丢失。

正常写入完成、随后正常读取时，新的 Store 能恢复 Key。不能据此声称所有 Android 冷启动必定丢失，也不能在没有设备日志的情况下断言用户设备上具体发生了哪一个原生错误。

## 保存链路

1. `src/components/settings/SettingsAI.vue` 的密码输入框直接 v-model 到 `settingsStore.aiApiKey`，输入后立即成为可供请求使用的内存值。
2. `src/stores/settings.js` 的组合 watcher 同时监听 URL、Key 和模型；原生偏好只写 URL/模型，Key 单独交给 `queueApiKeyWrite()`。
3. Key 保存延迟 500ms；`flushApiKeyWrite()` 在调用原生存储前清除待写值。失败后定时回调只 `console.warn`，没有界面错误或自动重试。
4. `secureCredentials.storeApiKey()` 使用 NativeBiometric，`AccessControl.NONE`，并非普通 Preferences 明文保存。500ms 前进程结束且后台刷新没有完成，Key 尚未落盘。
5. `useAppController.js` 的后台回调会尝试 `flushPendingSettingsWrites()`；因此正常切后台有补偿，不能将所有关闭重开问题都解释为 500ms 防抖。强制结束进程也无法保证异步回调完成。
6. `useReminderSettings.js` 的 AI 握手直接使用内存配置，不等待或验证安全存储。即便握手成功，也不能证明 Key 已持久化。

## 读取和覆盖链路

1. `secureCredentials.js` 的 `isSaved()` 捕获查询异常并返回 false；上层因此可能在没有读取凭据的情况下直接得到空字符串。
2. `settings.js` 中 `secureCredentials.getApiKey().catch(() => '')` 又将真正的解密/读取异常转换为空字符串。
3. 启动把这个空字符串赋给 `aiApiKey`，没有区分“确实没有 Key”和“本次读取失败”，也没有重试或可见错误。
4. 如果只发生读取失败，没有后续写入，安全存储中的原 Key 可以仍存在；下一次成功启动可能恢复。
5. 但 URL/Key/模型共用 watcher。此时用户仅修改模型或地址，就会调用 `queueApiKeyWrite('')`；适配器把空密码写入同一凭据位置，原 Key 被覆盖。

## 已执行验证

执行命令：

```powershell
npx vitest run --config docs/qa/api-key-20261023/vitest.config.mjs --reporter=verbose
```

结果：1 个测试文件，7 项通过。测试使用合成标记、内存驱动替代系统凭据与偏好存储，调用实际 settings Store、实际安全凭据适配器和实际 Preferences 排队逻辑。新建 Pinia Store 并终止旧计时器模拟 JS 进程重新加载，不等同于 Android 系统进程/Keystore 实测。

| 场景 | 实际验证结果 |
| --- | --- |
| 正常保存后重载 | 恢复 Key；普通偏好不含 Key |
| 499ms 内结束 JS 进程，且没有完成后台刷新 | 尚未调用原生保存；重载为空 |
| 原生保存拒绝 | 内存仍有 Key，仅日志告警；重载为空 |
| 启动原生读取拒绝 | 显示为空，原存储仍存在；下一次成功读取恢复 |
| 凭据存在性检查拒绝 | 显示为空，原存储仍存在；下一次成功读取恢复 |
| 读取失败后只修改模型 | 原 Key 被空值覆盖；重载仍为空 |
| 结束前显式完成刷新 | 待写 Key 成功保存并可恢复 |

依赖源码核对：本机 `@capgo/capacitor-native-biometric` 为 8.4.11。Android 实现确实使用 SharedPreferences 保存密文并由 Android Keystore 提供密钥，不存在业务代码中明确的“每次启动主动删除 Key”。其 `deleteCredentials()` 有清空整份凭据偏好的实现，但项目当前源码没有调用该方法，本次不能将其归因为问题来源。上述依赖信息来自本机安装源码，未联网检索。

## 修复建议

- Key 单独监听；修改 URL/模型不再写入 Key。
- 为 Key 维护保存中、保存成功、保存失败状态；失败保留待写任务并提供重试。在离开设置或测试连接时等待保存完成，避免把内存可用误认为已保存。
- 读取时区分不存在与失败；读取失败保留原存储，提示重试，禁止把失败占位空值自动回写。清空 Key 应由明确编辑行为触发。
- 增加保存后读回校验；补齐真实 Android 冷启动、强停、存储失败和读取失败后的重试回归。

## 待复核与未完成项

`adb devices -l` 当前无连接设备。待确认：用户设备的 Android 版本、所装 APK 版本、保存后的等待时间、原生保存/读取错误。用户尚未测试 AI，不能从当前信息进一步区分保存失败与读取失败。

本次已确认并复现代码缺陷，但用户设备的具体触发异常尚未确定；未声称已在真机重现。业务修复、Android 原生验证和新 APK 均未执行。

未读取 raw 私人备份内容；raw 文件未修改。过程材料放在 docs，不在 output 生成未确认成品。未记录真实 Key、主密码或其他凭据；没有使用外部资料或文档生成 Skill。
