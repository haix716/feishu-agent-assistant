/**
 * 元认知系统集成模块
 *
 * 连接飞书助手（执行层）和元认知系统（学习层）
 * - 读取元认知系统的洞察，供 AI 回复时参考（带缓存）
 * - 记录用户反馈，回流到元认知系统
 * - 推送每日洞察到飞书
 */

import fs from "fs";
import path from "path";
import {
  searchInsightsViaMCP,
  getPushedManifestViaMCP,
  getInsightDetailViaMCP,
  type InsightHit,
  type PushedManifest,
  type InsightDetail,
} from "./mcp-client";

/** 系统能力清单（硬编码，新功能上线后更新） */
const SYSTEM_CAPABILITIES = `### 灵犀系统当前能力
这是一个已经在运行的元认知系统，包含以下功能：
1. **知识采集**：从 GitHub trending、ArXiv、RSS（Hacker News/TechCrunch）、聚焦公司/技术方向自动采集
2. **洞察提取**：LLM 对采集到的知识进行评分、分类、提取洞察
3. **日度反思**：每天生成反思报告
4. **日报推送**：每日自动推送到飞书群聊/私聊
5. **反馈回路**：记录用户在飞书中的互动，回流到反思引擎调整权重
6. **判断力追踪**：分析不同 Claude 会话之间的判断一致性（judge-track 工具）
7. **自记录**：每个 Claude 会话可以留下判断、问题、原始想法给下一个 Claude

不要重复设计已有功能。如果用户提到某个方向，先确认是否已有实现，再建议改进。`;

/** 元认知知识库路径 */
const METACOGNITION_BASE = path.join(
  __dirname,
  "..",
  "..",
  "claude-metacognition",
  "knowledge-base",
);

/** 用户反馈路径 */
const FEEDBACK_DIR = path.join(METACOGNITION_BASE, "feedback");

/** 洞察结构 */
interface Insight {
  id: string;
  sourceId: string;
  insight: string;
  relevance: string;
  connection: string;
  score: number;
  domain: string;
  extractedAt: string;
}

// ==================== 缓存机制 ====================

/** 缓存的元认知上下文 */
let cachedContext: string | null = null;

/** 缓存时间 */
let cachedAt: number = 0;

/** 缓存有效期（1 小时） */
const CACHE_TTL = 60 * 60 * 1000;

/**
 * 读取最近的高价值洞察（带缓存）
 */
export function getRecentInsights(
  minScore: number = 7,
  limit: number = 10,
): Insight[] {
  const insightsDir = path.join(METACOGNITION_BASE, "insights");
  if (!fs.existsSync(insightsDir)) {
    return [];
  }

  const insights: Insight[] = [];
  const domains = fs.readdirSync(insightsDir);

  for (const domain of domains) {
    const domainDir = path.join(insightsDir, domain);
    if (!fs.statSync(domainDir).isDirectory()) continue;

    const files = fs.readdirSync(domainDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const filepath = path.join(domainDir, file);
        const content = fs.readFileSync(filepath, "utf-8");
        const insight = JSON.parse(content) as Insight;
        if (insight.score >= minScore) {
          insights.push(insight);
        }
      } catch {
        // skip invalid files
      }
    }
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * 把检索命中拼进 query（纯函数，不依赖 MCP/文件，可单元测试）。
 *
 * 命中 0 条则原样返回 query（不注入）。
 */
export function formatRetrieved(
  query: string,
  hits: InsightHit[],
): { augmentedQuery: string; sourcePrefix: string; allHits: InsightHit[] } {
  if (hits.length === 0)
    return { augmentedQuery: query, sourcePrefix: "", allHits: [] };
  // 只展示前 3 条，剩下的让 AI 按需引用
  const topHits = hits.slice(0, 3);
  const retrieved = topHits
    .map(
      (r, i) =>
        `${i + 1}. [${r.domain}]（${r.score}分，采集于${r.extractedAt?.split("T")[0] ?? "?"}）${r.insight}`,
    )
    .join("\n");
  const extraCount = hits.length - topHits.length;
  const extraNote =
    extraCount > 0 ? `\n（另有 ${extraCount} 条，回复「全部」查看详情）` : "";
  const sourcePrefix = `[灵犀] 检索到 ${hits.length} 条相关内容（采集于 ${hits[0]?.extractedAt?.split("T")[0] ?? "?"}）：\n${retrieved}${extraNote}`;
  const augmentedQuery = `${query}\n\n${sourcePrefix}`;
  return { augmentedQuery, sourcePrefix, allHits: hits };
}

/**
 * 通过 MCP 检索灵犀知识库并改写 query。
 *
 * 走灵犀 MCP server 的 search_insights（不再直接读灵犀文件 = 解耦）。
 * MCP 连接失败时 searchInsightsViaMCP 返回 []，formatRetrieved 原样返回 query
 * ——bot 仍能回答，只是没有灵犀上下文。
 */
export async function retrieveAndAugment(
  query: string,
  limit = 5,
): Promise<{ augmentedQuery: string; sourcePrefix: string; allHits: InsightHit[] }> {
  console.log("[retrieveAndAugment] 调用, query:", query);
  const hits = await searchInsightsViaMCP(query, limit);
  console.log("[retrieveAndAugment] hits:", hits.length);
  return formatRetrieved(query, hits);
}

/**
 * 读取最新的反思报告
 */
export function getLatestReflection(): string | null {
  const reflectionsDir = path.join(METACOGNITION_BASE, "reflections");
  if (!fs.existsSync(reflectionsDir)) {
    return null;
  }

  const files = fs
    .readdirSync(reflectionsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return fs.readFileSync(path.join(reflectionsDir, files[0]), "utf-8");
}

/**
 * 读取最新的日报
 */
export function getLatestDigest(): string | null {
  const digestDir = path.join(METACOGNITION_BASE, "digest");
  if (!fs.existsSync(digestDir)) {
    return null;
  }

  const files = fs
    .readdirSync(digestDir)
    .filter((f) => f.startsWith("daily-") && f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return fs.readFileSync(path.join(digestDir, files[0]), "utf-8");
}

/**
 * 读取今日推送清单 manifest（走 MCP get_pushed_manifest，不再直接读灵犀文件）。
 *
 * 用于追问"第 N 条"：取和当日卡片 1:1 对应的清单，喂给 AI 展开第 N 条。
 * PushedManifest 类型来自 mcp-client，与灵犀推送契约一致。
 */
export async function getPushedManifest(): Promise<PushedManifest | null> {
  return getPushedManifestViaMCP();
}

/** 获取单条洞察详情（含原始新闻内容） */
export async function getInsightDetail(
  sourceId: string,
): Promise<InsightDetail | null> {
  return getInsightDetailViaMCP(sourceId);
}

/**
 * 生成日报飞书卡片 JSON（markdown 列表格式）
 */
export function buildDailyCard(manifest: PushedManifest): Record<string, unknown> {
  const insightLines = manifest.items
    .map(
      (item) =>
        `${item.index}. **[${item.domain}]** ${item.insight}（${item.score}分）`,
    )
    .join("\n");

  return {
    header: {
      title: { tag: "plain_text", content: `✨ 灵犀日报 ${manifest.date}` },
      template: "purple",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: insightLines,
        },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `📊 采集 ${manifest.count} 条，阈值 ${manifest.threshold} 分 | 我今天看到这些，想告诉你——哪条你想聊聊？回个数字我就展开讲。`,
        },
      },
    ],
  };
}

