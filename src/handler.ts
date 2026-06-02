import Anthropic from '@anthropic-ai/sdk';
import { larkService } from './lark';
import { streamClaude, ChatMessage, ChatContext } from './claude';
import { config } from './config';
import { pThrottle, validateFileSize, sanitizeFileName, getFileExtension, getImportTargetType } from './util';

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

/** 节流更新卡片（1000ms 间隔，避免飞书频率限制） */
const throttledUpdate = pThrottle(
  async (messageId: string, content: string) => {
    try {
      await larkService.updateCard(messageId, content);
    } catch (err: any) {
      // 飞书频率限制错误静默忽略，下次节流调用会重试
      if (err?.data?.code === 230020) {
        console.warn('[throttledUpdate] 飞书频率限制，跳过本次更新');
        return;
      }
      throw err;
    }
  },
  1000
);

/**
 * 清理群聊中的 @mention 占位符
 */
function stripAtMention(text: string): string {
  return text.replace(/@_user_\d+\s*/g, '').trim();
}

/**
 * 获取上下文信息（用户名、群名）
 */
async function fetchContext(
  userId: string,
  chatId: string,
  chatType: string
): Promise<ChatContext> {
  const ctx: ChatContext = { chatType };

  // 获取群信息
  if (chatType === 'group') {
    const chatInfo = await larkService.getChatInfo(chatId);
    if (chatInfo) ctx.chatName = chatInfo.name;
  }

  // 获取用户名
  if (chatType === 'group') {
    const memberName = await larkService.getChatMemberName(chatId, userId);
    if (memberName) ctx.userName = memberName;
  }
  if (!ctx.userName) {
    const userInfo = await larkService.getUserInfo(userId);
    if (userInfo) ctx.userName = userInfo.name;
  }

  return ctx;
}

/**
 * 处理文件消息：下载文件内容作为上下文
 */
async function handleFileMessage(
  messageId: string,
  fileName: string
): Promise<string | Anthropic.ContentBlockParam[] | null> {
  try {
    const msg = await larkService.getMessage(messageId);
    if (!msg?.items?.[0]?.content) return null;

    const content = JSON.parse(msg.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) return null;

    const buffer = await larkService.getResource(messageId, fileKey, 'file');
    if (!buffer) return null;

    // PDF 文件：作为 document 类型传给 Claude
    if (/\.pdf$/i.test(fileName)) {
      if (!validateFileSize(buffer, 30)) {
        return `📎 文件 "${fileName}" 超过 30MB 限制，无法处理。`;
      }
      const base64 = buffer.toString('base64');
      return [
        { type: 'text', text: `用户发送了 PDF 文件 "${fileName}"：` } as Anthropic.TextBlockParam,
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        } as Anthropic.DocumentBlockParam,
      ];
    }

    // 文本文件直接读取内容
    if (/\.(txt|md|json|csv|xml|yaml|yml|log|py|js|ts|html|css|sh|sql)$/i.test(fileName)) {
      const text = buffer.toString('utf-8').slice(0, 10000); // 限制 10k 字符
      return `📎 文件 "${fileName}" 内容：\n\`\`\`\n${text}\n\`\`\``;
    }

    // 其他文件只返回元信息
    return `📎 用户发送了文件 "${fileName}"（${(buffer.length / 1024).toFixed(1)}KB），此文件类型暂不支持读取内容。`;
  } catch (err) {
    console.error('handleFileMessage failed:', err);
    return null;
  }
}

/**
 * 处理用户消息
 */
