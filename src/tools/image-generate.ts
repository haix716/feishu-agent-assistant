/**
 * 图片生成工具
 *
 * 让 AI 能调用图片生成功能
 * 注意：实际生成逻辑在 handler.ts 中通过 router 调用
 */

import { Tool, ToolParameter } from './tool';

export class GenerateImageTool extends Tool {
  name = 'generate_image';
  description = `根据用户上传的图片生成新图片。支持三种模式：
1. tryon - 穿戴效果图（真人模特穿着上传的服装）
2. product - 商品主图/场景图
3. cover - 小红书封面图
使用前必须先有用户上传的图片。`;

  parameters: Record<string, ToolParameter> = {
    image_description: {
      type: 'string',
      description: '图片的简要描述（用于生成提示词）',
    },
    mode: {
      type: 'string',
      description: '生成模式：tryon（穿戴）、product（商品图）、cover（封面）',
    },
    style: {
      type: 'string',
      description: '风格选项：white_bg（白底）、lifestyle（生活场景）、cute（可爱）、minimal（简约）等',
    },
    model_type: {
      type: 'string',
      description: '模特类型（穿戴模式用）：asian_female、asian_male、western_female、western_male',
    },
  };
  required = ['image_description', 'mode'];

  async execute(params: Record<string, unknown>): Promise<string> {
    const { image_description, mode, style, model_type } = params;

    // 注意：这个工具需要配合 handler 使用，因为需要图片 Buffer
    // 工具调用时，handler 会把待处理的图片传过来
    return JSON.stringify({
      status: 'pending',
      message: '请通过消息处理流程调用图片生成功能',
      params: { image_description, mode, style, model_type },
    });
  }
}
