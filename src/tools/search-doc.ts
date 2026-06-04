import { Tool, ToolParameter } from './tool';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * 搜索本地文件工具
 *
 * 让智能体能搜索本地保存的图片、视频、文件
 */
export class SearchDocTool extends Tool {
  name = 'search_local_files';
  description = '搜索本地保存的文件（图片、视频、文件），返回匹配的文件列表。用于查找用户之前发送的文件';
  parameters: Record<string, ToolParameter> = {
    query: {
      type: 'string',
      description: '搜索关键词（文件名或日期，如 "20260604"、"图片"、"视频"）',
    },
  };
  required = ['query'];

  private searchResults: Array<{ name: string; path: string; size: number; date: string }> = [];

  async execute(params: Record<string, any>): Promise<string> {
    const { query } = params;

    if (!query || typeof query !== 'string') {
      return '请提供搜索关键词';
    }

    try {
      const baseDir = config.imageSaveDir;
      if (!fs.existsSync(baseDir)) {
        return '本地文件目录不存在';
      }

      this.searchResults = [];

      // 递归搜索文件
      this.searchFiles(baseDir, query.toLowerCase());

      if (this.searchResults.length === 0) {
        return `未找到与"${query}"相关的文件`;
      }

      // 限制返回数量
      const limited = this.searchResults.slice(0, 20);
      const formatted = limited
        .map((file, i) => `${i + 1}. ${file.name}\n   日期: ${file.date}\n   大小: ${(file.size / 1024).toFixed(1)}KB`)
        .join('\n');

      const total = this.searchResults.length;
      const showing = limited.length;
      const prefix = total > showing ? `找到 ${total} 个文件，显示前 ${showing} 个：\n` : `找到 ${total} 个文件：\n`;

      return prefix + formatted;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return `搜索失败: ${errorMsg}`;
    }
  }

  private searchFiles(dir: string, query: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归搜索子目录
          this.searchFiles(fullPath, query);
        } else if (entry.isFile()) {
          const nameLower = entry.name.toLowerCase();
          const dirLower = dir.toLowerCase();

          // 匹配文件名或目录名（日期）
          if (nameLower.includes(query) || dirLower.includes(query)) {
            const stats = fs.statSync(fullPath);
            const dateStr = path.basename(dir); // 日期文件夹名
            this.searchResults.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              date: dateStr,
            });
          }
        }
      }
    } catch (err) {
      console.error('searchFiles error:', err);
    }
  }

  /**
   * 获取上次搜索结果
   */
  getLastResults(): Array<{ name: string; path: string; size: number; date: string }> {
    return this.searchResults;
  }
}
