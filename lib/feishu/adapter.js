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
    source: "dsh-msg-hub",
  });

  await ws.start({ eventDispatcher: dispatcher });
  diagLog(`[feishu ${account.appId}] 长连接已启动`);
  return { client, stop: () => ws.disconnect() };
}

/** 发送文本消息。 */
/** 行内 markdown 解析：**粗体**、`代码`、[文本](链接)、*斜体* → 飞书 post 块。 */
function parseInline(line) {
  const blocks = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) blocks.push({ tag: "text", text: line.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) blocks.push({ tag: "text", text: t.slice(2, -2) }); // 飞书 post 无 b 标签，降级纯文本
    else if (t.startsWith("`")) blocks.push({ tag: "text", text: t.slice(1, -1) }); // code 标签不支持，降级
    else if (t.startsWith("[")) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mm) blocks.push({ tag: "a", text: mm[1], href: mm[2] });
      else blocks.push({ tag: "text", text: t });
    } else blocks.push({ tag: "text", text: t.slice(1, -1) });
    last = m.index + t.length;
  }
  if (last < line.length) blocks.push({ tag: "text", text: line.slice(last) });
  return blocks;
}

/** markdown → 飞书 post 富文本 content 数组（标题/代码块/列表/引用/分隔线/行内样式）。 */
export function mdToFeishuPost(md) {
  const lines = String(md || "").split("\n");
  const content = [];
  let inCode = false;
  let codeBuf = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.trim().startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        inCode = false;
        content.push([{ tag: "text", text: codeBuf.join("\n") }]); // code 标签不支持，降级
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      content.push([{ tag: "text", text: h[2] }]); // 标题降级为文本
      continue;
    }
    if (line.trim().startsWith(">")) {
      content.push([{ tag: "text", text: "▍" + line.trim().replace(/^>\s?/, "") }]);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      content.push(parseInline("• " + li[1]));
      continue;
    }
    const oli = line.match(/^\s*\d+\.\s+(.*)/);
    if (oli) {
      content.push(parseInline("1. " + oli[1]));
      continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      content.push([{ tag: "text", text: "────────────" }]);
      continue;
    }
    if (!line.trim()) {
      content.push([{ tag: "text", text: "" }]);
      continue;
    }
    content.push(parseInline(line));
  }
  if (inCode && codeBuf.length) content.push([{ tag: "text", text: codeBuf.join("\n") }]);
  return content;
}

/** 发一条消息给用户：优先富文本 post（渲染 markdown），失败回退纯文本。 */
export async function sendFeishuText(client, openId, text) {
  try {
    const content = mdToFeishuPost(text);
    await client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: openId,
        msg_type: "post",
        content: JSON.stringify({ zh_cn: { title: "", content } }),
      },
    });
  } catch (err) {
    // 富文本失败（如超长/结构异常）→ 回退纯文本
    diagLog(`[feishu] post 发送失败，回退 text: ${String(err).slice(0, 120)}`);
    await client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: openId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
  }
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
