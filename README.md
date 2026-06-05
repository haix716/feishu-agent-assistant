# 飞书智能体助手 / Feishu Agent Assistant

一个基于 Channel SDK 的飞书智能体助手，支持流式回复、多轮对话、卡片消息更新、多模态内容处理。

A Feishu/Lark intelligent agent powered by Channel SDK, with streaming responses, multi-turn conversation, card message updates, and multimodal content handling.

---

## 项目定位 / Positioning

**飞书是中转站，本地 AI（Claude/Hermes）是核心处理能力。**

```
用户消息 → 飞书（中转站）→ 本地 AI（Claude/Hermes）→ 工具调用 → 返回结果
```

## 5W1H 需求分析

### What（做什么）
小红书店铺运营自动化：
- 素材管理：收集、整理、分类图片/视频
- 内容创作：生图、高清、裁剪、视频制作
- 品牌一致：风格统一、提示词精准
- 发布管理：发笔记、上架商品

### Why（为什么）
- 人工找图效率低（几千张图片）
- 风格不统一，品牌感弱
- 重复工作多（生图、裁剪、加水印）
- 发布流程繁琐（手动上传、写文案）

### Who（谁用）
小红书店铺运营者：有设计需求但非专业设计师，需要批量产出内容

### When（什么时候用）
- 日常：收集素材、整理归档
- 创作：生图、做视频、写文案
- 发布：发笔记、上架商品

### Where（在哪里用）
- 飞书：消息交互（主要）
- 本地文件夹：素材存储
- 小红书：发布平台

### How（怎么做）
消息驱动 + 命令驱动混合模式：
- 简单操作：消息驱动（"帮我做个手镯展示图"）
- 复杂操作：命令驱动（/workflow 手镯广告）
- 批量操作：脚本驱动（批量发布）

---

## 功能 / Features

### 基础功能
- 🤖 接收飞书文本消息，调用 AI 生成回复
- 📡 Channel SDK 自动管理 WebSocket 长连接
- 💬 流式更新卡片消息（内置节流和打字机动画）
- 🧠 每用户独立的多轮对话历史
- 🔄 `/clear` 命令清空对话
- 🔒 并发控制，同一用户同时只处理一条消息

### 多模态功能
- 🖼️ 图片自动保存到本地 + AI 内容识别（MiMo 模型）
- 🎵 音视频自动保存到本地
- 📄 二进制文件导入（xlsx/docx → 飞书文档，可读取内容）
- 🔗 飞书云文档链接自动解析（支持 docx/doc/wiki/sheets/base）
- 📁 群文件浏览与读取（「群文件」/「读文件 xxx」指令）

### 智能文件管理
- 📂 自动创建日期文件夹结构（`{IMAGE_SAVE_DIR}/{YYYYMMDD}/`）
- 📝 自动创建飞书待办事项（每天首次保存图片时）
- 🧠 AI 内容识别：自动生成图片描述和文件名

### RAG 搜索（v2.3 新增）
- 🔍 本地图片搜索（"搜xxx"指令）
- 📊 多策略匹配：文件名、描述、标签
- 📁 结果展示：文件名 + 相对路径

### 图片生成（v2.4 新增）
- 🎨 用户上传图片 → AI 分析 → 生成穿戴效果图/商品图/小红书封面
- 🤖 Replicate API（Flux 通用生图 + IDM-VTON 虚拟试穿）
- 📝 自动提示词生成：MiMo 多模态分析图片 → 英文提示词

### 工作流能力（规划中）
- 🎬 视频制作：TapNow / 剪映 MCP
- 📝 文案生成：基于 RAG 参考图
- 📦 发布管理：小红书 MCP

### 安全保障（v2.4.1 新增）
- 🔒 Pre-commit + Pre-push hooks 自动扫描敏感信息
- 🛡️ 5 层安全检测：禁文件、API key 模式、本地路径、媒体文件、隐藏目录
- 🔑 环境变量管理：所有密钥存 `.env`，代码只引用 `process.env`
- 📋 安全文档：质量保障体系 + 安全保障体系（Obsidian）

---

## 项目结构 / Project Structure

