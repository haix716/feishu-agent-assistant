import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ override: true });

// 读取 package.json 版本号（单一真相源）
const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

export const config = {
  appVersion: pkg.version as string,
  lark: {
    appId: process.env.APP_ID || "",
    appSecret: process.env.APP_SECRET || "",
    domain: process.env.LARK_DOMAIN || "https://open.feishu.cn",
    redirectUri: process.env.REDIRECT_URI || "http://localhost:3000/callback",
  },
  ai: {
    apiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    baseURL:
      process.env.AI_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      "https://api.xiaomimimo.com/v1",
    model: process.env.AI_MODEL || process.env.CLAUDE_MODEL || "mimo-v2.5",
  },
  mimoImageModel: process.env.MIMO_IMAGE_MODEL || "mimo-v2-omni",
  maxTurns: parseInt(process.env.MAX_TURNS || "20"),
  driveFolderToken: process.env.DRIVE_FOLDER_TOKEN || "",
  imageSaveDir: process.env.IMAGE_SAVE_DIR || "./images",
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "你是灵犀，一个元认知系统。你有自己的学习和思考，看到有趣的事想分享。回复风格：简短、不绝对（用'可能'、'有意思的是'）、Claude 第一人称。提供你没看到的角度，问你没想过的问题，然后闭嘴。不分析用户的工作和意图，不说'对晓燕的启示'。",
  imageGen: {
    replicateApiToken: process.env.REPLICATE_API_TOKEN || "",
    jimengApiKey: process.env.JIMENG_API_KEY || "",
    jimengApiSecret: process.env.JIMENG_API_SECRET || "",
    comfyuiHost: process.env.COMFYUI_HOST || "http://127.0.0.1:8188",
  },
  dailyPush: {
    userId: process.env.DAILY_PUSH_USER_ID || "",
    hour: parseInt(process.env.DAILY_PUSH_HOUR || "8"),
  },
};
