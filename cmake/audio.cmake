# cmake/audio.cmake — CSound dependency resolution.
#
# Resolution order (first match wins):
#   0. cmake CONFIG   — vcpkg / cmake-installed csound (find_package CONFIG)
#   1. pkg-config     — Linux packages, MacPorts with pkgconfig port
#   2. find_library   — system paths + user-supplied SGF_CSOUND_ROOT
#   3. ExternalProject — SGF_FETCH_AUDIO=ON  (builds libsndfile + CSound from source)
#
# User knobs:
#   SGF_WITH_AUDIO=ON/OFF      enable/disable (default OFF)
#   SGF_FETCH_AUDIO=ON         download & build libsndfile + CSound from source
#   SGF_CSOUND_ROOT=/path      root of an existing CSound install
#
# Without brew:
#   vcpkg:    vcpkg install csound  (set VCPKG_ROOT; dev.py auto-detects)
#   MacPorts: port install csound   → /opt/local
#   Manual:   cmake -DSGF_CSOUND_ROOT=/my/csound
#   Fetch:    cmake -DSGF_FETCH_AUDIO=ON  (compiles from source; ~3-5 min first run)

# ── User knobs ────────────────────────────────────────────────────────────────

option(SGF_WITH_AUDIO
    "Build with CSound audio backend (offline WAV export)"
    OFF)

option(SGF_FETCH_AUDIO
    "Download + build libsndfile and CSound from source (no package manager needed)"
    OFF)

set(SGF_CSOUND_ROOT "" CACHE PATH
    "CSound install prefix (lib/ + include/ subdirs). Overrides all auto-detection.")

# INTERFACE target (always created so consumers can link unconditionally)

add_library(audio_csound INTERFACE)
set(AUDIO_CSOUND_FOUND FALSE)

if(NOT SGF_WITH_AUDIO)
    message(STATUS "[audio] SGF_WITH_AUDIO=OFF — audio backend is a no-op stub")
    return()
endif()

# cmake CONFIG (vcpkg or cmake-installed CSound)
#
# vcpkg places csoundConfig.cmake (or CsoundConfig.cmake) under the toolchain
# prefix, which CMake already has on CMAKE_PREFIX_PATH when the vcpkg toolchain
# file is loaded.  dev.py sets that up automatically via VCPKG_ROOT.

find_package(CSound CONFIG QUIET)
if(NOT CSound_FOUND)
    find_package(csound CONFIG QUIET)
endif()

if(CSound_FOUND OR csound_FOUND)
    # Prefer modern namespaced targets; fall back to legacy variables.
    if(TARGET csound::csound)
        target_link_libraries(audio_csound INTERFACE csound::csound)
    elseif(TARGET CSound::CSound)
        target_link_libraries(audio_csound INTERFACE CSound::CSound)
    elseif(DEFINED CSOUND_LIBRARIES AND CSOUND_LIBRARIES)
        target_include_directories(audio_csound INTERFACE ${CSOUND_INCLUDE_DIRS})
        target_link_libraries(audio_csound      INTERFACE ${CSOUND_LIBRARIES})
    endif()
    set(AUDIO_CSOUND_FOUND TRUE)
    message(STATUS "[audio] CSound found via cmake CONFIG (vcpkg or cmake install)")
endif()

# ── Phase 1 — pkg-config ──────────────────────────────────────────────────────
#
# Works on Linux (system packages), MacPorts when the pkgconfig port is present,
# and any install that ships a .pc file.

if(NOT AUDIO_CSOUND_FOUND)
    find_package(PkgConfig QUIET)

    if(PkgConfig_FOUND)
        pkg_check_modules(CSOUND QUIET csound64)
        if(NOT CSOUND_FOUND)
            pkg_check_modules(CSOUND QUIET csound)
        endif()

        if(CSOUND_FOUND)
            message(STATUS "[audio] CSound found via pkg-config: ${CSOUND_LINK_LIBRARIES}")
            target_include_directories(audio_csound INTERFACE ${CSOUND_INCLUDE_DIRS})
            # Use CSOUND_LINK_LIBRARIES (full paths) rather than the bare
            # CSOUND_LIBRARIES list so the linker gets the exact library files.
            target_link_libraries(audio_csound INTERFACE ${CSOUND_LINK_LIBRARIES})
            set(AUDIO_CSOUND_FOUND TRUE)
        endif()
    endif()
endif()

# find_library
#
# HINTS (SGF_CSOUND_ROOT) are evaluated before the standard CMake search paths;
# CMAKE_PREFIX_PATH entries (populated by vcpkg or the user) are already in the
# default search, so vcpkg installs are covered here too as a backstop.

