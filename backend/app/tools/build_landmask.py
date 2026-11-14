"""Build ``app/data/landmask.npy`` from the frontend's water texture (run once; the result is committed).

    .venv/bin/python -m app.tools.build_landmask [path/to/earth-water.(png|jpg)]

The texture (``frontend/public/textures/earth-water.*``, an equirectangular specular map) has water white
and land black (row 0 = 90°N, column 0 = 180°W). The committed mask was built from the 1600x800
``earth-water.png``; we keep the texture's resolution (0.225°) as a boolean "is land" array, bit-packed
along longitude (``np.packbits(mask, axis=1)``, 160 kB). Lakes such as the Caspian count as water.
Uses Pillow when installed (any format); otherwise a pure-Python PNG decoder (PNG only, a few seconds).
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

import numpy as np

from app.grid.landmask import LANDMASK_PATH

TEXTURE_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "textures"


def read_png_gray(path: Path) -> np.ndarray:
    """Decode an 8-bit grayscale/RGB/RGBA, non-interlaced PNG into a (rows, cols) uint8 luminance array."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    pos, idat = 8, b""
    width = height = color_type = bit_depth = interlace = 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    if bit_depth != 8 or interlace or color_type not in (0, 2, 4, 6):
        raise ValueError("only 8-bit non-interlaced gray/RGB(A) PNGs are supported")
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    stride = width * ch
    raw = zlib.decompress(idat)
    out = np.empty((height, stride), dtype=np.uint8)
    prev = bytearray(stride)
    for r in range(height):
        f = raw[r * (stride + 1)]
        line = bytearray(raw[r * (stride + 1) + 1:(r + 1) * (stride + 1)])
        if f == 2:
            line = bytearray(((np.frombuffer(line, np.uint8).astype(int) + np.frombuffer(prev, np.uint8)) & 0xFF)
                             .astype(np.uint8).tobytes())
        elif f in (1, 3, 4):
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                if f == 1:
                    line[i] = (line[i] + a) & 0xFF
                elif f == 3:
                    line[i] = (line[i] + (a + b) // 2) & 0xFF
                else:
                    c = prev[i - ch] if i >= ch else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        out[r] = np.frombuffer(line, np.uint8)
        prev = line
    pixels = out.reshape(height, width, ch)
    if ch >= 3:
        return pixels[:, :, :3].mean(axis=2).astype(np.uint8)
    return pixels[:, :, 0]


def read_gray(path: Path) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError:
        return read_png_gray(path)
    with Image.open(path) as im:
        return np.asarray(im.convert("L"))


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    texture = Path(args[0]) if args else next(iter(sorted(TEXTURE_DIR.glob("earth-water.*"))), None)
    if texture is None:
        raise SystemExit(f"No earth-water texture in {TEXTURE_DIR}; pass its path.")
    land = read_gray(texture) < 128
    LANDMASK_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.save(LANDMASK_PATH, np.packbits(land, axis=1))
    print(f"{LANDMASK_PATH}: {land.shape[0]}x{land.shape[1]} cells, {land.mean():.1%} land")


if __name__ == "__main__":
    main()
