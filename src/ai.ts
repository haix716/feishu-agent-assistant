import OpenAI from 'openai';
import { config } from './config';

const openai = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  userName?: string;
  chatName?: string;
  chatType?: string;
}

export async function streamAI(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  ctx?: ChatContext,
): Promise<string> {
  const systemParts = [config.systemPrompt];
  if (ctx?.userName) systemParts.push(`用户名称：${ctx.userName}`);
  if (ctx?.chatName) systemParts.push(`群聊名称：${ctx.chatName}`);
  if (ctx?.chatType === 'group') systemParts.push('当前在群聊中，请简洁回复。');
  const systemPrompt = systemParts.join('\n');

  const openaiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const stream = await openai.chat.completions.create({
    model: config.ai.model,
    messages: openaiMessages,
    stream: true,
    max_tokens: 4096,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(fullText);
    }
  }
  return fullText;
}

export async function analyzeImage(base64Image: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.mimoImageModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '请用中文描述这张图片的内容，100字以内。' },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64Image}` },
        },
      ],
    }],
    max_tokens: 300,
  });
  return response.choices[0]?.message?.content || '';
}
