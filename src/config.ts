import dotenv from 'dotenv';

dotenv.config({ override: true });

export const config = {
  lark: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
    domain: process.env.LARK_DOMAIN || 'https://open.feishu.cn',
  },
  ai: {
    apiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    baseURL: process.env.AI_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/v1',
    model: process.env.AI_MODEL || process.env.CLAUDE_MODEL || 'mimo-v2.5',
  },
  mimoImageModel: process.env.MIMO_IMAGE_MODEL || 'mimo-v2.5-omni',
  maxTurns: parseInt(process.env.MAX_TURNS || '20'),
  driveFolderToken: process.env.DRIVE_FOLDER_TOKEN || '',
  systemPrompt: process.env.SYSTEM_PROMPT || '你是飞书智能体助手，基于 AI 大模型，通过飞书 Channel SDK 集成。你的能力包括：文本对话、图片理解、文件解析、云文档链接读取、群文件浏览等。请用中文回复，简洁友好。',
};
