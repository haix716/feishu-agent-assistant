import { config } from "../config";
import {
  sanitizeFileName,
  getFileExtension,
  getImportTargetType,
  getTodayDate,
} from "../util";
import { larkService } from "../lark";
import { getRootFolderToken } from "./folder";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";

// Re-export for backward compatibility
export { getTodayDate } from "../util";

/**
 * 处理「读文件 xxx」指令：查找文件、下载、读取内容
 */
export async function handleReadFile(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string,
): Promise<void> {
  const reply = async (text: string) => {
    await channel.send(msg.chatId, { text }, { replyTo: msg.messageId });
  };

  try {
    const files = await larkService.listFiles(msg.chatId);
    const target = files.find((f) => f.name === fileName);
    if (!target) {
      await reply(`未找到文件「${fileName}」，请先发送「群文件」查看列表。`);
      return;
    }

    const buffer = await larkService.downloadFile(target.token);
    if (!buffer) {
      await reply(`下载文件「${fileName}」失败，请稍后重试。`);
      return;
    }

    if (
      /\.(txt|md|json|csv|xml|yaml|yml|log|py|js|ts|html|css|sh|sql)$/i.test(
        fileName,
      )
    ) {
      const text = buffer.toString("utf-8").slice(0, 10000);
      await reply(`📎 文件「${fileName}」内容：\n\`\`\`\n${text}\n\`\`\``);
    } else {
      await reply(
        `📎 文件「${fileName}」（${(buffer.length / 1024).toFixed(1)}KB），此文件类型暂不支持读取内容。`,
      );
    }
  } catch (err) {
    console.error(`[${msg.senderId}] handleReadFile failed:`, err);
    await reply(`读取文件「${fileName}」时出错，请稍后重试。`);
  }
}

/**
 * 处理音视频消息：下载文件 → 保存到本地
 */
export async function handleMediaMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string,
  fileKey: string,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 收到音视频: ${fileName}`);

  try {
    console.log(`[${userId}] 下载音视频中...`);
    let buffer: Buffer | null;
    try {
      buffer = await larkService.getResource(msg.messageId, fileKey, "file");
    } catch (downloadErr) {
      const errMsg =
        downloadErr instanceof Error
          ? downloadErr.message
          : String(downloadErr);
      console.error(`[${userId}] 音视频下载异常:`, errMsg);
      await channel.send(
        chatId,
        {
          text: `❌ 音视频下载失败\n原因：${errMsg}\n请重新发送。`,
        },
        { replyTo: msg.messageId },
      );
      return;
    }
    if (!buffer) {
      await channel.send(
        chatId,
        {
          text: "❌ 音视频下载失败\n原因：返回数据为空\n请重新发送。",
        },
        { replyTo: msg.messageId },
      );
      return;
    }
    console.log(`[${userId}] 音视频下载完成，大小: ${buffer.length} bytes`);

    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, "");
    const localDir = path.join(config.imageSaveDir, dateFolder);

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const safeName = sanitizeFileName(fileName);
    const filePath = path.join(localDir, safeName);

    try {
      fs.writeFileSync(filePath, buffer);
      console.log(`[${userId}] 音视频已保存到本地: ${filePath}`);
    } catch (saveErr) {
      const errMsg =
        saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error(`[${userId}] 保存音视频失败:`, errMsg);
      await channel.send(
        chatId,
        {
          text: `❌ 音视频保存失败\n文件：${safeName}\n原因：${errMsg}`,
        },
        { replyTo: msg.messageId },
      );
      return;
    }

    await channel.send(
      chatId,
      {
        text: `✅ 音视频已保存\n📁 位置：${dateFolder}/${safeName}`,
      },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handleMediaMessage 未知错误:`, errMsg);
    try {
      await channel.send(
        chatId,
        {
          text: `❌ 音视频处理出错\n原因：${errMsg}\n请重新发送。`,
        },
        { replyTo: msg.messageId },
      );
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
}

/**
 * 处理文件消息：下载文件 → 保存到本地
 */
