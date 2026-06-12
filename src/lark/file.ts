import axios from "axios";
import { larkClient } from "./client";
import { config } from "../config";
import type { FileItem } from "../util";

/** 获取消息中的资源（文件或图片） */
export async function getResource(
  messageId: string,
  fileKey: string,
  type: "file" | "image" = "file",
): Promise<Buffer | null> {
  console.log(
    `[getResource] 开始下载: messageId=${messageId}, fileKey=${fileKey}, type=${type}`,
  );
  try {
    // 获取 tenant_access_token
    const tokenResp = await axios.post(
      `${config.lark.domain}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        app_id: config.lark.appId,
        app_secret: config.lark.appSecret,
      },
    );
    const accessToken = tokenResp.data.tenant_access_token;

    // 使用 axios 直接调用飞书 API
    const url = `${config.lark.domain}/open-apis/im/v1/messages/${messageId}/resources/${fileKey}`;
    const resp = await axios.get(url, {
      params: { type },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: "arraybuffer",
      validateStatus: () => true, // 不抛出异常
    });

    console.log(
      `[getResource] 响应状态: ${resp.status}, 大小: ${resp.data?.length || 0} bytes`,
    );

    if (resp.status === 200 && resp.data) {
      return Buffer.from(resp.data);
    }

    // 打印详细错误信息
    if (resp.status !== 200) {
      const errorData = Buffer.from(resp.data).toString("utf-8");
      console.error(
        `[getResource] 下载失败: status=${resp.status}, response=${errorData}`,
      );
    }
  } catch (err) {
    console.error("[getResource] 下载失败:", err);
  }
  return null;
}

/** 创建导入任务，返回 ticket */
export async function createImportTask(
  fileToken: string,
  fileExtension: string,
  type: string,
  fileName: string,
  folderToken: string,
): Promise<string> {
  const resp = await (larkClient as any).drive.v1.importTask.create({
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
export async function pollImportTask(
  ticket: string,
): Promise<{ token: string; type: string } | null> {
  const resp = await (larkClient as any).drive.v1.importTask.get({
    path: { ticket },
  });
  if (resp.code !== 0) {
    console.error("pollImportTask failed:", resp.msg);
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
export async function getSheetValues(
  spreadsheetToken: string,
  range: string,
): Promise<any[][] | null> {
  try {
    const resp = await (larkClient as any).request({
      method: "GET",
      url: `${config.lark.domain}/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${range}`,
      params: {
        valueRenderOption: "ToString",
      },
    });
    if (resp.code !== 0) {
      console.error("getSheetValues failed:", resp.msg);
      return null;
    }
    return resp.data?.valueRange?.values || null;
  } catch (err) {
    console.error("getSheetValues failed:", err);
    return null;
  }
}

/** 获取消息详情（用于获取文件信息） */
export async function getMessage(messageId: string): Promise<any | null> {
  try {
    const resp = await larkClient.im.message.get({
      path: { message_id: messageId },
    });
    if (resp.code === 0) {
      return resp.data;
    }
  } catch (err) {
    console.error("getMessage failed:", err);
  }
  return null;
}

/** 上传文件到飞书云盘，返回 file_token */
export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  parentToken: string,
): Promise<string> {
  const resp = await (larkClient as any).drive.v1.file.uploadAll({
    data: {
      file_name: fileName,
      parent_type: "explorer",
      parent_node: parentToken,
      size: buffer.length,
      file: buffer,
    },
  });

  // 响应格式可能是 { code, msg, data: { file_token } } 或直接 { file_token, url }
  if (!resp) {
    throw new Error("uploadFile failed: no response");
  }

  // 直接返回 file_token（兼容两种响应格式）
  const fileToken = resp.file_token || resp.data?.file_token;
  if (!fileToken) {
    throw new Error(`uploadFile failed: ${resp.msg || "no file_token"}`);
  }

  return fileToken;
}

/** 创建文件夹，返回 folder_token */
export async function createFolder(name: string, parentToken?: string): Promise<string> {
  const data: any = { name };
  if (parentToken) {
    data.folder_token = parentToken;
  }

  const resp = await (larkClient as any).drive.v1.file.createFolder({
    data,
  });
  if (!resp || resp.code !== 0) {
    throw new Error(`createFolder failed: ${resp?.msg || "no response"}`);
  }
  return resp.data?.token || "";
}

/** 获取根文件夹 token（通过列出根目录） */
export async function getRootFolder(): Promise<string> {
  // 列出根目录文件，第一个文件的 parent_token 就是根文件夹 token
  const resp = await (larkClient as any).drive.v1.file.list({
    params: { page_size: 1 },
  });
  if (!resp || resp.code !== 0) {
    throw new Error(`getRootFolder failed: ${resp?.msg || "no response"}`);
  }

  // 从第一个文件的 parent_token 获取根文件夹 token
  const files = resp.data?.files || [];
  if (files.length > 0 && files[0].parent_token) {
    return files[0].parent_token;
  }

  // 如果没有文件，尝试获取根目录信息
  throw new Error("无法获取根文件夹 token，请手动配置 DRIVE_FOLDER_TOKEN");
}

/** 获取云文档原始内容（docx 类型） */
export async function getDocContent(documentId: string): Promise<string | null> {
  try {
    const resp = await (larkClient as any).docx.document.rawContent({
      path: { document_id: documentId },
    });
    if (resp.code === 0 && resp.data?.content) {
      return resp.data.content;
    }
  } catch (err) {
    console.error("getDocContent failed:", err);
  }
  return null;
}

/** 获取知识库节点信息（wiki 类型），返回 obj_token 和 obj_type */
export async function getWikiNode(
  token: string,
): Promise<{ obj_token: string; obj_type: string } | null> {
  try {
    const resp = await (larkClient as any).wiki.space.getNode({
      params: { token },
    });
    if (resp.code === 0 && resp.data?.node) {
      return {
        obj_token: resp.data.node.obj_token,
        obj_type: resp.data.node.obj_type,
      };
    }
  } catch (err) {
    console.error("getWikiNode failed:", err);
  }
  return null;
}

/** 列出群文件（通过 IM 群文件 API） */
export async function listFiles(chatId: string): Promise<FileItem[]> {
  try {
    const resp = await (larkClient as any).im.v1.chat.file.list({
      path: { chat_id: chatId },
      params: { page_size: 50 },
    });
    if (resp.code !== 0) {
      console.error(`listFiles failed: ${resp.msg}`);
      return [];
    }
    const files = (resp.data as any)?.items || [];
    return files.map((f: any) => ({
      name: f.name || "未知文件",
      type: f.type || "file",
      size: f.size || 0,
      url: f.url || "",
      token: f.file_key || f.token || "",
    }));
  } catch (err) {
    console.error("listFiles failed:", err);
    return [];
  }
}

/** 列出文件夹下的子文件夹 */
export async function listFolders(
  parentToken: string,
): Promise<Array<{ token: string; name: string }>> {
  try {
    const resp = await (larkClient as any).drive.v1.file.listByFolder({
      params: {
        folder_token: parentToken,
        page_size: 200,
      },
    });
    if (resp.code !== 0) {
      console.error(`listFolders failed: ${resp.msg}`);
      return [];
    }
    const files = resp.data?.files || [];
    return files
      .filter((f: any) => f.type === "folder")
      .map((f: any) => ({ token: f.token, name: f.name }));
  } catch (err) {
    console.error("listFolders failed:", err);
    return [];
  }
}

/** 列出文件夹下的所有文件（用于判断是否为空） */
export async function listFolderContents(folderToken: string): Promise<number> {
  try {
    const resp = await (larkClient as any).drive.v1.file.listByFolder({
      params: {
        folder_token: folderToken,
        page_size: 1,
      },
    });
    if (resp.code !== 0) {
      console.error(`listFolderContents failed: ${resp.msg}`);
      return -1;
    }
    return (resp.data?.files || []).length;
  } catch (err) {
    console.error("listFolderContents failed:", err);
    return -1;
  }
}

/** 删除云盘文件/文件夹 */
export async function deleteFile(
  fileToken: string,
  fileType: string = "folder",
): Promise<boolean> {
  try {
    const resp = await (larkClient as any).drive.v1.file.delete({
      path: { file_token: fileToken },
      params: { type: fileType },
    });
    if (resp.code !== 0) {
      console.error(`deleteFile failed: ${resp.msg}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("deleteFile failed:", err);
    return false;
  }
}

/** 下载云空间文件，返回 Buffer */
export async function downloadFile(fileToken: string): Promise<Buffer | null> {
  try {
    const resp = await larkClient.drive.file.download({
      path: { file_token: fileToken },
    });
    if (resp && typeof resp === "object" && "pipe" in resp) {
      const chunks: Buffer[] = [];
      for await (const chunk of resp as any) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    }
  } catch (err) {
    console.error("downloadFile failed:", err);
  }
  return null;
}

/** 使用用户身份上传文件到飞书云盘 */
export async function uploadFileWithUserToken(
  userAccessToken: string,
  buffer: Buffer,
  fileName: string,
  parentToken: string,
): Promise<string> {
  const formData = new FormData();
  formData.append("file_name", fileName);
  formData.append("parent_type", "explorer");
  formData.append("parent_node", parentToken);
  formData.append("size", buffer.length.toString());
  formData.append("file", new Blob([new Uint8Array(buffer)]), fileName);

  console.log(
    `[upload] 上传文件: ${fileName}, 大小: ${buffer.length}, 目标文件夹: ${parentToken}`,
  );

  const resp = await axios.post(
    `${config.lark.domain}/open-apis/drive/v1/files/upload_all`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    },
  );

  console.log(`[upload] 响应:`, JSON.stringify(resp.data));

  if (resp.data.code !== 0) {
    throw new Error(
      `uploadFile failed: code=${resp.data.code}, msg=${resp.data.msg}`,
    );
  }
  return resp.data.data?.file_token || "";
}

/** 使用用户身份创建文件夹 */
export async function createFolderWithUserToken(
  userAccessToken: string,
  name: string,
  parentToken?: string,
): Promise<string> {
  const data = {
    name,
    folder_token: parentToken || "", // 必填，空字符串表示根目录
  };

  console.log(
    `[folder] 创建文件夹: ${name}, 父文件夹: ${parentToken || "根目录"}`,
  );

  const resp = await axios.post(
    `${config.lark.domain}/open-apis/drive/v1/files/create_folder`,
    data,
    {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );

  console.log(`[folder] 响应:`, JSON.stringify(resp.data));

  if (resp.data.code !== 0) {
    throw new Error(
      `createFolder failed: code=${resp.data.code}, msg=${resp.data.msg}`,
    );
  }
  return resp.data.data?.token || "";
}
