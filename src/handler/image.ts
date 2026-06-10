import { config } from '../config';
import { sanitizeFileName } from '../util';
import { analyzeImageForGeneration, buildPrompt, generateImage } from '../image-gen';
import type { ImageAnalysis, ImageGenIntent } from '../image-gen';
import { generateXhsContent, generateCoverTitle } from '../xhs';
import { addTextOverlay } from '../image-gen/text-overlay';
import { larkService } from '../lark';
import { getTodayDate } from './file';
import { getRootFolderToken, getOrCreateFolder } from './folder';
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import fs from 'fs';
import path from 'path';

/** 每用户待保存的图片 */
const pendingImages = new Map<string, { buffer: Buffer; fileName: string }>();

/** 每用户待处理的图片（已保存，等待用户决定是否生成） */
const pendingImageEdit = new Map<string, {
  buffer: Buffer;
  analysis: ImageAnalysis | null;
  savedPath: string;
  fileName: string;
  dateFolder: string;
}>();

/** 每用户待发布的小红书内容 */
const pendingXhsPublish = new Map<string, {
  title: string;
  content: string;
  tags: string[];
  images: Buffer[];
}>();

/**
 * 处理小红书发布确认（保留函数签名，但不再使用）
 */
export async function handleXhsConfirm(
  channel: LarkChannel,
  chatId: string,
  userId: string,
  messageId: string
): Promise<void> {
  // 这个函数不再需要，因为内容直接发送给用户
  await channel.send(chatId, { text: '内容已直接发送，无需确认。' }, { replyTo: messageId });
}

/**
 * 用正则匹配用户对图片的意图
 */
function parseImageIntent(query: string): { action: string; folder: string; fileName: string } {
  const saveMatch = query.match(/(?:保存|存到|放到|存入|存到)\s*(.*)/);
  if (saveMatch) {
    const folder = saveMatch[1]?.trim() || '未整理';
    return { action: 'save', folder, fileName: `image_${Date.now()}` };
  }

  if (query.match(/不要|删除|取消|丢掉|扔掉/)) {
    return { action: 'discard', folder: '', fileName: '' };
  }

  return { action: 'chat', folder: '', fileName: '' };
}

/**
 * 处理待保存图片的用户响应
 */
