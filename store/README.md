# Store screenshots / 商店截图

**Un-processed original screenshots**, captured from the official **EvenHub Simulator**
(`@evenrealities/evenhub-simulator`, endpoint `GET /api/screenshot/glasses`). They are the glasses
framebuffer exactly as the simulator renders it — **576 × 288 RGBA, pure-green (`#00FF00`) text on a
transparent background** — with no post-processing.

这些图是**未加工的原始截图**,由官方 **EvenHub 模拟器**导出(`GET /api/screenshot/glasses`),
即模拟器渲染出的眼镜帧缓冲原样:**576 × 288 RGBA、纯绿(#00FF00)文字、透明底**,未经任何后处理。

| File | Screen |
|---|---|
| `01-root.png` | Root page — `/` and the `Desktop` entry |
| `02-sessions.png` | Session list — windowed menu (5 items + `...`) |
| `03-reply-thinking.png` | Reply page mid-stream, status bar showing `thinking` |

## Synthetic content / 内容为合成样例

Session titles, the request and the reply are made-up samples: the plugin was driven against a local
**mock gateway** (canned `/api/sessions`, `/api/sessions/{id}/messages` and a slow
`/api/sessions/{id}/chat/stream` SSE), so no real user data appears in these images.
会话标题、请求与回复均为编造样例 —— 抓图时插件指向的是本地 mock 网关,不含任何真实用户数据。

## How to regenerate / 如何重现

1. Run the app in the simulator with automation enabled:
   `evenhub-simulator "http://127.0.0.1:5173/?demo=1" --automation-port 9898`
2. Drive it and capture:
   - `POST /api/input` body `{"action":"click"}` to enter the session list, `{"action":"down"}` to move
     the cursor, `{"action":"click"}` again to open a session;
   - `GET /api/screenshot/glasses` returns the current frame as a 576×288 RGBA PNG.

The screenshots must be taken with a **fresh simulator process** — reloading the page while a page
already exists makes the glasses reject `createStartUpPageContainer`.
