#!/usr/bin/env node
/**
 * qq-login.mjs — QQ 机器人绑定 CLI
 *
 * 两种模式：
 *
 * 1) 凭证直填（推荐，机器人已在开放平台创建时）：
 *    node scripts/qq-login.mjs --appid <AppID> --secret <AppSecret>
 *    → 直接写入 state/qq/accounts.json
 *
 * 2) 扫码绑定（开放平台账号下已有机器人时）：
 *    node scripts/qq-login.mjs [--out <file>] [--timeout <ms>]
 *    → 手机 QQ 扫二维码 → 自动获取 appId/appSecret 存入 state/qq/accounts.json
 *
 * 注意：扫码绑定要求账号下已存在机器人应用，否则页面会显示"机器人离线"。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { startQrConnect } from "@tencent-connect/qqbot-connector";
import { saveQqAccount } from "../lib/qq/credentials.js";

const require = createRequire(import.meta.url);

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

const args = process.argv.slice(2);

// ── 模式 1：凭证直填 ──
const appIdIdx = args.indexOf("--appid");
const secretIdx = args.indexOf("--secret");
if (appIdIdx >= 0 && secretIdx >= 0) {
  const appId = args[appIdIdx + 1]?.trim();
  const appSecret = args[secretIdx + 1]?.trim();
  if (!appId || !appSecret) {
    console.error("用法: node scripts/qq-login.mjs --appid <AppID> --secret <AppSecret>");
    process.exit(1);
  }
  saveQqAccount({
    appId,
    appSecret,
    savedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ connected: true, appId, message: `QQ Bot 已配置！AppID: ${appId}` }));
  process.exit(0);
}

// ── 模式 2：扫码绑定 ──
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
const toIdx = args.indexOf("--timeout");
const timeoutMs = toIdx >= 0 ? Number(args[toIdx + 1]) : 300_000;

function writeOut(obj) {
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(obj, null, 2), "utf-8");
  console.log(JSON.stringify(obj));
}

const timer = setTimeout(() => {
  writeOut({ connected: false, message: "登录超时，请重试" });
  process.exit(1);
}, timeoutMs);

let qrShown = false;

const dispose = startQrConnect(
  {
    onQrDisplayed(url) {
      if (qrShown) return; // 刷新后的二维码不再重复输出
      qrShown = true;
      const ascii = generateAsciiQr(url);
      writeOut({ phase: "qr", qrcodeUrl: url, ascii, message: "请使用手机 QQ 扫描二维码完成绑定" });
    },
    onSuccess(credentials) {
      clearTimeout(timer);
      for (const cred of credentials) {
        saveQqAccount({
          appId: cred.appId,
          appSecret: cred.appSecret,
          userOpenid: cred.userOpenid,
          savedAt: new Date().toISOString(),
        });
        writeOut({
          connected: true,
          appId: cred.appId,
          userOpenid: cred.userOpenid,
          message: `QQ Bot 绑定成功！AppID: ${cred.appId}`,
        });
      }
      dispose();
      process.exit(0);
    },
    onFailure(err) {
      clearTimeout(timer);
      writeOut({ connected: false, message: `绑定失败: ${err instanceof Error ? err.message : String(err)}` });
      process.exit(1);
    },
  },
  { displayQrCodeToConsole: false, source: "dsh" },
);