```
src/
├── app.ts        # 入口：createLarkChannel + Channel SDK
├── config.ts     # 环境变量配置
├── ai.ts         # AI API 封装（OpenAI SDK，流式 + 图片理解）
├── lark.ts       # 飞书文件/文档操作封装（Client）
├── handler.ts    # 消息处理主逻辑（路由 + 对话 + 文件处理）
├── rag.ts        # RAG 搜索模块（本地图片索引 + 文本匹配）
├── util.ts       # 工具函数（正则、文件解析）
├── tools/        # 工具调用（GetTimeTool、SearchDocTool）
└── image-gen/    # 图片生成模块
    ├── analyzer.ts       # 图片分析 + 提示词生成
    ├── prompt-builder.ts # 提示词模板库
    ├── router.ts         # 场景路由
    └── providers/        # Provider（Replicate、即梦）

scripts/
├── security-check.sh  # 敏感信息检测（5 层扫描）
└── lint-check.sh      # 代码规范检查

.husky/
├── pre-commit         # commit 前：lint + 安全检查
└── pre-push           # push 前：测试 + 安全检查
```

## 架构设计 / Architecture

```
飞书（中转站）
    ↓
本地 AI（Claude/Hermes）
    ↓
┌─────────────────────────────────────────┐
│           意图识别层                      │
├─────────────────────────────────────────┤
│ 素材管理 → 保存、搜索、分类               │
│ 内容创作 → 生图、视频、文案               │
│ 发布管理 → 小红书笔记、商品               │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│           工作流引擎                      │
├─────────────────────────────────────────┤
│ 图片工作流：生图 → 高清 → 裁剪           │
│ 视频工作流：图片 → 剪映模板 → 宣传视频    │
│ 文案工作流：参考图 → 提示词 → 生成        │
│ 发布工作流：内容 → 小红书 MCP → 发布      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│           工具层                          │
├─────────────────────────────────────────┤
│ RAG（ChromaDB + CLIP）→ 语义搜索         │
│ GPT-IMG-2 / Seedream → 图片生成          │
│ TapNow / 剪映 MCP → 视频制作            │
│ 小红书 MCP → 发布管理                    │
└─────────────────────────────────────────┘
```

## 并行开发计划 / Parallel Development

```
前置任务（可并行，无依赖）：
├── 任务0A：ComfyUI 部署 + 基础工作流（高清、裁剪、风格化）
├── 任务0B：剪映 MCP 部署
└── 任务0C：小红书 MCP 调研

核心任务（可并行）：
├── 任务A：RAG（ChromaDB + CLIP + 语义搜索）
├── 任务B：图片生成（GPT-IMG-2 / Seedream）
├── 任务C：视频制作（TapNow / 剪映模板）
└── 任务D：发布管理（小红书 MCP）

工作流任务（依赖核心任务）：
└── 任务E：工作流编排（依赖 A + B + C + D）
```

## 技术栈（规划中）/ Tech Stack (Planned)

| 组件 | 选择 | 部署方式 | 依赖 |
|------|------|----------|------|
| 图片后处理 | ComfyUI | 本地部署 | 无（前置）|
| 视频模板 | 剪映 MCP | 本地部署 | 无（前置）|
| 向量数据库 | ChromaDB | 本地文件 | 无 |
| 图片嵌入 | CLIP | 本地模型 | 无 |
| 图片生成 | GPT-IMG-2 | API 调用 | 无 |
| 视频生成 | TapNow | API 调用 | 无 |
| 发布管理 | 小红书 MCP | API 调用 | 无 |
| 工作流 | 代码编排 | 本地 | 依赖全部 |

## 快速开始 / Quick Start

### 1. 安装依赖 / Install

```bash
git clone https://github.com/haix716/feishu-agent-assistant.git
cd feishu-agent-assistant
npm install
```

### 2. 配置 / Configure

```bash
cp .env.example .env
```

编辑 `.env` 填入凭据 / Edit `.env` with your credentials:

```env
# 飞书应用凭据 / Feishu app credentials (https://open.feishu.cn/app)
APP_ID=cli_xxx
APP_SECRET=xxx
LARK_DOMAIN=https://open.feishu.cn

# AI API (OpenAI 兼容格式)
ANTHROPIC_API_KEY=sk-xxx
ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/v1
CLAUDE_MODEL=mimo-v2.5-pro

# 可选：图片分析模型（默认 mimo-v2.5-omni）
# MIMO_IMAGE_MODEL=mimo-v2.5-omni

# 可选：指定云盘文件夹 token（不配置则自动创建）
# DRIVE_FOLDER_TOKEN=xxx
```

### 3. 飞书智能体应用配置 / Feishu Agent Setup

**方式一：一键创建（推荐）**

运行应用时会自动生成二维码，扫码即可创建智能体应用，自动预置所有权限和事件订阅。

