import type { LarkChannel } from '@larksuiteoapi/node-sdk';

interface CardActionEvent {
  messageId: string;
  chatId: string;
  operator: {
    openId: string;
    userId?: string;
    name?: string;
  };
  action: {
    value: unknown;
    tag: string;
    name?: string;
    option?: string;
  };
  raw?: unknown;
}

/**
 * 处理卡片按钮点击事件
 */
export async function handleCardAction(
  channel: LarkChannel,
  evt: CardActionEvent
): Promise<void> {
  const { operator, action, chatId, messageId } = evt;
  const userId = operator.openId;

  // 按钮值可能是 { action: 'xxx' } 对象，也可能是字符串
  let actionValue: string;
  let actionText: string = '';
  if (typeof action.value === 'object' && action.value !== null && 'action' in action.value) {
    actionValue = (action.value as { action: string }).action;
    actionText = (action.value as { action: string; text?: string }).text || '';
  } else {
    actionValue = action.value as string;
  }

  console.log(`[cardAction] ${userId} 点击按钮: ${actionValue}`);

  // 复制标题
  if (actionValue === 'copy_title') {
    await channel.send(chatId, { text: `📌 标题已复制：\n${actionText}` }, { replyTo: messageId });
    return;
  }

  // 复制正文
  if (actionValue === 'copy_content') {
    await channel.send(chatId, { text: `📝 正文已复制：\n${actionText}` }, { replyTo: messageId });
    return;
  }

  // 重新生成
  if (actionValue === 'regenerate') {
    await channel.send(chatId, { text: '🔄 正在重新生成内容...' }, { replyTo: messageId });
    // TODO: 触发重新生成逻辑
    return;
  }

  // 小红书发布确认（保留兼容）
  if (actionValue === 'xhs_confirm') {
    const { handleXhsConfirm } = await import('./image');
    await handleXhsConfirm(channel, chatId, userId, messageId);
    return;
  }

  // 小红书发布取消（保留兼容）
  if (actionValue === 'xhs_cancel') {
    await channel.send(chatId, { text: '已取消发布。' }, { replyTo: messageId });
    return;
  }
}
