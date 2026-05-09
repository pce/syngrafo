#!/usr/bin/env python3
"""
Generate the Syngrafo system-tray icon (PNG + ICO) without external dependencies.

Design: dark-indigo circle, indigo ring border, violet sine waveform.
Outputs:
  <outdir>/syngrafo.png   — 32×32 RGBA  (macOS / Linux tray)
  <outdir>/syngrafo.ico   — multi-image ICO (32+16 px, Windows tray)

Usage:
    python3 scripts/gen_icon.py data/icons
"""

import math, os, struct, sys, zlib

# ── Palette ────────────────────────────────────────────────────────────────────
BG    = (30,  27,  75,  255)   # dark indigo   #1e1b4b
RING  = (99,  102, 241, 255)   # indigo-500    #6366f1
WAVE  = (167, 139, 250, 255)   # violet-400    #a78bfa
TRANS = (0,   0,   0,   0)


# ── PNG writer (no external libraries) ────────────────────────────────────────

def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFF_FFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def rgba_to_png(width: int, height: int, pixels: list) -> bytes:
    """pixels: list of (R,G,B,A) tuples in row-major order."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)                       # filter type: None
        for x in range(width):
            raw.extend(pixels[y * width + x])
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr_data)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )


# ── Icon renderer ─────────────────────────────────────────────────────────────

def _lerp(a: tuple, b: tuple, t: float) -> tuple:
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def draw_icon(size: int = 32) -> list:
    """
    Draw a circular icon:
      • transparent outside the circle (anti-aliased)
      • indigo ring (2-3 px thick)
      • dark indigo interior with a violet sine wave
    """
    pixels = []
    cx = cy = size / 2.0
    r_outer = size / 2.0 - 0.5   # outer radius (leaves half-px for AA)
    r_ring  = r_outer - max(2.0, size * 0.075)   # ring thickness scales with size

    for y in range(size):
        for x in range(size):
            px = x + 0.5
            py = y + 0.5
            dx = px - cx
            dy = py - cy
            dist = math.hypot(dx, dy)

            # Outside the circle → transparent
            if dist > r_outer:
                pixels.append(TRANS)
                continue

            # Anti-alias factor for the outer edge (0 → 1 inside)
            aa = min(1.0, r_outer - dist)
            alpha = int(255 * aa)

            # Ring band
            if dist > r_ring:
                t = (dist - r_ring) / (r_outer - r_ring)
                col = _lerp(BG, RING, t)
                pixels.append((*col[:3], alpha))
                continue

            # Interior — sine waveform
            # Map x inside the ring to 0..1 for the wave phase
            nx = (px - (cx - r_ring)) / (2.0 * r_ring)
            wave_y_norm = 0.5 + 0.30 * math.sin(nx * 2.0 * math.pi)
            # Map wave_y_norm back to pixel-space y within the inner circle
            wave_y_px = cy - r_ring + wave_y_norm * 2.0 * r_ring
            dist_wave = abs(py - wave_y_px)

            # Wave half-thickness (keeps one crisp pixel at 16 px, two at 32 px)
            half_thick = max(1.2, size * 0.045)

            if dist_wave < half_thick:
                t = 1.0 - dist_wave / half_thick
                col = _lerp(BG, WAVE, t * t)
                pixels.append((*col[:3], alpha))
            else:
                pixels.append((*BG[:3], alpha))

    return pixels


# ── ICO writer (PNG-in-ICO, Vista+) ───────────────────────────────────────────

def make_ico(size_png_pairs: list) -> bytes:
    """
    size_png_pairs: [(size_int, png_bytes), ...]
    Produces a Windows ICO file embedding each PNG as a PNG-in-ICO entry.
    """
    n = len(size_png_pairs)
    # ICO file header (6 bytes) + n × 16-byte directory entries
    header     = struct.pack("<HHH", 0, 1, n)
    dir_offset = 6 + 16 * n            # offset of first image blob

    entries = b""
    blobs   = b""
    for (sz, png) in size_png_pairs:
        w = sz if sz < 256 else 0      # 0 means 256 in ICO spec
        h = sz if sz < 256 else 0
        offset = dir_offset + len(blobs)
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(png), offset)
        blobs   += png

    return header + entries + blobs


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out_dir, exist_ok=True)

    # 32-px master
    pix32  = draw_icon(32)
    png32  = rgba_to_png(32, 32, pix32)

    # 16-px for small displays / Windows taskbar
    pix16  = draw_icon(16)
    png16  = rgba_to_png(16, 16, pix16)

    png_path = os.path.join(out_dir, "syngrafo.png")
    ico_path = os.path.join(out_dir, "syngrafo.ico")

    with open(png_path, "wb") as f:
        f.write(png32)
    print(f"[gen_icon] {png_path}  ({len(png32)} B)")

    ico = make_ico([(32, png32), (16, png16)])
    with open(ico_path, "wb") as f:
        f.write(ico)
    print(f"[gen_icon] {ico_path}  ({len(ico)} B)")


if __name__ == "__main__":
    main()
