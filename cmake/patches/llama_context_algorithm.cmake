# Patch for llama.cpp — src/llama-context.cpp may omit
# #include <algorithm>.  Inject the missing include after <cinttypes>, which is
# the last standard include already present in that translation unit.
#
# Invoked by FetchContent_Declare PATCH_COMMAND; FILE is passed via -DFILE=...
# Idempotent: if <algorithm> is already present the file is not rewritten.

file(READ "${FILE}" _c)
if(NOT "${_c}" MATCHES "#include <algorithm>")
    string(REPLACE "#include <cinttypes>"
                   "#include <cinttypes>\n#include <algorithm>"
                   _c "${_c}")
    file(WRITE "${FILE}" "${_c}")
endif()
