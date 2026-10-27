# Kanata P1 纯领域模型与契约验收 v1

状态：**PASS / Go，允许进入P2**。本报告对应用户本轮P1–P7连续实施授权，阶段编号与产品决策依据 [连续执行v3](20261028-kanata-continuous-execution-plan-v3.md)，不是历史架构P1–P6。文档编号沿用v3的20261028资料日期。

## 基线与实施边界

- 启动分支Kanata，初始HEAD `e4a54cca5ebc4c28129613cf5dbde3b081883be0`，工作区干净。
- 检查远端后仅快进Kanata至 `47f7bfa638d2656c9b299379875a48b82a31685b`，读取三份最新方案与原始需求、四份过程文档，复核实际chat/存储/备份/AI和契约测试。未合并main。
- 已实现纯模型和校验、预设数据/实例化函数，**没有把预设接入用户可见聊天、真实磁盘、Store或AI**；没有旧小暖迁移函数。
- 新领域独立类型 `kanata-data` / schema 1；不修改旧chat v4/全备v12及其运行时。权限初始无授权，自治/主动/通知关闭为保守工程默认。
- 官方IP资料只是公开身份摘要的来源标注；不含官方图片/台词。内容/可分发授权仍待P3审查，不能把P1结构测试当作角色对话质量或分发授权通过。

## 实际文件与契约

- `src/features/chat/domain/kanataTypes.d.ts`：World、Card/Version/Instance、WorldUserIdentity、Conversation、Message、Lorebook、Memory、Relationship、Event/Effect、Task、LifeGrant、Preset/初始化checkpoint。
- `kanataCore.js`：空领域创建，不识别/导入旧聊天。
- `kanataValidation.js`：完整引用图、世界归属、版本、ID、来源revision、真实发言者、任务成员、事件无环、JSON安全与稳定错误码；校验后返回独立副本，不静默截断。
- `presetCore.js`：显式时间/ID工厂输入的预设校验和纯实例化；同初始化键重试不增，主动第二世界独立实例、共用全局卡；卡版本锁定、归档卡拒绝自动复用。
- `src/features/chat/presets/abydos.v1.json`：5份独立人格、10对队内关系、8基础+5角色私有指导世界书、来源/版本/非官方说明。私有指导不是伪造历史事实。
- `src/application/contracts.d.ts`、`tests/types/kanata.ts`：重导出真实领域类型，7个负向类型断言实际参与strict；未关闭检查/放宽规则。
- `tests/kanataDomain.test.js`：51项Node行为/边界/故障用例；原有所有测试保留。
- 根架构说明书增至v1.1，新增第15节解释真实契约。四份docs追加本轮来源、分析、状态与检查点，不改raw及既有历史正文。

## v3 P1强制验收矩阵

| 编号 | 证据与结果 |
| --- | --- |
| P1.1 同卡双世界与引用隔离 | PASS：五卡重用但10独立实例/12会话；实例情绪、关系、记忆、水位独立；10种跨世界引用拒绝，非成员发言/任务拒绝 |
| P1.2 五人预设结构 | PASS：世界1/卡5/实例5/私聊5/群1；20条有向队内边+5条角色对世界用户关系；13条世界书引用合法；消息/记忆/事件/effect/任务/生活授权均0 |
| P1.3 幂等与显式factory | PASS：同键重试3次深度相等且不再取ID；禁用Date.now/Math.random仍可运行；不同初始化键创建新世界；返回结果不与输入共享可变对象 |
| P1.4 严格schema/错误拒绝 | PASS：未知未来版本、旧v4、重复ID、孤儿/跨世界引用、非法role/sender、循环事件、候选effect、恶意effect路径、非JSON/getter/稀疏数组等明确报code |
| P1.5 类型/边界/完整检查 | PASS：51定向、336全部Node、156组件/集成，strict负向样例、Vue类型与生产构建通过；没有真实I/O/UI/AI或旧数据迁移 |

## 自查第一轮：架构、异常、数据与权限

发现并用新增回归先复现：卡版本缺rawData仍被接受；关系维度缺字段；同模板键重复卡；任务角色虽同世界却不是目标会话成员；稀疏数组附加属性可能被JSON转换为null而丢原文。

修复：必需原文/三个维度与规则版本；模板键唯一；任务成员检查；数组索引完整性检查。关系数值定义为描述性baseline的零增量，规则版本1，不捏造初始好感分数。
运行review1-before为47通过/2失败（新增组合回归先在首个遗漏处失败），修复后49/49通过。证据见qa目录对应before/after。

## 自查第二轮：需求、预设交互基础与隔离

对照预设规格B/C/E发现：人格定义尚缺显式prompt层次；预设只有公共/系统世界书，缺少角色范围指导条目；再次创建预设世界会复用已归档卡。

修复：五卡均有promptPriority，增加5个仅本实例知晓的原创角色指导条目（无伪历史），遇归档卡明确报错并保持输入不变。角色身份/同卡双世界和用户称谓覆盖单独测试；不把五段风格数据描述成AI实际行为已验收。
review2-before新增2项失败；修复后51/51通过。之后完整check发现rawData类型边界错误，修为经过JSON安全校验的显式JsonValue转换，strict检查通过。

## 实际命令、退出状态和范围

| 命令/运行 | 结果 |
| --- | --- |
| Git状态/HEAD/diff；fetch Kanata + merge --ff-only origin/Kanata | 成功，保留干净工作区，只有远端新增规范文档快进 |
| `npm ci` | 锁中794个镜像地址受环境策略403，安装未完成；终止该安装，退出137；不是通过 |
| 依赖未就绪时首次 `npm run check` | 退出127，eslint不可用；未计入验收 |
| `npm ci --replace-registry-host=always --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000 --loglevel=error` | 退出0，693包，3个postinstall受控补丁通过；package/lock未变，不绕过代理或禁用TLS |
| `node --test tests/kanataDomain.test.js` | 初版47通过；两轮自查保留失败记录；最终51/51 |
| 第一轮完整 `npm run check` | Node334/Vitest156通过后类型检查退出2，JsonValue结构不匹配；已修复 |
| `npm run typecheck` | 修复后退出0；两套类型检查包括新负向样例 |
| 最终 `npm run check` | 退出0：Node336/336、Vitest156/156、18文件；lint0错误/47既有警告；类型/构建通过 |
| `git diff --check`、新增文件与链接核对 | 通过；raw不改、无业务文件删除、不放宽lint/types |
| Android/Web功能E2E/真实AI | NOT RUN：P1无运行时接入，不以生产构建代替功能验收；P2及以后按门禁补充 |

完整检查与自查日志：[qa/kanata-continuous/p1/](qa/kanata-continuous/p1/)；日志只含合成测试及工程诊断，没有真实Key/密码/私人资料。

## 后续与限制

P1的Go只授权进入已获用户授权的P2，不表示P2–P7完成。下一阶段须完成新加密仓库、受控清理/旧备份分流、受保护会话/改密/全备协调与Web/Android规模实测；不许复用旧chat normalize吞字段。当前P1保持旧运行时原样，用户看不到新界面。

初步环境探测：JDK21可用，但PATH无adb/emulator/sdkmanager且无/dev/kvm；P2原生与Android规模门禁不能因JS测试通过而跳过。需要在P2记录实际环境限制和安全checkpoint，缺必要设备则阻断P3–P7。未推送、未创建PR、未发布、未接触真实设备数据。
