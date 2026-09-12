# Hermes Connect

A voice client for [Even Realities G2](https://www.evenrealities.com/) smart glasses that talks to your **self-hosted [Hermes](https://github.com/) agent gateway**. Tap a temple, speak, and the agent's reply streams onto the lenses — with live tool-progress and scrollable long answers. No cloud account, no middleman: the phone-side WebView talks directly to endpoints you control.

> Even Hub package id: `com.even.hermesconnect`

## How it works

One Vite + TypeScript bundle drives two surfaces:

- **Setup view** — a DOM form on the phone where you point the app at your Hermes gateway and speech-to-text host, test each connection, and launch.
- **Glasses runtime** — a state machine driving the G2 display through the `EvenAppBridge`: idle → recording → transcribing → thinking → streaming → displaying.

```
 ┌────────┐   tap + speak    ┌─────────────┐  /v1/audio/transcriptions  ┌──────────────┐
 │  G2    │ ───────────────► │ Hermes      │ ─────────────────────────► │ STT host     │
 │ glasses│                  │ Connect     │                             │ (Whisper-ish)│
 │        │ ◄─────────────── │ (this app)  │  /v1/responses (SSE)        ┌──────────────┐
 └────────┘  streamed reply  └─────────────┘ ──────────────────────────► │ Hermes agent │
                                                                          └──────────────┘
```

Both back ends are **OpenAI-compatible**:
- **Hermes gateway** — `/v1/responses`, Bearer auth, SSE streaming with tool-progress events.
- **Speech-to-text** — any `/v1/audio/transcriptions` endpoint (faster-whisper-server, OpenAI cloud, Groq, …).

The pure modules (state machine, audio encoder, HTTP clients, markdown stripper) are isolated from the SDK, so the unit tests run without a glasses bridge.

## Features

- 🎙️ Voice query from the glasses mic → 16 kHz mono WAV → STT → Hermes
- 📡 SSE streaming of the reply with live tool-progress labels
- ✋ Tap-to-interrupt during transcribing / thinking / streaming
- 📜 Char-based scrolling for long replies, markdown stripped for the lens
- 🏠 Home menu with replay history and named conversation sessions
- 🧩 3-zone display layout (header / body / footer) per the UI spec

## Requirements

- Node 18+
- An Even Realities G2 + the Even Hub app (`min_app_version` 2.0.0, `min_sdk_version` 0.0.10)
- A reachable Hermes agent gateway and an OpenAI-compatible STT endpoint

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: prefill the dev setup form
npm run dev                   # browser dev with a mock glasses bridge
npm run test:run             # unit tests (Vitest)
```

In dev mode a mock bridge lets you exercise the setup form in a plain browser. API keys come from `.env.local` (gitignored) for convenience — saved values in glasses storage always win.

## Build & install on the glasses

```bash
npm run build                                          # → dist/
npx evenhub pack app.json dist -o hermes-connect.ehpk  # → installable package
```

Then sideload `hermes-connect.ehpk` via the Even Hub app (or serve it and scan a QR with `npx evenhub qr`).

> **Network whitelist:** `app.json` only permits network calls to hosts listed in the `network` permission. The committed values are placeholders (`your-hermes-host`, `your-stt-host`) — replace them with your actual Hermes and STT endpoints before packing, or the calls will be blocked.

## Configuration

Everything is configured at runtime from the phone setup screen and persisted in glasses storage. The `.env.*` files only prefill the dev form. See [`.env.example`](.env.example) for the available keys.

## License

[MIT](LICENSE) © 2026 Adrian Kay
