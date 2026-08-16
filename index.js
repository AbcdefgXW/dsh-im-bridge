/**
 * index.js — dsh-msg-hub cordis 插件入口
 *
 * 挂载进 dsh web profile（cordis.patch.yml），随 dsh 进程启停：
 *   1. 创建 bridge（agents/sessions/agentDefaultModel 服务注入）
 *   2. 启动所有已配置微信账户的 monitor
 *   3. 启动所有已配置 QQ 机器人（WebSocket 官方通道）
 *   4. 渠道消息 → bridge.inbound → 回复回传（各渠道独立会话）
 *
 * 登录不在此处（交互式扫码走 scripts/weixin-login.mjs / qq-login.mjs），
 * 凭证落盘后本插件自动加载对应账户。
 */
import { createBridge } from "./lib/bridge.js";
import { startWeixinMonitors, sendWeixinText } from "./lib/weixin/adapter.js";
import { startQqBots, sendQqText } from "./lib/qq/adapter.js";
import { startFeishuBots, sendFeishuText } from "./lib/feishu/adapter.js";
import { listWeixinAccountIds, resolveWeixinAccount } from "./dist/protocol/auth/accounts.js";
import { logger } from "./dist/protocol/util/logger.js";
import { diagLog } from "./lib/diag.js";
import { Service } from "@deepseek-ai/cordis";

export const name = "dsh-msg-hub";

export const inject = ["agents", "sessions", "agentDefaultModel"];

/**
 * 主动推送服务（供其他插件调用，如 dsh-toolbox 定时心跳推送渠道）。
 * - push({channel, peerId, text})：直接发文本到 IM（不经过 agent）
 * - task({channel, peerId, prompt})：完整流程——唤醒渠道 agent 执行 prompt，回复回传 IM
 * peerId 与 dsh-msg-hub 会话 ID 反推一致（如 ch-weixin-<peerId>）。
 */
export class ChannelsPushApi extends Service {
  constructor(ctx, deps) {
    super(ctx, "dsh-channels-push");
    this.deps = deps; // { bridge, getWeixinAccount, getQqBot, getFeishuClient }
  }