if(NOT AUDIO_CSOUND_FOUND)
    find_library(CSOUND_LIB
        NAMES csound64 csound CsoundLib64
        HINTS
            "${SGF_CSOUND_ROOT}/lib"                    # user-supplied root
        PATHS
            "/opt/homebrew/lib"                         # Homebrew Apple Silicon
            "/usr/local/lib"                            # Homebrew Intel / manual
            "/opt/local/lib"                            # MacPorts
            "/usr/lib"                                  # Linux system
            "C:/Program Files/Csound6_x64/lib"          # Windows official installer
            "C:/Program Files/Csound/lib"
    )

    find_path(CSOUND_INCLUDE
        NAMES csound/csound.hpp csound.hpp
        HINTS
            "${SGF_CSOUND_ROOT}/include"                # user-supplied root
        PATHS
            "/opt/homebrew/include"                     # Homebrew Apple Silicon
            "/usr/local/include"                        # Homebrew Intel / manual
            "/opt/local/include"                        # MacPorts
            "/usr/include"                              # Linux system
            "C:/Program Files/Csound6_x64/include"      # Windows official installer
            "C:/Program Files/Csound/include"
    )

    if(CSOUND_LIB AND CSOUND_INCLUDE)
        message(STATUS "[audio] CSound found via find_library: ${CSOUND_LIB}, include: ${CSOUND_INCLUDE}")
        target_include_directories(audio_csound INTERFACE "${CSOUND_INCLUDE}")
        target_link_libraries(audio_csound      INTERFACE "${CSOUND_LIB}")
        set(AUDIO_CSOUND_FOUND TRUE)
    endif()
endif()

# xternalProject fetch (SGF_FETCH_AUDIO=ON)
#
# Downloads and builds libsndfile 1.2.2 + CSound 6.18.1 from source into
# ${CMAKE_BINARY_DIR}/_deps_installed/audio.  Nothing is installed system-wide.
# Artifacts are cached between builds; only the first cmake --build is slow.
#
# Requires: cmake ≥ 3.15, a C/C++ compiler, make/ninja.
# Not supported on Windows (autotools dependency inside CSound's build).

