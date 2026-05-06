# Ubuntu 24.04 ships CMake 3.28; all modern CI runners have ≥ 3.28.
# 3.31 = highest policy version we understand (activates all 3.31 policies).
cmake_minimum_required(VERSION 3.28...3.31)

# ─── Policy defaults for transitive dependencies ──────────────────────────────
# These must be set before any add_subdirectory / include / FetchContent call.
#
# CMP0135 (CMake 3.24): use current timestamp for extracted archives so that
#   rebuilds are not triggered by stale mtime from the zip/tarball.
# CMP0175 (CMake 3.31): add_custom_command(TARGET) rejects unknown keyword
#   DEPENDS.  Set OLD so third-party code (simdutf, etc.) isn't broken;
#   the resulting dev-warnings are suppressed by passing -Wno-dev to CI.
set(CMAKE_POLICY_DEFAULT_CMP0135 NEW)
set(CMAKE_POLICY_DEFAULT_CMP0175 OLD)

# ─── FetchContent bootstrap ───────────────────────────────────────────────────
# Must be set BEFORE any FetchContent/CPM call — including transitive ones
# inside external/nlp and the local modules.
#
# FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER prevents FetchContent from calling
# find_package(<dep>) as an optimisation step.  Without this, vcpkg intercepts
# the call and its handler recurses into itself on CMake 3.31 + Windows CI.
#
# NOTE: URL-based CPMAddPackage() declarations in cmake/fetch_deps.cmake do NOT
# call find_package(Git) at all, so there is no vcpkg recursion for those.
# This guard protects any remaining GIT_REPOSITORY-based fetches (e.g. from
# the nlp engine's own cmake files that we don't control).
include(FetchContent)
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER)
set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps")

# ─── Standalone vs monorepo build ────────────────────────────────────────────
# When included by the nlp_engine monorepo the nlp_engine target already exists.
# When built standalone (cmake --preset default) we pull the engine in as a
# subdirectory.

if(NOT TARGET nlp_engine)
    set(NLP_ENGINE_ROOT
        "${CMAKE_CURRENT_SOURCE_DIR}/external/nlp"
        CACHE PATH "Root of the nlp_engine project")

    set(BUILD_TESTING         OFF CACHE BOOL "" FORCE)
    set(BUILD_PYTHON_BINDINGS OFF CACHE BOOL "" FORCE)

    add_subdirectory(
        "${NLP_ENGINE_ROOT}"
        "${CMAKE_CURRENT_BINARY_DIR}/nlp_engine_deps"
        EXCLUDE_FROM_ALL
    )
endif()

# ─── Version ─────────────────────────────────────────────────────────────────
# Single source of truth — bump VERSION to cut a new release.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" SYNGRAFO_VERSION)
string(STRIP "${SYNGRAFO_VERSION}" SYNGRAFO_VERSION)

# ─── project() ───────────────────────────────────────────────────────────────
# OBJCXX must be declared inside project() on Apple so CMake caches it on the
# first configure run.  A later enable_language(OBJCXX) call is not cached and
# breaks stale-cache regenerations.
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Darwin")
    set(_PROJECT_LANGS C CXX OBJCXX)
else()
    set(_PROJECT_LANGS C CXX)
endif()

project(syngrafo LANGUAGES ${_PROJECT_LANGS} VERSION ${SYNGRAFO_VERSION})
unset(_PROJECT_LANGS)

# ─── Compiler / standard settings ────────────────────────────────────────────
include(cmake/compiler.cmake)

# ─── Third-party dependencies (saucer, saucer::desktop) ──────────────────────
include(cmake/fetch_deps.cmake)

# ─── Local modules ────────────────────────────────────────────────────────────
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/external/modules/systray")
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/external/modules/model_downloader")
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/external/modules/updater")

# ─── Frontend (bun build + asset embedding) ───────────────────────────────────
include(cmake/frontend.cmake)

# ─── SQLite / SQLCipher detection ─────────────────────────────────────────────
include(cmake/sqlite.cmake)

# ─── Main executable ──────────────────────────────────────────────────────────
add_executable(syngrafo app/main.cc)

