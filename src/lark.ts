import { Client, WSClient } from '@larksuiteoapi/node-sdk';
import { config } from './config';
import { generateCard } from './util';

class LarkService {
  client: Client;
  wsClient: WSClient;

  constructor() {
    const opts = {
      appId: config.lark.appId,
      appSecret: config.lark.appSecret,
      domain: config.lark.domain,
    };
    this.client = new Client(opts);
    this.wsClient = new WSClient(opts);
  }

  /** 发送卡片消息，返回 messageId */
  async sendCard(chatId: string, content: string): Promise<string> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(generateCard(content)),
      },
    });
    if (resp.code !== 0) {
      throw new Error(`sendCard failed: ${resp.msg}`);
    }
    return resp.data?.message_id || '';
  }

  /** 更新已有卡片消息 */
  async updateCard(messageId: string, content: string): Promise<void> {
    const resp = await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(generateCard(content)) },
    });
    if (resp.code !== 0) {
      console.error(`updateCard failed: ${resp.msg}`);
    }
  }

  /** 发送纯文本消息 */
  async sendText(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }
}

export const larkService = new LarkService();
