# cmake/video.cmake — FFmpeg dependency resolution for video decode backend.
#
# Resolution order (first match wins):
#   0. cmake CONFIG   — vcpkg find_package(FFmpeg CONFIG) or FindFFmpeg modules
#   1. pkg-config     — Linux packages, MacPorts with pkgconfig port
#   2. find_library   — system paths + user-supplied SGF_FFMPEG_ROOT
#   3. ExternalProject — SGF_FETCH_VIDEO=ON  (builds FFmpeg from source; macOS/Linux only)
#
# Required components: avformat avcodec avutil swscale swresample
# Sets INTERFACE target: video_ffmpeg
#
# User knobs:
#   SGF_WITH_VIDEO=ON/OFF     enable/disable (default OFF)
#   SGF_FETCH_VIDEO=ON        download & build FFmpeg 7.1 from source
#   SGF_FFMPEG_ROOT=/path     root of an existing FFmpeg install
#
# Without brew:
#   vcpkg:    vcpkg install ffmpeg  (set VCPKG_ROOT; dev.py auto-detects)
#   MacPorts: port install ffmpeg   → /opt/local
#   Manual:   cmake -DSGF_FFMPEG_ROOT=/my/ffmpeg
#   Fetch:    cmake -DSGF_FETCH_VIDEO=ON  (builds from source; ~5-10 min first run)

# ── User knobs ─────────────────────────────────────────────────────────────────
option(SGF_WITH_VIDEO  "Build with FFmpeg video backend" OFF)
option(SGF_FETCH_VIDEO "Download + build FFmpeg 7.1 from source (macOS/Linux; no package manager needed)" OFF)
set(SGF_FFMPEG_ROOT "" CACHE PATH "FFmpeg install prefix (lib/ + include/ subdirs). Overrides all auto-detection.")

# ── INTERFACE target used by the rest of the build ────────────────────────────
add_library(video_ffmpeg INTERFACE)
set(VIDEO_FFMPEG_FOUND FALSE)

if(NOT SGF_WITH_VIDEO)
    message(STATUS "[video] SGF_WITH_VIDEO=OFF — video backend is a no-op stub")
    return()
endif()

set(_ffmpeg_components avformat avcodec avutil swscale swresample)

# ══════════════════════════════════════════════════════════════════════════════
# Phase 0 — cmake CONFIG (vcpkg or a cmake-installed FFmpeg)
#
# vcpkg's FFmpeg port installs proper CMake config files under
#   <vcpkg-root>/installed/<triplet>/share/ffmpeg/
# When CMAKE_TOOLCHAIN_FILE points at vcpkg.cmake, CMAKE_PREFIX_PATH is already
# set so find_package will find them automatically.
# ══════════════════════════════════════════════════════════════════════════════
find_package(FFmpeg CONFIG QUIET
    COMPONENTS avformat avcodec avutil swscale swresample)

if(FFmpeg_FOUND)
    foreach(_comp ${_ffmpeg_components})
        if(TARGET FFmpeg::${_comp})
            target_link_libraries(video_ffmpeg INTERFACE FFmpeg::${_comp})
        endif()
    endforeach()
    set(VIDEO_FFMPEG_FOUND TRUE)
    message(STATUS "[video] FFmpeg found via cmake CONFIG (vcpkg or cmake install)")
endif()

# ══════════════════════════════════════════════════════════════════════════════
# Phase 1 — pkg-config
#
# Works on Linux (distro packages), macOS with MacPorts + the pkgconfig port,
# and vcpkg builds that ship .pc files.
# We use FFMPEG_${_comp}_LINK_LIBRARIES (full paths) rather than
# FFMPEG_${_comp}_LIBRARIES (bare -l flags) so the linker always gets an
# absolute path, which is more reliable with static libs and multi-arch setups.
# ══════════════════════════════════════════════════════════════════════════════
if(NOT VIDEO_FFMPEG_FOUND)
    find_package(PkgConfig QUIET)

    if(PkgConfig_FOUND)
        set(_pkg_all_found TRUE)

        foreach(_comp ${_ffmpeg_components})
            pkg_check_modules(FFMPEG_${_comp} QUIET lib${_comp})
            if(NOT FFMPEG_${_comp}_FOUND)
                set(_pkg_all_found FALSE)
            endif()
        endforeach()

        if(_pkg_all_found)
            foreach(_comp ${_ffmpeg_components})
                # Prefer full-path link libraries; fall back to bare flags.
                if(FFMPEG_${_comp}_LINK_LIBRARIES)
                    target_link_libraries(video_ffmpeg INTERFACE
                        ${FFMPEG_${_comp}_LINK_LIBRARIES})
                else()
                    target_link_libraries(video_ffmpeg INTERFACE
                        ${FFMPEG_${_comp}_LIBRARIES})
                endif()
                target_include_directories(video_ffmpeg INTERFACE
                    ${FFMPEG_${_comp}_INCLUDE_DIRS})
                message(STATUS "[video] lib${_comp} found via pkg-config")
            endforeach()
            set(VIDEO_FFMPEG_FOUND TRUE)
            message(STATUS "[video] All FFmpeg components found via pkg-config")
        endif()
    endif()
