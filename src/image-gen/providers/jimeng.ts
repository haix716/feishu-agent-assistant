/**
 * 即梦/Dreamina Provider
 *
 * 通过 dreamina CLI 工具调用即梦的图片生成能力
 * 安装：curl -s https://jimeng.jianying.com/cli | bash
 * 登录：dreamina login（抖音扫码）
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import type {
  ImageProvider,
  GenerateParams,
  GenerateResult,
  GenerateMode,
} from "./provider";

const execFileAsync = promisify(execFile);

/** 支持的宽高比 */
const RATIO_MAP: Record<string, string> = {
  "1:1": "1:1",
  "3:4": "3:4",
  "4:3": "4:3",
  "16:9": "16:9",
  "9:16": "9:16",
  "2:3": "2:3",
  "3:2": "3:2",
  "21:9": "21:9",
};

export class JimengProvider implements ImageProvider {
  name = "jimeng";

  supports(_mode: GenerateMode): boolean {
    // 即梦支持所有模式
    return true;
  }

  async generateImage(params: GenerateParams): Promise<GenerateResult> {
    const { referenceImage, prompt, mode, options } = params;

    // 将参考图写入临时文件
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimeng-"));
    const inputPath = path.join(tmpDir, "input.jpg");
    fs.writeFileSync(inputPath, referenceImage);

    try {
      // 根据模式选择参数
      const ratio = this.getRatio(mode, options?.aspectRatio);
      const modelVersion = options?.style === "high_quality" ? "5.0" : "4.5";

      // 调用 dreamina image2image
      const args = [
        "image2image",
        `--images=${inputPath}`,
        `--prompt=${prompt}`,
        `--ratio=${ratio}`,
        `--model_version=${modelVersion}`,
        `--poll=60`, // 等待最多 60 秒
      ];

      console.log(`[Jimeng] 执行: dreamina ${args.join(" ")}`);

      const { stdout, stderr } = await execFileAsync("dreamina", args, {
        timeout: 120000, // 2 分钟超时
      });

      console.log(`[Jimeng] stdout: ${stdout}`);
      if (stderr) console.warn(`[Jimeng] stderr: ${stderr}`);

      // 解析结果
      const result = this.parseOutput(stdout, tmpDir);
      return result;
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(inputPath);
        fs.rmdirSync(tmpDir);
      } catch {
        // 忽略清理错误
      }
    }
  }

  private getRatio(mode: GenerateMode, aspectRatio?: string): string {
    if (aspectRatio && RATIO_MAP[aspectRatio]) {
      return RATIO_MAP[aspectRatio];
    }
    // 默认比例
    switch (mode) {
      case "tryon":
        return "3:4"; // 竖版，适合人物
      case "product":
        return "1:1"; // 正方形，适合电商主图
      case "cover":
        return "3:4"; // 小红书封面
      default:
        return "1:1";
    }
  }

  private parseOutput(stdout: string, tmpDir: string): GenerateResult {
    // 从输出中提取 submit_id 和结果
    const submitIdMatch = stdout.match(/submit_id[:\s]+([a-f0-9-]+)/i);
    const submitId = submitIdMatch?.[1];

    // 检查是否有生成的图片路径
    const imageMatch = stdout.match(
      /(?:result|output|image)[:\s]+(.+\.(?:jpg|jpeg|png|webp))/i,
    );
    const statusMatch = stdout.match(/gen_status[:\s]+(\w+)/i);
    const status = statusMatch?.[1] || "unknown";

    if (status === "fail") {
      const reasonMatch = stdout.match(/fail_reason[:\s]+(.+)/i);
      throw new Error(`即梦生成失败: ${reasonMatch?.[1] || "未知原因"}`);
    }

    // 如果有本地图片路径
    if (imageMatch) {
      const imagePath = imageMatch[1].trim();
      if (fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        return { images: [imageBuffer], model: "jimeng" };
      }
    }

    // 如果状态是 querying，需要后续轮询
    if (status === "querying" && submitId) {
      throw new Error(
        `即梦任务提交成功（${submitId}），需要异步查询结果。请稍后重试。`,
      );
    }

    // 尝试在临时目录找输出图片
    try {
      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && f !== "input.jpg");
      if (files.length > 0) {
        const imageBuffer = fs.readFileSync(path.join(tmpDir, files[0]));
        return { images: [imageBuffer], model: "jimeng" };
      }
    } catch {
      // 忽略
    }

    // 如果有 submit_id 但没有图片，返回需要异步查询的提示
    if (submitId) {
      throw new Error(
        `即梦任务已提交（submit_id: ${submitId}），请用 dreamina query_result --submit_id=${submitId} 查询结果。`,
      );
    }

    throw new Error(`即梦生成失败：无法解析输出\n${stdout}`);
  }
}

