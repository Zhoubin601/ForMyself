# 2026-10-01 每日待办三阶段验收

三阶段源码已实现，每版分别完成项目检查、Android 构建和模拟器验证。APK 为 Debug 测试包，前版未覆盖。第三版包含全部待办功能。

## 交付物

| 阶段 | APK（项目目录下） | SHA-256 |
| --- | --- | --- |
| 第一版 | `output/20261001-daily-todo-v1-debug.apk` | `50EB2C902C8B46DE3D7DB2DF488F577D810E27CCABD2A5FB8B891B0C817CE28A` |
| 第二版 | `output/20261001-daily-todo-v2-debug.apk` | `ED2B3E4C4481A186489826D91428D28C2A458E51EE2C6400402B797CFD5DB77B` |
| 第三版 | `output/20261001-daily-todo-v3-debug.apk` | `D969BE15C027FBEA014633B29594D7EFFFE6D6525C589E4E865956FE13037FF6` |

## 来源与环境

- 依据用户确认的《每日待办三阶段交付计划》及补充的重复任务版本规则。
- 使用用户提供的进度底色参考图，以及 `raw/` 内指定的加密测试 JSON；来源与文件哈希见 `docs/source-notes.md`。原 JSON 为 v8 完整备份，已实际恢复到隔离模拟器，逐模块记录数与规范化后的源数据一致。文件名包含凭据，文档不复述凭据。
- 密码只在运行时从用户指定文件名读取，解密内容只用于本机内存及测试 App 正常恢复存储；未写入源码、报告、录屏或截图。测试用户的 AI 配置及主动联系关闭。
- Pixel_6_Pro AVD，Android 17 / API 37，1440×3120。先使用临时用户 10；另在用户 11 重新恢复原备份，进行真实设备重启检查。未清空 Owner 的应用数据。
- 待办使用至少 30 项合成规则任务，加上版本拆分与提醒用例。截图与录屏只显示合成待办；真实原备份不包含 Todo。

## 第一版

实现独立 Todo 页面、计划管理、首页今日进度、四类重复规则、日期独立完成/撤销、备注与可选时间、本地持久化、可选 Android 通知、v10 完整备份。没有新增 Todo 桌面组件，底色比例直接更新。

规则、单次覆盖与完成记录分为三个集合，经统一仓库原子提交。未来编辑保留旧 ID，并创建 `parentTaskId` 指向旧版本的新 ID；旧完成键不改写。完成区间保护会拒绝过早修改并给出最早日期，用户自行选择。仅本次编辑与撤销互不删除状态；不将未完成事项顺延。

验证：

- `npm run check`：249 项 Node 测试、44 项组件测试、类型检查及构建通过；lint 无错误。
- 模拟器实际解锁、真实 v8 备份恢复、喝水→咖啡版本拆分、旧名称和完成键、单次编辑与撤销、历史保护、v10 备份往返、v9 缺少 Todo 时保留本机待办、真实复选框勾选/撤销、页面无横向溢出通过。
- 实际 Android 通知排程检查：创建未来提醒后有待发通知，完成后对应当次提醒取消。
- App 关闭重启后读取正确；设备重启前后合成待办快照完全一致。
- 证据：`Test_data/todo-v1-emulator.json`、`todo-v1-final-emulator.json`、`todo-v1-restart-emulator.json`、`todo-v1-reboot.json`；`docs/qa/todo/v1-final-todo.png`。

## 第二版

实现默认 3×3 原生桌面组件：固定日期、进度及计数，下方滚动显示当天全部任务；完成项位置保持不变，可直接撤销。复选框在 App 进程不存在时也可操作，文字通过深链接进入待办并遵循 App 解锁流程。增加设置页添加入口。

Android App 和组件共享原生仓库，采用 revision 比较交换；JS 遇到桌面先提交时重新读取并重放，不覆盖桌面完成记录。提醒由原生调度器统一维护，完成同步取消。前台恢复、日期/时间变化、系统重启和午夜刷新均已接入。

验证：

- 项目检查：249 项 Node 测试、45 项组件测试通过，类型检查与构建通过；lint 无错误。
- 原生 instrumentation 验证日期契约、幂等完成、旧日期拒绝及陈旧 revision 拒绝；另补测实际提醒通知出现、完成后取消、已完成任务不被旧提醒再次通知。
- Launcher 实际 30 项滚动、末项可达、滚动后勾选不跳顶、App 进程不存在时桌面完成、后台持久化及撤销通过。
- 两个可见组件实例同时显示正确计数；仓库并发冲突回归保留桌面完成键。
- 设备真实重启后任务快照完全相同，重新验证桌面滚动与勾选通过。
- 证据：`Test_data/todo-v2-final-emulator.json`、`todo-v2-final-widget.json`、`todo-v2-multiwidget.json`、`todo-v2-widget-reboot.json`、`todo-v2-widget-reboot-widget.json`；`docs/qa/todo/v2-multiwidget.png`。

