import { Client } from "@larksuiteoapi/node-sdk";
import { config } from "../config";

export const larkClient = new Client({
  appId: config.lark.appId,
  appSecret: config.lark.appSecret,
  domain: config.lark.domain,
});
