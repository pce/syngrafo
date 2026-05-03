#!/usr/bin/env python3
"""
Download ONNX models and vocabulary files required by NLP Engine.

Model directory layout (default: <webviewapp>/data/models/):
    vocab.txt        — WordPiece vocabulary shared by all BERT-family models
    embed.onnx       — all-MiniLM-L6-v2  (semantic search, schema, summarize)
    sentiment.onnx   — DistilBERT SST-2  (replaces dictionary sentiment lexicon)
    ner.onnx         — BERT NER          (replaces regex entity extraction)
    toxicity.onnx    — Toxic-BERT        (replaces pattern word list)

Usage:
    python3 scripts/download_models.py check
    python3 scripts/download_models.py download
    python3 scripts/download_models.py download --models embed,vocab
    python3 scripts/download_models.py download --force
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

# ── Windows cp1252 / ANSI console fix ────────────────────────────────────────
# GitHub Actions Windows agents default to cp1252 which cannot encode the
# Unicode block characters used in the progress bar (U+2588 █, U+2591 ░).
# Reconfigure stdout/stderr to UTF-8 with a safe replacement fallback so the
# script never crashes with UnicodeEncodeError, even in legacy codepage shells.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from pathlib import Path


_BAR_WIDTH: int = 42
_CHUNK_BYTES: int = 65_536

# Tesseract "best" trained models (higher accuracy than the default tessdata).
_TESSDATA_BASE = "https://github.com/tesseract-ocr/tessdata_best/raw/main"


@dataclass(frozen=True)
class ModelSpec:
    """Specification for a single downloadable asset."""

    filename: str
    url: str
    size_hint: str
    description: str
    required: bool = False
    # sub-directory inside the data/ dir (default: "models/")
    subdir: str = "models"
    labels: list[str] = field(default_factory=list)
    output_node: str = "logits"
    activation: str = "softmax"


MODELS: dict[str, ModelSpec] = {
    "vocab": ModelSpec(
        filename="vocab.txt",
        url=(
            "https://huggingface.co/sentence-transformers/"
            "all-MiniLM-L6-v2/resolve/main/vocab.txt"
        ),
        size_hint="232 kB",
        description="WordPiece vocabulary shared by all BERT-family models in this stack",
        required=True,
    ),
    "embed": ModelSpec(
        filename="embed.onnx",
        url=(
            "https://huggingface.co/Xenova/all-MiniLM-L6-v2/"
            "resolve/main/onnx/model_quantized.onnx"
        ),
        size_hint="~23 MB",
        description="all-MiniLM-L6-v2 int8 — semantic search, schema extraction, ONNX summarize",
        required=True,
    ),
    "sentiment": ModelSpec(
        filename="sentiment.onnx",
        url=(
            "https://huggingface.co/Xenova/"
            "distilbert-base-uncased-finetuned-sst-2-english/"
            "resolve/main/onnx/model_quantized.onnx"
        ),
        size_hint="~67 MB",
        description="DistilBERT SST-2 int8 — replaces dictionary sentiment lexicon",
        labels=["NEGATIVE", "POSITIVE"],
        output_node="logits",
        activation="softmax",
    ),
    # bert-base-NER uses bert-base-CASED (28,996 tokens), which is a DIFFERENT
    # vocabulary from all-MiniLM-L6-v2 (30,522 tokens).  We must download its
    # own vocab so the tokenizer index range matches the model's embedding matrix.
    "ner_vocab": ModelSpec(
        filename="ner_vocab.txt",
        url=(
            "https://huggingface.co/dslim/bert-base-NER/"
            "resolve/main/vocab.txt"
        ),
        size_hint="~213 kB",
        description="bert-base-cased vocabulary (28,996 tokens) required by ner.onnx",
        required=False,
    ),
    "ner": ModelSpec(
        filename="ner.onnx",
        url=(
            "https://huggingface.co/Xenova/bert-base-NER/"
            "resolve/main/onnx/model_quantized.onnx"
        ),
        size_hint="~415 MB",
        description="BERT NER int8 — replaces heuristic capitalization / regex NER",
        labels=[
            "O",
            "B-MISC", "I-MISC",
            "B-PER",  "I-PER",
            "B-ORG",  "I-ORG",
            "B-LOC",  "I-LOC",
        ],
        output_node="logits",
        activation="softmax",
    ),
    "toxicity": ModelSpec(
        filename="toxicity.onnx",
        url=(
            "https://huggingface.co/Xenova/toxic-bert/"
            "resolve/main/onnx/model_quantized.onnx"
        ),
        size_hint="~415 MB",
        description="Toxic-BERT int8 — replaces pattern word list; multi-label sigmoid output",
        labels=["toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate"],
        output_node="logits",
        activation="sigmoid",
    ),
    # ── Tesseract OCR language data ──────────────────────────────────────────
    # Only required on Linux / Windows (macOS uses Apple Vision built-in).
    # Source: https://github.com/tesseract-ocr/tessdata_best (LSTM "best" models)
    # macOS (brew):   brew install tesseract tesseract-lang  (all languages)
    # Ubuntu/Debian:  sudo apt-get install tesseract-ocr-deu tesseract-ocr-jpn …
    #
    # Use the 'tessdata' alias to download all language packs at once:
    #   python3 scripts/download_models.py download --models tessdata
    **{
        f"tessdata-{code}": ModelSpec(
            filename=f"{code}.traineddata",
            url=f"{_TESSDATA_BASE}/{code}.traineddata",
            size_hint=hint,
            description=desc,
            subdir="tessdata",
        )
        for code, hint, desc in [
            # ── Latin-script European ─────────────────────────────────────────
            ("eng",  "~12 MB",  "English"),
            ("deu",  "~8 MB",   "German (Deutsch)"),
            ("fra",  "~9 MB",   "French (Français)"),
            ("spa",  "~8 MB",   "Spanish (Español)"),
            ("ita",  "~7 MB",   "Italian (Italiano)"),
            ("por",  "~8 MB",   "Portuguese (Português)"),
            ("nld",  "~8 MB",   "Dutch (Nederlands)"),
            ("pol",  "~7 MB",   "Polish (Polski)"),
            ("hun",  "~7 MB",   "Hungarian (Magyar)"),
            ("ces",  "~6 MB",   "Czech (Čeština)"),
            ("slk",  "~6 MB",   "Slovak (Slovenčina)"),
            ("ron",  "~7 MB",   "Romanian (Română)"),
            ("hrv",  "~6 MB",   "Croatian (Hrvatski)"),
            ("swe",  "~8 MB",   "Swedish (Svenska)"),
            ("nor",  "~7 MB",   "Norwegian (Norsk)"),
            ("dan",  "~7 MB",   "Danish (Dansk)"),
            ("fin",  "~7 MB",   "Finnish (Suomi)"),
            ("tur",  "~7 MB",   "Turkish (Türkçe)"),
            ("lat",  "~5 MB",   "Latin"),
            # ── Greek / Cyrillic ──────────────────────────────────────────────
            ("ell",  "~5 MB",   "Greek (Ελληνικά)"),
            ("rus",  "~8 MB",   "Russian (Русский)"),
            ("ukr",  "~7 MB",   "Ukrainian (Українська)"),
            ("bel",  "~7 MB",   "Belarusian (Беларуская)"),
            ("bul",  "~7 MB",   "Bulgarian (Български)"),
            # ── CJK ───────────────────────────────────────────────────────────
            ("jpn",          "~14 MB", "Japanese horizontal (日本語)"),
            ("jpn_vert",     "~14 MB", "Japanese vertical (日本語 縦書き)"),
            ("chi_sim",      "~20 MB", "Chinese Simplified (简体中文)"),
            ("chi_sim_vert", "~20 MB", "Chinese Simplified vertical"),
            ("chi_tra",      "~23 MB", "Chinese Traditional (繁體中文)"),
            ("chi_tra_vert", "~23 MB", "Chinese Traditional vertical"),
            ("kor",          "~10 MB", "Korean (한국어)"),
            ("kor_vert",     "~10 MB", "Korean vertical"),
            # ── Indic / South-East Asian ─────────────────────────────────────
            ("hin",  "~7 MB",  "Hindi (हिन्दी)"),
            ("ben",  "~6 MB",  "Bengali (বাংলা)"),
            ("tam",  "~5 MB",  "Tamil (தமிழ்)"),
            ("tel",  "~5 MB",  "Telugu (తెలుగు)"),
            ("kan",  "~5 MB",  "Kannada (ಕನ್ನಡ)"),
            ("mal",  "~5 MB",  "Malayalam (മലയാളം)"),
            ("tha",  "~6 MB",  "Thai (ภาษาไทย)"),
            ("vie",  "~6 MB",  "Vietnamese (Tiếng Việt)"),
            ("ind",  "~6 MB",  "Indonesian (Bahasa Indonesia)"),
            # ── RTL ───────────────────────────────────────────────────────────
            ("ara",  "~8 MB",  "Arabic (العربية)"),
            ("heb",  "~5 MB",  "Hebrew (עברית)"),
            # ── Other ─────────────────────────────────────────────────────────
            ("swa",  "~5 MB",  "Swahili"),
            ("afr",  "~5 MB",  "Afrikaans"),
        ]
    },
}


def _default_data_dir() -> Path:
    """Return the data/ directory relative to this script."""
    return Path(__file__).resolve().parent.parent / "data"


def _default_model_dir() -> Path:
    """Return the default model directory (kept for back-compat)."""
    return _default_data_dir() / "models"


def _model_dest(spec: "ModelSpec", data_dir: Path) -> Path:
    """Return the destination path for a model spec."""
    return data_dir / spec.subdir / spec.filename


def _progress_bar(downloaded: int, total: int) -> None:
    """Render an in-place ASCII progress bar to stdout."""
    if total <= 0:
        sys.stdout.write(f"\r  {downloaded / 1_048_576:.2f} MB")
    else:
        fraction = downloaded / total
        filled   = int(_BAR_WIDTH * fraction)
        bar      = "█" * filled + "░" * (_BAR_WIDTH - filled)
        mb_done  = downloaded / 1_048_576
        mb_total = total / 1_048_576
        sys.stdout.write(f"\r  [{bar}] {mb_done:.1f} / {mb_total:.1f} MB")
    sys.stdout.flush()


def _download_file(url: str, dest: Path) -> bool:
    """
    Download *url* to *dest*, displaying a progress bar.

    Writes to a sibling .tmp file first and renames atomically on success.
    Returns True on success, False on any network or IO error.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "nlp-engine/download_models"})
        with urllib.request.urlopen(req, timeout=120) as response:
            total      = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            with tmp.open("wb") as out:
                while True:
                    chunk = response.read(_CHUNK_BYTES)
                    if not chunk:
                        break
                    out.write(chunk)
                    downloaded += len(chunk)
                    _progress_bar(downloaded, total)
        print()
        tmp.rename(dest)
        return True
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        print(f"\n  error: {exc}")
        tmp.unlink(missing_ok=True)
        return False


