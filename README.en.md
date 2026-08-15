# dsh-im-bridge

[English](README.en.md) | [简体中文](README.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.13-blue)

> An IM channel bridge plugin for dsh (DeepSeek Harness): connects WeChat (ilinkai) / QQ (Open Platform) / Feishu (Open Platform) messages into dsh agent sessions, with **proactive push** support (wake the channel bot and deliver the AI reply back to your phone — for scheduled tasks etc.).

## Features

- **📱 WeChat**: ilinkai simulated protocol (QR login), text send/receive
- **💬 QQ**: Tencent Open Platform official WebSocket channel, text send/receive (C2C / group)
- **📡 Feishu**: Feishu Open Platform official API (app credentials), text send/receive (P2P / group)
- **🧩 Proactive push service** (`dsh-channels-push` cordis service):
  - `push({channel, peerId, text})`: send text directly to IM
  - `task({channel, peerId, prompt})`: wake the channel agent to run a task; the AI reply is delivered back to the IM automatically
  - Consumed by plugins like dsh-toolbox's scheduled heartbeat (channel push is unavailable without this plugin; everything else is unaffected)

## Requirements

- **dsh** runtime (cordis plugin, registered in the dsh web profile)
- **Node.js ≥ 22.13**
- Per-channel credentials: WeChat QR / QQ AppID+Secret / Feishu AppID+Secret

## Installation

```bash
git clone https://github.com/USER/dsh-im-bridge.git
cd dsh-im-bridge && npm install
cd $DSH_HOME/profiles/web && pnpm link /path/to/dsh-im-bridge
```

Register in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-im-bridge
      name: dsh-im-bridge
```

Restart `dsh web`.

### Channel login

```bash
node scripts/weixin-login.mjs   # WeChat (QR)
node scripts/qq-login.mjs       # QQ (official channel)
node scripts/feishu-login.mjs --appid <AppID> --secret <AppSecret>  # Feishu
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_CHANNELS_STATE_DIR` | channel state dir (credentials/logs/data) | plugin `state/` dir |
| `DSH_CHANNELS_CWD` | channel agent workspace root | `/workspace` |

## Safety Notes

- **WeChat (ilinkai) uses a simulated web protocol** (not an official API) — **frequent proactive messaging carries account risk-control risk**; keep push frequency low (scheduled interval ≥ 15 minutes)
- **QQ proactive messages require applying for "proactive message permission"** on the Open Platform; without it, proactive pushes fail silently (passive replies are unaffected)
- **Feishu** uses the official API — compliant and safe
- Credentials live in `state/` (excluded via `.gitignore`) — never commit them

## License

MIT
