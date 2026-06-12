import { larkClient } from "./client";

/** 获取用户信息（昵称、头像） */
export async function getUserInfo(
  userId: string,
): Promise<{ name: string; avatar: string } | null> {
  try {
    const resp = await larkClient.contact.user.get({
      path: { user_id: userId },
      params: { user_id_type: "open_id" },
    });
    if (resp.code === 0 && resp.data?.user) {
      return {
        name: resp.data.user.name || "未知用户",
        avatar: resp.data.user.avatar?.avatar_72 || "",
      };
    }
  } catch (err) {
    console.error("getUserInfo failed:", err);
  }
  return null;
}

/** 获取群信息（群名） */
export async function getChatInfo(chatId: string): Promise<{ name: string } | null> {
  try {
    const resp = await larkClient.im.chat.get({
      path: { chat_id: chatId },
    });
    if (resp.code === 0 && resp.data) {
      return { name: resp.data.name || "未命名群" };
    }
  } catch (err) {
    console.error("getChatInfo failed:", err);
  }
  return null;
}

/** 从群成员列表获取用户在群里的名字（nickname） */
export async function getChatMemberName(
  chatId: string,
  userId: string,
): Promise<string | null> {
  try {
    const resp = await larkClient.im.chatMembers.get({
      path: { chat_id: chatId },
      params: { member_id_type: "open_id" as const },
    });
    if (resp.code === 0 && resp.data?.items) {
      const member = resp.data.items.find((m: any) => m.member_id === userId);
      if (member?.name) return member.name;
    }
  } catch (err) {
    console.error("getChatMemberName failed:", err);
  }
  return null;
}
