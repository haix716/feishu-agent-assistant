import cron from "node-cron";
import { larkService } from "./lark";
import { config } from "./config";

/** 匹配 {yyyyMMdd}(待处理) 格式的文件夹名 */
const PENDING_FOLDER_PATTERN = /^\{(\d{8})\}\(待处理\)$/;

/**
 * 启动定时任务
 */
export function startScheduler(): void {
  // 每天凌晨 2:00 执行清理任务
  cron.schedule("0 2 * * *", async () => {
    console.log("⏰ 执行定时任务：清理空的待处理文件夹");
    await cleanupEmptyFolders();
  });

  // 每日洞察推送已移至元认知系统（metacognition 项目负责推送）
  // bot 不再重复推送，避免用户收到两条日报

  console.log(`📅 定时任务已启动（每天 02:00 清理空文件夹）`);
}

/**
 * 清理空的 {yyyyMMdd}(待处理) 文件夹
 */
async function cleanupEmptyFolders(): Promise<void> {
  try {
    // 获取根文件夹 token
    const rootToken =
      config.driveFolderToken || (await larkService.getRootFolder());
    if (!rootToken) {
      console.error("❌ 无法获取根文件夹 token");
      return;
    }

    // 列出根文件夹下的所有子文件夹
    const folders = await larkService.listFolders(rootToken);
    console.log(`📁 根目录下共 ${folders.length} 个文件夹`);

    // 筛选匹配 {yyyyMMdd}(待处理) 模式的文件夹
    const pendingFolders = folders.filter((f) =>
      PENDING_FOLDER_PATTERN.test(f.name),
    );
    console.log(`🔍 找到 ${pendingFolders.length} 个待处理文件夹`);

    if (pendingFolders.length === 0) {
      console.log("✅ 无需清理");
      return;
    }

    // 检查并删除空文件夹
    let deletedCount = 0;
    for (const folder of pendingFolders) {
      const contentCount = await larkService.listFolderContents(folder.token);
      if (contentCount === 0) {
        const success = await larkService.deleteFile(folder.token, "folder");
        if (success) {
          console.log(`🗑️ 已删除空文件夹: ${folder.name}`);
          deletedCount++;
        } else {
          console.error(`❌ 删除失败: ${folder.name}`);
        }
      } else if (contentCount > 0) {
        console.log(
          `📂 跳过非空文件夹: ${folder.name}（含 ${contentCount} 个文件）`,
        );
      }
    }

    console.log(`✅ 清理完成：共删除 ${deletedCount} 个空文件夹`);
  } catch (err) {
    console.error("❌ 清理任务执行失败:", err);
  }
}
