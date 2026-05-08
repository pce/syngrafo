# cmake/fetch_deps.cmake — Third-party dependencies via plain FetchContent.
#
# Design principles
# ─────────────────
# • URL tarballs only — no GIT_REPOSITORY.  FetchContent with GIT_REPOSITORY
#   triggers find_package(Git) inside ExternalProject; on Windows CI vcpkg
#   intercepts that call and recurses >1000 levels (fatal CMake error).
#
# • We do NOT use CPM ourselves.  Saucer v8 uses CPM internally for its own
#   deps (lockpp, coco, …), and we can't avoid that.  Setting CPM_MODULE_PATH
#   to the build tree keeps saucer's generated FindXxx.cmake files out of the
#   source directory.
#
# • saucer_prefer_remote ON → CPM_DOWNLOAD_ALL ON inside saucer.  This makes
#   saucer's CPM always download without calling find_package(), which is the
#   safest choice on Windows+vcpkg (vcpkg intercepts every find_package call).
#
# • saucer::desktop is NOT bundled by saucer v8 — it must be added separately.
#   We use URL tarball and add it after saucer so saucer's targets are ready.
#
# Useful overrides
# ─────────────────
#   Local checkout:  cmake -DFETCHCONTENT_SOURCE_DIR_SAUCER=/path/to/checkout
#   Network-free:    cmake -DFETCHCONTENT_FULLY_DISCONNECTED=ON  (reuse cache)

# Redirect saucer's internal CPM Find-module output to the build tree.
# Without this, saucer's packageProject() writes CPM_modules/Findsaucer.cmake
# into the root source directory.
set(CPM_MODULE_PATH "${CMAKE_BINARY_DIR}/cmake/cpm_modules")

# ── saucer options (set before FetchContent_MakeAvailable) ───────────────────
set(saucer_examples                  OFF CACHE BOOL "" FORCE)
set(saucer_tests                     OFF CACHE BOOL "" FORCE)
set(saucer_static                    ON  CACHE BOOL "" FORCE)
# prefer_remote ON  →  CPM_DOWNLOAD_ALL ON inside saucer
#   = saucer's internal CPM always fetches, never calls find_package()
#   = no vcpkg find_package interception on Windows CI
set(saucer_prefer_remote             ON  CACHE BOOL "" FORCE)
set(saucer_no_compiler_version_check ON  CACHE BOOL "" FORCE)
set(saucer_no_version_check          ON  CACHE BOOL "" FORCE)

# ── saucer (webview core) ─────────────────────────────────────────────────────
# Latest: v8.0.5  • https://github.com/saucer/saucer/releases
FetchContent_Declare(
    saucer
    URL     https://github.com/saucer/saucer/archive/refs/tags/v8.0.5.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(saucer)

# MSVC / Windows SDK 26100: force-include missing Win32 headers for saucer targets.
# WIN32_LEAN_AND_MEAN (set by saucer) strips several headers from <windows.h>:
#   <objbase.h> / <objidl.h>  — IStream, CoTaskMemFree (saucer core)
#   <winternl.h>              — NTSTATUS (saucer win32 layer)
#   <shellapi.h>              — ShellExecuteW (saucer-desktop)
if(MSVC AND TARGET saucer)
    set(_saucer_msvc_fix "${CMAKE_BINARY_DIR}/saucer_msvc_fix.h")
    file(WRITE "${_saucer_msvc_fix}"
        "#include <objbase.h>\n"
        "#include <objidl.h>\n"
        "#include <winternl.h>\n"
        "#include <shellapi.h>\n"
    )
    target_compile_options(saucer PRIVATE "/FI${_saucer_msvc_fix}")
    message(STATUS "[saucer] Applied Windows SDK 26100 COM + NTSTATUS + Shell header fix")
endif()

# saucer::desktop (file/folder picker)
# saucer v8 does NOT auto-add desktop — confirmed from saucer's CMakeLists.txt.
# Must be added explicitly. Added AFTER saucer so the saucer targets saucer-
# desktop links against (saucer::saucer) are already defined.
# Latest: v4.2.0  • https://github.com/saucer/desktop/releases
FetchContent_Declare(
    saucer_desktop
    URL     https://github.com/saucer/desktop/archive/refs/tags/v4.2.0.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(saucer_desktop)

# saucer-desktop also needs ShellExecuteW from <shellapi.h> which WIN32_LEAN_AND_MEAN
# excludes.  Apply the same force-include used for saucer core.
if(MSVC AND TARGET saucer-desktop)
    target_compile_options(saucer-desktop PRIVATE "/FI${_saucer_msvc_fix}")
    message(STATUS "[saucer-desktop] Applied Windows SDK header fix")
endif()

# saucer::pdf — export current WebView page as PDF.
# v3.1.0 is the version referenced by the saucer v8 example tree.
FetchContent_Declare(
    saucer_pdf
    URL     https://github.com/saucer/pdf/archive/refs/tags/v3.1.0.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(saucer_pdf)

# saucer-pdf compiles wv2.pdf.cpp which includes saucer/win32.utils.hpp
# (needs CoTaskMemFree → <objbase.h>) and pulls in GDI+ headers
# (GdiplusHeaders.h, GdiplusFlat.h) that require IStream and PROPID from
# <objidl.h>.  WIN32_LEAN_AND_MEAN strips both; apply the same force-include
# used for saucer core and saucer-desktop.
if(MSVC AND TARGET saucer-pdf)
    target_compile_options(saucer-pdf PRIVATE "/FI${_saucer_msvc_fix}")
    message(STATUS "[saucer-pdf] Applied Windows SDK header fix")
endif()