export async function handleMessage(
  userId: string,
  chatId: string,
  query: string | Anthropic.ContentBlockParam[],
  chatType: string = 'p2p',
  messageId: string = ''
): Promise<void> {
  // 群聊：清理 @mention（仅文本消息）
  if (chatType === 'group' && typeof query === 'string') {
    query = stripAtMention(query);
  }

  if (!query || (Array.isArray(query) && query.length === 0)) return;

  // /clear 命令（仅文本消息）
  if (typeof query === 'string' && query.trim() === '/clear') {
    conversations.delete(userId);
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, '对话已清除 ✅');
    } else {
      await larkService.sendText(chatId, '对话已清除 ✅');
    }
    return;
  }

  // 并发检查
  if (running.get(userId)) {
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, '上一条回复还在生成中，请稍候...');
    } else {
      await larkService.sendText(chatId, '上一条回复还在生成中，请稍候...');
    }
    return;
  }

  // 获取上下文信息
  console.log(`[${userId}] 获取上下文...`);
  const ctx = await fetchContext(userId, chatId, chatType);
  console.log(`[${userId}] 上下文:`, ctx);

  // 获取或创建对话历史
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  const history = conversations.get(userId)!;

  // 追加用户消息
  history.push({ role: 'user', content: query });

  // 裁剪历史
  while (history.length > config.maxTurns * 2) {
    history.shift();
  }

  running.set(userId, true);

  try {
    // 发送占位卡片
    let replyMessageId: string;
    if (chatType === 'group' && messageId) {
      console.log(`[${userId}] 发送回复卡片...`);
      replyMessageId = await larkService.replyCard(messageId, '思考中...');
    } else {
      console.log(`[${userId}] 发送卡片...`);
      replyMessageId = await larkService.sendCard(chatId, '思考中...');
    }
    console.log(`[${userId}] 卡片已发送: ${replyMessageId}`);

    // 调 Claude，流式更新卡片
    console.log(`[${userId}] 调用 Claude API...`);
    const fullText = await streamClaude(
      history,
      (text) => throttledUpdate(replyMessageId, text),
      ctx
    );
    console.log(`[${userId}] Claude 回复完成，长度: ${fullText.length}`);

    // 最终更新：确保完整内容写入卡片（绕过节流）
    try {
      await larkService.updateCard(replyMessageId, fullText);
    } catch (err: any) {
      if (err?.data?.code !== 230020) throw err;
    }

    // 保存 assistant 回复
    history.push({ role: 'assistant', content: fullText });
  } catch (err) {
    console.error(`[${userId}] 错误:`, err);
    const errMsg = `出错了: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (chatType === 'group' && messageId) {
        await larkService.replyText(messageId, errMsg);
      } else {
        await larkService.sendText(chatId, errMsg);
      }
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  } finally {
    running.set(userId, false);
  }
}

/**
 * 处理音视频消息：下载文件 → 上传飞书云盘 → 回复链接
 */
export async function handleMediaMessage(
  userId: string,
  chatId: string,
  chatType: string,
  messageId: string,
  fileName: string,
  fileKey: string
): Promise<void> {
  console.log(`[${userId}] 收到音视频: ${fileName}`);

  // 回复处理中
  const replyMsg = chatType === 'group' && messageId
    ? await larkService.replyCard(messageId, '正在保存音视频到云盘...')
    : await larkService.sendCard(chatId, '正在保存音视频到云盘...');

  try {
    // 下载文件
    const buffer = await larkService.getResource(messageId, fileKey, 'file');
    if (!buffer) {
      await larkService.updateCard(replyMsg, '文件下载失败');
      return;
    }

    // 上传到飞书云盘
    const folderToken = config.driveFolderToken;
    if (!folderToken) {
      await larkService.updateCard(replyMsg, '未配置云盘文件夹，请设置 DRIVE_FOLDER_TOKEN 环境变量');
      return;
    }

    const safeName = sanitizeFileName(fileName);
    const fileToken = await larkService.uploadFile(buffer, safeName, folderToken);

    const link = `${config.lark.domain}/file/${fileToken}`;
    await larkService.updateCard(
      replyMsg,
      `音视频已保存到云盘\n\n文件名：${safeName}\n[打开文件](${link})`
    );
  } catch (err) {
    console.error(`[${userId}] 音视频保存失败:`, err);
    const errMsg = `保存失败: ${err instanceof Error ? err.message : String(err)}`;
    try {
      await larkService.updateCard(replyMsg, errMsg);
    } catch (updateErr) {
      console.error(`[${userId}] 更新错误卡片失败:`, updateErr);
    }
  }
}

/**
 * 处理文件消息（从 app.ts 调用）
 */
export async function handleFileEvent(
  userId: string,
  chatId: string,
  chatType: string,
  messageId: string,
  fileName: string
): Promise<void> {
  console.log(`[${userId}] 收到文件: ${fileName}`);

  const fileContext = await handleFileMessage(messageId, fileName);
  const query = fileContext || `用户发送了文件 "${fileName}"，但无法读取内容。`;

  // 把文件信息当作用户消息传给 Claude
  await handleMessage(userId, chatId, query, chatType, messageId);
}

/**
 * 处理图片消息：下载图片，转 base64 传给 Claude
 */
export async function handleImageMessage(
  userId: string,
  chatId: string,
  chatType: string,
  messageId: string,
  imageKey: string
): Promise<void> {
  console.log(`[${userId}] 收到图片: ${imageKey}`);

  try {
    const buffer = await larkService.getResource(messageId, imageKey, 'image');
    if (!buffer) {
      const fallback = '图片下载失败，请重新发送。';
      if (chatType === 'group' && messageId) {
        await larkService.replyText(messageId, fallback);
      } else {
        await larkService.sendText(chatId, fallback);
      }
      return;
    }

    if (!validateFileSize(buffer, 22)) {
      const fallback = '图片超过 22MB 限制，请压缩后重新发送。';
      if (chatType === 'group' && messageId) {
        await larkService.replyText(messageId, fallback);
      } else {
        await larkService.sendText(chatId, fallback);
      }
      return;
    }

    const base64 = buffer.toString('base64');
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: '用户发送了一张图片：' } as Anthropic.TextBlockParam,
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
      } as Anthropic.ImageBlockParam,
    ];

    await handleMessage(userId, chatId, content, chatType, messageId);
  } catch (err) {
    console.error(`[${userId}] handleImageMessage failed:`, err);
    const errMsg = '图片处理出错，请重新发送。';
    try {
      if (chatType === 'group' && messageId) {
        await larkService.replyText(messageId, errMsg);
      } else {
        await larkService.sendText(chatId, errMsg);
      }
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
}

/**
 * 处理二进制文件（xlsx/docx 等）：通过飞书导入 API 转换后读取内容
 */
export async function handleBinaryFile(
  userId: string,
  chatId: string,
  chatType: string,
  messageId: string,
  fileName: string
): Promise<void> {
  console.log(`[${userId}] 收到二进制文件: ${fileName}`);

  const ext = getFileExtension(fileName);
  const targetType = getImportTargetType(ext);
  if (!targetType) {
    await handleFileEvent(userId, chatId, chatType, messageId, fileName);
    return;
  }

  const folderToken = config.driveFolderToken;
  if (!folderToken) {
    const msg = '未配置 DRIVE_FOLDER_TOKEN，无法导入文件。请在 .env 中设置。';
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, msg);
    } else {
      await larkService.sendText(chatId, msg);
    }
    return;
  }

  try {
    // 1. 下载文件
    const msg = await larkService.getMessage(messageId);
    if (!msg?.items?.[0]?.content) throw new Error('无法获取文件信息');
    const content = JSON.parse(msg.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) throw new Error('无法获取 file_key');

    const buffer = await larkService.getResource(messageId, fileKey, 'file');
    if (!buffer) throw new Error('下载文件失败');

    // 2. 上传到云盘
    const cleanName = sanitizeFileName(fileName);
    console.log(`[${userId}] 上传文件到云盘: ${cleanName}`);
    const fileToken = await larkService.uploadFile(buffer, cleanName, folderToken);

    // 3. 创建导入任务
    console.log(`[${userId}] 创建导入任务: ${ext} → ${targetType}`);
    const ticket = await larkService.createImportTask(fileToken, ext, targetType, cleanName, folderToken);

    // 4. 轮询结果（最多 30 秒，每 2 秒一次）
    let importResult: { token: string; type: string } | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      importResult = await larkService.pollImportTask(ticket);
      if (importResult) break;
    }
    if (!importResult) throw new Error('导入超时（30 秒）');

    // 5. 读取内容
    let fileContent = '';
    if (importResult.type === 'sheet') {
      const values = await larkService.getSheetValues(importResult.token, 'Sheet1!A1:Z200');
      if (values) {
        fileContent = values.map(row => row.join('\t')).join('\n');
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

    await handleMessage(userId, chatId, fileContent, chatType, messageId);
  } catch (err) {
    console.error(`[${userId}] handleBinaryFile failed:`, err);
    const errMsg = `处理文件 "${fileName}" 失败: ${err instanceof Error ? err.message : String(err)}`;
    if (chatType === 'group' && messageId) {
      await larkService.replyText(messageId, errMsg);
    } else {
      await larkService.sendText(chatId, errMsg);
    }
  }
}
