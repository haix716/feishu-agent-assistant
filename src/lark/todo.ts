import { larkClient } from "./client";

/** 创建待办，返回 task_id */
export async function createTodo(
  _userId: string,
  title: string,
  description?: string,
): Promise<string | null> {
  try {
    const resp = await larkClient.task.task.create({
      data: {
        summary: title,
        description,
        collaborator_ids: [_userId],
        origin: {
          platform_i18n_name: JSON.stringify({ zh_cn: "飞书智能体" }),
        },
      },
      params: { user_id_type: "open_id" },
    });
    if (resp.code === 0 && resp.data?.task?.id) {
      return resp.data.task.id;
    }
    console.error("createTodo failed:", resp.msg);
  } catch (err) {
    console.error("createTodo failed:", err);
  }
  return null;
}

/** 查询用户今天的待办 */
export async function queryTodayTodos(
  userId: string,
): Promise<Array<{ id: string; title: string }>> {
  try {
    // 今天 00:00 的 Unix 时间戳（秒）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startCreateTime = Math.floor(today.getTime() / 1000).toString();

    const resp = await larkClient.task.task.list({
      params: {
        page_size: 100,
        start_create_time: startCreateTime,
        task_completed: false,
        user_id_type: "open_id",
      },
    });
    if (resp.code === 0 && resp.data?.items) {
      return resp.data.items
        .filter((t) => t.id && t.summary)
        .map((t) => ({ id: t.id!, title: t.summary! }));
    }
    console.error("queryTodayTodos failed:", resp.msg);
  } catch (err) {
    console.error("queryTodayTodos failed:", err);
  }
  return [];
}

/** 标记待办完成 */
export async function completeTodo(todoId: string): Promise<boolean> {
  try {
    const resp = await larkClient.task.task.complete({
      path: { task_id: todoId },
    });
    if (resp.code === 0) return true;
    console.error("completeTodo failed:", resp.msg);
  } catch (err) {
    console.error("completeTodo failed:", err);
  }
  return false;
}
