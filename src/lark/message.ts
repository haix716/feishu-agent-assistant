import { larkClient } from "./client";

/** 主动发送消息给用户（用于每日推送等场景） */
export async function sendMessage(userId: string, text: string): Promise<boolean> {
  try {
    const resp = await larkClient.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: userId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    if (resp.code === 0) {
      console.log(`[sendMessage] 消息发送成功: userId=${userId}`);
      return true;
    }
    console.error(`[sendMessage] 发送失败: ${resp.msg}`);
    return false;
  } catch (err) {
    console.error("[sendMessage] 发送失败:", err);
    return false;
  }
}

/** 发送带按钮的交互消息 */
export async function sendInteractiveMessage(
  chatId: string,
  title: string,
  content: string,
  buttons: Array<{
    text: string;
    value: string;
    type?: "primary" | "danger";
  }>,
  _replyTo?: string,
): Promise<boolean> {
  try {
    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: title },
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content },
        },
        {
          tag: "action",
          actions: buttons.map((btn) => ({
            tag: "button",
            text: { tag: "plain_text", content: btn.text },
            type: btn.type || "primary",
            value: { action: btn.value },
          })),
        },
      ],
    };

    const resp = await larkClient.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });

    if (resp.code === 0) {
      console.log(`[sendInteractiveMessage] 消息发送成功: chatId=${chatId}`);
      return true;
    }
    console.error(`[sendInteractiveMessage] 发送失败: ${resp.msg}`);
    return false;
  } catch (err) {
    console.error("[sendInteractiveMessage] 发送失败:", err);
    return false;
  }
}

/** 发送卡片消息（支持 markdown 格式：粗体、分割线等） */
export async function sendCardMessage(
  userId: string,
  title: string,
  content: string | Array<{ content: string; text_size?: string }>,
  template: string = "purple",
): Promise<boolean> {
  try {
    // 支持多个 markdown 元素，每个元素可以有自己的字号
    let elements: any[];
    if (Array.isArray(content)) {
      elements = content.map((item) => ({
        tag: "markdown",
        content: item.content,
        ...(item.text_size ? { text_size: item.text_size } : {}),
      }));
    } else {
      elements = [{ tag: "markdown", content }];
    }

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: title },
        template: template,
      },
      elements,
    };

    const resp = await larkClient.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: userId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
    if (resp.code === 0) {
      console.log(`[sendCardMessage] 消息发送成功: userId=${userId}`);
      return true;
    }
    console.error(`[sendCardMessage] 发送失败: ${resp.msg}`);
    return false;
  } catch (err) {
    console.error("[sendCardMessage] 发送失败:", err);
    return false;
  }
}
