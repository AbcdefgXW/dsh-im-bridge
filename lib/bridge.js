/**
 * bridge.js — dsh 会话桥核心
 *
 * 把 IM 渠道消息注入 dsh agent 会话，取回复回传。
 * 依赖 dsh 服务（agents / sessions / agentDefaultModel），由插件入口注入 ctx。
 *
 * 会话映射：channel+peerId → 固定 SessionId → resume（有持久化会话）或 create。
 * 同一人同一渠道 = 同一会话，记忆连续。
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** agent 工作区根：可用 DSH_CHANNELS_CWD 覆盖（迁移工作区时设置）。 */
const WORKSPACE_CWD = process.env.DSH_CHANNELS_CWD?.trim() || "/workspace";

/** 插件根目录（跟随插件文件位置，随目录整体迁移）。 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 诊断日志：写到 dsh-im-bridge 状态目录，供排查。 */
function diagLog(msg) {
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

/**
 * 从 session.events 聚合最后一次 assistant 文本回复。
 * 参考 dsh-headless 的 summarize 实现。
 */
function summarize(events, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "turn/start") {
      started = true;
      continue;
    }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (joined !== "") text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  return { text, reason };
}

export function createBridge(ctx) {
  // 每个 sessionId 一个串行队列，避免并发交错
  const queues = new Map();

  function withLock(sessionId, fn) {
    const prev = queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(sessionId, next.catch(() => {}));
    return next;
  }

  async function runTurn(sessionId, text, keepAlive = false) {
    const agents = ctx.get("agents");
    const sessions = ctx.get("sessions");
    const defaultModel = ctx.get("agentDefaultModel");
    if (!agents || !sessions || !defaultModel) {
      throw new Error("bridge: agents/sessions/agentDefaultModel 服务不可用");
    }

    const selection = defaultModel.currentSelection();
    const agentOptions = {
      provider: selection.provider,
      model: selection.model,
    };
    const meta = { cwd: WORKSPACE_CWD };

    // 挂载守一人设预设（persona + 工具集），与主会话一致
    const presets = ctx.get("agentPresets");
    let presetId;
    let presetSetup;
    if (presets) {
      try {
        const resolved = await presets.resolve(undefined); // 默认预设（settings: shouyi）
        presetId = resolved.id;
        presetSetup = async (agentCtx) => {
          diagLog(`setup 开始（agentCtx scope=${typeof agentCtx}）`);
          try {
            installModelSelection(agentCtx, { current: selection, assembled: void 0 });
            diagLog("installModelSelection OK");
          } catch (imsErr) {
            diagLog(`installModelSelection 失败: ${String(imsErr)}`);
          }
          try {
            await presets.mount(agentCtx, presetId);
            diagLog(`mount 完成: ${presetId}`);
          } catch (mountErr) {
            diagLog(`mount 失败: ${String(mountErr)}`);
          }
        };
        diagLog(`使用预设: ${presetId}`);
      } catch (presetErr) {
        diagLog(`预设解析失败（跳过，使用默认）: ${String(presetErr)}`);
      }
    }
    const withPreset = (options) => ({
      ...options,
      ...(presetId ? { meta: { ...(options.meta ?? {}), agentPreset: presetId } } : {}),
      ...(presetSetup ? { setup: presetSetup } : {}),
    });

    // 诊断：记录 store 现状
    try {
      const liveSessions = sessions.list ? sessions.list().map((s) => s.id) : [];
      diagLog(`处理消息前 store 内会话: ${JSON.stringify(liveSessions)}`);
    } catch (diagErr) {
      console.error(`bridge: 诊断失败: ${String(diagErr)}`);
    }

    let handle;
    // 1) 已有 live agent（dsh 恢复/上次残留）→ 直接复用，避免 resume/create 撞"已存在"
    const liveAgent = agents.get(sessionId);
    if (liveAgent) {
      const livePreset = liveAgent.session?.header?.agentPreset;
      if (livePreset) {
        diagLog(`复用 live agent（预设=${livePreset}）: ${sessionId}`);
        handle = { agent: liveAgent, dispose: null };
      } else {
        // 无预设的白纸 agent：不复用（保持其存活，走 resume 会撞 live，这里只告警并继续复用）
        diagLog(`⚠️ live agent 无预设（${sessionId}），复用时可能缺少人设/工具`);
        handle = { agent: liveAgent, dispose: null };
      }
    } else {
      try {
        // 2) 优先恢复持久化会话（同一人同一渠道记忆连续）；withPreset 带 setup 挂载守一人设
        handle = await agents.resume(withPreset({
          resumeSessionId: sessionId,
          meta,
          agentOptions,
        }));
      } catch (resumeErr) {
        diagLog(`resume 失败: ${resumeErr instanceof Error ? (resumeErr.stack ?? resumeErr.message) : String(resumeErr)}`);
        // 3) 无持久化会话 → 新建
        try {
          handle = await agents.create(withPreset({
            sessionId,
            meta,
            agentOptions,
          }));
        } catch (createErr) {
          diagLog(`create 失败: ${createErr instanceof Error ? (createErr.stack ?? createErr.message) : String(createErr)}`);
          throw new Error(
            `resume 失败: ${resumeErr instanceof Error ? resumeErr.message : String(resumeErr)}; ` +
            `create 失败: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
          );
        }
      }
    }

    // handle = { agent, dispose }（dispose 由 agent-loop 的 publish 返回）
    const { agent, dispose } = handle;
    try {
      await agent.whenIdle();
      const firstSeq = agent.session.seq;
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: { kind: "user" },
        }),
      );
      await agent.whenIdle();
      await sessions.flush(agent.session);
      return summarize(agent.session.events, firstSeq);
    } finally {
      // keepAlive：会话常驻 store（左侧会话列表可见、下次消息直接复用）
      // 非 keepAlive：用完释放（摘除 registry + store），否则同 session 下次 create 会冲突
      if (!keepAlive && typeof dispose === "function") {
        try {
          await dispose();
        } catch (disposeErr) {
          diagLog(`dispose 失败: ${String(disposeErr)}`);
        }
      }
    }
  }

  /**
   * 处理一条渠道入站消息。
   * @param {object} opts
   * @param {string} opts.channel  渠道标识（weixin / qq / feishu）
   * @param {string} opts.peerId   用户标识（openid / user_id）
   * @param {string} opts.text     消息文本
   * @param {(reply: string) => Promise<void>} opts.reply 回传函数
   * @param {boolean} [opts.keepAlive] 会话常驻（默认 false；true 时左侧列表可见）
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function inbound({ channel, peerId, text, reply, keepAlive = false }) {
    const sessionId = SessionId(`ch-${channel}-${peerId}`);
    return withLock(sessionId, async () => {
      try {
        const outcome = await runTurn(sessionId, text, keepAlive);
        if (outcome.reason?.kind === "error") {
          const errText = `处理出错：${outcome.reason.error?.message ?? "未知错误"}`;
          await reply?.(errText).catch(() => {});
          return { ok: false, error: errText };
        }
        if (outcome.text) {
          await reply?.(outcome.text).catch(() => {});
        }
        return { ok: true };
      } catch (err) {
        const msg = `桥接处理失败：${err instanceof Error ? err.message : String(err)}`;
        await reply?.(msg).catch(() => {});
        return { ok: false, error: msg };
      }
    });
  }

  return { inbound, runTurn };
}
