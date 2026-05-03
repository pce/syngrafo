cmake_minimum_required(VERSION 3.25)
project(saucer_updater LANGUAGES CXX)

# ── libcurl (required for self-contained HTTP — no process spawning) ──────────
find_package(CURL REQUIRED)

add_library(saucer_updater STATIC)
add_library(saucer::updater ALIAS saucer_updater)

target_sources(saucer_updater PRIVATE
    src/updater.cpp
)

target_include_directories(saucer_updater PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# Expose saucer include directories so <saucer/request.hpp> etc. resolve
# correctly when building the updater as a local module.
if(DEFINED saucer_SOURCE_DIR)
    target_include_directories(saucer_updater PUBLIC
        $<BUILD_INTERFACE:${saucer_SOURCE_DIR}/include>
    )
endif()

if(DEFINED saucer_BINARY_DIR)
    target_include_directories(saucer_updater PUBLIC
        $<BUILD_INTERFACE:${saucer_BINARY_DIR}/include>
    )
endif()

if(DEFINED CMAKE_BINARY_DIR)
    target_include_directories(saucer_updater PUBLIC
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-src/include>
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-build/include>
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-embed-src/include>
    )
endif()

if(TARGET saucer)
    target_include_directories(saucer_updater INTERFACE
        $<TARGET_PROPERTY:saucer,INTERFACE_INCLUDE_DIRECTORIES>
    )
endif()

target_link_libraries(saucer_updater PUBLIC
    saucer
    saucer::desktop
    glaze::glaze
    CURL::libcurl        # libcurl C API — no process spawning
)

# Ensure C++23 standard for the module
target_compile_features(saucer_updater PUBLIC cxx_std_23)

# =========================
# Tests (Catch2)
# =========================
if(TARGET Catch2::Catch2WithMain)
    add_executable(updater_tests
        tests/test_updater.cpp
    )
    target_link_libraries(updater_tests PRIVATE
        saucer_updater
        Catch2::Catch2WithMain
    )
    target_include_directories(updater_tests PRIVATE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    )
    add_test(NAME updater_tests COMMAND updater_tests)
endif()
