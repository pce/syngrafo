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
            "/Applications/Csound"                      # CSound 7 macOS official installer
            "/opt/homebrew/lib"                         # Homebrew Apple Silicon
            "/usr/local/lib"                            # Homebrew Intel / manual
            "/opt/local/lib"                            # MacPorts
            "/usr/lib"                                  # Linux system
            "C:/Program Files/Csound/lib"               # Windows official installer
    )

    find_path(CSOUND_INCLUDE
        NAMES csound/csound.hpp csound.hpp
        HINTS
            "${SGF_CSOUND_ROOT}/include"                # user-supplied root
        PATHS
            "/Applications/Csound/CsoundLib64.framework/Headers"  # CSound 7 macOS
            "/opt/homebrew/include"                     # Homebrew Apple Silicon
            "/usr/local/include"                        # Homebrew Intel / manual
            "/opt/local/include"                        # MacPorts
            "/usr/include"                              # Linux system
            "C:/Program Files/Csound/include"           # Windows official installer
    )

    if(CSOUND_LIB AND CSOUND_INCLUDE)
        message(STATUS "[audio] CSound found via find_library: ${CSOUND_LIB}, include: ${CSOUND_INCLUDE}")

        # macOS framework installs place headers directly in .framework/Headers/
        # (no csound/ subdirectory), but the source uses #include <csound/csound.hpp>.
        # Create a compatibility symlink in the build tree so the Unix-style path works.
        if(CSOUND_INCLUDE MATCHES "\\.framework/Headers$")
            set(_csound_compat "${CMAKE_BINARY_DIR}/csound_include_compat")
            file(MAKE_DIRECTORY "${_csound_compat}")
            if(NOT EXISTS "${_csound_compat}/csound")
                file(CREATE_LINK "${CSOUND_INCLUDE}" "${_csound_compat}/csound" SYMBOLIC)
            endif()
            target_include_directories(audio_csound INTERFACE "${_csound_compat}")

            # Export the framework directory so cmake/bundle_apple.cmake can copy
            # it into Contents/Frameworks/ at build time.  Without this the binary
            # has install name @rpath/CsoundLib64.framework/... baked in but nothing
            # is ever placed there — dyld kills the process at launch with SIGABRT:
            #   Library not loaded: @rpath/CsoundLib64.framework/Versions/6.0/CsoundLib64
            # FORCE is intentional: re-configuring after a brew reinstall must
            # always reflect the current framework location.
            string(REGEX REPLACE "/Headers$" "" _csound_fw_dir "${CSOUND_INCLUDE}")
            set(SGF_CSOUND_FRAMEWORK_DIR "${_csound_fw_dir}"
                CACHE PATH
                "CSound .framework directory — copied into .app/Contents/Frameworks/ by bundle_apple.cmake"
                FORCE)
            message(STATUS "[audio] CSound framework dir: ${_csound_fw_dir}")
            unset(_csound_fw_dir)
        else()
            target_include_directories(audio_csound INTERFACE "${CSOUND_INCLUDE}")
            # Non-framework install (vcpkg flat dylib, MacPorts, manual prefix).
            # Clear any stale value from a previous framework-based configure run.
            unset(SGF_CSOUND_FRAMEWORK_DIR CACHE)
        endif()

        # ── Record the dylib install name for install_name_tool in bundle_apple ─
        # CSound 7 uses an absolute install name (/Applications/Csound/...) rather
        # than @rpath/..., so bundle_apple.cmake must rewrite the reference after
        # copying the framework.  We capture it here at configure time.
        if(CSOUND_INCLUDE MATCHES "\\.framework/Headers$")
            set(_csound_bin "${CSOUND_LIB}/CsoundLib64")
        else()
            set(_csound_bin "${CSOUND_LIB}")
        endif()
        execute_process(
            COMMAND otool -D "${_csound_bin}"
            OUTPUT_VARIABLE _csound_otool_raw
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_QUIET
        )
        string(REGEX REPLACE ".*[\r\n]([^\r\n]+)$" "\\1" _csound_install_name "${_csound_otool_raw}")
        string(STRIP "${_csound_install_name}" _csound_install_name)
        set(SGF_CSOUND_INSTALL_NAME "${_csound_install_name}"
            CACHE STRING "CSound dylib install name (used by bundle_apple.cmake install_name_tool)" FORCE)
        message(STATUS "[audio] CSound install name: ${_csound_install_name}")
        unset(_csound_bin)
        unset(_csound_otool_raw)
        unset(_csound_install_name)

        # ── Require CSound 7 — reject silently if CSound 6 found ──────────────
        # CompileCSD(str, mode, async) is the CSound 7 replacement for CompileCsdText.
        # If it's absent, the installed CSound is pre-7.  We un-cache the find
        # results and let execution fall through to the SGF_FETCH_AUDIO block so a
        # fresh build can download the v7 pre-built framework automatically.
        include(CheckCXXSourceCompiles)
        if(CSOUND_INCLUDE MATCHES "\\.framework/Headers$")
            set(_csound_v_inc "${_csound_compat}")
        else()
            set(_csound_v_inc "${CSOUND_INCLUDE}")
        endif()
        # Force re-probe: a stale cache hit from a CSound 6 install would skip the check even after upgrading to v7.
        unset(_CSOUND7_API_OK CACHE)
        cmake_push_check_state(RESET)
        set(CMAKE_REQUIRED_INCLUDES "${_csound_v_inc}")
        set(CMAKE_REQUIRED_LIBRARIES "${CSOUND_LIB}")
        check_cxx_source_compiles(
            "#include <csound/csound.hpp>
             void f() { Csound cs; cs.CompileCSD(\"\", 1, 0); }"
            _CSOUND7_API_OK)
        cmake_pop_check_state()
        unset(_csound_v_inc)

        if(NOT _CSOUND7_API_OK)
            message(STATUS
                "[audio] CSound at ${CSOUND_LIB} is pre-7.0 (CompileCSD missing) — "
                "discarding; will fall through to SGF_FETCH_AUDIO if ON")
            # Wipe cache so the next configure does not re-use the v6 find results
            unset(CSOUND_LIB           CACHE)
            unset(CSOUND_INCLUDE       CACHE)
            unset(SGF_CSOUND_FRAMEWORK_DIR CACHE)
            unset(SGF_CSOUND_INSTALL_NAME  CACHE)
        else()
            target_link_libraries(audio_csound INTERFACE "${CSOUND_LIB}")
            set(AUDIO_CSOUND_FOUND TRUE)
        endif()
    endif()
endif()

# ── ExternalProject fetch — CSound 7 pre-built framework (macOS) or source (Linux) ──
#
# SGF_FETCH_AUDIO=ON downloads CSound 7.0.0-beta.16:
#   macOS : pre-built universal framework extracted from the official .pkg release.
#           No compiler or bison/flex needed.
#   Linux : builds from source.  Requires bison >= 3 and flex.
#
# The framework binary's install name is an absolute path
# (/Applications/Csound/CsoundLib64.framework/CsoundLib64); bundle_apple.cmake
# rewrites it to @rpath/... using install_name_tool during POST_BUILD.

if(NOT AUDIO_CSOUND_FOUND AND SGF_FETCH_AUDIO)

    if(WIN32)
        message(WARNING
            "[audio] SGF_FETCH_AUDIO=ON is not supported on Windows. "
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

    set(_audio_inst "${CMAKE_BINARY_DIR}/_deps_installed/audio")

    if(APPLE)
        # ── macOS: download the official pre-built universal framework ──────────
        # No source build needed — avoids bison/flex/libsndfile dependency chain.
        # URL: https://github.com/csound/csound/releases/tag/7.0.0-beta.16
        # SHA: ad541bd8586426a8d7a542e22f4b20449a256aec9dd5d01235b93978f87aa00b

        set(_csound7_fw "${_audio_inst}/CsoundLib64.framework")

        message(STATUS
            "[audio] SGF_FETCH_AUDIO=ON (macOS) — downloading CSound 7.0.0-beta.16 "
            "pre-built framework (universal, ~14 MB)")

        ExternalProject_Add(csound_fetch
            URL
                "https://github.com/csound/csound/releases/download/7.0.0-beta.16/csound-macos-7.0.0-beta.16.zip"
            URL_HASH
                SHA256=ad541bd8586426a8d7a542e22f4b20449a256aec9dd5d01235b93978f87aa00b
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
            DOWNLOAD_DIR "${CMAKE_BINARY_DIR}/_deps_downloads"
            SOURCE_DIR   "${CMAKE_BINARY_DIR}/_deps_src/csound7_zip"
            # No cmake build system inside the zip
            CONFIGURE_COMMAND ""
            BUILD_COMMAND
                ${CMAKE_COMMAND}
                    "-DPKG_FILE=<SOURCE_DIR>/CsoundLib64-7.0.0-beta.16-beta-universal.pkg"
                    "-DDST_DIR=${_audio_inst}"
                    -P "${CMAKE_CURRENT_LIST_DIR}/patches/extract_csound_pkg.cmake"
            INSTALL_COMMAND ""
            BUILD_BYPRODUCTS "${_csound7_fw}/CsoundLib64"
        )

        # INTERFACE wrapper — depends on the ExternalProject so the framework is
        # fully extracted before syngrafo's link step.
        add_library(csound_fetched INTERFACE)
        add_dependencies(csound_fetched csound_fetch)

        # Framework compat symlink: headers live at Headers/ (no csound/ subdir)
        # but source uses #include <csound/csound.hpp>.
        set(_csound7_compat "${CMAKE_BINARY_DIR}/csound_include_compat")
        file(MAKE_DIRECTORY "${_csound7_compat}")
        # The symlink creation must happen after the ExternalProject runs, so we
        # use a helper target instead of file(CREATE_LINK ...) at configure time.
        add_custom_command(TARGET csound_fetch POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory "${_csound7_compat}"
            COMMAND ${CMAKE_COMMAND} -E create_symlink
                "${_csound7_fw}/Headers"
                "${_csound7_compat}/csound"
            COMMENT "[audio] Creating CSound 7 header compat symlink"
            VERBATIM
        )

        target_include_directories(csound_fetched INTERFACE "${_csound7_compat}")
        target_link_libraries(csound_fetched INTERFACE "${_csound7_fw}/CsoundLib64")

        # The fetched framework binary has install name:
        #   /Applications/Csound/CsoundLib64.framework/CsoundLib64
        # Record it so bundle_apple.cmake can rewrite the reference.
        set(SGF_CSOUND_INSTALL_NAME
            "/Applications/Csound/CsoundLib64.framework/CsoundLib64"
            CACHE STRING "CSound dylib install name (used by bundle_apple.cmake install_name_tool)" FORCE)
        set(SGF_CSOUND_FRAMEWORK_DIR "${_csound7_fw}"
            CACHE PATH "CSound .framework directory — copied into .app/Contents/Frameworks/" FORCE)

        unset(_csound7_fw)
        unset(_csound7_compat)

    else()
        # ── Linux: build CSound 7 from source ───────────────────────────────────
        # Requires: bison >= 3 and flex  (apt install bison flex)

        find_program(_csound_bison bison DOC "Bison parser generator (>= 3.x required for CSound 7)")
        find_program(_csound_flex  flex  DOC "Flex scanner generator")

        if(NOT _csound_bison OR NOT _csound_flex)
            message(FATAL_ERROR
                "[audio] Building CSound 7 from source requires bison >= 3 and flex.\n"
                "  Ubuntu/Debian: apt install bison flex\n"
                "  Fedora/RHEL:   dnf install bison flex")
        endif()

        set(_audio_inst "${CMAKE_BINARY_DIR}/_deps_installed/audio")
        set(_csound_static_lib "${_audio_inst}/lib/libcsound64.a")

        # libsndfile 1.2.2 — required by CSound for audio file I/O
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
                "-DBUILD_SHARED_LIBS=OFF"
                "-DBUILD_PROGRAMS=OFF"
                "-DBUILD_EXAMPLES=OFF"
                "-DBUILD_TESTING=OFF"
                "-DENABLE_EXTERNAL_LIBS=OFF"
                "-DENABLE_MPEG=OFF"
            BUILD_BYPRODUCTS "${_audio_inst}/lib/libsndfile.a"
        )

        ExternalProject_Add(csound_build
            DEPENDS libsndfile_build
            URL       "https://github.com/csound/csound/archive/refs/tags/7.0.0-beta.16.tar.gz"
            URL_HASH   SHA256=2ddec74f6da11b7b5c40ea41c3cf5bab05d5c56d8afbbb45f41a04bfb11d5c1e
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
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
                "-DBUILD_STATIC_LIBRARY=ON"
                "-DBUILD_SHARED_LIBS=OFF"
                "-DBISON_EXECUTABLE=${_csound_bison}"
                "-DFLEX_EXECUTABLE=${_csound_flex}"
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
                "-DUSE_LIBSAMPLERATE=OFF"
                "-DUSE_DOUBLE=ON"
                "-DBUILD_UTILITIES=OFF"
                "-DBUILD_TESTS=OFF"
                "-DBUILD_MANUAL=OFF"
                "-DBUILD_INSTALLER=OFF"
                "-DBUILD_DOCS=OFF"
                "-DCMAKE_PREFIX_PATH=${_audio_inst}"
            BUILD_BYPRODUCTS "${_csound_static_lib}"
        )

        add_library(csound_fetched INTERFACE)
        add_dependencies(csound_fetched csound_build)
        target_include_directories(csound_fetched INTERFACE "${_audio_inst}/include/csound")
        target_link_libraries(csound_fetched INTERFACE
            "${_csound_static_lib}"
            "${_audio_inst}/lib/libsndfile.a"
            "-lm" "-lpthread" "-ldl"
        )

        unset(_csound_static_lib)
        unset(_csound_bison)
        unset(_csound_flex)
    endif()

    target_link_libraries(audio_csound INTERFACE csound_fetched)
    set(AUDIO_CSOUND_FOUND TRUE)

endif() # SGF_FETCH_AUDIO

# ── macOS: locate .framework for app bundle (all detection paths) ───────────
# SGF_CSOUND_FRAMEWORK_DIR is only set inside the find_library branch above.
# On Homebrew macOS, CSound is found via pkg-config (Phase 1) which short-
# circuits find_library — so the variable is never populated, the bundling
# condition in bundle_apple.cmake silently evaluates to false, and the app
# crashes at launch:
#   SIGABRT — Library not loaded: @rpath/CsoundLib64.framework/...
#
# Note: SGF_FETCH_AUDIO=ON is the user's *intent* but does NOT override Phase 1.
# If pkg-config finds a system framework first, ExternalProject is skipped and
# the binary links against the framework regardless of SGF_FETCH_AUDIO.  The
# framework directory (not the fetch flag) is the correct signal for bundling.
if(APPLE AND AUDIO_CSOUND_FOUND
        AND (NOT DEFINED SGF_CSOUND_FRAMEWORK_DIR OR NOT SGF_CSOUND_FRAMEWORK_DIR))
    # Wipe any stale entry so we always re-scan on every configure run.
    unset(_csound_fw_parent CACHE)
    find_path(_csound_fw_parent
        NAMES "CsoundLib64.framework"
        PATHS
            "/Applications/Csound"            # CSound 7 official macOS installer
            "/opt/homebrew/Frameworks"         # Homebrew Apple Silicon (arm64)
            "/usr/local/Frameworks"            # Homebrew Intel (x86_64)
            "/Library/Frameworks"              # system-wide install
            "/opt/local/Library/Frameworks"    # MacPorts
        NO_DEFAULT_PATH
    )
    if(_csound_fw_parent)
        set(SGF_CSOUND_FRAMEWORK_DIR "${_csound_fw_parent}/CsoundLib64.framework"
            CACHE PATH
            "CSound .framework directory — copied into .app/Contents/Frameworks/ by bundle_apple.cmake"
            FORCE)
        message(STATUS "[audio] CSound framework dir (auto-detected): ${SGF_CSOUND_FRAMEWORK_DIR}")
    else()
        message(STATUS "[audio] CSound: no .framework found in standard locations — bundle copy skipped")
        unset(SGF_CSOUND_FRAMEWORK_DIR CACHE)
    endif()
    unset(_csound_fw_parent CACHE)
endif()

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
