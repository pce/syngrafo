# 3.25 = minimum supported; 3.31 = highest policy version understood.
# CMake 3.25–3.30 will build with 3.25 policies; 3.31+ uses the full policy set.
cmake_minimum_required(VERSION 3.25...3.31)

# ─── Standalone vs monorepo build ────────────────────────────────────────────
# When included by the nlp_engine monorepo the nlp_engine target already exists.
# When built standalone (cd webviewapp && cmake --preset default) we pull the
# engine in as a subdirectory.

if(NOT TARGET nlp_engine)
    set(NLP_ENGINE_ROOT
        "${CMAKE_CURRENT_SOURCE_DIR}/external/nlp"
        CACHE PATH "Root of the nlp_engine project (sibling directory of papiere/)")

    set(BUILD_TESTING         OFF CACHE BOOL "" FORCE)
    set(BUILD_PYTHON_BINDINGS OFF CACHE BOOL "" FORCE)

    add_subdirectory(
        "${NLP_ENGINE_ROOT}"
        "${CMAKE_CURRENT_BINARY_DIR}/nlp_engine_deps"
        EXCLUDE_FROM_ALL
    )
endif()


# Single source of truth — bump this file to cut a new release.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" SYNGRAFO_VERSION)
string(STRIP "${SYNGRAFO_VERSION}" SYNGRAFO_VERSION)

# Objective-C++ is required on Apple for .mm sources in both the main app and
# the NLP engine addons (ocr_addon_apple.mm, exif_addon_apple.mm,
# rectifier_addon_apple.mm).  OBJCXX *must* be declared here, inside project(),
# so CMake records it in CMakeCache.txt on the first configure run.  A later
# enable_language(OBJCXX) call is not cached and therefore breaks stale-cache
# regenerations with "CMAKE_OBJCXX_COMPILE_OBJECT not set".
#
# CMAKE_HOST_SYSTEM_NAME is always available before project() — it reflects the
# host OS independently of toolchain files or prior cache state.
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Darwin")
    set(_PROJECT_LANGS C CXX OBJCXX)
else()
    set(_PROJECT_LANGS C CXX)
endif()

project(syngrafo LANGUAGES ${_PROJECT_LANGS} VERSION ${SYNGRAFO_VERSION})
unset(_PROJECT_LANGS)

if(APPLE)
    set(CMAKE_OBJCXX_STANDARD          23)
    set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
    set(CMAKE_OBJCXX_EXTENSIONS        OFF)
endif()


set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Prevent vcpkg's _find_package override from recursing infinitely inside
# FetchContent on CMake 3.31+ (vcpkg intercepts find_package calls that
# FetchContent makes internally, leading to >1000 recursive calls).
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER)

include(FetchContent)

# Ensure FetchContent places downloads into the top-level build/_deps folder so
# dependencies are fetched into the build tree instead of polluting the source
# tree when running out-of-source builds (cmake -S . -B build).
set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps")

FetchContent_Declare(
    saucer
    GIT_REPOSITORY https://github.com/saucer/saucer.git
    GIT_TAG        v8.0.5
    GIT_SHALLOW    TRUE
)

