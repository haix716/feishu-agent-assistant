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