if(NOT AUDIO_CSOUND_FOUND AND SGF_FETCH_AUDIO)

    if(WIN32)
        message(WARNING
            "[audio] SGF_FETCH_AUDIO=ON is not supported on Windows (requires autotools). "
            "Use vcpkg: vcpkg install csound:x64-windows")
        set(SGF_WITH_AUDIO OFF CACHE BOOL "" FORCE)
        return()
    endif()

    include(ExternalProject)
    include(ProcessorCount)

    ProcessorCount(_audio_ncpu)
    if(_audio_ncpu EQUAL 0)
        set(_audio_ncpu 4)
    endif()

    # Shared staging prefix for both sub-projects.
    set(_audio_inst "${CMAKE_BINARY_DIR}/_deps_installed/audio")

    message(STATUS
        "[audio] SGF_FETCH_AUDIO=ON — libsndfile + CSound built from source "
        "on first cmake --build (~3-5 min)")

    # libsndfile 1.2.2
    # Built as a static library so CSound (and our binary) can link it without
    # requiring a separate shared-library install.

    ExternalProject_Add(libsndfile_build
        URL       "https://github.com/libsndfile/libsndfile/archive/refs/tags/1.2.2.tar.gz"
        URL_HASH   SHA256=ffe12ef8add3eaca876f04087734e6e8e029350082f3251f565fa9da55b52121
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        DOWNLOAD_DIR "${CMAKE_BINARY_DIR}/_deps_downloads"
        SOURCE_DIR   "${CMAKE_BINARY_DIR}/_deps_src/libsndfile_src"
        BINARY_DIR   "${CMAKE_BINARY_DIR}/_deps_src/libsndfile_build"
        INSTALL_DIR  "${_audio_inst}"
        CMAKE_ARGS
            "-DCMAKE_BUILD_TYPE=Release"
            "-DCMAKE_INSTALL_PREFIX=<INSTALL_DIR>"
            "-DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}"
            "-DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}"
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
            "-DBUILD_SHARED_LIBS=OFF"       # static only — no .dylib/.so installed
            "-DBUILD_PROGRAMS=OFF"
            "-DBUILD_EXAMPLES=OFF"
            "-DBUILD_TESTING=OFF"
            "-DENABLE_EXTERNAL_LIBS=OFF"    # skip ogg/vorbis/flac/opus to keep it simple
            "-DENABLE_MPEG=OFF"
        BUILD_BYPRODUCTS "${_audio_inst}/lib/libsndfile.a"
    )

    # CSound 6.18.1
    # Static lib name is platform-specific:
    #   macOS → libCsoundLib64.a
    #   Linux → libcsound64.a

    if(APPLE)
        set(_csound_static_lib "${_audio_inst}/lib/libCsoundLib64.a")
    else()
        set(_csound_static_lib "${_audio_inst}/lib/libcsound64.a")
    endif()

    ExternalProject_Add(csound_build
        DEPENDS libsndfile_build
        URL       "https://github.com/csound/csound/archive/refs/tags/6.18.1.tar.gz"
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        PATCH_COMMAND
            ${CMAKE_COMMAND}
                "-DFILE=<SOURCE_DIR>/include/plugin.h"
                -P "${CMAKE_CURRENT_LIST_DIR}/patches/csound_opadr.cmake"
        DOWNLOAD_DIR "${CMAKE_BINARY_DIR}/_deps_downloads"
        SOURCE_DIR   "${CMAKE_BINARY_DIR}/_deps_src/csound_src"
        BINARY_DIR   "${CMAKE_BINARY_DIR}/_deps_src/csound_build"
        INSTALL_DIR  "${_audio_inst}"
        CMAKE_ARGS
            "-DCMAKE_BUILD_TYPE=Release"
            "-DCMAKE_INSTALL_PREFIX=<INSTALL_DIR>"
            "-DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}"
            "-DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}"
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
            # Static library output
            "-DBUILD_STATIC_LIBRARY=ON"
            "-DBUILD_SHARED_LIBS=OFF"
            # Disable everything we do not need (WAV offline export only)
            "-DBUILD_TESTS=OFF"
            "-DBUILD_MANUAL=OFF"
            "-DBUILD_UTILITIES=OFF"
            "-DUSE_PORTAUDIO=OFF"
            "-DUSE_PORTMIDI=OFF"
            "-DUSE_ALSA=OFF"
            "-DUSE_PULSEAUDIO=OFF"
            "-DUSE_JACK=OFF"
            "-DUSE_CURL=OFF"
            "-DUSE_JAVA=OFF"
            "-DUSE_LUA=OFF"
            "-DUSE_PYTHON=OFF"
            "-DUSE_FLTK=OFF"
            "-DUSE_GETTEXT=OFF"
            # 64-bit samples match our rendering pipeline
            "-DUSE_DOUBLE_PRECISION=ON"
            # Point CSound's cmake at our freshly-built libsndfile
            "-DLIBSNDFILE_INCLUDE_DIR=${_audio_inst}/include"
            "-DLIBSNDFILE_LIBRARY=${_audio_inst}/lib/libsndfile.a"
        BUILD_BYPRODUCTS "${_csound_static_lib}"
    )

    # INTERFACE wrapper
    # add_dependencies ensures CSound is fully built before our binary's link
    # step, even though ExternalProject targets are not "real" imported targets.

    add_library(csound_fetched INTERFACE)
    add_dependencies(csound_fetched csound_build)

    target_include_directories(csound_fetched INTERFACE "${_audio_inst}/include")

    target_link_libraries(csound_fetched INTERFACE
        "${_csound_static_lib}"
        "${_audio_inst}/lib/libsndfile.a"
    )

    # Platform-specific system frameworks / libs required at link time.
    if(APPLE)
        target_link_libraries(csound_fetched INTERFACE
            "-framework CoreAudio"
            "-framework AudioToolbox"
            "-framework CoreFoundation"
        )
    elseif(UNIX)
        target_link_libraries(csound_fetched INTERFACE
            "-lm" "-lpthread" "-ldl"
        )
    endif()

    target_link_libraries(audio_csound INTERFACE csound_fetched)
    set(AUDIO_CSOUND_FOUND TRUE)

endif() # SGF_FETCH_AUDIO

# Final fallback — nothing worked
if(NOT AUDIO_CSOUND_FOUND)
    message(WARNING "[audio] SGF_WITH_AUDIO=ON but CSound not found.\n"
        "  Options (no brew needed):\n"
        "    Fetch (compile from source): add -DSGF_FETCH_AUDIO=ON to cmake\n"
        "    vcpkg:    set VCPKG_ROOT; dev.py auto-installs csound\n"
        "    MacPorts: port install csound  → detected automatically\n"
        "    Manual:   cmake -DSGF_CSOUND_ROOT=/path/to/csound")
    set(SGF_WITH_AUDIO OFF CACHE BOOL "" FORCE)
endif()
