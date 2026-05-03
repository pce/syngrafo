cmake_minimum_required(VERSION 3.25)
project(saucer_model_downloader LANGUAGES CXX)

# ── libcurl (required for self-contained HTTP downloads — no process spawning) ──
find_package(CURL REQUIRED)

add_library(saucer_model_downloader STATIC)
add_library(saucer::model_downloader ALIAS saucer_model_downloader)

target_sources(saucer_model_downloader PRIVATE
    src/model_downloader.cpp
)

target_include_directories(saucer_model_downloader PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# Expose saucer include directories (same pattern as updater module)
if(DEFINED saucer_SOURCE_DIR)
    target_include_directories(saucer_model_downloader PUBLIC
        $<BUILD_INTERFACE:${saucer_SOURCE_DIR}/include>
    )
endif()

if(DEFINED saucer_BINARY_DIR)
    target_include_directories(saucer_model_downloader PUBLIC
        $<BUILD_INTERFACE:${saucer_BINARY_DIR}/include>
    )
endif()

if(DEFINED CMAKE_BINARY_DIR)
    target_include_directories(saucer_model_downloader PUBLIC
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-src/include>
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-build/include>
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-embed-src/include>
    )
endif()

if(TARGET saucer)
    target_include_directories(saucer_model_downloader INTERFACE
        $<TARGET_PROPERTY:saucer,INTERFACE_INCLUDE_DIRECTORIES>
    )
endif()

target_link_libraries(saucer_model_downloader PUBLIC
    saucer
    saucer::desktop
    CURL::libcurl        # libcurl C API — no process spawning
)

# Require C++23 (std::filesystem, atomic, etc.)
target_compile_features(saucer_model_downloader PUBLIC cxx_std_23)

# =============================================================================
# Tests (Catch2) — only enabled when Catch2 is available
# =============================================================================
if(TARGET Catch2::Catch2WithMain)
    add_executable(model_downloader_tests
        tests/test_model_downloader.cpp
    )
    target_link_libraries(model_downloader_tests PRIVATE
        saucer_model_downloader
        Catch2::Catch2WithMain
    )
    target_include_directories(model_downloader_tests PRIVATE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    )
    add_test(NAME model_downloader_tests COMMAND model_downloader_tests)
endif()

