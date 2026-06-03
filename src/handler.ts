import { larkService } from './lark';
import { streamAI, ChatMessage, ChatContext } from './ai';
import { config } from './config';
import { validateFileSize, sanitizeFileName, getFileExtension, getImportTargetType, extractFeishuDocLinks, formatFileList, parseFileCommand } from './util';
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';

/** 每用户对话历史 */
const conversations = new Map<string, ChatMessage[]>();

/** 每用户并发锁 */
const running = new Map<string, boolean>();

/** 每用户待保存的图片 */
const pendingImages = new Map<string, { buffer: Buffer; fileName: string }>();

/** 文件夹 token 缓存：key = "类型/日期", value = folder_token */
const folderCache = new Map<string, string>();

/** 根文件夹 token（启动时自动获取） */
let rootFolderToken = '';

/** 初始化根文件夹：自动创建"智能体文件"文件夹 */
export async function initRootFolder(): Promise<void> {
  try {
    if (config.driveFolderToken) {
      rootFolderToken = config.driveFolderToken;
      console.log(`✅ 使用配置的根文件夹: ${rootFolderToken}`);
      return;
    }

    // 尝试自动获取根文件夹并创建"智能体文件"
    console.log('📁 尝试自动获取根文件夹...');
    try {
      const rootToken = await larkService.getRootFolder();
      console.log('📁 根文件夹获取成功');

      // 创建"智能体文件"文件夹
      console.log('📁 创建"智能体文件"文件夹...');
      rootFolderToken = await larkService.createFolder('智能体文件', rootToken);
      console.log('✅ 智能体文件夹创建成功');
    } catch (err: any) {
      console.log(`⚠️ 自动创建文件夹失败: ${err.message}`);
      console.log('   请在 .env 文件中设置 DRIVE_FOLDER_TOKEN（飞书云盘文件夹 token）');
      console.log('   或者手动在飞书云盘创建"智能体文件"文件夹并复制其 token');
    }
  } catch (err) {
    console.error('❌ 初始化根文件夹失败:', err);
    throw err;
  }
}

/** 获取或创建文件夹，返回 folder_token。path 如 "图片/2026-06-02" 或 "test/2026-06-02" */
async function getOrCreateFolder(path: string): Promise<string> {
  if (folderCache.has(path)) {
    return folderCache.get(path)!;
  }

  if (!rootFolderToken) {
    throw new Error('根文件夹未初始化，请先调用 initRootFolder()');
  }

  // 创建路径：{rootFolderToken}/{path}
  const parts = path.split('/').filter(Boolean);
  let currentToken = rootFolderToken;

  for (const part of parts) {
    currentToken = await larkService.createFolder(part, currentToken);
  }

  folderCache.set(path, currentToken);
  return currentToken;
}

/** 获取今天的日期字符串 */
function getTodayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 从飞书文档链接获取内容
 */
