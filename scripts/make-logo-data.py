"""生成 dev/src/logo-data.ts:开屏动画用的两个 LOGO 素材(PNG,base64)。

1) MARK     : 插件自己的 "He" 图标(even hub/icon-96.png),保持原始 96px 像素大小,
              居中放进 SIZE 画布 —— 观感不变,与头像共用同一容器尺寸
2) PORTRAIT : Hermes 桌面端的黑白头像(hermes-agent/apps/desktop/assets/icon.png),
              「亮卡片 + 暗线稿人像」→ 直接沿用原 polarity(眼镜上暗=不发光)

处理要点:
- **去斑**:源图下边缘有一小块与卡片不相连的孤立亮点(用户看到的多余亮点)→ 用连通块过滤删掉
- **裁边顶格**:裁掉卡片外的黑边后再缩放到 SIZE(容器上限 288x144),让头像尽量大
- **量化 16 级灰**:面板是 4bit;最低档必须严格为 0(否则背景会微微发亮)

用法(在 dev/ 目录):python scripts/make-logo-data.py
"""
import base64
import io
import os
from collections import deque

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK_SRC = os.path.join(ROOT, "icon-96.png")
PORTRAIT_SRC = r"C:\Users\Administrator\AppData\Local\hermes\hermes-agent\apps\desktop\assets\icon.png"
OUT = os.path.join(ROOT, "src", "logo-data.ts")
SIZE = 144  # 图像容器上限 288x144
MARK_GLYPH = 96  # He 图标保持原始像素大小
LEVELS = 16
SPECKLE_TH = 40  # 去斑阈值(低于此亮度视为背景)
SPECKLE_MIN = 80  # 小于这么多像素的孤立连通块视为噪点
EDGE_TRIM = 3  # 圆角遮罩把边缘切掉的像素数(@SIZE)


def quantize(img: Image.Image) -> Image.Image:
    """量化到 LEVELS 级灰(面板 4bit)。最低档严格落回 0,避免背景发光。"""
    scale = 255 / (LEVELS - 1)
    return img.point(lambda v: min(255, round(v / scale) * int(round(scale))))


def drop_speckles(img: Image.Image, th: int = SPECKLE_TH, min_px: int = SPECKLE_MIN) -> Image.Image:
    """删掉与主体不相连的小亮点(8 邻域连通块 < min_px 的全部置 0)。"""
    w, h = img.size
    px = list(img.getdata())
    seen = bytearray(w * h)
    out = [0] * (w * h)
    for start in range(w * h):
        if seen[start] or px[start] <= th:
            continue
        comp = []
        q = deque([start])
        seen[start] = 1
        while q:
            i = q.popleft()
            comp.append(i)
            x, y = i % w, i // w
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and px[j] > th:
                            seen[j] = 1
                            q.append(j)
        if len(comp) >= min_px:
            for i in comp:
                out[i] = px[i]  # 保留原始灰度(不要二值化,否则卡片细节全丢)
    return Image.frombytes("L", (w, h), bytes(out))


