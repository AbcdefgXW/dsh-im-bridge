#!/usr/bin/env node
/**
 * feishu-login.mjs — 飞书凭证配置 CLI
 *
 * 飞书没有扫码绑定（应用凭证制），直接填：
 *   node scripts/feishu-login.mjs --appid <AppID> --secret <AppSecret>
 *
 * 或手动编辑 state/feishu/accounts.json（File Station）：
 *   [{ "appId": "...", "appSecret": "...", "savedAt": "..." }]
 */
import { saveFeishuAccount } from "../lib/feishu/credentials.js";

const args = process.argv.slice(2);
const appIdIdx = args.indexOf("--appid");
const secretIdx = args.indexOf("--secret");

if (appIdIdx < 0 || secretIdx < 0) {
  console.error("用法: node scripts/feishu-login.mjs --appid <AppID> --secret <AppSecret>");
  process.exit(1);
}

const appId = args[appIdIdx + 1]?.trim();
const appSecret = args[secretIdx + 1]?.trim();
if (!appId || !appSecret) {
  console.error("AppID/AppSecret 不能为空");
  process.exit(1);
}

saveFeishuAccount({ appId, appSecret, savedAt: new Date().toISOString() });
console.log(JSON.stringify({ connected: true, appId, message: `飞书应用已配置！AppID: ${appId}` }));