set(saucer_static                      ON  CACHE BOOL "" FORCE)
set(saucer_examples                    OFF CACHE BOOL "" FORCE)
set(saucer_tests                       OFF CACHE BOOL "" FORCE)
set(saucer_prefer_remote               ON  CACHE BOOL "" FORCE)
# Bypass the compiler version check — required for Clang < 20 builds and
# for the legacy variable name that some saucer versions still read.
set(saucer_no_compiler_version_check   ON  CACHE BOOL "" FORCE)
set(saucer_no_version_check            ON  CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(saucer)

# ── saucer::desktop ────────────────────────────────────────────────────────
FetchContent_Declare(
    saucer_desktop
    GIT_REPOSITORY https://github.com/saucer/desktop.git
    GIT_TAG        v4.2.0
    GIT_SHALLOW    TRUE
)

FetchContent_MakeAvailable(saucer_desktop)

#
# saucer_embed() generates one C++ source file per asset at *configure time*.
# The generated sources go into the binary dir — never into the source tree.
#
# Flow:
#   bun install + bun run build.ts → frontend/packages/react-client/dist/
#   cmake configure                → saucer_embed() scans dist/, generates .cpp
#   cmake --build                  → compiles embedded assets into the binary
#
# After a frontend-only change:
#   make frontend   ← rebuilds dist/
#   make configure  ← re-runs saucer_embed (or just `make` which does both)
#
# Use the top-level Makefile to run the full pipeline in one command.

set(FRONTEND_PKG  "${CMAKE_CURRENT_SOURCE_DIR}/frontend/packages/react-client")
set(FRONTEND_DIST "${FRONTEND_PKG}/dist")

find_program(BUN_EXECUTABLE bun REQUIRED
    DOC "Bun JS runtime — https://bun.sh")

message(STATUS "[syngrafo] Installing frontend dependencies...")
execute_process(
    COMMAND ${BUN_EXECUTABLE} install
    WORKING_DIRECTORY "${FRONTEND_PKG}"
    RESULT_VARIABLE _bun_install_exit
    OUTPUT_QUIET
)

message(STATUS "[syngrafo] Building frontend (bun)...")
execute_process(
    COMMAND ${BUN_EXECUTABLE} run build.ts --minify
    WORKING_DIRECTORY "${FRONTEND_PKG}"
    RESULT_VARIABLE _bun_exit
    OUTPUT_VARIABLE _bun_out
    ERROR_VARIABLE  _bun_err
)
if(_bun_exit)
    message(WARNING
        "[syngrafo] bun build failed (exit ${_bun_exit}):\n${_bun_err}\n"
        "  Embedded assets may be stale.  Fix with:\n"
        "    cd frontend/packages/react-client && bun install && bun run build.ts --minify\n"
        "  then re-run cmake configure.")
else()
    message(STATUS "[syngrafo] Frontend OK → ${FRONTEND_DIST}")
endif()

# Incremental rebuild on cmake --build (does NOT re-run saucer_embed;
# re-configure is needed for new embedded assets after frontend changes).
add_custom_target(syngrafo_frontend
    COMMAND ${BUN_EXECUTABLE} run build.ts --minify
    WORKING_DIRECTORY "${FRONTEND_PKG}"
    COMMENT "[syngrafo] Rebuilding frontend with bun..."
    BYPRODUCTS "${FRONTEND_DIST}/index.html"
)


add_executable(syngrafo
    app/main.cc
)

# ── Platform image decoder ────────────────────────────────────────────────────
# Apple: ImageIO/CoreGraphics backend (WebP, HEIC/HEIF, AVIF, TGA, PNG, JPEG…)
# Other: stb_image fallback (JPEG, PNG, BMP, TGA, GIF, HDR, PNM)
if(APPLE)
    target_sources(syngrafo PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/app/image_decode_apple.mm"
    )
else()
    target_sources(syngrafo PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/app/image_decode_generic.cc"
    )
endif()

add_dependencies(syngrafo syngrafo_frontend)

target_compile_features(syngrafo PRIVATE cxx_std_23)
target_compile_definitions(syngrafo PRIVATE
    SYNGRAFO_VERSION="${PROJECT_VERSION}"
)
set_target_properties(syngrafo PROPERTIES
    CXX_STANDARD          23
    CXX_EXTENSIONS        OFF
    CXX_STANDARD_REQUIRED ON
    SKIP_PRECOMPILE_HEADERS ON
)

# app/      → local headers (db/database.hh, future dms_bridge.hh …)
# external/ → nlp engine headers for local editing (onnx_addon.hh etc.)
target_include_directories(syngrafo PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/app"
    "${CMAKE_CURRENT_SOURCE_DIR}/external"
)

# Generate embedded sources into the top-level build directory (avoids writing
# into the repository root). Using CMAKE_BINARY_DIR ensures all generated
# sources live under the project build/ tree even when configuring from a
# subdirectory or IDE (CLion creates intermediate build subdirs).
set(FRONTEND_EMBEDDED_DIR "${CMAKE_BINARY_DIR}/embedded")

# Embed frontend assets (generate C++ byte-array sources from every file in
# FRONTEND_DIST).  Place generated files in the build tree and make the
# papiere target depend on the generation step.
saucer_embed("${FRONTEND_DIST}" DESTINATION "${FRONTEND_EMBEDDED_DIR}" TARGET syngrafo
    EXCLUDE ".DS_Store"
    EXCLUDE "*.map"
)
# saucer_embed() creates saucer_embedded_pre which re-reads dist/ at build time.
# syngrafo_frontend deletes and rebuilds dist/, so saucer_embedded_pre must not
# start until syngrafo_frontend has finished — otherwise it races the deletion.
add_dependencies(saucer_embedded_pre syngrafo_frontend)
# ── SQLCipher / SQLite3 ─────────────────────────────────────────────────────
#
# We prefer SQLCipher over plain SQLite3 because it provides transparent
# AES-256-CBC at-rest encryption via sqlite3_key() — activated by the
# SQLITE_HAS_CODEC compile-time flag and the Database::open_encrypted() API
# in app/db/database.hh.
#
# Detection order:
#   1. pkg-config  — covers Homebrew, apt, vcpkg, MacPorts automatically
#   2. Manual Homebrew search — Apple Silicon (/opt/homebrew) & Intel (/usr/local)
#   3. Plain SQLite3 via find_package — encryption inactive, warning printed
#   4. SQLite3 amalgamation download  — last-resort, no encryption
#
# The chosen library is always exposed as  SQLite::SQLite3  so the rest of
# this file (target_link_libraries) needs no changes.
#
# Install SQLCipher:
#   macOS : brew install sqlcipher
#   Ubuntu: apt install libsqlcipher-dev

find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(SQLCIPHER QUIET sqlcipher)
endif()

if(NOT SQLCIPHER_FOUND)
    # Manual search — Homebrew Apple Silicon, Homebrew Intel, common system paths.
    # We look inside the sqlcipher/ sub-directory because that is where the
    # Homebrew formula places the header: include/sqlcipher/sqlite3.h
    foreach(_sc_prefix
            /opt/homebrew/opt/sqlcipher   # Homebrew arm64
            /usr/local/opt/sqlcipher      # Homebrew x86_64
            /opt/homebrew                 # Homebrew generic
            /usr/local                    # macOS system / generic
            /usr)                         # Linux system
        find_path(_sc_inc sqlite3.h
            PATHS "${_sc_prefix}/include/sqlcipher"
            NO_DEFAULT_PATH)
        find_library(_sc_lib sqlcipher
            PATHS "${_sc_prefix}/lib"
            NO_DEFAULT_PATH)
        if(_sc_inc AND _sc_lib)
            set(SQLCIPHER_FOUND        TRUE)
            set(SQLCIPHER_INCLUDE_DIRS "${_sc_inc}")
            set(SQLCIPHER_LIBRARIES    "${_sc_lib}")
            break()
        endif()
        unset(_sc_inc CACHE)
        unset(_sc_lib CACHE)
    endforeach()
    unset(_sc_prefix)
endif()

if(SQLCIPHER_FOUND)
    message(STATUS "[syngrafo] SQLCipher FOUND  -  AES-256 at-rest encryption ACTIVE")
    message(STATUS "          includes : ${SQLCIPHER_INCLUDE_DIRS}")
    message(STATUS "          library  : ${SQLCIPHER_LIBRARIES}")

    # Expose SQLCipher as SQLite::SQLite3 so the rest of the build is unchanged.
    # INTERFACE include dir is the sqlcipher/ sub-directory so that
    # #include <sqlite3.h> resolves to SQLCipher's version, not the system one.
    add_library(syngrafo_sqlcipher INTERFACE)
    target_include_directories(syngrafo_sqlcipher SYSTEM INTERFACE
        ${SQLCIPHER_INCLUDE_DIRS}
    )
    target_link_libraries(syngrafo_sqlcipher INTERFACE
        ${SQLCIPHER_LIBRARIES}
    )
    target_compile_definitions(syngrafo_sqlcipher INTERFACE
        SQLITE_HAS_CODEC=1          # activates sqlite3_key() path in database.hh
    )
    add_library(SQLite::SQLite3 ALIAS syngrafo_sqlcipher)

else()
    message(STATUS "[syngrafo] SQLCipher not found — falling back to plain SQLite3")
    message(STATUS "          At-rest encryption will be INACTIVE.")
    message(STATUS "          To enable:  brew install sqlcipher   (macOS)")
    message(STATUS "                      apt install libsqlcipher-dev  (Ubuntu)")

    # 1. Try the system / vcpkg / Homebrew package first.
    # 2. Fall back to the official single-file amalgamation (URL download, no Git).
    #    This avoids the vcpkg toolchain bug where its find_package() hook recurses
    #    infinitely inside FetchContent's internal find_package(Git) call on
    #    CMake 3.31+ Windows CI.
    find_package(SQLite3 QUIET)
    if(SQLite3_FOUND)
        message(STATUS "[syngrafo] SQLite3 found via find_package (${SQLite3_VERSION})")
    else()
        message(STATUS "[syngrafo] SQLite3 not found — fetching amalgamation 3.53.0")
        FetchContent_Declare(
            sqlite3_amalgamation
            URL      https://www.sqlite.org/2026/sqlite-amalgamation-3530000.zip
            URL_HASH SHA3_256=c2325c53b3b41761469f91cfb078e96882ac5d85bac10c11b0bd8f253b031e5b
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(sqlite3_amalgamation)
        add_library(sqlite3_bundled STATIC
            "${sqlite3_amalgamation_SOURCE_DIR}/sqlite3.c"
        )
        target_include_directories(sqlite3_bundled PUBLIC
            "${sqlite3_amalgamation_SOURCE_DIR}"
        )
        target_compile_definitions(sqlite3_bundled PRIVATE
            SQLITE_THREADSAFE=1
            SQLITE_ENABLE_FTS5
        )
        # Silence all third-party warnings — sqlite3.c is not our code.
        if(MSVC)
            target_compile_options(sqlite3_bundled PRIVATE /W0)
        else()
            target_compile_options(sqlite3_bundled PRIVATE -w)
        endif()
        add_library(SQLite::SQLite3 ALIAS sqlite3_bundled)
    endif()
endif()



target_link_libraries(syngrafo PRIVATE
    saucer::embedded # compile-time embedded asset API
    nlp_engine       # NLP core + ONNX (when NLP_WITH_ONNX is defined)
    saucer           # webview + window + application
    saucer::desktop  # cross-platform file/folder picker
    SQLite::SQLite3  # DMS persistence layer (db/database.hh)
    ${CMAKE_DL_LIBS}
)

if(APPLE)
    target_link_libraries(syngrafo PRIVATE
        "-framework Cocoa"
        "-framework ImageIO"
        "-framework CoreGraphics"
        "-framework Foundation"
        "-framework Security"   # Keychain (SecItem* API) for zone key storage
    )
endif()

# Platform properties

if(APPLE)
    set_target_properties(syngrafo PROPERTIES
        MACOSX_BUNDLE                      TRUE
        MACOSX_BUNDLE_GUI_IDENTIFIER       "org.pce.syngrafo"
        MACOSX_BUNDLE_BUNDLE_NAME          "Syngrafo"
        MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
    )
elseif(WIN32)
    set_target_properties(syngrafo PROPERTIES
        WIN32_EXECUTABLE TRUE
    )
endif()

# ── macOS: bundle ONNX Runtime dylib into .app/Contents/Frameworks/ ──────────
#
# ONNX is downloaded by external/nlp at configure time into:
#   ${FETCHCONTENT_BASE_DIR}/onnxruntime-src/lib/
#
# The binary's LC_RPATH is set to @executable_path/../Frameworks so dyld
# can locate the dylib at runtime regardless of where the .app is installed.
# Without this the app crashes immediately on any machine that is not the
# original build machine (rpath points into the build directory).
if(APPLE AND NOT DISABLE_ONNX)
    set(_ORT_DYLIB
        "${FETCHCONTENT_BASE_DIR}/onnxruntime-src/lib/libonnxruntime.1.17.3.dylib")

    set_target_properties(syngrafo PROPERTIES
        INSTALL_RPATH            "@executable_path/../Frameworks"
        BUILD_WITH_INSTALL_RPATH TRUE
    )

    add_custom_command(TARGET syngrafo POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${_ORT_DYLIB}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/libonnxruntime.1.17.3.dylib"
        COMMENT "Bundling libonnxruntime into .app/Contents/Frameworks/"
        VERBATIM
    )
endif()

# ── macOS: bundle SQLCipher dylib into .app/Contents/Frameworks/ ─────────────────
#
# Makes the .app self-contained on machines without Homebrew/SQLCipher.
# We call `otool -D` at configure time to learn the library's embedded install
# name, then rewrite that reference in the papiere binary post-build so dyld
# resolves it via @rpath (i.e. Contents/Frameworks/) at runtime.
if(SQLCIPHER_FOUND AND APPLE)
    # Read the install name (LC_ID_DYLIB) baked into the dylib.
    execute_process(
        COMMAND otool -D "${SQLCIPHER_LIBRARIES}"
        OUTPUT_VARIABLE _sc_otool_out
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    # otool -D prints two lines:
    #   /opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib:
    #   /opt/homebrew/opt/sqlcipher/lib/libsqlcipher.0.dylib
    string(REGEX REPLACE ".*[\r\n]([^\r\n]+)$" "\\1" _sc_install_name "${_sc_otool_out}")
    string(STRIP "${_sc_install_name}" _sc_install_name)
    get_filename_component(_sc_dylib_name     "${_sc_install_name}"    NAME)
    get_filename_component(_sc_dylib_realpath "${SQLCIPHER_LIBRARIES}" REALPATH)

    message(STATUS "[syngrafo] SQLCipher install name : ${_sc_install_name}")
    message(STATUS "[syngrafo] SQLCipher real path    : ${_sc_dylib_realpath}")

    # Ensure @executable_path/../Frameworks is in the binary’s LC_RPATH
    # (also set by the ONNX block above when ONNX is enabled; idempotent).
    set_target_properties(syngrafo PROPERTIES
        INSTALL_RPATH            "@executable_path/../Frameworks"
        BUILD_WITH_INSTALL_RPATH TRUE
    )

    add_custom_command(TARGET syngrafo POST_BUILD
        # 1. Ensure the Frameworks directory exists.
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"
        # 2. Copy the versioned dylib (skips if already up-to-date).
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${_sc_dylib_realpath}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_sc_dylib_name}"
        # 3. Rewrite the hard-coded Homebrew path in the binary to @rpath
        #    so dyld finds the bundled copy at runtime.
        COMMAND install_name_tool -change
            "${_sc_install_name}"
            "@rpath/${_sc_dylib_name}"
            "$<TARGET_FILE:syngrafo>"
        COMMENT "[syngrafo] Bundling ${_sc_dylib_name} into .app/Contents/Frameworks/"
        VERBATIM
    )

    unset(_sc_otool_out)
    unset(_sc_install_name)
    unset(_sc_dylib_name)
    unset(_sc_dylib_realpath)
endif()

# ── Install rules (consumed by CPack and cmake --install) ────────────────────
# These tell CPack what goes into each platform's installer package.
if(APPLE)
    # Install the whole .app bundle.  The POST_BUILD commands above have already
    # copied ONNX and SQLCipher dylibs into Contents/Frameworks/, so the bundle
    # is fully self-contained by the time CPack reads it.
    install(TARGETS syngrafo BUNDLE DESTINATION .)
elseif(WIN32)
    install(TARGETS syngrafo RUNTIME DESTINATION .)
else()
    include(GNUInstallDirs)
    install(TARGETS syngrafo RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

# ── CPack installer configuration ─────────────────────────────────────────────
#
# Generates:
#   macOS  → Syngrafo-<ver>-Darwin.dmg          (DragNDrop DMG)
#   Linux  → Syngrafo-<ver>-Linux.deb           (Debian package)
#            Syngrafo-<ver>-Linux.tar.gz         (portable tarball)
#   Windows→ Syngrafo-<ver>-Windows.exe         (NSIS installer)
#            Syngrafo-<ver>-Windows.zip          (portable ZIP)
#
# Run after cmake --build:   cd build && cpack -C Release

set(CPACK_PACKAGE_NAME                "Syngrafo")
set(CPACK_PACKAGE_VENDOR              "pce")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Local-first document management with NLP and 3D preview")
set(CPACK_PACKAGE_VERSION             "${PROJECT_VERSION}")
set(CPACK_PACKAGE_HOMEPAGE_URL        "https://github.com/pce/syngrafo")
set(CPACK_PACKAGE_INSTALL_DIRECTORY   "Syngrafo")
set(CPACK_STRIP_FILES                 TRUE)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE")
    set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE")
endif()

if(APPLE)
    set(CPACK_GENERATOR       "DragNDrop")
    set(CPACK_DMG_FORMAT      "UDBZ")          # bzip2-compressed DMG
    set(CPACK_DMG_VOLUME_NAME "Syngrafo ${PROJECT_VERSION}")

elseif(UNIX)
    set(CPACK_GENERATOR "DEB;TGZ")
    set(CPACK_DEBIAN_PACKAGE_MAINTAINER  "pce")
    set(CPACK_DEBIAN_PACKAGE_SECTION     "utils")
    # amd64 matches the ubuntu-24.04 CI runner; override for ARM builds.
    set(CPACK_DEBIAN_PACKAGE_ARCHITECTURE "amd64")
    # Runtime dependencies on Ubuntu 24.04 (Noble) + LLVM 20 runtime.
    set(CPACK_DEBIAN_PACKAGE_DEPENDS
        "libwebkitgtk-6.0-4, libgtk-4-1, libadwaita-1-0, libsqlite3-0, libc++1-20, libc++abi1-20")

elseif(WIN32)
    set(CPACK_GENERATOR "NSIS;ZIP")
    # NSIS is pre-installed on GitHub Actions windows-2025 runners.
    set(CPACK_NSIS_DISPLAY_NAME                  "Syngrafo ${PROJECT_VERSION}")
    set(CPACK_NSIS_PACKAGE_NAME                  "Syngrafo")
    set(CPACK_NSIS_URL_INFO_ABOUT                "https://github.com/pce/syngrafo")
    set(CPACK_NSIS_MODIFY_PATH                   ON)
    set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
endif()

include(CPack)

# Summary

message(STATUS "")
message(STATUS "${PROJECT_NAME} — Build Configuration")
message(STATUS "=================================")
message(STATUS "  Target:     syngrafo v${PROJECT_VERSION}")
message(STATUS "  C++:        C++${CMAKE_CXX_STANDARD}")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Frontend:   ${FRONTEND_DIST}")
message(STATUS "  bun:        ${BUN_EXECUTABLE}")
if(SQLCIPHER_FOUND)
    message(STATUS "  Encryption: AES-256 via SQLCipher  [ACTIVE]")
else()
    message(STATUS "  Encryption: INACTIVE  (brew install sqlcipher to enable)")
endif()
message(STATUS "")
