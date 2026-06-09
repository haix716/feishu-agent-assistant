import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ override: true });

// 读取 package.json 版本号（单一真相源）
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

export const config = {
  appVersion: pkg.version as string,
  lark: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
    domain: process.env.LARK_DOMAIN || 'https://open.feishu.cn',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback',
  },
  ai: {
    apiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    baseURL: process.env.AI_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.xiaomimimo.com/v1',
    model: process.env.AI_MODEL || process.env.CLAUDE_MODEL || 'mimo-v2.5',
  },
  mimoImageModel: process.env.MIMO_IMAGE_MODEL || 'mimo-v2-omni',
  maxTurns: parseInt(process.env.MAX_TURNS || '20'),
  driveFolderToken: process.env.DRIVE_FOLDER_TOKEN || '',
  imageSaveDir: process.env.IMAGE_SAVE_DIR || './images',
  systemPrompt: process.env.SYSTEM_PROMPT || '你是飞书智能体助手，基于 AI 大模型，通过飞书 Channel SDK 集成。你的能力包括：文本对话、图片理解、文件解析、云文档链接读取、群文件浏览等。请用中文回复，简洁友好。',
  imageGen: {
    replicateApiToken: process.env.REPLICATE_API_TOKEN || '',
    jimengApiKey: process.env.JIMENG_API_KEY || '',
    jimengApiSecret: process.env.JIMENG_API_SECRET || '',
    comfyuiHost: process.env.COMFYUI_HOST || 'http://127.0.0.1:8188',
  },
};
