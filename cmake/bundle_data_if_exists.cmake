# cmake/bundle_data_if_exists.cmake
# ─────────────────────────────────────────────────────────────────────────────
# Called by a POST_BUILD command to copy <project>/data/ into the macOS .app
# bundle's Contents/Resources/data/.
#
# Variables expected (passed via -D on the cmake command line):
#   SRC_DIR  — absolute path to the source data directory (e.g. <proj>/data)
#   DST_DIR  — absolute path inside the bundle   (e.g. .app/Contents/Resources/data)
#
# If SRC_DIR does not exist the script silently exits so that developer
# environments that haven't run download_models.py yet don't fail the build.
# ─────────────────────────────────────────────────────────────────────────────

if(NOT EXISTS "${SRC_DIR}")
    message(STATUS "bundle_data: '${SRC_DIR}' not found — skipping (run download_models.py to bundle NLP models)")
    return()
endif()

message(STATUS "bundle_data: copying '${SRC_DIR}' → '${DST_DIR}'")
file(MAKE_DIRECTORY "${DST_DIR}")
file(COPY "${SRC_DIR}/" DESTINATION "${DST_DIR}")

