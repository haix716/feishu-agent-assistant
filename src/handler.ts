import { larkService } from './lark';
import { streamClaude, ChatMessage } from './claude';
import { config } from './config';
import { pThrottle } from './util';

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

/** 节流更新卡片（200ms 间隔） */
const throttledUpdate = pThrottle(
  (messageId: string, content: string) => larkService.updateCard(messageId, content),
  200
);

/**
 * 处理用户消息
 */
export async function handleMessage(
  userId: string,
  chatId: string,
  query: string
): Promise<void> {
  // /clear 命令
  if (query.trim() === '/clear') {
    conversations.delete(userId);
    await larkService.sendText(chatId, '对话已清除 ✅');
    return;
  }

  // 并发检查
  if (running.get(userId)) {
    await larkService.sendText(chatId, '上一条回复还在生成中，请稍候...');
    return;
  }

  // 获取或创建对话历史
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  const history = conversations.get(userId)!;

  // 追加用户消息
  history.push({ role: 'user', content: query });

  // 裁剪历史（保留最近 N 轮）
  while (history.length > config.maxTurns * 2) {
    history.shift();
  }

  running.set(userId, true);

  try {
    // 发送占位卡片
    const messageId = await larkService.sendCard(chatId, '思考中...');

    // 调 Claude，流式更新卡片
    const fullText = await streamClaude(
      history,
      (text) => throttledUpdate(messageId, text)
    );

    // 保存 assistant 回复
    history.push({ role: 'assistant', content: fullText });
  } catch (err) {
    console.error('Claude API error:', err);
    await larkService.sendText(chatId, `出错了: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running.set(userId, false);
  }
}
