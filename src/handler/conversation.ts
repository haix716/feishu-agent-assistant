import { streamAIWithTools, ChatMessage, ChatContext } from "../ai";
import { config } from "../config";
import {
  extractFeishuDocLinks,
  formatFileList,
  parseFileCommand,
  stripAtMention,
} from "../util";
import { ToolManager, GetTimeTool, SearchDocTool } from "../tools";
import { searchImages } from "../rag";
import { larkService } from "../lark";
import { recordFeedback } from "../metacognition";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";

// 初始化工具管理器
const toolManager = new ToolManager();
toolManager.register(new GetTimeTool());
toolManager.register(new SearchDocTool());

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

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

    // 并发检查
    if (running.get(userId)) {
      await channel.send(
        chatId,
        { text: "上一条回复还在生成中，请稍候..." },
        { replyTo: messageId },
      );
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

    // 追加用户消息
    history.push({ role: "user", content: query });

    // 裁剪历史
    while (history.length > config.maxTurns * 2) {
      history.shift();
    }

    running.set(userId, true);

    // 流式输出
    console.log(`[${userId}] 调用 AI API...`);
    let fullText = "";
    await channel.stream(
      chatId,
      {
        markdown: async (s) => {
          let lastText = "";
          fullText = await streamAIWithTools(
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
        },
      },
      { replyTo: messageId },
    );
    console.log(`[${userId}] AI 回复完成，长度: ${fullText.length}`);

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
