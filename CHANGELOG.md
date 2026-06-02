# Changelog

## [1.1.0] - 2026-06-01

### Added
- Claude Code GitHub Actions workflow：Issue 中 `@claude` 自动触发分析、写测试、修 Bug、提 PR
- Hooks 自动化测试（prettier + eslint），13 个测试用例全部通过

### Fixed
- **pThrottle 丢弃最后一次调用**：改为 trailing-edge 策略，确保最后一条内容不丢失
- **飞书频率限制 (230020) 导致进程崩溃**：捕获限流错误，静默跳过
- **长文本回复被截断**：流式结束后显式发送完整内容更新卡片

### Changed
- 节流间隔从 200ms 调整为 1000ms，降低飞书 API 调用频率
- Git 工作流：实验性改动用 feature 分支，确认后 squash merge 回 main

## [1.0.0] - 2026-05-31

### Added
- Claude API 流式回复 + 飞书卡片实时更新
- 群聊支持：@mention 触发，reply 模式回复
- 私聊支持：直接对话
- 用户上下文：通过 tenant_access_token 获取群成员名称
- 文件消息支持
- 自定义 system prompt（支持环境变量注入）
- `ANTHROPIC_BASE_URL` 支持第三方兼容 API（如 MiMo）
- ESLint 代码规范检查
- README（中文 + 英文）
