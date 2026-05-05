cmake_minimum_required(VERSION 3.25)
if(APPLE)
    project(nlp_engine VERSION 0.9.0 LANGUAGES CXX OBJCXX)
    set(CMAKE_OBJCXX_COMPILER ${CMAKE_CXX_COMPILER})
else()
    project(nlp_engine VERSION 0.9.0 LANGUAGES CXX)
endif()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# nlohmann-json
FetchContent_Declare(
    json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(json)

# simdutf
FetchContent_Declare(
    simdutf
    URL https://github.com/simdutf/simdutf/archive/refs/tags/v5.6.4.tar.gz
)
FetchContent_MakeAvailable(simdutf)

# ONNX Runtime (Simplified for this manual CMakeLists)
option(DISABLE_ONNX "Disable ONNX" OFF)
if(NOT DISABLE_ONNX)
    if(APPLE)
        set(ORT_URL "https://github.com/microsoft/onnxruntime/releases/download/v1.17.3/onnxruntime-osx-arm64-1.17.3.tgz")
    else()
        set(ORT_URL "https://github.com/microsoft/onnxruntime/releases/download/v1.17.3/onnxruntime-linux-x64-1.17.3.tgz")
    endif()

    FetchContent_Declare(onnxruntime URL ${ORT_URL})
    FetchContent_MakeAvailable(onnxruntime)
endif()

# Version header
configure_file(version.hh.in "${CMAKE_CURRENT_BINARY_DIR}/generated/include/nlp/version.hh" @ONLY)

add_library(nlp_engine
    nlp_engine.cpp
    nlp_engine_async.cpp
)

if(APPLE)
    target_sources(nlp_engine PRIVATE
        addons/ocr_addon_apple.mm
        addons/rectifier_addon_apple.mm
        addons/exif_addon_apple.mm
        addons/platform_services_apple.mm   # reveal_in_file_manager via NSWorkspace
    )
    target_link_libraries(nlp_engine PUBLIC
        "-framework Vision"
        "-framework Foundation"
        "-framework AppKit"
        "-framework CoreImage"
        "-framework CoreGraphics"
        "-framework ImageIO"
        "-framework PDFKit"
    )
elseif(WIN32)
    target_sources(nlp_engine PRIVATE
        addons/platform_services_windows.cpp   # reveal_in_file_manager via SHOpenFolderAndSelectItems
    )
elseif(UNIX)
    target_sources(nlp_engine PRIVATE
        addons/platform_services_linux.cpp     # reveal_in_file_manager via D-Bus FileManager1
    )
    # dbus-1 is optional: enables the real ShowItems call; falls back to no-op without it.
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(DBUS QUIET dbus-1)
        if(DBUS_FOUND)
            message(STATUS "[nlp] D-Bus found — reveal_in_file_manager will use FileManager1")
            target_include_directories(nlp_engine PRIVATE ${DBUS_INCLUDE_DIRS})
            target_link_libraries(nlp_engine PRIVATE ${DBUS_LIBRARIES})
            target_compile_definitions(nlp_engine PRIVATE HAVE_DBUS=1)
        else()
            message(STATUS "[nlp] D-Bus not found — reveal_in_file_manager will be a no-op")
        endif()
    endif()
else()
    target_sources(nlp_engine PRIVATE
        addons/platform_services_stub.cpp
    )
endif()

# ── OCR backend — compile-time selection ─────────────────────────────────────
#
# Apple (default):  Apple Vision — zero extra deps, fastest on Apple Silicon.
#                   Set NLP_APPLE_VISION=OFF to use Tesseract instead (e.g. CI parity).
#
# Non-Apple:        Tesseract always — find_package first, fetch from source if not found.
#
if(APPLE)
    option(NLP_APPLE_VISION "Use Apple Vision OCR on macOS" ON)
    if(NLP_APPLE_VISION)
        message(STATUS "[nlp] OCR: Apple Vision")
        target_compile_definitions(nlp_engine PUBLIC NLP_APPLE_VISION)
    else()
        message(STATUS "[nlp] OCR: Tesseract (NLP_APPLE_VISION=OFF)")
    endif()
endif()

# Tesseract — built when: non-Apple, or Apple with NLP_APPLE_VISION=OFF
if(NOT APPLE OR NOT NLP_APPLE_VISION)
    find_package(Tesseract QUIET)
    if(NOT Tesseract_FOUND AND NOT TARGET Tesseract::libtesseract)
        # On MSVC leptonica defaults SW_BUILD=ON, which calls find_package(SW REQUIRED).
        # SW is the sw.io package manager — we never want it; disable before the subdir runs.
        set(BUILD_PROG  OFF CACHE BOOL "" FORCE)
        set(SW_BUILD    OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            leptonica
            URL https://github.com/DanBloomberg/leptonica/archive/refs/tags/1.84.1.tar.gz
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(leptonica)

        # LeptonicaConfig.cmake in the build tree includes LeptonicaTargets.cmake
        # at line ~31, but that file is only written by cmake's install step.
        # Tesseract's find_package(Leptonica REQUIRED) therefore fails at configure
        # time.  Export the build-tree targets now so the file exists when tesseract
        # processes its find_package call.
        export(EXPORT LeptonicaTargets
            NAMESPACE Leptonica::
            FILE "${leptonica_BINARY_DIR}/LeptonicaTargets.cmake"
        )

        # Tell tesseract's find_package(Leptonica REQUIRED) where the just-built tree lives.
        set(Leptonica_DIR "${leptonica_BINARY_DIR}" CACHE PATH "" FORCE)

        set(DISABLE_TIFF         ON  CACHE BOOL "" FORCE)
        set(DISABLE_CURL         ON  CACHE BOOL "" FORCE)
        set(BUILD_TRAINING_TOOLS OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            tesseract_src
            URL https://github.com/tesseract-ocr/tesseract/archive/refs/tags/5.5.0.tar.gz
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(tesseract_src)
        if(TARGET libtesseract AND NOT TARGET Tesseract::libtesseract)
            add_library(Tesseract::libtesseract ALIAS libtesseract)
        endif()
        set(Tesseract_FOUND TRUE)
    endif()

    if(Tesseract_FOUND OR TARGET Tesseract::libtesseract)
        message(STATUS "[nlp] Tesseract — NLP_WITH_TESSERACT enabled")
        target_sources(nlp_engine PRIVATE addons/ocr_addon_tesseract.cpp)
        target_compile_definitions(nlp_engine PUBLIC NLP_WITH_TESSERACT)
        target_link_libraries(nlp_engine PRIVATE Tesseract::libtesseract)
    endif()
endif()

target_include_directories(nlp_engine PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/generated/include>
)

target_link_libraries(nlp_engine PUBLIC
    nlohmann_json::nlohmann_json
    simdutf::simdutf
)

if(NOT DISABLE_ONNX)
    target_compile_definitions(nlp_engine PUBLIC NLP_WITH_ONNX)
    target_include_directories(nlp_engine PUBLIC "${onnxruntime_SOURCE_DIR}/include")
    if(APPLE)
        target_link_libraries(nlp_engine PUBLIC "${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.dylib")
    else()
        target_link_libraries(nlp_engine PUBLIC "${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.so")
    endif()
endif()
