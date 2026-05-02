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
    )
else()
    target_sources(nlp_engine PRIVATE
        addons/platform_services_stub.cpp
    )

    # ── Tesseract OCR (cross-platform fallback) ──────────────────────────────
    # Provides a real multi-language OCR implementation for Linux / Windows.
    # Install tessdata language packs separately:
    #   Linux:   sudo apt-get install tesseract-ocr-deu tesseract-ocr-ell
    #   vcpkg:   vcpkg install tesseract
    #   custom:  python3 scripts/download_models.py download --models tessdata
    option(DISABLE_TESSERACT "Disable Tesseract OCR fallback" OFF)
    if(NOT DISABLE_TESSERACT)
        find_package(Tesseract QUIET)
        if(Tesseract_FOUND OR TARGET Tesseract::libtesseract)
            message(STATUS "[nlp] Tesseract found (${Tesseract_VERSION}) — multilingual OCR enabled (eng+deu+ell)")
            target_sources(nlp_engine PRIVATE addons/ocr_addon_tesseract.cpp)
            target_compile_definitions(nlp_engine PUBLIC NLP_WITH_TESSERACT)
            target_link_libraries(nlp_engine PRIVATE Tesseract::libtesseract)
        else()
            message(STATUS "[nlp] Tesseract NOT found — OCR fallback disabled on this platform")
            message(STATUS "      Install: sudo apt-get install libtesseract-dev  OR  vcpkg install tesseract")
        endif()
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
