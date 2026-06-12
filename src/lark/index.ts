/**
 * 飞书服务统一接口
 *
 * 按职责拆分为 user / file / message / todo 四个模块，
 * 对外通过 larkService facade 保持向后兼容。
 */

import * as userOps from "./user";
import * as fileOps from "./file";
import * as messageOps from "./message";
import * as todoOps from "./todo";

/**
 * 飞书服务 facade — 保持 `larkService.methodName()` 调用方式不变
 */
export const larkService = {
  ...userOps,
  ...fileOps,
  ...messageOps,
  ...todoOps,
};

export { larkClient } from "./client";
