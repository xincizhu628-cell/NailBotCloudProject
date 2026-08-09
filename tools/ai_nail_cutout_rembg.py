from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


CANVAS_MARGIN = 18
UPSCALE_FACTOR = 2
ROUGH_PAD_X = 0.22
ROUGH_PAD_Y = 0.08
MAX_AI_INPUT_SIDE = 900

SOURCE_CODES = ("123", "124", "125", "126", "127", "128", "129", "130")

REFERENCE_SOURCE_SIZES = {
    "123": (2172, 1280),
    "124": (1868, 960),
    "125": (1900, 960),
    "126": (3766, 1609),
    "127": (2369, 919),
    "128": (3662, 1495),
    "129": (3104, 1350),
    "130": (3593, 1252),
}

NAIL_RUNS = {
    "123": [(0, 365), (515, 795), (940, 1245), (1370, 1645), (1795, 2118)],
    "124": [(40, 395), (520, 785), (910, 1218), (1320, 1588), (1655, 1868)],
    "125": [(55, 390), (535, 790), (915, 1218), (1288, 1568), (1640, 1900)],
    "126": [(110, 760), (1010, 1518), (1715, 2225), (2470, 3035), (3245, 3766)],
    "127": [(130, 475), (660, 930), (1090, 1395), (1520, 1830), (2025, 2330)],
    "128": [(105, 625), (935, 1475), (1760, 2265), (2465, 3060), (3235, 3662)],
    "129": [(105, 650), (835, 1240), (1390, 1800), (2085, 2635), (2705, 3104)],
    "130": [(235, 755), (1040, 1475), (1715, 2155), (2405, 2870), (3040, 3500)],
}

NAIL_Y_BANDS = {
    "123": (455, 1238),
    "124": (155, 900),
    "125": (190, 900),
    "126": (300, 1498),
    "127": (165, 830),
    "128": (245, 1305),
    "129": (225, 1230),
    "130": (205, 1105),
}


def load_rembg():
    try:
        from rembg import new_session, remove
    except ImportError as exc:
        raise SystemExit(
            "Missing AI cutout package. Install it first:\n"
            "  python -m pip install rembg onnxruntime\n\n"
            "Then run this script again."
        ) from exc
    return new_session, remove


def crop_nail_regions(image: Image.Image, code: str) -> list[Image.Image]:
    width, height = image.size
    ref_width, ref_height = REFERENCE_SOURCE_SIZES[code]
    scale_x = width / ref_width
    scale_y = height / ref_height
    y1, y2 = (int(round(value * scale_y)) for value in NAIL_Y_BANDS[code])
    crops = []
    for x1, x2 in NAIL_RUNS[code]:
        left = int(round(x1 * scale_x))
        right = int(round(x2 * scale_x))
        top = y1
        bottom = y2
        pad_x = max(18, int(round((right - left) * ROUGH_PAD_X)))
        pad_y = max(20, int(round((bottom - top) * ROUGH_PAD_Y)))
        left = max(0, left - pad_x)
        right = min(width, right + pad_x)
        top = max(0, top - pad_y)
        bottom = min(height, bottom + pad_y)
        crops.append(image.crop((left, top, right, bottom)))
    return crops


