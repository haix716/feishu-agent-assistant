/**
 * ComfyUI 集成模块
 *
 * 通过 @saintno/comfyui-sdk 连接本地 ComfyUI 服务器
 * 用于详情图套件的图片生成、调色、校验
 */

import { ComfyApi } from '@saintno/comfyui-sdk';
import path from 'path';
import fs from 'fs';

// 配置
const COMFYUI_HOST = process.env.COMFYUI_HOST || 'http://127.0.0.1:8188';
const WORKFLOW_DIR = path.join(__dirname, 'workflows');

// 全局客户端（单例）
let comfyApi: ComfyApi | null = null;

/**
 * 获取 ComfyUI 客户端
 */
export function getComfyApi(): ComfyApi {
  if (!comfyApi) {
    comfyApi = new ComfyApi(COMFYUI_HOST);
  }
  return comfyApi;
}

/**
 * 等待 ComfyUI 就绪
 */
export async function waitForComfyReady(): Promise<ComfyApi> {
  const api = getComfyApi();
  await api.init(5, 2000).waitForReady();
  return api;
}

/**
 * 检查 ComfyUI 是否可用
 */
export async function isComfyAvailable(): Promise<boolean> {
  try {
    const api = getComfyApi();
    await api.init(3, 1000).waitForReady();
    return true;
  } catch {
    return false;
  }
}

/**
 * 上传图片到 ComfyUI
 */
export async function uploadImage(
  buffer: Buffer,
  fileName: string
): Promise<{ filename: string; subfolder: string; type: string }> {
  const api = await waitForComfyReady();
  const result = await api.uploadImage(buffer, fileName);
  if (!result) {
    throw new Error('图片上传失败');
  }
  return result.info;
}

/**
 * 下载 ComfyUI 生成的图片
 */
export async function downloadImage(imageInfo: {
  filename: string;
  subfolder: string;
  type: string;
}): Promise<Buffer> {
  const api = await waitForComfyReady();
  const blob = await api.getImage(imageInfo);
  return Buffer.from(await blob.arrayBuffer());
}

/**
 * 加载工作流 JSON
 */
export function loadWorkflow(name: string): Record<string, Record<string, unknown>> {
  const filePath = path.join(WORKFLOW_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`工作流文件不存在: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * 等待 ComfyUI 任务完成并返回结果图片
 */
function waitForResult(promptId: string): Promise<Array<{ filename: string; subfolder: string; type: string }>> {
  return new Promise((resolve, reject) => {
    const api = getComfyApi();
    const timeout = setTimeout(() => reject(new Error('ComfyUI 任务超时（5分钟）')), 300000);

    const checkHistory = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const history = await api.getHistory(promptId) as any;
        if (history && history[promptId]) {
          const outputs = history[promptId].outputs || {};
          const allImages: Array<{ filename: string; subfolder: string; type: string }> = [];
          for (const nodeOutput of Object.values(outputs) as Array<{ images?: Array<{ filename: string; subfolder: string; type: string }> }>) {
            if (nodeOutput.images) {
              allImages.push(...nodeOutput.images);
            }
          }
          if (allImages.length > 0) {
            clearTimeout(timeout);
            resolve(allImages);
            return;
          }
        }
        // 还没完成，1 秒后再查
        setTimeout(checkHistory, 1000);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    };

    // 开始轮询
    setTimeout(checkHistory, 2000);
  });
}

/**
 * 通用图片生成接口
 *
 * @param workflowName 工作流名称（对应 workflows/ 目录下的 JSON 文件）
 * @param inputs 输入参数（会覆盖工作流中的默认值）
 * @returns 生成的图片 Buffer 数组
 */
export async function generate(
  workflowName: string,
  inputs: Record<string, unknown>
): Promise<Buffer[]> {
  const api = await waitForComfyReady();
  const workflow = loadWorkflow(workflowName);

  // 将 inputs 应用到工作流中
  // inputs 的 key 格式为 "nodeId.inputName"，如 "6.text"
  for (const [key, value] of Object.entries(inputs)) {
    const dotIndex = key.indexOf('.');
    if (dotIndex > 0) {
      const nodeId = key.slice(0, dotIndex);
      const inputName = key.slice(dotIndex + 1);
      const node = workflow[nodeId];
      if (node && node.inputs) {
        (node.inputs as Record<string, unknown>)[inputName] = value;
      }
    }
  }

  // 提交工作流
  const result = await api.queuePrompt(null, workflow);
  if (!result || !result.prompt_id) {
    throw new Error('ComfyUI 工作流提交失败');
  }

  console.log(`[ComfyUI] 工作流已提交: ${result.prompt_id}`);

  // 等待结果
  const imageInfos = await waitForResult(result.prompt_id);

  // 下载所有图片
  const images: Buffer[] = [];
  for (const img of imageInfos) {
    const buffer = await downloadImage(img);
    images.push(buffer);
  }

  return images;
}

/**
 * 清理资源
 */
export function destroy(): void {
  if (comfyApi) {
    comfyApi.destroy();
    comfyApi = null;
  }
}
