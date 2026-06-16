import { streamAIWithTools, ChatMessage, ChatContext } from "../ai";
import { config } from "../config";
import {
  extractFeishuDocLinks,
  formatFileList,
  parseFileCommand,
  stripAtMention,
} from "../util";
import { ToolManager, GetTimeTool, SearchDocTool, SearchInsightsTool } from "../tools";
import { searchImages } from "../rag";
import { larkService } from "../lark";
import {
  recordFeedback,
  getPushedManifest,
  getInsightDetail,
  retrieveAndAugment,
} from "../metacognition";
import type { InsightHit } from "../mcp-client";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";

// 初始化工具管理器
const toolManager = new ToolManager();
toolManager.register(new GetTimeTool());
toolManager.register(new SearchDocTool());
toolManager.register(new SearchInsightsTool());

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

/** 每用户最近一次检索命中（用于"全部"追问） */
const lastHits = new Map<string, InsightHit[]>();

/** 获取上下文信息（用户名、群名） */
async function fetchContext(
  userId: string,
  chatId: string,
  chatType: string,
): Promise<ChatContext> {
  const ctx: ChatContext = { chatType };

  if (chatType === "group") {
    const chatInfo = await larkService.getChatInfo(chatId);
    if (chatInfo) ctx.chatName = chatInfo.name;
  }

  if (chatType === "group") {
    const memberName = await larkService.getChatMemberName(chatId, userId);
    if (memberName) ctx.userName = memberName;
  }
  if (!ctx.userName) {
    const userInfo = await larkService.getUserInfo(userId);
    if (userInfo) ctx.userName = userInfo.name;
  }

  return ctx;
}

/** 从飞书文档链接获取内容 */
async function fetchDocLinkContent(
  type: string,
  token: string,
): Promise<string | null> {
  try {
    if (type === "docx" || type === "doc") {
      const content = await larkService.getDocContent(token);
      if (content) {
        return `📄 飞书文档内容（${type}）：\n${content.slice(0, 10000)}`;
      }
    } else if (type === "wiki") {
      const node = await larkService.getWikiNode(token);
      if (node && node.obj_type === "docx") {
        const content = await larkService.getDocContent(node.obj_token);
        if (content) {
          return `📄 飞书知识库文档内容：\n${content.slice(0, 10000)}`;
        }
      }
    }
  } catch (err) {
    console.error("fetchDocLinkContent failed:", err);
  }
  return null;
}

/**
 * 处理文本消息（对话主逻辑）
 */
