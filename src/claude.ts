import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';

const client = new Anthropic({ apiKey: config.claude.apiKey });

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 调用 Claude API，返回流式响应的完整文本
 * 使用 callback 模式，每收到一块文本就回调
 */
export async function streamClaude(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  systemPrompt?: string
): Promise<string> {
  const stream = client.messages.stream({
    model: config.claude.model,
    max_tokens: 4096,
    system: systemPrompt || '你是 Claude，一个由 Anthropic 开发的 AI 助手。请用中文回复。',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      onChunk(fullText);
    }
  }

  return fullText;
}