endif()

# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — find_library / find_path
#
# Searches in (order of precedence):
#   1. SGF_FFMPEG_ROOT (user-supplied prefix)
#   2. CMAKE_PREFIX_PATH (vcpkg toolchain, custom installs)
#   3. Standard system paths + known package-manager prefixes
#
# /opt/local is MacPorts; /opt/homebrew and /usr/local are Homebrew (not
# required — listed as fallback only so users who do have Homebrew don't need
# to set SGF_FFMPEG_ROOT).
# ══════════════════════════════════════════════════════════════════════════════
if(NOT VIDEO_FFMPEG_FOUND)
    # Wipe any stale NOTFOUND entries written by a previous configure run.
    # CMake's find_library / find_path skip the search when the variable
    # already exists in the cache — even as NOTFOUND — so a newly installed
    # FFmpeg would be silently missed without this explicit reset.
    foreach(_comp ${_ffmpeg_components})
        unset(_lib_${_comp} CACHE)
        unset(_inc_${_comp} CACHE)
    endforeach()

    set(_find_all_found TRUE)

    foreach(_comp ${_ffmpeg_components})
        find_library(_lib_${_comp} NAMES ${_comp}
            HINTS
                "${SGF_FFMPEG_ROOT}/lib"
            PATHS
                "/opt/local/lib"              # MacPorts
                "/opt/homebrew/lib"           # Homebrew Apple Silicon
                "/usr/local/lib"              # Homebrew Intel / manual
                "/usr/lib"
                "/usr/lib/x86_64-linux-gnu"
                "/usr/lib/aarch64-linux-gnu"
        )
        find_path(_inc_${_comp} NAMES "lib${_comp}/${_comp}.h"
            HINTS
                "${SGF_FFMPEG_ROOT}/include"
            PATHS
                "/opt/local/include"          # MacPorts
                "/opt/homebrew/include"       # Homebrew Apple Silicon
                "/usr/local/include"          # Homebrew Intel / manual
                "/usr/include"
        )

        if(_lib_${_comp} AND _inc_${_comp})
            target_link_libraries(video_ffmpeg      INTERFACE "${_lib_${_comp}}")
            target_include_directories(video_ffmpeg INTERFACE "${_inc_${_comp}}")
            message(STATUS "[video] lib${_comp} found via find_library: ${_lib_${_comp}}")
        else()
            message(STATUS "[video] lib${_comp} NOT found in system paths "
                "(lib=${_lib_${_comp}}, inc=${_inc_${_comp}})")
            set(_find_all_found FALSE)
        endif()
    endforeach()

    if(_find_all_found)
        set(VIDEO_FFMPEG_FOUND TRUE)
        message(STATUS "[video] All FFmpeg components found via find_library")
    endif()
endif()

