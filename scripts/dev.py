#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import os
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")


def run(cmd: Iterable[str], cwd: Optional[Path] = None, check: bool = True) -> subprocess.CompletedProcess:
    logging.info("Running: %s", " ".join(cmd))
    return subprocess.run(list(cmd), cwd=(str(cwd) if cwd else None), check=check)


def clean_cmake_cache(build_dir: Path) -> None:
    """Remove CMakeCache.txt and CMakeFiles/ while preserving build/_deps.

    This forces a full re-configuration on the next cmake run without
    re-downloading any FetchContent dependencies.
    """
    cache = build_dir / "CMakeCache.txt"
    cmake_files = build_dir / "CMakeFiles"
    if cache.exists():
        cache.unlink()
        logging.info("Cleaned %s", cache)
    if cmake_files.is_dir():
        shutil.rmtree(cmake_files)
        logging.info("Cleaned %s/", cmake_files)


def cmake_configure(source_dir: Path, build_dir: Path, build_type: str = "Release", extra: Optional[List[str]] = None) -> None:
    extra = extra or []
    cmd = ["cmake", "-S", str(source_dir), "-B", str(build_dir), f"-DCMAKE_BUILD_TYPE={build_type}"] + extra
    run(cmd)


def cmake_build(build_dir: Path, config: str = "Release", target: Optional[str] = None, jobs: Optional[int] = None) -> None:
    cmd = ["cmake", "--build", str(build_dir), "--config", config]
    if target:
        cmd += ["--target", target]
    if jobs:
        cmd += ["--", f"-j{jobs}"]
    run(cmd)


def find_executable(build_dir: Path, target_name: str, platform_hint: str) -> Optional[Path]:
    """Try to locate the built executable for the given target in a few common places.

    This is heuristic: CMake generators and OSes differ. We search common filenames.
    """
    candidates = []
    if platform_hint == "windows":
        candidates = [f"{target_name}.exe", f"{target_name}.dll"]
    else:
        candidates = [target_name]

    # Common locations: build/, build/bin, build/<config>/, build/<target>/*
    search_dirs = [build_dir, build_dir / "bin", build_dir / "Release", build_dir / "Debug"]
    for d in search_dirs:
        if not d.exists():
            continue
        for cand in candidates:
            p = d / cand
            if p.exists() and os.access(p, os.X_OK):
                return p
    # Fallback: find any executable file with target_name substring
    for p in build_dir.rglob('*'):
        if p.is_file() and target_name in p.name and os.access(p, os.X_OK):
            return p
    return None


def make_app_bundle(app_name: str, executable: Path, resources: Optional[Iterable[Path]], out_dir: Path) -> Path:
    bundle_dir = out_dir / f"{app_name}.app"
    contents = bundle_dir / "Contents"
    macos_dir = contents / "MacOS"
    resources_dir = contents / "Resources"
    macos_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)
    target_exec = macos_dir / executable.name
    shutil.copy2(executable, target_exec)
    target_exec.chmod(0o755)
    if resources:
        for r in resources:
            if r.exists():
                if r.is_dir():
                    dst = resources_dir / r.name
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(r, dst)
                else:
                    shutil.copy2(r, resources_dir / r.name)

    # Minimal Info.plist
    info = contents / "Info.plist"
    info.write_text("""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>CFBundleExecutable</key><string>%s</string>
  <key>CFBundleIdentifier</key><string>org.example.%s</string>
  <key>CFBundleName</key><string>%s</string>
</dict>
</plist>
""" % (executable.name, app_name.lower(), app_name))

    return bundle_dir


