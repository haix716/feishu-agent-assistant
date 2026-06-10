import { createLarkChannel, LoggerLevel } from '@larksuiteoapi/node-sdk';
import { config } from './config';
import { handleMessage, handleCardAction, initRootFolder } from './handler';
import { startScheduler } from './scheduler';
import { startOAuthServer } from './oauth-server';

async function main() {
    // 启动 OAuth 服务器
    await startOAuthServer(3000);

    // 初始化云盘文件夹（保留原有逻辑）
    await initRootFolder();

    // 创建 Channel
    const channel = createLarkChannel({
        appId: config.lark.appId,
        appSecret: config.lark.appSecret,
        policy: { requireMention: true, dmMode: 'open' },
        loggerLevel: LoggerLevel.info,
    });

    // 消息处理
    channel.on('message', async (msg) => {
        await handleMessage(channel, msg);
    });

    // 卡片按钮点击处理
    channel.on('cardAction', async (evt) => {
        await handleCardAction(channel, evt);
    });

    // 启动定时任务
    startScheduler();

    // 连接
    await channel.connect();
    console.log(`connected as ${channel.botIdentity!.name}`);

    // 优雅退出
    process.on('SIGINT', async () => {
        await channel.disconnect();
        process.exit(0);
    });
}

main().catch(console.error);
