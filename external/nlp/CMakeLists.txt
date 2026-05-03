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
        set(BUILD_PROG           OFF CACHE BOOL "" FORCE)
        FetchContent_Declare(
            leptonica
            URL https://github.com/DanBloomberg/leptonica/archive/refs/tags/1.84.1.tar.gz
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(leptonica)

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
