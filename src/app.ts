import * as Lark from '@larksuiteoapi/node-sdk';
import { larkService } from './lark';
import { handleMessage, handleFileEvent, handleImageMessage, handleMediaMessage, handleBinaryFile, initRootFolder } from './handler';
import { getFileExtension, getImportTargetType } from './util';

console.log('🚀 Claude 飞书助手启动中...');

// 初始化根文件夹（自动创建"机器人文件"文件夹）
initRootFolder().catch(err => {
  console.error('❌ 初始化根文件夹失败，图片/视频保存功能将不可用:', err.message);
});

// 注册事件处理器
const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': (event) => {
    (async () => {
      try {
        const userId = event.sender?.sender_id?.open_id || '';
        const chatId = event.message.chat_id || '';
        const chatType = event.message?.chat_type || 'p2p';
        const messageId = event.message?.message_id || '';
        const messageType = event.message?.message_type || '';

        if (messageType === 'text') {
          // 文本消息
          let query = '';
          try {
            query = JSON.parse(event.message.content).text?.trim() || '';
          } catch {
            query = '';
          }
          if (!query) return;
          console.log(`[${chatType}] [${userId}] ${query}`);
          await handleMessage(userId, chatId, query, chatType, messageId);

        } else if (messageType === 'file') {
          // 文件消息
          let fileName = '';
          try {
            fileName = JSON.parse(event.message.content).file_name || '未知文件';
          } catch {
            fileName = '未知文件';
          }
          console.log(`[${chatType}] [${userId}] 📎 ${fileName}`);

          const ext = getFileExtension(fileName);
          if (getImportTargetType(ext)) {
            // xlsx/xls/csv/docx/doc → 通过导入 API 转换后读取
            await handleBinaryFile(userId, chatId, chatType, messageId, fileName);
          } else {
            // 其他文件走原有逻辑
            await handleFileEvent(userId, chatId, chatType, messageId, fileName);
          }

        } else if (messageType === 'image') {
          // 图片消息
          let imageKey = '';
          try {
            imageKey = JSON.parse(event.message.content).image_key || '';
          } catch {
            imageKey = '';
          }
          if (!imageKey) return;
          console.log(`[${chatType}] [${userId}] 🖼️ image`);
          await handleImageMessage(userId, chatId, chatType, messageId, imageKey);

        } else if (messageType === 'audio' || messageType === 'video') {
          // 音视频消息：下载并保存到云盘
          let fileKey = '';
          let fileName = '';
          try {
            const content = JSON.parse(event.message.content);
            fileKey = content.file_key || '';
            fileName = content.file_name || `${messageType}_${Date.now()}`;
          } catch {
            fileName = `${messageType}_${Date.now()}`;
          }
          console.log(`[${chatType}] [${userId}] 🎬 ${fileName}`);
          if (fileKey) {
            await handleMediaMessage(userId, chatId, chatType, messageId, fileName, fileKey);
          }

        } else {
          // 其他类型
          if (chatType === 'group' && messageId) {
            await larkService.replyText(messageId, '目前支持文本、图片、文件和音视频消息');
          } else {
            await larkService.sendText(chatId, '目前支持文本、图片、文件和音视频消息');
          }
        }
      } catch (err) {
        console.error('[event handler error]', err);
      }
    })();
  },
});

// WebSocket 长连接
larkService.wsClient.start({ eventDispatcher });
console.log('✅ WebSocket 长连接已建立，等待消息...');
