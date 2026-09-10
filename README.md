# Even Hermes

Turn **Even Realities G2** smart glasses into a pocket front-end for **Hermes**: browse your
Hermes sessions on the glasses, ask questions by voice, and watch replies stream in word by
word — while the phone page handles configuration, typing and image attachments.

🇨🇳 **[中文说明 / Chinese version ↓](#中文)**

---

## What it is

- **Glasses = mic + screen.** Pick a session, press the temple to talk; the transcript and the
  streamed reply appear on the G2 display.
- **Phone = config + typing.** The plugin's phone page can type (or attach an image) and send —
  exactly the same path as voice.
- **Hermes = the brain.** The plugin talks to your own Hermes HTTP API
  (`/api/sessions/{id}/chat/stream`), so replies **continue the same desktop session** — history
  is shared with your desktop/phone Hermes.
- **STT = the ears.** Speech-to-text is either a local `faster-whisper` server or any
  OpenAI-compatible transcription endpoint you choose.

Everything is **self-hosted**: your gateway, your keys, your machine.

## Repository layout

| Path | What it is |
|---|---|
| `even hub/` | **Plugin source** (TypeScript + Vite). Builds into `even-hermes.ehpk`, which you upload to Even Hub. |
| `even-hermes-skill/` | **Companion Hermes skill**: bilingual 6-step setup guide + helper scripts (start gateway / start STT / check CORS) + pitfalls manual. |
| `store/` | **Store screenshots** rendered at the real 576×288 glasses canvas (synthetic content). |

## Quick start

### 1. Install the skill

```bash
cp -r even-hermes-skill ~/.hermes/skills/even-hermes      # Linux/macOS
# Windows: copy the folder to %LOCALAPPDATA%\hermes\skills\even-hermes
```

Then just ask Hermes to **“set up Even Hermes”** — it walks you through six steps:
how it works → configure the gateway (with security notes) → check & fix the CORS bug →
remote access (tunnel) → speech-to-text (local or cloud) → phone setup & usage.

### 2. Build the plugin

```bash
cd "even hub"
npm ci
npm run release      # vite build → release guard → evenhub pack
```

`npm run release` runs three things in order:

1. `vite build`;
2. `node scripts/check-release.mjs` — **release guard**: aborts if `dist/` or `app.json`
   contains a long hex string (suspected key), an `sk-…` token, or any non-placeholder URL;
3. `evenhub pack app.json dist -o even-hermes.ehpk --sdk-ver 0.0.15`.

Published artifacts are **key-free and URL-free**: every field (gateway base URL, API key, model,
STT endpoint) is entered on the phone settings page and stored locally by the Even App.

The packed artifact is always named `even-hermes.ehpk` (package id `com.pb208.evenhermes`,
display name `Even Hermes`).

⚠️ Always pack `dist` — packing `.` (the whole folder) yields a ~45 MB black-screen bundle.
⚠️ `@evenrealities/evenhub-cli` must be **≥ 0.1.14** (older versions reject `--sdk-ver`).

### 3. Upload and install

- On `hub.evenrealities.com` → your project → **Upload a build** → pick `even-hermes.ehpk` → **Add build**.
- On the phone, install that build from the Even App → Plugins.
- The Even App must satisfy the build's minimum version — with SDK 0.0.15 that is **≥ 2.2.10**.

### 4. Configure

Follow the skill's guided setup: gateway base URL + API key, speech-to-text endpoint, and language
(the 中文 / English buttons also switch the glasses menu and hints).

## Security notes

- **Never expose the gateway (8642) directly to the internet** — use a tunnel and a long random
  `API_SERVER_KEY`.
- **STT must have an API key if it is reachable beyond localhost.** The bundled server refuses to
  start when it binds a non-loopback address with an empty `STT_API_KEY` (opt out explicitly with
  `-AllowNoKey`). No key is only safe for `127.0.0.1`.
- Keys live in your Hermes `.env` (`API_SERVER_KEY`) and on the phone (Even App local storage);
  the plugin sends them in the `Authorization` header and sets no cookies.

## License

See `even hub/LICENSE`.

---

<a id="中文"></a>

# 中文说明

把 **Even Realities G2 智能眼镜**变成 **Hermes** 的随身入口:在眼镜上翻会话、用语音提问、逐字看回复;
手机页面负责配置、打字和发图。

**↑ [English version](#even-hermes)**

## 它是什么

- **眼镜 = 麦克风 + 屏幕**:选一个会话、捏镜腿说话,识别文本和逐字流式回复都显示在 G2 上;
- **手机 = 配置 + 打字**:插件手机页可以直接打字(或附一张图片)发送,**和语音走完全同一条链路**;
- **Hermes = 大脑**:插件调用你自己的 Hermes HTTP API(`/api/sessions/{id}/chat/stream`),
  回复**接续同一个桌面会话**——历史和桌面/手机端 Hermes 互通;
- **STT = 耳朵**:语音识别用本机 `faster-whisper` 服务,或任何你选的 OpenAI 兼容转写端点。

全部**自托管**:你自己的 gateway、自己的 key、自己的机器。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `even hub/` | **插件源码**(TypeScript + Vite)。构建出的 `even-hermes.ehpk` 上传到 Even Hub。 |
| `even-hermes-skill/` | **Hermes 端 skill**:中英双语六步配置引导 + 脚本(启动 gateway / 启动 STT / 检查 CORS)+ 排错手册。 |
| `store/` | **商店截图**:按眼镜真实画布 576×288 渲染(内容为随机样例)。 |

## 快速开始

### 1. 安装 skill

```bash
cp -r even-hermes-skill ~/.hermes/skills/even-hermes      # Linux/macOS
# Windows:把该文件夹复制到 %LOCALAPPDATA%\hermes\skills\even-hermes
```

然后在 Hermes 里说「**配置 Even Hermes**」,它会按六步引导你:
运行逻辑 → 配置 gateway(含安全提示)→ 检查/修复 CORS bug → 远程访问(隧道)→
语音识别(本地或云)→ 手机端配置与使用。

### 2. 构建插件

```bash
cd "even hub"
npm ci
npm run release      # vite build → 发布校验 → evenhub pack
```

`npm run release` 依次做三件事:

1. `vite build`;
2. `node scripts/check-release.mjs` —— **发布闸门**:若 `dist/` 或 `app.json` 里出现长 hex(疑似 key)、
   `sk-…` token,或**任何非占位符的真实网址**就直接中断打包;
3. `evenhub pack app.json dist -o even-hermes.ehpk --sdk-ver 0.0.15`。

发布产物**零 key、零网址**:所有字段(gateway 地址、API key、模型、STT 地址)都在**手机配置页**填写,
由 Even App 存在本机。

打包产物固定叫 `even-hermes.ehpk`(包名 `com.pb208.evenhermes`,显示名 `Even Hermes`)。

⚠️ 一定要打包 `dist`(用 `.` 会把源码/node_modules 打进去 → 约 45 MB 且黑屏)。
⚠️ `@evenrealities/evenhub-cli` 需 **≥ 0.1.14**(旧版本不认 `--sdk-ver`)。

### 3. 上传并安装

- 到 `hub.evenrealities.com` → 你的项目 → **Upload a build** → 选择 `even-hermes.ehpk` → **Add build**;
- 手机 Even App → Plugins 安装该 build;
- Even App 版本需满足 build 的最低要求——SDK 0.0.15 下为 **≥ 2.2.10**。

### 4. 按引导配置

跟着 skill 走:gateway 地址与 key、语音识别端点、语言(「中文 / English」按钮同时决定眼镜端菜单与提示的语言)。

## 安全须知

- **不要把 gateway(8642)直接暴露到公网** —— 走隧道 + 长随机 `API_SERVER_KEY`;
- **STT 只要能被本机以外访问,就必须设 key**:自带的 server 在**非环回监听 + 无 key** 时会**拒绝启动**
  (确要无鉴权需显式 `-AllowNoKey`)。没 key 只适合 `127.0.0.1`;
- key 存放:你的 Hermes `.env`(`API_SERVER_KEY`)+ 手机端(Even App 本地存储);插件只用
  `Authorization` 头发送,不带 cookie。

## 许可

见 `even hub/LICENSE`。
