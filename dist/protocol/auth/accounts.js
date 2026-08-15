import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
// ---------------------------------------------------------------------------
// Account ID normalization (replaces openclaw/plugin-sdk/account-id)
// ---------------------------------------------------------------------------
/** Normalize a raw weixin account id (e.g. "b0f5860fdecb@im.bot" → "b0f5860fdecb-im-bot"). */
export function normalizeAccountId(raw) {
    const trimmed = String(raw).trim();
    if (trimmed.endsWith("@im.bot"))
        return `${trimmed.slice(0, -7)}-im-bot`;
    if (trimmed.endsWith("@im.wechat"))
        return `${trimmed.slice(0, -10)}-im-wechat`;
    return trimmed;
}
/**
 * Pattern-based reverse of normalizeAccountId for known weixin ID suffixes.
 * e.g. "b0f5860fdecb-im-bot" → "b0f5860fdecb@im.bot"
 */
export function deriveRawAccountId(normalizedId) {
    if (normalizedId.endsWith("-im-bot")) {
        return `${normalizedId.slice(0, -7)}@im.bot`;
    }
    if (normalizedId.endsWith("-im-wechat")) {
        return `${normalizedId.slice(0, -10)}@im.wechat`;
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Account index (persistent list of registered account IDs)
// ---------------------------------------------------------------------------
function resolveWeixinStateDir() {
    return path.join(resolveStateDir(), "weixin");
}
function resolveAccountIndexPath() {
    return path.join(resolveWeixinStateDir(), "accounts.json");
}
/** Returns all accountIds registered via QR login. */
export function listIndexedWeixinAccountIds() {
    const filePath = resolveAccountIndexPath();
    try {
        if (!fs.existsSync(filePath))
            return [];
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((id) => typeof id === "string" && id.trim() !== "");
    }
    catch {
        return [];
    }
}
/** Add accountId to the persistent index (no-op if already present). */
export function registerWeixinAccountId(accountId) {
    const dir = resolveWeixinStateDir();
    fs.mkdirSync(dir, { recursive: true });
    const existing = listIndexedWeixinAccountIds();
    if (existing.includes(accountId))
        return;
    const updated = [...existing, accountId];
    fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
}
/** Remove accountId from the persistent index. */
export function unregisterWeixinAccountId(accountId) {
    const existing = listIndexedWeixinAccountIds();
    const updated = existing.filter((id) => id !== accountId);
    if (updated.length !== existing.length) {
        fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
    }
}
/**
 * Remove stale accounts that share the same userId as the newly-bound account.
 * Called after a successful QR login to ensure only the latest account remains.
 */
export function clearStaleAccountsForUserId(currentAccountId, userId, onClearContextTokens) {
    if (!userId)
        return;
    const allIds = listIndexedWeixinAccountIds();
    for (const id of allIds) {
        if (id === currentAccountId)
            continue;
        const data = loadWeixinAccount(id);
        if (data?.userId?.trim() === userId) {
            logger.info(`clearStaleAccountsForUserId: removing stale account=${id} (same userId=${userId})`);
            onClearContextTokens?.(id);
            clearWeixinAccount(id);
            unregisterWeixinAccountId(id);
        }
    }
}
function resolveAccountsDir() {
    return path.join(resolveWeixinStateDir(), "accounts");
}
function resolveAccountPath(accountId) {
    return path.join(resolveAccountsDir(), `${accountId}.json`);
}
function readAccountFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    }
    catch {
        // ignore
    }
    return null;
}
/** Load account data by ID, with compatibility fallbacks. */
export function loadWeixinAccount(accountId) {
    // Primary: try given accountId (normalized IDs written after this change).
    const primary = readAccountFile(resolveAccountPath(accountId));
    if (primary)
        return primary;
    // Compatibility: if the given ID is normalized, derive the old raw filename.
    const rawId = deriveRawAccountId(accountId);
    if (rawId) {
        const compat = readAccountFile(resolveAccountPath(rawId));
        if (compat)
            return compat;
    }
    return null;
}
/**
 * Persist account data after QR login (merges into existing file).
 * - token: overwritten when provided.
 * - baseUrl: stored when non-empty; resolveWeixinAccount falls back to DEFAULT_BASE_URL.
 * - userId: set when `update.userId` is provided; omitted from file when cleared to empty.
 */
export function saveWeixinAccount(accountId, update) {
    const dir = resolveAccountsDir();
    fs.mkdirSync(dir, { recursive: true });
    const existing = loadWeixinAccount(accountId) ?? {};
    const token = update.token?.trim() || existing.token;
    const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
    const userId = update.userId !== undefined
        ? update.userId.trim() || undefined
        : existing.userId?.trim() || undefined;
    const data = {
        ...(token ? { token, savedAt: new Date().toISOString() } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(userId ? { userId } : {}),
    };
    const filePath = resolveAccountPath(accountId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try {
        fs.chmodSync(filePath, 0o600);
    }
    catch {
        // best-effort
    }
}
/**
 * Remove all files associated with an account:
 *   - accounts/{accountId}.json                  (credentials)
 *   - accounts/{accountId}.sync.json             (getUpdates sync buf)
 */
export function clearWeixinAccount(accountId) {
    const dir = resolveAccountsDir();
    const accountFiles = [
        `${accountId}.json`,
        `${accountId}.sync.json`,
    ];
    for (const file of accountFiles) {
        try {
            fs.unlinkSync(path.join(dir, file));
        }
        catch {
            // ignore if not found
        }
    }
}
/** Route tag from config (not used in dsh build; kept for compat). */
export function loadConfigRouteTag() {
    return undefined;
}
/** Bot agent from config (not used in dsh build; kept for compat). */
export function loadConfigBotAgent() {
    return undefined;
}
/** List accountIds from the index file (written at QR login). */
export function listWeixinAccountIds() {
    return listIndexedWeixinAccountIds();
}
/** Resolve a weixin account by ID, merging stored credentials. */
export function resolveWeixinAccount(accountId) {
    const raw = accountId?.trim();
    if (!raw) {
        throw new Error("weixin: accountId is required (no default account)");
    }
    const id = normalizeAccountId(raw);
    const accountData = loadWeixinAccount(id);
    const token = accountData?.token?.trim() || undefined;
    const stateBaseUrl = accountData?.baseUrl?.trim() || "";
    return {
        accountId: id,
        baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
        cdnBaseUrl: CDN_BASE_URL,
        token,
        enabled: true,
        configured: Boolean(token),
        name: undefined,
    };
}
