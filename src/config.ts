import dotenv from 'dotenv';

dotenv.config();

export const config = {
  lark: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
    domain: process.env.LARK_DOMAIN || 'https://open.feishu.cn',
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  },
  mimoImageModel: process.env.MIMO_IMAGE_MODEL || 'mimo-v2.5-omni',
  maxTurns: parseInt(process.env.MAX_TURNS || '20'),
  driveFolderToken: process.env.DRIVE_FOLDER_TOKEN || '',
};
