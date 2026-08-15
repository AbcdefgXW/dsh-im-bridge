/**
 * adapter.js — 飞书适配器（开放平台官方长连接）
 *
 * 用 @larksuiteoapi/node-sdk：
 *   - WSClient 长连接事件订阅（无需公网回调地址）
 *   - EventDispatcher 注册 im.message.receive_v1
 *   - client.im.message.create 回复文本
 *
 * 凭证：state/feishu/accounts.json（scripts/feishu-login.mjs 或 File Station 填写）
 */
import { Client, EventDispatcher, WSClient, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { listFeishuAccounts } from "./credentials.js";
import { diagLog } from "../diag.js";

/** 从消息事件提取文本。 */
export function extractFeishuText(event) {
  try {
    const msg = event?.message;
    if (!msg) return "";
    if (msg.message_type !== "text") return ""; // 图片/文件等暂不处理
    const content = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
    return typeof content?.text === "string" ? content.text.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 启动一个飞书应用（长连接）。
 * @param {object} account {appId, appSecret}
 * @param {object} opts
 * @param {(text: string, peerKey: string, event) => Promise<void>} opts.onMessage
 * @returns {Promise<{client, stop: () => void}>}
 */
export async function startFeishuAccount(account, { onMessage }) {
  const client = new Client({
    appId: account.appId,
    appSecret: account.appSecret,
    loggerLevel: LoggerLevel.info,
  });

  const dispatcher = new EventDispatcher({
    loggerLevel: LoggerLevel.error,
  }).register({
    "im.message.receive_v1": async (data) => {
      const event = data?.event ?? data;
      const text = extractFeishuText(event);
      if (!text) return;
      const sender = event?.sender?.sender_id;
      const openId = sender?.open_id ?? sender?.user_id ?? sender?.union_id ?? "";
      const chatType = event?.message?.chat_type ?? "p2p";
      if (!openId) return;
      // 会话键：p2p 用用户 openid；群聊用 chat_id:发送者
      const peerKey = chatType === "group" ? `group:${event.message.chat_id}:${openId}` : `p2p:${openId}`;
      diagLog(`[feishu ${account.appId}] 收到消息 ${chatType} from=${openId} text="${text.slice(0, 40)}"`);
      Promise.resolve(onMessage(text, peerKey, event, client)).catch((err) => {
        diagLog(`[feishu ${account.appId}] onMessage 失败: ${String(err)}`);
      });
    },
  });

  const ws = new WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    loggerLevel: LoggerLevel.error,
    source: "dsh-im-bridge",
  });

  await ws.start({ eventDispatcher: dispatcher });
  diagLog(`[feishu ${account.appId}] 长连接已启动`);
  return { client, stop: () => ws.disconnect() };
}

/** 发送文本消息。 */
export async function sendFeishuText(client, openId, text) {
  await client.im.message.create({
    params: { receive_id_type: "open_id" },
    data: {
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

/**
 * 启动所有已配置飞书应用。
 * @returns {Promise<{accounts: Map<string, {client, openId?}>, stop: () => void}>}
 */
export async function startFeishuBots({ onMessage }) {
  const accounts = listFeishuAccounts();
  const runtimes = new Map();
  const stops = [];

  for (const account of accounts) {
    try {
      const runtime = await startFeishuAccount(account, { onMessage });
      runtimes.set(account.appId, runtime.client);
      stops.push(runtime.stop);
      diagLog(`[feishu] 应用 ${account.appId} 已启动`);
    } catch (err) {
      diagLog(`[feishu] 应用 ${account.appId} 启动失败: ${String(err)}`);
    }
  }

  return {
    clients: runtimes,
    stop: () => {
      for (const stop of stops) stop();
    },
  };
}
