import type { ImageAnalysis } from "../../image-gen";

/** 每用户待保存的图片 */
export const pendingImages = new Map<string, { buffer: Buffer; fileName: string }>();

/** 每用户待处理的图片（已保存，等待用户决定是否生成） */
export const pendingImageEdit = new Map<
  string,
  {
    buffer: Buffer;
    analysis: ImageAnalysis | null;
    savedPath: string;
    fileName: string;
    dateFolder: string;
  }
>();

/** 每用户待发布的小红书内容 */
export const pendingXhsPublish = new Map<
  string,
  {
    title: string;
    content: string;
    tags: string[];
    images: Buffer[];
  }
>();

/**
 * 用正则匹配用户对图片的意图
 */
export function parseImageIntent(query: string): {
  action: string;
  folder: string;
  fileName: string;
} {
  const saveMatch = query.match(/(?:保存|存到|放到|存入|存到)\s*(.*)/);
  if (saveMatch) {
    const folder = saveMatch[1]?.trim() || "未整理";
    return { action: "save", folder, fileName: `image_${Date.now()}` };
  }

  if (query.match(/不要|删除|取消|丢掉|扔掉/)) {
    return { action: "discard", folder: "", fileName: "" };
  }

  return { action: "chat", folder: "", fileName: "" };
}
