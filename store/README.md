# Store screenshots / 商店截图

Rendered previews of what the plugin draws on the glasses, for the Even Hub store listing.

插件在眼镜上显示效果的预览图,用于 Even Hub 商店页面。

| File | Screen |
|---|---|
| `01-root.png` | Root page — `/` and the `Desktop` entry |
| `02-sessions.png` | Session list — windowed menu (5 items + `...`) |
| `03-reply-thinking.png` | Reply page while the agent is working (`thinking`) |

**Specs** (per Even docs — `docs/build/display`, `docs/build/design-guidelines`)
- Canvas **576 × 288 px**, origin top-left; containers placed by absolute pixels, no CSS.
- The panel is 4-bit greyscale rendered as **16 levels of green**: white = brightest green, black = off.
- Firmware ships one LVGL font: not monospaced, no size control (previews approximate it).

**Content is synthetic** — session titles, the request and the reply are made-up samples, not real
user data. Regenerate with any renderer that follows the layout in `even hub/src/runtime/render.ts`
(status line = breadcrumb + status word; menu window 5 items + `...`; reply page = `> request` + `Hermes: reply`).
