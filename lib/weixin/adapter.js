/**
 * adapter.js — 微信适配器（ilinkai 协议）
 *
 * 复用 protocol/ 编译产物（上游 openclaw-weixin 协议层，MIT）：
 *   - getUpdates 长轮询收消息
 *   - sendMessage 发文本
 *   - 账户凭证存储（state/weixin/）
 *
 * 薄壳职责：轮询循环 + 文本提取 + bridge 注入 + 回复回传 + 错误退避。
 */
import {
  getUpdates,
  sendMessage,
  notifyStart,
  notifyStop,
  classifyFetchError,
} from "../../dist/protocol/api/api.js";
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
} from "../../dist/protocol/auth/accounts.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../../dist/protocol/storage/sync-buf.js";
import { logger } from "../../dist/protocol/util/logger.js";
import { MessageItemType, MessageType, MessageState } from "../../dist/protocol/api/types.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
/** token 失效后的暂停时长（上游默认） */
const STALE_TOKEN_PAUSE_MS = 10 * 60_000;
const STALE_TOKEN_ERRCODE = -14;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

/** 提取消息里的第一段文本。 */
export function extractTextBody(itemList) {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

/** 发一条文本消息给用户。 */
export async function sendWeixinText(account, to, text, contextToken) {
  await sendMessage({
    baseUrl: account.baseUrl,
    token: account.token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: `dsh-im-bridge:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
        context_token: contextToken ?? undefined,
      },
    },
  });
}

/**
 * 单个账户的收消息循环（getUpdates 长轮询）。
 * @param {object} opts
 * @param {object} opts.account ResolvedWeixinAccount
 * @param {(text: string, peerId: string, contextToken?: string) => Promise<void>} opts.onMessage
 * @param {AbortSignal} [opts.abortSignal]
 */
export async function monitorWeixinAccount({ account, onMessage, abortSignal }) {
  const aLog = logger.withAccount(account.accountId);
  const syncFilePath = getSyncBufFilePath(account.accountId);
  let getUpdatesBuf = loadGetUpdatesBuf(syncFilePath) ?? "";
  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;
  let pausedUntil = 0;

  aLog.info(`Monitor started: baseUrl=${account.baseUrl} account=${account.accountId}`);
  try {
    await notifyStart({ baseUrl: account.baseUrl, token: account.token });
  } catch {
    // best-effort
  }

  while (!abortSignal?.aborted) {
    // token 失效暂停窗口
    if (pausedUntil > Date.now()) {
      const waitMs = pausedUntil - Date.now();
      aLog.error(`token stale, pausing ${Math.ceil(waitMs / 60000)} min`);
      try {
        await sleep(waitMs, abortSignal);
      } catch {
        break;
      }
      continue;
    }

    try {
      const resp = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
        abortSignal,
      });

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (isApiError) {
        if (resp.errcode === STALE_TOKEN_ERRCODE || resp.ret === STALE_TOKEN_ERRCODE) {
          pausedUntil = Date.now() + STALE_TOKEN_PAUSE_MS;
          consecutiveFailures = 0;
          continue;
        }
        consecutiveFailures += 1;
        aLog.error(`getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }

      consecutiveFailures = 0;
      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      const list = resp.msgs ?? [];
      for (const full of list) {
        const fromUserId = full.from_user_id ?? "";
        if (!fromUserId) continue;
        const text = extractTextBody(full.item_list);
        aLog.info(`inbound message: from=${fromUserId} text="${text.slice(0, 40)}"`);
        if (!text) continue;
        // 不在 await 中阻塞轮询：串行处理但捕获异常
        try {
          await onMessage(text, fromUserId, full.context_token);
        } catch (err) {
          aLog.error(`onMessage failed: ${String(err)}`);
        }
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        aLog.info("Monitor stopped (aborted)");
        break;
      }
      consecutiveFailures += 1;
      const classified = classifyFetchError(err);
      aLog.error(`getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${String(err)} type=${classified.type}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
    }
  }

  try {
    await notifyStop({ baseUrl: account.baseUrl, token: account.token });
  } catch {
    // best-effort
  }
  aLog.info("Monitor ended");
}

/**
 * 启动所有已配置账户的监控。
 * @param {(text: string, peerId: string, contextToken?: string) => Promise<void>} onMessage
 * @param {AbortSignal} [abortSignal]
 * @returns {() => void} stop 函数
 */
export function startWeixinMonitors({ onMessage, abortSignal }) {
  const stopFns = [];
  const ids = listWeixinAccountIds();
  for (const id of ids) {
    try {
      const account = resolveWeixinAccount(id);
      if (!account.configured) {
        logger.warn(`account ${id} 未配置 token，跳过`);
        continue;
      }
      const ac = new AbortController();
      const monitor = monitorWeixinAccount({
        account,
        onMessage,
        abortSignal: ac.signal,
      });
      monitor.catch((err) => logger.error(`monitor ${id} crashed: ${String(err)}`));
      stopFns.push(() => ac.abort());
    } catch (err) {
      logger.error(`resolve account ${id} failed: ${String(err)}`);
    }
  }
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      for (const stop of stopFns) stop();
    }, { once: true });
  }
  return () => {
    for (const stop of stopFns) stop();
  };
}
