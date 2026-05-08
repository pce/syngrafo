# cmake/patches/csound_opadr.cmake
#
# Fixes a typo in CSound 6.18.1's public header include/plugin.h.
# Upstream used the wrong struct-member name "opaddr" instead of "opadr"
# in the OPCODINFO struct accessor.  This causes a compile error when
# CSound is built from source (SGF_FETCH_AUDIO=ON).
#
# Called via ExternalProject_Add(csound_build PATCH_COMMAND ...) in cmake/audio.cmake:
#   ${CMAKE_COMMAND} -DFILE=<SOURCE_DIR>/include/plugin.h -P csound_opadr.cmake
#
# Idempotency: once the replacement is applied the pattern "->opaddr" no
# longer exists in the file, so subsequent runs are a no-op.
#
# Remove this patch when upgrading to a CSound release that contains the fix.

file(READ "${FILE}" _c)
string(REPLACE "->opaddr" "->opadr" _c "${_c}")
file(WRITE "${FILE}" "${_c}")
