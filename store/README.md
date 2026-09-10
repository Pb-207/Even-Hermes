# Store screenshots / 商店截图

Previews of what the plugin draws on the glasses, for the Even Hub store listing.
插件在眼镜上显示效果的预览图,用于 Even Hub 商店页面。

| File | Screen |
|---|---|
| `01-root.png` | Root page — `/` and the `Desktop` entry |
| `02-sessions.png` | Session list — windowed menu (5 items + `...`) |
| `03-reply-thinking.png` | Reply page while the agent is working (`thinking`) |

## Format

- Canvas **576 × 288 px**, origin top-left; containers are placed by absolute pixels (no CSS).
- **Bright-green foreground on a fully transparent background** (`alpha = 0`), so the PNGs can be
  composited over the background image picked from the portal's preset set.
  This matches the panel behaviour: 4-bit greyscale rendered as green, where **black = off = transparent**.
- Firmware ships a single LVGL font: not monospaced, no size control — these previews approximate it.

**Content is synthetic**: session titles, the request and the reply are made-up samples, not real
user data. Regenerate by following the layout in `even hub/src/runtime/render.ts`
(status line = breadcrumb + status word; menu window 5 items + `...`; reply page = `> request` + `Hermes: reply`).
