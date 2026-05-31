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
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  },
  maxTurns: parseInt(process.env.MAX_TURNS || '20'),
  port: parseInt(process.env.PORT || '3000'),
};
