# 2026-09-04 主密码安全存储第一阶段

## 已确认范围

- 用户授权开始实施主密码安全存储迁移，并保留生物认证后修改主密码。
- 第一阶段保留现有密码库、聊天和备份加密格式，降低历史数据迁移风险。
- 不再向 Preferences 写入主密码明文；改为保存随机盐、PBKDF2 参数和验证值。
- Android 生物凭据使用现有插件的 BIOMETRY_CURRENT_SET 与 getSecureCredentials，不能用单独 verifyIdentity 的成功布尔值代替密钥解密。
- 安全凭据中保存的是由 Keystore 保护的会话恢复密码；独立随机数据密钥和双重包装留待后续阶段。本阶段不宣称主密码完全不落盘。

## 执行计划

- [x] 增加密码验证值和生物安全凭据适配层。
- [x] 修改认证 Store：旧用户首次解锁后迁移；解锁前不加载密码库与聊天明文。
- [x] 修改应用启动、解锁和初始化流程。
- [x] 用可回滚流程更新密码库、聊天密码和认证验证值，保留生物认证改密。
- [x] 兼容现有备份导入导出，并禁用浏览器插件的模拟生物认证。
- [x] 增加验证值、凭据适配、改密回滚和原生构建验证。
- [x] 执行完整测试、生产构建、Capacitor 同步和 Android 编译。

## 完成结果

- Preferences 中的主密码明文会在旧用户首次成功解锁并加载受保护数据后删除，后续只保留 PBKDF2-HMAC-SHA256 验证记录。
- Android 主密码凭据使用 `BIOMETRY_CURRENT_SET` 保存，读取必须经过真实生物认证；浏览器环境不提供模拟快捷解锁。
- Android API Key 使用独立 Keystore 凭据保存，普通 AI 设置只保留服务地址和模型名称。
- 生物认证修改主密码会先解开安全凭据完成授权，再重加密密码库和聊天数据；任何阶段失败会回滚已完成的数据迁移。
- 生物凭据因指纹变化或更新失败而失效时，用户仍可通过新主密码进入。

## 迁移与失败原则

- 旧 my_master_password 只用于首次迁移；有效验证值存在时以验证值为准。
- 新验证值写入并回读验证、密码库与聊天成功加载后，才删除旧明文键。
- 生物凭据注册取消或不可用不阻止密码解锁；用户仍可用主密码。
- 修改密码先重加密受保护数据，再提交新验证值；提交失败则回滚受保护数据。
- 生物凭据更新失败时禁用旧凭据，保留新主密码访问，避免旧凭据误解锁。
- 锁定时清除认证 Store 的会话密码。为了兼容现有后台聊天，已加载的聊天/密码库 Store 暂保留自身会话密钥；这不等同于内存清零。

## 来源

- src/stores/auth.js：当前 Preferences 明文主密码和认证接口。
- src/stores/passwordVault.js、src/stores/chat.js、src/services/chatStorage.js：现有受保护数据及重加密接口。
- src/components/SettingsView.vue：改密、备份导入导出调用链。
- node_modules/@capgo/capacitor-native-biometric/dist/esm/definitions.d.ts：当前 8.4.11 版本安全凭据 API。
- node_modules/@capgo/capacitor-native-biometric/android/src/main/java/ee/forgr/biometric/AuthActivity.java：Keystore AES-GCM 与 CryptoObject 绑定的原生实现。
- node_modules/@capgo/capacitor-native-biometric/dist/esm/web.js：浏览器为模拟认证，不能作为安全边界。

外部资料：未使用。未读取或记录用户主密码、API Key、真实密码库内容。