  async push({ channel, peerId, text }) {
    const d = this.deps;
    try {
      if (channel === "weixin") {
        const acc = d.getWeixinAccount();
        if (!acc) return { ok: false, error: "无已配置微信账户" };
        await sendWeixinText(acc, peerId, text);
        return { ok: true, channel, peerId };
      }
      if (channel === "qq") {
        const bot = d.getQqBot();
        if (!bot) return { ok: false, error: "无 QQ bot 在线" };
        // peerKey 形如 c2c:<id> / group:<id>:<sender>；私聊 c2c 直接可发（无 msgId = 主动推送）
        if (String(peerId).startsWith("c2c:")) {
          await sendQqText(bot, { scope: "c2c", targetId: String(peerId).slice(4) }, text);
          return { ok: true, channel, peerId };
        }
        return { ok: false, error: "QQ 群聊推送暂不支持（仅 c2c 私聊）" };
      }
      if (channel === "feishu") {
        const client = d.getFeishuClient();
        if (!client) return { ok: false, error: "无飞书 client 在线" };
        if (String(peerId).startsWith("p2p:")) {
          await sendFeishuText(client, String(peerId).slice(4), text);
          return { ok: true, channel, peerId };
        }
        return { ok: false, error: "飞书群聊推送暂不支持（仅 p2p 私聊）" };
      }
      return { ok: false, error: "未知渠道 " + channel };
    } catch (err) {
      diagLog(`[channels-push] ${channel}/${peerId} 发送失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return { ok: false, error: String(err) };
    }
  }

  /** 唤醒渠道 agent 执行任务，AI 回复自动回传 IM（复用 bridge.inbound 完整流程）。 */
  async task({ channel, peerId, prompt }) {
    const d = this.deps;
    try {
      const outcome = await d.bridge.inbound({
        channel,
        peerId,
        text: prompt,
        keepAlive: true,
        reply: async (replyText) => {
          const r = await this.push({ channel, peerId, text: replyText });
          if (!r.ok) diagLog(`[channels-task] 回传失败 ${channel}/${peerId}: ${r.error}`);
        },
      });
      return { ok: true, outcome };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export function apply(ctx) {
  const bridge = createBridge(ctx);
  const log = ctx.logger ?? logger;

  // 供 ChannelsPushApi 使用的运行时依赖（账户/bot/client 实例）
  let qqBotsMap = new Map();
  let feishuClientsMap = new Map();
  const deps = {
    bridge,
    getWeixinAccount: () => {
      const ids = listWeixinAccountIds();
      for (const id of ids) {
        const acc = resolveWeixinAccount(id);
        if (acc.configured) return acc;
      }
      return null;
    },
    getQqBot: () => (qqBotsMap.size > 0 ? [...qqBotsMap.values()][0] : null),
    getFeishuClient: () => (feishuClientsMap.size > 0 ? [...feishuClientsMap.values()][0] : null),
  };
  new ChannelsPushApi(ctx, deps);
  log.info("dsh-msg-hub: push 服务已提供（dsh-channels-push）");

  // ── 微信 ──
  async function handleWeixinMessage(text, peerId, contextToken) {
    // 找到 peerId 对应的账户（token/contextToken 匹配）；简化：用第一个已配置账户
    const account = resolveFirstConfiguredAccount();
    if (!account) {
      log.warn("没有已配置的微信账户，忽略消息");
      return;
    }
    await bridge.inbound({
      channel: "weixin",
      peerId,
      text,
      keepAlive: true,
      reply: async (replyText) => {
        await sendWeixinText(account, peerId, replyText, contextToken);
      },
    });
  }

  function resolveFirstConfiguredAccount() {
    const ids = listWeixinAccountIds();
    for (const id of ids) {
      const acc = resolveWeixinAccount(id);
      if (acc.configured) return acc;
    }
    return null;
  }

  const stopWeixin = startWeixinMonitors({ onMessage: handleWeixinMessage });
  log.info("dsh-msg-hub: weixin monitors started");

  // ── QQ ──
  const qqRuntime = { bots: new Map(), stop: () => {} };
  startQqBots({
    onMessage: async (text, peerKey, replyTarget, msg, bot) => {
      await bridge.inbound({
        channel: "qq",
        peerId: peerKey,
        text,
        keepAlive: true,
        reply: async (replyText) => {
          await sendQqText(bot, replyTarget, replyText);
        },
      });
    },
  })
    .then((runtime) => {
      qqRuntime.bots = runtime.bots;
      qqBotsMap = runtime.bots;
      qqRuntime.stop = runtime.stop;
      log.info(`dsh-msg-hub: qq bots started (${runtime.bots.size})`);
    })
    .catch((err) => {
      diagLog(`[qq] 启动失败: ${String(err)}`);
    });

  // ── 飞书 ──
  const feishuRuntime = { clients: new Map(), stop: () => {} };
  startFeishuBots({
    onMessage: async (text, peerKey, event, client) => {
      const openId = event?.sender?.sender_id?.open_id ?? "";
      if (!openId) return;
      await bridge.inbound({
        channel: "feishu",
        peerId: peerKey,
        text,
        keepAlive: true,
        reply: async (replyText) => {
          await sendFeishuText(client, openId, replyText);
        },
      });
    },
  })
    .then((runtime) => {
      feishuRuntime.clients = runtime.clients;
      feishuClientsMap = runtime.clients;
      feishuRuntime.stop = runtime.stop;
      log.info(`dsh-msg-hub: feishu bots started (${runtime.clients.size})`);
    })
    .catch((err) => {
      diagLog(`[feishu] 启动失败: ${String(err)}`);
    });

  // 卸载时停止
  ctx.on("dispose", () => {
    log.info("dsh-msg-hub: stopping");
    stopWeixin();
    qqRuntime.stop();
    feishuRuntime.stop();
  });
}
