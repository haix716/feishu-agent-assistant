import type { LarkChannel } from "@larksuiteoapi/node-sdk";
import { getInsightDetail } from "../metacognition";

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

    // 查看日报详情
    if (actionValue === "view_daily_detail") {
      const fullValue = action.value as {
        action: string;
        sourceId?: string;
        index?: string;
      };
      const sourceId = fullValue.sourceId;
      const index = fullValue.index;
      if (!sourceId) {
        await channel.send(
          chatId,
          { text: "❌ 无 sourceId，无法查看详情" },
          { replyTo: messageId },
        );
        return;
      }
      console.log(`[cardAction] 查看详情 sourceId=${sourceId}`);
      const detail = await getInsightDetail(sourceId);
      if (!detail) {
        await channel.send(
          chatId,
          { text: `❌ 未找到 sourceId=${sourceId} 的详情` },
          { replyTo: messageId },
        );
        return;
      }
      const raw = detail.rawItem;
      const lines = [
        `**第 ${index} 条详情**`,
        "",
        `**领域：** ${detail.insight.domain}`,
        `**评分：** ${detail.insight.score} 分`,
        `**采集于：** ${(detail.insight.extractedAt ?? "").split("T")[0]}`,
        "",
        `**洞察：**`,
        detail.insight.insight,
      ];
      if (detail.insight.relevance) {
        lines.push("", `**相关性：**`, detail.insight.relevance);
      }
      if (raw) {
        lines.push("", "---", `**原始内容：**`);
        if (raw.title) lines.push(`标题：${raw.title}`);
        if (raw.url) lines.push(`链接：${raw.url}`);
        if (raw.description)
          lines.push(`摘要：${raw.description.slice(0, 500)}`);
      }
      await channel.send(chatId, { text: lines.join("\n") }, { replyTo: messageId });
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
