# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

飞书智能体助手。用户在飞书中发消息，智能体调用 AI 生成回复，流式更新卡片消息。基于 Channel SDK 构建。

## 技术栈

- Node.js >= 20 + TypeScript
- `@larksuiteoapi/node-sdk` — 飞书 SDK（Channel SDK + Client）
- `openai` — OpenAI 兼容 API（支持 MiMo 等模型）
- `dotenv`
- ESLint（`npx eslint src/`，0 error 才能 commit）

## 运行命令

```bash
npm install
cp .env.example .env   # 填入凭据
npm run dev             # 开发模式（ts-node）
npm run build           # 编译
npm start               # 生产模式
npm run lint            # 检查代码规范
```

代理环境下需加 `NO_PROXY=open.feishu.cn`。

## 架构

```
src/
├── app.ts           # 入口：createLarkChannel + Channel SDK
├── config.ts        # 环境变量配置
├── ai.ts            # AI API 封装（OpenAI SDK，流式 + 图片理解）
├── lark.ts          # 飞书文件/文档操作封装（Client）
├── util.ts          # 工具函数（正则、文件解析）
├── rag.ts           # 本地图片搜索
├── oauth.ts         # OAuth 登录
├── oauth-server.ts  # OAuth 回调服务器
├── scheduler.ts     # 定时任务
├── handler/         # 消息处理（按职责拆分）
│   ├── index.ts         # re-export（对外接口）
│   ├── router.ts        # 消息分类 + 分发
│   ├── conversation.ts  # 对话历史、AI 回复、命令处理
│   ├── image.ts         # 图片消息 + 图片生成
│   ├── file.ts          # 文件/音视频/二进制/文档链接
│   └── folder.ts        # 飞书云盘文件夹管理
├── tools/           # 工具调用（GetTimeTool、SearchDocTool）
└── image-gen/       # 图片生成（v2.4.0）
    ├── index.ts
    ├── analyzer.ts       # 图片分析 + 提示词生成
    ├── router.ts         # 场景路由（穿戴/商品/封面）
    ├── prompt-builder.ts # 提示词模板库
    └── providers/
        ├── provider.ts   # ImageProvider 接口
        ├── replicate.ts  # Replicate API（Try-On + 通用生图）
        ├── jimeng.ts     # 即梦 API（商品图/封面）
        └── libtv.ts      # LibTV CLI（Seedream/Midjourney）
```

核心流程：`用户消息 → Channel SDK → handler → AI stream → channel.stream() 流式更新`

## 图片处理功能

用户发送图片时，智能体会：
1. 下载图片
2. 使用 MiMo 模型分析图片内容
3. 保存到本地文件夹：`{IMAGE_SAVE_DIR}/{日期}/`
4. 文件名格式：`{YYYYMMddHHmmss}_{内容摘要}.jpg`
5. 回复用户图片内容和保存位置

配置项：
- `IMAGE_SAVE_DIR` — 图片保存目录（默认 `./images`）

## 图片生成功能（v2.4.0）

用户上传商品图/服装图，智能体自动生成：
1. **穿戴效果图** — 真人模特穿着上传的服装（Replicate Try-On API）
2. **商品详情图** — 电商风格的商品主图/场景图（即梦 API）
3. **小红书封面** — 3:4 比例封面图（即梦 API）

流程：用户发图 → MiMo 分析图片 → 生成英文提示词 → 调用生图 API → 返回结果

## 详情图套件功能（v2.6.0）

用户发送一张银饰图片，智能体自动生成 8 张专业详情图：
1. **主图** — 深色背景正面展示
2. **角度展示图** — 45° 角立体展示
3. **细节特写图** — 微距工艺细节
4. **佩戴场景图** — 杂志级佩戴效果
5. **尺寸规格图** — 模板图，可复用
6. **文化寓意图** — 模板图，可复用
7. **包装展示图** — 模板图，可复用
8. **品牌故事图** — 模板图，可复用

流程：用户发图 → 选择"4 详情图套件" → 分析产品 → 并行生成 8 张图 → 一次性发送
模板图首次生成后缓存到 `/Users/hxy/Documents/小红书店铺/详情图/详情图模板/`，后续自动复用

详细设计：`src/image-gen/detail-suite/`

详细设计：`docs/v2.4.0-image-generation.md`

## 环境变量

- `APP_ID` / `APP_SECRET` — 飞书应用凭据
- `LARK_DOMAIN` — 飞书 API 域名
- `ANTHROPIC_API_KEY` — AI API key
- `ANTHROPIC_BASE_URL` — API 地址（支持第三方兼容服务）
- `CLAUDE_MODEL` — 对话模型名
- `MIMO_IMAGE_MODEL` — 图片分析模型（默认 mimo-v2.5-omni）
- `MAX_TURNS` — 对话历史最大轮数
- `DRIVE_FOLDER_TOKEN` — 云盘文件夹 token（可选，自动创建）
- `REPLICATE_API_TOKEN` — Replicate API token（图片生成用）
- `JIMENG_API_KEY` — 即梦/火山引擎 API key（图片生成用）
- `JIMENG_API_SECRET` — 即梦 API secret（图片生成用）

## Pre-mortem 风险预检

**代码层面**（自动化）：
- commit 时自动运行 `scripts/premortem.sh staged`
- 扫描：硬编码密钥、缺少错误处理、并发风险、资源泄漏、API 调用风险
- 高风险阻塞提交，中风险给提示不阻塞

