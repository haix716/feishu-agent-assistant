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
 * 节流函数：限制函数调用频率
 */
export function pThrottle<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  intervalMs: number
): T {
  let lastCall = 0;
  let pending = false;

  return (async (...args: any[]) => {
    if (pending) return;
    const now = Date.now();
    const elapsed = now - lastCall;
    if (elapsed < intervalMs) {
      pending = true;
      await new Promise(r => setTimeout(r, intervalMs - elapsed));
      pending = false;
    }
    lastCall = Date.now();
    return fn(...args);
  }) as T;
}
