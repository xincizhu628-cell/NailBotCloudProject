from pathlib import Path
from PIL import Image, ImageDraw, ImageStat


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "materials" / "fitted"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = (420, 760)
SCALE = 4

SHAPES = {
    "long-oval": dict(kind="oval", x=0.23, y=0.04, w=0.54, h=0.92),
    "short-oval": dict(kind="oval", x=0.17, y=0.19, w=0.66, h=0.62),
    "short-round": dict(kind="oval", x=0.12, y=0.24, w=0.76, h=0.56),
    "short-square": dict(kind="round-square", x=0.17, y=0.19, w=0.66, h=0.62, radius=0.20),
    "medium-square": dict(kind="round-square", x=0.20, y=0.08, w=0.60, h=0.84, radius=0.18),
    "squoval": dict(kind="round-square", x=0.15, y=0.15, w=0.70, h=0.70, radius=0.34),
    "almond": dict(kind="almond", x=0.20, y=0.04, w=0.60, h=0.92, tip=0.08),
    "medium-almond": dict(kind="almond", x=0.18, y=0.11, w=0.64, h=0.80, tip=0.10),
    "short-almond": dict(kind="almond", x=0.14, y=0.19, w=0.72, h=0.68, tip=0.12),
}

MATERIALS = {
    "m123": "single-m123.png",
    "m124": "single-m124.png",
    "m125": "single-m125.png",
    "m126": "single-m126.png",
    "m127": "single-m127.png",
    "m128": "single-m128.png",
    "m130": "single-m130.png",
}


def mask_for(shape):
    cfg = SHAPES[shape]
    width, height = SIZE[0] * SCALE, SIZE[1] * SCALE
    mask = Image.new("L", (SIZE[0] * SCALE, SIZE[1] * SCALE), 0)
    draw = ImageDraw.Draw(mask)
    x = round(cfg["x"] * width)
    y = round(cfg["y"] * height)
    w = round(cfg["w"] * width)
    h = round(cfg["h"] * height)
    if cfg["kind"] == "oval":
        draw.ellipse((x, y, x + w, y + h), fill=255)
    elif cfg["kind"] == "round-square":
        radius = round(w * cfg["radius"])
        box = (x, y, x + w, y + h)
        draw.rounded_rectangle(box, radius=radius, fill=255)
    else:
        cx = x + w / 2
        top = y
        bottom = y + h
        tip = cfg["tip"] * w
        left = x
        right = x + w
        tip_left = (cx - tip, top + h * 0.035)
        tip_right = (cx + tip, top + h * 0.035)
        right_shoulder = (right, top + h * 0.43)
        bottom = (cx, bottom)
        left_shoulder = (left, top + h * 0.43)
        segments = [
            (tip_left, (cx - tip * 0.2, top), (cx + tip * 0.2, top), tip_right),
            (tip_right, (right - w * 0.22, top + h * 0.08), (right, top + h * 0.20), right_shoulder),
            (right_shoulder, (right, top + h * 0.72), (cx + w * 0.25, y + h), bottom),
            (bottom, (cx - w * 0.25, y + h), (left, top + h * 0.72), left_shoulder),
            (left_shoulder, (left, top + h * 0.20), (left + w * 0.22, top + h * 0.08), tip_left),
        ]
        smooth = []
        for p0, c1, c2, p1 in segments:
            for step in range(28):
                t = step / 28
                mt = 1 - t
                x_val = mt ** 3 * p0[0] + 3 * mt ** 2 * t * c1[0] + 3 * mt * t ** 2 * c2[0] + t ** 3 * p1[0]
                y_val = mt ** 3 * p0[1] + 3 * mt ** 2 * t * c1[1] + 3 * mt * t ** 2 * c2[1] + t ** 3 * p1[1]
                smooth.append((x_val, y_val))
        draw.polygon(smooth, fill=255)
    return mask.resize(SIZE, Image.Resampling.LANCZOS)


def alpha_crop(image):
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    return image.crop(box) if box else image


def filled_texture(path):
    source = alpha_crop(Image.open(path).convert("RGBA"))
    alpha = source.getchannel("A")
    stat = ImageStat.Stat(source.convert("RGB"), alpha)
    base_color = tuple(int(v) for v in stat.mean[:3])
    base = Image.new("RGBA", source.size, base_color + (255,))
    base.alpha_composite(source)
    return base.resize(SIZE, Image.Resampling.LANCZOS)


for shape in SHAPES:
    mask = mask_for(shape)
    white = Image.new("RGBA", SIZE, (255, 255, 255, 255))
    white.putalpha(mask)
    white.save(OUT / f"shape-{shape}.png")

    for material, filename in MATERIALS.items():
        texture = filled_texture(ROOT / "assets" / "materials" / filename)
        texture.putalpha(mask)
        texture.save(OUT / f"{material}-{shape}.png")

print(f"Generated {len(SHAPES)} shape masks and {len(SHAPES) * len(MATERIALS)} fitted material nails in {OUT}")
