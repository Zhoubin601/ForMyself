# 每日待办 v6 验收与交付

日期：2026-10-02。依据用户本轮截图与提示词实现；视觉目标为2×2深色组件，具体像素宽高与格数由桌面决定。来源及执行方案见 `source-notes.md`、`20261002-todo-v6-plan.md`。

## 修改范围

- 原生布局 `widget_todo.xml`、`widget_todo_row.xml` 对应头部/列表；新增深色渐变头部背景，卡面使用半透明灰蓝渐变和细描边，模拟磨砂观感，不对壁纸实时模糊。
- 日期/中文星期与TODAY在左，右侧为薄荷青圆环及实际完成数；名称和日期均不使用参考图的假数据。圆形复选框为原生矢量，完成态使用小勾与柔和文字，分隔线淡化。
- 默认目标2×2，最小调整尺寸120dp；保留双向缩放、列表滚动、稳定任务ID、48dp勾选区域和v5实例间距策略。设置说明同步为2×2。小尺寸放不下三条完整任务时允许滚动，不缩小点击面积。
- `TodoWidgetRing.java` 绘制透明小环图；API31+使用共享内存帧，旧版64px不可变帧。单调度器约400ms，迟到跳帧、连续点击衔接、分组共享、精确终点及关闭动画直接更新均保留。
- API24～34使用既有集合服务，业务变化才通知列表；API35+直接提供稳定集合，避免新框架的异步旧适配器转换。布局版本6在升级时替换显示缓存，后续业务及动画沿用局部更新。

任务仓库、完成键、版本链、提醒规则、App内表单和完整备份格式未改动。主要源码在 `android/app/src/main/java/com/yubin/formyself/TodoWidget*.java`、`android/app/src/main/res/`；设置说明在 `src/components/settings/SettingsWidgets.vue`。

## 检查方式与过程

`npm run check` 通过：249项Node、48项组件测试，lint零错误、56条既有警告，类型检查与Vite构建通过。Android Debug与instrumentation构建通过。日志为 `Test_data/todo-v6-project-check.log`、`todo-v6-android-build.log`。

沿用v4/v5已恢复用户加密备份的专用API30、31、37 AVD，逐台运行，720×1600、density280、软件渲染。原始备份为v8且不含Todo；本轮不重新导入其他模块，保存隔离环境已有Todo后注入合成任务，结束后精确还原。原Pixel_6_Pro及其他手机未操作。API30/31继续使用此前配置的官方WebView113。

原生检查验证仓库CAS、重复日期、完成/撤销、真实通知发出与完成后取消、48dp点击区、间距基准，以及环图透明性、顺时针比例、不可变性和IPC大小预算。三个系统运行器需返回 `OK (6 tests)`，夹具驱动默认跳过。

尺寸通过真实桌面拖拽测量，不直接修改组件选项。验收包含2×2、3×3、4×4、4×3拉宽、2×4拉高、1.3倍字体、长标题、返回基准尺寸。旧无障碍树省略行容器时，测量相邻完整勾选框中心距离并扣除截图中1px分隔线。脚本还核对实际宽高，避免桌面重载后测量其他实例；API31四列的桌面边缘留白使最后一格步长不同，四列尺寸采用该AVD之前的真实测量参考。

30项场景检查后台勾选、不启动App、不跳回顶部、撤销及末项可达；另外12次连续完成/撤销要求每次恰好保存一次，所有可见组件计数与仓库一致。0项空态和4项1/4参考样例均单独截图。动画使用1项0～100%录屏，按真实像素的薄荷色圆弧角度测量，要求320～480ms、主阶段间隔不超过80ms、至少5个中间位置；同时检查回退、快速交错点击、多实例和关闭系统动画。快速点击以仓库实际收到的事件为准，不假定桌面接收了每个物理触摸。

## 发现的问题

API31早期构建有完成已保存但桌面后续停止刷新的情况，未计为通过。日志出现小包Binder失败并撤销桌面回调；共享环图单独修改不足以解决。框架局部更新会发送合并后的缓存视图，因此内联30项集合仍随帧重复传输；该平台改为服务集合后，完整场景及12次循环均通过。[AOSP Android 12源码](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android12-release/services/appwidget/java/com/android/server/appwidget/AppWidgetServiceImpl.java)

高版本采用服务集合时出现夹具退出后的旧计数；本机SDK `AppWidgetManager.java` 显示旧服务适配器会异步转换。最终API35+改为直接集合，并增加布局版本初始化。夹具退出会杀死目标进程；测试准备重启隔离桌面，以清除服务连接和显示缓存，正式后台勾选、滚动、连续更新及动画均在桌面持续运行时完成。

首次大字体测试因桌面回到首页选择了另一实例，其结果作废；最终固定单实例页面并断言实际宽高。早期尝试日志保留在 `Test_data/todo-v6-api31-suite-*-attempt.log`、`todo-v6-api31-suite-shared.log`、`todo-v6-api31-suite-geometry-attempt.log` 和 `todo-v6-api37-suite-upgrade-attempt.log`。这些不算通过记录。

## 最终结果

三套系统完成验收。最终构建原生6项检查全部通过；API31最终包的通知等待前两次未见通知，保留失败记录，第三次完整运行器 `todo-v6-api31-native-final-warm.log` 返回 `OK (6 tests)`，未改源码或放宽等待标准，未认定等待失败的具体原因。

全部9种布局场景的常规行高为2×2 48dp、3×3 56dp、4×4约69.71dp，点击区48dp；API30/31大字体长标题允许行高72dp，避免截断。最终API35+兼容修订未改变布局资源；与API30/31完整缩放验收构建相比，884项打包资源逐字节相同（`todo-v6-layout-resource-comparison.json`）。最终包对这两套系统补验原生、参考/空态、后台完成、30项滚动、12次连续操作和所有动画场景，没有重复拖拽；API37在最终包上跑完全部场景。

| 系统 | 可见推进/回退 | 主阶段最大间隔 | 最终比例/减少动画 |
|---|---:|---:|---|
| API30 | 398.61～399.43ms | 51.13ms | 通过 |
| API31 | 383.12～398.74ms | 48.62ms | 通过 |
| API37 | 385.36～399.24ms | 33.33ms | 通过 |

动画为最终SHA对应构建的实测；使用视频帧时间戳计算运动段，录屏整体平均fps含静止阶段，不能代替运动段刷新率。API31快速物理点击有未全部送达的情况，所有实例最终与实际仓库比例一致，逐次12次操作则全部恰好提交一次。

证据：`Test_data/todo-v6-apiXX-spacing.json`、`-widget.json`、`-stress.json`、`-widget-animation.json`、`-restored.json`；截图与录屏在 `docs/qa/todo/v6-apiXX-*`，XX为30/31/37。最终包日志：API30 `todo-v6-api30-final-package.log`，API31 `todo-v6-api31-final-package-ui.log` 与上述warm原生日志，API37 `todo-v6-api37-suite-final.log`。

各隔离环境已精确还原36个任务版本和2条完成记录。原始JSON哈希仍为 `67C0A6902EB91F5C0A6A497C773DE6A5583A39345E57BBAF5D23BDFCF9A053B9`，v1～v5 APK均通过原交付哈希比对，无覆盖。

交付：`output/20261002-daily-todo-v6-debug.apk`，12194138字节，SHA-256：`8A4A170D689422DBEFB1F089AA43F54C52FDA85B171A75CCE8CCDA536D402CEC`。与最终验收安装包逐字节一致，Debug签名。


真实手机的默认格数、壁纸观感、桌面缩放步长和流畅手感仍需复核；模拟器通过不能代表所有桌面。
