# Video backend target — compiled only when SGF_WITH_VIDEO=ON and FFmpeg found.
#
# video_ffmpeg (INTERFACE target) and VIDEO_FFMPEG_FOUND are set by
# cmake/video.cmake which is included before this add_subdirectory() call.

if(NOT SGF_WITH_VIDEO OR NOT VIDEO_FFMPEG_FOUND)
    add_library(pce_video INTERFACE)
    message(STATUS "[video] pce_video — no-op stub (SGF_WITH_VIDEO=${SGF_WITH_VIDEO})")
    return()
endif()

add_library(pce_video INTERFACE)
# Expose the external/ tree so #include "video/video_backend.hpp" also works.
target_include_directories(pce_video INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/..")
target_link_libraries(pce_video INTERFACE video_ffmpeg)
target_compile_definitions(pce_video INTERFACE SGF_WITH_VIDEO)
message(STATUS "[video] pce_video target configured with FFmpeg")
