cmake_minimum_required(VERSION 3.25)
project(saucer_systray LANGUAGES CXX)

# ── Platform language support ──────────────────────────────────────────────────
# ObjC++ is needed for the macOS Cocoa implementation.
if(APPLE)
    enable_language(OBJC OBJCXX)
endif()

# ──────────────────────────────────────────────────────────────────────────────

add_library(saucer_systray STATIC)
add_library(saucer::systray ALIAS saucer_systray)

target_include_directories(saucer_systray PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

# Inherit saucer include dirs (same pattern as other modules)
if(DEFINED saucer_SOURCE_DIR)
    target_include_directories(saucer_systray PUBLIC
        $<BUILD_INTERFACE:${saucer_SOURCE_DIR}/include>
    )
endif()
if(DEFINED CMAKE_BINARY_DIR)
    target_include_directories(saucer_systray PUBLIC
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-src/include>
        $<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/_deps/saucer-build/include>
    )
endif()
if(TARGET saucer)
    target_include_directories(saucer_systray INTERFACE
        $<TARGET_PROPERTY:saucer,INTERFACE_INCLUDE_DIRECTORIES>
    )
endif()

# Platform sources & link
# Each platform compiles exactly one adapter translation unit.
# The header-only CRTP layer (systray.hpp, systray_controller.hpp,
# systray_core.hpp) requires no compilation of its own.

if(APPLE)
    # systray_cocoa.mm   → MacSystrayAdapter   (ObjC++ / AppKit)
    target_sources(saucer_systray PRIVATE src/systray_cocoa.mm)
    target_link_libraries(saucer_systray PUBLIC "-framework AppKit")

elseif(WIN32)
    # systray_win32.cpp  → Win32SystrayAdapter  (Shell_NotifyIcon)
    target_sources(saucer_systray PRIVATE src/systray_win32.cpp)
    target_link_libraries(saucer_systray PUBLIC shell32 user32 comctl32)

else()
    # systray_linux.cpp  → LinuxSystrayAdapter  (AppIndicator / no-op stub)
    find_package(PkgConfig QUIET)

    if(PkgConfig_FOUND)
        pkg_check_modules(AYATANA_INDICATOR QUIET ayatana-appindicator3-0.1)
        pkg_check_modules(APPINDICATOR      QUIET appindicator3-0.1)
    endif()

    if(AYATANA_INDICATOR_FOUND)
        message(STATUS "[systray] Using libayatana-appindicator3")
        target_sources(saucer_systray PRIVATE src/systray_linux.cpp)
        target_compile_definitions(saucer_systray PRIVATE
            SAUCER_SYSTRAY_USE_APPINDICATOR
            SAUCER_SYSTRAY_AYATANA
        )
        target_include_directories(saucer_systray PRIVATE ${AYATANA_INDICATOR_INCLUDE_DIRS})
        target_link_libraries(saucer_systray PUBLIC ${AYATANA_INDICATOR_LIBRARIES})

    elseif(APPINDICATOR_FOUND)
        message(STATUS "[systray] Using libappindicator3")
        target_sources(saucer_systray PRIVATE src/systray_linux.cpp)
        target_compile_definitions(saucer_systray PRIVATE
            SAUCER_SYSTRAY_USE_APPINDICATOR
        )
        target_include_directories(saucer_systray PRIVATE ${APPINDICATOR_INCLUDE_DIRS})
        target_link_libraries(saucer_systray PUBLIC ${APPINDICATOR_LIBRARIES})

    else()
        message(STATUS
            "[systray] No AppIndicator library found — systray disabled on Linux.\n"
            "          Install  libayatana-appindicator3-dev  to enable it.")
        target_sources(saucer_systray PRIVATE src/systray_linux.cpp)
        # SAUCER_SYSTRAY_USE_APPINDICATOR is NOT defined → no-op stub
    endif()
endif()

# ── C++23 ─────────────────────────────────────────────────────────────────────

target_compile_features(saucer_systray PUBLIC cxx_std_23)

# ── Tests (Catch2) ─────────────────────────────────────────────────────────────

if(TARGET Catch2::Catch2WithMain)
    add_executable(systray_tests tests/test_systray.cpp)
    target_link_libraries(systray_tests PRIVATE
        saucer_systray
        Catch2::Catch2WithMain
    )
    target_include_directories(systray_tests PRIVATE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    )
    add_test(NAME systray_tests COMMAND systray_tests)
endif()