def fit_square(img: Image.Image, size: int) -> Image.Image:
    """按内容 bbox 裁剪后,保持长宽比居中放进 size x size 黑底画布。"""
    bbox = img.getbbox() or (0, 0, img.size[0], img.size[1])
    card = img.crop(bbox)
    side = max(card.size)
    canvas = Image.new("L", (side, side), 0)
    canvas.paste(card, ((side - card.size[0]) // 2, (side - card.size[1]) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def mark_png() -> Image.Image:
    """He 图标:白图案 + 黑底,保持 96px 原始像素,居中放进 SIZE 画布。"""
    im = Image.open(MARK_SRC).convert("RGBA")
    w, h = im.size
    glyph = Image.new("L", (w, h), 0)
    gp, src = glyph.load(), list(im.getdata())
    for i, q in enumerate(src):
        if q[3] > 0:
            gp[i % w, i // w] = 255
    canvas = Image.new("L", (SIZE, SIZE), 0)
    canvas.paste(glyph, ((SIZE - w) // 2, (SIZE - h) // 2))
    return canvas


def card_interior(img: Image.Image, th: int = 40, erode: int = 9) -> Image.Image:
    """卡片轮廓填洞后向内腐蚀若干像素 —— 用来把"加粗细线"限制在卡片内部。
    实现用 PIL 的 floodfill(C 语言实现):早先那版纯 Python BFS 在 1024x1024 上会
    直接把进程搞崩(exit 127,无 traceback),不要再用。"""
    w, h = img.size
    work = img.point(lambda v: 255 if v > th else 0)
    # 从四角泛洪标记"卡片外部"(卡片边缘是闭合的,不会漏进去)
    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(work, seed, 128, thresh=10)
    sil = work.point(lambda v: 0 if v == 128 else 255)
    return sil.filter(ImageFilter.MinFilter(erode)) if erode > 1 else sil


def emphasize_lines(img: Image.Image, th: int = 80, dilate: int = 5, erode: int = 9) -> Image.Image:
    """把细暗线(五官/描边)先膨胀再缩放,否则 1024->144 的 7 倍缩放会把 1px 级的
    暗线平均成浅灰,量化后直接消失(实测:鼻子/嘴会看不见)。
    注意只作用于卡片内部,保住外缘的平滑。"""
    interior = card_interior(img, erode=erode)
    dark = img.point(lambda v: 255 if v < th else 0)
    grown = dark.filter(ImageFilter.MaxFilter(dilate))
    mask = ImageChops.multiply(grown, interior)
    forced = Image.new("L", img.size, 0)
    return Image.composite(forced, img, mask)


def portrait_png() -> Image.Image:
    """头像:去斑 -> 加粗细暗线 -> 裁边顶格 -> 套圆角遮罩(边缘切掉 2~3px)。
    保持原 polarity(亮卡片/暗人像)。"""
    raw = Image.open(PORTRAIT_SRC).convert("L")
    clean = drop_speckles(raw)
    sil = card_interior(clean, erode=1)          # 卡片轮廓(未腐蚀)
    r_src = card_radius(sil)
    side_src = sil.getbbox()[2] - sil.getbbox()[0]
    bold = emphasize_lines(clean)
    card = fit_square(bold, SIZE)
    return apply_card_mask(card, inset=EDGE_TRIM, radius_src=r_src, src_side=side_src)


def card_radius(sil: Image.Image) -> int:
    """从卡片轮廓估计圆角半径:圆角处左边界到达整体最左 x 的那一行即约为半径。"""
    w, h = sil.size
    px = sil.load()
    bbox = sil.getbbox()
    if not bbox:
        return 0
    x0, y0 = bbox[0], bbox[1]
    for k in range(1, h // 2):
        if px[x0, y0 + k] > 128:
            return k
    return 0


def rounded_square_mask(size: int, inset: int, radius: int) -> Image.Image:
    """圆角正方形遮罩:把边缘切掉 inset px,并把角做成半径 radius 的圆角。"""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset],
                        radius=max(0, radius), fill=255)
    return m


def apply_card_mask(img: Image.Image, inset: int = 3, radius_src: int = 0, src_side: int = 0) -> Image.Image:
    """按原卡片几何生成圆角遮罩并套用(边缘 2~3px 直接切掉,视觉上更干净平滑)。"""
    size = img.size[0]
    scale = size / src_side if src_side else 1.0
    radius = int(round(radius_src * scale)) - inset if radius_src else int(size * 0.2)
    return ImageChops.multiply(img, rounded_square_mask(size, inset, max(0, radius)))


def png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    quantize(img).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def ts_literal(b64: str, indent: str = "  ") -> list:
    parts = [b64[i:i + 96] for i in range(0, len(b64), 96)]
    return [f"{indent}'{p}'" + ("" if n == len(parts) - 1 else " +") for n, p in enumerate(parts)]


def main() -> None:
    mark = png_b64(mark_png())
    portrait = png_b64(portrait_png())
    lines = [
        "// AUTO-GENERATED by scripts/make-logo-data.py — do not edit by hand.",
        f"// 开屏动画的两个 LOGO 素材:{SIZE}x{SIZE} PNG 字节(base64)。",
        "// 宿主要求真实图片文件字节;裸灰度数组会 sendFailed(实测)。",
        "",
        f"export const LOGO_SIZE = {SIZE}",
        "",
        f"/** 插件自己的 He 图标(原始 {MARK_GLYPH}px,居中于 {SIZE} 画布) */",
        "export const LOGO_MARK_PNG_BASE64 =",
    ]
    lines += ts_literal(mark)
    lines += ["", "/** Hermes 桌面端黑白头像(已去斑、裁边顶格) */", "export const LOGO_PORTRAIT_PNG_BASE64 ="]
    lines += ts_literal(portrait)
    lines += [
        "",
        "function decode(b64: string): Uint8Array {",
        "  const bin = atob(b64)",
        "  const out = new Uint8Array(bin.length)",
        "  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)",
        "  return out",
        "}",
        "",
        "export function logoMarkBytes(): Uint8Array { return decode(LOGO_MARK_PNG_BASE64) }",
        "",
        "export function logoPortraitBytes(): Uint8Array { return decode(LOGO_PORTRAIT_PNG_BASE64) }",
    ]
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} B) | mark b64 {len(mark)} | portrait b64 {len(portrait)}")


if __name__ == "__main__":
    main()
