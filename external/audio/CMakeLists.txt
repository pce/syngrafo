# Audio backend target — compiled only when SGF_WITH_AUDIO=ON and CSound found.
#
# audio_csound (INTERFACE target) and AUDIO_CSOUND_FOUND are set by
# cmake/audio.cmake which is included before this add_subdirectory() call.

if(NOT SGF_WITH_AUDIO OR NOT AUDIO_CSOUND_FOUND)
    add_library(pce_audio INTERFACE)
    message(STATUS "[audio] pce_audio — no-op stub (SGF_WITH_AUDIO=${SGF_WITH_AUDIO})")
    return()
endif()

add_library(pce_audio INTERFACE)
# Expose the external/ tree so #include "audio/audio_backend.hpp" also works.
target_include_directories(pce_audio INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/..")
target_link_libraries(pce_audio INTERFACE audio_csound)
target_compile_definitions(pce_audio INTERFACE SGF_WITH_AUDIO)
message(STATUS "[audio] pce_audio target configured with CSound")