def trim_alpha(image: Image.Image) -> Image.Image:
    alpha = np.array(image.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return image
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def straighten(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    alpha = np.array(image.getchannel("A"))
    ys, xs = np.where(alpha > 16)
    if len(xs) < 80:
        return trim_alpha(image)

    coords = np.column_stack([xs, ys]).astype(np.float32)
    coords -= coords.mean(axis=0)
    cov = coords.T @ coords / max(1, len(coords) - 1)
    vals, vecs = np.linalg.eigh(cov)
    vx, vy = vecs[:, np.argmax(vals)]
    angle = math.degrees(math.atan2(vy, vx)) - 90
    if angle < -90:
        angle += 180
    if angle > 90:
        angle -= 180
    if abs(angle) > 14:
        angle = 0
    return trim_alpha(image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC))


def fit_to_canvas(image: Image.Image) -> Image.Image:
    image = trim_alpha(image.convert("RGBA"))
    max_w = CANVAS_SIZE[0] - CANVAS_MARGIN * 2
    max_h = CANVAS_SIZE[1] - CANVAS_MARGIN * 2
    scale = min(max_w / image.width, max_h / image.height)
    new_size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
    image = image.resize(new_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(image, ((CANVAS_SIZE[0] - new_size[0]) // 2, (CANVAS_SIZE[1] - new_size[1]) // 2))
    return canvas


def pad_transparent(image: Image.Image, margin: int = CANVAS_MARGIN) -> Image.Image:
    image = trim_alpha(image.convert("RGBA"))
    canvas = Image.new("RGBA", (image.width + margin * 2, image.height + margin * 2), (0, 0, 0, 0))
    canvas.alpha_composite(image, (margin, margin))
    return canvas


def upscale_and_clarify(image: Image.Image, factor: int = UPSCALE_FACTOR) -> Image.Image:
    if factor <= 1:
        return image
    upscaled = image.resize((image.width * factor, image.height * factor), Image.Resampling.LANCZOS)
    alpha = upscaled.getchannel("A")
    rgb = upscaled.convert("RGB")
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2, percent=135, threshold=2))
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.18)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    return result


def resize_for_ai(image: Image.Image) -> Image.Image:
    longest_side = max(image.size)
    if longest_side <= MAX_AI_INPUT_SIDE:
        return image
    scale = MAX_AI_INPUT_SIDE / longest_side
    new_size = (max(1, int(round(image.width * scale))), max(1, int(round(image.height * scale))))
    return image.resize(new_size, Image.Resampling.LANCZOS)


def ai_cutout(crop: Image.Image, remove, session) -> Image.Image:
    # Alpha matting keeps the nail edge soft while avoiding the hard gray halo.
    crop = resize_for_ai(crop)
    return remove(
        crop.convert("RGB"),
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=245,
        alpha_matting_background_threshold=12,
        alpha_matting_erode_size=8,
    ).convert("RGBA")


def make_contact_sheet(files: list[Path], output: Path) -> None:
    thumb_w, thumb_h = 120, 172
    cols = 10
    rows = math.ceil(len(files) / cols)
    sheet = Image.new("RGBA", (cols * thumb_w, rows * (thumb_h + 22)), (245, 245, 245, 255))
    from PIL import ImageDraw

    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(files):
        thumb = Image.open(path).convert("RGBA")
        thumb.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (index % cols) * thumb_w + (thumb_w - thumb.width) // 2
        y = (index // cols) * (thumb_h + 22) + (thumb_h - thumb.height) // 2
        sheet.alpha_composite(thumb, (x, y))
        draw.text(((index % cols) * thumb_w + 4, (index // cols) * (thumb_h + 22) + thumb_h + 3), path.stem, fill=(30, 30, 30, 255))
    sheet.convert("RGB").save(output, quality=92)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Folder containing 123.jpg ... 130.jpg")
    parser.add_argument("--output", default="generated_nail_cutouts_ai", help="Output folder")
    parser.add_argument("--model", default="isnet-general-use", help="rembg model name, e.g. isnet-general-use, birefnet-general, bria-rmbg")
    parser.add_argument("--upscale", type=int, default=UPSCALE_FACTOR, help="Final upscale factor. Default 2 makes 320x460 become 640x920.")
    parser.add_argument("--skip-ai", action="store_true", help="Only split each photo into one-nail crops; do not remove background.")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    new_session = remove = session = None
    if not args.skip_ai:
        new_session, remove = load_rembg()
        session = new_session(args.model)

    saved = []
    for code in SOURCE_CODES:
        image = ImageOps.exif_transpose(Image.open(source / f"{code}.jpg")).convert("RGB")
        crops = crop_nail_regions(image, code)
        for index, crop in enumerate(crops, start=1):
            print(f"Processing {code}--{index}...", flush=True)
            if args.skip_ai:
                final = upscale_and_clarify(crop.convert("RGBA"), args.upscale)
            else:
                cut = ai_cutout(crop, remove, session)
                final = upscale_and_clarify(pad_transparent(straighten(cut)), args.upscale)
            path = output / f"{code}--{index}.png"
            final.save(path)
            saved.append(path)

    make_contact_sheet(saved, output / "preview_contact_sheet.jpg")
    print(f"Saved {len(saved)} PNG files to {output.resolve()}")


if __name__ == "__main__":
    main()
