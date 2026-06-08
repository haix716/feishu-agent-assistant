import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from './config';

/**
 * OAuth 用户授权管理
 *
 * 流程：
 * 1. 用户访问授权链接 → 登录飞书 → 获取 auth_code
 * 2. 用 auth_code 换取 user_access_token
 * 3. 用 user_access_token 调用飞书 API（代表用户身份）
 */

interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // 过期时间戳
  userId: string;
  userName: string;
}

// token 存储文件路径
const TOKEN_FILE = path.join(process.cwd(), '.user-tokens.json');

// 用户 token 缓存
const userTokens = new Map<string, TokenInfo>();

/** 从文件加载 token */
function loadTokens(): void {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      for (const [userId, tokenInfo] of Object.entries(data)) {
        userTokens.set(userId, tokenInfo as TokenInfo);
      }
      console.log(`[oauth] 已加载 ${userTokens.size} 个用户 token`);
    }
  } catch (err) {
    console.error('[oauth] 加载 token 文件失败:', err);
  }
}

/** 保存 token 到文件 */
function saveTokens(): void {
  try {
    const data: Record<string, TokenInfo> = {};
    for (const [userId, tokenInfo] of userTokens.entries()) {
      data[userId] = tokenInfo;
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[oauth] 保存 token 文件失败:', err);
  }
}

// 启动时加载 token
loadTokens();

/**
 * 获取 OAuth 授权链接
 * 用户访问此链接后会跳转到飞书登录页
 */
export function getOAuthUrl(state: string): string {
  const redirectUri = encodeURIComponent(config.lark.redirectUri || 'http://localhost:3000/callback');
  return `${config.lark.domain}/open-apis/authen/v1/authorize?client_id=${config.lark.appId}&redirect_uri=${redirectUri}&state=${state}&scope=contact:user.base:readonly drive:drive`;
}

/**
 * 用 auth_code 换取 user_access_token
 */
export async function getUserToken(authCode: string): Promise<TokenInfo> {
  // 使用 v2 端点（之前的实现）
  const resp = await axios.post(
    `${config.lark.domain}/open-apis/authen/v2/oauth/token`,
    {
      grant_type: 'authorization_code',
      client_id: config.lark.appId,
      client_secret: config.lark.appSecret,
      code: authCode,
      redirect_uri: config.lark.redirectUri,
    },
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const data = resp.data;
  if (!data.access_token) {
    throw new Error('获取 token 失败: ' + JSON.stringify(data));
  }

  // 获取用户信息
  const userResp = await axios.get(
    `${config.lark.domain}/open-apis/authen/v1/user_info`,
    {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }
  );

  const tokenInfo: TokenInfo = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    userId: userResp.data.data?.open_id || '',
    userName: userResp.data.data?.name || '',
  };

  // 缓存 token
  userTokens.set(tokenInfo.userId, tokenInfo);
  saveTokens(); // 持久化保存
  return tokenInfo;
}

/**
 * 刷新 user_access_token
 */
export async function refreshUserToken(userId: string): Promise<TokenInfo | null> {
  const tokenInfo = userTokens.get(userId);
  if (!tokenInfo || !tokenInfo.refreshToken) return null;

  try {
    // 使用 v2 端点刷新 token
    const resp = await axios.post(
      `${config.lark.domain}/open-apis/authen/v2/oauth/token`,
      {
        grant_type: 'refresh_token',
        client_id: config.lark.appId,
        client_secret: config.lark.appSecret,
        refresh_token: tokenInfo.refreshToken,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = resp.data;
    if (!data.access_token) {
      console.error('刷新 token 失败:', data);
      return null;
    }

    const newTokenInfo: TokenInfo = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokenInfo.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
      userId: tokenInfo.userId,
      userName: tokenInfo.userName,
    };

    userTokens.set(userId, newTokenInfo);
    saveTokens(); // 持久化保存
    return newTokenInfo;
  } catch (err) {
    console.error('刷新 token 失败:', err);
    return null;
  }
}

/**
 * 检查用户是否已授权
 */
export function isUserAuthorized(userId: string): boolean {
  return userTokens.has(userId);
}
