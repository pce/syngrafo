# cmake/compiler.cmake — C++ / Objective-C++ compiler standard settings.
#
# Included early by the root CMakeLists.txt after the project() call.
# Sets C++23 uniformly for all targets and applies Apple-specific OBJCXX flags.

# ── Apple: Objective-C++ ──────────────────────────────────────────────────────
if(APPLE)
    set(CMAKE_OBJCXX_STANDARD          23)
    set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
    set(CMAKE_OBJCXX_EXTENSIONS        OFF)
endif()

# ── C++ standard ─────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD          23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS        OFF)

# ── Windows: suppress noisy Windows.h macros ─────────────────────────────────
if(MSVC)
    add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
    # /bigobj: raise COFF section limit from 65 536 → 4 G so heavily-templated
    # TUs (main.cc pulling in glaze/saucer/onnx headers) do not hit C1128.
    add_compile_options(/bigobj)
endif()
