# cmake/patches/extract_csound_pkg.cmake
#
# Extracts CsoundLib64.framework from a CSound macOS .pkg file.
# A macOS .pkg is an xar archive; after pkgutil --expand, the Payload
# inside is a gzip-compressed cpio archive.  Decompression and cpio
# extraction are run as two separate execute_process calls (via an
# intermediate payload.cpio file) so each step's exit code is checked
# independently — a piped sh -c command cannot reliably detect gunzip
# failures without pipefail, which POSIX /bin/sh does not guarantee.
#
# Called by ExternalProject BUILD_COMMAND with:
#   PKG_FILE  — path to the .pkg file
#   DST_DIR   — destination directory; framework ends up at ${DST_DIR}/CsoundLib64.framework
#
cmake_minimum_required(VERSION 3.15)

foreach(_var PKG_FILE DST_DIR)
    if(NOT DEFINED ${_var} OR "${${_var}}" STREQUAL "")
        message(FATAL_ERROR "extract_csound_pkg.cmake: ${_var} must be set")
    endif()
endforeach()

if(NOT EXISTS "${PKG_FILE}")
    message(FATAL_ERROR "[audio] PKG_FILE not found: ${PKG_FILE}")
endif()

set(_expand_dir "${DST_DIR}/_csound7_expand")
set(_payload_dir "${DST_DIR}/_csound7_payload")
set(_fw_dst "${DST_DIR}/CsoundLib64.framework")

# Skip if already extracted
if(EXISTS "${_fw_dst}/CsoundLib64")
    message(STATUS "[audio] CSound 7 framework already extracted — skipping")
    return()
endif()

file(MAKE_DIRECTORY "${_payload_dir}")

# Remove any stale expand directory — pkgutil --expand requires the target NOT to exist
file(REMOVE_RECURSE "${_expand_dir}")

# Step 1: pkgutil --expand unpacks the xar archive
message(STATUS "[audio] Expanding .pkg: ${PKG_FILE}")
execute_process(
    COMMAND pkgutil --expand "${PKG_FILE}" "${_expand_dir}"
    RESULT_VARIABLE _ret
    ERROR_VARIABLE  _err
)
if(_ret)
    message(FATAL_ERROR "[audio] pkgutil --expand failed (${_ret}): ${_err}")
endif()

set(_payload "${_expand_dir}/Payload")
if(NOT EXISTS "${_payload}")
    message(FATAL_ERROR "[audio] Payload not found after pkgutil --expand in ${_expand_dir}")
endif()

# Step 2: the Payload is gzip-compressed cpio.  Split into two calls so
# each exit code is checked independently — a single piped sh -c command
# cannot reliably surface a mid-pipe gunzip failure without pipefail,
# which POSIX /bin/sh does not guarantee.
#
# Step 2a: decompress the Payload into a temporary .cpio file
message(STATUS "[audio] Decompressing cpio payload...")
execute_process(
    COMMAND gunzip -c "${_payload}"
    OUTPUT_FILE "${_payload_dir}/payload.cpio"
    RESULT_VARIABLE _ret
    ERROR_VARIABLE  _err
)
if(_ret)
    message(FATAL_ERROR "[audio] gunzip failed (${_ret}): ${_err}")
endif()

# Step 2b: extract the cpio archive
message(STATUS "[audio] Extracting cpio archive...")
execute_process(
    COMMAND cpio -id --quiet
    INPUT_FILE "${_payload_dir}/payload.cpio"
    WORKING_DIRECTORY "${_payload_dir}"
    RESULT_VARIABLE _ret
    ERROR_VARIABLE  _err
)
if(_ret)
    message(FATAL_ERROR "[audio] cpio extraction failed (${_ret}): ${_err}")
endif()

# Clean up the intermediate file now that it has been extracted
file(REMOVE "${_payload_dir}/payload.cpio")

set(_fw_src "${_payload_dir}/Applications/Csound/CsoundLib64.framework")
if(NOT EXISTS "${_fw_src}")
    message(FATAL_ERROR "[audio] Framework not found after extraction at ${_fw_src}")
endif()

# Step 3: ditto preserves macOS symlinks and resource forks
message(STATUS "[audio] Copying framework to ${_fw_dst} via ditto...")
execute_process(
    COMMAND ditto "${_fw_src}" "${_fw_dst}"
    RESULT_VARIABLE _ret
    ERROR_VARIABLE  _err
)
if(_ret)
    message(FATAL_ERROR "[audio] ditto failed (${_ret}): ${_err}")
endif()

message(STATUS "[audio] CSound 7 framework ready at ${_fw_dst}")
