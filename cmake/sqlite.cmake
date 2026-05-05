# cmake/sqlite.cmake — SQLite / SQLCipher detection and build.
#
# Detection / build order:
#   1. pkg-config        — covers apt, vcpkg, Homebrew, MacPorts automatically
#   2. Manual prefix search — Apple Silicon / Intel Homebrew, /usr/local, /usr
#   3. FetchContent build — SQLite3MultipleCiphers v2.3.3
#      Self-contained: ships its own sqlite3.c amalgamation and all crypto.
#      Zero external deps on every platform — no OpenSSL, no CommonCrypto,
#      no BCrypt required.  Supports sqlite3_key()/sqlite3_rekey() for full
#      SQLCipher API compatibility.
#
# The chosen library is always exposed as  SQLite::SQLite3  so no other
# CMakeLists needs to change.
#
# IMPORTANT — cache hygiene:
#   We deliberately unset SQLCIPHER_FOUND from the cache at the start of
#   every configure run.  This prevents a stale TRUE written by a previous
#   configure (or by the old sqlcipher_src approach) from short-circuiting
#   the detection logic and producing an empty INTERFACE target.
#   Detection is cheap (one pkg-config call + a handful of find_path probes)
#   so re-running it on every configure is fine.

# ── Wipe any cached value from previous runs ─────────────────────────────────
unset(SQLCIPHER_FOUND        CACHE)
unset(SQLCIPHER_INCLUDE_DIRS CACHE)
unset(SQLCIPHER_LIBRARIES    CACHE)
# Also wipe normal (non-cached) versions so pkg_check_modules starts clean.
unset(SQLCIPHER_FOUND)
unset(SQLCIPHER_INCLUDE_DIRS)
unset(SQLCIPHER_LIBRARIES)

# ── 1. pkg-config detection ───────────────────────────────────────────────────
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(SQLCIPHER QUIET sqlcipher)
endif()

# ── 2. Manual prefix search ───────────────────────────────────────────────────
if(NOT SQLCIPHER_FOUND)
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

# ── 3. Build SQLite3MultipleCiphers via FetchContent (always available) ───────
if(SQLCIPHER_FOUND)
    # ── System / Homebrew / pkg-config SQLCipher ──────────────────────────────
    message(STATUS "[syngrafo] SQLCipher found in system — AES-256 encryption ACTIVE")
    message(STATUS "          includes : ${SQLCIPHER_INCLUDE_DIRS}")
    message(STATUS "          library  : ${SQLCIPHER_LIBRARIES}")

    add_library(syngrafo_sqlcipher INTERFACE)
    target_include_directories(syngrafo_sqlcipher SYSTEM INTERFACE
        ${SQLCIPHER_INCLUDE_DIRS}
    )
    target_link_libraries(syngrafo_sqlcipher INTERFACE
        ${SQLCIPHER_LIBRARIES}
    )
    target_compile_definitions(syngrafo_sqlcipher INTERFACE
        SQLITE_HAS_CODEC=1
    )
    add_library(SQLite::SQLite3 ALIAS syngrafo_sqlcipher)

else()
    # ── FetchContent — SQLite3MultipleCiphers ─────────────────────────────────
    #
    # CMake-native, FetchContent-compatible.  Ships its own pre-generated
    # sqlite3.c amalgamation and all crypto code — zero external deps on every
    # platform (no OpenSSL, no CommonCrypto, no BCrypt required).
    # Supports sqlite3_key() / sqlite3_rekey() for full SQLCipher API compat.
    message(STATUS "[syngrafo] No system SQLCipher — fetching SQLite3MultipleCiphers v2.3.3")

    set(SQLITE3MC_BUILD_SHELL OFF CACHE BOOL "" FORCE)
    set(SQLITE3MC_STATIC      ON  CACHE BOOL "" FORCE)
    set(CODEC_TYPE            SQLCIPHER CACHE STRING "" FORCE)

    FetchContent_Declare(
        sqlite3mc
        URL      https://github.com/utelle/SQLite3MultipleCiphers/archive/refs/tags/v2.3.3.tar.gz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(sqlite3mc)

    # sqlite3mc_static is the target name when SQLITE3MC_STATIC=ON
    add_library(syngrafo_sqlcipher INTERFACE)
    target_link_libraries(syngrafo_sqlcipher INTERFACE sqlite3mc_static)
    target_include_directories(syngrafo_sqlcipher SYSTEM INTERFACE
        "${sqlite3mc_SOURCE_DIR}/src"
    )
    # SQLITE_HAS_CODEC activates the sqlite3_key() call in db/database.hh.
    # SYNGRAFO_SQLITE3MC signals that sqlite3mc.h must be included for the
    # sqlite3_key() declaration (it lives there, not in sqlite3.h).
    target_compile_definitions(syngrafo_sqlcipher INTERFACE
        SQLITE_HAS_CODEC=1
        SYNGRAFO_SQLITE3MC=1
    )
    add_library(SQLite::SQLite3 ALIAS syngrafo_sqlcipher)

    # NOTE: we intentionally do NOT write SQLCIPHER_FOUND to the cache here.
    # FetchContent tracks its own state in _deps/.  Writing SQLCIPHER_FOUND=TRUE
    # to the cache would cause the system-sqlcipher branch to be taken on the
    # next configure run — with empty SQLCIPHER_LIBRARIES — producing a linker
    # error exactly like the one this comment exists to prevent.
    set(SQLCIPHER_FOUND TRUE)   # normal (non-cached) var — for summary.cmake

    message(STATUS "[syngrafo] SQLite3MultipleCiphers (SQLCipher mode) — AES-256 ACTIVE")
endif()
