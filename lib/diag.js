/**
 * diag.js — 诊断日志（写入 dsh-msg-hub state/logs/bridge-debug.log）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function diagLog(msg) {
  try {
    const dir = path.join(PLUGIN_ROOT, "state", "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "bridge-debug.log"),
      `${new Date().toISOString()} ${msg}\n`,
      "utf-8",
    );
  } catch {
    // best-effort
  }
}
