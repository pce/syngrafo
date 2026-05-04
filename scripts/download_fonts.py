#!/usr/bin/env python3
"""
Download free (SIL OFL 1.1) font files used by the Syngrafo UI.

Files are written to  frontend/fonts/  relative to the repo root.
The CMake build then copies them into the saucer embed bundle so they
are served at  /fonts/<file>  at runtime.

Font families bundled:
    Inter             — clean UI sans-serif  (Google / Inter authors)
    JetBrains Mono    — code / monospace     (JetBrains s.r.o.)
    IBM Plex Sans     — technical sans-serif (IBM Corp.)
    IBM Plex Mono     — technical monospace  (IBM Corp.)
    Comic Neue        — handwritten-style    (Craig Rozynski)
    Lora              — elegant serif        (Cyreal)

Usage:
    python3 scripts/download_fonts.py check
    python3 scripts/download_fonts.py download
    python3 scripts/download_fonts.py download --families inter,jetbrains-mono
    python3 scripts/download_fonts.py download --force
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_BAR_WIDTH: int = 40

# ── Font catalog ──────────────────────────────────────────────────────────────

@dataclass
class FontFile:
    filename: str
    url: str
    size_kb: int  # approximate — used for display only


@dataclass
class FontFamily:
    id: str
    label: str
    license: str
    files: list[FontFile] = field(default_factory=list)


# Direct download URLs from official GitHub releases (all SIL OFL 1.1).
FONT_FAMILIES: list[FontFamily] = [
    FontFamily(
        id="inter",
        label="Inter",
        license="SIL OFL 1.1  —  https://github.com/rsms/inter",
        files=[
            FontFile("InterVariable.ttf", "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.ttf", 0),
        ],
    ),
    FontFamily(
        id="jetbrains-mono",
        label="JetBrains Mono",
        license="SIL OFL 1.1  —  https://github.com/JetBrains/JetBrainsMono",
        files=[
            FontFile("JetBrainsMono-Regular.ttf", "", 0),
            FontFile("JetBrainsMono-Bold.ttf",    "", 0),
        ],
    ),
    FontFamily(
        id="ibm-plex-sans",
        label="IBM Plex Sans",
        license="SIL OFL 1.1  —  https://github.com/IBM/plex",
        files=[
            FontFile("IBMPlexSans-Regular.ttf", "", 0),
            FontFile("IBMPlexSans-Medium.ttf",  "", 0),
            FontFile("IBMPlexSans-Bold.ttf",    "", 0),
        ],
    ),
    FontFamily(
        id="ibm-plex-mono",
        label="IBM Plex Mono",
        license="SIL OFL 1.1  —  https://github.com/IBM/plex",
        files=[
            FontFile("IBMPlexMono-Regular.ttf", "", 0),
            FontFile("IBMPlexMono-Bold.ttf",    "", 0),
        ],
    ),
    FontFamily(
        id="comic-neue",
        label="Comic Neue",
        license="SIL OFL 1.1  —  http://comicneue.com",
        files=[
            FontFile("ComicNeue-Regular.ttf", "", 0),
            FontFile("ComicNeue-Bold.ttf",    "", 0),
        ],
    ),
    FontFamily(
        id="lora",
        label="Lora",
        license="SIL OFL 1.1  —  https://github.com/cyrealtype/Lora-Cyrillic",
        files=[
            FontFile("Lora-Regular.ttf", "", 0),
            FontFile("Lora-Bold.ttf",    "", 0),
        ],
    ),
]

# Per-file direct download URLs.
# Inter v4 dropped individual-weight TTF files from the tree; the variable
# font (InterVariable.ttf) covers weights 100-900 in a single file.
# All other fonts now use raw.githubusercontent.com for reliability.
_DIRECT_URLS: dict[str, str] = {
    # Inter — variable font (weights 100-900 in one file, rsms/inter master)
    "InterVariable.ttf":         "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.ttf",
    # JetBrains Mono
    "JetBrainsMono-Regular.ttf": "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf",
    "JetBrainsMono-Bold.ttf":    "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf",
    # IBM Plex Sans — monorepo restructured in 2023; fonts moved to packages/plex-sans/
    "IBMPlexSans-Regular.ttf":   "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Regular.ttf",
    "IBMPlexSans-Medium.ttf":    "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Medium.ttf",
    "IBMPlexSans-Bold.ttf":      "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf",
    # IBM Plex Mono — same monorepo restructure; now under packages/plex-mono/
    "IBMPlexMono-Regular.ttf":   "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-mono/fonts/complete/ttf/IBMPlexMono-Regular.ttf",
    "IBMPlexMono-Bold.ttf":      "https://raw.githubusercontent.com/IBM/plex/master/packages/plex-mono/fonts/complete/ttf/IBMPlexMono-Bold.ttf",
    # Comic Neue — path changed to Fonts/TTF/ComicNeue/ (capital letters, added subfolder)
    "ComicNeue-Regular.ttf":     "https://raw.githubusercontent.com/crozynski/comicneue/master/Fonts/TTF/ComicNeue/ComicNeue-Regular.ttf",
    "ComicNeue-Bold.ttf":        "https://raw.githubusercontent.com/crozynski/comicneue/master/Fonts/TTF/ComicNeue/ComicNeue-Bold.ttf",
    # Lora — branch renamed from master → main
    "Lora-Regular.ttf":          "https://raw.githubusercontent.com/cyrealtype/Lora-Cyrillic/main/fonts/ttf/Lora-Regular.ttf",
    "Lora-Bold.ttf":             "https://raw.githubusercontent.com/cyrealtype/Lora-Cyrillic/main/fonts/ttf/Lora-Bold.ttf",
}

# ── Utilities ─────────────────────────────────────────────────────────────────

def _bar(done: int, total: int) -> str:
    filled = int(_BAR_WIDTH * done / total) if total else 0
    return f"[{'█' * filled}{'░' * (_BAR_WIDTH - filled)}] {done}/{total}"


def _download(url: str, dest: Path) -> None:
    def _progress(block: int, block_size: int, total: int) -> None:
        downloaded = block * block_size
        if total > 0:
            pct = min(100, int(100 * downloaded / total))
            bar = _bar(downloaded, total)
            print(f"\r  {bar}  {pct:3d}%", end="", flush=True)

    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(url, dest, reporthook=_progress)
        print()  # newline after progress bar
    except urllib.error.URLError as e:
        print(f"\n  ERROR: {e}")
        raise


def _resolve_families(ids: list[str] | None) -> list[FontFamily]:
    if not ids:
        return FONT_FAMILIES
    id_set = {i.strip().lower() for i in ids}
    matched = [f for f in FONT_FAMILIES if f.id in id_set]
    unknown = id_set - {f.id for f in matched}
    if unknown:
        print(f"WARNING: unknown family ids: {', '.join(sorted(unknown))}", file=sys.stderr)
    return matched


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_check(fonts_dir: Path, families: list[FontFamily]) -> int:
    print(f"\n📂  Font directory: {fonts_dir}\n")
    all_present = True
    for fam in families:
        print(f"  {fam.label}  ({fam.license})")
        for ff in fam.files:
            path = fonts_dir / ff.filename
            status = "✓" if path.exists() else "✗ MISSING"
            size   = f"  {path.stat().st_size // 1024} KB" if path.exists() else ""
            print(f"    {status}  {ff.filename}{size}")
            if not path.exists():
                all_present = False
        print()
    return 0 if all_present else 1


def cmd_download(fonts_dir: Path, families: list[FontFamily], force: bool) -> int:
    print(f"\n📂  Font directory: {fonts_dir}\n")
    errors: list[str] = []

    for fam in families:
        print(f"  {fam.label}  ({fam.license})")
        for ff in fam.files:
            dest = fonts_dir / ff.filename
            if dest.exists() and not force:
                print(f"    ✓  {ff.filename}  (already present, use --force to re-download)")
                continue
            url = _DIRECT_URLS.get(ff.filename, "")
            if not url:
                print(f"    ✗  {ff.filename}  — no URL configured, skip")
                errors.append(ff.filename)
                continue
            print(f"    ↓  {ff.filename}")
            print(f"       {url}")
            try:
                _download(url, dest)
                print(f"    ✓  {ff.filename}  ({dest.stat().st_size // 1024} KB)")
            except Exception as e:
                print(f"    ✗  {ff.filename}  — download failed: {e}", file=sys.stderr)
                errors.append(ff.filename)
        print()

    if errors:
        print(f"⚠️  {len(errors)} file(s) failed: {', '.join(errors)}", file=sys.stderr)
        return 1

    print("✅  All fonts downloaded.")
    return 0


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    repo_root  = Path(__file__).resolve().parent.parent
    fonts_dir  = repo_root / "frontend" / "fonts"

    parser = argparse.ArgumentParser(
        description="Download bundled OFL fonts for Syngrafo.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Font families: " + ", ".join(f.id for f in FONT_FAMILIES),
    )
    parser.add_argument("command", choices=["check", "download"],
                        help="check — show status; download — fetch missing files")
    parser.add_argument("--families", metavar="ID[,ID...]",
                        help="comma-separated family ids to target (default: all)")
    parser.add_argument("--force", action="store_true",
                        help="re-download even if the file already exists")
    parser.add_argument("--outdir", metavar="PATH",
                        help=f"override output directory (default: {fonts_dir})")

    args = parser.parse_args()

    if args.outdir:
        fonts_dir = Path(args.outdir).resolve()

    families = _resolve_families(
        args.families.split(",") if args.families else None
    )

    if args.command == "check":
        return cmd_check(fonts_dir, families)
    return cmd_download(fonts_dir, families, force=args.force)


if __name__ == "__main__":
    sys.exit(main())
