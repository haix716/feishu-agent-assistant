import { larkService } from './lark';
import { streamClaude, ChatMessage, ChatContext } from './claude';
import { config } from './config';
import { pThrottle } from './util';

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

/** 节流更新卡片（1000ms 间隔，避免飞书频率限制） */
const throttledUpdate = pThrottle(
  async (messageId: string, content: string) => {
    try {
      await larkService.updateCard(messageId, content);
    } catch (err: any) {
      // 飞书频率限制错误静默忽略，下次节流调用会重试
      if (err?.data?.code === 230020) {
        console.warn('[throttledUpdate] 飞书频率限制，跳过本次更新');
        return;
      }
      throw err;
    }
  },
  1000
);

/**
 * 清理群聊中的 @mention 占位符
 */
function stripAtMention(text: string): string {
  return text.replace(/@_user_\d+\s*/g, '').trim();
}

/**
 * 获取上下文信息（用户名、群名）
 */
async function fetchContext(
  userId: string,
  chatId: string,
  chatType: string
): Promise<ChatContext> {
  const ctx: ChatContext = { chatType };

  // 获取群信息
  if (chatType === 'group') {
    const chatInfo = await larkService.getChatInfo(chatId);
    if (chatInfo) ctx.chatName = chatInfo.name;
  }

  // 获取用户名
  if (chatType === 'group') {
    const memberName = await larkService.getChatMemberName(chatId, userId);
    if (memberName) ctx.userName = memberName;
  }
  if (!ctx.userName) {
    const userInfo = await larkService.getUserInfo(userId);
    if (userInfo) ctx.userName = userInfo.name;
  }

  return ctx;
}

/**
 * 处理文件消息：下载文件内容作为上下文
 */
async function handleFileMessage(
  messageId: string,
  fileName: string
): Promise<string | null> {
  try {
    const msg = await larkService.getMessage(messageId);
    if (!msg?.items?.[0]?.content) return null;

    const content = JSON.parse(msg.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) return null;

    const buffer = await larkService.getFileResource(messageId, fileKey);
    if (!buffer) return null;

    // 文本文件直接读取内容
    if (/\.(txt|md|json|csv|xml|yaml|yml|log|py|js|ts|html|css|sh|sql)$/i.test(fileName)) {
      const text = buffer.toString('utf-8').slice(0, 10000); // 限制 10k 字符
      return `📎 文件 "${fileName}" 内容：\n\`\`\`\n${text}\n\`\`\``;
    }

    // 其他文件只返回元信息
    return `📎 用户发送了文件 "${fileName}"（${(buffer.length / 1024).toFixed(1)}KB），此文件类型暂不支持读取内容。`;
  } catch (err) {
    console.error('handleFileMessage failed:', err);
    return null;
  }
}

/**
 * 处理用户消息
 */
export async function handleMessage(
  userId: string,
  chatId: string,
  query: string,
  chatType: string = 'p2p',
  messageId: string = ''
): Promise<void> {
  // 群聊：清理 @mention
  if (chatType === 'group') {
    query = stripAtMention(query);
  }

  if (!query) return;

  // /clear 命令
  if (query.trim() === '/clear') {
    conversations.delete(userId);
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, '对话已清除 ✅');
    } else {
      await larkService.sendText(chatId, '对话已清除 ✅');
    }
    return;
  }

  // 并发检查
  if (running.get(userId)) {
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, '上一条回复还在生成中，请稍候...');
    } else {
      await larkService.sendText(chatId, '上一条回复还在生成中，请稍候...');
    }
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
  history.push({ role: 'user', content: query });

  // 裁剪历史
  while (history.length > config.maxTurns * 2) {
    history.shift();
  }

  running.set(userId, true);

  try {
    // 发送占位卡片
    let replyMessageId: string;
    if (chatType === 'group' && messageId) {
      console.log(`[${userId}] 发送回复卡片...`);
      replyMessageId = await larkService.replyCard(messageId, '思考中...');
    } else {
      console.log(`[${userId}] 发送卡片...`);
      replyMessageId = await larkService.sendCard(chatId, '思考中...');
    }
    console.log(`[${userId}] 卡片已发送: ${replyMessageId}`);

    // 调 Claude，流式更新卡片
    console.log(`[${userId}] 调用 Claude API...`);
    const fullText = await streamClaude(
      history,
      (text) => throttledUpdate(replyMessageId, text),
      ctx
    );
    console.log(`[${userId}] Claude 回复完成，长度: ${fullText.length}`);

    // 保存 assistant 回复
    history.push({ role: 'assistant', content: fullText });
  } catch (err) {
    console.error(`[${userId}] 错误:`, err);
    const errMsg = `出错了: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (chatType === 'group' && messageId) {
        await larkService.replyText(messageId, errMsg);
      } else {
        await larkService.sendText(chatId, errMsg);
      }
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  } finally {
    running.set(userId, false);
  }
}

/**
 * 处理文件消息（从 app.ts 调用）
 */
export async function handleFileEvent(
  userId: string,
  chatId: string,
  chatType: string,
  messageId: string,
  fileName: string
): Promise<void> {
  console.log(`[${userId}] 收到文件: ${fileName}`);

  const fileContext = await handleFileMessage(messageId, fileName);
  const query = fileContext || `用户发送了文件 "${fileName}"，但无法读取内容。`;

  // 把文件信息当作用户消息传给 Claude
  await handleMessage(userId, chatId, query, chatType, messageId);
}
