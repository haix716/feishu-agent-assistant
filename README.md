# Claude 飞书助手 / Claude Feishu Bot

一个基于 Claude API 的飞书机器人，支持流式回复、多轮对话、卡片消息更新。

A Feishu/Lark bot powered by Claude API, with streaming responses, multi-turn conversation, and card message updates.

---

## 功能 / Features

- 🤖 接收飞书文本消息，调用 Claude 生成回复
- 📡 WebSocket 长连接，无需公网 IP
- 💬 流式更新卡片消息（200ms 节流）
- 🧠 每用户独立的多轮对话历史
- 🔄 `/clear` 命令清空对话
- 🔒 并发控制，同一用户同时只处理一条消息

---

## 项目结构 / Project Structure

```
src/
├── app.ts        # 入口：Lark WSClient + Express / Entry: Lark WSClient + Express
├── config.ts     # 环境变量配置 / Environment config
├── lark.ts       # 飞书消息收发封装 / Lark message API wrapper
├── claude.ts     # Claude API streaming 封装 / Claude API streaming wrapper
├── handler.ts    # 消息处理主逻辑 / Message handler (routing + conversation)
└── util.ts       # 工具函数 / Utilities (throttle, card generation)
```

## 快速开始 / Quick Start

### 1. 安装依赖 / Install

```bash
git clone https://github.com/haix716/claude-feishu-bot.git
cd claude-feishu-bot
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

# Claude API / Model API (https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
CLAUDE_MODEL=claude-sonnet-4-20250514
```

### 3. 飞书应用配置 / Feishu App Setup

1. 在 [飞书开发者后台](https://open.feishu.cn/app) 创建自建应用
2. 启用机器人功能
3. 添加权限：`im:message:send_as_bot`、`im:message:readonly`、`im:message.p2p_msg:readonly`
4. 事件订阅 → 订阅方式 → 选择「使用长连接接收事件」
5. 添加事件：`im.message.receive_v1`
6. 发布应用

### 4. 启动 / Run

```bash
npm run dev     # 开发模式 / Development (ts-node)
npm run build   # 编译 / Build
npm start       # 生产模式 / Production
```

启动后在飞书中找到你的 bot，发条消息即可。

After starting, find your bot in Feishu and send a message.

## 环境变量 / Environment Variables

| 变量 | 必填 | 说明 | Description |
|------|------|------|-------------|
| `APP_ID` | ✅ | 飞书应用 ID | Feishu app ID |
| `APP_SECRET` | ✅ | 飞书应用密钥 | Feishu app secret |
| `LARK_DOMAIN` | | 飞书 API 域名，默认 `https://open.feishu.cn` | Feishu API domain |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key | Claude API key |
| `ANTHROPIC_BASE_URL` | | API 地址，默认 `https://api.anthropic.com` | API base URL |
| `CLAUDE_MODEL` | | 模型名，默认 `claude-sonnet-4-20250514` | Model name |
| `MAX_TURNS` | | 对话历史最大轮数，默认 20 | Max conversation turns |
| `PORT` | | HTTP 端口，默认 3000 | HTTP port |
| `NO_PROXY` | | 绕过代理的域名 | Domains to bypass proxy |

## 使用方式 / Usage

| 命令 | 说明 |
|------|------|
| 发送任意文本 | 与 Claude 对话 / Chat with Claude |
| `/clear` | 清空对话历史 / Clear conversation history |

## 技术栈 / Tech Stack

- **Runtime**: Node.js >= 20 + TypeScript
- **飞书 SDK**: [@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk)
- **Claude SDK**: [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)

## License

MIT
