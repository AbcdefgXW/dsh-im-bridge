#!/usr/bin/env node
/**
 * weixin-monitor.mjs — 独立微信监控测试（不带 dsh 桥）
 *
 *   node scripts/weixin-monitor.mjs
 *     → 轮询已配置账户的消息，打印到 stdout
 * 用于验证协议层链路（登录 → 收消息），不依赖 dsh 插件环境。
 */
import { monitorWeixinAccount, sendWeixinText } from "../lib/weixin/adapter.js";
import { listWeixinAccountIds, resolveWeixinAccount } from "../dist/protocol/auth/accounts.js";
import { logger } from "../dist/protocol/util/logger.js";

const ids = listWeixinAccountIds();
if (ids.length === 0) {
  console.error("没有已配置的微信账户，先运行: node scripts/weixin-login.mjs start");
  process.exit(1);
}

console.log(`检测到 ${ids.length} 个账户，开始监控（收到消息会自动回复验证，Ctrl+C 退出）...`);
for (const id of ids) {
  const account = resolveWeixinAccount(id);
  if (!account.configured) {
    console.error(`账户 ${id} 未配置 token，跳过`);
    continue;
  }
  monitorWeixinAccount({
    account,
    onMessage: async (text, peerId, contextToken) => {
      console.log(`\n[收消息] from=${peerId}`);
      console.log(`[文本] ${text}`);
      const replyText = `【守一测试】收到你的消息：${text}`;
      try {
        await sendWeixinText(account, peerId, replyText, contextToken);
        console.log(`[已回复] ${replyText}`);
      } catch (err) {
        console.error(`[回复失败] ${String(err)}`);
      }
    },
  }).catch((err) => logger.error(`monitor ${id} crashed: ${String(err)}`));
}

// 保持进程存活
await new Promise(() => {});