export async function handlePendingImageResponse(
  channel: LarkChannel,
  msg: NormalizedMessage,
  query: string
): Promise<boolean> {
  const userId = msg.senderId;
  if (!pendingImages.has(userId)) return false;

  const pending = pendingImages.get(userId)!;
  const intent = parseImageIntent(query);

  try {
    if (intent.action === 'save') {
      const folder = sanitizeFileName(intent.folder || '未整理');
      const fileName = sanitizeFileName((intent.fileName || `image_${Date.now()}`) + '.jpg');
      const today = getTodayDate();
      const folderToken = await getOrCreateFolder(`${folder}/${today}`);
      const fileToken = await larkService.uploadFile(pending.buffer, fileName, folderToken);
      const url = `https://feishu.cn/file/${fileToken}`;

      const replyMsg = `🖼️ 图片已保存\n文件夹：${folder}/${today}\n文件：${fileName}\n${url}`;
      pendingImages.delete(userId);
      await channel.send(msg.chatId, { text: replyMsg }, { replyTo: msg.messageId });
    } else if (intent.action === 'discard') {
      pendingImages.delete(userId);
      await channel.send(msg.chatId, { text: '已丢弃图片。' }, { replyTo: msg.messageId });
    } else {
      pendingImages.delete(userId);
      return false; // 让 router 重新处理为普通消息
    }
  } catch (err) {
    pendingImages.delete(userId);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handlePendingImageResponse 失败:`, errMsg);
    await channel.send(msg.chatId, {
      text: `图片保存失败：${errMsg}`,
    }, { replyTo: msg.messageId });
  }

  return true;
}

/**
 * 处理待编辑图片的用户响应
 */
export async function handlePendingImageEditResponse(
  channel: LarkChannel,
  msg: NormalizedMessage,
  query: string
): Promise<boolean> {
  const userId = msg.senderId;

  // 处理小红书发布确认/取消
  if (pendingXhsPublish.has(userId)) {
    const pending = pendingXhsPublish.get(userId)!;

    if (/^(确认|发布|ok|yes|是|xhs_confirm|复制)/i.test(query)) {
      // 格式化内容供用户复制
      const tagsText = pending.tags.map(t => `#${t}`).join(' ');
      const fullContent = `${pending.content}\n\n${tagsText}`;

      // 分开发送标题和正文，方便复制
      await channel.send(msg.chatId, {
        text: `📌 标题：\n${pending.title}`,
      }, { replyTo: msg.messageId });

      await channel.send(msg.chatId, {
        text: `📝 正文：\n${fullContent}`,
      }, { replyTo: msg.messageId });

      await channel.send(msg.chatId, {
        text: `图片已保存在本地，发布时选择对应图片即可。`,
      }, { replyTo: msg.messageId });

      pendingXhsPublish.delete(userId);
      return true;
    }

    if (/^(取消|放弃|cancel|no|否|xhs_cancel)/i.test(query)) {
      pendingXhsPublish.delete(userId);
      await channel.send(msg.chatId, { text: '已取消发布' }, { replyTo: msg.messageId });
      return true;
    }

    // 如果用户回复了其他内容，提醒他们确认或取消
    await channel.send(msg.chatId, {
      text: `请回复「确认」发布，或「取消」放弃`,
    }, { replyTo: msg.messageId });
    return true;
  }

  if (!pendingImageEdit.has(userId)) return false;

  const pending = pendingImageEdit.get(userId)!;

  // 匹配命令和可选的文字内容（如 "3 秋冬必备保温杯" 或 "封面 秋冬必备保温杯"）
  const genMatch = query.match(/^(1|2|3|4|5|穿戴|商品|封面|详情|生成|小红书发布|xhs|tryon|product|cover|detail)\s*(.*)/i);
  if (genMatch && pending.analysis) {
    const command = genMatch[1];
    const overlayText = genMatch[2]?.trim() || '';

    // 小红书发布（直接生成内容，不需要确认）
    if (command === '5' || /小红书发布|xhs/i.test(command)) {
      await handleXhsPublish(channel, msg, pending.buffer, pending.analysis);
      pendingImageEdit.delete(userId);
      return true;
    }

    await handleImageGeneration(channel, msg, { buffer: pending.buffer, analysis: pending.analysis }, command, overlayText);
    pendingImageEdit.delete(userId);
    return true;
  }

  if (/^(完成|好了|ok|done|好)/i.test(query)) {
    pendingImageEdit.delete(userId);
    await channel.send(msg.chatId, { text: '好的 ✅' }, { replyTo: msg.messageId });
    return true;
  }

  if (/^(删除|撤回|不要|丢弃|discard)/i.test(query)) {
    try {
      if (fs.existsSync(pending.savedPath)) {
        fs.unlinkSync(pending.savedPath);
      }
    } catch { /* ignore */ }
    pendingImageEdit.delete(userId);
    await channel.send(msg.chatId, { text: '已删除' }, { replyTo: msg.messageId });
    return true;
  }

  pendingImageEdit.delete(userId);
  return false;
}

/**
 * 处理图片消息：下载图片，分析内容，保存到本地
 */
