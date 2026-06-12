import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";

/**
 * 处理详情图套件生成
 */
export async function handleDetailSuite(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageBuffer: Buffer,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;

  console.log(`[${userId}] 开始生成详情图套件`);

  // 发送进度消息
  await channel.send(
    chatId,
    {
      text: `正在生成详情图套件（8张），需要 2-3 分钟...\n分析产品中...`,
    },
    { replyTo: msg.messageId },
  );

  try {
    const { generateDetailSuite } = await import("../../image-gen/detail-suite");

    const result = await generateDetailSuite(
      imageBuffer,
      (current, total, name) => {
        console.log(`[${userId}] 进度: ${current}/${total} - ${name}`);
      },
    );

    // 发送产品分析结果
    const info = result.productInfo;
    const infoText = [
      `📊 产品分析`,
      `品类：${info.category}  材质：${info.material}`,
      `工艺：${info.craftsmanship}`,
      info.culturalMeaning ? `寓意：${info.culturalMeaning}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await channel.send(chatId, { text: infoText }, { replyTo: msg.messageId });

    // 逐张发送图片
    for (const img of result.images) {
      await channel.send(
        chatId,
        {
          image: { source: img.buffer },
        },
        { replyTo: msg.messageId },
      );
    }

    // 发送完成消息
    const productCount = result.images.filter((i) => !i.def.isTemplate).length;
    const templateCount = result.images.filter((i) => i.def.isTemplate).length;
    await channel.send(
      chatId,
      {
        text: `详情图套件生成完成 ✅\n产品图 ${productCount} 张 + 品牌模板 ${templateCount} 张\n模板图下次会自动复用，不用重新生成。`,
      },
      { replyTo: msg.messageId },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 详情图套件生成失败:`, errMsg);
    await channel.send(
      chatId,
      {
        text: `详情图生成失败：${errMsg}\n要再试一次吗？`,
      },
      { replyTo: msg.messageId },
    );
  }
}
