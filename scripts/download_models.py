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
from pathlib import Path


_BAR_WIDTH: int = 42
_CHUNK_BYTES: int = 65_536


@dataclass(frozen=True)
class ModelSpec:
    """Specification for a single downloadable asset."""

    filename: str
    url: str
    size_hint: str
    description: str
    required: bool = False
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
    "ocr": ModelSpec(
        filename="ocr.onnx",
        url=(
            "https://huggingface.co/Xenova/pp-ocrv3-en-recognition-cpu/"
            "resolve/main/onnx/model_quantized.onnx"
        ),
        size_hint="~12 MB",
        description="PP-OCRv3 Recognition int8 — fallback for non-Apple OCR",
        labels=[
            # Standard PP-OCR char set (approx 94 chars)
            "blank", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~", " "
        ],
        output_node="softmax_0.tmp_0",
        activation="softmax",
    ),
}


def _default_model_dir() -> Path:
    """Return the default model directory relative to this script."""
    return Path(__file__).resolve().parent.parent / "data" / "models"


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


def _presence(model_dir: Path) -> dict[str, bool]:
    """Return a mapping of model key → whether the file exists on disk."""
    return {key: (model_dir / spec.filename).exists() for key, spec in MODELS.items()}


def _print_status(model_dir: Path) -> None:
    """Print a formatted status table for all known assets."""
    present = _presence(model_dir)
    col_key  = 12
    col_file = 22
    col_stat = 10

    print(f"\nModel directory: {model_dir.resolve()}\n")
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
    model_dir = Path(args.dir) if args.dir else _default_model_dir()
    _print_status(model_dir)
    return 0


def _cmd_download(args: argparse.Namespace) -> int:
    """Handle the 'download' sub-command."""
    model_dir = Path(args.dir) if args.dir else _default_model_dir()

    if args.models:
        requested = [k.strip() for k in args.models.split(",") if k.strip()]
        unknown   = sorted(set(requested) - set(MODELS))
        if unknown:
            print(f"Unknown model keys: {', '.join(unknown)}")
            print(f"Available keys:     {', '.join(MODELS)}")
            return 1
    else:
        requested = list(MODELS.keys())

    model_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, bool] = {}

    for key in requested:
        spec = MODELS[key]
        dest = model_dir / spec.filename

        if dest.exists() and not args.force:
            size_bytes = dest.stat().st_size
            print(f"  {key:<12} already present ({size_bytes / 1_048_576:.1f} MB) — skipping")
            results[key] = True
            continue

        print(f"\n{key}  ({spec.size_hint})")
        print(f"  {spec.description}")
        print(f"  {spec.url}")
        results[key] = _download_file(spec.url, dest)

        if not results[key]:
            if spec.required:
                print(f"  Required asset '{key}' failed — aborting.")
                return 1
            print(f"  Optional asset '{key}' unavailable — continuing.")

    failed = [k for k, ok in results.items() if not ok]
    if failed:
        print(f"\nFailed to download: {', '.join(failed)}")

    _print_status(model_dir)
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
            "  python3 scripts/download_models.py download --force\n"
            "  python3 scripts/download_models.py --dir /tmp/models download\n"
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