/**
 * 生成元认知上下文（带缓存，1 小时刷新）
 *
 * 包含五部分：
 * 1. 今日推送内容（用户刚收到的日报，可追问）
 * 2. 连接发现（反思报告中提取，最有价值）
 * 3. 认知变化追踪（反思报告中提取，追踪用户思考演变）
 * 4. 反思摘要（最近的反思要点）
 * 5. 高价值洞察（原始数据）
 */
export function generateMetacognitionContext(): string {
  const now = Date.now();

  // 缓存命中
  if (cachedContext && now - cachedAt < CACHE_TTL) {
    return cachedContext;
  }

  // 重新生成（只取 Claude 自己的：洞察、反思、自记录 + 推送清单。
  // 不再注入"连接发现/认知变化"——那是分析用户的内容，会让 bot 围着用户转）
  const insights = getRecentInsights(8, 5);
  const reflection = getLatestReflection();
  const digest = getLatestDigest();
  const reflectionSummary = reflection ? extractSummary(reflection) : null;

  if (insights.length === 0 && !reflection) {
    cachedContext = "";
    cachedAt = now;
    return "";
  }

  // 读取最新自记录
  const latestSelfRecord = getLatestSelfRecord();

  let context = "\n\n## 元认知系统上下文\n";

  // 系统能力清单（防止重复设计已有功能）
  context += SYSTEM_CAPABILITIES + "\n";

  // 最新自记录（Claude 的思考）
  if (latestSelfRecord) {
    context += latestSelfRecord + "\n";
  }

  // 今日推送清单（供追问"第 N 条"用，中性措辞——不框"晓燕/用户"）
  if (digest) {
    context += "\n### 今日推送清单\n";
    context += "（对方可能回 1、2 等数字追问某条，据此展开）\n";
    context += digest + "\n";
  }

  // 反思摘要
  if (reflectionSummary) {
    context += "\n### 今日反思要点\n";
    context += reflectionSummary + "\n";
  }

  // 高价值洞察
  if (insights.length > 0) {
    context += "\n### 高价值洞察\n";
    for (const insight of insights) {
      context += `- [${insight.domain}] ${insight.insight}\n`;
    }
  }

  cachedContext = context;
  cachedAt = now;

  console.log(`[元认知] 缓存已更新，${insights.length} 条洞察`);
  return context;
}

/**
 * 从反思报告中提取"今日要点"板块（摘要）
 */
