import { config } from "../../config";
import { sanitizeFileName } from "../../util";
import { analyzeImageForGeneration } from "../../image-gen";
import type { ImageAnalysis } from "../../image-gen";
import { larkService } from "../../lark";
import { getTodayDate } from "../file";
import { getOrCreateFolder } from "../folder";
import { pendingImages, pendingImageEdit } from "./state";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";

/**
 * 处理待保存图片的用户响应
 */
export async function handlePendingImageResponse(
  channel: LarkChannel,
  msg: NormalizedMessage,
  query: string,
): Promise<boolean> {
  const userId = msg.senderId;
  if (!pendingImages.has(userId)) return false;

  const pending = pendingImages.get(userId)!;
  const { parseImageIntent } = await import("./state");
  const intent = parseImageIntent(query);

  try {
    if (intent.action === "save") {
      const folder = sanitizeFileName(intent.folder || "未整理");
      const fileName = sanitizeFileName(
        (intent.fileName || `image_${Date.now()}`) + ".jpg",
      );
      const today = getTodayDate();
      const folderToken = await getOrCreateFolder(`${folder}/${today}`);
      const fileToken = await larkService.uploadFile(
        pending.buffer,
        fileName,
        folderToken,
      );
      const url = `https://feishu.cn/file/${fileToken}`;

      const replyMsg = `🖼️ 图片已保存\n文件夹：${folder}/${today}\n文件：${fileName}\n${url}`;
      pendingImages.delete(userId);
      await channel.send(
        msg.chatId,
        { text: replyMsg },
        { replyTo: msg.messageId },
      );
    } else if (intent.action === "discard") {
      pendingImages.delete(userId);
      await channel.send(
        msg.chatId,
        { text: "已丢弃图片。" },
        { replyTo: msg.messageId },
      );
    } else {
      pendingImages.delete(userId);
      return false; // 让 router 重新处理为普通消息
    }
  } catch (err) {
    pendingImages.delete(userId);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handlePendingImageResponse 失败:`, errMsg);
    await channel.send(
      msg.chatId,
      {
        text: `图片保存失败：${errMsg}`,
      },
      { replyTo: msg.messageId },
    );
  }

  return true;
}

/**
 * 处理图片消息：下载图片，分析内容，保存到本地
 */
export async function handleImageMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageKey: string,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 开始处理图片: ${imageKey}`);

  try {
    // 1. 下载图片
    console.log(`[${userId}] 下载图片中...`);
    let buffer: Buffer | null;
    try {
      buffer = await larkService.getResource(msg.messageId, imageKey, "image");
    } catch (downloadErr) {
      const errMsg =
        downloadErr instanceof Error
          ? downloadErr.message
          : String(downloadErr);
      console.error(`[${userId}] 图片下载异常:`, errMsg);
      await channel.send(
        chatId,
        {
          text: `❌ 图片下载失败\n原因：${errMsg}\n请检查网络连接或重新发送。`,
        },
        { replyTo: msg.messageId },
      );
      return;
    }
    if (!buffer) {
      await channel.send(
        chatId,
        {
          text: "❌ 图片下载失败\n原因：返回数据为空\n请重新发送图片。",
        },
        { replyTo: msg.messageId },
      );
      return;
    }
    console.log(`[${userId}] 图片下载完成，大小: ${buffer.length} bytes`);

    // 2. 一次调用完成图片分析（描述 + 生成参数）
    let genAnalysis: ImageAnalysis | null = null;
    let analyzeError = "";
    try {
      const base64Image = buffer.toString("base64");
      genAnalysis = await analyzeImageForGeneration(base64Image);
      console.log(
        `[${userId}] 图片分析完成: ${genAnalysis.description}, 类型: ${genAnalysis.contentType}, 建议: ${genAnalysis.suggestedMode}`,
      );
    } catch (analyzeErr) {
      analyzeError =
        analyzeErr instanceof Error ? analyzeErr.message : String(analyzeErr);
      console.warn(`[${userId}] 图片分析失败:`, analyzeError);
    }

    // 3. 保存到本地文件夹
    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, "");
    const localDir = path.join(config.imageSaveDir, dateFolder);

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // 4. 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const contentSummary = sanitizeFileName(genAnalysis?.fileName || "图片");
    const fileName = `${timestamp}_${contentSummary}.jpg`;
    const filePath = path.join(localDir, fileName);

    // 5. 保存到本地
    try {
      fs.writeFileSync(filePath, buffer);
      console.log(`[${userId}] 图片已保存到本地: ${filePath}`);
    } catch (saveErr) {
      const errMsg =
        saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error(`[${userId}] 保存图片失败:`, errMsg);
      await channel.send(
        chatId,
        {
          text: `❌ 图片保存失败\n文件：${fileName}\n原因：${errMsg}`,
        },
        { replyTo: msg.messageId },
      );
      return;
    }

    // 6. 存储待处理图片
    pendingImageEdit.set(userId, {
      buffer,
      analysis: genAnalysis,
      savedPath: filePath,
      fileName,
      dateFolder,
    });

    // 7. 回复用户
    const desc = genAnalysis?.description || "图片";
    const replyLines = [
      `看了下，这是一张${desc}。已经帮你存好了 ✅`,
      `${dateFolder}/${fileName}`,
    ];
    if (analyzeError) {
      replyLines.push(`识别没完全成功：${analyzeError}`);
    }
    if (genAnalysis) {
      replyLines.push(`\n要处理的话回复：`);
      replyLines.push(`1 穿戴效果图`);
      replyLines.push(`2 商品图`);
      replyLines.push(`3 小红书封面（可加文字，如 3 银莲蓬手链超好看）`);
      replyLines.push(`4 详情图套件（8张）`);
      replyLines.push(`5 小红书发布`);
    }
    await channel.send(
      chatId,
      { text: replyLines.join("\n") },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handleImageMessage 未知错误:`, errMsg);
    try {
      await channel.send(
        chatId,
        {
          text: `图片处理出错了，${errMsg}。重新发一张试试？`,
        },
        { replyTo: msg.messageId },
      );
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
}