export async function handleTextMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
): Promise<void> {
  console.log(`[debug-htop] ENTER handleTextMessage content=|${JSON.stringify(msg.content)}| type=${typeof msg.content}`);
  const userId = msg.senderId;
  const chatId = msg.chatId;
  const chatType = msg.chatType;
  const messageId = msg.messageId;

  let query = msg.content;
  if (typeof query !== "string") return;

  // 群聊：清理 @mention
  if (chatType === "group") {
    query = stripAtMention(query);
  }

  if (!query) return;

  try {
    // 检测飞书文档链接，读取内容拼入消息
    const docLinks = extractFeishuDocLinks(query);
    if (docLinks.length > 0) {
      const docParts: string[] = [];
      for (const link of docLinks) {
        const content = await fetchDocLinkContent(link.type, link.token);
        if (content) docParts.push(content);
      }
      if (docParts.length > 0) {
        query = `${query}\n\n${docParts.join("\n\n")}`;
      }
    }

    // /clear 命令
    if (query.trim() === "/clear") {
      conversations.delete(userId);
      await channel.send(
        chatId,
        { text: "对话已清除 ✅" },
        { replyTo: messageId },
      );
      return;
    }

    // 群文件指令
    if (query.trim() === "群文件") {
      const files = await larkService.listFiles(chatId);
      const text = formatFileList(files);
      await channel.send(chatId, { text }, { replyTo: messageId });
      return;
    }

    // 读文件指令
    const readFileName = parseFileCommand(query);
    if (readFileName) {
      const { handleReadFile } = await import("./file");
      await handleReadFile(channel, msg, readFileName);
      return;
    }

    // 搜索图片指令
    const searchMatch = query.match(/^(?:搜|搜索|search)\s*(.+)$/i);
    if (searchMatch) {
      const searchQuery = searchMatch[1].trim();
      if (searchQuery) {
        console.log(`[${userId}] 搜索图片: ${searchQuery}`);
        const results = searchImages(searchQuery);
        let text: string;
        if (results.length === 0) {
          text = `🔍 搜索结果："${searchQuery}"\n没有找到相关图片`;
        } else {
          const lines = results.map(
            (r, i) =>
              `${i + 1}. ${r.fileName.replace(/\.[^.]+$/, "").replace(/^\d{14}_/, "")}\n      📁 ${r.relativePath}`,
          );
          text = `🔍 搜索结果："${searchQuery}"\n找到 ${results.length} 张相关图片：\n\n${lines.join("\n\n")}`;
        }
        await channel.send(chatId, { text }, { replyTo: messageId });
        return;
      }
    }

    // 数字追问：用户回复纯数字 N，展开今日灵犀日报的第 N 条
    console.log(`[debug-daily] query=|${query}| trim=|${query.trim()}|`);
    const numMatch = query.trim().match(/^(\d{1,2})$/);
    console.log(`[debug-daily] numMatch=${numMatch ? numMatch[1] : 'null'}`);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      const manifest = await getPushedManifest();
      console.log(`[debug-daily] manifest.count=${manifest ? manifest.count : 'null'} n=${n}`);
      if (manifest && n >= 1 && n <= manifest.count) {
        const item = manifest.items[n - 1];
        query =
          `（用户在今日灵犀日报下回复了 "${numMatch[1]}"，想深入了解第 ${n} 条洞察。` +
          `请基于这条展开：它是什么、为什么重要、以及对晓燕的工作（AI 开发 / 灵犀系统 / 小红书店铺）有什么启发。）\n\n` +
          `第 ${n} 条 [${item.domain}]（${item.score} 分）：${item.insight}`;
        console.log(`[${userId}] 数字追问展开: 第 ${n} 条 [${item.domain}]`);
      }
    }

    // 并发检查
    if (running.get(userId)) {
      await channel.send(
        chatId,
        { text: "上一条回复还在生成中，请稍候..." },
        { replyTo: messageId },
      );
      return;
    }

    // "全部"追问：发送完整检索结果 + 原始内容
    if (query === "全部" && lastHits.has(userId)) {
      const hits = lastHits.get(userId)!;
      const detailLines: string[] = [];
      for (const h of hits) {
        const detail = h.sourceId
          ? await getInsightDetail(h.sourceId)
          : null;
        const raw = detail?.rawItem;
        detailLines.push(
          `【${h.domain}】${h.insight}\n` +
            `评分 ${h.score} | 采集于 ${(h.extractedAt ?? "").split("T")[0]}` +
            (raw?.title ? `\n原始标题：${raw.title}` : "") +
            (raw?.url ? `\n链接：${raw.url}` : "") +
            (raw?.description
              ? `\n原始内容：${raw.description.slice(0, 300)}`
              : ""),
        );
      }
      const detailText =
        `[灵犀] 全部 ${hits.length} 条检索详情：\n\n` +
        detailLines.join("\n\n---\n\n");
      await channel.send(chatId, { text: detailText }, { replyTo: messageId });
      running.set(userId, false);
      return;
    }

    // 获取上下文信息
    console.log(`[${userId}] 获取上下文...`);
    const ctx = await fetchContext(userId, chatId, chatType);
    console.log(`[${userId}] 上下文:`, ctx);

    // 获取或创建对话历史
    if (!conversations.has(userId)) {
      conversations.set(userId, []);
    }
    const history = conversations.get(userId)!;

    // 追加用户消息（灵犀知识库检索注入在 ai.ts streamAIWithTools 里做，这里不重复）
    history.push({ role: "user", content: query });

    // 裁剪历史
    while (history.length > config.maxTurns * 2) {
      history.shift();
    }

    running.set(userId, true);

    // 流式输出
    console.log(`[${userId}] 调用 AI API...`);
    let fullText = "";
    let hits: InsightHit[] = [];
    await channel.stream(
      chatId,
      {
        markdown: async (s) => {
          let lastText = "";
          const result = await streamAIWithTools(
            history,
            (text) => {
              if (text !== lastText) {
                s.setContent(text);
                lastText = text;
              }
            },
            ctx,
            toolManager,
          );
          fullText = result.text;
          hits = result.hits;
        },
      },
      { replyTo: messageId },
    );
    console.log(`[${userId}] AI 回复完成，长度: ${fullText.length}`);

    // 存储最近检索命中（供"全部"追问）
    if (hits.length > 0) {
      lastHits.set(userId, hits);
    }

    history.push({ role: "assistant", content: fullText });

    // 记录用户反馈到元认知系统
    try {
      // 判断反馈类型：用户追问（短消息+对话历史>2轮）= 正面
      const isFollowUp =
        history.length > 4 && query.length < 100;
      recordFeedback(
        userId,
        query,
        fullText,
        isFollowUp ? "positive" : "neutral",
      );
    } catch {
      // 反馈记录失败不影响主流程
    }
  } catch (err) {
    console.error(`[${userId}] 错误:`, err);
    const errMsg = `出错了: ${err instanceof Error ? err.message : String(err)}`;
    try {
      await channel.send(chatId, { text: errMsg }, { replyTo: messageId });
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  } finally {
    running.set(userId, false);
  }
}