# Platform image decoder
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

target_include_directories(syngrafo PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/app"
    "${CMAKE_CURRENT_SOURCE_DIR}/external"
)

# Embed frontend assets
saucer_embed("${FRONTEND_DIST}" DESTINATION "${FRONTEND_EMBEDDED_DIR}" TARGET syngrafo
    EXCLUDE ".DS_Store"
    EXCLUDE "*.map"
)
# saucer_embedded_pre re-reads dist/ at build time; it must wait for
# syngrafo_frontend to finish writing files to dist/.
add_dependencies(saucer_embedded_pre syngrafo_frontend)

# ─── Link libraries ───────────────────────────────────────────────────────────
target_link_libraries(syngrafo PRIVATE
    saucer::embedded          # compile-time embedded asset API
    nlp_engine                # NLP core + ONNX
    saucer                    # webview + window + application
    saucer::desktop           # cross-platform file/folder picker
    saucer::pdf               # WebView → PDF export
    saucer::systray           # system-tray icon
    saucer::model_downloader  # NLP model management (libcurl)
    saucer::updater           # auto-updater (libcurl, no process spawning)
    SQLite::SQLite3           # DMS persistence layer
    ${CMAKE_DL_LIBS}
)

if(APPLE)
    target_link_libraries(syngrafo PRIVATE
        "-framework Cocoa"
        "-framework ImageIO"
        "-framework CoreGraphics"
        "-framework Foundation"
        "-framework Security"   # Keychain (SecItem* API)
    )
endif()

# ─── Platform bundle properties ───────────────────────────────────────────────
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

# ─── macOS post-build bundling (ONNX, SQLCipher, data/) ───────────────────────
if(APPLE)
    include(cmake/bundle_apple.cmake)
endif()

# ─── CPack installer configuration ────────────────────────────────────────────
include(cmake/cpack_config.cmake)

# ─── Optional: llama.cpp LM inference (SGF_WITH_LM) ────────────────────────
#
# Adds local GGUF inference via llama.cpp to the build.
# When OFF (default) the LMEngine compiles as a no-op stub; the JS bindings
# still register but always return { ok:false, error:"LM support not compiled in" }.
#
# Toggle:  cmake -DSGF_WITH_LM=ON ...
#
# llama.cpp is fetched as a URL tarball (no GIT_REPOSITORY — consistent with
# the fetch_deps.cmake policy that prevents vcpkg recursion on Windows CI).
# Pin to a specific release tag and update when bumping.
#
# Only the llama library target is needed; all examples, tests, and
# server subprojects are disabled to keep configure + compile times short.
option(SGF_WITH_LM
    "Build with llama.cpp GGUF inference support (adds ~300 MB to build, ~30s configure)"
    OFF)

if(SGF_WITH_LM)
    # ── Disable everything we don't need ────────────────────────────────────
    set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
    set(GGML_METAL           OFF CACHE BOOL "" FORCE)  # CPU-only; safe on CI
    set(GGML_BLAS            OFF CACHE BOOL "" FORCE)  # avoid BLAS dep scan
    set(BUILD_SHARED_LIBS    OFF CACHE BOOL "" FORCE)  # static link, no rpath

    # llama.cpp b4901 — March 2025.  Update by changing the tag and the SHA256.
    # URL tarball avoids the Git + vcpkg recursion issue documented in
    # fetch_deps.cmake.
    FetchContent_Declare(
        llama_cpp
        URL      https://github.com/ggerganov/llama.cpp/archive/refs/tags/b4901.tar.gz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(llama_cpp)

    target_compile_definitions(syngrafo PRIVATE SGF_WITH_LM)
    target_link_libraries(syngrafo PRIVATE llama)

    message(STATUS "[syngrafo] SGF_WITH_LM=ON — llama.cpp b4901 enabled")
else()
    message(STATUS "[syngrafo] SGF_WITH_LM=OFF — LMEngine is a no-op stub")
endif()

# ─── Build summary ────────────────────────────────────────────────────────────
include(cmake/summary.cmake)
