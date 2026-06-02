/**
 * 清洗文件名：移除路径穿越、特殊字符，防止安全问题
 */
export function sanitizeFileName(name: string): string {
  if (!name || !name.trim()) return 'unnamed';
  return name
    .replace(/\.\./g, '')           // 移除 ..
    .replace(/[/\\]/g, '_')         // 路径分隔符 → 下划线
    .replace(/[<>:"|?*!@#]/g, '_')  // 特殊字符 → 下划线
    .replace(/\s+/g, '_')           // 空白 → 下划线
    .replace(/_+/g, '_')            // 合并连续下划线
    .replace(/^_+|_+$/g, '') || 'unnamed';  // 去首尾下划线，空则 fallback
}

/**
 * 验证文件大小是否在限制内
 */
export function validateFileSize(buffer: Buffer, maxSizeMB: number): boolean {
  return buffer.length <= maxSizeMB * 1024 * 1024;
}

/**
 * 获取文件扩展名（小写，不含点号）
 */
export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 根据扩展名返回飞书导入目标类型，不支持的返回 null
 */
export function getImportTargetType(ext: string): 'sheet' | 'docx' | null {
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  return null;
}

/**
 * 飞书文档链接正则：匹配 feishu.cn 域名下的 docx/doc/wiki/sheets 链接
 * 捕获组：(1) 文档类型, (2) token
 */
const FEISHU_DOC_RE =
  /https?:\/\/[a-zA-Z0-9-]+\.feishu\.cn\/(docx|doc|wiki|sheets)\/([a-zA-Z0-9_-]+)(?:[?#][^\s]*)?/g;

export interface FeishuDocLink {
  type: string;
  token: string;
}

/**
 * 从文本中提取所有飞书文档链接
 */
export function extractFeishuDocLinks(text: string): FeishuDocLink[] {
  const links: FeishuDocLink[] = [];
  for (const match of text.matchAll(FEISHU_DOC_RE)) {
    links.push({ type: match[1], token: match[2] });
  }
  return links;
}

/**
 * 解析单个飞书文档 URL，返回类型和 token
 */
export function parseWikiToken(
  url: string
): { type: string; token: string } | null {
  const match = url.match(
    /https?:\/\/[a-zA-Z0-9-]+\.feishu\.cn\/(docx|doc|wiki|sheets)\/([a-zA-Z0-9_-]+)(?:[?#][^\s]*)?/
  );
  if (!match) return null;
  return { type: match[1], token: match[2] };
}

/**
 * 生成飞书卡片消息 JSON（schema 2.0，markdown 内容）
 */
export function generateCard(content: string) {
  return {
    schema: '2.0',
    config: { update_multi: true, streaming_mode: false },
    body: {
      direction: 'vertical',
      padding: '12px 12px 12px 12px',
      elements: [
        {
          tag: 'markdown',
          content,
          text_align: 'left',
          text_size: 'normal',
          margin: '0px 0px 0px 0px',
        },
      ],
    },
  };
}

export interface FileItem {
  name: string;
  type: string;
  size: number;
  url: string;
  token: string;
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * 格式化文件列表为可读文本
 */
export function formatFileList(files: FileItem[]): string {
  if (files.length === 0) return '当前群文件夹为空';

  const shown = files.slice(0, 10);
  const lines = shown.map((f, i) => `${i + 1}. ${f.name}（${formatSize(f.size)}）`);
  let text = `共 ${files.length} 个文件：\n${lines.join('\n')}`;
  if (files.length > 10) {
    text += `\n... 等共 ${files.length} 个文件`;
  }
  return text;
}

/**
 * 从消息中解析「读文件 xxx」指令，返回文件名；不匹配返回 null
 */
export function parseFileCommand(text: string): string | null {
  // 去掉 @mention 前缀
  const cleaned = text.replace(/@_user_\d+\s*/g, '').trim();
  const match = cleaned.match(/^读文件\s*(.+)$/);
  if (!match) return null;
  const fileName = match[1].trim();
  return fileName || null;
}

/**
 * 节流函数：限制函数调用频率，保证最后一次调用不被丢弃
 * trailing-edge 模式：pending 期间的新调用会被暂存，当前调用完成后执行最新的一次
 * 所有被暂存的调用共享同一个 trailing 结果
 */
export function pThrottle<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  intervalMs: number
): T {
  let lastCall = 0;
  let pending = false;
  let latestArgs: any[] | null = null;
  let waiters: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

  return (async (...args: any[]) => {
    if (pending) {
      latestArgs = args;
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    }

    const now = Date.now();
    const elapsed = now - lastCall;
    if (elapsed < intervalMs) {
      pending = true;
      await new Promise(r => setTimeout(r, intervalMs - elapsed));
      pending = false;
    }

    lastCall = Date.now();
    const result = await fn(...args);

    // 执行 pending 期间暂存的最新调用，resolve 所有等待者
    if (latestArgs) {
      const savedArgs = latestArgs;
      const savedWaiters = waiters;
      latestArgs = null;
      waiters = [];
      try {
        // trailing 调用也要遵守间隔
        const elapsed2 = Date.now() - lastCall;
        if (elapsed2 < intervalMs) {
          await new Promise(r => setTimeout(r, intervalMs - elapsed2));
        }
        lastCall = Date.now();
        const trailingResult = await fn(...savedArgs);
        for (const w of savedWaiters) w.resolve(trailingResult);
      } catch (e) {
        for (const w of savedWaiters) w.reject(e);
      }
    }

    return result;
  }) as T;
}
