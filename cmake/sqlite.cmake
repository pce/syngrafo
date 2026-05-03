# cmake/sqlite.cmake — SQLite / SQLCipher detection.
#
# Detection order:
#   1. pkg-config        — covers Homebrew, apt, vcpkg, MacPorts automatically
#   2. Manual Homebrew   — Apple Silicon (/opt/homebrew) & Intel (/usr/local)
#   3. plain SQLite3     — via find_package, encryption inactive
#   4. SQLite3 amalg.    — URL download, last resort, no encryption
#
# The chosen library is always exposed as  SQLite::SQLite3  so the rest of the
# build (target_link_libraries) needs no changes.
#
# Install SQLCipher:
#   macOS : brew install sqlcipher
#   Ubuntu: apt install libsqlcipher-dev

find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(SQLCIPHER QUIET sqlcipher)
endif()

if(NOT SQLCIPHER_FOUND)
    # Manual search — Homebrew places the header under include/sqlcipher/sqlite3.h
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

    add_library(syngrafo_sqlcipher INTERFACE)
    target_include_directories(syngrafo_sqlcipher SYSTEM INTERFACE
        ${SQLCIPHER_INCLUDE_DIRS}
    )
    target_link_libraries(syngrafo_sqlcipher INTERFACE
        ${SQLCIPHER_LIBRARIES}
    )
    target_compile_definitions(syngrafo_sqlcipher INTERFACE
        SQLITE_HAS_CODEC=1      # activates sqlite3_key() path in db/database.hh
    )
    add_library(SQLite::SQLite3 ALIAS syngrafo_sqlcipher)

else()
    message(STATUS "[syngrafo] SQLCipher not found — falling back to plain SQLite3")
    message(STATUS "          At-rest encryption will be INACTIVE.")
    message(STATUS "          To enable:  brew install sqlcipher   (macOS)")
    message(STATUS "                      apt install libsqlcipher-dev  (Ubuntu)")

    find_package(SQLite3 QUIET)
    if(SQLite3_FOUND)
        message(STATUS "[syngrafo] SQLite3 found via find_package (${SQLite3_VERSION})")
    else()
        message(STATUS "[syngrafo] SQLite3 not found — fetching amalgamation 3.53.0")
        include(FetchContent)
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

