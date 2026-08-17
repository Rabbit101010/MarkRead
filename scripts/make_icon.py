#!/usr/bin/env python3
"""Generate the MarkRead app icon set from assets/icon-source.png.

Source must be a square (≥512px) PNG. We produce:
- icon.png          (1024×1024, master)
- 32x32.png, 128x128.png, 128x128@2x.png  (PNG variants used by the webview)
- icon.ico          (multi-size Windows icon)
- icon.icns         (multi-size macOS icon, 128/256/512/1024)
"""
import os
import struct
import sys
from io import BytesIO
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(ROOT, ".."))
SRC = os.path.join(PROJECT, "assets", "icon-source.png")
OUT = os.path.join(PROJECT, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)


def png_bytes(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def load_source() -> Image.Image:
    if not os.path.isfile(SRC):
        sys.exit(f"missing source icon: {SRC}\nPut a square PNG at that path and re-run.")
    im = Image.open(SRC).convert("RGBA")
    if im.size[0] != im.size[1]:
        sys.exit(f"source must be square, got {im.size}")
    if im.size[0] < 512:
        sys.exit(f"source too small: {im.size} (need ≥512)")
    return im


def write_icns(path: str, sizes_pngs):
    # 'icns' magic + total size (incl. header), then chunks of
    # (4-byte type, 4-byte big-endian chunk size incl. header, data).
    body = b""
    for typ, png in sizes_pngs:
        body += typ + struct.pack(">I", len(png) + 8) + png
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


def write_ico(path: str, sizes_pngs):
    # ICONDIR: reserved=0, type=1 (icon), count
    # ICONDIRENTRY (16B): w, h, color_count, reserved, planes, bit_count, size, offset
    # Followed by PNG data for each entry (PNG-in-ICO is supported on Vista+).
    count = len(sizes_pngs)
    header = struct.pack("<HHH", 0, 1, count)
    body = b""
    entries = b""
    offset = 6 + 16 * count
    for size, png in sizes_pngs:
        size_bytes = len(png)
        # ICO spec: w/h = 0 means 256. For sizes <=255 write the value directly.
        w = size if size < 256 else 0
        h = size if size < 256 else 0
        entry = struct.pack(
            "<BBBBHHII",
            w, h, 0, 0,
            1, 32,
            size_bytes,
            offset,
        )
        entries += entry
        body += png
        offset += size_bytes
    with open(path, "wb") as f:
        f.write(header + entries + body)


def main():
    im = load_source()
    master = im.resize((1024, 1024), Image.LANCZOS)

    # PNG variants
    for name, size in [
        ("icon.png", 1024),
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
    ]:
        out = os.path.join(OUT, name)
        master.resize((size, size), Image.LANCZOS).save(out, "PNG", optimize=True)
        print("wrote", out)

    # ICO (Windows): PNG-encoded chunks, 16/32/48/64/128/256 — hand-rolled so
    # we don't depend on Pillow's `sizes` ICO writer (which doesn't actually
    # multi-frame in Pillow 12).
    ico_path = os.path.join(OUT, "icon.ico")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_pngs = [(s, png_bytes(master.resize((s, s), Image.LANCZOS))) for s in ico_sizes]
    write_ico(ico_path, ico_pngs)
    print("wrote", ico_path)

    # ICNS (macOS): hand-rolled, PNG-encoded chunks (ic07/ic08/ic09/ic10).
    icns_path = os.path.join(OUT, "icon.icns")
    sizes_pngs = [
        (b"ic07", png_bytes(master.resize((128, 128), Image.LANCZOS))),
        (b"ic08", png_bytes(master.resize((256, 256), Image.LANCZOS))),
        (b"ic09", png_bytes(master.resize((512, 512), Image.LANCZOS))),
        (b"ic10", png_bytes(master)),  # already 1024x1024
    ]
    write_icns(icns_path, sizes_pngs)
    print("wrote", icns_path)


if __name__ == "__main__":
    main()