def package_tar_gz(name: str, files: Iterable[Path], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / f"{name}.tar.gz"
    with tarfile.open(archive, "w:gz") as tf:
        for f in files:
            tf.add(f, arcname=f.name)
    return archive


def package_zip(name: str, files: Iterable[Path], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / f"{name}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
    return archive


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dev.py", description="Build/release/deploy helper for this project")
    sub = parser.add_subparsers(dest="command")

    # debug
    p_debug = sub.add_parser("debug", help="Configure and build Debug (dev) target")
    p_debug.add_argument("--build-dir", type=Path, default=Path("build"))
    p_debug.add_argument("--source-dir", type=Path, default=Path("."))
    p_debug.add_argument("--target", type=str, default=None, help="CMake target name to build")
    p_debug.add_argument("-j", "--jobs", type=int, default=None)
    p_debug.add_argument(
        "--fresh", action="store_true",
        help="Wipe CMakeCache.txt + CMakeFiles/ before configuring (keeps _deps/)")

    # release
    p_rel = sub.add_parser("release", help="Build Release target for a platform")
    p_rel.add_argument("--platform", choices=["macos", "linux", "windows", "ios"], default="macos")
    p_rel.add_argument("--build-dir", type=Path, default=Path("build"))
    p_rel.add_argument("--source-dir", type=Path, default=Path("."))
    p_rel.add_argument("--target", type=str, default=None)
    p_rel.add_argument("-j", "--jobs", type=int, default=None)
    p_rel.add_argument("--cmake-extra", nargs="*", default=None, help="Extra -D flags for cmake configure")
    p_rel.add_argument(
        "--fresh", action="store_true",
        help="Wipe CMakeCache.txt + CMakeFiles/ before configuring (keeps _deps/)")

    # deploy
    p_dep = sub.add_parser("deploy", help="Package and prepare release for a platform")
    p_dep.add_argument("--platform", choices=["macos", "linux", "windows"], default="macos")
    p_dep.add_argument("--build-dir", type=Path, default=Path("build"))
    p_dep.add_argument("--target", type=str, default=None)
    p_dep.add_argument("--resources", type=Path, nargs="*", default=None, help="Extra resource files/dirs to include")
    p_dep.add_argument("--out", type=Path, default=Path("dist"))
    p_dep.add_argument("--use-wine", action="store_true", help="Run the produced Windows binary under wine after packaging (optional)")

    # test (run a built binary)
    p_test = sub.add_parser("test", help="Run a built binary (useful to smoke-test)" )
    p_test.add_argument("--build-dir", type=Path, default=Path("build"))
    p_test.add_argument("--target", type=str, default=None)
    p_test.add_argument("--platform", choices=["macos", "linux", "windows"], default=sys.platform)
    p_test.add_argument("--use-wine", action="store_true")

    # ocr_mac
    p_ocr = sub.add_parser("build-ocr-mac", help="Build the standalone OCR tool (macOS only)")

    # deps
    p_deps = sub.add_parser("deps", help="Install build prerequisites (cross-platform)")
    p_deps.add_argument(
        "--dry-run", action="store_true",
        help="Print commands without executing them"
    )

    return parser


def _cmake_configure_with_retry(
    sd: Path,
    bd: Path,
    build_type: str = "Debug",
    extra: Optional[List[str]] = None,
    fresh: bool = False,
) -> None:
    """Run cmake configure, auto-retrying once with a clean cache on failure.

    A stale CMakeCache.txt (e.g. one created before OBJCXX was added to the
    project() declaration) causes cmake to fail during the generation phase
    with 'CMAKE_OBJCXX_COMPILE_OBJECT not set'.  Wiping the cache and
    CMakeFiles/ — while keeping _deps/ so FetchContent is not re-downloaded —
    fixes this without a full from-scratch configure.
    """
    if fresh:
        logging.info("--fresh: wiping CMake cache (preserving _deps/)...")
        clean_cmake_cache(bd)

    presets_file = sd / "CMakePresets.json"
    try:
        if presets_file.exists():
            preset = "debug" if build_type == "Debug" else "default"
            logging.info("Using CMake preset '%s'...", preset)
            run(["cmake", "--preset", preset], cwd=sd)
        else:
            cmake_configure(sd, bd, build_type=build_type, extra=extra)
    except subprocess.CalledProcessError:
        if fresh:
            # Already tried with a clean cache — give up.
            raise
        logging.warning(
            "CMake configure failed.  Retrying with a clean cache "
            "(CMakeCache.txt + CMakeFiles/ removed, _deps/ preserved)..."
        )
        clean_cmake_cache(bd)
        if presets_file.exists():
            preset = "debug" if build_type == "Debug" else "default"
            run(["cmake", "--preset", preset], cwd=sd)
        else:
            cmake_configure(sd, bd, build_type=build_type, extra=extra)


def _cmd_debug(args: argparse.Namespace) -> int:
    bd: Path = args.build_dir
    sd: Path = args.source_dir

    # Build the React frontend directly (cmake also does this during configure,
    # but running it first means the dist/ assets are fresh before cmake scans
    # them for saucer_embed()).
    logging.info("Building frontend...")
    frontend_pkg = sd / "frontend" / "packages" / "react-client"
    run(["bun", "run", "build.ts", "--minify"], cwd=frontend_pkg)

    # Configure — includes saucer_embed() rescan of the updated dist/.
    logging.info("Configuring CMake (debug)...")
    _cmake_configure_with_retry(sd, bd, build_type="Debug", fresh=args.fresh)

    logging.info("Building debug target...")
    cmake_build(bd, config="Debug", target=args.target, jobs=args.jobs)
    return 0


def _cmd_release(args: argparse.Namespace) -> int:
    bd: Path = args.build_dir
    sd: Path = args.source_dir
    plat: str = args.platform
    logging.info("Configuring Release build for %s in %s", plat, bd)
    extra = args.cmake_extra or []
    processed_extra = [
        (e if e.startswith("-D") else f"-D{e}") for e in extra
    ]
    _cmake_configure_with_retry(
        sd, bd, build_type="Release", extra=processed_extra, fresh=args.fresh
    )
    cmake_build(bd, config="Release", target=args.target, jobs=args.jobs)
    return 0


def _cmd_deploy(args: argparse.Namespace) -> int:
    bd: Path = args.build_dir
    target: Optional[str] = args.target
    plat: str = args.platform
    out_dir: Path = args.out
    resources = args.resources
    logging.info("Preparing deployment for %s (build=%s) -> %s", plat, bd, out_dir)

    if target is None:
        logging.warning("No target specified; attempting to infer one from CMake cache or binary names")
        # try to pick a name from CMakeCache
        cache = bd / "CMakeCache.txt"
        if cache.exists():
            for line in cache.read_text().splitlines():
                if line.startswith("CMAKE_PROJECT_NAME:INTERNAL="):
                    target = line.split("=", 1)[1].strip()
                    logging.info("Inferred target name '%s' from CMakeCache.txt", target)
                    break

    if target is None:
        logging.error("Unable to determine target name. Please pass --target <name>")
        return 2

    exe = find_executable(bd, target, plat)
    if exe is None:
        logging.error("Could not find built executable for target '%s' in %s", target, bd)
        return 3

    out_dir = out_dir / plat
    out_dir.mkdir(parents=True, exist_ok=True)

    packaged = None
    if plat == "macos":
        app = make_app_bundle(target, exe, resources, out_dir)
        packaged = package_tar_gz(f"{target}-macos", [app], out_dir)
    elif plat == "linux":
        files = [exe]
        if resources:
            files += list(resources)
        packaged = package_tar_gz(f"{target}-linux", files, out_dir)
    elif plat == "windows":
        files = [exe]
        if resources:
            files += list(resources)
        packaged = package_zip(f"{target}-windows", files, out_dir)
    else:
        logging.error("Unsupported platform for deploy: %s", plat)
        return 4

    logging.info("Created package: %s", packaged)

    if plat == "windows" and args.use_wine:
        logging.info("Running packaged exe under wine for quick smoke test")
        try:
            run(["wine", str(exe)])
        except Exception as e:
            logging.error("Failed to run under wine: %s", e)

    return 0


def _cmd_test(args: argparse.Namespace) -> int:
    bd: Path = args.build_dir
    target: Optional[str] = args.target
    plat: str = args.platform
    if target is None:
        logging.error("Please provide --target to run a test")
        return 2
    exe = find_executable(bd, target, plat)
    if exe is None:
        logging.error("Could not find executable '%s' in %s", target, bd)
        return 3
    cmd = [str(exe)]
    if args.use_wine and plat == "windows":
        cmd = ["wine"] + cmd
    run(cmd)
    return 0


def _cmd_build_ocr_mac(args: argparse.Namespace) -> int:
    script = Path("scripts/build_ocr_mac.sh")
    if not script.exists():
        logging.error("Build script not found: %s", script)
        return 1
    run(["/bin/bash", str(script)])
    return 0


def _cmd_deps(args: argparse.Namespace) -> int:
    """Install build prerequisites using the platform's native package manager.

    macOS : tries Homebrew (brew), then MacPorts (port)
    Linux : tries apt-get, then pacman, then dnf/yum
    Windows: tries winget, then choco (Chocolatey)

    All C/C++ library dependencies (sqlcipher etc.) are fetched at CMake
    configure time via FetchContent into build/_deps — no system package
    is required for them.  This command only ensures the *toolchain* tools
    (cmake, a C++ compiler, bun/node for the frontend) are present.
    """
    import platform as _plat

    dry: bool = getattr(args, "dry_run", False)

    def _run_install(cmd: List[str]) -> bool:
        if dry:
            logging.info("[dry-run] %s", " ".join(cmd))
            return True
        try:
            run(cmd, check=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

    def _has(tool: str) -> bool:
        return shutil.which(tool) is not None

    system = _plat.system()  # "Darwin", "Linux", "Windows"
    logging.info("Detected platform: %s", system)

    # ── Required tools ────────────────────────────────────────────────────────
    # cmake  : build system
    # clang / gcc / MSVC : C++23 compiler (detected by CMake itself)
    # bun    : frontend build toolchain (https://bun.sh)
    # git    : needed by FetchContent
    # pkg-config : used by CMake SQLCipher detection

    if system == "Darwin":
        # ── macOS ─────────────────────────────────────────────────────────────
        if _has("brew"):
            mgr = "brew"
            def install(*pkgs: str) -> bool:
                return _run_install(["brew", "install"] + list(pkgs))
        elif _has("port"):
            mgr = "port"
            def install(*pkgs: str) -> bool:
                return _run_install(["sudo", "port", "install"] + list(pkgs))
        else:
            logging.error(
                "No package manager found on macOS.\n"
                "Install Homebrew from https://brew.sh  or  MacPorts from https://www.macports.org"
            )
            return 1

        logging.info("Using package manager: %s", mgr)

        tools = {
            "cmake":      (["cmake"],       "cmake"),
            "git":        (["git"],          "git"),
            "pkg-config": (["pkgconf"],      "pkgconf"),
        }
        for tool, (pkgs, label) in tools.items():
            if _has(tool):
                logging.info("  %-14s already installed", tool)
            else:
                logging.info("  %-14s installing via %s\u2026", tool, mgr)
                install(*pkgs)

        # bun (frontend)
        if _has("bun"):
            logging.info("  %-14s already installed", "bun")
        else:
            logging.info("  %-14s installing via curl\u2026", "bun")
            _run_install(["sh", "-c",
                          "curl -fsSL https://bun.sh/install | bash"])

    elif system == "Linux":
        # ── Linux ─────────────────────────────────────────────────────────────
        if _has("apt-get"):
            mgr = "apt-get"
            def install(*pkgs: str) -> bool:
                return _run_install(
                    ["sudo", "apt-get", "install", "-y"] + list(pkgs))
        elif _has("pacman"):
            mgr = "pacman"
            def install(*pkgs: str) -> bool:
                return _run_install(
                    ["sudo", "pacman", "-S", "--noconfirm"] + list(pkgs))
        elif _has("dnf"):
            mgr = "dnf"
            def install(*pkgs: str) -> bool:
                return _run_install(
                    ["sudo", "dnf", "install", "-y"] + list(pkgs))
        elif _has("yum"):
            mgr = "yum"
            def install(*pkgs: str) -> bool:
                return _run_install(
                    ["sudo", "yum", "install", "-y"] + list(pkgs))
        else:
            logging.error("No supported package manager found (apt/pacman/dnf/yum).")
            return 1

        logging.info("Using package manager: %s", mgr)

        # Package names vary by distro — we map per-manager.
        pkg_map = {
            "apt-get": {
                "cmake":       "cmake",
                "clang":       "clang",
                "git":         "git",
                "pkg-config":  "pkg-config",
                "webkit":      "libwebkitgtk-6.0-dev",
                "ninja":       "ninja-build",
            },
            "pacman": {
                "cmake":       "cmake",
                "clang":       "clang",
                "git":         "git",
                "pkg-config":  "pkgconf",
                "webkit":      "webkit2gtk-4.1",
                "ninja":       "ninja",
            },
            "dnf": {
                "cmake":       "cmake",
                "clang":       "clang",
                "git":         "git",
                "pkg-config":  "pkgconf-pkg-config",
                "webkit":      "webkitgtk6.0-devel",
                "ninja":       "ninja-build",
            },
        }
        packages = pkg_map.get(mgr, pkg_map["dnf"])

        for label, pkg in packages.items():
            logging.info("  %-14s ensuring %s\u2026", label, pkg)
            install(pkg)

        # bun
        if _has("bun"):
            logging.info("  %-14s already installed", "bun")
        else:
            logging.info("  %-14s installing via curl\u2026", "bun")
            _run_install(["sh", "-c",
                          "curl -fsSL https://bun.sh/install | bash"])

    elif system == "Windows":
        # ── Windows ───────────────────────────────────────────────────────────
        if _has("winget"):
            mgr = "winget"
            def install(*ids: str) -> bool:
                ok = True
                for pkg_id in ids:
                    ok = _run_install(
                        ["winget", "install", "--id", pkg_id,
                         "-e", "--silent", "--accept-package-agreements",
                         "--accept-source-agreements"]) and ok
                return ok
        elif _has("choco"):
            mgr = "choco"
            def install(*pkgs: str) -> bool:
                return _run_install(["choco", "install", "-y"] + list(pkgs))
        else:
            logging.error(
                "No package manager found on Windows.\n"
                "Install winget (Windows Package Manager) or Chocolatey (https://chocolatey.org)."
            )
            return 1

        logging.info("Using package manager: %s", mgr)

        win_pkgs = {
            "winget": [
                "Kitware.CMake",
                "LLVM.LLVM",
                "Git.Git",
                "Oven-sh.Bun",
            ],
            "choco": [
                "cmake",
                "llvm",
                "git",
            ],
        }
        for pkg in win_pkgs.get(mgr, win_pkgs["choco"]):
            logging.info("  Installing %s\u2026", pkg)
            install(pkg)

        # bun on Windows (winget handles it above; choco fallback)
        if mgr == "choco" and not _has("bun"):
            logging.info("  %-14s installing via PowerShell\u2026", "bun")
            _run_install([
                "powershell", "-Command",
                "irm bun.sh/install.ps1 | iex"
            ])

    else:
        logging.error("Unsupported platform: %s", system)
        return 1

    logging.info("")
    logging.info("All prerequisites checked. Run: python scripts/dev.py release --platform %s",
                 {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(system, system.lower()))
    return 0


def main() -> None:
    """Parse CLI arguments and dispatch to the appropriate command handler."""
    parser = _build_parser()
    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
    handler = {
        "test":          _cmd_test,
        "debug":         _cmd_debug,
        "release":       _cmd_release,
        "deploy":        _cmd_deploy,
        "build-ocr-mac": _cmd_build_ocr_mac,
        "deps":          _cmd_deps,
    }.get(args.command)
    if handler is None:
        parser.print_help()
        sys.exit(1)
    sys.exit(handler(args))


if __name__ == "__main__":
    main()
