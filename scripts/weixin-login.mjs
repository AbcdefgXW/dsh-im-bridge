#!/usr/bin/env node
/**
 * weixin-login.mjs — 微信扫码登录 CLI
 *
 *   node scripts/weixin-login.mjs login [--out <file>] [--timeout <ms>]
 *     → 单进程一体：发起登录 → 输出二维码 JSON（stdout + 可选文件）→ 轮询扫码
 *       → confirmed 后保存 token 到 state/weixin/，输出结果 JSON
 *     ascii 是纯文本二维码（清 ANSI），可原样贴给用户扫码
 *
 *   node scripts/weixin-login.mjs start
 *     → 仅发起登录，输出 { qrcodeUrl, ascii, sessionKey }（调试用）
 *
 * 注意：start / wait 跨进程会丢内存登录状态，正式登录请用 login。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { startWeixinLoginWithQr, waitForWeixinLogin } from "../dist/protocol/auth/login-qr.js";
import {
  saveWeixinAccount,
  registerWeixinAccountId,
  clearStaleAccountsForUserId,
} from "../dist/protocol/auth/accounts.js";
import { logger } from "../dist/protocol/util/logger.js";

const require = createRequire(import.meta.url);

/** qrcode-terminal 输出清 ANSI，得到纯文本二维码。 */
function generateAsciiQr(text) {
  const qrcodeTerminal = require("qrcode-terminal");
  let out = "";
  const oldWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    out += String(chunk);
    return true;
  };
  try {
    qrcodeTerminal.generate(text, { small: true });
  } finally {
    process.stdout.write = oldWrite;
  }
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

function writeOutFile(path, obj) {
  if (path) fs.writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
}

async function cmdLogin({ outFile, timeoutMs }) {
  const start = await startWeixinLoginWithQr({
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    verbose: false,
  });
  if (!start.qrcodeUrl) {
    console.log(JSON.stringify({ connected: false, message: start.message }));
    process.exit(1);
  }
  const ascii = generateAsciiQr(start.qrcodeUrl);
  const qrInfo = {
    qrcodeUrl: start.qrcodeUrl,
    ascii,
    sessionKey: start.sessionKey,
    message: start.message,
  };
  console.log(JSON.stringify(qrInfo));
  writeOutFile(outFile, { phase: "qr", ...qrInfo });

  const result = await waitForWeixinLogin({
    sessionKey: start.sessionKey,
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    timeoutMs,
  });
  if (!result.connected) {
    const out = { connected: false, message: result.message, alreadyConnected: result.alreadyConnected ?? false };
    console.log(JSON.stringify(out));
    writeOutFile(outFile, { phase: "done", ...out });
    process.exit(result.alreadyConnected ? 0 : 1);
  }
  const accountId = result.accountId;
  if (!accountId) {
    const out = { connected: false, message: "登录成功但缺少 accountId" };
    console.log(JSON.stringify(out));
    writeOutFile(outFile, { phase: "done", ...out });
    process.exit(1);
  }
  // 落盘凭证
  saveWeixinAccount(accountId, {
    token: result.botToken,
    baseUrl: result.baseUrl,
    userId: result.userId,
  });
  registerWeixinAccountId(accountId);
  clearStaleAccountsForUserId(accountId, result.userId ?? "");
  logger.info(`weixin login saved: account=${accountId} userId=${result.userId}`);
  const out = {
    connected: true,
    accountId,
    baseUrl: result.baseUrl,
    userId: result.userId,
    message: result.message,
  };
  console.log(JSON.stringify(out));
  writeOutFile(outFile, { phase: "done", ...out });
}

async function cmdStart() {
  const result = await startWeixinLoginWithQr({
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    verbose: false,
  });
  if (!result.qrcodeUrl) {
    console.error(result.message);
    process.exit(1);
  }
  const ascii = generateAsciiQr(result.qrcodeUrl);
  console.log(JSON.stringify({
    qrcodeUrl: result.qrcodeUrl,
    ascii,
    sessionKey: result.sessionKey,
    message: result.message,
  }));
}

const args = process.argv.slice(2);
const [cmd] = args;

if (cmd === "login") {
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const toIdx = args.indexOf("--timeout");
  const timeoutMs = toIdx >= 0 ? Number(args[toIdx + 1]) : 480_000;
  await cmdLogin({ outFile, timeoutMs });
} else if (cmd === "start") {
  await cmdStart();
} else {
  console.error("用法: node scripts/weixin-login.mjs login [--out <file>] [--timeout <ms>] | start");
  process.exit(1);
}
