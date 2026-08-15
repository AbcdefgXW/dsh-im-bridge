/**
 * credentials.js — QQ 机器人凭证存储
 *
 * 扫码绑定得到的 appId/appSecret 存 state/qq/accounts.json。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveQqStateDir() {
  return (
    process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
    path.join(fileURLToPath(new URL("../../", import.meta.url)), "state", "qq")
  );
}

function resolveAccountsPath() {
  return path.join(resolveQqStateDir(), "accounts.json");
}

export function listQqAccounts() {
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

export function saveQqAccount(account) {
  const dir = resolveQqStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const accounts = listQqAccounts().filter((a) => a.appId !== account.appId);
  accounts.push(account);
  fs.writeFileSync(resolveAccountsPath(), JSON.stringify(accounts, null, 2), "utf-8");
  try {
    fs.chmodSync(resolveAccountsPath(), 0o600);
  } catch {
    // best-effort
  }
}

export function removeQqAccount(appId) {
  const accounts = listQqAccounts().filter((a) => a.appId !== appId);
  fs.writeFileSync(resolveAccountsPath(), JSON.stringify(accounts, null, 2), "utf-8");
}
