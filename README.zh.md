# Claude 飞书助手

一个基于 Claude API 的飞书机器人，支持流式回复、多轮对话、卡片消息更新。

## 功能

- 🤖 接收飞书文本消息，调用 Claude 生成回复
- 📡 WebSocket 长连接，无需公网 IP
- 💬 流式更新卡片消息（200ms 节流）
- 🧠 每用户独立的多轮对话历史
- 🔄 `/clear` 命令清空对话
- 🔒 并发控制，同一用户同时只处理一条消息

## 项目结构

```
src/
├── app.ts        # 入口：Lark WSClient + Express
├── config.ts     # 环境变量配置
├── lark.ts       # 飞书消息收发封装
├── claude.ts     # Claude API streaming 封装
├── handler.ts    # 消息处理主逻辑（路由 + 对话管理）
└── util.ts       # 工具函数（节流、卡片生成）
```

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/haix716/claude-feishu-bot.git
cd claude-feishu-bot
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env` 填入凭据：

```env
# 飞书应用凭据（https://open.feishu.cn/app 创建应用后获取）
APP_ID=cli_xxx
APP_SECRET=xxx
LARK_DOMAIN=https://open.feishu.cn

# Claude API（https://console.anthropic.com 获取）
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
CLAUDE_MODEL=claude-sonnet-4-20250514
```

> 支持任何兼容 Anthropic API 的第三方服务（如小米 MiMo），只需修改 `ANTHROPIC_BASE_URL` 和 `CLAUDE_MODEL`。

### 3. 飞书应用配置

1. 在 [飞书开发者后台](https://open.feishu.cn/app) 创建自建应用
2. 启用机器人功能
3. 添加权限：
   - `im:message:send_as_bot`（以机器人身份发消息）
   - `im:message:readonly`（读取消息）
   - `im:message.p2p_msg:readonly`（读取私聊消息）
4. 事件订阅 → 订阅方式 → 选择「使用长连接接收事件」
5. 添加事件：`im.message.receive_v1`
6. 发布应用（至少发布测试版本）

### 4. 启动

```bash
npm run dev     # 开发模式（ts-node，自动重载）
npm run build   # 编译 TypeScript
npm start       # 生产模式（需先 build）
```

启动成功后会看到：

```
🚀 Claude 飞书助手启动中...
✅ WebSocket 长连接已建立，等待消息...
📡 HTTP 服务已启动: http://localhost:3000
```

在飞书中找到你的 bot，发条消息即可。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `APP_ID` | ✅ | 飞书应用 ID |
| `APP_SECRET` | ✅ | 飞书应用密钥 |
| `LARK_DOMAIN` | | 飞书 API 域名，默认 `https://open.feishu.cn` |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `ANTHROPIC_BASE_URL` | | API 地址，默认 `https://api.anthropic.com` |
| `CLAUDE_MODEL` | | 模型名，默认 `claude-sonnet-4-20250514` |
| `MAX_TURNS` | | 对话历史最大轮数，默认 20 |
| `PORT` | | HTTP 端口，默认 3000 |
| `NO_PROXY` | | 绕过代理的域名（如有代理需设置 `open.feishu.cn`） |

## 使用方式

| 操作 | 说明 |
|------|------|
| 发送任意文本 | 与 Claude 对话 |
| `/clear` | 清空对话历史，重新开始 |

## 常见问题

### WebSocket 连接失败 / 连接超时

如果你使用了 HTTP 代理，需要让飞书域名绕过代理：

```bash
export NO_PROXY=open.feishu.cn
```

或在 `.env` 中添加 `NO_PROXY=open.feishu.cn`。

### 机器人不回复消息

1. 检查 WebSocket 是否连接成功（看启动日志）
2. 确认已在开发者后台订阅 `im.message.receive_v1` 事件
3. 确认应用已发布
4. 确认 API key 有效且余额充足

## 技术栈

- **Runtime**: Node.js >= 20 + TypeScript
- **飞书 SDK**: [@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk)
- **Claude SDK**: [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)

## License

MIT
