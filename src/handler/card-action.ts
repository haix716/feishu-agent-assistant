import type { LarkChannel } from "@larksuiteoapi/node-sdk";

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
  evt: CardActionEvent,
): Promise<void> {
  const { operator, action, chatId, messageId } = evt;
  const userId = operator.openId;

  try {
    // 按钮值可能是 { action: 'xxx' } 对象，也可能是字符串
    let actionValue: string;
    let actionText: string = "";
    if (
      typeof action.value === "object" &&
      action.value !== null &&
      "action" in action.value
    ) {
      actionValue = (action.value as { action: string }).action;
      actionText =
        (action.value as { action: string; text?: string }).text || "";
    } else {
      actionValue = action.value as string;
    }

    console.log(`[cardAction] ${userId} 点击按钮: ${actionValue}`);

    // 复制标题
    if (actionValue === "copy_title") {
      await channel.send(
        chatId,
        { text: `📌 标题已复制：\n${actionText}` },
        { replyTo: messageId },
      );
      return;
    }

    // 复制正文
    if (actionValue === "copy_content") {
      await channel.send(
        chatId,
        { text: `📝 正文已复制：\n${actionText}` },
        { replyTo: messageId },
      );
      return;
    }

    // 重新生成
    if (actionValue === "regenerate") {
      await channel.send(
        chatId,
        { text: "🔄 正在重新生成内容..." },
        { replyTo: messageId },
      );
      // TODO: 触发重新生成逻辑
      return;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[cardAction] 处理失败: ${errMsg}`);
    await channel.send(
      chatId,
      { text: `❌ 操作失败：${errMsg}` },
      { replyTo: messageId },
    );
  }
}
