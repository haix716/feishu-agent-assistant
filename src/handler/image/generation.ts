import { config } from "../../config";
import { buildPrompt, generateImage } from "../../image-gen";
import type { ImageAnalysis, ImageGenIntent } from "../../image-gen";
import { addTextOverlay } from "../../image-gen/text-overlay";
import { larkService } from "../../lark";
import { getTodayDate } from "../file";
import { getRootFolderToken, getOrCreateFolder } from "../folder";
import { pendingImageEdit, pendingXhsPublish } from "./state";
import { handleDetailSuite } from "./detail-suite";
import { handleXhsPublish } from "./xhs";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";

/**
 * 处理待编辑图片的用户响应
 */
export async function handlePendingImageEditResponse(
  channel: LarkChannel,
  msg: NormalizedMessage,
  query: string,
): Promise<boolean> {
  const userId = msg.senderId;

  // 处理小红书发布确认/取消
  if (pendingXhsPublish.has(userId)) {
    const pending = pendingXhsPublish.get(userId)!;

    if (/^(确认|发布|ok|yes|是|xhs_confirm|复制)/i.test(query)) {
      // 格式化内容供用户复制
      const tagsText = pending.tags.map((t) => `#${t}`).join(" ");
      const fullContent = `${pending.content}\n\n${tagsText}`;

      // 分开发送标题和正文，方便复制
      await channel.send(
        msg.chatId,
        {
          text: `📌 标题：\n${pending.title}`,
        },
        { replyTo: msg.messageId },
      );

      await channel.send(
        msg.chatId,
        {
          text: `📝 正文：\n${fullContent}`,
        },
        { replyTo: msg.messageId },
      );

      await channel.send(
        msg.chatId,
        {
          text: `图片已保存在本地，发布时选择对应图片即可。`,
        },
        { replyTo: msg.messageId },
      );

      pendingXhsPublish.delete(userId);
      return true;
    }

    if (/^(取消|放弃|cancel|no|否|xhs_cancel)/i.test(query)) {
      pendingXhsPublish.delete(userId);
      await channel.send(
        msg.chatId,
        { text: "已取消发布" },
        { replyTo: msg.messageId },
      );
      return true;
    }

    // 如果用户回复了其他内容，提醒他们确认或取消
    await channel.send(
      msg.chatId,
      {
        text: `请回复「确认」发布，或「取消」放弃`,
      },
      { replyTo: msg.messageId },
    );
    return true;
  }

  if (!pendingImageEdit.has(userId)) return false;

  const pending = pendingImageEdit.get(userId)!;

  // 匹配命令和可选的文字内容（如 "3 秋冬必备保温杯" 或 "封面 秋冬必备保温杯"）
  const genMatch = query.match(
    /^(1|2|3|4|5|穿戴|商品|封面|详情|生成|小红书发布|xhs|tryon|product|cover|detail)\s*(.*)/i,
  );
  if (genMatch && pending.analysis) {
    const command = genMatch[1];
    const overlayText = genMatch[2]?.trim() || "";

    // 小红书发布（直接生成内容，不需要确认）
    if (command === "5" || /小红书发布|xhs/i.test(command)) {
      await handleXhsPublish(channel, msg, pending.buffer, pending.analysis);
      pendingImageEdit.delete(userId);
      return true;
    }

    await handleImageGeneration(
      channel,
      msg,
      { buffer: pending.buffer, analysis: pending.analysis },
      command,
      overlayText,
    );
    pendingImageEdit.delete(userId);
    return true;
  }

  if (/^(完成|好了|ok|done|好)/i.test(query)) {
    pendingImageEdit.delete(userId);
    await channel.send(
      msg.chatId,
      { text: "好的 ✅" },
      { replyTo: msg.messageId },
    );
    return true;
  }

  if (/^(删除|撤回|不要|丢弃|discard)/i.test(query)) {
    try {
      if (fs.existsSync(pending.savedPath)) {
        fs.unlinkSync(pending.savedPath);
      }
    } catch {
      /* ignore */
    }
    pendingImageEdit.delete(userId);
    await channel.send(
      msg.chatId,
      { text: "已删除" },
      { replyTo: msg.messageId },
    );
    return true;
  }

  pendingImageEdit.delete(userId);
  return false;
}

