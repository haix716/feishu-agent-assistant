import { generateXhsContent, generateCoverTitle } from "../../xhs";
import { addTextOverlay } from "../../image-gen/text-overlay";
import type { ImageAnalysis } from "../../image-gen";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";

/**
 * 处理小红书发布请求
 */
export async function handleXhsPublish(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageBuffer: Buffer,
  analysis: ImageAnalysis,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;

  console.log(`[${userId}] 开始小红书发布流程`);

  // 发送进度消息
  await channel.send(
    chatId,
    {
      text: `正在生成小红书内容...\n分析产品中...`,
    },
    { replyTo: msg.messageId },
  );

  try {
    // 1. 生成小红书内容
    const productInfo = {
      category: analysis.category,
      material: analysis.attributes.material,
      color: analysis.attributes.color,
      style: analysis.attributes.style,
      description: analysis.description,
    };

    const content = await generateXhsContent(productInfo, "种草");
    console.log(`[${userId}] 内容生成完成: ${content.title}`);

    // 2. 生成封面标题
    const coverTitle = await generateCoverTitle(productInfo);
    console.log(`[${userId}] 封面标题: ${coverTitle}`);

    // 3. 在原图上叠加封面标题
    console.log(`[${userId}] 生成封面图（原图+文字叠加）`);
    let coverImage: Buffer;
    try {
      coverImage = await addTextOverlay(imageBuffer, {
        text: coverTitle,
        position: "bottom",
        fontSize: 48,
      });
      console.log(`[${userId}] 封面图生成完成`);
    } catch (overlayErr) {
      console.warn(`[${userId}] 文字叠加失败，用原图:`, overlayErr);
      coverImage = imageBuffer;
    }

    // 4. 直接发送标题和正文
    const tagsText = content.tags.map((t) => `#${t}`).join(" ");

    // 发送封面预览图
    await channel.send(
      chatId,
      {
        image: { source: coverImage },
      },
      { replyTo: msg.messageId },
    );

    // 发送标题
    await channel.send(
      chatId,
      {
        text: content.title,
      },
      { replyTo: msg.messageId },
    );

    // 发送正文+标签
    await channel.send(
      chatId,
      {
        text: `${content.content}\n\n${tagsText}`,
      },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 小红书内容生成失败:`, errMsg);
    await channel.send(
      chatId,
      {
        text: `内容生成失败：${errMsg}\n要再试一次吗？`,
      },
      { replyTo: msg.messageId },
    );
  }
}

/**
 * 处理小红书发布确认（保留函数签名，但不再使用）
 */
export async function handleXhsConfirm(
  channel: LarkChannel,
  chatId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  // 这个函数不再需要，因为内容直接发送给用户
  await channel.send(
    chatId,
    { text: "内容已直接发送，无需确认。" },
    { replyTo: messageId },
  );
}
