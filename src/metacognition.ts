/**
 * 元认知系统集成模块
 *
 * 连接飞书助手（执行层）和元认知系统（学习层）
 * - 读取元认知系统的洞察，供 AI 回复时参考
 * - 记录用户反馈，回流到元认知系统
 */

import fs from 'fs';
import path from 'path';

/** 元认知知识库路径 */
const METACOGNITION_BASE = path.join(
  __dirname,
  '..',
  '..',
  'claude-metacognition',
  'knowledge-base',
);

/** 用户反馈路径 */
const FEEDBACK_DIR = path.join(METACOGNITION_BASE, 'feedback');

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

/**
 * 读取最近的高价值洞察
 */
export function getRecentInsights(
  minScore: number = 7,
  limit: number = 10,
): Insight[] {
  const insightsDir = path.join(METACOGNITION_BASE, 'insights');
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
      if (!file.endsWith('.json')) continue;
      try {
        const filepath = path.join(domainDir, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const insight = JSON.parse(content) as Insight;
        if (insight.score >= minScore) {
          insights.push(insight);
        }
      } catch {
        // skip invalid files
      }
    }
  }

  return insights
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 读取最新的反思报告
 */
export function getLatestReflection(): string | null {
  const reflectionsDir = path.join(METACOGNITION_BASE, 'reflections');
  if (!fs.existsSync(reflectionsDir)) {
    return null;
  }

  const files = fs.readdirSync(reflectionsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return fs.readFileSync(path.join(reflectionsDir, files[0]), 'utf-8');
}

/**
 * 生成元认知上下文（用于 AI 回复时参考）
 */
export function generateMetacognitionContext(): string {
  const insights = getRecentInsights(8, 5);

  if (insights.length === 0) {
    return '';
  }

  let context = '\n\n## 元认知系统最近学到的知识\n';
  context += '\n### 高价值洞察\n';
  for (const insight of insights) {
    context += `- [${insight.domain}] ${insight.insight}\n`;
  }

  return context;
}

/**
 * 记录用户反馈到元认知系统
 *
 * 当用户对 AI 回复给出反馈时，记录到元认知系统
 * 用于后续反思和改进
 */
export function recordFeedback(
  userId: string,
  query: string,
  response: string,
  feedback: 'positive' | 'negative' | 'neutral',
  comment?: string,
): void {
  // 确保反馈目录存在
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
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

  fs.appendFileSync(filepath, JSON.stringify(entry) + '\n');
  console.log(`[元认知] 记录用户反馈: ${feedback}`);
}