def _presence(data_dir: Path) -> dict[str, bool]:
    """Return a mapping of model key → whether the file exists on disk."""
    return {key: _model_dest(spec, data_dir).exists() for key, spec in MODELS.items()}


def _print_status(data_dir: Path) -> None:
    """Print a formatted status table for all known assets."""
    present = _presence(data_dir)
    col_key  = 16
    col_file = 24
    col_stat = 10

    print(f"\nData directory: {data_dir.resolve()}\n")
    print(
        f"  {'key':<{col_key}} {'file':<{col_file}} {'status':<{col_stat}} description"
    )
    print(
        f"  {'─' * col_key} {'─' * col_file} {'─' * col_stat} {'─' * 44}"
    )
    for key, spec in MODELS.items():
        if present[key]:
            status = "present"
        elif spec.required:
            status = "REQUIRED"
        else:
            status = "missing"
        print(
            f"  {key:<{col_key}} {spec.filename:<{col_file}}"
            f" {status:<{col_stat}} {spec.description}"
        )
    print()

    missing_required = [k for k, spec in MODELS.items() if spec.required and not present[k]]
    if missing_required:
        print(
            "  The following required assets are absent.\n"
            "  Run:  python3 scripts/download_models.py download\n"
        )


def _cmd_check(args: argparse.Namespace) -> int:
    """Handle the 'check' sub-command."""
    data_dir = Path(args.dir) if args.dir else _default_data_dir()
    _print_status(data_dir)
    return 0


