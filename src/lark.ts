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

  /** 回复卡片消息（群聊用，引用原消息），返回 messageId */
  async replyCard(messageId: string, content: string): Promise<string> {
    const resp = await this.client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(generateCard(content)),
      },
    });
    if (resp.code !== 0) {
      throw new Error(`replyCard failed: ${resp.msg}`);
    }
    return resp.data?.message_id || '';
  }

  /** 回复纯文本消息（群聊用，引用原消息） */
  async replyText(messageId: string, text: string): Promise<void> {
    await this.client.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  /** 获取用户信息（昵称、头像） */
  async getUserInfo(userId: string): Promise<{ name: string; avatar: string } | null> {
    try {
      const resp = await this.client.contact.user.get({
        path: { user_id: userId },
        params: { user_id_type: 'open_id' },
      });
      if (resp.code === 0 && resp.data?.user) {
        return {
          name: resp.data.user.name || '未知用户',
          avatar: resp.data.user.avatar?.avatar_72 || '',
        };
      }
    } catch (err) {
      console.error('getUserInfo failed:', err);
    }
    return null;
  }

  /** 获取群信息（群名） */
  async getChatInfo(chatId: string): Promise<{ name: string } | null> {
    try {
      const resp = await this.client.im.chat.get({
        path: { chat_id: chatId },
      });
      if (resp.code === 0 && resp.data) {
        return { name: resp.data.name || '未命名群' };
      }
    } catch (err) {
      console.error('getChatInfo failed:', err);
    }
    return null;
  }

  /** 从群成员列表获取用户在群里的名字（nickname） */
  async getChatMemberName(chatId: string, userId: string): Promise<string | null> {
    try {
      const resp = await this.client.im.chatMembers.get({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id' as const },
      });
      if (resp.code === 0 && resp.data?.items) {
        const member = resp.data.items.find((m: any) => m.member_id === userId);
        if (member?.name) return member.name;
      }
    } catch (err) {
      console.error('getChatMemberName failed:', err);
    }
    return null;
  }

  /** 获取消息中的资源（文件或图片） */
  async getResource(
    messageId: string,
    fileKey: string,
    type: 'file' | 'image' = 'file'
  ): Promise<Buffer | null> {
    try {
      const resp = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      // SDK 返回的是文件流，需要转为 Buffer
      if (resp && typeof resp === 'object' && 'pipe' in resp) {
        const chunks: Buffer[] = [];
        for await (const chunk of resp as any) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        return Buffer.concat(chunks);
      }
    } catch (err) {
      console.error('getResource failed:', err);
    }
    return null;
  }

  /** 获取消息详情（用于获取文件信息） */
  async getMessage(messageId: string): Promise<any | null> {
    try {
      const resp = await this.client.im.message.get({
        path: { message_id: messageId },
      });
      if (resp.code === 0) {
        return resp.data;
      }
    } catch (err) {
      console.error('getMessage failed:', err);
    }
    return null;
  }

  /** 上传文件到飞书云盘，返回 file_token */
  async uploadFile(buffer: Buffer, fileName: string, parentToken: string): Promise<string> {
    const resp = await this.client.drive.v1.file.uploadAll({
      data: {
        file_name: fileName,
        parent_type: 'explorer',
        parent_node: parentToken,
        size: buffer.length,
        file: buffer,
      },
    });
    if (resp.code !== 0) {
      throw new Error(`uploadFile failed: ${resp.msg}`);
    }
    return resp.data?.file_token || '';
  }
}


export const larkService = new LarkService();
