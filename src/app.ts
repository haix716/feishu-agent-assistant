import express from 'express';
import * as Lark from '@larksuiteoapi/node-sdk';
import { config } from './config';
import { larkService } from './lark';
import { handleMessage } from './handler';

console.log('🚀 Claude 飞书助手启动中...');

// 注册事件处理器
const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': (event) => {
    (async () => {
      const userId = event.sender?.sender_id?.open_id || '';
      const chatId = event.message.chat_id || '';
      const messageType = event.message?.message_type || '';

      // 只处理文本消息
      if (messageType !== 'text') {
        await larkService.sendText(chatId, '请发送文本消息');
        return;
      }

      let query = '';
      try {
        query = JSON.parse(event.message.content).text?.trim() || '';
      } catch {
        query = '';
      }

      if (!query) return;

      console.log(`[${userId}] ${query}`);
      await handleMessage(userId, chatId, query);
    })();
  },
});

// Express（为后续 webhook 模式预留）
const app = express();
app.listen(config.port, () => {
  console.log(`📡 HTTP 服务已启动: http://localhost:${config.port}`);
});

// WebSocket 长连接
larkService.wsClient.start({ eventDispatcher });
console.log('✅ WebSocket 长连接已建立，等待消息...');
