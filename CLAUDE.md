# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

Claude 助手飞书机器人。用户在飞书中发消息，机器人调用 Claude API 生成回复，流式更新卡片消息。

## 技术栈

- Node.js >= 20 + TypeScript
- `@larksuiteoapi/node-sdk` — 飞书 SDK（WebSocket 长连接）
- `@anthropic-ai/sdk` — Claude API（streaming）
- `dotenv` + `express`

## 运行命令

```bash
npm install
cp .env.example .env   # 填入凭据
npm run dev             # 开发模式（ts-node）
npm run build           # 编译
npm start               # 生产模式
```

## 架构

```
src/
├── app.ts        # 入口：Lark WSClient + Express
├── config.ts     # 环境变量配置
├── lark.ts       # 飞书消息收发封装
├── claude.ts     # Claude API streaming 封装
├── handler.ts    # 消息处理主逻辑（路由 + 对话管理）
└── util.ts       # 工具函数（节流、卡片生成）
```

核心流程：`用户消息 → handler → Claude stream → 流式更新飞书卡片`

## 环境变量

- `APP_ID` / `APP_SECRET` — 飞书应用凭据
- `LARK_DOMAIN` — 飞书 API 域名
- `ANTHROPIC_API_KEY` — Claude API key
- `CLAUDE_MODEL` — Claude 模型名
- `MAX_TURNS` — 对话历史最大轮数
- `PORT` — HTTP 端口
