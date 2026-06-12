import http from "http";
import { getUserToken } from "./oauth";

/**
 * OAuth 回调服务器
 *
 * 处理飞书 OAuth 授权回调，获取 user_access_token
 */

/** 多用户并发 OAuth resolve（支持同时多个用户授权） */
const oauthResolvers = new Map<string, (userId: string) => void>();

/**
 * 启动 OAuth 回调服务器
 */
export function startOAuthServer(port: number = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);
      console.log(`[oauth] 收到请求: ${req.method} ${url.pathname}`);

      // OAuth 回调路径
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>❌ 授权失败：未收到授权码</h1>");
          return;
        }

        try {
          // 用 code 换取 token
          const tokenInfo = await getUserToken(code);

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
              <head><meta charset="utf-8"><title>授权成功</title></head>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ 授权成功！</h1>
                <p>用户：${tokenInfo.userName}</p>
                <p>请返回飞书继续操作。</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);

          // 通知等待的代码（用 state 作为 key 支持多用户并发）
          const resolveKey = state || tokenInfo.userId;
          if (oauthResolvers.has(resolveKey)) {
            oauthResolvers.get(resolveKey)!(tokenInfo.userId);
            oauthResolvers.delete(resolveKey);
          }
        } catch (error: any) {
          console.error("OAuth 授权失败:", error.message);
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>❌ 授权失败：${error.message}</h1>`);
        }
        return;
      }

      // 授权页面
      if (url.pathname === "/auth") {
        const userId = url.searchParams.get("user_id");
        const { getOAuthUrl } = await import("./oauth");
        const oauthUrl = getOAuthUrl(userId || "default");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
            <head><meta charset="utf-8"><title>飞书授权</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>🔐 飞书授权</h1>
              <p>点击下方按钮授权智能体访问你的飞书云盘</p>
              <a href="${oauthUrl}" style="display: inline-block; padding: 15px 30px; background: #3370ff; color: white; text-decoration: none; border-radius: 5px; font-size: 16px;">
                授权访问
              </a>
            </body>
          </html>
        `);
        return;
      }

      // 默认页面
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<h1>飞书智能体 OAuth 服务</h1><p>访问 <a href="/auth">/auth</a> 进行授权</p>',
      );
    });

    server.listen(port, () => {
      console.log(`[oauth] OAuth 服务器已启动: http://localhost:${port}`);
      console.log(`[oauth] 授权链接: http://localhost:${port}/auth`);
      resolve(`http://localhost:${port}`);
    });

    server.on("error", reject);
  });
}

/**
 * 等待用户授权
 */
export function waitForOAuth(userId: string): Promise<string> {
  return new Promise((resolve) => {
    oauthResolvers.set(userId, resolve);
    // 5 分钟超时
    setTimeout(
      () => {
        if (oauthResolvers.has(userId)) {
          oauthResolvers.delete(userId);
          resolve("");
        }
      },
      5 * 60 * 1000,
    );
  });
}
