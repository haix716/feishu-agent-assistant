import { createLarkChannel, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { config } from "./config";
import { handleMessage, handleCardAction, initRootFolder } from "./handler";
import { startScheduler } from "./scheduler";
import { startOAuthServer } from "./oauth-server";
import { buildDailyCard, getPushedManifest } from "./metacognition";

async function main() {
  // 启动 OAuth 服务器
  await startOAuthServer(3000);

  // 初始化云盘文件夹（保留原有逻辑）
  await initRootFolder();

  // 创建 Channel
  const channel = createLarkChannel({
    appId: config.lark.appId,
    appSecret: config.lark.appSecret,
    policy: { requireMention: true, dmMode: "open" },
    loggerLevel: LoggerLevel.info,
  });

  // 消息处理
  channel.on("message", async (msg) => {
    await handleMessage(channel, msg);
  });

  // 卡片按钮点击处理
  channel.on("cardAction", async (evt) => {
    await handleCardAction(channel, evt);
  });

  // 启动定时任务
  startScheduler();

  // 连接
  await channel.connect();
  console.log(`connected as ${channel.botIdentity!.name}`);

  // 发送今日日报卡片（通过 bot SDK，card callback 才能工作）
  try {
    const manifest = await getPushedManifest();
    if (manifest && manifest.count > 0) {
      const card = buildDailyCard(manifest);
      const userId = config.dailyPush.userId;
      if (userId) {
        await channel.send(userId, { card } as any);
        console.log(`[daily] 日报卡片已发送：${manifest.count} 条`);
      }
    }
  } catch (err) {
    console.error("[daily] 日报卡片发送失败:", err);
  }

  // 优雅退出
  process.on("SIGINT", async () => {
    await channel.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