async function fetchDocLinkContent(
  type: string,
  token: string
): Promise<string | null> {
  try {
    if (type === 'docx' || type === 'doc') {
      const content = await larkService.getDocContent(token);
      if (content) {
        return `📄 飞书文档内容（${type}）：\n${content.slice(0, 10000)}`;
      }
    } else if (type === 'wiki') {
      const node = await larkService.getWikiNode(token);
      if (node && node.obj_type === 'docx') {
        const content = await larkService.getDocContent(node.obj_token);
        if (content) {
          return `📄 飞书知识库文档内容：\n${content.slice(0, 10000)}`;
        }
      }
    }
  } catch (err) {
    console.error('fetchDocLinkContent failed:', err);
  }
  return null;
}

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
): Promise<string | null> {
  try {
    const msg = await larkService.getMessage(messageId);
    if (!msg?.items?.[0]?.content) return null;

    const content = JSON.parse(msg.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) return null;

    const buffer = await larkService.getResource(messageId, fileKey, 'file');
    if (!buffer) return null;

    // PDF 文件：描述为文本（OpenAI SDK 不支持 document block）
    if (/\.pdf$/i.test(fileName)) {
      if (!validateFileSize(buffer, 30)) {
        return `📎 文件 "${fileName}" 超过 30MB 限制，无法处理。`;
      }
      return `📎 用户发送了 PDF 文件 "${fileName}"（${(buffer.length / 1024).toFixed(1)}KB）。由于当前使用 OpenAI 兼容接口，暂不支持直接解析 PDF 内容。`;
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
 * 处理「读文件 xxx」指令：查找文件、下载、读取内容
 */
async function handleReadFile(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string
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

    // 文本类文件读取内容
    if (/\.(txt|md|json|csv|xml|yaml|yml|log|py|js|ts|html|css|sh|sql)$/i.test(fileName)) {
      const text = buffer.toString('utf-8').slice(0, 10000);
      await reply(`📎 文件「${fileName}」内容：\n\`\`\`\n${text}\n\`\`\``);
    } else {
      await reply(`📎 文件「${fileName}」（${(buffer.length / 1024).toFixed(1)}KB），此文件类型暂不支持读取内容。`);
    }
  } catch (err) {
    console.error(`[${msg.senderId}] handleReadFile failed:`, err);
    await reply(`读取文件「${fileName}」时出错，请稍后重试。`);
  }
}

/**
 * 处理用户消息（统一入口）
 */
export async function handleMessage(
  channel: LarkChannel,
  msg: NormalizedMessage
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  const chatType = msg.chatType;
  const messageId = msg.messageId;

  // 根据消息类型分发
  const imageResource = msg.resources.find((r) => r.type === 'image');
  const audioResource = msg.resources.find((r) => r.type === 'audio');
  const videoResource = msg.resources.find((r) => r.type === 'video');
  const fileResource = msg.resources.find((r) => r.type === 'file');

  if (imageResource) {
    await handleImageMessage(channel, msg, imageResource.fileKey);
    return;
  }
  if (audioResource || videoResource) {
    const media = audioResource || videoResource!;
    await handleMediaMessage(channel, msg, media.fileName || 'media', media.fileKey);
    return;
  }
  if (fileResource) {
    const fileName = fileResource.fileName || 'file';
    const ext = getFileExtension(fileName);
    if (getImportTargetType(ext)) {
      await handleBinaryFile(channel, msg, fileName);
    } else {
      await handleFileEvent(channel, msg, fileName);
    }
    return;
  }

  // 文本消息
  let query = msg.content;
  if (typeof query !== 'string') return;

  // 群聊：清理 @mention
  if (chatType === 'group') {
    query = stripAtMention(query);
  }

  if (!query) return;

  // 检测飞书文档链接，读取内容拼入消息
  const docLinks = extractFeishuDocLinks(query);
  if (docLinks.length > 0) {
    const docParts: string[] = [];
    for (const link of docLinks) {
      const content = await fetchDocLinkContent(link.type, link.token);
      if (content) docParts.push(content);
    }
    if (docParts.length > 0) {
      query = `${query}\n\n${docParts.join('\n\n')}`;
    }
  }

  // /clear 命令
  if (query.trim() === '/clear') {
    conversations.delete(userId);
    await channel.send(chatId, { text: '对话已清除 ✅' }, { replyTo: messageId });
    return;
  }

  // 有待保存图片时，用 AI 理解用户意图
  if (pendingImages.has(userId)) {
    const pending = pendingImages.get(userId)!;

    // 用 AI 理解用户意图
    const intentPrompt = `用户刚收到一张图片（${(pending.buffer.length / 1024).toFixed(1)}KB），现在说："${query}"

请解析用户的意图，返回 JSON 格式：
{
  "action": "save" | "discard" | "chat",
  "folder": "文件夹路径（如 test、工作/项目A）",
  "fileName": "文件名（不含扩展名）",
  "reply": "给用户的回复（如果 action 是 chat）"
}

规则：
- 如果用户说"保存"、"存到"、"放到"等，action 是 "save"
- 如果用户说"不要了"、"删除"、"取消"，action 是 "discard"
- 如果用户没提到保存相关，action 是 "chat"，正常回复
- folder 默认是 "未整理"
- fileName 默认是 "图片_${Date.now()}"
- 只返回 JSON，不要其他内容`;

    try {
      const intentResult = await streamAI(
        [{ role: 'user', content: intentPrompt }],
        () => {} // 不需要流式更新
      );

      // 解析 AI 返回的 JSON
      let intent: any;
      try {
        // 提取 JSON（可能被 markdown 包裹）
        const jsonMatch = intentResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          intent = JSON.parse(jsonMatch[0]);
        }
      } catch {
        intent = { action: 'chat', reply: intentResult };
      }

      if (intent.action === 'save') {
        const folder = sanitizeFileName(intent.folder || '未整理');
        const fileName = sanitizeFileName((intent.fileName || `image_${Date.now()}`) + '.jpg');

        // 创建文件夹并保存
        const today = getTodayDate();
        const folderToken = await getOrCreateFolder(`${folder}/${today}`);
        const fileToken = await larkService.uploadFile(pending.buffer, fileName, folderToken);
        const url = `https://feishu.cn/file/${fileToken}`;

        const replyMsg = `🖼️ 图片已保存\n文件夹：${folder}/${today}\n文件：${fileName}\n${url}`;
        pendingImages.delete(userId);
        await channel.send(chatId, { text: replyMsg }, { replyTo: messageId });
      } else if (intent.action === 'discard') {
        pendingImages.delete(userId);
        await channel.send(chatId, { text: '已丢弃图片。' }, { replyTo: messageId });
      } else {
        // action === 'chat'，正常对话
        pendingImages.delete(userId);
        await handleMessage(channel, msg);
      }
    } catch (err) {
      console.error('意图解析失败:', err);
      // 回退到简单匹配
      if (/保存|存|放/.test(query)) {
        const today = getTodayDate();
        const folderToken = await getOrCreateFolder(`未整理/${today}`);
        const fileName = sanitizeFileName(`image_${Date.now()}.jpg`);
        const fileToken = await larkService.uploadFile(pending.buffer, fileName, folderToken);
        const url = `https://feishu.cn/file/${fileToken}`;
        const replyMsg = `🖼️ 图片已保存\n文件夹：未整理/${today}\n文件：${fileName}\n${url}`;
        pendingImages.delete(userId);
        await channel.send(chatId, { text: replyMsg }, { replyTo: messageId });
      } else {
        pendingImages.delete(userId);
        await handleMessage(channel, msg);
      }
    }
    return;
  }

  // 群文件指令
  if (query.trim() === '群文件') {
    const files = await larkService.listFiles(chatId);
    const text = formatFileList(files);
    await channel.send(chatId, { text }, { replyTo: messageId });
    return;
  }

  // 读文件指令
  const fileName = parseFileCommand(query);
  if (fileName) {
    await handleReadFile(channel, msg, fileName);
    return;
  }

  // 并发检查
  if (running.get(userId)) {
    await channel.send(chatId, { text: '上一条回复还在生成中，请稍候...' }, { replyTo: messageId });
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
    // 流式输出
    console.log(`[${userId}] 调用 AI API...`);
    let fullText = '';
    await channel.stream(chatId, {
      markdown: async (s) => {
        let lastText = '';
        fullText = await streamAI(history, (text) => {
          if (text !== lastText) {
            s.setContent(text);
            lastText = text;
          }
        }, ctx);
      },
    }, { replyTo: messageId });
    console.log(`[${userId}] AI 回复完成，长度: ${fullText.length}`);

    // 保存 assistant 回复
    history.push({ role: 'assistant', content: fullText });
  } catch (err) {
    console.error(`[${userId}] 错误:`, err);
    const errMsg = `出错了: ${err instanceof Error ? err.message : String(err)}`;
    try {
      await channel.send(chatId, { text: errMsg }, { replyTo: messageId });
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
async function handleMediaMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string,
  fileKey: string
): Promise<void> {
  const userId = msg.senderId;
  console.log(`[${userId}] 收到音视频: ${fileName}`);

  // 回复处理中
  await channel.send(msg.chatId, { text: '正在保存音视频到云盘...' }, { replyTo: msg.messageId });

  try {
    // 下载文件
    const buffer = await larkService.getResource(msg.messageId, fileKey, 'file');
    if (!buffer) {
      await channel.send(msg.chatId, { text: '文件下载失败' }, { replyTo: msg.messageId });
      return;
    }

    // 上传到飞书云盘
    if (!rootFolderToken) {
      await channel.send(msg.chatId, { text: '未配置云盘文件夹，请设置 DRIVE_FOLDER_TOKEN 环境变量' }, { replyTo: msg.messageId });
      return;
    }

    const safeName = sanitizeFileName(fileName);
    const fileToken = await larkService.uploadFile(buffer, safeName, rootFolderToken);

    const link = `${config.lark.domain}/file/${fileToken}`;
    await channel.send(msg.chatId, {
      text: `音视频已保存到云盘\n\n文件名：${safeName}\n[打开文件](${link})`,
    }, { replyTo: msg.messageId });
  } catch (err) {
    console.error(`[${userId}] 音视频保存失败:`, err);
    const errMsg = `保存失败: ${err instanceof Error ? err.message : String(err)}`;
    try {
      await channel.send(msg.chatId, { text: errMsg }, { replyTo: msg.messageId });
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息失败:`, sendErr);
    }
  }
}

/**
 * 处理文件消息（从 app.ts 调用）
 */
async function handleFileEvent(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string
): Promise<void> {
  const userId = msg.senderId;
  console.log(`[${userId}] 收到文件: ${fileName}`);

  const fileContext = await handleFileMessage(msg.messageId, fileName);
  const query = fileContext || `用户发送了文件 "${fileName}"，但无法读取内容。`;

  // 把文件信息当作用户消息传给 AI
  await handleMessage(channel, { ...msg, content: query, resources: [] });
}

/**
 * 处理图片消息：下载图片，转 base64 传给 AI
 */
async function handleImageMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  imageKey: string
): Promise<void> {
  const userId = msg.senderId;
  const chatId = msg.chatId;
  console.log(`[${userId}] 开始处理图片: ${imageKey}`);

  // 检查是否已初始化云盘文件夹
  if (!rootFolderToken) {
    await channel.send(chatId, {
      text: '⚠️ 云盘文件夹未初始化，无法保存图片。\n请稍后再试或联系管理员。',
    }, { replyTo: msg.messageId });
    return;
  }

  try {
    console.log(`[${userId}] 下载图片中...`);
    const buffer = await larkService.getResource(msg.messageId, imageKey, 'image');
    if (!buffer) {
      await channel.send(chatId, { text: '图片下载失败，请重新发送。' }, { replyTo: msg.messageId });
      return;
    }

    console.log(`[${userId}] 图片下载完成，大小: ${buffer.length} bytes`);

    // 自动创建文件夹并保存
    const today = getTodayDate();
    const folderToken = await getOrCreateFolder(`图片/${today}`);
    const fileName = sanitizeFileName(`image_${Date.now()}.jpg`);
    const fileToken = await larkService.uploadFile(buffer, fileName, folderToken);
    const url = `https://feishu.cn/file/${fileToken}`;

    const replyMsg = `🖼️ 图片已保存\n文件夹：智能体文件/图片/${today}\n文件：${fileName}\n大小：${(buffer.length / 1024).toFixed(1)}KB\n${url}`;
    await channel.send(chatId, { text: replyMsg }, { replyTo: msg.messageId });
  } catch (err) {
    console.error(`[${userId}] handleImageMessage failed:`, err);
    try {
      await channel.send(chatId, { text: '图片处理出错，请重新发送。' }, { replyTo: msg.messageId });
    } catch (sendErr) {
      console.error(`[${userId}] 发送错误消息也失败:`, sendErr);
    }
  }
}

/**
 * 处理二进制文件（xlsx/docx 等）：通过飞书导入 API 转换后读取内容
 */
async function handleBinaryFile(
  channel: LarkChannel,
  msg: NormalizedMessage,
  fileName: string
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

  if (!rootFolderToken) {
    await channel.send(chatId, {
      text: '未配置 DRIVE_FOLDER_TOKEN，无法导入文件。请在 .env 中设置。',
    }, { replyTo: msg.messageId });
    return;
  }

  try {
    // 1. 下载文件
    const messageData = await larkService.getMessage(msg.messageId);
    if (!messageData?.items?.[0]?.content) throw new Error('无法获取文件信息');
    const content = JSON.parse(messageData.items[0].content);
    const fileKey = content.file_key;
    if (!fileKey) throw new Error('无法获取 file_key');

    const buffer = await larkService.getResource(msg.messageId, fileKey, 'file');
    if (!buffer) throw new Error('下载文件失败');

    // 2. 上传到云盘
    const cleanName = sanitizeFileName(fileName);
    console.log(`[${userId}] 上传文件到云盘: ${cleanName}`);
    const fileToken = await larkService.uploadFile(buffer, cleanName, rootFolderToken);

    // 3. 创建导入任务
    console.log(`[${userId}] 创建导入任务: ${ext} → ${targetType}`);
    const ticket = await larkService.createImportTask(fileToken, ext, targetType, cleanName, rootFolderToken);

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
        fileContent = values.map((row: any[]) => row.join('\t')).join('\n');
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

    await handleMessage(channel, { ...msg, content: fileContent, resources: [] });
  } catch (err) {
    console.error(`[${userId}] handleBinaryFile failed:`, err);
    const errMsg = `处理文件 "${fileName}" 失败: ${err instanceof Error ? err.message : String(err)}`;
    await channel.send(chatId, { text: errMsg }, { replyTo: msg.messageId });
  }
}