**设计层面**（Claude 主动）：
- 开始新功能前，Claude 应主动做 pre-mortem 分析：
  1. 这个功能可能在哪失败？
  2. 有哪些边界情况没覆盖？
  3. 对现有功能有什么影响？
  4. 回滚方案是什么？
- 分析结果记入 Obsidian 决策记录

## 质量门禁（代码强制）

以下规则由 `scripts/quality-gate.sh` 自动执行，不需要人工检查：

| 检查项 | commit 时 | push 时 | 说明 |
|--------|-----------|---------|------|
| 敏感信息扫描 | ✅ | ✅ | API key、token、密码、媒体文件 |
| 禁止文件检测 | ✅ | ✅ | .claude/、.env、.pem、node_modules/ |
| Pre-mortem 风险预检 | ✅ | — | 风险模式检测（高风险阻塞） |
| ESLint error | ✅ | ✅ | 0 error 才能通过 |
| Commit message 格式 | ✅ | — | `<type>(<scope>): <description>` |
| 测试覆盖检查 | — | ✅ | 缺测试给警告，不阻塞 |
| 全量测试 | — | ✅ | 所有测试必须通过 |
| 日记检查 | — | ✅ | 今天的日记必须已写 |

- pre-commit（<5s）：安全 + lint + commit message
- pre-push（完整）：安全 + 测试覆盖 + 全量测试 + 日记
- agent 产出验证：`scripts/quality-gate.sh agent`

## 版本管理

**单一真相源：`package.json`**

- 版本号只在 `package.json` 定义，其他地方引用它
- 发版用 `bash scripts/version-bump.sh [major|minor|patch] [描述]`
- 不要在 CLAUDE.md、README.md 中硬编码版本号
- 功能描述写"最新版"或"见 package.json"
- CHANGELOG.md 由 version-bump.sh 自动更新

**版本一致性检查（push 时自动执行）**：
- `scripts/quality-gate.sh push` 会检查 package.json 版本 == CHANGELOG.md 最新版本
- 不一致时阻塞 push

**发版后手动操作**：
1. 更新飞书开发者后台的智能体应用版本号
2. 同步 Obsidian 版本记录（如果需要）

## 指令规范

**重要任务**（多文件、新功能、架构决策）：
- 必须用结构化 Prompt（五部分交互契约：现状、目标、示例、约束、方法）
- 不允许"直接做"、"看看"等无上下文指令

**简单任务**（查看、确认、小修改）：
- 可以简短，但必须说明"做什么"+"在哪"
- 示例：✅ "看看 comfyui.ts 的 lint 错误" ❌ "看看"

**禁止**：
- 无上下文指令："直接做"、"看看"、"改一下"
- 必须指明对象和目标

## 上下文管理

**任务切换时**：
- 先 `/clear` 或 `/compact` 清理上下文
- 发现 memory 过时：立即更新，不等 quality gate 提醒

**功后自动沉淀**：
- 完成功能后：更新相关 memory 文件
- 修复 bug 后：记录根因和修复方案到 memory
- 重大决策后：记录决策理由到 Obsidian

**Memory 新鲜度检查（push 时自动执行）**：
- MEMORY.md 超过 7 天未更新 → 警告
- Changelog 与 commit 不同步 → 警告

## 工作流指导（Claude 自律，非强制）

以下规则无法用代码强制，Claude 应自觉遵守：

1. **先停智能体** → 改代码 → 编译 + lint → 重启智能体
2. 等用户在飞书里测试确认功能正常
3. **用户明确确认后**再 commit
4. 多文件改动、新功能、有多种实现方案 → 先讨论再动手
5. 涉及 API key 的操作必须让晓燕文字确认

## 协作模式

**晓燕给方向，Claude 给方案：**
- 晓燕描述问题和期望效果，不规定实现方式
- Claude 出 2-3 个方案 + 优劣对比，晓燕选
- 选定后 Claude 全栈交付（代码 + 测试 + 文档 + 安全检查）

**并行探索：**
- 有多个可行方案时，用 worktree 同时实现
- 看结果选，不凭想象选

**后台持续改进：**
- 安全扫描、代码质量、文档同步 — 不等晓燕发现
- 主动提 PR，晓燕只需要 review

## 多 Agent 并行开发规范

当需要并行开发 3+ 个独立任务时，使用 Agent View + Background Sessions。

### 角色定义
- **PM（主 agent）**：需求分析、任务拆分、写 task brief、监控进度、合并交付
- **Developer（`.claude/agents/developer.md`）**：写代码、跑测试、提交
- **Reviewer（`.claude/agents/reviewer.md`）**：审查代码，只读不写

### 工作流程
1. PM 理解需求，拆分为独立任务
2. PM 为每个任务写 task brief（目标、当前代码、改动要求、验收标准）
3. 通过 Agent 工具派发 developer agent 并行执行
4. Developer 完成后，自动 hooks 验证（lint + test）
5. PM review 代码，不合格打回
6. 合并分支，更新文档

### Task Brief 必须包含
- 一句话目标
- 具体改动哪个文件
- 不要动哪些文件（其他 agent 负责）
- 验收标准（lint 0 error、测试通过、功能正常）

### 质量门禁（代码强制）
- PreToolUse hook：`scripts/quality-gate.sh commit`（安全 + lint）
- PostToolUse hook：`scripts/lint-check.sh`（单文件 lint）
- SubagentStop hook：`scripts/quality-gate.sh agent`（lint + test + 工作区检查）

### 并行原则
- 独立任务并行，有依赖的串行
- 瓶颈任务优先启动
- 不要信任 agent 的产出，全部要验证