## 第三版

App 与桌面约 400ms 底色推进/回退。桌面每帧只局部更新背景位图，不重建任务列表；多个实例使用共同起始时间，新的变化从当前显示比例衔接。快速点击在原生锁内切换当前完成状态，避免复用旧列表状态。系统关闭动画时直接更新，App 尊重减少动态效果。

增加「每日待办数据」单项加密导出、确认后覆盖恢复，保留所有版本、单次覆盖与完成键。三版沿用同一数据结构与 ID；完整备份仍兼容 v1～v9，缺少 Todo 时保留本机数据。单项备份缺少必要集合或格式未知时拒绝导入。

验证：

- 最终项目检查：249 项 Node 测试、45 项组件测试、类型检查、Vite 构建通过；最终 lint 无错误（56 项现有警告未作为失败项）。Android Debug 与 instrumentation APK 构建成功，原生 2 项测试通过。
- 模拟器采集 App 连续推进/回退帧；快速完成多个任务后最终比例正确；减少动态效果下过渡停止。
- 实际原生文件导出解密后与待办快照一致；通过 FileReader 导入路径确认后恢复，版本链、单次覆盖与完成键完全保留；损坏单项备份拒绝且数据保持。
- 注入一次完整恢复写入失败，待办内容与历史回滚到原快照。
- Launcher 录屏包含两个实例的连续中间帧：最终记录分别检测到 5、7 个不同中间位置；推进、回退、快速连续切换及最终比例通过。系统动画倍率为 0 时直接更新，测试后恢复原设置。
- 桌面文字实际点击 → App 锁屏 → 解锁 → 对应日期和 ID → 任务滚动到可见位置并聚焦通过。
- 设备真实重启后版本、单次覆盖及完成记录快照不变；重启后的 App 和桌面勾选、撤销、滚动复测通过。
- 证据：`Test_data/todo-v3-experience.json`、`todo-v3-native-test.log`、`todo-v3-native-final-widget.json`、`todo-v3-widget-animation.json`、`todo-v3-deeplink.json`、`todo-v3-reboot.json`、`todo-v3-reboot-widget.json`、`todo-v3-after-reboot-emulator.json`。
- 录屏：`docs/qa/todo/v3-widget-animation.mp4`、`v3-widget-rapid-animation.mp4`、`v3-widget-reduced-motion.mp4`。

## 模拟器问题与验收边界

重启测试中，API 37 模拟器用户 11 的系统权限 `access.abx` 出现「Invalid interned string reference」错误，造成系统启动循环。保留损坏文件，仅重建本轮创建的测试用户权限状态；Owner 应用数据和待办快照未清空。修复后重新添加测试组件，并再次完成第二、三版的真实重启与桌面交互验收。首次故障、启动等待、Google 启动页遮挡及 UiAutomator 空根节点的失败尝试不计为通过证据。

当前仅完成本地源码、Debug APK 和上述模拟器验收。实体手机上的手感、不同桌面启动器、旧 Android 分支及正式发布签名尚未验收，不将本次结果称为商店发布。

## 主要源码及复测入口

- `src/features/todo/`：规则、仓库、通知、Store、待办页面与进度卡。
- `src/services/fullBackup.js`、`src/composables/settings/useBackupSettings.js`：v10 全量备份、回滚、待办单项备份。
- `src/App.vue`、`src/components/HomeView.vue`、路由及设置文件：入口、首页卡片、深链接及组件添加。
- `android/app/src/main/java/com/yubin/formyself/Todo*.java`、`AndroidManifest.xml` 和 `res/` 中的 Todo 资源：原生仓库、提醒、组件及局部动画。
- `tests/todoCore.test.js`、`tests/TodoRepository.spec.js`、`TodoNativeTest.java`：规则、持久化失败、并发及原生通知回归。
- `scripts/todo-*-qa.*`：模拟器、桌面、重启、录屏及深链接复测脚本；`TODO_QA_USER` 指定隔离用户，默认脚本假定 `emulator-5554`。复测需先确认测试用户、App、组件和 CDP 连接，勿直接用于已有私人数据的用户。

交付前再次校验 raw 原备份 SHA-256 不变，并确认三版 APK 均存在于 output。没有覆盖前版或向 raw 写入文件。