def _cmd_download(args: argparse.Namespace) -> int:
    """Handle the 'download' sub-command."""
    data_dir = Path(args.dir) if args.dir else _default_data_dir()

    # Convenience alias: --models tessdata expands to all tessdata-* entries
    raw_models = args.models or ""
    expanded: list[str] = []
    for k in (k.strip() for k in raw_models.split(",") if k.strip()):
        if k == "tessdata":
            expanded.extend(mk for mk in MODELS if mk.startswith("tessdata-"))
        else:
            expanded.append(k)

    if expanded:
        unknown = sorted(set(expanded) - set(MODELS))
        if unknown:
            print(f"Unknown model keys: {', '.join(unknown)}")
            print(f"Available keys:     {', '.join(MODELS)}")
            return 1
        requested = expanded
    else:
        requested = list(MODELS.keys())

    results: dict[str, bool] = {}

    for key in requested:
        spec = MODELS[key]
        dest = _model_dest(spec, data_dir)

        if dest.exists() and not args.force:
            size_bytes = dest.stat().st_size
            print(f"  {key:<18} already present ({size_bytes / 1_048_576:.1f} MB) — skipping")
            results[key] = True
            continue

        print(f"\n{key}  ({spec.size_hint})")
        print(f"  {spec.description}")
        print(f"  {spec.url}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        results[key] = _download_file(spec.url, dest)

        if not results[key]:
            if spec.required:
                print(f"  Required asset '{key}' failed — aborting.")
                return 1
            print(f"  Optional asset '{key}' unavailable — continuing.")

    failed = [k for k, ok in results.items() if not ok]
    if failed:
        print(f"\nFailed to download: {', '.join(failed)}")

    _print_status(data_dir)
    return 0 if not failed else 1


def _build_parser() -> argparse.ArgumentParser:
    """Construct the top-level argument parser with sub-commands."""
    parser = argparse.ArgumentParser(
        prog="download_models.py",
        description="Download ONNX models and vocabulary files for NLP Engine.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  python3 scripts/download_models.py check\n"
            "  python3 scripts/download_models.py download\n"
            "  python3 scripts/download_models.py download --models embed,vocab\n"
            "  python3 scripts/download_models.py download --models tessdata\n"
            "  python3 scripts/download_models.py download --force\n"
            "  python3 scripts/download_models.py --dir /tmp/data download\n"
        ),
    )
    parser.add_argument(
        "--dir",
        metavar="PATH",
        help="override the model directory (default: data/models/ next to webviewapp/)",
    )

    sub = parser.add_subparsers(dest="command", title="commands")
    sub.required = True

    sub.add_parser("check", help="print a status table showing which models are present")

    dl = sub.add_parser("download", help="download model files from Hugging Face")
    dl.add_argument(
        "--models",
        metavar="KEYS",
        help=(
            "comma-separated subset of models to fetch "
            f"({', '.join(MODELS)})"
        ),
    )
    dl.add_argument(
        "--force",
        action="store_true",
        help="re-download even when the destination file already exists",
    )

    return parser


def main() -> None:
    """Parse CLI arguments and dispatch to the appropriate command handler."""
    parser  = _build_parser()
    args    = parser.parse_args()
    handler = {"check": _cmd_check, "download": _cmd_download}.get(args.command)
    if handler is None:
        parser.print_help()
        sys.exit(1)
    sys.exit(handler(args))


if __name__ == "__main__":
    main()
