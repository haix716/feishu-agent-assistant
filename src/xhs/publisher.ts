/**
 * 小红书发布器
 *
 * 使用 Playwright 浏览器自动化发布笔记到小红书
 * 流程：登录（Cookie）→ 创建笔记 → 上传图片 → 填写内容 → 发布
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Cookie 存储路径 */
const COOKIE_DIR = path.join(os.homedir(), '.xiaohongshu');
const COOKIE_FILE = path.join(COOKIE_DIR, 'cookies.json');

/** 发布参数 */
export interface PublishParams {
  title: string;
  content: string;
  images: Buffer[];           // 图片 buffer 列表（最多 18 张）
  tags?: string[];            // 话题标签
  location?: string;          // 地点
}

/** 发布结果 */
export interface PublishResult {
  success: boolean;
  noteId?: string;
  noteUrl?: string;
  error?: string;
}

/**
 * 小红书发布器
 */
export class XhsPublisher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  /**
   * 初始化浏览器
   */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: false, // 需要可见窗口用于扫码登录
      args: ['--lang=zh-CN'],
    });

    // 尝试加载已保存的 Cookie
    const cookies = this.loadCookies();
    console.log(`[XHS] 加载 ${cookies.length} 个 Cookie`);
    const contextOptions: any = {
      locale: 'zh-CN',
    };

    if (cookies.length > 0) {
      contextOptions.storageState = { cookies, origins: [] };
    }

    // 启用录屏功能
    const videoDir = path.join(os.tmpdir(), 'xhs-recordings');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    contextOptions.recordVideo = {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    };

    this.context = await this.browser.newContext(contextOptions);
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.context) {
      // 获取录屏文件路径
      const pages = this.context.pages();
      if (pages.length > 0) {
        const page = pages[0];
        const video = page.video();
        if (video) {
          const videoPath = await video.path();
          console.log(`[XHS] 录屏文件: ${videoPath}`);
        }
      }
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 检查是否已登录
   */
  async isLoggedIn(): Promise<boolean> {
    if (!this.context) await this.init();

    const page = await this.context!.newPage();
    try {
      console.log('[XHS] 检查登录状态...');
      await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'networkidle',
        timeout: 15000,
      });

      // 如果跳转到登录页，说明未登录
      const url = page.url();
      console.log('[XHS] 当前页面:', url);
      if (url.includes('login') || url.includes('passport')) {
        console.log('[XHS] 未登录（跳转到登录页）');
        return false;
      }

      console.log('[XHS] 已登录');
      return true;
    } catch (err) {
      console.error('[XHS] 检查登录状态失败:', err);
      return false;
    } finally {
      await page.close();
    }
  }

  /**
   * 扫码登录（需要用户手动扫码）
   */
  async login(): Promise<{ success: boolean; qrCodeUrl?: string; error?: string }> {
    if (!this.context) await this.init();

    const page = await this.context!.newPage();
    try {
      // 打开小红书创作者中心登录页
      console.log('[XHS] 打开登录页...');
      await page.goto('https://creator.xiaohongshu.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // 等待二维码出现
      await page.waitForTimeout(3000);

      // 尝试获取二维码图片
      const qrImg = await page.$('img.qrcode-img, img[class*="qrcode"], canvas[class*="qr"]');
      let qrCodeUrl: string | undefined;

      if (qrImg) {
        qrCodeUrl = await qrImg.getAttribute('src') || undefined;
        console.log('[XHS] 二维码已显示');
      } else {
        console.log('[XHS] 未找到二维码元素');
      }

      // 等待用户扫码完成（最多 120 秒）
      console.log('[XHS] 等待扫码登录...（120秒超时）');

      // 轮询检查登录状态（每2秒检查一次）
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(2000);

        const url = page.url();
        console.log(`[XHS] 检查登录状态 (${i + 1}/60), 当前URL: ${url}`);

        // 如果不在登录页了，说明登录成功
        if (!url.includes('login') && !url.includes('passport')) {
          console.log('[XHS] 登录成功！');

          // 保存 Cookie
          const cookies = await this.context!.cookies();
          this.saveCookies(cookies);

          return { success: true };
        }

        // 检查是否有登录成功的迹象（如页面内容变化）
        try {
          const isLoggedIn = await page.evaluate(() => {
            // 检查是否有创作者中心的元素
            return !!document.querySelector('[class*="publish"], [class*="creator"], [class*="dashboard"]');
          });
          if (isLoggedIn) {
            console.log('[XHS] 检测到创作者中心元素，登录成功！');
            const cookies = await this.context!.cookies();
            this.saveCookies(cookies);
            return { success: true };
          }
        } catch { /* ignore */ }
      }

      return {
        success: false,
        qrCodeUrl,
        error: '扫码超时（120秒），请确认已扫码并点击确认登录',
      };
    } catch (err) {
      return {
        success: false,
        error: `登录失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * 发布笔记
   */
  async publish(params: PublishParams): Promise<PublishResult> {
    if (!this.context) await this.init();

    const page = await this.context!.newPage();
    try {
      console.log('[XHS] 打开发布页面...');
      await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 等待页面加载
      await page.waitForTimeout(3000);

      // 保存截图用于调试
      const screenshotDir = path.join(os.tmpdir(), 'xhs-debug');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const screenshotPath = path.join(screenshotDir, `publish-page-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`[XHS] 页面截图已保存: ${screenshotPath}`);

      // 关闭可能弹出的地理位置弹窗或下拉菜单
      try {
        await page.evaluate(() => {
          // 关闭所有弹窗和下拉菜单
          const closeButtons = document.querySelectorAll('[class*="close"], [class*="Close"], [class*="mask"], [class*="overlay"]');
          for (const btn of closeButtons) {
            (btn as HTMLElement).click();
          }
          // 点击页面空白处关闭下拉菜单
          document.body.click();
        });
        await page.waitForTimeout(500);
      } catch { /* ignore */ }

      // 切换到图文 tab
      console.log('[XHS] 切换到图文 tab...');
      // 用 evaluate 直接找文本是"上传图文"的元素并点击
      await page.evaluate(() => {
        const elements = document.querySelectorAll('div, span, a, button');
        for (const el of elements) {
          if (el.textContent?.trim() === '上传图文') {
            (el as HTMLElement).click();
            break;
          }
        }
      });
      console.log('[XHS] 已点击"上传图文"tab');
      await page.waitForTimeout(1000);

      // 1. 上传图片
      console.log(`[XHS] 上传 ${params.images.length} 张图片...`);
      await this.uploadImages(page, params.images);
      await page.waitForTimeout(3000);

      // 2. 填写标题
      console.log(`[XHS] 填写标题: ${params.title}`);
      const titleInput = await page.$('input[placeholder*="标题"], input[class*="title"], #title');
      if (titleInput) {
        await titleInput.click();
        await titleInput.fill(params.title.substring(0, 20)); // 标题限 20 字
        console.log('[XHS] 标题已填写');
      } else {
        console.warn('[XHS] 未找到标题输入框，尝试其他选择器...');
        // 尝试更通用的选择器
        const allInputs = await page.$$('input');
        console.log(`[XHS] 找到 ${allInputs.length} 个 input 元素`);
        for (const input of allInputs) {
          const placeholder = await input.getAttribute('placeholder');
          console.log(`[XHS] input placeholder: ${placeholder}`);
        }
      }

      // 3. 填写正文
      console.log('[XHS] 填写正文...');
      const contentInput = await page.$('[contenteditable="true"], textarea[placeholder*="正文"], div[contenteditable="true"]');
      if (contentInput) {
        await contentInput.click();
        // 构建正文（含标签）
        let fullContent = params.content;
        if (params.tags && params.tags.length > 0) {
          fullContent += '\n\n' + params.tags.map(t => `#${t}`).join(' ');
        }
        await contentInput.fill(fullContent.substring(0, 1000)); // 正文限 1000 字
        console.log('[XHS] 正文已填写');
      } else {
        console.warn('[XHS] 未找到正文输入框');
      }

      // 4. 点击发布按钮
      console.log('[XHS] 点击发布...');
      await page.waitForTimeout(1000);

      // 找发布按钮（右下角红色的"发布"按钮）
      console.log('[XHS] 查找发布按钮...');

      // 先关闭话题标签下拉菜单
      console.log('[XHS] 关闭话题下拉菜单...');
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        // 点击标题区域关闭下拉菜单
        const titleInput = await page.$('input[placeholder*="标题"], input[class*="title"], #title');
        if (titleInput) {
          await titleInput.click();
          await page.waitForTimeout(300);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch { /* ignore */ }

      // 使用 page.mouse.click 点击发布按钮（更接近真实用户操作）
      console.log('[XHS] 等待发布按钮...');
      try {
        // 等待页面加载
        await page.waitForTimeout(3000);

        // 尝试点击发布按钮
        const btnRect = await page.evaluate(() => {
          // 方法1: 用小红书特定选择器
          const btn = document.querySelector('.publish-page-publish-btn button.bg-red');
          if (btn) {
            const rect = btn.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }

          // 方法2: 用文本匹配找最后一个"发布"按钮
          const buttons = Array.from(document.querySelectorAll('button'));
          for (let i = buttons.length - 1; i >= 0; i--) {
            const text = buttons[i].textContent?.trim();
            if (text === '发布') {
              const rect = buttons[i].getBoundingClientRect();
              return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
          }
          return null;
        });

        if (btnRect) {
          // 用 page.mouse.click 模拟真实鼠标点击
          await page.mouse.click(btnRect.x, btnRect.y);
          console.log(`[XHS] 已点击发布按钮（位置: ${btnRect.x}, ${btnRect.y}）`);
        } else {
          // 发布按钮找不到，尝试保存草稿
          console.warn('[XHS] 未找到发布按钮，尝试保存草稿...');
          const saveRect = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
              const text = btn.textContent?.trim();
              if (text && text.includes('暂存')) {
                const rect = btn.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              }
            }
            return null;
          });

          if (saveRect) {
            await page.mouse.click(saveRect.x, saveRect.y);
            console.log(`[XHS] 已点击暂存按钮（位置: ${saveRect.x}, ${saveRect.y}）`);
            await page.waitForTimeout(2000);
            return {
              success: true,
              noteUrl: undefined,
            };
          }

          return {
            success: false,
            error: '未找到发布按钮',
          };
        }

        // 记录点击前的 URL
        const urlBefore = page.url();
        console.log(`[XHS] 点击前 URL: ${urlBefore}`);

        // 等待发布完成（给用户观察时间）
        console.log('[XHS] 等待发布完成，请观察页面...');
        await page.waitForTimeout(15000);

        // 保存发布后的截图
        const afterScreenshotPath = path.join(screenshotDir, `after-publish-${Date.now()}.png`);
        await page.screenshot({ path: afterScreenshotPath, fullPage: true });
        console.log(`[XHS] 发布后截图: ${afterScreenshotPath}`);

        // 检查是否发布成功（URL 必须发生变化）
        const urlAfter = page.url();
        console.log(`[XHS] 发布后 URL: ${urlAfter}`);

        if (urlAfter !== urlBefore && !urlAfter.includes('login')) {
          const noteUrl = await this.extractNoteUrl(page);
          return {
            success: true,
            noteUrl,
          };
        } else {
          return {
            success: false,
            error: '发布按钮已点击，但页面未跳转，可能发布失败',
          };
        }
      } catch {
        console.warn('[XHS] 未找到发布按钮');
      }

      return {
        success: false,
        error: '未找到发布按钮',
      };

    } catch (err) {
      return {
        success: false,
        error: `发布失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * 上传图片到发布页面（逐个上传）
   */
  private async uploadImages(page: Page, images: Buffer[]): Promise<void> {
    // 将图片 buffer 写入临时文件
    const tempDir = path.join(os.tmpdir(), 'xhs-upload');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFiles: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const tempPath = path.join(tempDir, `image_${i}.jpg`);
      fs.writeFileSync(tempPath, images[i]);
      tempFiles.push(tempPath);
    }

    try {
      // 找到文件上传 input
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        // 逐个上传图片
        for (let i = 0; i < tempFiles.length; i++) {
          console.log(`[XHS] 上传第 ${i + 1}/${tempFiles.length} 张图片...`);
          await fileInput.setInputFiles(tempFiles[i]);
          // 等待上传完成
          await page.waitForTimeout(1000);
        }
        console.log(`[XHS] 已上传 ${tempFiles.length} 张图片`);
      } else {
        console.warn('[XHS] 未找到文件上传 input');
      }
    } finally {
      // 清理临时文件
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }

  /**
   * 从发布结果页面提取笔记链接
   */
  private async extractNoteUrl(page: Page): Promise<string | undefined> {
    try {
      // 尝试从页面中提取笔记链接
      const link = await page.$('a[href*="/explore/"], a[href*="/discovery/item/"]');
      if (link) {
        return await link.getAttribute('href') || undefined;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  /**
   * 加载保存的 Cookie
   */
  private loadCookies(): any[] {
    try {
      if (fs.existsSync(COOKIE_FILE)) {
        const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch { /* ignore */ }
    return [];
  }

  /**
   * 保存 Cookie 到文件
   */
  private saveCookies(cookies: any[]): void {
    try {
      console.log(`[XHS] 保存 ${cookies.length} 个 Cookie 到 ${COOKIE_FILE}`);
      if (!fs.existsSync(COOKIE_DIR)) {
        fs.mkdirSync(COOKIE_DIR, { recursive: true });
      }
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
      console.log('[XHS] Cookie 已保存成功');
    } catch (err) {
      console.error('[XHS] 保存 Cookie 失败:', err);
    }
  }
}
