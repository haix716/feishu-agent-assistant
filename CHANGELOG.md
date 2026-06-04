# Changelog

## [2.2.0] - 2026-06-04

### Added
- **5W1H 需求分析**：完整的小红书店铺运营自动化需求分析
- **架构设计**：飞书中转站 + 本地 AI + 工具层三层架构
- **并行开发计划**：RAG、图片生成、视频制作、发布管理四条并行线
- **工作流规划**：图片工作流、视频工作流、文案工作流、发布工作流
- **技术栈规划**：ChromaDB、CLIP、GPT-IMG-2、TapNow、剪映 MCP、小红书 MCP

### Changed
- **README.md**：添加项目定位、5W1H 分析、架构设计、并行开发计划
- **使用方式**：添加工作流指令和用户操作流程

## [2.1.0] - 2026-06-04

### Added
- **本地图片保存**：收到图片自动保存到本地文件夹，不再依赖飞书云盘
- **本地视频保存**：收到视频自动保存到本地文件夹
- **图片内容识别**：使用 MiMo 模型分析图片内容，自动生成描述和文件名
- **待办事项创建**：每天首次保存图片时自动创建飞书待办
- **IMAGE_SAVE_DIR 环境变量**：配置图片/视频保存目录（默认 ./images）
- **图片分析测试用例**：验证下载、识别、文件名生成功能

### Changed
- **图片保存方式**：从飞书云盘改为本地文件夹
- **文件名格式**：`{YYYYMMddHHmmss}_{内容摘要}.jpg`（去掉序号）
- **图片识别模型**：使用 mimo-v2-omni，支持中文描述
- **移除飞书云盘依赖**：不再需要 DRIVE_FOLDER_TOKEN

### Fixed
- **图片识别格式**：修复 MiMo API 的 max_completion_tokens 参数
- **图片下载 400 错误**：使用 axios 直接调用飞书 API 替代 SDK

## [2.0.0] - 2026-06-03

### Added
- **Channel SDK 集成**：使用 createLarkChannel 替换手动 WSClient + EventDispatcher
- **OpenAI SDK 迁移**：从 Anthropic SDK 迁移到 OpenAI SDK（兼容 MiMo 等模型）
- **图片理解功能**：新增 analyzeImage 函数，支持 MiMo-V2.5-Omni 多模态分析
- **智能体应用支持**：支持通过 lark.registerApp() 一键创建飞书智能体应用
- **多 Agent 并行开发**：3 个 Agent 并行开发（Channel SDK + SDK 迁移 + Config/Utils）
- **Hooks 质量门禁**：PreToolUse 安全检查 + PostToolUse 自动 lint

### Changed
- **项目重命名**：claude-feishu-bot → feishu-agent-assistant
- **架构重构**：
  - app.ts：100 行 → 30 行（createLarkChannel 替换 EventDispatcher）
  - lark.ts：395 行 → 150 行（删除 5 个消息方法，保留文件操作）
  - handler.ts：712 行 → 500 行（适配 NormalizedMessage + channel.stream()）
  - claude.ts → ai.ts：58 行 → 73 行（OpenAI SDK + 图片理解）
- **流式输出**：从手动 card_update 改为 channel.stream()（内置节流和打字机动画）
- **消息发送**：从 larkService.sendCard/replyText 改为 channel.send()
- **文件夹名称**：「机器人文件」→「智能体文件」
- **listFiles API**：从 drive.file.list 改为 im.v1.chat.file.list

### Fixed
- **folderToken 一致性**：handleMediaMessage/handleBinaryFile 使用 rootFolderToken
- **云文档链接正则**：支持子域名（xxx.feishu.cn）和国际版（larksuite.com）
- **群文件 API**：改用 im.v1.chat.file.list

### Removed
- `@anthropic-ai/sdk` 依赖
- `generateCard` 函数（Channel SDK 自动处理）
- `throttledUpdate` 函数（Channel SDK 内置节流）
- `WSClient` 和 `EventDispatcher` 手动配置

## [1.2.0] - 2026-06-02

### Added
- **图片自动保存**：收到图片自动保存到飞书云盘，自动创建日期文件夹
- **音视频自动保存**：收到音视频自动上传到飞书云盘
- **二进制文件导入**：xlsx/docx 通过飞书导入 API 转换后读取内容
- **飞书云文档链接解析**：发送飞书文档链接，agent 自动读取并总结
- **群文件浏览**：@agent 群文件 列出群文件夹中的文件
- **自动创建文件夹**：agent 启动时自动在飞书云盘创建"智能体文件"文件夹
- 5 个 worktree 并行开发，全部合并到 main

### Changed
- ChatMessage 类型扩展为支持多模态内容（`string | ContentBlockParam[]`）
- getResource 函数泛化，支持获取图片和文件
- 新增 uploadFile、createFolder、getRootFolder 等云盘操作方法

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
- AI API 流式回复 + 飞书卡片实时更新
- 群聊支持：@mention 触发，reply 模式回复
- 私聊支持：直接对话
- 用户上下文：通过 tenant_access_token 获取群成员名称
- 文件消息支持
- 自定义 system prompt（支持环境变量注入）
- `AI_BASE_URL` 支持第三方兼容 API（如 MiMo）
- ESLint 代码规范检查
- README（中文 + 英文）