function extractSummary(reflection: string): string | null {
  const match = reflection.match(/今日要点[\s\S]*?\n([\s\S]*?)(?=\n##\s|$)/);
  if (!match) return null;

  const content = match[1].trim();
  // 只取前 500 字
  return content.length > 500 ? content.substring(0, 500) + "..." : content;
}

/**
 * 读取最新的 Claude 自记录
 */
function getLatestSelfRecord(): string | null {
  const selfRecordsDir = path.join(
    METACOGNITION_BASE,
    "self-records",
  );
  if (!fs.existsSync(selfRecordsDir)) return null;

  const files = fs.readdirSync(selfRecordsDir);
  const jsonFiles = files
    .filter((f) => f.endsWith(".json") || f.endsWith(".md"))
    .sort()
    .reverse();

  if (jsonFiles.length === 0) return null;

  try {
    const content = fs.readFileSync(
      path.join(selfRecordsDir, jsonFiles[0]),
      "utf-8",
    );
    const record = JSON.parse(content);

    let text = `### Claude 自记录（${record.date} ${record.sessionId}）\n`;

    if (record.judgments?.length > 0) {
      text += "判断：\n";
      for (const j of record.judgments) {
        text += `- ${j}\n`;
      }
    }

    if (record.questions?.length > 0) {
      text += "问题：\n";
      for (const q of record.questions) {
        text += `- ${q}\n`;
      }
    }

    if (record.rawThoughts) {
      text += `原始想法：${record.rawThoughts}\n`;
    }

    return text;
  } catch {
    return null;
  }
}

/**
 * 强制刷新缓存
 */
export function refreshCache(): void {
  cachedContext = null;
  cachedAt = 0;
  generateMetacognitionContext();
}

/**
 * 生成每日洞察摘要（用于推送到飞书）
 */
export function generateDailyInsightSummary(): string {
  const insights = getRecentInsights(7, 10);
  const date = new Date().toISOString().split("T")[0];

  if (insights.length === 0) {
    return `🧠 元认知日报 ${date}\n\n今天没有新的高价值洞察。`;
  }

  // 按领域分组
  const byDomain = new Map<string, Insight[]>();
  for (const insight of insights) {
    const existing = byDomain.get(insight.domain) || [];
    existing.push(insight);
    byDomain.set(insight.domain, existing);
  }

  let summary = `🧠 元认知日报 ${date}\n\n`;
  summary += `📊 今日采集 ${insights.length} 条高价值洞察，覆盖 ${byDomain.size} 个领域\n\n`;

  // Top 5 洞察
  summary += "📌 Top 5 洞察：\n";
  const top5 = insights.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const insight = top5[i];
    summary += `${i + 1}. [${insight.domain}] ${insight.insight}（${insight.score}分）\n`;
  }

  // 领域分布
  summary += "\n📈 领域分布：\n";
  for (const [domain, items] of byDomain) {
    summary += `- ${domain}：${items.length} 条\n`;
  }

  return summary;
}

/**
 * 生成每日推送的卡片元素（昨天的格式）
 */
export function generateDailyPushElements(): Array<{
  content: string;
  text_size?: string;
}> {
  const insights = getRecentInsights(7, 10);
  const elements: Array<{ content: string; text_size?: string }> = [];

  if (insights.length === 0) {
    elements.push({ content: "今天没有新的高价值洞察。" });
    return elements;
  }

  // 为每条洞察生成内容
  const emojis = ["🚀", "🎮", "📐", "🔧", "💡", "🎯", "🌟", "🔮"];
  insights.forEach((insight, index) => {
    const emoji = emojis[index % emojis.length];
    const title = insight.insight.split(/[。！\n]/)[0];

    elements.push({
      text_size: "heading-3",
      content: `**${index + 1}. ${emoji} ${title}**`,
    });

    elements.push({ content: insight.insight });

    if (index < insights.length - 1) {
      elements.push({ content: "---" });
    }
  });

  // 分割线
  elements.push({ content: "---" });

  // 总结
  elements.push({
    content:
      "总体来看，AI 行业正从**技术研发**、**商业落地**、**资本运作**和**基础设施建设**等多个维度快速发展。你对哪条新闻比较感兴趣？我可以帮你进一步了解。",
  });

  return elements;
}

/**
 * 记录用户反馈到元认知系统
 */
export function recordFeedback(
  userId: string,
  query: string,
  response: string,
  feedback: "positive" | "negative" | "neutral",
  comment?: string,
): void {
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split("T")[0];
  const timestamp = new Date().toISOString();
  const filename = `feedback-${date}.jsonl`;
  const filepath = path.join(FEEDBACK_DIR, filename);

  const entry = {
    timestamp,
    userId,
    query: query.substring(0, 500),
    response: response.substring(0, 500),
    feedback,
    comment,
  };

  fs.appendFileSync(filepath, JSON.stringify(entry) + "\n");
  console.log(`[元认知] 记录用户反馈: ${feedback}`);
}
