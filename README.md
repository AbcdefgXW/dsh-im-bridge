# dsh-msg-hub

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
  - 供 dsh-toolbox-web 定时心跳等插件调用（未安装本插件时渠道推送自动不可用，不影响其他功能）
- **📡 远程监控**（离开电脑也能盯任务）：
  - **审批远程批准**：绑定会话的 agent 请求批准时推送到 IM（含工具名/原因/命令详情），回复「批准」或「拒绝」应答；5 分钟超时按拒绝处理（安全默认）
  - **turn 状态推送**：绑定会话的任务开始 / 完成 / 出错 / 被阻塞时实时推送
  - **会话命令**：`/sessions` 列出最近 5 个会话（名称+ID）、`/bind <会话ID>` 绑定、`/status` 查看绑定状态

## 环境要求

- **dsh** 运行时（cordis 插件，需在 dsh web profile 注册）
- **Node.js ≥ 22.13**
- 各渠道凭证：微信扫码 / QQ 开放平台 AppID+Secret / 飞书 AppID+Secret

## 安装

```bash
# 方式一：npm 包（推荐）
dsh plugin --profile web add dsh-msg-hub

# 方式二：GitHub 仓库
dsh plugin --profile web add github:AbcdefgXW/dsh-msg-hub

# 方式三：手动（本地开发/内网）
git clone https://github.com/AbcdefgXW/dsh-msg-hub.git
cd dsh-msg-hub && npm install
# 软链进 profile 并加入 bundles：
cd $DSH_HOME/profiles/web && pnpm link /路径/dsh-msg-hub
# 然后确认 package.json 的 dsh.profile.bundles 包含 dsh-msg-hub
```

> `dsh plugin add` 会自动将本插件加入 profile 的 `dsh.profile.bundles` 并挂载插件自带的注册行（`cordis.patch.yml`），**无需也不应手动修改任何配置文件**。
>
> ⚠️ 排查注册问题时请检查 `package.json` 的 `dsh.profile.bundles` 是否包含 `dsh-msg-hub`；**切勿**再在 profile 的 `cordis.patch.yml` 里手动 `insert` 本插件——bundles 已挂载时手动 insert 会导致 `duplicate loader entry id` 启动崩溃。

重启 `dsh web`。

### 渠道连接指南

**微信（ilinkai 扫码登录）**

```bash
node scripts/weixin-login.mjs login
```

1. 终端显示二维码 → 用微信「扫一扫」扫码确认
2. 登录成功自动保存 token 到 `state/weixin/`，**重启 dsh** 生效
3. 建议使用专用微信号（模拟协议登录，存在风控风险，见「安全提示」）

**QQ（开放平台官方机器人，两种方式）**

先到 [QQ 开放平台](https://q.qq.com) 注册机器人应用，拿到 AppID 与 AppSecret：

```bash
# 方式 A：凭证直填（推荐，机器人已创建时）
node scripts/qq-login.mjs --appid <AppID> --secret <AppSecret>

# 方式 B：扫码绑定（要求该 QQ 账号下已存在机器人应用）
node scripts/qq-login.mjs
```

配置后**重启 dsh** 生效。⚠️ 定时主动推送还需在开放平台**申请「主动消息权限」**，否则推送会静默失败（被动回复不受影响）。

**飞书（开放平台企业自建应用）**

1. 到[飞书开放平台](https://open.feishu.cn)创建「企业自建应用」→ 开启「机器人」能力 → 发布应用
2. 在应用「凭证与基础信息」页复制 AppID 与 AppSecret（需应用管理员权限）

```bash
node scripts/feishu-login.mjs --appid <AppID> --secret <AppSecret>
```

配置后**重启 dsh** 生效。

> 凭证全部保存在插件 `state/` 目录（已 gitignore，不会提交）；三个渠道可同时启用。

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
