# cmake/summary.cmake — Build configuration summary printed at configure time.
#
# Included at the end of the root CMakeLists.txt.
# All variables it reads must already be set.

message(STATUS "")
message(STATUS "${PROJECT_NAME} — Build Configuration")
message(STATUS "=================================")
message(STATUS "  Target:     syngrafo v${PROJECT_VERSION}")
message(STATUS "  C++:        C++${CMAKE_CXX_STANDARD}")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Frontend:   ${FRONTEND_DIST}")
message(STATUS "  bun:        ${BUN_EXECUTABLE}")
if(SQLCIPHER_FOUND)
    message(STATUS "  Encryption: AES-256 via SQLCipher  [ACTIVE]")
else()
    message(STATUS "  Encryption: INACTIVE  (brew install sqlcipher to enable)")
endif()
message(STATUS "  Systray:    saucer::systray (external/modules/systray)")
message(STATUS "  Updater:    saucer::updater (external/modules/updater, libcurl)")
message(STATUS "")

