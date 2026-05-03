# cmake/fetch_deps.cmake — FetchContent / CPM declarations for third-party deps.
#
# Included after project() and before add_subdirectory() calls.
# Pulls saucer + saucer::desktop from GitHub at the pinned tags.

include(FetchContent)

# Ensure FetchContent downloads land in build/_deps (never in the source tree).
set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps")

# Prevent vcpkg's find_package override from recursing into FetchContent on
# CMake 3.31+ (causes >1000 recursive calls).
set(FETCHCONTENT_TRY_FIND_PACKAGE_MODE NEVER)

# ── saucer (webview core) ─────────────────────────────────────────────────────
FetchContent_Declare(
    saucer
    GIT_REPOSITORY https://github.com/saucer/saucer.git
    GIT_TAG        v8.0.5
    GIT_SHALLOW    TRUE
)

set(saucer_static                    ON  CACHE BOOL "" FORCE)
set(saucer_examples                  OFF CACHE BOOL "" FORCE)
set(saucer_tests                     OFF CACHE BOOL "" FORCE)
set(saucer_prefer_remote             ON  CACHE BOOL "" FORCE)
# Bypass compiler-version check for Clang < 20 and legacy variable names.
set(saucer_no_compiler_version_check ON  CACHE BOOL "" FORCE)
set(saucer_no_version_check          ON  CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(saucer)

# ── saucer::desktop (file/folder picker) ─────────────────────────────────────
FetchContent_Declare(
    saucer_desktop
    GIT_REPOSITORY https://github.com/saucer/desktop.git
    GIT_TAG        v4.2.0
    GIT_SHALLOW    TRUE
)

FetchContent_MakeAvailable(saucer_desktop)