/**
 * 处理图片生成请求
 */
async function handleImageGeneration(
  channel: LarkChannel,
  msg: NormalizedMessage,
  pending: { buffer: Buffer; analysis: ImageAnalysis },
  command: string,
  overlayText?: string,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;

  // 详情图套件（特殊处理，不走普通生图流程）
  if (command === "4" || /详情|detail/i.test(command)) {
    await handleDetailSuite(channel, msg, pending.buffer);
    return;
  }

  let mode: "tryon" | "product" | "cover";
  if (command === "1" || /穿戴|试穿|tryon/i.test(command)) {
    mode = "tryon";
  } else if (command === "3" || /封面|cover/i.test(command)) {
    mode = "cover";
  } else if (
    command === "2" ||
    /商品|product/i.test(command) ||
    /生成/i.test(command)
  ) {
    mode = "product";
  } else {
    mode = pending.analysis.suggestedMode;
  }

  const textHint = overlayText ? `，带文字「${overlayText}」` : "";
  console.log(`[${userId}] 开始图片生成，模式: ${mode}${textHint}`);

  await channel.send(
    chatId,
    {
      text: `在出了，等我一下...`,
    },
    { replyTo: msg.messageId },
  );

  try {
    const intent: ImageGenIntent = { mode };
    const prompt = buildPrompt(pending.analysis, mode, intent);
    console.log(`[${userId}] 提示词: ${prompt}`);

    const result = await generateImage(pending.buffer, prompt, intent);
    console.log(
      `[${userId}] 生成完成: ${result.provider}, ${result.images.length} 张`,
    );

    // 如果是封面模式且有文字，应用文字叠加
    let finalImages = result.images;
    if (mode === "cover" && overlayText && result.images.length > 0) {
      try {
        const processed = await Promise.all(
          result.images.map((img) =>
            addTextOverlay(img, { text: overlayText }),
          ),
        );
        finalImages = processed;
        console.log(`[${userId}] 文字叠加完成`);
      } catch (overlayErr) {
        console.warn(`[${userId}] 文字叠加失败，使用原图:`, overlayErr);
      }
    }

    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, "");
    const localDir = path.join(config.imageSaveDir, dateFolder);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const savedFiles: string[] = [];
    for (let i = 0; i < finalImages.length; i++) {
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const fileName = `gen_${timestamp}_${mode}_${i + 1}.jpg`;
      const filePath = path.join(localDir, fileName);
      fs.writeFileSync(filePath, finalImages[i]);
      savedFiles.push(fileName);
    }

    let driveUrl = "";
    try {
      const rootToken = getRootFolderToken();
      if (rootToken) {
        const folderPath = `生成图片/${today}`;
        const folderToken = await getOrCreateFolder(folderPath);
        for (let i = 0; i < finalImages.length; i++) {
          const fileToken = await larkService.uploadFile(
            finalImages[i],
            savedFiles[i],
            folderToken,
          );
          driveUrl = `https://feishu.cn/file/${fileToken}`;
        }
      }
    } catch (uploadErr) {
      console.warn(`[${userId}] 上传云盘失败:`, uploadErr);
    }

    // 发送生成的图片给用户
    for (let i = 0; i < finalImages.length; i++) {
      await channel.send(
        chatId,
        { image: { source: finalImages[i] } },
        { replyTo: msg.messageId },
      );
    }

    const replyLines = [
      `出来了，看看效果 ✅`,
      `已存到 ${dateFolder}/${savedFiles.join(", ")}`,
    ];
    if (driveUrl) {
      replyLines.push(`云盘：${driveUrl}`);
    }

    await channel.send(
      chatId,
      { text: replyLines.join("\n") },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 图片生成失败:`, errMsg);
    await channel.send(
      chatId,
      {
        text: `没生成成功，${errMsg}。要再试一次吗？`,
      },
      { replyTo: msg.messageId },
    );
  }
}
