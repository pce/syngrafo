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
