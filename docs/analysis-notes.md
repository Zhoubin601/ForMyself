# 分析与实施记录

## 2026-07-18 密码库功能合并

实施方向：

1. 新增独立 Pinia 密码库 Store。
2. 密码记录在内存中以对象数组使用，写入 Preferences 前统一使用主密码 AES 加密。
3. 新存储 Key 使用 `my_password_vault_encrypted`，避免与旧明文数据混淆。
4. 首次加载时如发现旧 Key `my_password_manager_data`，解析后加密迁移；成功写入后删除旧明文 Key。
5. 修改主密码后使用内存中的密码记录，以新主密码重新加密写入。
6. 密码备份在设置页使用独立入口，兼容旧项目以主密码加密的数组格式。
7. UI 延续当前 ForMyself 的 Apple 风格和现有全局交互规范。

