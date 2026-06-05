/**
 * 图片生成 Provider 接口
 *
 * 所有生图服务（Replicate、即梦等）都实现这个接口
 */

/** 图片内容类型 */
export type ContentType = 'clothing' | 'product' | 'accessory' | 'other';

/** 生成模式 */
export type GenerateMode = 'tryon' | 'product' | 'cover';

/** 图片分析结果 */
export interface ImageAnalysis {
  contentType: ContentType;
  category: string;           // 具体品类：T恤、保温杯、项链
  attributes: {
    color: string;            // 主要颜色
    material: string;         // 材质
    style: string;            // 风格：简约、复古、可爱
    brand?: string;           // 品牌（如果能识别）
  };
  suggestedPrompt: string;    // 自动生成的英文提示词
  suggestedMode: GenerateMode; // 建议的生成模式
}

/** 生成参数 */
export interface GenerateParams {
  referenceImage: Buffer;     // 参考图（用户上传的原图）
  prompt: string;             // 英文提示词
  negativePrompt?: string;    // 反向提示词
  mode: GenerateMode;
  options?: {
    modelType?: string;       // 模特类型（穿戴用）：asian_female, asian_male, western_female, western_male
    aspectRatio?: string;     // 宽高比（封面用）：1:1, 3:4, 16:9
    style?: string;           // 风格（场景图用）：studio, lifestyle, artistic
    numImages?: number;       // 生成数量（默认 1）
  };
}

/** 生成结果 */
export interface GenerateResult {
  images: Buffer[];           // 生成的图片
  revisedPrompt?: string;     // API 修改后的提示词
  cost?: number;              // 本次花费（美元）
  model?: string;             // 使用的模型名
}

/** 图片生成 Provider 抽象接口 */
export interface ImageProvider {
  name: string;

  /** 是否支持指定的生成模式 */
  supports(mode: GenerateMode): boolean;

  /** 生成图片 */
  generateImage(params: GenerateParams): Promise<GenerateResult>;
}
