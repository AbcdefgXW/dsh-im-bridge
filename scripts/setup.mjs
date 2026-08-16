#!/usr/bin/env node
/**
 * setup.mjs — dsh-msg-hub 一键挂载/恢复脚本
 *
 * 容器重构或 dsh 升级后运行：node scripts/setup.mjs
 * 幂等：重复运行安全。
 *
 * 做什么：
 *   1. 校验插件源码与依赖存在
 *   2. 把插件链入 web profile（pnpm link）
 *   3. 在 cordis.patch.yml 写入/校验 insert entry（幂等）
 *   4. dump-config 校验挂载结果
 *   5. 提示重启容器
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 插件根 = 本脚本上两级（scripts/ → 插件根），随目录整体迁移
const CHANNELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = process.env.DSH_HOME
  ? path.join(process.env.DSH_HOME, "profiles", "web")
  : "/home/dsh/profiles/web";
const PATCH_FILE = path.join(PROFILE_DIR, "cordis.patch.yml");

const INSERT_BLOCK = `
# dsh-msg-hub：IM 渠道桥（微信 ilinkai 协议，后续接 QQ/飞书）
# 源码 /workspace/dsh-plugins/dsh-msg-hub/（pnpm link 进 profile node_modules）
# 由 scripts/setup.mjs 管理，请勿手改（升级 dsh 后重跑 setup 即可）
- insert:
    - id: dsh-msg-hub
      name: dsh-msg-hub
`;

function step(title) {
  console.log(`\n▶ ${title}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// 1. 校验源码
step("校验插件源码");
if (!fs.existsSync(path.join(CHANNELS_DIR, "package.json"))) fail(`插件源码不存在: ${CHANNELS_DIR}`);
if (!fs.existsSync(path.join(CHANNELS_DIR, "index.js"))) fail(`插件入口不存在: ${CHANNELS_DIR}/index.js`);
if (!fs.existsSync(path.join(CHANNELS_DIR, "dist", "protocol", "api", "api.js"))) {
  console.log("  协议层未编译，先编译...");
  execSync("npm run build", { cwd: CHANNELS_DIR, stdio: "inherit" });
}
console.log("  OK");

// 2. 链入 profile
step("链入 web profile（pnpm link）");
try {
  execSync("dsh plugin --profile web add " + CHANNELS_DIR, { stdio: "inherit" });
} catch (e) {
  // dsh plugin add 已存在时可能非零退出，容错
  console.log("  (dsh plugin add 输出如上，继续)");
}
const linkPath = path.join(PROFILE_DIR, "node_modules", "dsh-msg-hub");
if (!fs.existsSync(linkPath)) {
  console.log("  用 pnpm 直接链接...");
  // pnpm 可能不在 PATH（corepack 启用未持久），用 corepack 兜底
  const pnpmCmd = (() => {
    try {
      execSync("pnpm --version", { stdio: "ignore" });
      return "pnpm";
    } catch {
      return "corepack pnpm";
    }
  })();
  execSync(`${pnpmCmd} add link:${CHANNELS_DIR}`, { cwd: PROFILE_DIR, stdio: "inherit" });
}
if (!fs.existsSync(linkPath)) fail("插件未能链入 profile node_modules");
console.log("  OK:", linkPath);

// 3. cordis.patch.yml insert entry（幂等）
step("写入 cordis.patch.yml entry（幂等）");
let patch = fs.readFileSync(PATCH_FILE, "utf-8");
const marker = "id: dsh-msg-hub";
if (patch.includes(marker)) {
  console.log("  entry 已存在，跳过");
} else {
  patch = patch.trimEnd() + "\n" + INSERT_BLOCK;
  fs.writeFileSync(PATCH_FILE, patch, "utf-8");
  console.log("  entry 已写入");
}

// 3.5 dsh-toolbox entry 完整性检查（防误删：崩溃排查时曾被手删导致插件丢失）
step("检查 dsh-toolbox entry（缺失自动加回）");
const TOOLBOX_BLOCK = `
# dsh-toolbox：工具箱插件（会话管理/回收站/子目录/搜索/预设编辑/设置分组）
# 源码 /workspace/dsh-plugins/dsh-toolbox/（pnpm link 进 profile node_modules）
- insert:
    - id: dsh-toolbox
      name: dsh-toolbox
`;
let patch2 = fs.readFileSync(PATCH_FILE, "utf-8");
if (patch2.includes("id: dsh-toolbox")) {
  console.log("  dsh-toolbox entry 已存在 ✅");
} else {
  patch2 = patch2.trimEnd() + "\n" + TOOLBOX_BLOCK;
  fs.writeFileSync(PATCH_FILE, patch2, "utf-8");
  console.log("  dsh-toolbox entry 缺失，已自动加回");
}

// 4. dump-config 校验
step("校验配置树");
try {
  const out = execSync("dsh --profile web --dump-config 2>&1", { encoding: "utf-8" });
  if (out.includes("dsh-msg-hub") && out.includes("dsh-toolbox")) {
    console.log("  配置树包含 dsh-msg-hub + dsh-toolbox ✅");
  } else {
    fail("配置树缺失插件（dsh-msg-hub/dsh-toolbox），请检查 " + PATCH_FILE);
  }
} catch (e) {
  fail("dump-config 失败: " + e.message);
}

// 5. 完成
console.log("\n✅ 挂载完成。");
console.log("下一步：重启 dsh 容器（Container Manager / docker compose restart）使插件加载。");
console.log("验证：重启后发微信消息，日志在 " + path.join(CHANNELS_DIR, "state", "logs") + "/");
