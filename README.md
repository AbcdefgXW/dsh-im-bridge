# dsh-im-bridge

[English](README.en.md) | [简体中文](README.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.13-blue)

> dsh（DeepSeek Harness）IM 渠道桥插件：把微信（ilinkai）/ QQ（开放平台）/ 飞书（开放平台）的消息接入 dsh agent 会话，并支持**主动推送**（供定时任务等场景唤醒 bot 并把 AI 回复回传手机）。

## 功能

- **📱 微信**：ilinkai 模拟协议（扫码登录），收发文本
- **💬 QQ**：腾讯开放平台官方 WebSocket 通道，收发文本（C2C 私聊 / 群聊）
- **📡 飞书**：飞书开放平台官方 API（应用凭证），收发文本（P2P 私聊 / 群聊）
- **🧩 主动推送服务**（`dsh-channels-push` cordis 服务）：
  - `push({channel, peerId, text})`：直接向 IM 发文本
  - `task({channel, peerId, prompt})`：唤醒渠道 agent 执行任务，AI 回复自动回传 IM
  - 供 dsh-toolbox 定时心跳等插件调用（未安装本插件时渠道推送自动不可用，不影响其他功能）

## 环境要求

- **dsh** 运行时（cordis 插件，需在 dsh web profile 注册）
- **Node.js ≥ 22.13**
- 各渠道凭证：微信扫码 / QQ 开放平台 AppID+Secret / 飞书 AppID+Secret

## 安装

```bash
# 1. 克隆并安装依赖
git clone https://github.com/USER/dsh-im-bridge.git
cd dsh-im-bridge && npm install

# 2. 注册进 dsh profile
cd $DSH_HOME/profiles/web && pnpm link /路径/dsh-im-bridge
```

在 profile 的 `cordis.patch.yml` 加入：

```yaml
- insert:
    - id: dsh-im-bridge
      name: dsh-im-bridge
```

重启 `dsh web`。

### 渠道登录

```bash
# 微信（扫码）
node scripts/weixin-login.mjs
# QQ（官方通道扫码/凭证）
node scripts/qq-login.mjs
# 飞书（直接填 AppID/Secret）
node scripts/feishu-login.mjs --appid <AppID> --secret <AppSecret>
```

## 环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `DSH_CHANNELS_STATE_DIR` | 渠道状态目录（凭证/日志/数据） | 插件 `state/` 目录 |
| `DSH_CHANNELS_CWD` | 渠道 agent 工作区根 | `/workspace` |

## 安全提示

- **微信（ilinkai）为模拟网页协议**，非官方 API——**主动频繁发消息存在账号风控风险**，建议仅低频推送（定时任务间隔 ≥ 15 分钟）
- **QQ 主动消息需在开放平台申请「主动消息权限」**，未开通时主动推送会静默失败（被动回复不受影响）
- **飞书**为官方 API，合规无风险
- 凭证存储于 `state/` 目录（`.gitignore` 已排除），请勿提交

## License

MIT