export async function handleFileEvent(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 收到文件: ${fileName}`);

  try {
    const fileResource = msg.resources.find((r) => r.type === "file");
    if (!fileResource) {
      await channel.send(
        chatId,
        { text: "❌ 无法获取文件资源" },
        { replyTo: msg.messageId },
      );
      return;
    }
    const fileKey = fileResource.fileKey;
    console.log(`[${userId}] 文件 key: ${fileKey}`);

    console.log(`[${userId}] 下载文件中...`);
    let buffer: Buffer | null;
    try {
      buffer = await larkService.getResource(msg.messageId, fileKey, "file");
    } catch (downloadErr) {
      const errMsg =
        downloadErr instanceof Error
          ? downloadErr.message
          : String(downloadErr);
      console.error(`[${userId}] 文件下载异常:`, errMsg);
      await channel.send(
        chatId,
        { text: `❌ 文件下载失败：${errMsg}` },
        { replyTo: msg.messageId },
      );
      return;
    }
    if (!buffer) {
      await channel.send(
        chatId,
        { text: "❌ 文件下载失败" },
        { replyTo: msg.messageId },
      );
      return;
    }
    console.log(`[${userId}] 文件下载完成，大小: ${buffer.length} bytes`);

    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, "");
    const localDir = path.join(config.imageSaveDir, dateFolder);

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const safeName = sanitizeFileName(fileName);
    const filePath = path.join(localDir, safeName);

    try {
      fs.writeFileSync(filePath, buffer);
      console.log(`[${userId}] 文件已保存到本地: ${filePath}`);
    } catch (saveErr) {
      const errMsg =
        saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error(`[${userId}] 保存文件失败:`, errMsg);
      await channel.send(
        chatId,
        { text: `❌ 文件保存失败：${errMsg}` },
        { replyTo: msg.messageId },
      );
      return;
    }

    await channel.send(
      chatId,
      {
        text: `✅ 文件已保存\n📁 位置：${dateFolder}/${safeName}`,
      },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handleFileEvent 未知错误:`, errMsg);
    try {
      await channel.send(
        chatId,
        { text: `❌ 文件处理出错：${errMsg}` },
        { replyTo: msg.messageId },
      );
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
}

/**
 * 处理二进制文件（xlsx/docx 等）：通过飞书导入 API 转换后读取内容
 */
export async function handleBinaryFile(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 收到二进制文件: ${fileName}`);

  const ext = getFileExtension(fileName);
  const targetType = getImportTargetType(ext);
  if (!targetType) {
    await handleFileEvent(channel, msg, fileName);
    return;
  }

  const rootToken = getRootFolderToken();
  if (!rootToken) {
    await channel.send(
      chatId,
      {
        text: "未配置 DRIVE_FOLDER_TOKEN，无法导入文件。请在 .env 中设置。",
      },
      { replyTo: msg.messageId },
    );
    return;
  }

  try {
    const messageData = await larkService.getMessage(msg.messageId);
    if (!messageData?.items?.[0]?.content) throw new Error("无法获取文件信息");
    const content = JSON.parse(messageData.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) throw new Error("无法获取 file_key");

    const buffer = await larkService.getResource(
      msg.messageId,
      fileKey,
      "file",
    );
    if (!buffer) throw new Error("下载文件失败");

    const cleanName = sanitizeFileName(fileName);
    console.log(`[${userId}] 上传文件到云盘: ${cleanName}`);
    const fileToken = await larkService.uploadFile(
      buffer,
      cleanName,
      rootToken,
    );

    console.log(`[${userId}] 创建导入任务: ${ext} → ${targetType}`);
    const ticket = await larkService.createImportTask(
      fileToken,
      ext,
      targetType,
      cleanName,
      rootToken,
    );

    let importResult: { token: string; type: string } | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      importResult = await larkService.pollImportTask(ticket);
      if (importResult) break;
    }
    if (!importResult) throw new Error("导入超时（30 秒）");

    let fileContent = "";
    if (importResult.type === "sheet") {
      const values = await larkService.getSheetValues(
        importResult.token,
        "Sheet1!A1:Z200",
      );
      if (values) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fileContent = (values as any[][])
          .map((row: any[]) => row.join("\t"))
          .join("\n");
      }
    } else {
      const text = await larkService.getDocContent(importResult.token);
      if (text) fileContent = text;
    }

    if (!fileContent) {
      fileContent = `文件 "${fileName}" 导入成功但无法读取内容。`;
    } else {
      fileContent = `📎 文件 "${fileName}" 内容：\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\``;
    }

    const { handleTextMessage } = await import("./conversation");
    await handleTextMessage(channel, {
      ...msg,
      content: fileContent,
      resources: [],
    });
  } catch (err) {
    console.error(`[${userId}] handleBinaryFile failed:`, err);
    const errMsg = `处理文件 "${fileName}" 失败: ${err instanceof Error ? err.message : String(err)}`;
    await channel.send(chatId, { text: errMsg }, { replyTo: msg.messageId });
  }
}
