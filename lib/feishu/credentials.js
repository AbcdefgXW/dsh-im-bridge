/**
 * credentials.js — 飞书应用凭证存储
 *
 * state/feishu/accounts.json：[{appId, appSecret, savedAt}]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveFeishuStateDir() {
  return (
    process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
    path.join(fileURLToPath(new URL("../../", import.meta.url)), "state", "feishu")
  );
}

function resolveAccountsPath() {
  return path.join(resolveFeishuStateDir(), "accounts.json");
}

export function listFeishuAccounts() {
  try {
    if (!fs.existsSync(resolveAccountsPath())) return [];
    const raw = fs.readFileSync(resolveAccountsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a === "object" && typeof a.appId === "string" && a.appId.trim() !== "",
    );
  } catch {
    return [];
  }
}

export function saveFeishuAccount(account) {
  const dir = resolveFeishuStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const accounts = listFeishuAccounts().filter((a) => a.appId !== account.appId);
  accounts.push(account);
  fs.writeFileSync(resolveAccountsPath(), JSON.stringify(accounts, null, 2), "utf-8");
  try {
    fs.chmodSync(resolveAccountsPath(), 0o600);
  } catch {
    // best-effort
  }
}