**方式二：手动创建**

1. 在 [飞书开发者后台](https://open.feishu.cn/app) 创建自建应用
2. 启用机器人功能
3. 添加权限：
   - `im:message:send_as_bot` — 发送消息
   - `im:message:readonly` — 读取消息
   - `im:message.p2p_msg:readonly` — 读取私聊消息
   - `im:resource` — 获取消息中的图片/文件
   - `drive:drive` — 云盘文件读写
   - `docx:document:readonly` — 读取云文档
   - `wiki:wiki:readonly` — 读取知识库
   - `cardkit:card:write` — 卡片交互
4. 事件订阅 → 订阅方式 → 选择「使用长连接接收事件」
5. 添加事件：`im.message.receive_v1`
6. 发布应用

### 4. 启动 / Run

```bash
npm run dev     # 开发模式 / Development (ts-node)
npm run build   # 编译 / Build
npm start       # 生产模式 / Production
npm run lint    # 代码检查 / Lint
npm test        # 运行测试 / Test
```

启动后在飞书中找到你的智能体，发条消息即可。

After starting, find your agent in Feishu and send a message.

## 环境变量 / Environment Variables

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `APP_ID` | ✅ | 飞书应用 ID | — |
| `APP_SECRET` | ✅ | 飞书应用密钥 | — |
| `LARK_DOMAIN` | | 飞书 API 域名 | `https://open.feishu.cn` |
| `AI_API_KEY` | ✅ | AI API key | — |
| `AI_BASE_URL` | | API 地址（OpenAI 兼容） | `https://api.xiaomimimo.com/v1` |
| `AI_MODEL` | | 对话模型名 | `mimo-v2.5` |
| `MIMO_IMAGE_MODEL` | | 图片分析模型 | `mimo-v2-omni` |
| `IMAGE_SAVE_DIR` | | 图片/视频保存目录 | `./images` |
| `MAX_TURNS` | | 对话历史最大轮数 | `20` |
| `NO_PROXY` | | 绕过代理的域名 | — |

## 使用方式 / Usage

### 基础指令

| 指令 | 说明 |
|------|------|
| 发送任意文本 | 与 AI 对话 |
| `/clear` | 清空对话历史 |
| 发送图片 | 自动保存到本地 + AI 识别内容 |
| 发送音视频 | 自动保存到本地 |
| 发送文件 (txt/pdf/docx/xlsx) | 读取内容并对话 |
| 粘贴飞书文档链接 | 自动读取文档内容 |
| `群文件` | 列出群聊文件 |
| `读文件 xxx` | 读取指定文件内容 |

### 工作流指令（规划中）

| 指令 | 说明 |
|------|------|
| `生成手镯宣传图` | 调用 RAG + 图片生成 |
| `做成15秒宣传视频` | 调用视频制作工作流 |
| `发布到小红书` | 调用小红书 MCP 发布 |
| `/search 手镯` | 语义搜索素材 |
| `/workflow 手镯广告` | 执行完整工作流 |

### 用户操作流程

```
第一步：素材收集
用户：发送图片/视频
机器人：自动保存 + 识别 + 分类 + 存入 RAG

第二步：内容创作
用户："生成一组手镯宣传图，参考之前的风格"
机器人：
  1. RAG 搜索相似图片
  2. 提取风格特征
  3. 生成提示词
  4. 调用 GPT-IMG-2 生成图片
  5. 可选：ComfyUI 后处理

第三步：视频制作
用户："把手镯图做成15秒宣传视频"
机器人：
  1. 选择剪映模板
  2. 填充图片+文案
  3. 生成视频

第四步：发布
用户："发布到小红书，标题：xxx"
机器人：
  1. 调用小红书 MCP
  2. 上传图片/视频
  3. 填写标题、描述、标签
  4. 发布笔记
```

## 技术栈 / Tech Stack

- **Runtime**: Node.js >= 20 + TypeScript
- **飞书 SDK**: [@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk)（Channel SDK + Client）
- **AI SDK**: [openai](https://github.com/openai/openai-node)（OpenAI 兼容格式，支持 MiMo 等模型）
- **测试**: Node.js 内置 test runner

## 开发方式 / Development Workflow

采用 Git Worktree + Subagent 并行开发：

```
.claude/
├── plans/        # 开发计划
├── agents/       # 自定义 subagent
└── workflows/    # 工作流脚本

.trees/           # 并行开发的 worktree 目录（已 gitignore）
```

## License

MIT
