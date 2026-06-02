import { Client, WSClient } from '@larksuiteoapi/node-sdk';
import { config } from './config';
import { generateCard, FileItem } from './util';

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

      // SDK 返回的是一个对象，包含 getReadableStream 方法
      if (resp && typeof resp === 'object' && 'getReadableStream' in resp) {
        const stream = (resp as any).getReadableStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        return Buffer.concat(chunks);
      }

      // 兼容旧版 SDK：直接是 pipe 方法
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

  /** 创建导入任务，返回 ticket */
  async createImportTask(
    fileToken: string,
    fileExtension: string,
    type: string,
    fileName: string,
    folderToken: string
  ): Promise<string> {
    const resp = await (this.client as any).drive.v1.importTask.create({
      data: {
        file_extension: fileExtension,
        file_token: fileToken,
        type,
        file_name: fileName,
        point: {
          mount_type: 1,
          mount_key: folderToken,
        },
      },
    });
    if (resp.code !== 0 || !resp.data?.ticket) {
      throw new Error(`createImportTask failed: ${resp.msg}`);
    }
    return resp.data.ticket;
  }

  /** 轮询导入任务结果，返回 {token, type} 或 null */
  async pollImportTask(ticket: string): Promise<{ token: string; type: string } | null> {
    const resp = await (this.client as any).drive.v1.importTask.get({
      path: { ticket },
    });
    if (resp.code !== 0) {
      console.error('pollImportTask failed:', resp.msg);
      return null;
    }
    const result = resp.data?.result;
    if (!result) return null;
    // job_status: 0=初始化, 1=处理中, 2=成功, 3=失败
    if (result.job_status === 2 && result.token) {
      return { token: result.token, type: result.type };
    }
    if (result.job_status === 3) {
      throw new Error(`import task failed: ${result.job_error_msg}`);
    }
    return null; // still processing
  }

  /** 读取电子表格内容 */
  async getSheetValues(spreadsheetToken: string, range: string): Promise<any[][] | null> {
    try {
      const resp = await (this.client as any).request({
        method: 'GET',
        url: `${config.lark.domain}/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${range}`,
        params: {
          valueRenderOption: 'ToString',
        },
      });
      if (resp.code !== 0) {
        console.error('getSheetValues failed:', resp.msg);
        return null;
      }
      return resp.data?.valueRange?.values || null;
    } catch (err) {
      console.error('getSheetValues failed:', err);
      return null;
    }
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
    const resp = await (this.client as any).drive.v1.file.uploadAll({
      data: {
        file_name: fileName,
        parent_type: 'explorer',
        parent_node: parentToken,
        size: buffer.length,
        file: buffer,
      },
    });

    // 响应格式可能是 { code, msg, data: { file_token } } 或直接 { file_token, url }
    if (!resp) {
      throw new Error('uploadFile failed: no response');
    }

    // 直接返回 file_token（兼容两种响应格式）
    const fileToken = resp.file_token || resp.data?.file_token;
    if (!fileToken) {
      throw new Error(`uploadFile failed: ${resp.msg || 'no file_token'}`);
    }

    return fileToken;
  }

  /** 创建文件夹，返回 folder_token */
  async createFolder(name: string, parentToken?: string): Promise<string> {
    const data: any = { name };
    if (parentToken) {
      data.folder_token = parentToken;
    }

    const resp = await (this.client as any).drive.v1.file.createFolder({ data });
    if (!resp || resp.code !== 0) {
      throw new Error(`createFolder failed: ${resp?.msg || 'no response'}`);
    }
    return resp.data?.token || '';
  }

  /** 获取根文件夹 token（通过列出根目录） */
  async getRootFolder(): Promise<string> {
    // 列出根目录文件，第一个文件的 parent_token 就是根文件夹 token
    const resp = await (this.client as any).drive.v1.file.list({
      params: { page_size: 1 },
    });
    if (!resp || resp.code !== 0) {
      throw new Error(`getRootFolder failed: ${resp?.msg || 'no response'}`);
    }

    // 从第一个文件的 parent_token 获取根文件夹 token
    const files = resp.data?.files || [];
    if (files.length > 0 && files[0].parent_token) {
      return files[0].parent_token;
    }

    // 如果没有文件，尝试获取根目录信息
    throw new Error('无法获取根文件夹 token，请手动配置 DRIVE_FOLDER_TOKEN');
  }

  /** 获取云文档原始内容（docx 类型） */
  async getDocContent(documentId: string): Promise<string | null> {
    try {
      const resp = await (this.client as any).docx.document.rawContent({
        path: { document_id: documentId },
      });
      if (resp.code === 0 && resp.data?.content) {
        return resp.data.content;
      }
    } catch (err) {
      console.error('getDocContent failed:', err);
    }
    return null;
  }

  /** 获取知识库节点信息（wiki 类型），返回 obj_token 和 obj_type */
  async getWikiNode(
    token: string
  ): Promise<{ obj_token: string; obj_type: string } | null> {
    try {
      const resp = await (this.client as any).wiki.space.getNode({
        params: { token },
      });
      if (resp.code === 0 && resp.data?.node) {
        return {
          obj_token: resp.data.node.obj_token,
          obj_type: resp.data.node.obj_type,
        };
      }
    } catch (err) {
      console.error('getWikiNode failed:', err);
    }
    return null;
  }

  /** 列出群文件夹中的文件 */
  async listFiles(folderToken?: string): Promise<FileItem[]> {
    try {
      const params: any = { page_size: 50 };
      if (folderToken) params.folder_token = folderToken;

      const resp = await this.client.drive.file.list({ params });
      if (resp.code !== 0) {
        console.error(`listFiles failed: ${resp.msg}`);
        return [];
      }
      const files = (resp.data as any)?.items || (resp.data as any)?.files || [];
      return files.map((f: any) => ({
        name: f.name || '未知文件',
        type: f.type || 'file',
        size: f.size || 0,
        url: f.url || '',
        token: f.token || '',
      }));
    } catch (err) {
      console.error('listFiles failed:', err);
      return [];
    }
  }

  /** 下载云空间文件，返回 Buffer */
  async downloadFile(fileToken: string): Promise<Buffer | null> {
    try {
      const resp = await this.client.drive.file.download({
        path: { file_token: fileToken },
      });
      if (resp && typeof resp === 'object' && 'pipe' in resp) {
        const chunks: Buffer[] = [];
        for await (const chunk of resp as any) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        return Buffer.concat(chunks);
      }
    } catch (err) {
      console.error('downloadFile failed:', err);
    }
    return null;
  }
}


export const larkService = new LarkService();