# ══════════════════════════════════════════════════════════════════════════════
# Phase 3 — ExternalProject: build FFmpeg 7.1 from source
#
# Activated only when SGF_FETCH_VIDEO=ON and no prior phase succeeded.
# Uses FFmpeg's own autotools configure + make, which requires a POSIX
# environment.  Windows + MSVC is explicitly unsupported.
#
# The build runs once during the first `cmake --build` (not during cmake
# configuration) and is cached in CMAKE_BINARY_DIR/_deps_installed/ffmpeg.
# ══════════════════════════════════════════════════════════════════════════════
if(NOT VIDEO_FFMPEG_FOUND AND SGF_FETCH_VIDEO)
    if(WIN32)
        message(WARNING "[video] SGF_FETCH_VIDEO=ON is not supported on Windows "
            "(FFmpeg uses autotools, incompatible with MSVC). "
            "Use vcpkg: vcpkg install ffmpeg:x64-windows")
        set(SGF_WITH_VIDEO OFF CACHE BOOL "" FORCE)
        return()
    endif()

    include(ExternalProject)
    include(ProcessorCount)
    ProcessorCount(_video_ncpu)
    if(_video_ncpu EQUAL 0)
        set(_video_ncpu 4)
    endif()

    set(_ffmpeg_ver  "7.1")
    set(_ffmpeg_inst "${CMAKE_BINARY_DIR}/_deps_installed/ffmpeg")
    set(_ffmpeg_src  "${CMAKE_BINARY_DIR}/_deps_src/ffmpeg_src")

    message(STATUS "[video] SGF_FETCH_VIDEO=ON — FFmpeg ${_ffmpeg_ver} will be "
        "built from source on first cmake --build (~5-10 min)")

    # ── Optional: nasm for x86/x64 assembly optimisations ────────────────────
    # Not needed on arm64; silently omitted if nasm is not on PATH.
    set(_ffmpeg_asm_flag "")
    if(NOT (CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64"))
        find_program(_ffmpeg_nasm nasm QUIET)
        if(NOT _ffmpeg_nasm)
            set(_ffmpeg_asm_flag "--disable-x86asm")
            message(STATUS "[video] nasm not found — x86 assembly optimisations disabled")
        endif()
    endif()

    # ── Byproducts let Ninja/Make know about the static archives ─────────────
    set(_ffmpeg_byproducts "")
    foreach(_comp ${_ffmpeg_components})
        list(APPEND _ffmpeg_byproducts "${_ffmpeg_inst}/lib/lib${_comp}.a")
    endforeach()

    ExternalProject_Add(ffmpeg_build
        URL      "https://ffmpeg.org/releases/ffmpeg-${_ffmpeg_ver}.tar.gz"
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        DOWNLOAD_DIR "${CMAKE_BINARY_DIR}/_deps_downloads"
        SOURCE_DIR   "${_ffmpeg_src}"

        # FFmpeg's configure script must run from the source tree.
        BUILD_IN_SOURCE TRUE

        CONFIGURE_COMMAND
            "${_ffmpeg_src}/configure"
            "--prefix=${_ffmpeg_inst}"
            "--disable-debug"
            "--disable-doc"
            "--disable-programs"      # no ffmpeg / ffprobe / ffplay binaries
            "--disable-network"       # no network protocols
            "--disable-bsfs"          # no bitstream filters
            "--disable-devices"       # no capture / output devices
            "--disable-filters"       # no lavfi filter graph
            "--enable-static"
            "--disable-shared"
            "--enable-small"          # size optimisation (no measurable speed loss for decode)
            "--cc=${CMAKE_C_COMPILER}"
            ${_ffmpeg_asm_flag}

        BUILD_COMMAND   make -j${_video_ncpu}
        INSTALL_COMMAND make install

        BUILD_BYPRODUCTS ${_ffmpeg_byproducts}
    )

    # ── INTERFACE wrapper target ───────────────────────────────────────────────
    # The rest of the build links against ffmpeg_fetched (not ffmpeg_build
    # directly) so that include paths and system libs travel with the target.
    add_library(ffmpeg_fetched INTERFACE)
    add_dependencies(ffmpeg_fetched ffmpeg_build)
    target_include_directories(ffmpeg_fetched INTERFACE "${_ffmpeg_inst}/include")

    foreach(_comp ${_ffmpeg_components})
        target_link_libraries(ffmpeg_fetched INTERFACE
            "${_ffmpeg_inst}/lib/lib${_comp}.a")
    endforeach()

    # ── Platform system libs required by a static FFmpeg ─────────────────────
    if(APPLE)
        # VideoToolbox = hardware-accelerated H.264/HEVC on Apple Silicon & Intel.
        target_link_libraries(ffmpeg_fetched INTERFACE
            "-framework CoreFoundation"
            "-framework CoreVideo"
            "-framework VideoToolbox"
            "-framework CoreMedia"
            "-framework AudioToolbox"
            "-framework CoreAudio"
            "-liconv"
            "-lz"
            "-lbz2"
        )
    elseif(UNIX)
        target_link_libraries(ffmpeg_fetched INTERFACE
            "-lm" "-lpthread" "-ldl" "-lz")
    endif()

    target_link_libraries(video_ffmpeg INTERFACE ffmpeg_fetched)
    set(VIDEO_FFMPEG_FOUND TRUE)
endif()

# ══════════════════════════════════════════════════════════════════════════════
# Final guard — nothing worked
# ══════════════════════════════════════════════════════════════════════════════
if(NOT VIDEO_FFMPEG_FOUND)
    message(WARNING "[video] SGF_WITH_VIDEO=ON but FFmpeg not found.\n"
        "  Options (no brew needed):\n"
        "    Fetch (compile from source): add -DSGF_FETCH_VIDEO=ON to cmake\n"
        "    vcpkg:    set VCPKG_ROOT; dev.py auto-installs ffmpeg\n"
        "    MacPorts: port install ffmpeg  → detected automatically\n"
        "    Manual:   cmake -DSGF_FFMPEG_ROOT=/path/to/ffmpeg")
    set(SGF_WITH_VIDEO OFF CACHE BOOL "" FORCE)
endif()
