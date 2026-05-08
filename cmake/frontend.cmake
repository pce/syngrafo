# cmake/frontend.cmake — Bun build + saucer asset embedding.
#
# Finds bun, runs the frontend build at configure time (only once per
# configure), and wires up the incremental re-build target + saucer_embed().
#
# Variables consumed:
#   SYNGRAFO_FRONTEND_PKG  (optional, defaults to frontend/packages/react-client)
#
# Targets created:
#   syngrafo_frontend — custom target that re-runs `bun run build.ts --minify`

if(NOT DEFINED SYNGRAFO_FRONTEND_PKG)
    set(SYNGRAFO_FRONTEND_PKG
        "${CMAKE_CURRENT_SOURCE_DIR}/frontend/packages/react-client")
endif()

set(FRONTEND_PKG  "${SYNGRAFO_FRONTEND_PKG}")
set(FRONTEND_DIST "${FRONTEND_PKG}/dist")

find_program(BUN_EXECUTABLE bun REQUIRED
    DOC "Bun JS runtime — https://bun.sh")

# Stamp-file gate: only re-run `bun install` when the lockfile (or
# package.json as a fallback) is newer than the stamp from the last run.
set(_bun_stamp "${CMAKE_BINARY_DIR}/bun_install.stamp")

# Choose the file whose mtime we watch.
if(EXISTS "${FRONTEND_PKG}/bun.lockb")
    set(_bun_lockfile "${FRONTEND_PKG}/bun.lockb")
else()
    set(_bun_lockfile "${FRONTEND_PKG}/package.json")
endif()

# Read mtimes as Unix epoch seconds (empty string when file doesn't exist).
file(TIMESTAMP "${_bun_lockfile}" _lock_ts "%s" UTC)
file(TIMESTAMP "${_bun_stamp}"    _stamp_ts "%s" UTC)

# Treat a missing stamp as epoch 0 so the first configure always runs.
if(NOT _stamp_ts)
    set(_stamp_ts "0")
endif()

if(_lock_ts GREATER _stamp_ts)
    message(STATUS "[syngrafo] Installing frontend dependencies "
                   "(${_bun_lockfile} is newer than stamp)...")
    execute_process(
        COMMAND ${BUN_EXECUTABLE} install
        WORKING_DIRECTORY "${FRONTEND_PKG}"
        RESULT_VARIABLE _bun_install_exit
        OUTPUT_QUIET
    )
    if(_bun_install_exit)
        message(WARNING
            "[syngrafo] bun install failed (exit ${_bun_install_exit}).\n"
            "  Fix with:\n"
            "    cd ${FRONTEND_PKG} && bun install\n"
            "  then re-run cmake configure.")
    else()
        # Touch the stamp only on success so a failed run retries next time.
        file(TOUCH "${_bun_stamp}")
        message(STATUS "[syngrafo] bun install OK — stamp updated.")
    endif()
else()
    message(STATUS "[syngrafo] Skipping bun install (stamp is up-to-date).")
endif()

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
        "    cd ${FRONTEND_PKG} && bun install && bun run build.ts --minify\n"
        "  then re-run cmake configure.")
else()
    message(STATUS "[syngrafo] Frontend OK → ${FRONTEND_DIST}")
endif()

# Incremental rebuild on cmake --build (does NOT re-run saucer_embed;
# a full re-configure is needed after adding new embedded assets).
add_custom_target(syngrafo_frontend
    COMMAND ${BUN_EXECUTABLE} run build.ts --minify
    WORKING_DIRECTORY "${FRONTEND_PKG}"
    COMMENT "[syngrafo] Rebuilding frontend with bun..."
    BYPRODUCTS "${FRONTEND_DIST}/index.html"
)

# Embed frontend assets into the binary.
# Generated sources land in build/embedded/ — never in the source tree.
set(FRONTEND_EMBEDDED_DIR "${CMAKE_BINARY_DIR}/embedded")
