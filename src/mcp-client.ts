/**
 * 灵犀 MCP client
 *
 * bot 通过 MCP 协议调用灵犀（spawn 灵犀的 MCP server 作为子进程），
 * 不再直接伸手进灵犀的文件系统——这是灵犀/bot 解耦的实质。
 *
 * 长连接单例：首次调用 spawn 一次灵犀 server，后续复用。
 * 灵犀是 ESM，bot 是 CommonJS，用动态 import() 引入 MCP SDK。
 */
import path from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** 灵犀项目根目录（与 metacognition.ts 的 METACOGNITION_BASE 同源计算） */
const LINGXI_ROOT = path.join(__dirname, "..", "..", "claude-metacognition");

/** 检索命中结构（与灵犀 search_insights 返回一致） */
export interface InsightHit {
  domain: string;
  insight: string;
  score: number;
  extractedAt?: string;
  sourceId?: string;
}

/** 推送清单 manifest（灵犀推送时落盘的编号 → 洞察映射） */
export interface PushedManifest {
  date: string;
  pushedAt: string;
  threshold: number;
  count: number;
  items: Array<{
    index: number;
    domain: string;
    insight: string;
    score: number;
  }>;
}

// ==================== 长连接单例 ====================

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

/** 获取（或建立）到灵犀 MCP server 的长连接 */
async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    // CJS 引入 ESM 的 MCP SDK：用动态 import()
    const { Client: MCPClient } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp/server.ts"],
      cwd: LINGXI_ROOT,
    });
    const c = new MCPClient(
      { name: "claude-bot", version: "2.5.0" },
      { capabilities: {} },
    );
    await c.connect(transport);
    console.log("[mcp-client] 已连接灵犀 MCP server");
    client = c;
    connecting = null;
    return c;
  })();
  return connecting;
}

/** 从 callTool 结果里提取 text */
function extractText(result: unknown): string {
  const content = (result as {
    content?: Array<{ type: string; text?: string }>;
  })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

/** 连接失败时重置，下次调用重连 */
function resetConnection(): void {
  client = null;
  connecting = null;
}

// ==================== 对外工具 ====================

/** 关键词搜索灵犀知识库（走 MCP search_insights） */
export async function searchInsightsViaMCP(
  query: string,
  limit = 5,
): Promise<InsightHit[]> {
  try {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_insights",
      arguments: { query, limit },
    });
    const text = extractText(result);
    return JSON.parse(text) as InsightHit[];
  } catch (err) {
    console.error("[mcp-client] search_insights 失败:", err);
    resetConnection();
    return [];
  }
}

/** 读取今日推送清单 manifest（走 MCP get_pushed_manifest） */
export async function getPushedManifestViaMCP(): Promise<PushedManifest | null> {
  try {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_pushed_manifest",
      arguments: {},
    });
    const text = extractText(result);
    if (!text || text.includes("今日无推送清单")) return null;
    return JSON.parse(text) as PushedManifest;
  } catch (err) {
    console.error("[mcp-client] get_pushed_manifest 失败:", err);
    resetConnection();
    return null;
  }
}

/** 关闭连接（进程退出时调） */
export async function closeMCPClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      // 忽略关闭错误
    }
    client = null;
  }
}