export async function handleImageMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageKey: string
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 开始处理图片: ${imageKey}`);

  try {
    // 1. 下载图片
    console.log(`[${userId}] 下载图片中...`);
    let buffer: Buffer | null;
    try {
      buffer = await larkService.getResource(msg.messageId, imageKey, 'image');
    } catch (downloadErr) {
      const errMsg = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
      console.error(`[${userId}] 图片下载异常:`, errMsg);
      await channel.send(chatId, {
        text: `❌ 图片下载失败\n原因：${errMsg}\n请检查网络连接或重新发送。`,
      }, { replyTo: msg.messageId });
      return;
    }
    if (!buffer) {
      await channel.send(chatId, {
        text: '❌ 图片下载失败\n原因：返回数据为空\n请重新发送图片。',
      }, { replyTo: msg.messageId });
      return;
    }
    console.log(`[${userId}] 图片下载完成，大小: ${buffer.length} bytes`);

    // 2. 一次调用完成图片分析（描述 + 生成参数）
    let genAnalysis: ImageAnalysis | null = null;
    let analyzeError = '';
    try {
      const base64Image = buffer.toString('base64');
      genAnalysis = await analyzeImageForGeneration(base64Image);
      console.log(`[${userId}] 图片分析完成: ${genAnalysis.description}, 类型: ${genAnalysis.contentType}, 建议: ${genAnalysis.suggestedMode}`);
    } catch (analyzeErr) {
      analyzeError = analyzeErr instanceof Error ? analyzeErr.message : String(analyzeErr);
      console.warn(`[${userId}] 图片分析失败:`, analyzeError);
    }

    // 3. 保存到本地文件夹
    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, '');
    const localDir = path.join(config.imageSaveDir, dateFolder);

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // 4. 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const contentSummary = sanitizeFileName(genAnalysis?.fileName || '图片');
    const fileName = `${timestamp}_${contentSummary}.jpg`;
    const filePath = path.join(localDir, fileName);

    // 5. 保存到本地
    try {
      fs.writeFileSync(filePath, buffer);
      console.log(`[${userId}] 图片已保存到本地: ${filePath}`);
    } catch (saveErr) {
      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error(`[${userId}] 保存图片失败:`, errMsg);
      await channel.send(chatId, {
        text: `❌ 图片保存失败\n文件：${fileName}\n原因：${errMsg}`,
      }, { replyTo: msg.messageId });
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
    const desc = genAnalysis?.description || '图片';
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
    await channel.send(chatId, { text: replyLines.join('\n') }, { replyTo: msg.messageId });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] handleImageMessage 未知错误:`, errMsg);
    try {
      await channel.send(chatId, {
        text: `图片处理出错了，${errMsg}。重新发一张试试？`,
      }, { replyTo: msg.messageId });
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
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
  if (command === '4' || /详情|detail/i.test(command)) {
    await handleDetailSuite(channel, msg, pending.buffer);
    return;
  }

  let mode: 'tryon' | 'product' | 'cover';
  if (command === '1' || /穿戴|试穿|tryon/i.test(command)) {
    mode = 'tryon';
  } else if (command === '3' || /封面|cover/i.test(command)) {
    mode = 'cover';
  } else if (command === '2' || /商品|product/i.test(command) || /生成/i.test(command)) {
    mode = 'product';
  } else {
    mode = pending.analysis.suggestedMode;
  }

  const textHint = overlayText ? `，带文字「${overlayText}」` : '';
  console.log(`[${userId}] 开始图片生成，模式: ${mode}${textHint}`);

  await channel.send(chatId, {
    text: `在出了，等我一下...`,
  }, { replyTo: msg.messageId });

  try {
    const intent: ImageGenIntent = { mode };
    const prompt = buildPrompt(pending.analysis, mode, intent);
    console.log(`[${userId}] 提示词: ${prompt}`);

    const result = await generateImage(pending.buffer, prompt, intent);
    console.log(`[${userId}] 生成完成: ${result.provider}, ${result.images.length} 张`);

    // 如果是封面模式且有文字，应用文字叠加
    let finalImages = result.images;
    if (mode === 'cover' && overlayText && result.images.length > 0) {
      try {
        const { addTextOverlay } = await import('../image-gen/text-overlay');
        const processed = await Promise.all(
          result.images.map(img => addTextOverlay(img, { text: overlayText }))
        );
        finalImages = processed;
        console.log(`[${userId}] 文字叠加完成`);
      } catch (overlayErr) {
        console.warn(`[${userId}] 文字叠加失败，使用原图:`, overlayErr);
      }
    }

    const today = getTodayDate();
    const dateFolder = today.replace(/-/g, '');
    const localDir = path.join(config.imageSaveDir, dateFolder);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const savedFiles: string[] = [];
    for (let i = 0; i < finalImages.length; i++) {
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const fileName = `gen_${timestamp}_${mode}_${i + 1}.jpg`;
      const filePath = path.join(localDir, fileName);
      fs.writeFileSync(filePath, finalImages[i]);
      savedFiles.push(fileName);
    }

    let driveUrl = '';
    try {
      const rootToken = getRootFolderToken();
      if (rootToken) {
        const folderPath = `生成图片/${today}`;
        const folderToken = await getOrCreateFolder(folderPath);
        for (let i = 0; i < finalImages.length; i++) {
          const fileToken = await larkService.uploadFile(finalImages[i], savedFiles[i], folderToken);
          driveUrl = `https://feishu.cn/file/${fileToken}`;
        }
      }
    } catch (uploadErr) {
      console.warn(`[${userId}] 上传云盘失败:`, uploadErr);
    }

    // 发送生成的图片给用户
    for (let i = 0; i < finalImages.length; i++) {
      await channel.send(chatId, { image: { source: finalImages[i] } }, { replyTo: msg.messageId });
    }

    const replyLines = [
      `出来了，看看效果 ✅`,
      `已存到 ${dateFolder}/${savedFiles.join(', ')}`,
    ];
    if (driveUrl) {
      replyLines.push(`云盘：${driveUrl}`);
    }

    await channel.send(chatId, { text: replyLines.join('\n') }, { replyTo: msg.messageId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 图片生成失败:`, errMsg);
    await channel.send(chatId, {
      text: `没生成成功，${errMsg}。要再试一次吗？`,
    }, { replyTo: msg.messageId });
  }
}

/**
 * 处理详情图套件生成
 */
async function handleDetailSuite(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageBuffer: Buffer
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;

  console.log(`[${userId}] 开始生成详情图套件`);

  // 发送进度消息
  await channel.send(chatId, {
    text: `正在生成详情图套件（8张），需要 2-3 分钟...\n分析产品中...`,
  }, { replyTo: msg.messageId });

  try {
    const { generateDetailSuite } = await import('../image-gen/detail-suite');

    const result = await generateDetailSuite(imageBuffer, (current, total, name) => {
      console.log(`[${userId}] 进度: ${current}/${total} - ${name}`);
    });

    // 发送产品分析结果
    const info = result.productInfo;
    const infoText = [
      `📊 产品分析`,
      `品类：${info.category}  材质：${info.material}`,
      `工艺：${info.craftsmanship}`,
      info.culturalMeaning ? `寓意：${info.culturalMeaning}` : '',
    ].filter(Boolean).join('\n');
    await channel.send(chatId, { text: infoText }, { replyTo: msg.messageId });

    // 逐张发送图片
    for (const img of result.images) {
      await channel.send(chatId, {
        image: { source: img.buffer },
      }, { replyTo: msg.messageId });
    }

    // 发送完成消息
    const productCount = result.images.filter(i => !i.def.isTemplate).length;
    const templateCount = result.images.filter(i => i.def.isTemplate).length;
    await channel.send(chatId, {
      text: `详情图套件生成完成 ✅\n产品图 ${productCount} 张 + 品牌模板 ${templateCount} 张\n模板图下次会自动复用，不用重新生成。`,
    }, { replyTo: msg.messageId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 详情图套件生成失败:`, errMsg);
    await channel.send(chatId, {
      text: `详情图生成失败：${errMsg}\n要再试一次吗？`,
    }, { replyTo: msg.messageId });
  }
}

/**
 * 处理小红书发布请求
 */
async function handleXhsPublish(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageBuffer: Buffer,
  analysis: ImageAnalysis,
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;

  console.log(`[${userId}] 开始小红书发布流程`);

  // 发送进度消息
  await channel.send(chatId, {
    text: `正在生成小红书内容...\n分析产品中...`,
  }, { replyTo: msg.messageId });

  try {
    // 1. 生成小红书内容
    const productInfo = {
      category: analysis.category,
      material: analysis.attributes.material,
      color: analysis.attributes.color,
      style: analysis.attributes.style,
      description: analysis.description,
    };

    const content = await generateXhsContent(productInfo, '种草');
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
        position: 'bottom',
        fontSize: 48,
      });
      console.log(`[${userId}] 封面图生成完成`);
    } catch (overlayErr) {
      console.warn(`[${userId}] 文字叠加失败，用原图:`, overlayErr);
      coverImage = imageBuffer;
    }

    // 4. 直接发送标题和正文
    const tagsText = content.tags.map(t => `#${t}`).join(' ');

    // 发送封面预览图
    await channel.send(chatId, {
      image: { source: coverImage },
    }, { replyTo: msg.messageId });

    // 发送标题
    await channel.send(chatId, {
      text: content.title,
    }, { replyTo: msg.messageId });

    // 发送正文+标签
    await channel.send(chatId, {
      text: `${content.content}\n\n${tagsText}`,
    }, { replyTo: msg.messageId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${userId}] 小红书内容生成失败:`, errMsg);
    await channel.send(chatId, {
      text: `内容生成失败：${errMsg}\n要再试一次吗？`,
    }, { replyTo: msg.messageId });
  }
}
