# Changelog

All notable changes to **Hermes Connect** (`com.even.hermesconnect`), the Even Realities G2 glasses client for the self-hosted Hermes agent gateway.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.7] - 2026-05-27

### Added
- Home menu boot flow: the app now launches into a homepage menu with replay history instead of going straight into a session.
- Local persistence of glasses turns, plus `.env` key support for prefilling credentials.

## [0.2.6] - 2026-05-27

### Added
- Named conversation labels with a glasses-side session picker.

## [0.2.5] - 2026-05-27

### Added
- Tap-to-interrupt gesture: a temple tap now interrupts during the transcribing, thinking, and streaming states.

## [0.2.4] - 2026-05-27

### Changed
- ASCII spinner used consistently across all states; removed the blinking cursor.
- Longer stream timeouts to reduce premature cut-offs on slow replies.

## [0.2.3] - 2026-05-26

### Added
- Hermes stream timeouts: 30 s total budget plus a 10 s no-event watchdog.
- Glyph-mutation animations driven by `tickIndex`.
- Char-based scrolling for long replies in the displaying state.
- Per-state content rendering matching the spec state table.
- 3-zone display layout (28 / 232 / 28) with a dedicated footer container.

### Changed
- Displayed replies now have markdown stripped before rendering.
- Dev setup form prefills from `VITE_HERMES_*` / `VITE_STT_*` env vars.

## [0.2.2] - 2026-05-26

### Added
- SSE streaming from Hermes with live tool-progress events.

## [0.2.1] - 2026-05-25

### Fixed
- Subscribe to `sysEvent` for temple taps, not only `textEvent`.
- Normalize `eventType` through the SDK `fromJson` to catch string-form taps.
- Ignore transient `None` / `Connecting` device states; only react to an explicit disconnect.

### Changed
- Widened the mock dev-bridge fallback timeout from 500 ms to 3000 ms.

### Docs
- Glasses UI affordances + streaming + scroll spec; Hermes API feature backlog.

## [0.2.0] - 2026-05-22

### Added
- Boot router and Hermes Connect app metadata.
- Event/effect dispatcher with bridge subscriptions over a pure `reduce(state, event)` state machine for the gesture flow.
- Phone DOM setup form with **Test Hermes**, **Test STT**, and **Save & launch**.
- Serialized `textContainerUpgrade` render queue with per-state composers.
- Mock bridge in dev mode so the browser can exercise the setup form.

## [0.1.0] - 2026-05-22

### Added
- Initial import of the Even Hub hello-world scaffold and design artifacts.
- Hermes `/v1/responses` client with `extractText` over `output[].content[].text`.
- OpenAI-compatible `/v1/audio/transcriptions` STT client.
- `PcmRecorder` audio buffer with a `MIN_USEFUL_BYTES` guard.
- `pcmToWav` encoder for 16 kHz mono 16-bit PCM.
- Typed config load/save over `bridge.localStorage` with defaults.
- Vitest harness (node env) with a `test:run` script.

[0.2.7]: https://example.invalid/compare/0.2.6...0.2.7
[0.2.6]: https://example.invalid/compare/0.2.5...0.2.6
[0.2.5]: https://example.invalid/compare/0.2.4...0.2.5
[0.2.4]: https://example.invalid/compare/0.2.3...0.2.4
[0.2.3]: https://example.invalid/compare/0.2.2...0.2.3
[0.2.2]: https://example.invalid/compare/0.2.1...0.2.2
[0.2.1]: https://example.invalid/compare/0.2.0...0.2.1
[0.2.0]: https://example.invalid/compare/0.1.0...0.2.0
[0.1.0]: https://example.invalid/releases/tag/0.1.0
